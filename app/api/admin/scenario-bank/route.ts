/**
 * GET  /api/admin/scenario-bank  — returns bank stats
 * POST /api/admin/scenario-bank  — triggers an immediate fill (proxies to the fill task)
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/requireAdmin";
import { getBankStats } from "../../../../lib/scenarioBank";
import { logError } from "../../../../lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;
  try {
    const stats = await getBankStats();
    return NextResponse.json(stats);
  } catch (err) {
    logError("[admin/scenario-bank GET]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;
  try {
    const fillUrl = new URL("/api/tasks/fill-scenario-bank", req.url).toString();
    const res = await fetch(fillUrl, {
      method: "POST",
      headers: { "x-task-runner-secret": process.env.TASK_RUNNER_SECRET ?? "" },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    logError("[admin/scenario-bank POST]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
