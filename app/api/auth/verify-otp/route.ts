import { NextRequest, NextResponse } from "next/server";
import { verifyOTP, type OTPType } from "../../../../lib/otp";
import { createSessionToken, sessionCookieOptions, clearCookieOptions } from "../../../../lib/auth";
import { createCandidateToken, candidateCookieOptions, clearCandidateCookieOptions } from "../../../../lib/candidateAuth";
import { createAdminToken, adminCookieOptions, clearAdminCookieOptions } from "../../../../lib/adminAuth";
import { isAdmin } from "../../../../lib/requireAdmin";
import { isPanelistEmail } from "../../../../lib/panelistRegistry";

// Only one role session may be active per browser at a time — logging in as one
// role clears any session cookie the other two roles left behind.
function clearOtherSessions(res: NextResponse, keep: OTPType) {
  if (keep !== "panelist") { const o = clearCookieOptions(); res.cookies.set(o); }
  if (keep !== "candidate") { const o = clearCandidateCookieOptions(); res.cookies.set(o.name, o.value, o); }
  if (keep !== "admin") { const o = clearAdminCookieOptions(); res.cookies.set(o.name, o.value, o); }
}

export async function POST(req: NextRequest) {
  const { email, code, type, name } = await req.json() as {
    email?: string; code?: string; type?: OTPType; name?: string;
  };
  if (!email || !code || !type) {
    return NextResponse.json({ error: "email, code and type required" }, { status: 400 });
  }
  if (type === "admin") {
    // The registry is the whole gate now that the IP allowlist is gone (A1).
    if (!(await isAdmin(email))) {
      return NextResponse.json({ error: "access_denied" }, { status: 403 });
    }
  }
  // Re-check the panelist registry at verification time too: approval can be revoked
  // between send-otp and verify-otp, and only the admin path re-checked before.
  if (type === "panelist" && !(await isPanelistEmail(email))) {
    return NextResponse.json({ error: "access_denied" }, { status: 403 });
  }

  const ok = await verifyOTP(email, code.trim(), type);
  if (!ok) {
    return NextResponse.json({ error: "Invalid or expired code" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  if (type === "panelist") {
    const displayName = name?.trim() || email.split("@")[0];
    const token = await createSessionToken(email, displayName);
    const opts = sessionCookieOptions(token);
    res.cookies.set(opts.name, opts.value, opts);
  } else if (type === "admin") {
    const displayName = name?.trim() || email.split("@")[0];
    const token = await createAdminToken(email, displayName);
    const opts = adminCookieOptions(token);
    res.cookies.set(opts.name, opts.value, opts);
  } else {
    const token = await createCandidateToken(email, name?.trim());
    const opts = candidateCookieOptions(token);
    res.cookies.set(opts.name, opts.value, opts);
  }
  clearOtherSessions(res, type);
  return res;
}
