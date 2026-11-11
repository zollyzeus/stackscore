import { getScoreBySlug } from "../../lib/firestore";
import type { AxisScores } from "../../lib/scoring";

export const dynamic = "force-dynamic";

function grade(score: number) {
  if (score >= 85) return { label: "Exceptional", color: "#3ecf8e" };
  if (score >= 70) return { label: "Strong", color: "#6c63ff" };
  if (score >= 55) return { label: "Proficient", color: "#5b8aff" };
  if (score >= 40) return { label: "Developing", color: "#f5a623" };
  return { label: "Needs Work", color: "#f56b6b" };
}

const CANDIDATE_COLORS = ["#6c63ff", "#3ecf8e", "#f5a623"] as const;

function OverlaidRadar({ candidates }: {
  candidates: Array<{ name: string; axisScores: AxisScores; color: string }>
}) {
  const SIZE = 320;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const R = 110;
  const LABEL_R = R + 22;

  const AXES = ["D1","K1","D2","K2","D3","K3","D4","K4","D5","K5","K6"] as const;
  const N = AXES.length;
  const angle = (i: number) => (2 * Math.PI * i) / N - Math.PI / 2;
  const polar = (i: number, pct: number) => {
    const a = angle(i);
    const r = (pct / 100) * R;
    return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
  };
  const gridPoly = (pct: number) =>
    AXES.map((_, i) => { const { x, y } = polar(i, pct); return `${x},${y}`; }).join(" ");
  const polyPoints = (axisScores: AxisScores) =>
    AXES.map((id, i) => { const { x, y } = polar(i, axisScores[id as keyof AxisScores] ?? 0); return `${x},${y}`; }).join(" ");

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} style={{ overflow: "visible" }}>
      {[20, 40, 60, 80, 100].map((pct) => (
        <polygon key={pct} points={gridPoly(pct)} fill="none" stroke="var(--border)" strokeWidth={pct === 100 ? 1 : 0.5} strokeDasharray={pct === 100 ? undefined : "3,3"} />
      ))}
      {[40, 70].map((pct) => {
        const { y } = polar(0, pct);
        return <text key={pct} x={CX + 4} y={y} fontSize="8" fill="var(--text-muted)" dominantBaseline="middle">{pct}</text>;
      })}
      {AXES.map((_, i) => { const { x, y } = polar(i, 100); return <line key={i} x1={CX} y1={CY} x2={x} y2={y} stroke="var(--border)" strokeWidth={0.5} />; })}
      {candidates.map((c) => (
        <polygon key={c.color} points={polyPoints(c.axisScores)} fill={c.color} fillOpacity={0.12} stroke={c.color} strokeWidth={2} strokeLinejoin="round" />
      ))}
      {candidates.map((c) =>
        AXES.map((id, i) => {
          const val = c.axisScores[id as keyof AxisScores] ?? 0;
          const { x, y } = polar(i, val);
          return <circle key={`${c.color}-${id}`} cx={x} cy={y} r={3} fill={c.color} />;
        })
      )}
      {AXES.map((id, i) => {
        const a = angle(i);
        const lx = CX + LABEL_R * Math.cos(a);
        const ly = CY + LABEL_R * Math.sin(a);
        return <text key={id} x={lx} y={ly} fontSize="10" fontWeight="700" textAnchor="middle" dominantBaseline="middle" fill="var(--text-muted)">{id}</text>;
      })}
    </svg>
  );
}

