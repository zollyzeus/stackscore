import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, sessionCookieOptions, clearCookieOptions } from "../../../../../lib/auth";
import { createCandidateToken, candidateCookieOptions, clearCandidateCookieOptions } from "../../../../../lib/candidateAuth";
import { clearAdminCookieOptions } from "../../../../../lib/adminAuth";
import { isPanelistEmail } from "../../../../../lib/panelistRegistry";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  if (error || !code || !state) {
    return NextResponse.redirect(`${BASE_URL}/login?error=google_denied`);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${BASE_URL}/login?error=not_configured`);
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${BASE_URL}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) return NextResponse.redirect(`${BASE_URL}/login?error=token_failed`);
    const { id_token } = await tokenRes.json();

    const infoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${id_token}`);
    if (!infoRes.ok) return NextResponse.redirect(`${BASE_URL}/login?error=verify_failed`);
    const info = await infoRes.json() as { email: string; name?: string; email_verified?: string; aud?: string };

    if (info.aud !== clientId || info.email_verified !== "true") {
      return NextResponse.redirect(`${BASE_URL}/login?error=unverified`);
    }

    // Verify CSRF nonce
    let decoded: { type: string; next: string; nonce?: string };
    try {
      decoded = JSON.parse(Buffer.from(state, "base64url").toString());
    } catch {
      return NextResponse.redirect(`${BASE_URL}/login?error=invalid_state`);
    }
    const storedNonce = req.cookies.get("oauth_nonce")?.value;
    if (!decoded.nonce || !storedNonce || decoded.nonce !== storedNonce) {
      return NextResponse.redirect(`${BASE_URL}/login?error=csrf_failed`);
    }

    let { type, next } = decoded;
    if (!["panelist", "candidate"].includes(type)) type = "candidate";

    // Sanitise open-redirect: next must be a relative path
    if (!next.startsWith("/") || next.includes("://")) {
      next = type === "panelist" ? "/dashboard" : "/me";
    }

    if (type === "panelist" && !(await isPanelistEmail(info.email))) {
      return NextResponse.redirect(`${BASE_URL}/login?error=not_authorised`);
    }

    const redirect = NextResponse.redirect(`${BASE_URL}${next}`);
    redirect.cookies.set("oauth_nonce", "", { maxAge: 0, path: "/" }); // clear nonce
    // Google sign-in only ever yields a panelist or candidate session — never admin (IP-gated, OTP-only).
    const adminClear = clearAdminCookieOptions();
    redirect.cookies.set(adminClear.name, adminClear.value, adminClear);
    if (type === "panelist") {
      const token = await createSessionToken(info.email, info.name ?? info.email.split("@")[0]);
      const opts = sessionCookieOptions(token);
      redirect.cookies.set(opts.name, opts.value, opts);
      const candClear = clearCandidateCookieOptions();
      redirect.cookies.set(candClear.name, candClear.value, candClear);
    } else {
      const token = await createCandidateToken(info.email, info.name);
      const opts = candidateCookieOptions(token);
      redirect.cookies.set(opts.name, opts.value, opts);
      redirect.cookies.set(clearCookieOptions());
    }
    return redirect;
  } catch (err) {
    console.error("[google/callback]", err);
    return NextResponse.redirect(`${BASE_URL}/login?error=server_error`);
  }
}
