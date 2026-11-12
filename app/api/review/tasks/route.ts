import { NextRequest, NextResponse } from "next/server";
import { requireReviewer } from "../../../../lib/requireReviewer";
import { listTasksForReviewer, listReviewTasks } from "../../../../lib/reviewQueue";

export const dynamic = "force-dynamic";

/**
 * GET /api/review/tasks — the signed-in reviewer's queue.
 *
 * Returns their assigned tasks plus the unassigned pool they may claim. Deliberately
 * returns no scoring data of any kind: the list exists to pick work from, and a preview
 * showing "AI scored this 34" would defeat the review before it started.
 */
export async function GET(req: NextRequest) {
  const auth = await requireReviewer(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const [mine, pool] = await Promise.all([
    listTasksForReviewer(auth.session!.email),
    listReviewTasks("unassigned"),
  ]);

  const shape = (t: { id: string; candidateName?: string; role?: string; state: string; reason: string }) => ({
    id: t.id,
    candidateName: t.candidateName ?? null,
    role: t.role ?? null,
    state: t.state,
    // The reason the judge failed is operational context, not a hint about quality.
    reason: t.reason?.slice(0, 200) ?? "",
  });

  return NextResponse.json({
    assigned: mine.filter((t) => t.state !== "submitted").map(shape),
    completed: mine.filter((t) => t.state === "submitted").map(shape),
    pool: pool.map(shape),
  });
}
