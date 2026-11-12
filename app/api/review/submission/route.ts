import { NextRequest, NextResponse } from "next/server";
import { requireReviewer } from "../../../../lib/requireReviewer";
import { getReviewTask } from "../../../../lib/reviewQueue";
import { db } from "../../../../lib/firestore";

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

  const transcript = (s.transcript ?? {}) as Record<string, Array<Record<string, unknown>>>;
  const extract = (stage: string, field: string): string => {
    const entries = transcript[stage] ?? [];
    const hit = entries.find((e) => typeof e[field] === "string");
    return (hit?.[field] as string) ?? "";
  };

  return NextResponse.json({
    sessionId,
    brief: s.brief ?? "",
    role: s.role ?? null,
    rowLabel: s.rowLabel ?? null,
    columnLabel: s.columnLabel ?? null,
    candidateName: s.candidateName ?? null,
    stages: {
      clarifying: extract("clarify", "transcript") || extract("clarify", "text"),
      design: extract("propose", "text") || extract("propose", "design"),
      code: extract("implement", "code"),
      twist: extract("adapt", "text"),
      debug: extract("debug", "code") || extract("debug", "text"),
    },
    task: { state: task.state, assignedTo: task.assignedTo ?? null },
  });
}
