export const metadata = {
  title: "StackScore Demo",
  description: "Watch a full 3-minute walkthrough of StackScore — the AI-judged engineering assessment platform.",
  openGraph: {
    title: "StackScore Demo",
    description: "Watch a full 3-minute walkthrough of StackScore — the AI-judged engineering assessment platform.",
    type: "video.other",
  },
};

const VIDEO_URL = "/demo.mp4";

export default function WatchPage() {
  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "3rem 1.5rem 5rem" }}>
      <style>{`
        .watch-hero { margin-bottom: 2rem; }
        .watch-hero h1 {
          font-size: clamp(1.6rem, 3.5vw, 2.4rem);
          font-weight: 800; letter-spacing: -.02em;
          margin: 0 0 .6rem; color: var(--fg);
        }
        .watch-hero p {
          font-size: 1rem; color: var(--text-muted);
          margin: 0; max-width: 600px;
        }
        .watch-player {
          width: 100%; border-radius: 14px; overflow: hidden;
          background: #000;
          box-shadow: 0 8px 48px rgba(0,0,0,.35);
          aspect-ratio: 16/10;
        }
        .watch-player video {
          width: 100%; height: 100%; display: block;
        }
        .watch-cta {
          margin-top: 2.5rem;
          display: flex; gap: 1rem; flex-wrap: wrap; align-items: center;
        }
        .watch-cta a {
          display: inline-flex; align-items: center; gap: .4rem;
          font-size: .9rem; font-weight: 700; padding: .55rem 1.3rem;
          border-radius: 8px; text-decoration: none; transition: opacity .15s;
        }
        .watch-cta a:hover { opacity: .82; text-decoration: none; }
        .btn-primary { background: var(--accent); color: #fff; }
        .btn-secondary {
          background: none; color: var(--accent);
          border: 1.5px solid var(--accent);
        }
        .watch-chapters {
          margin-top: 3rem;
          border-top: 1px solid var(--border);
          padding-top: 2rem;
        }
        .watch-chapters h2 {
          font-size: 1rem; font-weight: 700; text-transform: uppercase;
          letter-spacing: .08em; color: var(--text-muted); margin: 0 0 1.25rem;
        }
        .chapter-list {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: .75rem;
        }
        .chapter {
          display: flex; align-items: flex-start; gap: .75rem;
          padding: .75rem 1rem; border-radius: 10px;
          background: var(--surface); border: 1px solid var(--border);
        }
        .chapter-time {
          font-size: .78rem; font-weight: 700; color: var(--accent);
          font-variant-numeric: tabular-nums; white-space: nowrap; padding-top: 2px;
          font-family: "Fira Code", monospace;
        }
        .chapter-label { font-size: .84rem; font-weight: 600; color: var(--fg); margin: 0 0 .15rem; }
        .chapter-desc { font-size: .78rem; color: var(--text-muted); margin: 0; }
      `}</style>

      <div className="watch-hero">
        <h1>See StackScore in action</h1>
        <p>
          A 3-minute walkthrough — from assessment start through AI judging,
          provenance banners, scenario bank resilience, and the hiring dashboard.
        </p>
      </div>

      <div className="watch-player">
        <video
          controls
          autoPlay={false}
          preload="metadata"
          playsInline
          src={VIDEO_URL}
        />
      </div>

      <div className="watch-cta">
        <a href="/assessment" className="btn-primary" style={{ display:"inline-flex",alignItems:"center",gap:".4rem",fontSize:".9rem",fontWeight:700,padding:".55rem 1.3rem",borderRadius:"8px",textDecoration:"none",background:"var(--accent)",color:"#fff",transition:"opacity .15s" }}>
          Try it free →
        </a>
        <a href="/why" className="btn-secondary" style={{ display:"inline-flex",alignItems:"center",gap:".4rem",fontSize:".9rem",fontWeight:700,padding:".55rem 1.3rem",borderRadius:"8px",textDecoration:"none",background:"none",color:"var(--accent)",border:"1.5px solid var(--accent)",transition:"opacity .15s" }}>
          Why StackScore
        </a>
        <a
          href={VIDEO_URL}
          download="stackscore-demo.mp4"
          style={{ fontSize: ".82rem", color: "var(--text-muted)", marginLeft: ".25rem" }}
        >
          ↓ Download (.mp4)
        </a>
      </div>

      <div className="watch-chapters">
        <h2>What you'll see</h2>
        <div className="chapter-list">
          {[
            { t: "0:00", label: "Landing & value prop",      desc: "Eleven axes, role-calibrated, shareable score URL" },
            { t: "0:12", label: "Eleven-axis rubric",        desc: "Five design axes + six code axes, bias prevention" },
            { t: "0:44", label: "Assessment start",          desc: "Gemini 3.8 Flash generates a fresh brief per session" },
            { t: "0:52", label: "Clarify stage",             desc: "AI stakeholder Q&A, brief pinned in sidebar" },
            { t: "1:08", label: "Build stage",               desc: "In-browser Node.js sandbox, mobile brief banner" },
            { t: "1:16", label: "Score card",                desc: "Claude Opus 5.5 adaptive thinking, per-axis feedback" },
            { t: "1:26", label: "Provenance banners",        desc: "Green / amber / red — system never silently fails" },
            { t: "1:34", label: "Benchmarks",                desc: "Spearman ρ=1.000, Gemini cross-validation" },
            { t: "1:42", label: "Dashboard & reviewer",      desc: "Shortlist, Kanban, bias-free human review" },
            { t: "1:55", label: "Scenario bank",             desc: "4-tier generation chain, zero candidate-facing downtime" },
            { t: "2:08", label: "Compare & history",         desc: "Side-by-side radar, candidate trajectory" },
            { t: "2:16", label: "Closing",                   desc: "\"Not what they memorised. How they think.\"" },
          ].map(({ t, label, desc }) => (
            <div key={t} className="chapter">
              <span className="chapter-time">{t}</span>
              <div>
                <p className="chapter-label">{label}</p>
                <p className="chapter-desc">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
