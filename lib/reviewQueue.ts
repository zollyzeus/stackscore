/**
 * Review pipeline (A3).
 *
 * Lifecycle of a score's provenance, stored on the score record as `judgeStatus`:
 *
 *   judged          the calibrated judge scored it. The normal path.
 *   partial         the calibrated judge failed; an UNCALIBRATED judge pass produced these
 *                   numbers. Shown with "Partially judged, subject to change" and a retry
 *                   is queued. Real model output, but not scored against the anchored
 *                   rubric the calibration evidence describes -- so it is not comparable to
 *                   a `judged` score and must not be presented as one.
 *   pending_review  both judge passes failed. No AI numbers are shown at all; the card is
 *                   held with "On hold for human verification" and a review task exists.
 *   reviewed        a human reviewer scored it against the same rubric. Authoritative.
 *
 * Why `partial` exists rather than going straight to human review: a judge failure is
 * usually transient (a 400, a timeout, a truncation), and a candidate who has just finished
 * five stages should get something back. The uncalibrated pass is a degraded result that
 * says so on its face, not a silent substitute -- which is the distinction AUDIT_TODO D11
 * was about.
 */
import { db } from "./firestore";
import { FieldValue } from "firebase-admin/firestore";
import type { AxisScores } from "./scoring";

export type JudgeStatus = "judged" | "partial" | "pending_review" | "reviewed";

export const JUDGE_STATUS_BADGE: Record<JudgeStatus, { label: string; tone: "ok" | "warn" | "hold" } | null> = {
  judged: null,
  partial: { label: "Partially judged, subject to change", tone: "warn" },
  pending_review: { label: "On hold for human verification", tone: "hold" },
  reviewed: { label: "Human reviewed", tone: "ok" },
};

/** A score whose numbers are provisional or absent must not feed cohort statistics. */
export function isAuthoritativeStatus(status: unknown): boolean {
  return status === undefined || status === "judged" || status === "reviewed";
}

export type ReviewTaskState = "unassigned" | "assigned" | "submitted";

export interface ReviewTask {
  sessionId: string;
  publicSlug: string;
  state: ReviewTaskState;
  reason: string;
  assignedTo?: string;
  assignedAt?: unknown;
  createdAt?: unknown;
  submittedAt?: unknown;
  submittedBy?: string;
  candidateName?: string;
  role?: string;
}

/**
 * Creates the review task for a held score. Idempotent on sessionId: a retry that fails
 * again must not produce a second task for the same submission, or two reviewers can be
 * assigned the same work and silently overwrite each other.
 */
export async function createReviewTask(input: {
  sessionId: string;
  publicSlug: string;
  reason: string;
  candidateName?: string;
  role?: string;
}): Promise<void> {
  const ref = db().collection("reviewTasks").doc(input.sessionId);
  const existing = await ref.get();
  if (existing.exists) return;
  await ref.set({
    sessionId: input.sessionId,
    publicSlug: input.publicSlug,
    state: "unassigned" as ReviewTaskState,
    reason: input.reason,
    ...(input.candidateName ? { candidateName: input.candidateName } : {}),
    ...(input.role ? { role: input.role } : {}),
    createdAt: FieldValue.serverTimestamp(),
  });
}

export async function listReviewTasks(state?: ReviewTaskState, limit = 100) {
  let q = db().collection("reviewTasks").orderBy("createdAt", "desc").limit(limit);
  if (state) q = db().collection("reviewTasks").where("state", "==", state).limit(limit);
  const snap = await q.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as (ReviewTask & { id: string })[];
}

export async function listTasksForReviewer(email: string, limit = 100) {
  const snap = await db()
    .collection("reviewTasks")
    .where("assignedTo", "==", email.toLowerCase().trim())
    .limit(limit)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as (ReviewTask & { id: string })[];
}

export async function assignReviewTask(sessionId: string, reviewerEmail: string): Promise<void> {
  await db().collection("reviewTasks").doc(sessionId).update({
    state: "assigned" as ReviewTaskState,
    assignedTo: reviewerEmail.toLowerCase().trim(),
    assignedAt: FieldValue.serverTimestamp(),
  });
}

export async function getReviewTask(sessionId: string) {
  const snap = await db().collection("reviewTasks").doc(sessionId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() } as ReviewTask & { id: string };
}

/**
 * Writes a human review onto the score record and closes the task.
 *
 * The reviewer's numbers REPLACE the stored axis scores rather than sitting alongside them.
 * A held score has no AI numbers worth keeping (both passes failed), and carrying a second
 * set of scores would immediately raise "which one is the score?" on every surface that
 * reads the record.
 */
export async function submitReview(input: {
  sessionId: string;
  reviewerEmail: string;
  axisScores: AxisScores;
  feedback: Record<string, string>;
  stackScore: number;
  levelScores: { design: number; code: number };
  notes?: string;
}): Promise<void> {
  const batch = db().batch();
  const scoreRef = db().collection("scores").doc(input.sessionId);
  batch.update(scoreRef, {
    axisScores: input.axisScores,
    feedback: input.feedback,
    stackScore: input.stackScore,
    levelScores: input.levelScores,
    judgeStatus: "reviewed" as JudgeStatus,
    reviewedBy: input.reviewerEmail.toLowerCase().trim(),
    reviewedAt: FieldValue.serverTimestamp(),
    ...(input.notes ? { reviewNotes: input.notes } : {}),
    // The fallback flag described a card the judge did not produce. A reviewed card was
    // produced by a human on purpose, so it is no longer a fallback and must rejoin the
    // statistics it was quarantined from.
    judgeFallback: FieldValue.delete(),
  });
  const taskRef = db().collection("reviewTasks").doc(input.sessionId);
  batch.update(taskRef, {
    state: "submitted" as ReviewTaskState,
    submittedBy: input.reviewerEmail.toLowerCase().trim(),
    submittedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
}
