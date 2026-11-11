import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../lib/firestore";
import { getCandidateSessionFromRequest } from "../../../lib/candidateAuth";

export async function POST(req: NextRequest) {
  const cand = await getCandidateSessionFromRequest(req);
  if (!cand) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { sessionId, status } = await req.json();
    if (!sessionId || !["quit", "abandoned"].includes(status)) {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
    // Only the candidate who owns this session may change its status.
    const snap = await db().collection("sessions").doc(sessionId).get();
    if (!snap.exists) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const owner = snap.data()?.candidateEmail as string | undefined;
    if (!owner || owner.toLowerCase().trim() !== cand.email.toLowerCase().trim()) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    await db().collection("sessions").doc(sessionId).set(
      { status, statusAt: new Date() },
      { merge: true }
    );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true }); // best-effort, never error to client
  }
}
