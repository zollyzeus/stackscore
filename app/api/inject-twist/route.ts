import { NextRequest, NextResponse } from "next/server";
import { twistColumn } from "../../../lib/matrix";
import { generateTwist } from "../../../lib/vertex";
import { appendTranscript, getSession, db } from "../../../lib/firestore";
import { logError } from "../../../lib/logger";
import { getCandidateSessionFromRequest } from "../../../lib/candidateAuth";

export async function POST(req: NextRequest) {
  const cand = await getCandidateSessionFromRequest(req);
  if (!cand) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { sessionId } = await req.json();
    const session = await getSession(sessionId);
    const sessionExt = session as unknown as Record<string, unknown>;

    // If this session was allocated from the scenario bank, the twist is pre-generated.
    if (sessionExt.bankPackId && sessionExt.bankTwist) {
      const twistColumnId = sessionExt.bankTwistColumnId as string;
      const twistColumnLabel = sessionExt.bankTwistColumnLabel as string;
      const twistText = sessionExt.bankTwist as string;

      await db().collection("sessions").doc(sessionId).update({ twistColumnId });
      await appendTranscript(sessionId, "adapt", { twist: twistText, source: "bank" });

      return NextResponse.json({ twistColumnId, twistColumnLabel, twist: twistText });
    }

    // Live path: generate twist with Gemini (→ Claude Haiku) or fall back to template.
    const twist = twistColumn(session.columnId);
    const twistPressure = twist.pressures[Math.floor(Math.random() * twist.pressures.length)];

    let twistText: string;
    try {
      twistText = await generateTwist({
        brief: session.brief,
        rowLabel: (sessionExt.rowLabel as string) ?? session.rowId,
        twistColumnLabel: twist.label,
        twistPressure,
      });
    } catch {
      twistText = `New requirement from leadership: the solution must now also address ${twist.label} concerns — specifically ${twistPressure}. How does your current design handle this?`;
    }

    await db().collection("sessions").doc(sessionId).update({ twistColumnId: twist.id });
    await appendTranscript(sessionId, "adapt", { twist: twistText });

    return NextResponse.json({ twistColumnId: twist.id, twistColumnLabel: twist.label, twist: twistText });
  } catch (err) {
    logError("[inject-twist]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
