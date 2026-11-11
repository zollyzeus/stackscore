import { NextRequest, NextResponse } from "next/server";
import { createSession } from "../../../lib/firestore";
import { rateLimit } from "../../../lib/rateLimit";
import { logError } from "../../../lib/logger";
import { createCandidateToken, candidateCookieOptions } from "../../../lib/candidateAuth";
import { nanoid } from "nanoid";

// Pre-loaded demo brief — a realistic mid-complexity scenario
const DEMO_BRIEF = `We run a B2C e-commerce platform and are launching a flash-sale feature for major shopping events. During peak sales, we expect up to 50,000 concurrent users hitting our product pages. The core problem: our current inventory system uses a simple database counter, and we're seeing race conditions where more orders are accepted than actual stock available.

We need a solution that guarantees inventory accuracy under extreme load, ensures no customer is charged for an item that's out of stock, and keeps the checkout experience feeling instant — no spinners, no "processing..." delays. The business team has also asked that we surface real-time remaining stock counts on the product page (e.g., "Only 3 left!") with sub-second freshness.

What's your approach to redesigning this system?`;

export const dynamic = "force-dynamic";

/** Demo sessions get a scoped, anonymous candidate identity so the "no sign-up needed"
 *  promise holds: every downstream stage route requires an ss_cand session, and the
 *  session's own candidateEmail must match it for evaluation. The synthetic address uses
 *  a reserved .invalid TLD so it can never collide with or impersonate a real candidate,
 *  and the cookie is short-lived. */
const DEMO_SESSION_HOURS = 3;

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (!await rateLimit("demo:" + ip, 5)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  try {
    const demoEmail = `demo-${nanoid(12).toLowerCase()}@demo.invalid`;
    const sessionId = await createSession({
      mode: "b2c",
      rowId: "demo",
      columnId: "demo",
      brief: DEMO_BRIEF,
      role: "Mid",
      candidateEmail: demoEmail,
      candidateName: "Demo Candidate",
      isDemo: true,
      expiresAt: new Date(Date.now() + DEMO_SESSION_HOURS * 3_600_000).toISOString(),
    } as Parameters<typeof createSession>[0]);

    const res = NextResponse.json({ sessionId });
    const token = await createCandidateToken(demoEmail, "Demo Candidate");
    const opts = candidateCookieOptions(token);
    res.cookies.set(opts.name, opts.value, { ...opts, maxAge: DEMO_SESSION_HOURS * 3600 });
    return res;
  } catch (err) {
    logError("[demo]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
