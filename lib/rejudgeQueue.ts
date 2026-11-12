/**
 * Re-judge queue (A3).
 *
 * A `partial` score was produced by the uncalibrated judge because the calibrated pass
 * failed. The numbers are real model output but are not comparable to anchored scores, so
 * each one owes the candidate a proper re-judge.
 *
 * This is a Firestore-backed queue rather than an in-process retry for one reason: the
 * failure that caused the fallback is usually not instantaneous-transient. A 400 from a
 * malformed schema, a model outage, or an exhausted quota all persist for longer than a
 * request, so retrying inside the same request mostly burns a second call and fails again.
 * A durable task survives the process, can be retried on a schedule with backoff, and --
 * the part that matters operationally -- leaves a countable record of how often the judge
 * is failing. A silent in-process retry would hide exactly the signal D8 needed.
 */
import { db } from "./firestore";
import { FieldValue } from "firebase-admin/firestore";

export type RejudgeState = "pending" | "done" | "failed";

/** Attempts before a task gives up and escalates to human review. */
export const MAX_REJUDGE_ATTEMPTS = 3;

export interface RejudgeTask {
  sessionId: string;
  state: RejudgeState;
  attempts: number;
  reason: string;
  lastError?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

/**
 * Idempotent on sessionId: an assessment submitted twice, or a task re-queued by an
 * operator, must not produce two workers re-judging the same submission into the same
 * record.
 */
export async function enqueueRejudge(sessionId: string, reason: string): Promise<void> {
  const ref = db().collection("rejudgeTasks").doc(sessionId);
  const existing = await ref.get();
  if (existing.exists && existing.data()?.state === "pending") return;
  await ref.set({
    sessionId,
    state: "pending" as RejudgeState,
    attempts: existing.exists ? (existing.data()?.attempts ?? 0) : 0,
    reason,
    createdAt: existing.exists ? existing.data()?.createdAt : FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

export async function listPendingRejudges(limit = 25) {
  const snap = await db()
    .collection("rejudgeTasks")
    .where("state", "==", "pending")
    .limit(limit)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as (RejudgeTask & { id: string })[];
}

export async function markRejudgeDone(sessionId: string): Promise<void> {
  await db().collection("rejudgeTasks").doc(sessionId).update({
    state: "done" as RejudgeState,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Records a failed attempt. Returns true once the task has exhausted its attempts, which is
 * the caller's signal to escalate to human review rather than keep burning model calls on a
 * submission that has now failed the judge four times.
 */
export async function markRejudgeAttemptFailed(sessionId: string, error: string): Promise<boolean> {
  const ref = db().collection("rejudgeTasks").doc(sessionId);
  const snap = await ref.get();
  const attempts = (snap.data()?.attempts ?? 0) + 1;
  const exhausted = attempts >= MAX_REJUDGE_ATTEMPTS;
  await ref.update({
    attempts,
    lastError: error.slice(0, 500),
    state: (exhausted ? "failed" : "pending") as RejudgeState,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return exhausted;
}
