import { notFound } from "next/navigation";
import { getScoreBySlug, getAllScores, isJudgedScore } from "../../../lib/firestore";
import { rubricDefinition } from "../../../lib/scoring";
import type { AxisScores } from "../../../lib/scoring";
import { grade } from "../../../lib/grade";
import { getSession } from "../../../lib/auth";
import { getCandidateSession } from "../../../lib/candidateAuth";
import PrintButton from "../../components/PrintButton";
import TranscriptViewer from "../../components/TranscriptViewer";
import RetryButton from "../../components/RetryButton";
import AttemptTrajectory from "../../components/AttemptTrajectory";
import ShareButtons from "../../components/ShareButtons";

export const dynamic = "force-dynamic";

// Pure-SVG radar chart - 11 axes: D1-D5 (pentagon) + K1-K6 (hexagon), interleaved.
// Layout: D1, K1, D2, K2, D3, K3, D4, K4, D5, K5, K6 - evenly spaced at 360/11°.
function RadarChart({ axisScores }: { axisScores: AxisScores }) {
  const SIZE = 300;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const R = 108;
  const LABEL_R = R + 20;

  const AXES = [
    { id: "D1", isDesign: true },
    { id: "K1", isDesign: false },
    { id: "D2", isDesign: true },
    { id: "K2", isDesign: false },
    { id: "D3", isDesign: true },
    { id: "K3", isDesign: false },
    { id: "D4", isDesign: true },
    { id: "K4", isDesign: false },
    { id: "D5", isDesign: true },
    { id: "K5", isDesign: false },
    { id: "K6", isDesign: false },
  ] as const;

  const N = AXES.length;
  const angle = (i: number) => (2 * Math.PI * i) / N - Math.PI / 2;

  const polar = (i: number, pct: number) => {
    const a = angle(i);
    const r = (pct / 100) * R;
    return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
  };

  const gridPoly = (pct: number) =>
    AXES.map((_, i) => {
      const { x, y } = polar(i, pct);
      return `${x},${y}`;
    }).join(" ");

  const polyPoints = (indices: number[]) =>
    indices
      .map((i) => {
        const { x, y } = polar(i, axisScores[AXES[i].id as keyof AxisScores] ?? 0);
        return `${x},${y}`;
      })
      .join(" ");

  const designIdx = [0, 2, 4, 6, 8];
  const codeIdx   = [1, 3, 5, 7, 9, 10];

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
      height={SIZE}
      aria-label="Radar chart of axis scores"
      style={{ overflow: "visible" }}
    >
      {/* Grid rings */}
      {[20, 40, 60, 80, 100].map((pct) => (
        <polygon key={pct} points={gridPoly(pct)}
          fill="none" stroke="var(--border)" strokeWidth={pct === 100 ? 1 : 0.5} strokeDasharray={pct === 100 ? "none" : "3,3"} />
      ))}
      {/* Grid scale labels on the vertical axis (D1 spoke) */}
      {[40, 70].map((pct) => {
        const { y } = polar(0, pct);
        return (
          <text key={pct} x={CX + 4} y={y} fontSize="8" fill="var(--text-muted)" dominantBaseline="middle">{pct}</text>
        );
      })}
      {/* Spoke lines */}
      {AXES.map((_, i) => {
        const { x, y } = polar(i, 100);
        return <line key={i} x1={CX} y1={CY} x2={x} y2={y} stroke="var(--border)" strokeWidth={0.5} />;
      })}
      {/* Design polygon */}
      <polygon points={polyPoints(designIdx)}
        fill="var(--design-color)" fillOpacity={0.18}
        stroke="var(--design-color)" strokeWidth={2} strokeLinejoin="round" />
      {/* Code polygon */}
      <polygon points={polyPoints(codeIdx)}
        fill="var(--code-color)" fillOpacity={0.18}
        stroke="var(--code-color)" strokeWidth={2} strokeLinejoin="round" />
      {/* Score dots */}
      {AXES.map((ax, i) => {
        const val = axisScores[ax.id as keyof AxisScores] ?? 0;
        const { x, y } = polar(i, val);
        const col = ax.isDesign ? "var(--design-color)" : "var(--code-color)";
        return <circle key={i} cx={x} cy={y} r={3.5} fill={col} />;
      })}
      {/* Axis labels */}
      {AXES.map((ax, i) => {
        const a = angle(i);
        const lx = CX + LABEL_R * Math.cos(a);
        const ly = CY + LABEL_R * Math.sin(a);
        const col = ax.isDesign ? "var(--design-color)" : "var(--code-color)";
        return (
          <text key={i} x={lx} y={ly} fontSize="10" fontWeight="700"
            textAnchor="middle" dominantBaseline="middle" fill={col}>
            {ax.id}
          </text>
        );
      })}
    </svg>
  );
}

