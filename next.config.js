/** @type {import('next').NextConfig} */

const PROD_ORIGIN = process.env.NEXT_PUBLIC_BASE_URL || "https://stackscore.anandrajendran.dev";

const IS_DEV = process.env.NODE_ENV !== "production";

// 'unsafe-inline' is still required for the inline theme bootstrap in app/layout.tsx and
// the per-component <style> blocks.
//
// 'unsafe-eval' is NOT shipped to production: candidate code is executed server-side in
// lib/sandbox.ts, never in the browser. It is allowed in development only because the
// Next.js dev server's React Refresh / HMR runtime evaluates strings — without it the dev
// build silently fails to hydrate and every page becomes non-interactive.
const SCRIPT_SRC = IS_DEV
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";

const CSP = [
  "default-src 'self'",
  SCRIPT_SRC,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const BASE_SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Content-Security-Policy", value: CSP },
];

const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async redirects() {
    return [
      {
        // Legacy path. This was a server component calling redirect(), but the page was
        // statically prerendered, so Next served the redirect from its full-route cache
        // as a 307 with an HTML body and NO Location header — the browser stayed put.
        // A config-level redirect is handled before rendering and always sends Location.
        source: "/candidate/login",
        destination: "/login?type=candidate",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: BASE_SECURITY_HEADERS,
      },
      {
        // Credential verification is a PUBLIC, read-only endpoint: a StackScore is only
        // worth something if a third party can check it from their own page. Locking it
        // to our own origin defeated the point of the shareable credential.
        source: "/api/verify/:slug",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type" },
          { key: "Cache-Control", value: "public, max-age=300" },
        ],
      },
      {
        // Everything else stays same-origin only.
        source: "/api/((?!verify/).*)",
        headers: [
          { key: "Access-Control-Allow-Origin", value: PROD_ORIGIN },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type" },
          { key: "Vary", value: "Origin" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
