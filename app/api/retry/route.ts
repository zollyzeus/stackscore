import { NextRequest, NextResponse } from "next/server";
import { getScoreBySlug, getSession, createSession, db } from "../../../lib/firestore";
import { logError } from "../../../lib/logger";
import { getCandidateSessionFromRequest } from "../../../lib/candidateAuth";
import { nanoid } from "nanoid";

/**
 * POST /api/retry
 * { slug }
 * Creates a new B2B session using the same brief as an existing scored session.
 * Returns { sessionId } — candidate navigates to /assessment/{sessionId}.
 */
export async function POST(req: NextRequest) {
  const cand = await getCandidateSessionFromRequest(req);
  if (!cand) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { slug } = await req.json();
    if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });

    const doc = await getScoreBySlug(slug);
    if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const original = await getSession(doc.sessionId as string).catch(() => null);

    const brief = (doc.brief ?? original?.brief) as string | undefined;
    if (!brief) return NextResponse.json({ error: "brief not found" }, { status: 400 });

    const sessionId = await createSession({
      mode: "b2b",
      rowId: (original?.rowId ?? "retry") as string,
      columnId: (original?.columnId ?? "retry") as string,
      brief,
      candidateId: nanoid(),
      role: (original?.role ?? doc.role) as string | undefined,
    } as Parameters<typeof createSession>[0]);

    await db().collection("sessions").doc(sessionId).update({
      retryOf: doc.sessionId as string,
      retryOfSlug: slug,
    });

    return NextResponse.json({ sessionId });
  } catch (err) {
    logError("[retry]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
