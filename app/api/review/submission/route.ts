import { NextRequest, NextResponse } from "next/server";
import { requireReviewer } from "../../../../lib/requireReviewer";
import { getReviewTask } from "../../../../lib/reviewQueue";
import { db, getTranscript } from "../../../../lib/firestore";
import { extractStages } from "../../../../lib/submissionInput";

export const dynamic = "force-dynamic";

/**
 * GET /api/review/submission?sessionId=... — the candidate's work, and nothing else.
 *
 * This endpoint is the bias boundary of the whole review feature, so the filtering happens
 * HERE rather than in the page that renders it. A page that receives the AI scores and
 * chooses not to display them has already lost: the data is in the HTML, in the network
 * tab, and one careless refactor away from being shown. The reviewer's browser never
 * receives them at all.
 *
 * Specifically withheld: axisScores, stackScore, levelScores, feedback, evidence,
 * thinkingLog, summary, tips, judgeUsage. Returned: the brief and the candidate's own five
 * stages, which is what a human grader needs and all they need.
 */
export async function GET(req: NextRequest) {
  const auth = await requireReviewer(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  const task = await getReviewTask(sessionId);
  if (!task) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // A reviewer may only open work assigned to them or still unclaimed. Without this any
  // reviewer could read any held submission, which is a privacy boundary as much as a
  // workflow one.
  if (task.state === "assigned" && task.assignedTo !== auth.session!.email) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const snap = await db().collection("sessions").doc(sessionId).get();
  if (!snap.exists) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const s = snap.data() ?? {};

  // The reviewer must see exactly what the judge would have seen, minus the scores. Reading
  // the transcript through a private mapping is how they ended up seeing an empty code stage
  // for a submission that had code -- see lib/submissionInput.ts.
  const transcript = await getTranscript(sessionId);
  const stages = extractStages(transcript);

  return NextResponse.json({
    sessionId,
    brief: s.brief ?? "",
    role: s.role ?? null,
    rowLabel: s.rowLabel ?? null,
    columnLabel: s.columnLabel ?? null,
    candidateName: s.candidateName ?? null,
    stages,
    task: { state: task.state, assignedTo: task.assignedTo ?? null },
  });
}
