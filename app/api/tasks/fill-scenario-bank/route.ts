/**
 * Cloud Scheduler task: fill-scenario-bank
 *
 * Keeps a minimum pool of pre-generated assessment packs available so that
 * live Gemini failures never stall a session. Each pack contains:
 *   - brief (stage-1 problem statement)
 *   - pre-picked twist column + generated twist text (stage-4 fallback)
 *
 * Defect injection (stage 5) is always live — it depends on candidate code.
 *
 * Recommended schedule: every 2 hours, or trigger manually from /admin.
 * Target pool: BANK_TARGET (default 20 available packs).
 *
 * Auth: TASK_RUNNER_SECRET header.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomCell, twistColumn } from "../../../../lib/matrix";
import { generateBrief, generateTwist } from "../../../../lib/vertex";
import { storePack, getBankStats } from "../../../../lib/scenarioBank";
import { logError } from "../../../../lib/logger";

const BANK_TARGET = Number(process.env.SCENARIO_BANK_TARGET ?? 20);
const MAX_BATCH = 10; // per invocation to stay within Cloud Run request timeout

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-task-runner-secret");
  if (!secret || secret !== process.env.TASK_RUNNER_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const stats = await getBankStats();
    const deficit = Math.max(0, BANK_TARGET - stats.available);
    const toGenerate = Math.min(deficit, MAX_BATCH);

    if (toGenerate === 0) {
      return NextResponse.json({
        message: "bank_full",
        available: stats.available,
        target: BANK_TARGET,
      });
    }

    const results = await Promise.allSettled(
      Array.from({ length: toGenerate }, () => generateOnePack())
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    return NextResponse.json({
      message: "fill_complete",
      generated: succeeded,
      failed,
      available: stats.available + succeeded,
      target: BANK_TARGET,
    });
  } catch (err) {
    logError("[fill-scenario-bank]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

async function generateOnePack(): Promise<void> {
  const cell = randomCell();
  const twist = twistColumn(cell.columnId);
  const twistPressure = twist.pressures[Math.floor(Math.random() * twist.pressures.length)];

  const [brief, twistText] = await Promise.all([
    generateBrief({
      rowLabel: cell.rowLabel,
      columnLabel: cell.columnLabel,
      seed: cell.seed,
      pressure: cell.pressure,
    }),
    generateTwist({
      brief: "", // brief not ready yet; generate a generic twist for this column pair
      rowLabel: cell.rowLabel,
      twistColumnLabel: twist.label,
      twistPressure,
    }),
  ]);

  await storePack({
    rowId: cell.rowId,
    columnId: cell.columnId,
    rowLabel: cell.rowLabel,
    columnLabel: cell.columnLabel,
    seed: cell.seed,
    pressure: cell.pressure,
    brief,
    twistColumnId: twist.id,
    twistColumnLabel: twist.label,
    twistPressure,
    twist: twistText,
  });
}
