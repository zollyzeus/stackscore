import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "./lib/auth";
import { verifyAdminToken } from "./lib/adminAuth";

// Panelist-cookie (ss_panel) protected routes — admin is intentionally excluded,
// since admin is a separate role/cookie (ss_admin), not a privileged panelist.
const PROTECTED_PAGES = ["/dashboard", "/panel", "/compare"];
const PROTECTED_API = [
  "/api/generate-problem",
  "/api/export-csv",
];
const COOKIE = "ss_panel";
const ADMIN_COOKIE = "ss_admin";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Admin routes are gated by the admin session cookie alone.
  //
  // The IP allowlist that used to sit in front of this was removed deliberately (A1). It
  // was a second factor, and dropping it is a real reduction in defence depth -- so the
  // identity checks behind it have to carry the full weight. They do: an admin session is
  // only ever minted for an address in the admin registry (OTP and Google both check
  // isAdmin()), requireAdmin() re-checks that registry on every API request so revoking
  // access takes effect immediately rather than at token expiry, and admin sessions last
  // 12h against the panelist 7d.
  //
  // What was actually wrong with the allowlist: it pinned access to one residential IP, so
  // it failed closed and invisibly every time that address changed -- the app served
  // normally and admin simply vanished, which happened on 2026-11-12. A control that
  // reliably locks out the legitimate operator and is trivially bypassed by anyone who can
  // reach the origin from an allowed network is not buying the depth it appears to.
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    const adminToken = req.cookies.get(ADMIN_COOKIE)?.value;
    const adminSession = adminToken ? await verifyAdminToken(adminToken).catch(() => null) : null;
    if (!adminSession) {
      if (pathname.startsWith("/api/admin")) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      url.searchParams.set("type", "admin");
      return NextResponse.redirect(url);
    }
    // Deliberately does not echo the admin's email into a response header: it leaks
    // identity to anything reading the response, and the value is user-controlled
    // (a CRLF in a display name makes the header write throw).
    return NextResponse.next();
  }

  const isProtectedPage = PROTECTED_PAGES.some((p) => pathname.startsWith(p));
  const isProtectedApi = PROTECTED_API.some((p) => pathname.startsWith(p));

  if (!isProtectedPage && !isProtectedApi) return NextResponse.next();

  const token = req.cookies.get(COOKIE)?.value;
  const session = token ? await verifySessionToken(token).catch(() => null) : null;

  if (!session) {
    if (isProtectedApi) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    url.searchParams.set("type", "panelist");
    return NextResponse.redirect(url);
  }

  // See the note above re: not echoing identity into response headers.
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/panel/:path*",
    "/compare/:path*",
    "/admin/:path*",
    "/admin",
    "/api/admin/:path*",
    "/api/generate-problem",
    "/api/export-csv",
  ],
};
