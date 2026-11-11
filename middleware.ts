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

function getClientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.ip ?? null;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Admin routes: IP allowlist first, then the dedicated admin session cookie.
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    const allowlist = process.env.ADMIN_IP_ALLOWLIST;
    const clientIp = getClientIp(req);
    const ipAllowed = allowlist && clientIp
      ? allowlist.split(",").map(ip => ip.trim()).includes(clientIp)
      : false;
    if (!ipAllowed) {
      if (pathname.startsWith("/api/admin")) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      return new NextResponse("Access restricted", { status: 403, headers: { "Content-Type": "text/plain" } });
    }

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
