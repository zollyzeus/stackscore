import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type { AxisScores } from "./scoring";

function app() {
  if (getApps().length) return getApps()[0];
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

export function db() {
  return getFirestore(app());
}

export interface SessionDoc {
  id: string;
  mode: "b2c" | "b2b";
  rowId: string;
  columnId: string;
  twistColumnId?: string;
  brief: string;
  candidateId?: string;
  candidateName?: string;
  candidateEmail?: string;
  panelistId?: string;
  role?: string;
  expiresAt?: string; // ISO string; absence = never expires
  isDemo?: boolean;
  status: "in_progress" | "evaluated";
  createdAt: FirebaseFirestore.FieldValue;
}

export async function createSession(input: Omit<SessionDoc, "id" | "status" | "createdAt">): Promise<string> {
  // Firestore rejects undefined values — strip them before writing
  const data = Object.fromEntries(
    Object.entries({ ...input, status: "in_progress", createdAt: FieldValue.serverTimestamp() })
      .filter(([, v]) => v !== undefined)
  );
  const ref = await db().collection("sessions").add(data);
  return ref.id;
}

export async function getSession(sessionId: string) {
  const snap = await db().collection("sessions").doc(sessionId).get();
  if (!snap.exists) throw new Error(`Unknown session: ${sessionId}`);
  return { id: snap.id, ...snap.data() } as SessionDoc;
}

/** Transcript stages: clarify | propose | build | adapt | debug */
export async function appendTranscript(sessionId: string, stage: string, entry: Record<string, unknown>) {
  await db()
    .collection("transcripts")
    .doc(sessionId)
    .collection("stages")
    .doc(stage)
    .set(
      { entries: FieldValue.arrayUnion({ ...entry, at: new Date().toISOString() }) },
      { merge: true }
    );
}

export async function getTranscript(sessionId: string) {
  const snap = await db().collection("transcripts").doc(sessionId).collection("stages").get();
  const stages: Record<string, unknown> = {};
  snap.forEach((doc) => (stages[doc.id] = doc.data().entries ?? []));
  return stages;
}

export async function updateScoreFields(sessionId: string, fields: Record<string, unknown>) {
  const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  await db().collection("scores").doc(sessionId).update(clean);
}

export async function setDecision(sessionId: string, decision: "shortlist" | "hold" | "reject" | null) {
  if (decision === null) {
    await db().collection("scores").doc(sessionId).update({ decision: FieldValue.delete() });
  } else if (decision === "shortlist") {
    await db().collection("scores").doc(sessionId).update({ decision, hiredAt: new Date().toISOString() });
  } else {
    await db().collection("scores").doc(sessionId).update({ decision });
  }
}

export async function setNotes(sessionId: string, notes: string) {
  await db().collection("scores").doc(sessionId).update({ notes });
}

export async function saveScore(
  sessionId: string,
  publicSlug: string,
  scoreCard: { axisScores: AxisScores; stackScore: number; levelScores: { design: number; code: number } },
  feedback: Record<string, string>,
  meta?: {
    brief?: string; rowLabel?: string; columnLabel?: string; role?: string;
    fastSubmit?: boolean; fastSubmitStages?: string[];
    candidateName?: string; candidateEmail?: string;
    tabSwitchCount?: number; summary?: string; tips?: Record<string, string>;
    thinkingLog?: string; designProposal?: string;
  }
) {
  const data = Object.fromEntries(
    Object.entries({ sessionId, publicSlug, ...scoreCard, feedback, ...meta, createdAt: FieldValue.serverTimestamp() })
      .filter(([, v]) => v !== undefined)
  );
  await db().collection("scores").doc(sessionId).set(data);
  await db().collection("sessions").doc(sessionId).update({ status: "evaluated" });
}

export async function getScoreBySlug(publicSlug: string) {
  const snap = await db().collection("scores").where("publicSlug", "==", publicSlug).limit(1).get();
  if (snap.empty) return null;
  return snap.docs[0].data();
}

export async function saveCheckpoint(sessionId: string, data: Record<string, unknown>) {
  await db().collection("checkpoints").doc(sessionId).set({
    ...data,
    savedAt: FieldValue.serverTimestamp(),
  });
}

export async function loadCheckpoint(sessionId: string): Promise<Record<string, unknown> | null> {
  const snap = await db().collection("checkpoints").doc(sessionId).get();
  if (!snap.exists) return null;
  return snap.data() ?? null;
}

export async function getScoresByEmail(email: string, limit = 20): Promise<Record<string, unknown>[]> {
  const snap = await db()
    .collection("scores")
    .where("candidateEmail", "==", email.toLowerCase().trim())
    .orderBy("createdAt", "desc")
    .limit(limit)
    .select(...SCORE_LIST_FIELDS)
    .get();
  return snap.docs.map((d) => ({ docId: d.id, ...d.data() }));
}

/** Fields the dashboard table and analytics actually render. Projecting them keeps the
 *  8KB-per-doc thinkingLog and the design proposal out of a list query. */
const SCORE_LIST_FIELDS = [
  "sessionId", "publicSlug", "stackScore", "levelScores", "axisScores",
  "role", "candidateName", "candidateEmail", "decision", "hiredAt",
  "notes", "createdAt", "rowLabel", "columnLabel", "fastSubmit",
  "tabSwitchCount", "summary",
];

export async function getAllScores(limit = 100): Promise<Record<string, unknown>[]> {
  const snap = await db()
    .collection("scores")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .select(...SCORE_LIST_FIELDS)
    .get();
  return snap.docs.map((d) => ({ docId: d.id, ...d.data() }));
}

/** Full document, including the large fields — for a single score card. */
export async function getScoreById(sessionId: string): Promise<Record<string, unknown> | null> {
  const snap = await db().collection("scores").doc(sessionId).get();
  return snap.exists ? { docId: snap.id, ...snap.data() } : null;
}
