/**
 * Reviewer route guard (A3). Node-runtime only: it reaches the Firestore-backed
 * registry, so it must never be imported from middleware.ts. See lib/reviewerAuth.ts.
 */
import { NextRequest } from "next/server";
import { verifyReviewerToken } from "./reviewerAuth";
import { isReviewer } from "./reviewerRegistry";

const COOKIE = "ss_reviewer";

/**
 * Guard for every reviewer API route. Only ever called from a Node-runtime route
 * handler, which is why it can reach the Firestore-backed registry at all. Re-checks the registry on each request rather than
 * trusting the token's claim, so revoking a reviewer takes effect immediately -- the same
 * rule requireAdmin follows, and it matters more here because a reviewer's output is
 * written into a candidate's permanent score record.
 */
export async function requireReviewer(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  if (!token) return { error: "unauthorized" as const, status: 401, session: null };
  const session = await verifyReviewerToken(token).catch(() => null);
  if (!session?.email) return { error: "unauthorized" as const, status: 401, session: null };
  if (!(await isReviewer(session.email))) {
    return { error: "forbidden" as const, status: 403, session: null };
  }
  return { error: null, status: 200, session };
}