export default async function ScoreCard({ params }: { params: { id: string } }) {
  const [doc, panSession, candSession] = await Promise.all([
    getScoreBySlug(params.id),
    getSession().catch(() => null),
    getCandidateSession().catch(() => null),
  ]);
  const isLoggedIn = !!(panSession || candSession);

  // notFound() rather than returning the markup inline: it renders not-found.tsx and, more
  // usefully, makes Next emit <meta name="robots" content="noindex"> so a dead score link
  // cannot be indexed.
  //
  // It does NOT make the response a 404, and in Next 14 it cannot. App Router streams
  // dynamically-rendered pages, so the 200 status line is flushed before this component
  // resolves; notFound() can still choose the body but the status is already committed.
  // Verified: removing the segment's loading.tsx and removing not-found.tsx both leave it
  // at 200, while an unmatched route like /totally/bogus still 404s correctly. So this is
  // the streaming boundary, not a missing not-found boundary.
  //
  // Consequences, honestly: crawlers are covered by the noindex, humans see the right page,
  // and the one thing still wrong is a programmatic client branching on res.ok, which would
  // read a missing score card as a present one. Nothing in this repo does that today.
  //
  // The real fix is to stop the page streaming before the lookup resolves: move the slow
  // peer-statistics work (getAllScores(500), for the percentile block) into a <Suspense>
  // child so the shell resolves immediately. Worth doing when the page is next touched.
  if (!doc) notFound();

  const axisScores = doc.axisScores as AxisScores;
  const feedback = doc.feedback as Record<string, string>;
  const { label: gradeLabel, color: gradeColor } = grade(doc.stackScore as number);
  // A held card carries zeroed axis scores purely so the record has a shape. Rendering them
  // would show a candidate a wall of zeros under a "this is on hold" banner, which is worse
  // than showing nothing -- people read the chart, not the banner.
  const judgeStatus = (doc.judgeStatus as string | undefined)
    ?? (doc.judgeFallback === true ? "pending_review" : "judged");
  const scoresAreHeld = judgeStatus === "pending_review";
  const dateStr = doc.createdAt?.toDate
    ? doc.createdAt.toDate().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : "";

  // Percentile + role-calibrated axis medians
  let percentile: number | null = null;
  let axisMedians: Record<string, number> | null = null;
  let benchmarkCount = 0;
  try {
    // Fallback cards are excluded from the peer set: a percentile computed against
    // unmeasured ~20s overstates every real candidate. See AUDIT_TODO D11.
    const allScores = (await getAllScores(500)).filter(isJudgedScore);
    const rolePeer = allScores.filter((s) => !doc.role || s.role === doc.role);
    const peer = rolePeer.length >= 20 ? rolePeer : allScores;
    benchmarkCount = peer.length;
    if (peer.length >= 3) {
      const below = peer.filter((s) => (s.stackScore as number) < (doc.stackScore as number)).length;
      percentile = Math.round((below / peer.length) * 100);

      // Compute median per axis across peers
      const axisKeys = ["D1","D2","D3","D4","D5","K1","K2","K3","K4","K5","K6"] as const;
      axisMedians = {} as Record<string, number>;
      for (const ax of axisKeys) {
        const vals = peer  // peer is already the correct filtered set
          .map((s) => ((s.axisScores as Record<string, number> | undefined)?.[ax] ?? null))
          .filter((v): v is number => v !== null)
          .sort((a, b) => a - b);
        if (vals.length >= 3) {
          const mid = Math.floor(vals.length / 2);
          axisMedians[ax] = vals.length % 2 === 0
            ? Math.round((vals[mid - 1] + vals[mid]) / 2)
            : vals[mid];
        }
      }
    }
  } catch { /* non-fatal */ }

  const candidateName = doc.candidateName as string | undefined;
  const pageTitle = candidateName ? `${candidateName} - StackScore` : `StackScore ${doc.stackScore}`;
  const pageDesc = `${gradeLabel} · Design ${(doc.levelScores as { design: number; code: number })?.design ?? "-"} · Code ${(doc.levelScores as { design: number; code: number })?.code ?? "-"}${doc.role ? ` · ${doc.role}` : ""}${percentile !== null ? ` · Top ${100 - percentile}%` : ""}`;

  return (
    <main className="score-card-page">
      {/* OG / social meta tags */}
      <title>{pageTitle}</title>
      <meta name="description" content={pageDesc} />
      <meta property="og:title" content={pageTitle} />
      <meta property="og:description" content={pageDesc} />
      <meta property="og:type" content="website" />
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:title" content={pageTitle} />
      <meta name="twitter:description" content={pageDesc} />
      <style>{`
        .score-card-page { max-width: 760px; margin: 0 auto; padding: 2.5rem 1.25rem 5rem; }
        .sc-header { text-align: center; margin-bottom: 2.5rem; }
        .sc-logo {
          display: inline-flex; align-items: center;
          margin-bottom: 1.5rem; text-decoration: none;
        }
        .sc-logo:hover { opacity: .85; text-decoration: none; }
        .sc-logo-pill {
          display: inline-flex; align-items: center;
          background: #fff; border-radius: 7px; padding: 4px 12px;
        }
        .sc-logo img { height: 30px; width: auto; display: block; }
        .sc-logo .logo-light { display: none; }
        @media (prefers-color-scheme: light) {
          :root:not([data-theme="dark"]) .sc-logo .logo-light { display: block; }
          :root:not([data-theme="dark"]) .sc-logo .logo-dark { display: none; }
        }
        :root[data-theme="light"] .sc-logo .logo-light { display: block; }
        :root[data-theme="light"] .sc-logo .logo-dark { display: none; }
        .sc-hero { margin: 0 auto 2.5rem; max-width: 400px; background: var(--surface);
          border: 1px solid var(--border); border-radius: 16px; padding: 2rem 2rem 1.5rem; text-align: center; }
        .sc-score-num { font-size: 5.5rem; font-weight: 800; line-height: 1;
          color: var(--score-gold); font-variant-numeric: tabular-nums; }
        .sc-grade { display: inline-block; margin: .4rem 0 1rem;
          padding: .3rem .9rem; border-radius: 999px; font-size: .82rem; font-weight: 700; }
        .sc-levels { display: flex; justify-content: center; gap: 2.5rem; }
        .sc-level { text-align: center; }
        .sc-level-val { display: block; font-size: 1.75rem; font-weight: 700; }
        .sc-level-label { font-size: .72rem; text-transform: uppercase; letter-spacing: .08em; color: var(--text-muted); }
        .sc-level-bar { height: 3px; border-radius: 999px; margin-top: .4rem; }
        .sc-meta { display: flex; flex-wrap: wrap; justify-content: center; gap: .5rem 1.5rem;
          margin-bottom: 2.5rem; font-size: .82rem; color: var(--text-muted); }
        .sc-meta span { display: flex; align-items: center; gap: .3rem; }
        .sc-brief { background: var(--surface); border-left: 3px solid var(--accent);
          border-radius: 0 10px 10px 0; padding: .9rem 1.1rem; margin-bottom: 2.5rem;
          font-size: .88rem; color: var(--text-muted); line-height: 1.65; }
        .sc-brief strong { display: block; font-size: .7rem; letter-spacing: .08em;
          text-transform: uppercase; color: var(--accent); margin-bottom: .4rem; }
        .sc-section { margin-bottom: 2rem; }
        .sc-section-heading { font-size: .72rem; font-weight: 700; letter-spacing: .1em;
          text-transform: uppercase; color: var(--text-muted); margin-bottom: 1rem;
          display: flex; align-items: center; gap: .5rem; }
        .sc-section-heading::after { content: ''; flex: 1; height: 1px; background: var(--border); }
        .sc-axis { margin-bottom: 1.1rem; }
        .sc-axis-row { display: flex; align-items: center; gap: .6rem; margin-bottom: .3rem; }
        .sc-axis-id { font-size: .72rem; font-weight: 700; min-width: 2rem; color: var(--text-muted); }
        .sc-axis-name { font-size: .88rem; font-weight: 600; flex: 1; }
        .sc-axis-score { font-size: .95rem; font-weight: 700; min-width: 2.5rem; text-align: right;
          font-variant-numeric: tabular-nums; }
        .sc-axis-desc { font-size: .77rem; color: var(--text-muted); margin: .15rem 0 .4rem 2.6rem;
          line-height: 1.5; font-style: italic; }
        .sc-bar-track { background: var(--bar-bg); border-radius: 999px; height: 6px; overflow: hidden; }
        .sc-bar-fill { height: 100%; border-radius: 999px; transition: width .4s ease; }
        .sc-feedback { font-size: .82rem; color: var(--fg); margin: .45rem 0 0 2.6rem;
          line-height: 1.6; padding: .5rem .75rem; background: var(--surface);
          border-left: 2px solid var(--border); border-radius: 0 6px 6px 0; }
        .sc-radar-wrap { display: flex; flex-direction: column; align-items: center;
          margin: 0 auto 2.5rem; }
        .sc-radar-legend { display: flex; gap: 1.5rem; margin-top: .75rem; }
        .sc-radar-legend-item { display: flex; align-items: center; gap: .4rem;
          font-size: .75rem; font-weight: 600; }
        .sc-radar-legend-dot { width: 10px; height: 10px; border-radius: 50%; }
        .sc-footer { text-align: center; margin-top: 3rem; padding-top: 2rem; border-top: 1px solid var(--border); }
        .sc-footer p { font-size: .85rem; color: var(--text-muted); margin-bottom: 1rem; }
        .sc-cta { display: inline-block; background: var(--accent); color: #fff;
          padding: .7rem 1.8rem; border-radius: 10px; font-weight: 600; text-decoration: none;
          transition: background .15s; }
        .sc-cta:hover { background: var(--accent-hover); }
        .sc-print-btn { display: inline-flex; align-items: center; gap: .4rem;
          border: 1px solid var(--border); border-radius: 8px; padding: .4rem .9rem;
          background: var(--surface); color: var(--text-muted); font-size: .78rem;
          font-weight: 600; cursor: pointer; text-decoration: none; }
        .sc-print-btn:hover { border-color: var(--accent); color: var(--accent); }
        @media print {
          .sc-header, .sc-footer, .sc-print-btn, nav, .global-controls { display: none !important; }
          .score-card-page { padding: 0; max-width: 100%; }
          .sc-hero { border: 1px solid #ddd; }
          .sc-bar-track { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .sc-bar-fill { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          a[href]::after { content: none !important; }
        }
        @media(max-width:500px){
          .sc-score-num{font-size:4rem}
          .sc-levels{gap:1.5rem}
        }
      `}</style>

      <div className="sc-header">
        <a href="/" className="sc-logo">
          <div className="sc-logo-pill">
            <img src="/logo-brand.png" alt="StackScore" className="logo-dark" />
            <img src="/logo-brand-light.png" alt="StackScore" className="logo-light" />
          </div>
        </a>
      </div>

      {/* Provenance banner (A3). Above the number, not beside it: a reader who has seen
          the figure has already drawn the conclusion. */}
      {judgeStatus === "partial" && (
        <div
          role="alert"
          style={{
            margin: "0 0 20px", padding: "14px 16px", borderRadius: 10,
            background: "rgba(168,136,0,0.12)", border: "1px solid #a80",
            color: "#ffd9a3", fontSize: 14, lineHeight: 1.5,
          }}
        >
          <strong style={{ display: "block", marginBottom: 4 }}>
            Partially judged \u2014 subject to change.
          </strong>
          The calibrated judge was unavailable, so this was scored by a reduced pass. These
          are real model scores, but they were not produced against the anchored rubric and
          are not comparable to a normal StackScore. A full re-judge is queued; this page
          will update when it completes.
        </div>
      )}
      {judgeStatus === "pending_review" && (
        <div
          role="alert"
          style={{
            margin: "0 0 20px", padding: "14px 16px", borderRadius: 10,
            background: "rgba(163,51,51,0.12)", border: "1px solid #a33",
            color: "#ffb3b3", fontSize: 14, lineHeight: 1.5,
          }}
        >
          <strong style={{ display: "block", marginBottom: 4 }}>
            On hold for human verification.
          </strong>
          The AI judge could not evaluate this submission, so no score has been produced.
          It has been queued for a human reviewer and this page will show the result once
          the review is complete. Nothing here should be read as a score.
        </div>
      )}
      {judgeStatus === "reviewed" && (
        <div
          style={{
            margin: "0 0 20px", padding: "14px 16px", borderRadius: 10,
            background: "rgba(62,207,142,0.1)", border: "1px solid #3ecf8e",
            color: "#b7f0d6", fontSize: 14, lineHeight: 1.5,
          }}
        >
          <strong style={{ display: "block", marginBottom: 4 }}>Human reviewed.</strong>
          The AI judge could not score this submission, so it was assessed by a human
          reviewer against the same rubric.
        </div>
      )}

      {/* Hero score */}
      <div className="sc-hero">
        <div className="sc-score-num">{scoresAreHeld ? "—" : doc.stackScore}</div>
        {!scoresAreHeld && (
          <div className="sc-grade" style={{ background: `${gradeColor}22`, color: gradeColor }}>
            {gradeLabel}
          </div>
        )}
        {!scoresAreHeld && (
        <div className="sc-levels">
          <div className="sc-level">
            <span className="sc-level-val" style={{ color: "var(--design-color)" }}>
              {(doc.levelScores as { design: number; code: number })?.design ?? "-"}
            </span>
            <span className="sc-level-label">Design</span>
            <div className="sc-level-bar" style={{ background: "var(--design-color)", width: `${(doc.levelScores as { design: number; code: number })?.design ?? 0}%`, maxWidth: "100%" }} />
          </div>
          <div className="sc-level">
            <span className="sc-level-val" style={{ color: "var(--code-color)" }}>
              {(doc.levelScores as { design: number; code: number })?.code ?? "-"}
            </span>
            <span className="sc-level-label">Code</span>
            <div className="sc-level-bar" style={{ background: "var(--code-color)", width: `${(doc.levelScores as { design: number; code: number })?.code ?? 0}%`, maxWidth: "100%" }} />
          </div>
        </div>
        )}
      </div>

      {/* Radar chart. Suppressed when held: eleven zeroed axes draw a collapsed shape that
          reads as "scored terribly" rather than "not scored yet", and the picture carries
          further than the banner above it. */}
      {!scoresAreHeld && (
      <div className="sc-radar-wrap">
        <RadarChart axisScores={axisScores} />
        <div className="sc-radar-legend">
          <div className="sc-radar-legend-item" style={{ color: "var(--design-color)" }}>
            <div className="sc-radar-legend-dot" style={{ background: "var(--design-color)" }} />
            Design (D1–D5)
          </div>
          <div className="sc-radar-legend-item" style={{ color: "var(--code-color)" }}>
            <div className="sc-radar-legend-dot" style={{ background: "var(--code-color)" }} />
            Code (K1–K6)
          </div>
        </div>
      </div>
      )}

      {/* Meta */}
      <div className="sc-meta">
        {candidateName && <span style={{ fontWeight: 700, color: "var(--fg)" }}>👤 {candidateName}</span>}
        {doc.rowLabel && doc.columnLabel && (
          <span>🎯 {doc.rowLabel as string} × {doc.columnLabel as string}</span>
        )}
        {doc.role && <span>🏷 {doc.role as string}</span>}
        {percentile !== null && (
          <span style={{ fontWeight: 700, color: gradeColor }} title={`Compared to ${doc.role ?? "all"} candidates in StackScore`}>
            Top {100 - percentile}%
            {benchmarkCount > 0 && (
              <span style={{ fontSize: ".7rem", color: "var(--text-muted)", marginLeft: ".35rem", fontWeight: 400 }}>
                (based on {benchmarkCount} assessments
                {benchmarkCount < 100 ? " · benchmark building" : benchmarkCount < 500 ? " · growing" : " · established"})
              </span>
            )}
          </span>
        )}
        {dateStr && <span>📅 {dateStr}</span>}
        {doc.fastSubmit && (
          <span
            title={`Design submitted unusually quickly (stages: ${(doc.fastSubmitStages as string[] | undefined)?.join(", ") ?? "unknown"}). May warrant manual review.`}
            style={{ color: "#f5a623", fontWeight: 700 }}
          >
            ⚡ Fast submission flagged
          </span>
        )}
      </div>

      {/* Brief */}
      {doc.brief && (
        <div className="sc-brief">
          <strong>Problem brief</strong>
          {doc.brief as string}
        </div>
      )}

      {/* Executive summary */}
      {doc.summary && (
        <div className="sc-section">
          <div className="sc-section-heading">Executive summary</div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.1rem 1.25rem", fontSize: ".88rem", lineHeight: 1.75, color: "var(--fg)" }}>
            {(doc.summary as string).split("\n\n").map((para, i) => (
              <p key={i} style={{ margin: i === 0 ? 0 : ".9rem 0 0" }}>{para}</p>
            ))}
          </div>
        </div>
      )}

      {/* Axis breakdown */}
      {rubricDefinition.levels.map((level) => (
        <div key={level.id} className="sc-section">
          <div className="sc-section-heading">
            {level.label}
            <span style={{ fontSize: ".7rem", fontWeight: 400 }}>({Math.round(level.weight * 100)}% of score)</span>
          </div>
          {level.axes.map((axis) => {
            const val = axisScores[axis.id as keyof AxisScores] ?? 0;
            const barColor = level.id === "design" ? "var(--design-color)" : "var(--code-color)";
            const scoreColor = val >= 70 ? "var(--code-color)" : val >= 40 ? "var(--score-gold)" : "#f56b6b";
            return (
              <div key={axis.id} className="sc-axis">
                <div className="sc-axis-row">
                  <span className="sc-axis-id">{axis.id}</span>
                  <span className="sc-axis-name">{axis.label}</span>
                  <span className="sc-axis-score" style={{ color: scoreColor }}>{val}</span>
                </div>
                <p className="sc-axis-desc">{axis.description}</p>
                <div className="sc-bar-track" style={{ position: "relative" }}>
                  <div className="sc-bar-fill" style={{ width: `${val}%`, background: barColor }} />
                  {axisMedians?.[axis.id] != null && (
                    <div title={`${doc.role ?? "All"} median: ${axisMedians[axis.id]}`} style={{ position: "absolute", top: 0, bottom: 0, left: `${axisMedians[axis.id]}%`, width: 2, background: "var(--text-muted)", opacity: 0.5 }} />
                  )}
                </div>
                {axisMedians?.[axis.id] != null && (
                  <div style={{ fontSize: ".68rem", color: "var(--text-muted)", marginLeft: "2.6rem", marginTop: ".2rem" }}>
                    {doc.role ?? "All-level"} median: {axisMedians[axis.id]}
                    {val > axisMedians[axis.id] ? " ↑ above" : val < axisMedians[axis.id] ? " ↓ below" : " = at median"}
                  </div>
                )}
                {feedback[axis.id] && (
                  <p className="sc-feedback">
                    <span style={{ display: "block", fontSize: ".68rem", fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: ".2rem" }}>
                      Judge&apos;s assessment
                    </span>
                    {feedback[axis.id]}
                    {(doc.evidence as Record<string, string> | undefined)?.[axis.id] && (
                      <span style={{ display: "block", marginTop: ".35rem", fontSize: ".76rem", color: "var(--text-muted)", fontStyle: "italic", borderTop: "1px solid var(--border)", paddingTop: ".3rem" }}>
                        <span style={{ fontStyle: "normal", fontWeight: 700, fontSize: ".66rem", letterSpacing: ".06em", textTransform: "uppercase" }}>Key evidence: </span>
                        &ldquo;{(doc.evidence as Record<string, string>)[axis.id]}&rdquo;
                      </span>
                    )}
                  </p>
                )}
                {val < 60 && (doc.tips as Record<string, string> | undefined)?.[axis.id] && (
                  <div style={{ margin: ".4rem 0 0 2.6rem", fontSize: ".8rem", background: "#f5a62311", border: "1px solid #f5a62333", borderRadius: 8, padding: ".5rem .75rem", color: "var(--fg)" }}>
                    <span style={{ display: "block", fontSize: ".68rem", fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "#f5a623", marginBottom: ".2rem" }}>
                      💡 How to improve
                    </span>
                    {(doc.tips as Record<string, string>)[axis.id]}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {/* Multi-attempt trajectory - shown when candidate has prior attempts by same email */}
      {doc.candidateEmail && <AttemptTrajectory candidateEmail={doc.candidateEmail as string} />}

      {/* Full transcript viewer */}
      {doc.sessionId && <TranscriptViewer sessionId={doc.sessionId as string} />}

      {/* Scoring audit log - thinking trace */}
      {doc.thinkingLog && (
        <details style={{ marginBottom: "2rem" }}>
          <summary style={{ cursor: "pointer", fontSize: ".78rem", fontWeight: 700, color: "var(--text-muted)", letterSpacing: ".07em", textTransform: "uppercase", userSelect: "none" }}>
            🔎 Scoring audit log (judge's reasoning)
          </summary>
          <pre style={{ marginTop: ".75rem", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "1rem", fontSize: ".73rem", lineHeight: 1.6, color: "var(--text-muted)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 480, overflowY: "auto" }}>
            {doc.thinkingLog as string}
          </pre>
        </details>
      )}

      {/* Benchmark validity note */}
      <div className="sc-validity-note" style={{ marginBottom: "2rem", fontSize: ".72rem", color: "var(--text-muted)", lineHeight: 1.6, padding: ".75rem 1rem", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10 }}>
        StackScore benchmarks are updated continuously as more assessments are completed.{" "}
        <a href="/why#validity" style={{ color: "var(--accent)", textDecoration: "none" }}>How scores are validated →</a>
      </div>

      {/* Verifiable credential share widget */}
      <div style={{
        margin: "2rem 0", padding: "1.25rem 1.5rem", background: "var(--surface)",
        border: "1px solid var(--border)", borderRadius: 12,
        display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap",
      }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: ".75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--accent)", marginBottom: ".3rem" }}>
            ✓ Verified Score
          </div>
          <div style={{ fontSize: ".83rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
            Share this link with employers or HR teams - they can verify this score is authentic at <strong style={{ color: "var(--fg)" }}>/api/verify/{params.id}</strong>
          </div>
        </div>
        <ShareButtons slug={params.id} />
      </div>

      <div className="sc-footer">
        <p>AI-judged across 11 axes - Design D1–D5 (55%) + Code K1–K6 (45%) - using Claude Opus with adaptive thinking.</p>
        {doc.reEvaluatedAt && (
          <p style={{ fontSize: ".75rem", color: "var(--text-muted)", marginTop: "-.5rem" }}>
            Re-evaluated: {new Date(doc.reEvaluatedAt as string).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
          </p>
        )}
        <div style={{ display: "flex", gap: ".75rem", justifyContent: "center", flexWrap: "wrap" }}>
          <a href="/assessment" className="sc-cta">Take your own assessment →</a>
          <RetryButton slug={params.id} />
          <PrintButton />
        </div>
        {!isLoggedIn && (
          <p style={{ fontSize: ".78rem", color: "var(--text-muted)", marginTop: "1.25rem" }}>
            <a href="/login" style={{ color: "var(--accent)", fontWeight: 600 }}>Sign in</a>
            {" "}to track your scores over time and see your improvement trajectory.
          </p>
        )}
      </div>
    </main>
  );
}
