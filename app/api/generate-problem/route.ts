import { NextRequest, NextResponse } from "next/server";
import { randomCell, manualCell } from "../../../lib/matrix";
import { generateBrief } from "../../../lib/vertex";
import { requirePanelist } from "../../../lib/requirePanelist";
import { logError } from "../../../lib/logger";

export async function POST(req: NextRequest) {
  const deny = await requirePanelist(req);
  if (deny) return deny;

  try {
    const body = await req.json();
    const cell = body.mode === "manual" ? manualCell(body.rowId, body.columnId) : randomCell();

    let brief: string;
    try {
      brief = await generateBrief({
        rowLabel: cell.rowLabel,
        columnLabel: cell.columnLabel,
        seed: cell.seed,
        pressure: cell.pressure,
      });
    } catch {
      brief = `You are tasked with designing a ${cell.rowLabel.toLowerCase()} system. Key constraint: ${cell.columnLabel} — specifically ${cell.pressure}. What clarifying questions would you ask before proposing a solution?`;
    }

    return NextResponse.json({ cell, brief });
  } catch (err) {
    logError("[generate-problem]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
