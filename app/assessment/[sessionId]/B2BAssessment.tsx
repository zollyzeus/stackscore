"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { AxisScores } from "../../../lib/scoring";

type Stage = "clarify" | "propose" | "build" | "adapt" | "debug" | "done";
type Role = "Junior" | "Mid" | "Senior";

interface ChatTurn { role: "candidate" | "stakeholder"; text: string; }

interface ScoreResult {
  axisScores: AxisScores;
  stackScore: number;
  levelScores: { design: number; code: number };
  feedback: Record<string, string>;
  scoreCardUrl: string;
}

const STAGE_LIMITS: Partial<Record<Stage, number>> = {
  clarify: 300, propose: 600, build: 1200, adapt: 600, debug: 900,
};

const STAGE_HINTS: Partial<Record<Stage, string[]>> = {
  clarify: ["Ask about scale: how many users / requests per second?", "Ask about constraints: budget, latency, consistency requirements?", "Ask about existing systems: is there a database already in place?", "Clarify success criteria: what does 'done' look like?"],
  propose: ["Name your top-level components and how they interact.", "State your data model early - it anchors everything else.", "Justify each technology choice against the brief's constraints.", "Call out the tradeoffs you're consciously making."],
  build: ["Start with the happy path, then add error handling.", "Use meaningful variable names - the judge reads your code.", "Add a brief comment explaining any non-obvious logic.", "Run your code before submitting to catch obvious bugs."],
  adapt: ["Re-state the new requirement in your own words first.", "Identify which parts of your design are unaffected.", "Explain what breaks and why, not just what changes.", "If you'd re-architect, say what you'd keep from before."],
  debug: ["Read the symptom hint carefully before touching the code.", "Print/log intermediate values to narrow down the location.", "Check boundary conditions - off-by-one and null cases.", "Run the fixed code to confirm the symptom is resolved."],
};

function fmt(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function StageTimer({ stage, active }: { stage: Stage; active: boolean }) {
  const limit = STAGE_LIMITS[stage];
  const [remaining, setRemaining] = useState(limit ?? 0);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!limit || !active) return;
    setRemaining(limit); setExpired(false);
    const t = setInterval(() => { setRemaining((r) => { if (r <= 1) { clearInterval(t); setExpired(true); return 0; } return r - 1; }); }, 1000);
    return () => clearInterval(t);
  }, [stage, active, limit]);
  if (!limit) return null;
  const warn = remaining <= 60 && !expired;
  return <span className={`stage-timer ${warn ? "warn" : ""} ${expired ? "expired" : ""}`} title="Stage time remaining">{expired ? "⏱ Time up" : `⏱ ${fmt(remaining)}`}</span>;
}

