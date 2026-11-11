import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

/** GET /api/auth/google?type=panelist|candidate&next=/path — initiates OAuth flow */
export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "Google OAuth not configured (GOOGLE_CLIENT_ID missing)" }, { status: 503 });
  }
  const type = req.nextUrl.searchParams.get("type") ?? "candidate";
  const next = req.nextUrl.searchParams.get("next") ?? (type === "panelist" ? "/dashboard" : "/me");
  const nonce = randomBytes(16).toString("hex");
  const state = Buffer.from(JSON.stringify({ type, next, nonce })).toString("base64url");
  const redirectUri = `${BASE_URL}/api/auth/google/callback`;

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");

  const response = NextResponse.redirect(url.toString());
  response.cookies.set("oauth_nonce", nonce, {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "lax", maxAge: 600, path: "/",
  });
  return response;
}

