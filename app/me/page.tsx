"use client";
import { useState, useEffect } from "react";

interface ScoreRow {
  docId: string;
  publicSlug?: string;
  stackScore?: number;
  levelScores?: { design: number; code: number };
  role?: string;
  rowLabel?: string;
  columnLabel?: string;
  createdAt?: { _seconds: number };
}

interface TrajectoryPoint { date: string; stackScore: number; design: number; code: number; scoreCardUrl: string; }

function TrendChart({ points }: { points: TrajectoryPoint[] }) {
  if (points.length < 2) return null;
  const W = 420, H = 80, PAD = 12;
  const scores = points.map((p) => p.stackScore);
  const min = Math.min(...scores, 0);
  const max = Math.max(...scores, 100);
  const range = max - min || 1;
  const x = (i: number) => PAD + ((W - PAD * 2) * i) / (points.length - 1);
  const y = (v: number) => H - PAD - ((v - min) / range) * (H - PAD * 2);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.stackScore).toFixed(1)}`).join(" ");
  const area = `${path} L${x(points.length - 1).toFixed(1)},${H - PAD} L${PAD},${H - PAD} Z`;
  return (
    <div style={{ margin: "1.5rem 0", overflowX: "auto" }}>
      <div style={{ fontSize: ".72rem", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: ".5rem" }}>Score trajectory</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: "block" }}>
        <path d={area} fill="var(--accent)" fillOpacity={0.1} />
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.stackScore)} r={4} fill="var(--accent)" />
            <text x={x(i)} y={y(p.stackScore) - 8} textAnchor="middle" fontSize={9} fill="var(--text-muted)">{p.stackScore}</text>
            <text x={x(i)} y={H - 2} textAnchor="middle" fontSize={8} fill="var(--text-muted)">{p.date}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function fmt(ts?: { _seconds: number }) {
  if (!ts) return "-";
  return new Date(ts._seconds * 1000).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

function ScoreBar({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
      <div style={{ flex: 1, height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${value}%`, height: "100%", background: color, borderRadius: 3, transition: "width .4s" }} />
      </div>
      <span style={{ fontSize: ".8rem", fontWeight: 700, minWidth: 24, textAlign: "right" }}>{value}</span>
    </div>
  );
}

interface CandidateSession { authenticated: boolean; email?: string; name?: string; }

