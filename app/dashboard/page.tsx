import { getAllScores, isJudgedScore } from "../../lib/firestore";
import DashboardTable from "../components/DashboardTable";
import PendingFeedbackBanner from "../components/PendingFeedbackBanner";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Dashboard({
  searchParams,
}: {
  searchParams: { threshold?: string; role?: string };
}) {
  const threshold = Number(searchParams.threshold ?? 55);
  const roleFilter = searchParams.role ?? "";

  let scores: Awaited<ReturnType<typeof getAllScores>> = [];
  try {
    scores = await getAllScores(200);
  } catch {
    /* Firestore unavailable - show empty state */
  }

  // Serialize Firestore Timestamp/class instances to plain objects for Client Component
  const serialize = (s: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(s).map(([k, v]) => {
        if (v && typeof v === "object" && typeof (v as { toDate?: unknown }).toDate === "function")
          return [k, (v as { toDate: () => Date }).toDate().toISOString()];
        return [k, v];
      })
    );

  const filtered = scores.filter((s) => {
    if (roleFilter && s.role !== roleFilter) return false;
    return true;
  }).map(serialize);

  // Rows stay listed -- a panelist needs to see that a submission failed to score -- but
  // they are kept out of the headline stats, which would otherwise read a judge outage as a
  // cohort of weak candidates. See AUDIT_TODO D11.
  const judged = filtered.filter(isJudgedScore);
  const fallbackCount = filtered.length - judged.length;
  const passing = judged.filter((s) => (s.stackScore as number) >= threshold);
  const avg = judged.length
    ? Math.round(judged.reduce((acc, s) => acc + (s.stackScore as number), 0) / judged.length)
    : 0;

  // 90-day feedback: hired 85-180 days ago with no outcomeFeedback
  const pendingFeedback = scores.map(serialize).filter((s) => {
    if (s.decision !== "shortlist" || s.outcomeFeedback) return false;
    if (!s.hiredAt) return false;
    const daysAgo = (Date.now() - new Date(s.hiredAt as string).getTime()) / (1000 * 60 * 60 * 24);
    return daysAgo >= 85 && daysAgo <= 180;
  }).map((s) => ({
    docId: s.docId as string,
    candidateName: s.candidateName as string | undefined,
    stackScore: s.stackScore as number | undefined,
    role: s.role as string | undefined,
    hiredAt: s.hiredAt as string | undefined,
  }));

  return (
    <main className="dashboard-page">
      <style>{`
        .dashboard-page { max-width: 1080px; margin: 0 auto; padding: 2rem 1.25rem 5rem; }
        .db-header { display: flex; align-items: center; justify-content: space-between;
          flex-wrap: wrap; gap: 1rem; margin-bottom: 2rem; }
        .db-title { font-size: 1.4rem; font-weight: 700; margin: 0; }
        .db-stats { display: flex; flex-wrap: wrap; gap: .75rem; margin-bottom: 2rem; }
        .stat-card { flex: 1; min-width: 120px; background: var(--surface);
          border: 1px solid var(--border); border-radius: 12px; padding: 1rem 1.25rem; }
        .stat-val { font-size: 2rem; font-weight: 800; line-height: 1; }
        .stat-lbl { font-size: .72rem; text-transform: uppercase; letter-spacing: .08em;
          color: var(--text-muted); margin-top: .3rem; }
        .db-filters { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center;
          margin-bottom: 1.5rem; font-size: .85rem; }
        .db-filters label { color: var(--text-muted); }
        .db-filters select, .db-filters input { background: var(--surface); border: 1px solid var(--border);
          color: inherit; border-radius: 6px; padding: .3rem .6rem; font-size: .85rem; }
        @media(max-width:600px) {
          .db-title{font-size:1.1rem}
          .stat-val{font-size:1.5rem}
        }
      `}</style>

      <div className="db-header">
        <div>
          <h1 className="db-title">Panel Dashboard</h1>
        </div>
        <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
          <a
            href={`/api/export-csv?${new URLSearchParams({ ...(roleFilter ? { role: roleFilter } : {}) }).toString()}`}
            style={{ background: "var(--surface)", color: "var(--text-muted)", padding: ".55rem 1.1rem", borderRadius: 8, fontWeight: 600, fontSize: ".85rem", textDecoration: "none", border: "1px solid var(--border)" }}
          >
            ↓ Export CSV
          </a>
          <a href="/dashboard/kanban" style={{ background: "var(--surface)", color: "var(--text-muted)", padding: ".55rem 1.1rem", borderRadius: 8, fontWeight: 600, fontSize: ".85rem", textDecoration: "none", border: "1px solid var(--border)" }}>
            ⊞ Kanban
          </a>
          <a href="/assessment" style={{ background: "var(--accent)", color: "#fff", padding: ".55rem 1.25rem", borderRadius: 8, fontWeight: 600, fontSize: ".85rem", textDecoration: "none" }}>
            + New assessment
          </a>
        </div>
      </div>

      {/* 90-day pending feedback */}
      {pendingFeedback.length > 0 && <PendingFeedbackBanner items={pendingFeedback} />}

      {/* Stats row */}
      <div className="db-stats">
        <div className="stat-card">
          <div className="stat-val">{filtered.length}</div>
          <div className="stat-lbl">Total candidates</div>
        </div>
        <div className="stat-card">
          <div className="stat-val" style={{ color: "#3ecf8e" }}>{passing.length}</div>
          <div className="stat-lbl">Passing ≥ {threshold}</div>
        </div>
        <div className="stat-card">
          <div className="stat-val" style={{ color: "var(--score-gold)" }}>{avg || "-"}</div>
          <div className="stat-lbl">Average score</div>
        </div>
        <div className="stat-card">
          <div className="stat-val">
            {judged.length ? Math.round((passing.length / judged.length) * 100) : 0}%
          </div>
          <div className="stat-lbl">Pass rate</div>
        </div>
      </div>

      {fallbackCount > 0 && (
        <div
          role="alert"
          style={{
            margin: "0 0 20px", padding: "12px 14px", borderRadius: 10,
            background: "rgba(163,51,51,0.12)", border: "1px solid #a33",
            color: "#ffb3b3", fontSize: 13, lineHeight: 1.5,
          }}
        >
          <strong>
            {fallbackCount} submission{fallbackCount === 1 ? "" : "s"} could not be scored by
            the AI judge
          </strong>{" "}
          and {fallbackCount === 1 ? "carries a" : "carry"} placeholder value. They are listed
          below but excluded from the statistics above. Re-run their evaluations — and if this
          count is climbing, the judge is down.
        </div>
      )}

      {/* Filters */}
      <form className="db-filters" method="GET">
        <label htmlFor="threshold-input">Pass threshold:</label>
        <input id="threshold-input" type="number" name="threshold" defaultValue={threshold} min={0} max={100} style={{ width: 60 }} />
        <label htmlFor="role-select">Role:</label>
        <select id="role-select" name="role" defaultValue={roleFilter}>
          <option value="">All roles</option>
          <option value="Junior">Junior</option>
          <option value="Mid">Mid</option>
          <option value="Senior">Senior</option>
        </select>
        <button type="submit" style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 6, padding: ".3rem .8rem", cursor: "pointer", fontWeight: 600 }}>Apply</button>
      </form>

      <DashboardTable rows={filtered} threshold={threshold} />

      {/* Panelist management moved to /admin — granting panelist access is an admin
          action, not something any panelist may do to any other. */}
    </main>
  );
}
