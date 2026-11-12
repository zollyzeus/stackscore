import { NextRequest, NextResponse } from "next/server";
import { randomCell, manualCell } from "../../../lib/matrix";
import { generateBrief } from "../../../lib/vertex";
import { allocateFromBank } from "../../../lib/scenarioBank";
import { requirePanelist } from "../../../lib/requirePanelist";
import { logError } from "../../../lib/logger";

export async function POST(req: NextRequest) {
  const deny = await requirePanelist(req);
  if (deny) return deny;

  try {
    const body = await req.json();
    const cell = body.mode === "manual" ? manualCell(body.rowId, body.columnId) : randomCell();

    // Live generation (Gemini → Claude Haiku fallback is inside generateBrief via vertex.ts).
    // If both fail, claim a pre-generated pack from the scenario bank.
    let brief: string;
    let bankPackId: string | undefined;

    try {
      brief = await generateBrief({
        rowLabel: cell.rowLabel,
        columnLabel: cell.columnLabel,
        seed: cell.seed,
        pressure: cell.pressure,
      });
    } catch (liveErr) {
      console.warn("[generate-problem] live generation failed, trying bank:", liveErr instanceof Error ? liveErr.message : liveErr);

      // sessionId not known yet — pass a placeholder; the caller must patch
      // allocatedToSession once the session doc is created.
      const pack = await allocateFromBank("__pending__", { rowId: cell.rowId });
      if (pack) {
        brief = pack.brief;
        bankPackId = pack.id;
        // Override cell fields to match the banked pack so stage-4 uses correct twist.
        Object.assign(cell, {
          rowId: pack.rowId,
          columnId: pack.columnId,
          rowLabel: pack.rowLabel,
          columnLabel: pack.columnLabel,
          seed: pack.seed,
          pressure: pack.pressure,
        });
      } else {
        // Last resort: static template (bank empty)
        brief = `You are tasked with designing a ${cell.rowLabel.toLowerCase()} system. Key constraint: ${cell.columnLabel} — specifically ${cell.pressure}. What clarifying questions would you ask before proposing a solution?`;
      }
    }

    return NextResponse.json({ cell, brief, bankPackId });
  } catch (err) {
    logError("[generate-problem]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
