import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/firestore";
import { logError } from "../../../../lib/logger";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession(params.id);

    if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
      return NextResponse.json({ error: "expired" }, { status: 410 });
    }

    if (session.status === "evaluated") {
      return NextResponse.json({ error: "already_evaluated" }, { status: 409 });
    }

    return NextResponse.json({
      sessionId: session.id,
      brief: session.brief,
      role: session.role ?? "Mid",
      rowId: session.rowId,
      columnId: session.columnId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Unknown session")) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    logError("[session/[id]]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
