import { NextRequest, NextResponse } from "next/server";
import { requireReviewer } from "../../../../lib/requireReviewer";
import { getReviewTask, assignReviewTask, submitReview } from "../../../../lib/reviewQueue";
import { computeScoreCard, type AxisScores, type AxisId } from "../../../../lib/scoring";
import rubric from "../../../../data/rubric.json";

export const dynamic = "force-dynamic";

const AXIS_IDS = rubric.levels.flatMap((l) => l.axes.map((a) => a.id as AxisId));

/** POST /api/review/claim-or-submit is split in two; this one records the review. */
export async function POST(req: NextRequest) {
  const auth = await requireReviewer(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const reviewer = auth.session!.email;

  const body = await req.json().catch(() => null) as {
    sessionId?: string;
    scores?: Record<string, unknown>;
    feedback?: Record<string, string>;
    notes?: string;
  } | null;
  if (!body?.sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  const task = await getReviewTask(body.sessionId);
  if (!task) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (task.state === "submitted") {
    return NextResponse.json({ error: "already_submitted" }, { status: 409 });
  }
  if (task.state === "assigned" && task.assignedTo !== reviewer) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Validate every axis before writing anything. A review is written straight onto a
  // candidate's permanent record, so a partially-filled form must be rejected outright
  // rather than silently defaulting the missing axes to zero -- which would read as a
  // deliberate "this is worth nothing" judgement that nobody made.
  const axisScores = {} as AxisScores;
  const missing: string[] = [];
  const invalid: string[] = [];
  for (const id of AXIS_IDS) {
    const raw = body.scores?.[id];
    if (raw === undefined || raw === null || raw === "") { missing.push(id); continue; }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) { invalid.push(id); continue; }
    axisScores[id] = Math.round(n);
  }
  if (missing.length || invalid.length) {
    return NextResponse.json(
      { error: "incomplete", missing, invalid },
      { status: 400 },
    );
  }

  const card = computeScoreCard(axisScores);
  const feedback: Record<string, string> = {};
  for (const id of AXIS_IDS) {
    const f = body.feedback?.[id];
    if (typeof f === "string" && f.trim()) feedback[id] = f.trim().slice(0, 2000);
  }

  // Claim-on-submit: a reviewer who opened an unassigned task and scored it owns it.
  if (task.state === "unassigned") await assignReviewTask(body.sessionId, reviewer);

  await submitReview({
    sessionId: body.sessionId,
    reviewerEmail: reviewer,
    axisScores,
    feedback,
    stackScore: card.stackScore,
    levelScores: card.levelScores,
    notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 4000) : undefined,
  });

  console.log("[review] REVIEW_SUBMITTED", JSON.stringify({
    sessionId: body.sessionId, reviewer, stackScore: card.stackScore,
  }));

  return NextResponse.json({ ok: true, stackScore: card.stackScore, levelScores: card.levelScores });
}
