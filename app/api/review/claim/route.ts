import { NextRequest, NextResponse } from "next/server";
import { requireReviewer } from "../../../../lib/requireReviewer";
import { getReviewTask, assignReviewTask } from "../../../../lib/reviewQueue";

export const dynamic = "force-dynamic";

/** POST /api/review/claim { sessionId } — take an unassigned task. */
export async function POST(req: NextRequest) {
  const auth = await requireReviewer(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const reviewer = auth.session!.email;

  const body = await req.json().catch(() => null) as { sessionId?: string } | null;
  if (!body?.sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  const task = await getReviewTask(body.sessionId);
  if (!task) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (task.state === "submitted") return NextResponse.json({ error: "already_submitted" }, { status: 409 });
  // Losing a claim race must not silently hand two reviewers the same submission: whoever
  // got there first keeps it, and the second reviewer is told so rather than wasting an
  // hour on work that will be overwritten.
  if (task.state === "assigned" && task.assignedTo !== reviewer) {
    return NextResponse.json({ error: "already_claimed", by: task.assignedTo }, { status: 409 });
  }

  await assignReviewTask(body.sessionId, reviewer);
  return NextResponse.json({ ok: true });
}
