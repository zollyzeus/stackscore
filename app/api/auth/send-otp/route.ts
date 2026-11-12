import { NextRequest, NextResponse } from "next/server";
import { generateOTP, storeOTP, type OTPType } from "../../../../lib/otp";
import { sendOTPEmail } from "../../../../lib/resend";
import { db } from "../../../../lib/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { isAdmin } from "../../../../lib/requireAdmin";
import { isReviewer } from "../../../../lib/reviewerRegistry";
import { isPanelistEmail } from "../../../../lib/panelistRegistry";

// Max 3 OTPs per email per 15 minutes
async function checkRateLimit(email: string): Promise<boolean> {
  const windowMs = 15 * 60 * 1000;
  const key = `rate:otp:${email.toLowerCase()}`;
  const ref = db().collection("rate_limits").doc(key);
  const snap = await ref.get();
  const now = Date.now();
  if (snap.exists) {
    const { count, windowStart } = snap.data() as { count: number; windowStart: number };
    if (now - windowStart < windowMs) {
      if (count >= 3) return false;
      await ref.update({ count: FieldValue.increment(1) });
      return true;
    }
  }
  await ref.set({ count: 1, windowStart: now });
  return true;
}

export async function POST(req: NextRequest) {
  const { email, type } = await req.json() as { email?: string; type?: OTPType };
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }
  if (!type || !["panelist", "candidate", "admin", "reviewer"].includes(type)) {
    return NextResponse.json({ error: "type must be panelist, candidate, admin, or reviewer" }, { status: 400 });
  }
  if (type === "admin") {
    // Admin sign-in is never self-serve: the email must already be on the admin registry.
    // Since A1 removed the IP allowlist, this is the gate -- an unregistered address can
    // request a code for any other role, but never for admin.
    if (!(await isAdmin(email))) {
      return NextResponse.json({ error: "access_denied", message: "This email is not registered as an admin." }, { status: 403 });
    }
  }
  // Reviewer, like admin, is never self-serve: an unregistered address cannot even
  // request a code, so the registry is the gate rather than the OTP.
  if (type === "reviewer" && !(await isReviewer(email))) {
    return NextResponse.json(
      { error: "access_denied", message: "This email is not registered as a reviewer." },
      { status: 403 },
    );
  }
  if (type === "panelist" && !(await isPanelistEmail(email))) {
    // Not an approved panelist — record a pending request so admin can approve
    const normalized = email.toLowerCase().trim();
    try {
      const reqRef = db().collection("panelistRequests").doc(normalized);
      const existing = await reqRef.get();
      const existingData = existing.data() as { status?: string } | undefined;
      if (existingData?.status === "rejected") {
        return NextResponse.json({ error: "access_denied", message: "Your panelist access request was not approved. Contact support." }, { status: 403 });
      }
      if (existingData?.status === "approved") {
        // Approval happened but panelist doc wasn't created — fix it and proceed
        await db().collection("panelists").doc(normalized).set({ active: true, addedAt: new Date().toISOString(), invitedBy: "admin-approved" }, { merge: true });
      } else {
        // Create/update pending request
        await reqRef.set({ status: "pending", requestedAt: new Date().toISOString(), email: normalized }, { merge: true });
        return NextResponse.json({ error: "pending_approval", message: "Your panelist access request has been submitted. You'll be notified when approved." }, { status: 202 });
      }
    } catch {
      return NextResponse.json({ error: "Email not authorised for panelist access" }, { status: 403 });
    }
  }
  const allowed = await checkRateLimit(email).catch(() => true); // non-fatal if Firestore unavailable
  if (!allowed) {
    return NextResponse.json({ error: "Too many OTP requests. Please wait 15 minutes." }, { status: 429 });
  }
  try {
    const code = generateOTP();
    await storeOTP(email, code, type);
    await sendOTPEmail(email, code, type);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[send-otp]", err);
    return NextResponse.json({ error: "Failed to send OTP" }, { status: 500 });
  }
}
