"use client";
import { useState, useEffect, useRef } from "react";

const STAGES = [
  { id: "01", label: "Clarify", time: "5 min", desc: "Interview the stakeholder AI. What's the actual problem behind the brief?" },
  { id: "02", label: "Propose", time: "10 min", desc: "Design your architecture and justify every tradeoff in writing." },
  { id: "03", label: "Build", time: "20 min", desc: "Write the core logic. A constraint twist is about to drop." },
  { id: "04", label: "Adapt", time: "10 min", desc: "New constraint injected mid-flight. Pivot without losing your design." },
  { id: "05", label: "Debug", time: "15 min", desc: "Find and fix a seeded defect in your own submission." },
];

const AXES = [
  { id: "D1", label: "Requirement Framing",         level: "Design", desc: "Separates ambiguity from intent before a single line is designed." },
  { id: "D2", label: "Architecture & Components",   level: "Design", desc: "Chooses the right services, boundaries, and interactions for the problem." },
  { id: "D3", label: "Tradeoff Reasoning",           level: "Design", desc: "Articulates why one approach beats another - not just what was chosen." },
  { id: "D4", label: "Constraint Satisfaction",      level: "Design", desc: "Proves the design actually solves the brief's stated constraints." },
  { id: "D5", label: "Adaptability",                 level: "Design", desc: "Recovers cleanly when scope or requirements shift mid-assessment." },
  { id: "K1", label: "Design-Code Alignment",        level: "Code",   desc: "The implementation matches what was proposed - not a quietly different system." },
  { id: "K2", label: "Correctness & Edge Cases",     level: "Code",   desc: "Handles the happy path and the cases most engineers silently skip." },
  { id: "K3", label: "Code Quality",                 level: "Code",   desc: "Readable, idiomatic, and structured for someone else to maintain." },
  { id: "K4", label: "Security & Defensive Coding",  level: "Code",   desc: "Anticipates abuse cases and inputs that break naive implementations." },
  { id: "K5", label: "Testing & Observability",      level: "Code",   desc: "Written to be verified and operated in production, not just to run once." },
  { id: "K6", label: "AI Collaboration Quality",     level: "Code",   desc: "Prompts effectively, verifies AI output, and knows when not to trust it." },
];

const COMPARE = [
  { label: "Scores system design & architecture", ss: true,  hr: false, co: false },
  { label: "5-stage conversational assessment",   ss: true,  hr: false, co: false },
  { label: "Mid-task constraint twist",           ss: true,  hr: false, co: false },
  { label: "AI Collaboration axis (K6)",          ss: true,  hr: false, co: false },
  { label: "AI-generated executive summary",      ss: true,  hr: false, co: false },
  { label: "Panelist Kanban pipeline",            ss: true,  hr: true,  co: false },
  { label: "Per-candidate role benchmarks",       ss: true,  hr: false, co: true  },
  { label: "Verbatim score evidence per axis",    ss: true,  hr: false, co: false },
  { label: "Coding IDE / running tests",          ss: false, hr: true,  co: true  },
  { label: "Pre-built question library",          ss: false, hr: true,  co: true  },
];

