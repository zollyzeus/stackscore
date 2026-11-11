import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/requireAdmin";
import { db, getAllScores } from "../../../../lib/firestore";
import { logError } from "../../../../lib/logger";

export async function GET(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;
  try {
    const [scores, sessionSnap, panelistSnap, creditsSnap, selfAssessSnap] = await Promise.all([
      getAllScores(500),
      db().collection("sessions").orderBy("createdAt", "desc").limit(500).get(),
      db().collection("panelists").get(),
      db().collection("credits").get(),
      db().collection("selfAssessCredits").get(),
    ]);

    const totalSessions = sessionSnap.size;
    const b2bSessions = sessionSnap.docs.filter(d => d.data().mode === "b2b").length;
    const b2cSessions = sessionSnap.docs.filter(d => d.data().mode === "b2c").length;
    const completedSessions = sessionSnap.docs.filter(d => d.data().status === "evaluated").length;

    const totalScores = scores.length;
    const avgScore = totalScores
      ? Math.round(scores.reduce((s, r) => s + ((r.stackScore as number) ?? 0), 0) / totalScores)
      : 0;

    const scoreDistribution: Record<string, number> = { "0-19": 0, "20-39": 0, "40-59": 0, "60-79": 0, "80-100": 0 };
    scores.forEach(r => {
      const s = (r.stackScore as number) ?? 0;
      if (s < 20) scoreDistribution["0-19"]++;
      else if (s < 40) scoreDistribution["20-39"]++;
      else if (s < 60) scoreDistribution["40-59"]++;
      else if (s < 80) scoreDistribution["60-79"]++;
      else scoreDistribution["80-100"]++;
    });

    const decisionBreakdown = { shortlist: 0, hold: 0, reject: 0, undecided: 0 };
    scores.forEach(r => {
      const d = r.decision as string | undefined;
      if (d === "shortlist") decisionBreakdown.shortlist++;
      else if (d === "hold") decisionBreakdown.hold++;
      else if (d === "reject") decisionBreakdown.reject++;
      else decisionBreakdown.undecided++;
    });

    const flaggedCount = scores.filter(r =>
      r.fastSubmit === true || ((r.tabSwitchCount as number) ?? 0) > 3
    ).length;

    const activePanelists = panelistSnap.docs.filter(d => d.data().active !== false).length;

    const totalCreditsUsed = creditsSnap.docs.reduce((sum, d) => sum + ((d.data().freeUsed as number) ?? 0), 0);
    const selfAssessUsed = selfAssessSnap.docs.reduce((sum, d) => sum + ((d.data().used as number) ?? 0), 0);

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentActivity = sessionSnap.docs.filter(d => {
      const ca = d.data().createdAt;
      if (!ca) return false;
      const ts = typeof ca.toDate === "function" ? ca.toDate().getTime() : 0;
      return ts >= sevenDaysAgo;
    }).length;

    return NextResponse.json({
      totalSessions, b2bSessions, b2cSessions, completedSessions,
      totalScores, avgScore, scoreDistribution, decisionBreakdown,
      flaggedCount, activePanelists, totalCreditsUsed, selfAssessUsed, recentActivity,
    });
  } catch (err) {
    logError("[admin/analytics]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
