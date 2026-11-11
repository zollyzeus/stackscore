import { NextRequest, NextResponse } from "next/server";
import { getAllScores } from "../../../lib/firestore";
import { requirePanelist } from "../../../lib/requirePanelist";
import { logError } from "../../../lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const deny = await requirePanelist(req);
  if (deny) return deny;

  const { searchParams } = new URL(req.url);
  const role = searchParams.get("role") ?? "";
  const threshold = Number(searchParams.get("threshold") ?? 0);

  let scores: Awaited<ReturnType<typeof getAllScores>> = [];
  try {
    scores = await getAllScores(500);
  } catch (err) {
    logError("[export-csv]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  const filtered = scores.filter((s) => {
    if (role && s.role !== role) return false;
    if (threshold > 0 && (s.stackScore as number) < threshold) return false;
    return true;
  });

  const headers = ["Name", "Email", "Score", "Design", "Code", "Grade", "Role", "Domain", "Constraint", "Decision", "TabSwitches", "FastSubmit", "Date", "ScoreCardURL"];

  function grade(score: number) {
    if (score >= 85) return "Exceptional";
    if (score >= 70) return "Strong";
    if (score >= 55) return "Proficient";
    if (score >= 40) return "Developing";
    return "Needs Work";
  }

  function csvCell(val: unknown): string {
    const s = val == null ? "" : String(val);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  const rows = filtered.map((s) => {
    const ss = s.stackScore as number;
    const ls = s.levelScores as { design: number; code: number } | undefined;
    const dateStr = (s as Record<string, unknown>).createdAt &&
      typeof ((s as Record<string, unknown>).createdAt as { toDate?: () => Date }).toDate === "function"
      ? ((s as Record<string, unknown>).createdAt as { toDate: () => Date }).toDate().toISOString().split("T")[0]
      : "";
    return [
      s.candidateName ?? "",
      s.candidateEmail ?? "",
      ss,
      ls?.design ?? "",
      ls?.code ?? "",
      grade(ss),
      s.role ?? "",
      s.rowLabel ?? "",
      s.columnLabel ?? "",
      s.decision ?? "",
      s.tabSwitchCount ?? 0,
      s.fastSubmit ? "yes" : "no",
      dateStr,
      s.publicSlug ? `/score/${s.publicSlug}` : "",
    ].map(csvCell).join(",");
  });

  const csv = [headers.join(","), ...rows].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="stackscore-export.csv"`,
    },
  });
}