export default function Home() {
  const [tab, setTab] = useState<"individual" | "panelist">("individual");
  const lpRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Reveal on scroll
    const els = lpRef.current?.querySelectorAll<HTMLElement>(".reveal");
    if (!els) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
        });
      },
      { threshold: 0.1 }
    );
    els.forEach((el) => io.observe(el));

    // Parallax: shift decorative layer on each section by scroll offset
    let raf = 0;
    function onScroll() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        document.querySelectorAll<HTMLElement>("[data-parallax]").forEach((el) => {
          const rect = el.getBoundingClientRect();
          const speed = parseFloat(el.dataset.parallax || "0.18");
          const offset = (rect.top + rect.height / 2 - window.innerHeight / 2) * speed;
          el.style.transform = `translateY(${offset}px)`;
        });
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => { io.disconnect(); window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);

  // Alternating section backgrounds
  const SECTION_COLORS = [
    "var(--bg)",                                           // hero
    "var(--surface)",                                      // stages
    "color-mix(in srgb, var(--accent) 6%, var(--bg))",    // axes
    "var(--surface)",                                      // score
    "var(--bg)",                                           // compare
    "color-mix(in srgb, var(--accent) 5%, var(--bg))",    // panel
  ];
  // Row colors within stages/axes (no parallax, just alternating stripes)
  const ROW_ALT = ["transparent", "color-mix(in srgb, var(--border) 25%, transparent)"];

  return (
    <main style={{ padding: 0, maxWidth: "none" }}>
      <style>{`
        * { box-sizing: border-box; }
        .lp { font-family: "Inter", system-ui, sans-serif; overflow-x: hidden; }

        /* ── Reveal ── */
        .reveal {
          opacity: 0; transform: translateY(22px);
          transition: opacity .58s cubic-bezier(.22,1,.36,1), transform .58s cubic-bezier(.22,1,.36,1);
          transition-delay: var(--d, 0ms);
        }
        .reveal.in { opacity: 1; transform: none; }

        /* ── Hero ── */
        .lp-hero {
          min-height: 88vh; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          text-align: center; padding: 4rem 1.25rem 5rem;
          position: relative; overflow: hidden; background: var(--bg);
        }
        .lp-hero::before {
          content: ""; position: absolute;
          width: 760px; height: 520px; top: 50%; left: 50%;
          transform: translate(-50%, -58%);
          background: radial-gradient(ellipse at center,
            color-mix(in srgb, var(--accent) 13%, transparent) 0%, transparent 68%);
          pointer-events: none;
          animation: glow-pulse 6s ease-in-out infinite;
        }
        @keyframes glow-pulse {
          0%,100% { opacity: .7; transform: translate(-50%,-58%) scale(1); }
          50%      { opacity: 1;  transform: translate(-50%,-58%) scale(1.1); }
        }
        .lp-hero-inner { position: relative; max-width: 780px; }
        .lp-eyebrow {
          display: inline-block; font-size: .68rem; font-weight: 700; letter-spacing: .18em;
          text-transform: uppercase; color: var(--accent);
          border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
          background: color-mix(in srgb, var(--accent) 8%, transparent);
          border-radius: 999px; padding: .28rem .9rem; margin-bottom: 1.5rem;
        }
        .lp-headline {
          font-size: clamp(2.1rem, 5.5vw, 3.4rem); font-weight: 800; line-height: 1.12;
          letter-spacing: -.03em; margin: 0 0 1.25rem; text-wrap: balance;
        }
        .lp-headline em { font-style: normal; color: var(--accent); display: block; }
        .lp-sub {
          font-size: clamp(.95rem, 2.2vw, 1.08rem); color: var(--text-muted);
          line-height: 1.7; max-width: 560px; margin: 0 auto 2.5rem;
        }
        .lp-sub strong { color: var(--text); font-weight: 600; }
        .lp-scroll-cue {
          position: absolute; bottom: 2rem; left: 50%; transform: translateX(-50%);
          display: flex; flex-direction: column; align-items: center; gap: .4rem;
          font-size: .65rem; letter-spacing: .12em; text-transform: uppercase;
          color: var(--text-muted); opacity: .45;
          animation: bounce-cue 2.4s ease-in-out infinite;
        }
        @keyframes bounce-cue {
          0%,100% { transform: translateX(-50%) translateY(0); }
          50%      { transform: translateX(-50%) translateY(5px); }
        }

        /* CTA */
        .lp-tab-row { display: flex; gap: .5rem; justify-content: center; margin-bottom: 1.5rem; }
        .lp-tab { padding: .45rem 1.2rem; border-radius: 999px; font-size: .88rem; font-weight: 600;
          cursor: pointer; border: 1.5px solid var(--border); background: none; color: var(--text-muted);
          transition: all .18s; }
        .lp-tab.active { border-color: var(--accent); background: var(--accent); color: #fff; }
        .lp-cta-block { display: flex; flex-wrap: wrap; justify-content: center; gap: .75rem; }
        .btn-primary { background: var(--accent); color: #fff; padding: .8rem 2.1rem;
          border-radius: 10px; font-weight: 700; font-size: 1rem; text-decoration: none;
          transition: opacity .15s, transform .15s; display: inline-block; }
        .btn-primary:hover { opacity: .88; color: #fff; transform: translateY(-2px); }
        .btn-ghost { border: 1.5px solid var(--border); color: var(--text-muted); padding: .78rem 1.7rem;
          border-radius: 10px; font-weight: 600; font-size: 1rem; text-decoration: none;
          transition: border-color .15s, color .15s, transform .15s; display: inline-block; }
        .btn-ghost:hover { border-color: var(--accent); color: var(--accent); transform: translateY(-2px); }

        /* ── Parallax section band ── */
        .lp-section {
          position: relative; overflow: hidden;
        }
        /* The parallax bg layer — oversized vertically, shifted by JS */
        .lp-section-bg {
          position: absolute; inset: -20% 0; z-index: 0;
          will-change: transform;
        }
        .lp-section-inner {
          position: relative; z-index: 1;
          max-width: 820px; margin: 0 auto;
          padding: 4rem max(1.5rem, env(safe-area-inset-left,0px));
        }

        /* Section label header */
        .lp-section-header {
          display: flex; align-items: center; gap: 1rem; margin-bottom: 2rem;
        }
        .lp-section-header-line { flex: 1; height: 1px; background: var(--border); opacity: .4; }
        .lp-section-label {
          font-size: .65rem; font-weight: 700; letter-spacing: .18em;
          text-transform: uppercase; color: var(--text-muted); white-space: nowrap;
        }

        /* Row items inside sections (alternating stripes, no parallax) */
        .lp-row {
          display: flex; gap: 1.5rem; align-items: flex-start;
          padding: 1.1rem 1rem; border-radius: 8px;
        }
        .row-badge {
          flex-shrink: 0; min-width: 3rem;
          display: flex; flex-direction: column; align-items: center; gap: .3rem;
        }
        .row-badge-id {
          font-size: .68rem; font-weight: 800; letter-spacing: .04em;
          border-radius: 7px; padding: .28rem .58rem; border: 1.5px solid; white-space: nowrap;
        }
        .row-badge-id.accent { color: var(--accent); border-color: color-mix(in srgb,var(--accent) 40%,transparent); background: color-mix(in srgb,var(--accent) 8%,transparent); }
        .row-badge-id.design { color: var(--design-color); border-color: color-mix(in srgb,var(--design-color) 40%,transparent); background: color-mix(in srgb,var(--design-color) 8%,transparent); }
        .row-badge-id.code   { color: var(--code-color);   border-color: color-mix(in srgb,var(--code-color)   40%,transparent); background: color-mix(in srgb,var(--code-color)   8%,transparent); }
        .row-badge-time { font-size: .62rem; color: var(--text-muted); }
        .row-body { flex: 1; min-width: 0; }
        .row-body h3 { font-size: .95rem; font-weight: 700; margin: 0 0 .25rem; color: var(--text); }
        .row-body p  { font-size: .83rem; margin: 0; color: var(--text-muted); line-height: 1.65; }

        /* ── Score preview row ── */
        .score-row-wrap {
          max-width: 820px; margin: 0 auto;
          padding: 3.5rem max(1.5rem, env(safe-area-inset-left,0px));
          display: flex; gap: 3rem; align-items: center; flex-wrap: wrap;
        }
        .score-row-copy { flex: 1; min-width: 200px; }
        .score-row-copy h2 { font-size: clamp(1.3rem,3vw,1.7rem); font-weight: 800; margin: 0 0 .75rem; }
        .score-row-copy p { font-size: .88rem; color: var(--text-muted); line-height: 1.75; margin: 0; }
        .lp-score-card {
          flex-shrink: 0; width: 260px;
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 18px; padding: 1.75rem 2rem; text-align: center;
          box-shadow: 0 16px 48px rgba(0,0,0,.2);
          animation: float-card 5s ease-in-out infinite;
        }
        @keyframes float-card {
          0%,100% { transform: translateY(0); }
          50%      { transform: translateY(-7px); }
        }
        .lp-score-num { font-size: 4.5rem; font-weight: 800; color: var(--score-gold); line-height: 1; }
        .lp-score-grade {
          display: inline-block; margin: .4rem 0 1rem;
          padding: .28rem .85rem; border-radius: 999px; font-size: .78rem; font-weight: 700;
          background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent);
        }
        .lp-score-levels { display: flex; justify-content: center; gap: 2rem; margin-bottom: .4rem; }
        .lp-lv-val { display: block; font-size: 1.5rem; font-weight: 700; }
        .lp-lv-lbl { font-size: .62rem; text-transform: uppercase; letter-spacing: .08em; color: var(--text-muted); }
        .lp-k6-row {
          margin-top: .75rem; padding-top: .75rem; border-top: 1px solid var(--border);
          font-size: .75rem; display: flex; align-items: center; justify-content: center; gap: .45rem;
        }
        .lp-k6-badge {
          background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent);
          font-size: .65rem; font-weight: 700; padding: .1rem .45rem; border-radius: 4px;
        }

        /* ── Compare table ── */
        .cmp-wrap { max-width: 820px; margin: 0 auto; padding: 1.5rem max(1.5rem, env(safe-area-inset-left,0px)) 3.5rem; overflow-x: auto; }
        .cmp-tbl { width: 100%; border-collapse: collapse; font-size: .83rem; }
        .cmp-tbl th {
          font-size: .65rem; font-weight: 700; letter-spacing: .09em; text-transform: uppercase;
          color: var(--text-muted); padding: .7rem .9rem; text-align: center;
          border-bottom: 1.5px solid var(--border);
        }
        .cmp-tbl th:first-child { text-align: left; }
        .cmp-tbl td { padding: .6rem .9rem; border-bottom: 1px solid var(--border); vertical-align: middle; }
        .cmp-tbl tr:last-child td { border-bottom: none; }
        .cmp-tbl tbody tr { transition: background .1s; }
        .cmp-tbl tbody tr:hover td { background: color-mix(in srgb, var(--accent) 4%, transparent); }
        .cmp-feat { font-size: .82rem; color: var(--text); }
        .cmp-check { text-align: center; }
        .cmp-tbl th.ss-col { color: var(--accent); }

        /* ── Panel CTA ── */
        .lp-panel-wrap {
          max-width: 820px; margin: 0 auto;
          padding: 4rem max(1.5rem, env(safe-area-inset-left,0px));
          text-align: center;
        }
        .lp-panel-wrap h2 { font-size: clamp(1.5rem,3.5vw,2rem); font-weight: 800; margin-bottom: .85rem; }
        .lp-panel-wrap p { max-width: 440px; margin: 0 auto 2rem; color: var(--text-muted); font-size: .92rem; line-height: 1.7; }
        .panel-features {
          display: flex; flex-wrap: wrap; justify-content: center; gap: .4rem 1.1rem;
          margin-bottom: 2.25rem; font-size: .82rem; color: var(--text-muted);
        }
        .panel-features span::before { content: "✓ "; color: var(--accent); font-weight: 700; }

        @media(max-width:640px){
          .lp-cta-block { flex-direction: column; align-items: center; }
          .btn-primary, .btn-ghost { width: 100%; text-align: center; }
          .lp-hero { min-height: 72vh; }
          .score-row-wrap { flex-direction: column; align-items: center; }
          .lp-score-card { width: 100%; max-width: 280px; }
        }
        @media(max-width:480px){
          .row-badge-time { display: none; }
          .lp-row-content { gap: 1.25rem; }
        }
      `}</style>

      <div className="lp" ref={lpRef}>

        {/* ── Hero ── */}
        <section className="lp-hero">
          <div className="lp-hero-inner">
            <div className="lp-eyebrow reveal" style={{ "--d": "0ms" } as React.CSSProperties}>AI-powered engineering assessment</div>
            <h1 className="lp-headline reveal" style={{ "--d": "80ms" } as React.CSSProperties}>
              Other apps tell you if they can code.
              <em>StackScore tells you<br />if they can think.</em>
            </h1>
            <p className="lp-sub reveal" style={{ "--d": "160ms" } as React.CSSProperties}>
              A 60-minute, AI-driven solutioning assessment across <strong>5 stages and 11 axes</strong>.
              Tests requirement framing, system design, adaptability and AI collaboration -
              not just whether they can reverse a linked list.
            </p>
            <div className="lp-tab-row reveal" style={{ "--d": "220ms" } as React.CSSProperties}>
              <button className={`lp-tab${tab === "individual" ? " active" : ""}`} onClick={() => setTab("individual")}>
                I&apos;m a candidate
              </button>
              <button className={`lp-tab${tab === "panelist" ? " active" : ""}`} onClick={() => setTab("panelist")}>
                I&apos;m hiring
              </button>
            </div>
            <div className="lp-cta-block reveal" style={{ "--d": "280ms" } as React.CSSProperties}>
              {tab === "individual" ? (
                <>
                  <a href="/demo" className="btn-primary">Try a live demo →</a>
                  <a href="/assessment" className="btn-ghost">Start real assessment</a>
                </>
              ) : (
                <>
                  <a href="/panel" className="btn-primary">Create assessment link →</a>
                  <a href="/dashboard" className="btn-ghost">Open panel dashboard</a>
                </>
              )}
            </div>
          </div>
          <div className="lp-scroll-cue" aria-hidden="true">
            scroll
            <svg width="12" height="18" viewBox="0 0 12 18" fill="none">
              <path d="M6 1v10M2 7l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </section>

        {/* ── Stages section (one parallax band) ── */}
        <div className="lp-section reveal" style={{ background: SECTION_COLORS[1] } as React.CSSProperties}>
          <div className="lp-section-bg" data-parallax="0.16" style={{ background: SECTION_COLORS[1] }} />
          <div className="lp-section-inner">
            <div className="lp-section-header">
              <div className="lp-section-header-line" />
              <span className="lp-section-label">The 5-stage assessment</span>
              <div className="lp-section-header-line" />
            </div>
            {STAGES.map((s, i) => (
              <div key={s.id} className="lp-row" style={{ background: ROW_ALT[i % 2] } as React.CSSProperties}>
                <div className="row-badge">
                  <span className="row-badge-id accent">{s.id}</span>
                  <span className="row-badge-time">{s.time}</span>
                </div>
                <div className="row-body">
                  <h3>{s.label}</h3>
                  <p>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Axes section (one parallax band) ── */}
        <div className="lp-section reveal" style={{ background: SECTION_COLORS[2] } as React.CSSProperties}>
          <div className="lp-section-bg" data-parallax="0.14" style={{ background: SECTION_COLORS[2] }} />
          <div className="lp-section-inner">
            <div className="lp-section-header">
              <div className="lp-section-header-line" />
              <span className="lp-section-label">11 scored axes · Design 55% · Code 45%</span>
              <div className="lp-section-header-line" />
            </div>
            {AXES.map((a, i) => (
              <div key={a.id} className="lp-row" style={{ background: ROW_ALT[i % 2] } as React.CSSProperties}>
                <div className="row-badge">
                  <span className={`row-badge-id ${a.level === "Design" ? "design" : "code"}`}>{a.id}</span>
                </div>
                <div className="row-body">
                  <h3>{a.label}</h3>
                  <p>{a.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Score preview (parallax band) ── */}
        <div className="lp-section reveal" style={{ background: SECTION_COLORS[3] } as React.CSSProperties}>
          <div className="lp-section-bg" data-parallax="0.13" style={{ background: SECTION_COLORS[3] }} />
          <div className="lp-section-inner">
            <div className="score-row-wrap">
              <div className="score-row-copy">
                <h2>What a real StackScore looks like</h2>
                <p>
                  Design thinking, code quality,<br />
                  and AI collaboration.<br />
                  All in one number.<br />
                  With evidence behind every axis.
                </p>
              </div>
              <div className="lp-score-card">
                <div className="lp-score-num">78</div>
                <div className="lp-score-grade">Strong</div>
                <div className="lp-score-levels">
                  <div>
                    <span className="lp-lv-val" style={{ color: "var(--design-color)" }}>82</span>
                    <span className="lp-lv-lbl">Design</span>
                  </div>
                  <div>
                    <span className="lp-lv-val" style={{ color: "var(--code-color)" }}>73</span>
                    <span className="lp-lv-lbl">Code</span>
                  </div>
                </div>
                <div className="lp-k6-row">
                  <span className="lp-k6-badge">K6</span>
                  <span>AI Collaboration: <strong>74</strong></span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Comparison table (parallax band) ── */}
        <div className="lp-section reveal" style={{ background: SECTION_COLORS[4] } as React.CSSProperties}>
          <div className="lp-section-bg" data-parallax="0.14" style={{ background: SECTION_COLORS[4] }} />
          <div className="lp-section-inner" style={{ maxWidth: 860 }}>
            <div className="lp-section-header">
              <div className="lp-section-header-line" />
              <span className="lp-section-label">How StackScore compares</span>
              <div className="lp-section-header-line" />
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="cmp-tbl">
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Capability</th>
                    <th className="ss-col">StackScore</th>
                    <th>Coding platforms</th>
                    <th>Skills tests</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARE.map((row) => (
                    <tr key={row.label}>
                      <td className="cmp-feat">{row.label}</td>
                      <td className="cmp-check">{row.ss ? "✅" : "–"}</td>
                      <td className="cmp-check">{row.hr ? "✅" : "–"}</td>
                      <td className="cmp-check">{row.co ? "✅" : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ── Panel CTA (parallax band) ── */}
        <div className="lp-section reveal" style={{ background: SECTION_COLORS[5] } as React.CSSProperties}>
          <div className="lp-section-bg" data-parallax="0.12" style={{ background: SECTION_COLORS[5] }} />
          <div className="lp-section-inner" style={{ textAlign: "center" }}>
            <h2 style={{ fontSize: "clamp(1.5rem,3.5vw,2rem)", fontWeight: 800, marginBottom: ".85rem" }}>
              Built for hiring panels
            </h2>
            <p style={{ maxWidth: 440, margin: "0 auto 2rem", color: "var(--text-muted)", fontSize: ".92rem", lineHeight: 1.7 }}>
              Panelists get a live dashboard - all candidates ranked by StackScore,
              filterable by role, with Kanban pipeline management and CSV export.
            </p>
            <div className="panel-features">
              <span>Role-calibrated benchmarks</span>
              <span>Side-by-side radar comparison</span>
              <span>Kanban pipeline</span>
              <span>Transcript review</span>
              <span>CSV / webhook export</span>
              <span>Expiring assessment links</span>
            </div>
            <a href="/panel" className="btn-primary">Create a panel assessment →</a>
          </div>
        </div>

      </div>
    </main>
  );
}