export default function B2BAssessment({ sessionId, brief, initialRole }: { sessionId: string; brief: string; initialRole: Role }) {
  const [stage, setStage] = useState<Stage>("clarify");
  const [chatHistory, setChatHistory] = useState<ChatTurn[]>([{ role: "stakeholder", text: brief }]);
  const [chatInput, setChatInput] = useState("");
  const [designText, setDesignText] = useState("");
  const [code, setCode] = useState("");
  const [codeOutput, setCodeOutput] = useState("");
  const [twist, setTwist] = useState("");
  const [twistResponse, setTwistResponse] = useState("");
  const [adaptCode, setAdaptCode] = useState("");
  const [adaptCodeOutput, setAdaptCodeOutput] = useState("");
  const [showAdaptCode, setShowAdaptCode] = useState(false);
  const [debugCode, setDebugCode] = useState("");
  const [debugOutput, setDebugOutput] = useState("");
  const [debugHint, setDebugHint] = useState("");
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [stageError, setStageError] = useState("");
  const [hintsOn, setHintsOn] = useState(false);
  const [online, setOnline] = useState(true);
  const [resumed, setResumed] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const stageStartRef = useRef<Partial<Record<Stage, number>>>({});
  const tabSwitchRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearError = useCallback(() => setStageError(""), []);

  // Network presence detection
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);

  // Resume checkpoint on mount
  useEffect(() => {
    const lsKey = `ss_cp_${sessionId}`;
    const local = (() => { try { const v = localStorage.getItem(lsKey); return v ? JSON.parse(v) : null; } catch { return null; } })();
    if (local?.stage && local.stage !== "clarify") {
      if (window.confirm(`Resume from ${local.stage} stage? Your previous progress was saved.`)) {
        setStage(local.stage);
        if (local.chatHistory) setChatHistory(local.chatHistory);
        if (local.designText) setDesignText(local.designText);
        if (local.code) setCode(local.code);
        setResumed(true);
      } else {
        localStorage.removeItem(lsKey);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave to localStorage + Firestore every 30s
  const getCheckpoint = useCallback(() => ({
    stage, chatHistory, designText, code, twistResponse, adaptCode, debugCode,
    savedAt: new Date().toISOString(),
  }), [stage, chatHistory, designText, code, twistResponse, adaptCode, debugCode]);

  useEffect(() => {
    if (stage === "done") return;
    const lsKey = `ss_cp_${sessionId}`;
    saveTimerRef.current = setInterval(() => {
      const cp = getCheckpoint();
      try { localStorage.setItem(lsKey, JSON.stringify(cp)); } catch {}
      fetch(`/api/session/${sessionId}/checkpoint`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cp) }).catch(() => {});
    }, 30_000);
    return () => { if (saveTimerRef.current) clearInterval(saveTimerRef.current); };
  }, [sessionId, stage, getCheckpoint]);

  // Clear checkpoint when done
  useEffect(() => {
    if (stage === "done") {
      try { localStorage.removeItem(`ss_cp_${sessionId}`); } catch {}
    }
  }, [stage, sessionId]);

  useEffect(() => {
    if (stage === "propose" || stage === "adapt") stageStartRef.current[stage] = Date.now();
  }, [stage]);

  useEffect(() => {
    const handler = () => {
      if (document.hidden && stage !== "done") tabSwitchRef.current += 1;
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [stage]);

  async function post(url: string, body: object) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function sendQuestion() {
    if (!chatInput.trim()) return;
    const q = chatInput.trim(); setChatInput("");
    setChatHistory((h) => [...h, { role: "candidate", text: q }]);
    setLoading(true); clearError();
    try {
      const data = await post("/api/stakeholder-chat", { sessionId, brief, history: chatHistory, question: q });
      setChatHistory((h) => [...h, { role: "stakeholder", text: data.reply }]);
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    } catch { setChatHistory((h) => [...h, { role: "stakeholder", text: "I'm having trouble responding right now. Please try again." }]); }
    finally { setLoading(false); }
  }

  async function submitDesign() {
    if (!designText.trim()) return;
    const elapsed = stageStartRef.current["propose"] ? Math.round((Date.now() - stageStartRef.current["propose"]) / 1000) : undefined;
    setLoading(true); clearError();
    try { await post("/api/stakeholder-chat", { sessionId, brief, history: chatHistory, question: `[DESIGN PROPOSAL]\n${designText}`, elapsedSeconds: elapsed }); } catch { /* non-fatal */ }
    finally { setLoading(false); }
    setStage("build");
  }

  async function runCode(codeToRun: string, s: "build" | "adapt" | "debug" = "build") {
    setLoading(true); clearError();
    try {
      const data = await post("/api/run-code", { sessionId, stage: s, code: codeToRun });
      const output = data.error ? `Error: ${data.error}` : data.logs.join("\n") || "(no output)";
      if (s === "debug") setDebugOutput(output);
      else if (s === "adapt") setAdaptCodeOutput(output);
      else setCodeOutput(output);
    } catch (err) {
      const output = `Runner error: ${err instanceof Error ? err.message : String(err)}`;
      if (s === "debug") setDebugOutput(output);
      else if (s === "adapt") setAdaptCodeOutput(output);
      else setCodeOutput(output);
    } finally { setLoading(false); }
  }

  async function injectTwist() {
    setLoading(true); clearError();
    try { await post("/api/run-code", { sessionId, stage: "build", code: code || "// no code submitted" }); } catch { /* non-fatal */ }
    try {
      const data = await post("/api/inject-twist", { sessionId });
      setTwist(data.twist); setStage("adapt");
    } catch (err) { setStageError(`Could not load twist: ${err instanceof Error ? err.message : String(err)}. Try again.`); }
    finally { setLoading(false); }
  }

  async function submitAdapt() {
    if (!twistResponse.trim()) return;
    const elapsed = stageStartRef.current["adapt"] ? Math.round((Date.now() - stageStartRef.current["adapt"]) / 1000) : undefined;
    setLoading(true); clearError();
    try { await post("/api/stakeholder-chat", { sessionId, brief, history: chatHistory, question: `[ADAPT RESPONSE]\n${twistResponse}`, elapsedSeconds: elapsed }); } catch { /* non-fatal */ }
    if (adaptCode.trim()) { try { await post("/api/run-code", { sessionId, stage: "adapt", code: adaptCode }); } catch { /* non-fatal */ } }
    try {
      const data = await post("/api/inject-defect", { sessionId });
      setDebugCode(data.buggedCode); setDebugHint(data.hint); setStage("debug");
    } catch (err) { setStageError(`Could not prepare debug stage: ${err instanceof Error ? err.message : String(err)}.`); }
    finally { setLoading(false); }
  }

  async function submitDebug() {
    setLoading(true); clearError();
    try { await post("/api/run-code", { sessionId, stage: "debug", code: debugCode || "// no debug code" }); } catch { /* non-fatal */ }
    try {
      const data = await post("/api/evaluate", { sessionId, tabSwitchCount: tabSwitchRef.current });
      setScore(data); setStage("done");
    } catch (err) { setStageError(`Evaluation failed: ${err instanceof Error ? err.message : String(err)}. Try submitting again.`); }
    finally { setLoading(false); }
  }

  const STAGE_LABELS: Record<Stage, string> = { clarify: "1 · Clarify", propose: "2 · Propose", build: "3 · Build", adapt: "4 · Adapt", debug: "5 · Debug", done: "Done" };
  const stageIdx = (s: Stage) => ["clarify", "propose", "build", "adapt", "debug", "done"].indexOf(s);
  const progressPct = Math.round((stageIdx(stage) / 5) * 100);
  const hints = hintsOn && stage !== "done" ? (STAGE_HINTS[stage] ?? []) : [];

  const [briefOpen, setBriefOpen] = useState(false);

  // Brief sidebar content (reused in both side panel and mobile banner)
  const briefSidebar = (
    <>
      <div className="brief-side-label">📋 Brief</div>
      <div className="brief-side-text" style={{ whiteSpace: "pre-wrap" }}>{brief}</div>
      {chatHistory.length > 1 && (
        <div className="brief-side-section">
          <div className="brief-side-section-label">Clarifications</div>
          {chatHistory.slice(1).map((t, i) =>
            t.role === "candidate" ? (
              <div key={i} className="brief-clar-item">
                <div className="brief-clar-q">Q: {t.text}</div>
                {chatHistory[chatHistory.indexOf(t) + 1]?.role === "stakeholder" && (
                  <div className="brief-clar-a">A: {chatHistory[chatHistory.indexOf(t) + 1].text}</div>
                )}
              </div>
            ) : null
          )}
        </div>
      )}
      {designText && stage !== "clarify" && stage !== "propose" && (
        <div className="brief-side-section">
          <div className="brief-side-section-label">Your design</div>
          <div className="brief-side-text" style={{ whiteSpace: "pre-wrap" }}>{designText}</div>
        </div>
      )}
    </>
  );

  return (
    <main className="assessment">
      {!online && <div className="net-banner offline">⚡ Connection lost - your progress is saved and will sync when you&apos;re back online.</div>}
      {online && resumed && <div className="net-banner resumed" onClick={() => setResumed(false)} style={{cursor:"pointer"}}>✓ Resumed from your last saved point - tap to dismiss</div>}
      <style>{`
        .net-banner{position:fixed;top:56px;left:0;right:0;z-index:300;padding:.45rem 1rem;text-align:center;font-size:.82rem;font-weight:600}
        .net-banner.offline{background:#b91c1c;color:#fff}
        .net-banner.resumed{background:var(--accent);color:#fff}
        .stage-timer{font-size:.75rem;font-weight:600;color:var(--text-muted);background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:.2rem .5rem;margin-left:auto}
        .stage-timer.warn{color:#f5a623;border-color:#f5a62355;background:#f5a62311}
        .stage-timer.expired{color:#f56b6b;border-color:#f56b6b55;background:#f56b6b11}
        .stage-header{display:flex;align-items:center;gap:.75rem;margin-bottom:.5rem}
        .stage-header h2{margin:0}
        .hints-toggle{background:none;border:1px solid var(--border);color:var(--text-muted);border-radius:6px;padding:.2rem .6rem;font-size:.75rem;cursor:pointer;transition:border-color .15s,color .15s}
        .hints-toggle.on{border-color:var(--accent);color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,transparent)}
        .hints-panel{background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:0 10px 10px 0;padding:.8rem 1rem;margin-bottom:1rem}
        .hints-panel p{font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--accent);margin-bottom:.5rem}
        .hints-panel ul{margin:0;padding-left:1.25rem}
        .hints-panel li{font-size:.83rem;color:var(--text-muted);margin-bottom:.25rem}
        .global-controls{display:flex;align-items:center;gap:.5rem;justify-content:flex-end}
        .gc-label{font-size:.72rem;color:var(--text-muted)}
        .b2b-badge{font-size:.72rem;background:color-mix(in srgb,var(--accent) 15%,transparent);color:var(--accent);border:1px solid color-mix(in srgb,var(--accent) 35%,transparent);border-radius:6px;padding:.2rem .6rem;display:inline-block}
      `}</style>

      {/* Top bar: stage nav + hint toggle */}
      <div className="assessment-top">
        <div style={{ display: "flex", alignItems: "center", gap: ".75rem", flexWrap: "wrap" }}>
          <nav className="stage-nav" style={{ "--stage-progress": `${progressPct}%`, flex: 1, marginBottom: 0 } as React.CSSProperties}>
            {(Object.keys(STAGE_LABELS) as Stage[]).filter((s) => s !== "done").map((s) => (
              <span key={s} className={`stage-pill ${stage === s ? "active" : ""} ${stageIdx(stage) > stageIdx(s) ? "done" : ""}`}>{STAGE_LABELS[s]}</span>
            ))}
          </nav>
          {stage !== "done" && (
            <div className="global-controls">
              <span className="gc-label">Hints</span>
              <button className={`hints-toggle ${hintsOn ? "on" : ""}`} onClick={() => setHintsOn((v) => !v)}>{hintsOn ? "ON" : "OFF"}</button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile brief banner */}
      {stage !== "done" && (
        <div className="brief-banner-mobile">
          <button className="brief-banner-toggle" onClick={() => setBriefOpen((v) => !v)}>
            📋 Brief &amp; context
            <span className={`brief-banner-chevron${briefOpen ? " open" : ""}`}>▾</span>
          </button>
          <div className={`brief-banner-body${briefOpen ? " open" : ""}`}>
            {briefSidebar}
          </div>
        </div>
      )}

      {stage === "done" ? (
        // Done screen — full width
        <div style={{ maxWidth: 820, margin: "0 auto", padding: "2rem 1.25rem" }}>
          {score && (
            <section>
              <h2>Your StackScore</h2>
              <div className="stack-score-hero">{score.stackScore}</div>
              <div className="level-scores"><span>Design: {score.levelScores.design}</span><span>Code: {score.levelScores.code}</span></div>
              <div className="axis-bars">
                {Object.entries(score.axisScores).map(([id, val]) => (
                  <div key={id} className="axis-row">
                    <span className="axis-id">{id}</span>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${val}%` }} /></div>
                    <span className="axis-val">{val}</span>
                    <p className="axis-feedback">{score.feedback[id]}</p>
                  </div>
                ))}
              </div>
              <a href={score.scoreCardUrl} className="share-link" target="_blank">View full score card →</a>
            </section>
          )}
        </div>
      ) : (
        // Split pane layout
        <div className="assessment-split">
          {/* Left: sticky brief panel */}
          <div className="brief-side">
            {briefSidebar}
          </div>

          {/* Right: stage work area */}
          <div className="work-side">
            <div style={{ marginBottom: ".75rem" }}>
              <span className="b2b-badge">Panelist-assigned · {initialRole}</span>
            </div>

            {stageError && (
              <div className="stage-error" role="alert">
                <span>{stageError}</span>
                <button onClick={clearError} aria-label="Dismiss">✕</button>
              </div>
            )}

            {/* CLARIFY */}
            {stage === "clarify" && (
              <section>
                <div className="stage-header"><h2>Stage 1 · Clarify</h2><StageTimer stage="clarify" active={stage === "clarify"} /></div>
                <p className="instruction">Ask the stakeholder questions to scope the problem before you design. When you are ready, move to Propose.</p>
                {hints.length > 0 && (<div className="hints-panel"><p>Hints for this stage</p><ul>{hints.map((h, i) => <li key={i}>{h}</li>)}</ul></div>)}
                <div className="chat-window">
                  {chatHistory.map((turn, i) => (<div key={i} className={`chat-turn ${turn.role}`}><strong>{turn.role === "stakeholder" ? "Stakeholder" : "You"}</strong><p>{turn.text}</p></div>))}
                  <div ref={chatEndRef} />
                </div>
                <div className="chat-input-row">
                  <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendQuestion()} placeholder="Ask a clarifying question…" disabled={loading} />
                  <button onClick={sendQuestion} disabled={loading || !chatInput.trim()}>{loading ? "…" : "Send"}</button>
                </div>
                <button className="next-stage" onClick={() => setStage("propose")} disabled={loading}>I have enough context → Propose my design</button>
              </section>
            )}

            {/* PROPOSE */}
            {stage === "propose" && (
              <section>
                <div className="stage-header"><h2>Stage 2 · Propose</h2><StageTimer stage="propose" active={stage === "propose"} /></div>
                <p className="instruction">Describe your approach and architecture. Justify your tradeoffs against the constraints you discovered. Commit before you code.</p>
                {hints.length > 0 && (<div className="hints-panel"><p>Hints for this stage</p><ul>{hints.map((h, i) => <li key={i}>{h}</li>)}</ul></div>)}
                <textarea rows={16} value={designText} onChange={(e) => setDesignText(e.target.value)} placeholder="My proposed architecture…&#10;Components:&#10;Tradeoffs:&#10;Assumptions:" />
                <button onClick={submitDesign} disabled={!designText.trim() || loading}>{loading ? "Saving…" : "Lock in design → Start coding"}</button>
              </section>
            )}

            {/* BUILD */}
            {stage === "build" && (
              <section>
                <div className="stage-header"><h2>Stage 3 · Build</h2><StageTimer stage="build" active={stage === "build"} /></div>
                <p className="instruction">Implement a working slice that demonstrates your design. Run it to verify.<span style={{ display: "block", fontSize: ".8rem", color: "var(--text-muted)", marginTop: ".3rem" }}>Code is optional - pseudo-code or a written approach is accepted if you are short on time.</span></p>
                {hints.length > 0 && (<div className="hints-panel"><p>Hints for this stage</p><ul>{hints.map((h, i) => <li key={i}>{h}</li>)}</ul></div>)}
                <textarea className="code-editor" rows={20} value={code} onChange={(e) => setCode(e.target.value)} placeholder="// JavaScript - implement your solution here" spellCheck={false} />
                <div className="code-actions">
                  <button onClick={() => runCode(code, "build")} disabled={loading || !code.trim()}>{loading ? "Running…" : "▶ Run"}</button>
                  <button className="next-stage" onClick={injectTwist} disabled={loading}>Submit build → Get twist</button>
                </div>
                {codeOutput && <pre className="code-output">{codeOutput}</pre>}
              </section>
            )}

            {/* ADAPT */}
            {stage === "adapt" && (
              <section>
                <div className="stage-header"><h2>Stage 4 · Adapt</h2><StageTimer stage="adapt" active={stage === "adapt"} /></div>
                <p className="instruction">New requirements have come in. Describe how your design and code adapt. Does your existing approach hold, or does it need rethinking?</p>
                {hints.length > 0 && (<div className="hints-panel"><p>Hints for this stage</p><ul>{hints.map((h, i) => <li key={i}>{h}</li>)}</ul></div>)}
                <div className="twist-box"><strong>New requirement:</strong><p>{twist}</p></div>
                <textarea rows={10} value={twistResponse} onChange={(e) => setTwistResponse(e.target.value)} placeholder="How my design adapts…&#10;What changes in the code…&#10;What breaks and needs rethinking…" />
                <div style={{ margin: ".75rem 0" }}>
                  <button className="hints-toggle" style={{ fontSize: ".82rem", padding: ".3rem .75rem" }} onClick={() => setShowAdaptCode((v) => !v)}>{showAdaptCode ? "Hide code editor" : "Update code (optional)"}</button>
                  {!showAdaptCode && <span style={{ fontSize: ".78rem", color: "var(--text-muted)", marginLeft: ".75rem" }}>Submit updated code, or skip - scoring continues from your design response above.</span>}
                </div>
                {showAdaptCode && (<><textarea className="code-editor" rows={16} value={adaptCode} onChange={(e) => setAdaptCode(e.target.value)} placeholder="// Update your implementation to address the new requirement" spellCheck={false} /><div className="code-actions"><button onClick={() => runCode(adaptCode, "adapt")} disabled={loading || !adaptCode.trim()}>{loading ? "Running…" : "▶ Run"}</button></div>{adaptCodeOutput && <pre className="code-output">{adaptCodeOutput}</pre>}</>)}
                <button onClick={submitAdapt} disabled={!twistResponse.trim() || loading}>{loading ? "Preparing debug stage…" : "Submit adaptation → Debug stage"}</button>
              </section>
            )}

            {/* DEBUG */}
            {stage === "debug" && (
              <section>
                <div className="stage-header"><h2>Stage 5 · Debug</h2><StageTimer stage="debug" active={stage === "debug"} /></div>
                <p className="instruction">A defect has been seeded into a part of the system. Find and fix it.</p>
                {hints.length > 0 && (<div className="hints-panel"><p>Hints for this stage</p><ul>{hints.map((h, i) => <li key={i}>{h}</li>)}</ul></div>)}
                <div className="hint-box"><strong>Symptom:</strong> {debugHint}</div>
                <textarea className="code-editor" rows={20} value={debugCode} onChange={(e) => setDebugCode(e.target.value)} spellCheck={false} />
                <div className="code-actions">
                  <button onClick={() => runCode(debugCode, "debug")} disabled={loading || !debugCode.trim()}>{loading ? "Running…" : "▶ Run"}</button>
                  <button className="next-stage" onClick={submitDebug} disabled={loading}>{loading ? "Evaluating…" : "Submit fix → Get StackScore"}</button>
                </div>
                {debugOutput && <pre className="code-output">{debugOutput}</pre>}
              </section>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