export default function MePage() {
  const [email, setEmail] = useState("");
  const [inputEmail, setInputEmail] = useState("");
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [trajectory, setTrajectory] = useState<TrajectoryPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [session, setSession] = useState<CandidateSession | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);

  // Check cookie session first, then fall back to localStorage
  useEffect(() => {
    fetch("/api/auth/candidate-me")
      .then(r => r.ok ? r.json() : null)
      .then((d: CandidateSession | null) => {
        setSession(d);
        setSessionChecked(true);
        if (d?.email) {
          setInputEmail(d.email);
        } else {
          try {
            const saved = localStorage.getItem("ss_candidate");
            if (saved) {
              const { email: e } = JSON.parse(saved);
              if (e) setInputEmail(e);
            }
          } catch { /* ignore */ }
        }
      });
  }, []);

  /**
   * Loads the signed-in candidate's own history. The email is no longer sent as a query
   * parameter — the API derives it from the session cookie, so one candidate cannot read
   * another's scores by typing their address.
   */
  async function lookup(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true); setError(""); setLoaded(false);
    try {
      const [histRes, trajRes] = await Promise.all([
        fetch("/api/candidate/history"),
        fetch("/api/trajectory"),
      ]);
      if (histRes.status === 401) {
        setError("Sign in to see your assessment history.");
        return;
      }
      const d = await histRes.json();
      if (!histRes.ok) throw new Error(d.error ?? "failed");
      setScores(d.scores ?? []);
      const tj = await trajRes.json().catch(() => ({ attempts: [] }));
      setTrajectory(tj.attempts ?? []);
      setEmail(session?.email ?? "");
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load history.");
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/candidate-logout", { method: "POST" });
    setSession(null);
    setLoaded(false);
    setScores([]);
    setTrajectory([]);
    setInputEmail("");
    setEmail("");
    try { localStorage.removeItem("ss_candidate"); } catch { /* ignore */ }
    window.location.href = "/login";
  }

  // Auto-lookup when session provides email and we haven't loaded yet
  useEffect(() => {
    if (sessionChecked && session?.email && !loaded && !loading) {
      lookup();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionChecked]);

  const best = scores.length > 0 ? Math.max(...scores.map((s) => s.stackScore ?? 0)) : null;
  const trend = scores.length >= 2
    ? (scores[0].stackScore ?? 0) - (scores[scores.length - 1].stackScore ?? 0)
    : null;

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "2.5rem 1.25rem 4rem" }}>
      <style>{`
        .me-title { font-size: 1.5rem; font-weight: 800; margin: 0 0 .35rem; }
        .me-sub { font-size: .9rem; color: var(--text-muted); margin: 0 0 2rem; }
        .me-form { display: flex; gap: .6rem; margin-bottom: 2.5rem; flex-wrap: wrap; }
        .me-input {
          flex: 1; min-width: 220px; padding: .6rem .9rem; border-radius: 9px; font-size: .95rem;
          border: 1.5px solid var(--border); background: var(--bg); color: var(--fg);
          outline: none; transition: border-color .15s;
        }
        .me-input:focus { border-color: var(--accent); }
        .me-btn {
          padding: .6rem 1.4rem; border-radius: 9px; font-size: .95rem; font-weight: 700;
          background: var(--accent); color: #fff; border: none; cursor: pointer; white-space: nowrap;
        }
        .me-btn:disabled { opacity: .55; cursor: not-allowed; }
        .me-err { color: #ff6666; font-size: .84rem; margin-bottom: 1.25rem; }
        .me-stats { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 2rem; }
        .me-stat { background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
          padding: .9rem 1.25rem; flex: 1; min-width: 120px; }
        .me-stat-val { font-size: 1.75rem; font-weight: 800; line-height: 1; }
        .me-stat-lbl { font-size: .72rem; text-transform: uppercase; letter-spacing: .07em;
          color: var(--text-muted); margin-top: .25rem; }
        .me-card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
          padding: 1.25rem 1.5rem; margin-bottom: .9rem; }
        .me-card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; }
        .me-card-score { font-size: 2.2rem; font-weight: 800; line-height: 1; }
        .me-card-meta { font-size: .78rem; color: var(--text-muted); margin-top: .25rem; }
        .me-card-link { font-size: .82rem; font-weight: 600; color: var(--accent); text-decoration: none; }
        .me-card-link:hover { text-decoration: underline; }
        .me-bars { margin-top: .75rem; display: grid; grid-template-columns: 60px 1fr; gap: .3rem .6rem; align-items: center; }
        .me-bar-lbl { font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; color: var(--text-muted); }
        .me-empty { text-align: center; padding: 3rem 0; color: var(--text-muted); font-size: .95rem; }
        .trend-up { color: #3ecf8e; }
        .trend-down { color: #ef4444; }
        .trend-flat { color: var(--text-muted); }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem", marginBottom: ".35rem" }}>
        <h1 className="me-title" style={{ margin: 0 }}>My StackScore History</h1>
        {session?.authenticated ? (
          <div style={{ display: "flex", alignItems: "center", gap: ".75rem" }}>
            <span style={{ fontSize: ".8rem", color: "var(--text-muted)" }}>{session.name ?? session.email}</span>
            <button onClick={logout} style={{ fontSize: ".78rem", color: "var(--text-muted)", background: "none", border: "1px solid var(--border)", borderRadius: 6, padding: ".25rem .6rem", cursor: "pointer" }}>
              Sign out
            </button>
          </div>
        ) : (
          <a href="/login" style={{ fontSize: ".82rem", color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>
            Sign in to track scores →
          </a>
        )}
      </div>
      <p className="me-sub">{session?.authenticated ? `Showing assessments for ${session.email}.` : "Sign in to see the scores for your email address."}</p>

      {/* Scores are personal data, so they are read from the signed-in session rather
          than looked up by typing an arbitrary email address. */}
      {!session?.authenticated && (
        <div className="me-empty">
          <p>Your score history is private to your account.</p>
          <p style={{ marginTop: ".5rem" }}>
            <a href="/login?type=candidate" style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>
              Sign in with the email you used for your assessment →
            </a>
          </p>
        </div>
      )}

      {error && <p className="me-err">{error}</p>}

      {loaded && (
        <>
          {scores.length === 0 ? (
            <div className="me-empty">
              <p>No assessments found for <strong>{email}</strong>.</p>
              <p style={{ marginTop: ".5rem" }}>
                Make sure you used the same email when starting the assessment.
              </p>
              <a href="/assessment" style={{ color: "var(--accent)", fontWeight: 700 }}>Take an assessment →</a>
            </div>
          ) : (
            <>
              <div className="me-stats">
                <div className="me-stat">
                  <div className="me-stat-val">{scores.length}</div>
                  <div className="me-stat-lbl">Assessments</div>
                </div>
                {best !== null && (
                  <div className="me-stat">
                    <div className="me-stat-val" style={{ color: "var(--score-gold, #f59e0b)" }}>{best}</div>
                    <div className="me-stat-lbl">Best score</div>
                  </div>
                )}
                {trend !== null && (
                  <div className="me-stat">
                    <div className={`me-stat-val ${trend > 0 ? "trend-up" : trend < 0 ? "trend-down" : "trend-flat"}`}>
                      {trend > 0 ? `+${trend}` : trend === 0 ? "-" : trend}
                    </div>
                    <div className="me-stat-lbl">Improvement</div>
                  </div>
                )}
              </div>

              <TrendChart points={trajectory} />

              {scores.map((s) => (
                <div key={s.docId} className="me-card">
                  <div className="me-card-top">
                    <div>
                      <div className="me-card-score">{s.stackScore ?? "-"}</div>
                      <div className="me-card-meta">
                        {[s.role, s.rowLabel, s.columnLabel].filter(Boolean).join(" · ")}
                        {" · "}
                        {fmt(s.createdAt)}
                      </div>
                    </div>
                    {s.publicSlug && (
                      <a href={`/score/${s.publicSlug}`} className="me-card-link" target="_blank" rel="noopener">
                        View score card ↗
                      </a>
                    )}
                  </div>
                  {s.levelScores && (
                    <div className="me-bars">
                      <span className="me-bar-lbl">Design</span>
                      <ScoreBar value={s.levelScores.design} color="var(--design-color, #6c63ff)" />
                      <span className="me-bar-lbl">Code</span>
                      <ScoreBar value={s.levelScores.code} color="var(--code-color, #22d3ee)" />
                    </div>
                  )}
                </div>
              ))}

              <p style={{ fontSize: ".78rem", color: "var(--text-muted)", marginTop: "1.5rem", textAlign: "center" }}>
                Showing up to 20 most recent assessments.
              </p>
            </>
          )}
        </>
      )}
    </main>
  );
}
