import { getAllScores } from "../../lib/firestore";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[m - 1] + s[m]) / 2) : s[m];
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * s.length);
  return s[Math.min(idx, s.length - 1)];
}

export default async function BenchmarksPage() {
  let scores: Awaited<ReturnType<typeof getAllScores>> = [];
  try {
    scores = await getAllScores(500);
  } catch { /* non-fatal */ }

  const total = scores.length;
  const updatedAt = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  // Group by role
  const roles = ["Junior", "Mid", "Senior", "Staff"] as const;
  type RoleStats = { role: string; count: number; median: number; p25: number; p75: number; dist: number[] };
  const roleStats: RoleStats[] = [];

  for (const role of roles) {
    const group = scores.filter((s) => s.role === role).map((s) => s.stackScore as number).filter(Boolean);
    if (group.length >= 10) {
      // Histogram buckets: 0-19, 20-39, 40-59, 60-79, 80-100
      const dist = [0, 20, 40, 60, 80].map((lo) => group.filter((v) => v >= lo && v < lo + 20).length);
      roleStats.push({ role, count: group.length, median: median(group), p25: percentile(group, 25), p75: percentile(group, 75), dist });
    }
  }

  // Overall distribution
  const allVals = scores.map((s) => s.stackScore as number).filter(Boolean);
  const overallDist = [0, 20, 40, 60, 80].map((lo) => allVals.filter((v) => v >= lo && v < lo + 20).length);
  const maxDist = Math.max(...overallDist, 1);

  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "2.5rem 1.25rem 5rem" }}>
      <style>{`
        .bm-title { font-size: 1.5rem; font-weight: 800; margin: 0 0 .4rem; }
        .bm-sub { font-size: .9rem; color: var(--text-muted); margin: 0 0 2.5rem; }
        .bm-updated { font-size: .72rem; color: var(--text-muted); }
        .bm-section { margin-bottom: 2.5rem; }
        .bm-section-title { font-size: .72rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase;
          color: var(--text-muted); margin-bottom: 1.1rem; display: flex; align-items: center; gap: .5rem; }
        .bm-section-title::after { content: ''; flex: 1; height: 1px; background: var(--border); }
        .bm-stat-row { display: flex; flex-wrap: wrap; gap: .75rem; margin-bottom: 1.5rem; }
        .bm-stat { flex: 1; min-width: 120px; background: var(--surface); border: 1px solid var(--border);
          border-radius: 12px; padding: 1rem 1.25rem; }
        .bm-stat-val { font-size: 2rem; font-weight: 800; line-height: 1; }
        .bm-stat-lbl { font-size: .72rem; text-transform: uppercase; letter-spacing: .07em; color: var(--text-muted); margin-top: .3rem; }
        .bm-hist { display: flex; gap: .5rem; align-items: flex-end; height: 80px; margin-bottom: .4rem; }
        .bm-bar-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; gap: .2rem; }
        .bm-bar { width: 100%; background: var(--accent); border-radius: 4px 4px 0 0; min-height: 2px; opacity: .75; }
        .bm-bar-label { font-size: .62rem; color: var(--text-muted); }
        .bm-role-table { width: 100%; border-collapse: collapse; }
        .bm-role-table th { font-size: .68rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
          color: var(--text-muted); padding: .5rem .75rem; text-align: left; border-bottom: 1px solid var(--border); }
        .bm-role-table td { padding: .6rem .75rem; font-size: .88rem; border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent); }
        .bm-range-track { height: 8px; background: var(--border); border-radius: 4px; position: relative; min-width: 100px; }
        .bm-range-fill { position: absolute; top: 0; bottom: 0; background: var(--accent); border-radius: 4px; opacity: .7; }
        .bm-range-median { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--accent); border-radius: 1px; }
        .bm-note { font-size: .78rem; color: var(--text-muted); background: var(--surface); border: 1px solid var(--border);
          border-radius: 10px; padding: .9rem 1.1rem; line-height: 1.65; margin-bottom: 2rem; }
      `}</style>

      <h1 className="bm-title">StackScore Benchmarks</h1>
      <p className="bm-sub">
        Aggregate performance data across all StackScore assessments.{" "}
        <span className="bm-updated">Last updated: {updatedAt}</span>
      </p>

      <div className="bm-note">
        Benchmarks shown for roles with ≥ 10 assessments. Ranges will narrow as more data is collected.
        All data is anonymised and aggregated — no individual candidates are identified.
      </div>

      {/* Overview stats */}
      <div className="bm-section">
        <div className="bm-section-title">Overview</div>
        <div className="bm-stat-row">
          <div className="bm-stat">
            <div className="bm-stat-val">{total}</div>
            <div className="bm-stat-lbl">Assessments completed</div>
          </div>
          {allVals.length > 0 && (
            <div className="bm-stat">
              <div className="bm-stat-val" style={{ color: "var(--score-gold)" }}>{median(allVals)}</div>
              <div className="bm-stat-lbl">Median StackScore</div>
            </div>
          )}
          {roleStats.length > 0 && (
            <div className="bm-stat">
              <div className="bm-stat-val">{roleStats.length}</div>
              <div className="bm-stat-lbl">Roles with data</div>
            </div>
          )}
        </div>

        {/* Score distribution histogram */}
        {allVals.length > 0 && (
          <div>
            <div style={{ fontSize: ".75rem", color: "var(--text-muted)", marginBottom: ".5rem", fontWeight: 600 }}>Score distribution (all roles)</div>
            <div className="bm-hist">
              {overallDist.map((count, i) => (
                <div key={i} className="bm-bar-wrap">
                  <div style={{ fontSize: ".7rem", color: "var(--text-muted)" }}>{count}</div>
                  <div className="bm-bar" style={{ height: `${Math.max(4, (count / maxDist) * 60)}px` }} />
                  <div className="bm-bar-label">{i * 20}–{i * 20 + 19}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Per-role table */}
      {roleStats.length > 0 && (
        <div className="bm-section">
          <div className="bm-section-title">By role</div>
          <table className="bm-role-table">
            <thead>
              <tr>
                <th>Role</th>
                <th>Assessments</th>
                <th>Median</th>
                <th>P25–P75 range</th>
              </tr>
            </thead>
            <tbody>
              {roleStats.map((rs) => (
                <tr key={rs.role}>
                  <td style={{ fontWeight: 700 }}>{rs.role}</td>
                  <td>{rs.count}</td>
                  <td style={{ fontWeight: 700, color: "var(--score-gold)" }}>{rs.median}</td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
                      <div className="bm-range-track" style={{ flex: 1 }}>
                        <div
                          className="bm-range-fill"
                          style={{
                            left: `${rs.p25}%`,
                            right: `${100 - rs.p75}%`,
                          }}
                        />
                        <div className="bm-range-median" style={{ left: `${rs.median}%` }} />
                      </div>
                      <span style={{ fontSize: ".78rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                        {rs.p25}–{rs.p75}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total === 0 && (
        <div style={{ textAlign: "center", padding: "3rem 0", color: "var(--text-muted)" }}>
          <p>No assessment data yet. Benchmarks will appear once assessments are completed.</p>
        </div>
      )}

      <div style={{ marginTop: "2.5rem", textAlign: "center" }}>
        <a href="/assessment" style={{ background: "var(--accent)", color: "#fff", padding: ".65rem 1.6rem", borderRadius: 10, fontWeight: 700, textDecoration: "none", fontSize: ".9rem" }}>
          Take your assessment →
        </a>
      </div>
    </main>
  );
}
