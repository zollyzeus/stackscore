/**
 * Scoring hold and the pending-job queue (B5).
 *
 * When the hold is active, candidates can still complete and submit assessments — that part
 * is non-negotiable, because a candidate who has spent an hour on five stages must never
 * lose the work to an operational decision. Their submission is queued instead of judged,
 * and drained when the hold lifts.
 */
import { db } from "./firestore";
import { FieldValue } from "firebase-admin/firestore";

const DOC = "scoringHold";

export interface ScoringHoldState {
  active: boolean;
  reason?: string;
  /** True when the monitor engaged it; false when a human did. */
  automatic?: boolean;
  since?: string;
}

export async function getScoringHoldState(): Promise<ScoringHoldState> {
  try {
    const snap = await db().collection("config").doc(DOC).get();
    if (!snap.exists) return { active: false };
    const d = snap.data() ?? {};
    return {
      active: d.active === true,
      reason: d.reason as string | undefined,
      automatic: d.automatic as boolean | undefined,
      since: d.since as string | undefined,
    };
  } catch {
    // Firestore unreachable must not pause scoring: an infrastructure blip would otherwise
    // stop the product, which is a strictly worse outcome than scoring during uncertainty.
    return { active: false };
  }
}

export async function getScoringHold(): Promise<boolean> {
  return (await getScoringHoldState()).active;
}

export async function setScoringHold(
  active: boolean,
  reason: string,
  opts: { onlyIfAutomatic?: boolean; by?: string } = {},
): Promise<void> {
  if (opts.onlyIfAutomatic) {
    const current = await getScoringHoldState();
    // A hold a human placed deliberately is not the monitor's to lift. Releasing it
    // silently because a probe passed would override an operator's judgement with a
    // three-call heuristic.
    if (current.active && current.automatic !== true) return;
  }
  await db().collection("config").doc(DOC).set({
    active,
    reason,
    automatic: opts.by ? false : true,
    ...(opts.by ? { by: opts.by } : {}),
    since: new Date().toISOString(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

/**
 * Parks a completed submission for judging later. The payload is everything the judge needs,
 * captured at submit time rather than re-derived on drain: the session document can change
 * (or expire) between the two, and a queued job must score the work as it was submitted.
 */
export async function enqueuePendingScoring(input: {
  sessionId: string;
  publicSlug: string;
  reason: string;
}): Promise<void> {
  await db().collection("pendingScoring").doc(input.sessionId).set({
    sessionId: input.sessionId,
    publicSlug: input.publicSlug,
    reason: input.reason,
    state: "pending",
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

export async function listPendingScoring(limit = 25) {
  const snap = await db()
    .collection("pendingScoring")
    .where("state", "==", "pending")
    .limit(limit)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<{
    id: string; sessionId: string; publicSlug: string; reason: string;
  }>;
}

export async function markPendingScoringDone(sessionId: string): Promise<void> {
  await db().collection("pendingScoring").doc(sessionId).update({
    state: "done",
    updatedAt: FieldValue.serverTimestamp(),
  });
}