export default async function ComparePage({ searchParams }: { searchParams: { slugs?: string } }) {
  const slugList = (searchParams.slugs ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 3);

  if (!slugList.length) {
    return (
      <main style={{ maxWidth: 640, margin: "5rem auto", padding: "0 1.5rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: ".75rem" }}>Candidate comparison</h1>
        <p style={{ color: "var(--text-muted)" }}>Select 2–3 candidates from the dashboard to compare them here.<br />URL format: <code>/compare?slugs=slug1,slug2,slug3</code></p>
        <a href="/dashboard" style={{ display: "inline-block", marginTop: "1.5rem", background: "var(--accent)", color: "#fff", padding: ".6rem 1.4rem", borderRadius: 8, fontWeight: 600, textDecoration: "none" }}>← Back to dashboard</a>
      </main>
    );
  }

  const docs = (await Promise.all(slugList.map((slug) => getScoreBySlug(slug).catch(() => null)))).filter(Boolean) as Record<string, unknown>[];

  if (!docs.length) {
    return <main style={{ maxWidth: 640, margin: "5rem auto", padding: "0 1.5rem", textAlign: "center" }}><h1>No candidates found</h1><a href="/dashboard">← Dashboard</a></main>;
  }

  const candidates = docs.map((doc, idx) => ({
    name: (doc.candidateName as string | undefined) ?? `Candidate ${idx + 1}`,
    slug: doc.publicSlug as string,
    axisScores: doc.axisScores as AxisScores,
    stackScore: doc.stackScore as number,
    levelScores: doc.levelScores as { design: number; code: number } | undefined,
    role: doc.role as string | undefined,
    decision: doc.decision as string | undefined,
    color: CANDIDATE_COLORS[idx % CANDIDATE_COLORS.length],
  }));

  const AXES = ["D1","D2","D3","D4","D5","K1","K2","K3","K4","K5","K6"] as const;

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "2.5rem 1.25rem 5rem" }}>
      <style>{`
        .cmp-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2rem; }
        .cmp-title { font-size: 1.3rem; font-weight: 700; margin: 0; }
        .cmp-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2.5rem; }
        .cmp-card { background: var(--surface); border: 2px solid; border-radius: 14px; padding: 1.25rem; text-align: center; }
        .cmp-card-name { font-size: .9rem; font-weight: 700; margin-bottom: .25rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .cmp-card-score { font-size: 3rem; font-weight: 800; line-height: 1; color: var(--score-gold); }
        .cmp-card-meta { font-size: .75rem; color: var(--text-muted); margin-top: .4rem; }
        .cmp-radar-row { display: flex; align-items: center; justify-content: center; margin-bottom: 2.5rem; flex-wrap: wrap; gap: 1rem; }
        .cmp-legend { display: flex; flex-wrap: wrap; gap: .75rem; justify-content: center; margin-top: .75rem; }
        .cmp-legend-item { display: flex; align-items: center; gap: .4rem; font-size: .78rem; font-weight: 600; }
        .cmp-legend-dot { width: 10px; height: 10px; border-radius: 50%; }
        .cmp-axis-table { width: 100%; border-collapse: collapse; font-size: .82rem; border-radius: 10px; overflow: hidden; border: 1px solid var(--border); }
        .cmp-axis-table th { text-align: left; font-size: .7rem; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--text-muted); padding: .5rem .9rem; background: var(--surface); border-bottom: 1px solid var(--border); }
        .cmp-axis-table td { padding: .55rem .9rem; border-bottom: 1px solid var(--border); }
        .cmp-axis-table tr:last-child td { border-bottom: none; }
        .cmp-bar-track { background: var(--bar-bg, #2a2a3a); border-radius: 999px; height: 5px; min-width: 60px; }
        .cmp-bar-fill { height: 100%; border-radius: 999px; }
      `}</style>

      <div className="cmp-header">
        <div>
          <h1 className="cmp-title">Side-by-side comparison</h1>
        </div>
        <a href="/dashboard" style={{ fontSize: ".82rem", color: "var(--text-muted)", textDecoration: "none" }}>← Dashboard</a>
      </div>

      {/* Score cards */}
      <div className="cmp-cards">
        {candidates.map((c) => {
          const { label: gradeLabel } = grade(c.stackScore);
          return (
            <div key={c.slug} className="cmp-card" style={{ borderColor: c.color }}>
              <div className="cmp-card-name" title={c.name} style={{ color: c.color }}>{c.name}</div>
              <div className="cmp-card-score">{c.stackScore}</div>
              <div className="cmp-card-meta">{gradeLabel}{c.role ? ` · ${c.role}` : ""}</div>
              {c.levelScores && (
                <div style={{ display: "flex", justifyContent: "center", gap: "1rem", marginTop: ".5rem", fontSize: ".75rem" }}>
                  <span style={{ color: "var(--design-color)" }}>Design {c.levelScores.design}</span>
                  <span style={{ color: "var(--code-color)" }}>Code {c.levelScores.code}</span>
                </div>
              )}
              {c.decision && (
                <div style={{ marginTop: ".4rem", fontSize: ".72rem", fontWeight: 700, color: c.decision === "shortlist" ? "#3ecf8e" : c.decision === "reject" ? "#f56b6b" : "#f5a623", textTransform: "capitalize" }}>{c.decision}</div>
              )}
              <a href={`/score/${c.slug}`} style={{ display: "inline-block", marginTop: ".6rem", fontSize: ".75rem", color: "var(--text-muted)", textDecoration: "none" }}>View score card →</a>
            </div>
          );
        })}
      </div>

      {/* Overlaid radar */}
      <div className="cmp-radar-row">
        <div>
          <OverlaidRadar candidates={candidates} />
          <div className="cmp-legend">
            {candidates.map((c) => (
              <div key={c.slug} className="cmp-legend-item" style={{ color: c.color }}>
                <div className="cmp-legend-dot" style={{ background: c.color }} />
                {c.name}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Axis-by-axis table */}
      <div style={{ marginBottom: "1rem", fontSize: ".72rem", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Axis breakdown</div>
      <div style={{ overflowX: "auto" }}>
        <table className="cmp-axis-table">
          <thead>
            <tr>
              <th>Axis</th>
              {candidates.map((c) => (
                <th key={c.slug} style={{ color: c.color }}>{c.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {AXES.map((id) => {
              const vals = candidates.map((c) => c.axisScores[id as keyof AxisScores] ?? 0);
              const max = Math.max(...vals);
              return (
                <tr key={id}>
                  <td style={{ fontWeight: 700, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{id}</td>
                  {candidates.map((c, i) => {
                    const val = vals[i];
                    const isTop = val === max && vals.filter((v) => v === max).length === 1;
                    return (
                      <td key={c.slug}>
                        <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
                          <span style={{ fontWeight: isTop ? 800 : 400, color: isTop ? c.color : "inherit", minWidth: 28 }}>{val}</span>
                          <div className="cmp-bar-track" style={{ flex: 1 }}>
                            <div className="cmp-bar-fill" style={{ width: `${val}%`, background: c.color }} />
                          </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
