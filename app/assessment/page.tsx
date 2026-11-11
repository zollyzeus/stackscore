"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "../components/AuthProvider";
import type { AxisScores } from "../../lib/scoring";

type Stage = "start" | "clarify" | "propose" | "build" | "adapt" | "debug" | "done";
type Role = "Junior" | "Mid" | "Senior";

interface ChatTurn { role: "candidate" | "stakeholder"; text: string; }

interface ScoreResult {
  axisScores: AxisScores;
  stackScore: number;
  levelScores: { design: number; code: number };
  feedback: Record<string, string>;
  scoreCardUrl: string;
}

interface StoredSession {
  v: number;
  sessionId: string;
  brief: string;
  stage: Stage;
  chatHistory: ChatTurn[];
  designText: string;
  code: string;
  codeOutput: string;
  twist: string;
  twistResponse: string;
  adaptCode: string;
  adaptCodeOutput: string;
  buggedCode: string;
  debugHint: string;
  debugCode: string;
  candidateName: string;
  candidateEmail: string;
  role: Role;
  startTime: number;
  tabSwitchCount: number;
}

const STAGE_LABELS: Record<Stage, string> = {
  start: "Start", clarify: "1 · Clarify", propose: "2 · Propose",
  build: "3 · Build", adapt: "4 · Adapt", debug: "5 · Debug", done: "Done",
};

const STAGE_LIMITS: Partial<Record<Stage, number>> = {
  clarify: 300, propose: 600, build: 1200, adapt: 600, debug: 900,
};

const TOTAL_DURATION = 3600; // 60 minutes
const SAVE_KEY = "ss_assessment_progress";

const STAGE_HINTS: Partial<Record<Stage, string[]>> = {
  clarify: [
    "Ask about scale: how many users / requests per second?",
    "Ask about constraints: budget, latency, consistency requirements?",
    "Ask about existing systems: is there a database already in place?",
    "Clarify success criteria: what does 'done' look like?",
  ],
  propose: [
    "Name your top-level components and how they interact.",
    "State your data model early - it anchors everything else.",
    "Justify each technology choice against the brief's constraints.",
    "Call out the tradeoffs you're consciously making.",
  ],
  build: [
    "Start with the happy path, then add error handling.",
    "Use meaningful variable names - the judge reads your code.",
    "Add a brief comment explaining any non-obvious logic.",
    "Run your code before submitting to catch obvious bugs.",
  ],
  adapt: [
    "Re-state the new requirement in your own words first.",
    "Identify which parts of your design are unaffected.",
    "Explain what breaks and why, not just what changes.",
    "If you'd re-architect, say what you'd keep from before.",
  ],
  debug: [
    "Read the symptom hint carefully before touching the code.",
    "Print/log intermediate values to narrow down the location.",
    "Check boundary conditions - off-by-one and null cases.",
    "Run the fixed code to confirm the symptom is resolved.",
  ],
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
    const t = setInterval(() => {
      setRemaining((r) => { if (r <= 1) { clearInterval(t); setExpired(true); return 0; } return r - 1; });
    }, 1000);
    return () => clearInterval(t);
  }, [stage, active, limit]);

  if (!limit) return null;
  const warn = remaining <= 60 && !expired;
  return (
    <span className={`stage-timer ${warn ? "warn" : ""} ${expired ? "expired" : ""}`} title="Stage time remaining">
      {expired ? "⏱ Time up" : `⏱ ${fmt(remaining)}`}
    </span>
  );
}

function BriefPanel({ brief, chatHistory, designText, twist, stage }: {
  brief: string; chatHistory: ChatTurn[]; designText: string; twist: string; stage: Stage;
}) {
  const clarifications = chatHistory.slice(1); // skip initial brief turn
  const showDesign = ["build", "adapt", "debug"].includes(stage) && designText;
  const showTwist = ["adapt", "debug"].includes(stage) && twist;

  return (
    <>
      <div className="brief-side-label">📋 Problem Brief</div>
      <div className="brief-side-text" style={{ whiteSpace: "pre-wrap" }}>{brief}</div>

      {clarifications.length > 0 && (
        <div className="brief-side-section">
          <div className="brief-side-section-label">Your clarifications</div>
          {clarifications.map((t, i) => (
            <div key={i} className="brief-clar-item">
              {t.role === "candidate"
                ? <div className="brief-clar-q">Q: {t.text}</div>
                : <div className="brief-clar-a">A: {t.text}</div>}
            </div>
          ))}
        </div>
      )}

      {showDesign && (
        <div className="brief-side-section">
          <div className="brief-side-section-label">Your design</div>
          <div className="brief-side-text" style={{ fontSize: ".77rem", whiteSpace: "pre-wrap", maxHeight: "120px", overflowY: "auto" }}>
            {designText}
          </div>
        </div>
      )}

      {showTwist && (
        <div className="brief-side-section">
          <div className="brief-side-section-label" style={{ color: "var(--score-gold)" }}>⚡ Constraint twist</div>
          <div className="brief-side-text">{twist}</div>
        </div>
      )}
    </>
  );
}

export default function Assessment() {
  const [stage, setStage] = useState<Stage>("start");
  const [sessionId, setSessionId] = useState("");
  const [brief, setBrief] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatTurn[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [designText, setDesignText] = useState("");
  const [code, setCode] = useState("");
  const [codeOutput, setCodeOutput] = useState("");
  const [twist, setTwist] = useState("");
  const [twistResponse, setTwistResponse] = useState("");
  const [adaptCode, setAdaptCode] = useState("");
  const [adaptCodeOutput, setAdaptCodeOutput] = useState("");
  const [showAdaptCode, setShowAdaptCode] = useState(false);
  const [buggedCode, setBuggedCode] = useState("");
  const [debugHint, setDebugHint] = useState("");
  const [debugCode, setDebugCode] = useState("");
  const [debugOutput, setDebugOutput] = useState("");
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [stageError, setStageError] = useState("");
  const [hintsOn, setHintsOn] = useState(false);
  const [role, setRole] = useState<Role>("Mid");
  const [candidateName, setCandidateName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const { authenticated: panAuthenticated } = useAuth();
  const [candAuthenticated, setCandAuthenticated] = useState(false);

  // Session persistence
  const [resumeData, setResumeData] = useState<StoredSession | null>(null);
  const [briefOpen, setBriefOpen] = useState(false);

  // Inactivity / time
  const [showInactive, setShowInactive] = useState(false);
  const [overallRemaining, setOverallRemaining] = useState(0);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const stageStartRef = useRef<Partial<Record<Stage, number>>>({});
  const tabSwitchRef = useRef(0);
  const startTimeRef = useRef<number | null>(null);
  const lastActivityRef = useRef(Date.now());
  const inactiveCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearError = useCallback(() => setStageError(""), []);

  // ── Check candidate auth ─────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/auth/candidate-me")
      .then(r => r.ok ? r.json() : null)
      .then((d: { authenticated: boolean } | null) => { if (d?.authenticated) setCandAuthenticated(true); })
      .catch(() => {});
  }, []);

  // ── Auto-fill from localStorage ─────────────────────────────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ss_candidate");
      if (saved) {
        const { name, email } = JSON.parse(saved);
        if (name) setCandidateName(name);
        if (email) setCandidateEmail(email);
      }
    } catch { /* ignore */ }
  }, []);

  // ── Check for resumable session ──────────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const data: StoredSession = JSON.parse(raw);
      if (data.v !== 1 || !data.sessionId || data.stage === "done") return;
      const elapsed = Date.now() - data.startTime;
      if (elapsed > TOTAL_DURATION * 1000) {
        localStorage.removeItem(SAVE_KEY); // expired
        return;
      }
      setResumeData(data);
    } catch { /* ignore */ }
  }, []);

  // ── Save session to localStorage ─────────────────────────────────────────────
  const saveSession = useCallback(() => {
    if (!sessionId || stage === "start" || stage === "done") return;
    try {
      const data: StoredSession = {
        v: 1, sessionId, brief, stage, chatHistory, designText,
        code, codeOutput, twist, twistResponse, adaptCode, adaptCodeOutput,
        buggedCode, debugHint, debugCode, candidateName, candidateEmail, role,
        startTime: startTimeRef.current ?? Date.now(),
        tabSwitchCount: tabSwitchRef.current,
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch { /* ignore */ }
  }, [sessionId, stage, brief, chatHistory, designText, code, codeOutput,
      twist, twistResponse, adaptCode, adaptCodeOutput, buggedCode, debugHint,
      debugCode, candidateName, candidateEmail, role]);

  const clearSavedSession = () => { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } };

  // Auto-save on stage transitions
  useEffect(() => { if (sessionId) saveSession(); }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save every 30s during active session
  useEffect(() => {
    if (!sessionId || stage === "done") return;
    const t = setInterval(saveSession, 30_000);
    return () => clearInterval(t);
  }, [sessionId, stage, saveSession]);

  // ── Overall 60-min countdown ─────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId || stage === "start" || stage === "done") return;
    const t = setInterval(() => {
      const elapsed = Math.floor((Date.now() - (startTimeRef.current ?? Date.now())) / 1000);
      const rem = Math.max(0, TOTAL_DURATION - elapsed);
      setOverallRemaining(rem);
      if (rem === 0) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [sessionId, stage]);

  // ── Inactivity detection ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId || stage === "start" || stage === "done") return;
    const resetActivity = () => { lastActivityRef.current = Date.now(); };
    window.addEventListener("mousemove", resetActivity, { passive: true });
    window.addEventListener("keydown", resetActivity, { passive: true });
    window.addEventListener("touchstart", resetActivity, { passive: true });

    inactiveCheckRef.current = setInterval(() => {
      if (Date.now() - lastActivityRef.current > 3 * 60 * 1000) {
        setShowInactive(true);
      }
    }, 60_000);

    return () => {
      window.removeEventListener("mousemove", resetActivity);
      window.removeEventListener("keydown", resetActivity);
      window.removeEventListener("touchstart", resetActivity);
      if (inactiveCheckRef.current) clearInterval(inactiveCheckRef.current);
    };
  }, [sessionId, stage]);

  // ── beforeunload warning + abandoned beacon ──────────────────────────────────
  useEffect(() => {
    if (!sessionId || stage === "start" || stage === "done") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
      try {
        navigator.sendBeacon("/api/session-status",
          new Blob([JSON.stringify({ sessionId, status: "abandoned" })], { type: "application/json" }));
      } catch { /* best-effort */ }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [sessionId, stage]);

  // ── Tab-switch proctoring ────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    const handler = () => {
      if (document.hidden && stage !== "start" && stage !== "done") tabSwitchRef.current += 1;
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [sessionId, stage]);

  // ── Stage start timestamps ───────────────────────────────────────────────────
  useEffect(() => {
    if (stage === "propose" || stage === "adapt") stageStartRef.current[stage] = Date.now();
  }, [stage]);

  // ── API helpers ──────────────────────────────────────────────────────────────
  async function post(url: string, body: object) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  // ── Resume session ───────────────────────────────────────────────────────────
  function applyResume(data: StoredSession) {
    setSessionId(data.sessionId); setBrief(data.brief); setStage(data.stage);
    setChatHistory(data.chatHistory); setDesignText(data.designText);
    setCode(data.code); setCodeOutput(data.codeOutput);
    setTwist(data.twist); setTwistResponse(data.twistResponse);
    setAdaptCode(data.adaptCode); setAdaptCodeOutput(data.adaptCodeOutput);
    setBuggedCode(data.buggedCode); setDebugHint(data.debugHint); setDebugCode(data.debugCode);
    setCandidateName(data.candidateName); setCandidateEmail(data.candidateEmail);
    setRole(data.role); tabSwitchRef.current = data.tabSwitchCount;
    startTimeRef.current = data.startTime;
    const elapsed = Math.floor((Date.now() - data.startTime) / 1000);
    setOverallRemaining(Math.max(0, TOTAL_DURATION - elapsed));
    setResumeData(null);
  }

  function dismissResume() { setResumeData(null); clearSavedSession(); }

  // ── Quit assessment ──────────────────────────────────────────────────────────
  async function quitAssessment() {
    if (sessionId) {
      try { await fetch("/api/session-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, status: "quit" }) }); }
      catch { /* non-fatal */ }
    }
    clearSavedSession();
    setSessionId(""); setBrief(""); setStage("start"); setChatHistory([]);
    setDesignText(""); setCode(""); setCodeOutput(""); setTwist("");
    setTwistResponse(""); setAdaptCode(""); setAdaptCodeOutput("");
    setBuggedCode(""); setDebugHint(""); setDebugCode(""); setScore(null);
    setStageError(""); setShowInactive(false); setOverallRemaining(0);
    startTimeRef.current = null; tabSwitchRef.current = 0;
  }

  // ── Assessment actions ───────────────────────────────────────────────────────
  async function startSession() {
    setLoading(true); clearError();
    try {
      const data = await post("/api/session", {
        mode: "random", role,
        ...(candidateName.trim() ? { candidateName: candidateName.trim() } : {}),
        ...(candidateEmail.trim() ? { candidateEmail: candidateEmail.trim() } : {}),
      });
      setSessionId(data.sessionId); setBrief(data.brief);
      setChatHistory([{ role: "stakeholder", text: data.brief }]);
      startTimeRef.current = Date.now();
      setOverallRemaining(TOTAL_DURATION);
      setStage("clarify");
      try {
        const name = candidateName.trim(); const email = candidateEmail.trim();
        if (name || email) localStorage.setItem("ss_candidate", JSON.stringify({ name, email }));
      } catch { /* ignore */ }
    } catch (err) {
      setStageError(`Could not start session: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setLoading(false); }
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
    } catch {
      setChatHistory((h) => [...h, { role: "stakeholder", text: "I'm having trouble responding right now. Please try again." }]);
    } finally { setLoading(false); }
  }

  async function submitDesign() {
    if (!designText.trim()) return;
    const elapsed = stageStartRef.current["propose"] ? Math.round((Date.now() - stageStartRef.current["propose"]) / 1000) : undefined;
    setLoading(true); clearError();
    try {
      await post("/api/stakeholder-chat", { sessionId, brief, history: chatHistory, question: `[DESIGN PROPOSAL]\n${designText}`, elapsedSeconds: elapsed });
    } catch { /* non-fatal */ } finally { setLoading(false); }
    setStage("build");
  }

  async function runCode(codeToRun: string, stageKey: "build" | "adapt" | "debug" = "build") {
    setLoading(true); clearError();
    try {
      const data = await post("/api/run-code", { sessionId, stage: stageKey, code: codeToRun });
      const output = data.error ? `Error: ${data.error}` : data.logs.join("\n") || "(no output)";
      if (stageKey === "debug") setDebugOutput(output);
      else if (stageKey === "adapt") setAdaptCodeOutput(output);
      else setCodeOutput(output);
    } catch (err) {
      const output = `Runner error: ${err instanceof Error ? err.message : String(err)}`;
      if (stageKey === "debug") setDebugOutput(output);
      else if (stageKey === "adapt") setAdaptCodeOutput(output);
      else setCodeOutput(output);
    } finally { setLoading(false); }
  }

  async function injectTwist() {
    setLoading(true); clearError();
    try { await post("/api/run-code", { sessionId, stage: "build", code: code || "// no code submitted" }); } catch { /* non-fatal */ }
    try {
      const data = await post("/api/inject-twist", { sessionId });
      setTwist(data.twist); setStage("adapt");
    } catch (err) {
      setStageError(`Could not load twist: ${err instanceof Error ? err.message : String(err)}. Try again.`);
    } finally { setLoading(false); }
  }

  async function submitAdapt() {
    if (!twistResponse.trim()) return;
    const elapsed = stageStartRef.current["adapt"] ? Math.round((Date.now() - stageStartRef.current["adapt"]) / 1000) : undefined;
    setLoading(true); clearError();
    try {
      await post("/api/stakeholder-chat", { sessionId, brief, history: chatHistory, question: `[ADAPT RESPONSE]\n${twistResponse}`, elapsedSeconds: elapsed });
    } catch { /* non-fatal */ }
    if (adaptCode.trim()) {
      try { await post("/api/run-code", { sessionId, stage: "adapt", code: adaptCode }); } catch { /* non-fatal */ }
    }
    try {
      const data = await post("/api/inject-defect", { sessionId });
      setBuggedCode(data.buggedCode); setDebugCode(data.buggedCode); setDebugHint(data.hint);
      setStage("debug");
    } catch (err) {
      setStageError(`Could not prepare debug stage: ${err instanceof Error ? err.message : String(err)}. Try again.`);
    } finally { setLoading(false); }
  }

  async function submitDebug() {
    setLoading(true); clearError();
    try { await post("/api/run-code", { sessionId, stage: "debug", code: debugCode || "// no debug code" }); } catch { /* non-fatal */ }
    try {
      const data = await post("/api/evaluate", { sessionId, tabSwitchCount: tabSwitchRef.current });
      setScore(data); clearSavedSession(); setStage("done");
    } catch (err) {
      setStageError(`Evaluation failed: ${err instanceof Error ? err.message : String(err)}. Try submitting again.`);
    } finally { setLoading(false); }
  }

  // ── Derived state ────────────────────────────────────────────────────────────
  const activeStage = stage !== "start" && stage !== "done" ? stage : null;
  const hints = hintsOn && activeStage ? (STAGE_HINTS[activeStage] ?? []) : [];
  const progressPct = Math.round((stageIndex(stage) / 6) * 100);
  const timerWarn = overallRemaining > 0 && overallRemaining <= 600;  // last 10 min
  const timerCrit = overallRemaining > 0 && overallRemaining <= 120;  // last 2 min
  const inSplit = stage !== "start" && stage !== "done";

  return (
    <main className="assessment">
      <style>{`
        .stage-timer { font-size: .75rem; font-weight: 600; color: var(--text-muted);
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 6px; padding: .2rem .5rem; }
        .stage-timer.warn { color: #f5a623; border-color: #f5a62355; background: #f5a62311; }
        .stage-timer.expired { color: #f56b6b; border-color: #f56b6b55; background: #f56b6b11; }
        .stage-header { display: flex; align-items: center; gap: .75rem; margin-bottom: .5rem; }
        .stage-header h2 { margin: 0; }
        .hints-toggle { background: none; border: 1px solid var(--border); color: var(--text-muted);
          border-radius: 6px; padding: .2rem .6rem; font-size: .75rem; cursor: pointer;
          transition: border-color .15s, color .15s; }
        .hints-toggle.on { border-color: var(--accent); color: var(--accent); background: #6c63ff11; }
        .hints-panel { background: var(--surface); border: 1px solid var(--border);
          border-left: 3px solid var(--accent); border-radius: 0 10px 10px 0;
          padding: .8rem 1rem; margin-bottom: 1rem; }
        .hints-panel p { font-size: .78rem; font-weight: 700; text-transform: uppercase;
          letter-spacing: .08em; color: var(--accent); margin-bottom: .5rem; }
        .hints-panel ul { margin: 0; padding-left: 1.25rem; }
        .hints-panel li { font-size: .83rem; color: var(--text-muted); margin-bottom: .25rem; }
        .role-selector { display: flex; gap: .5rem; margin-bottom: 1.25rem; }
        .role-btn { flex: 1; padding: .5rem; border: 1.5px solid var(--border); border-radius: 8px;
          background: var(--surface); color: var(--text-muted); cursor: pointer; font-weight: 600;
          font-size: .85rem; transition: all .15s; }
        .role-btn.selected { border-color: var(--accent); color: var(--accent); background: #6c63ff11; }
        .role-btn:hover:not(.selected) { border-color: var(--accent); color: var(--accent); }
        .candidate-fields { display: flex; flex-direction: column; gap: .6rem; margin-bottom: 1.25rem; }
        .candidate-fields input { background: var(--surface); border: 1px solid var(--border);
          color: inherit; border-radius: 8px; padding: .5rem .75rem; font-size: .88rem; width: 100%; }
        .candidate-fields input:focus { outline: none; border-color: var(--accent); }
        .global-controls { display: flex; align-items: center; gap: .5rem; margin-bottom: .75rem;
          justify-content: flex-end; }
        .gc-label { font-size: .72rem; color: var(--text-muted); }
        .quit-btn { background: none; border: 1px solid var(--border); color: var(--text-muted);
          border-radius: 6px; padding: .2rem .6rem; font-size: .72rem; cursor: pointer; margin-left: .5rem; }
        .quit-btn:hover { border-color: #ef4444; color: #ef4444; background: none; }
      `}</style>

      {/* ── Inactivity overlay ── */}
      {showInactive && (
        <div className="inactive-overlay">
          <div className="inactive-modal">
            <h3>Still there?</h3>
            <p>You&apos;ve been inactive for a few minutes. Your progress is saved. The overall timer is still running.</p>
            <div className="inactive-modal-btns">
              <button onClick={() => { lastActivityRef.current = Date.now(); setShowInactive(false); }}>
                Continue assessment
              </button>
              <button className="btn-danger" onClick={async () => { setShowInactive(false); await quitAssessment(); }}>
                Save &amp; Quit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Top section: nav + controls ── */}
      <div className="assessment-top">
        {/* Resume prompt */}
        {resumeData && (
          <div className="resume-banner">
            <span>
              <strong>Resume your assessment?</strong>
              {" "}You were on <strong>{STAGE_LABELS[resumeData.stage]}</strong> with{" "}
              {fmt(Math.max(0, TOTAL_DURATION - Math.floor((Date.now() - resumeData.startTime) / 1000)))} remaining.
            </span>
            <div className="resume-banner-btns">
              <button onClick={() => applyResume(resumeData)}>Resume</button>
              <button className="btn-ghost-sm" onClick={dismissResume}>Start fresh</button>
            </div>
          </div>
        )}

        {/* Stage nav */}
        <nav className="stage-nav" style={{ "--stage-progress": `${progressPct}%` } as React.CSSProperties}>
          {(Object.keys(STAGE_LABELS) as Stage[]).filter((s) => s !== "start").map((s) => (
            <span key={s} className={`stage-pill ${stage === s ? "active" : ""} ${stageIndex(stage) > stageIndex(s) ? "done" : ""}`}>
              {STAGE_LABELS[s]}
            </span>
          ))}
          {activeStage && overallRemaining > 0 && (
            <span className={`overall-timer ${timerCrit ? "crit" : timerWarn ? "warn" : ""}`} title="Total time remaining">
              {fmt(overallRemaining)} total
            </span>
          )}
        </nav>

        {/* Global controls */}
        {activeStage && (
          <div className="global-controls">
            <span className="gc-label">Hints</span>
            <button className={`hints-toggle ${hintsOn ? "on" : ""}`} onClick={() => setHintsOn((v) => !v)}>
              {hintsOn ? "ON" : "OFF"}
            </button>
            <button className="quit-btn" onClick={async () => { if (window.confirm("Quit and save progress? This will end your assessment.")) await quitAssessment(); }}>
              Quit
            </button>
          </div>
        )}

        {/* Error banner */}
        {stageError && (
          <div className="stage-error" role="alert">
            <span>{stageError}</span>
            <button onClick={clearError} aria-label="Dismiss">✕</button>
          </div>
        )}
      </div>

      {/* ── START ── */}
      {stage === "start" && (
        <section style={{ maxWidth: 820, margin: "0 auto", padding: "0 1.25rem 4rem" }}>
          <h1>StackScore Assessment</h1>
          <p>A randomly generated engineering problem. Five stages: Clarify → Propose → Build → Adapt → Debug. AI-judged across 10 skill axes.</p>
          <p className="instruction">Select your experience level:</p>
          <div className="role-selector">
            {(["Junior", "Mid", "Senior"] as Role[]).map((r) => (
              <button key={r} className={`role-btn ${role === r ? "selected" : ""}`} onClick={() => setRole(r)}>{r}</button>
            ))}
          </div>
          <div style={{ fontSize: ".82rem", color: "var(--text-muted)", marginBottom: "1.5rem" }}>
            {role === "Junior" && "Expectations calibrated for < 2 years experience. Hints mode is available."}
            {role === "Mid" && "Standard assessment. Expectations calibrated for 2–5 years experience."}
            {role === "Senior" && "High bar: architectural depth, tradeoffs, and edge cases are weighted heavily."}
          </div>
          {role === "Junior" && <div style={{ fontSize: ".82rem", color: "var(--accent)", marginBottom: "1rem" }}>💡 Tip: Enable Hints during each stage to get guided prompts.</div>}
          <div className="candidate-fields">
            <input type="text" placeholder="Your name (optional)" value={candidateName} onChange={(e) => setCandidateName(e.target.value)} maxLength={120} autoComplete="name" />
            <input type="email" placeholder="Your email (optional)" value={candidateEmail} onChange={(e) => setCandidateEmail(e.target.value)} maxLength={254} autoComplete="email" />
          </div>
          <button onClick={startSession} disabled={loading}>
            {loading ? "Generating problem…" : "Start assessment"}
          </button>
        </section>
      )}

      {/* ── ACTIVE STAGES: split layout ── */}
      {inSplit && (
        <>
          {/* Mobile brief banner */}
          <div className="brief-banner-mobile">
            <button className="brief-banner-toggle" onClick={() => setBriefOpen((v) => !v)}>
              📋 Problem Brief
              <span className={`brief-banner-chevron ${briefOpen ? "open" : ""}`}>▼</span>
            </button>
            <div className={`brief-banner-body ${briefOpen ? "open" : ""}`}>
              {brief}
            </div>
          </div>

          <div className="assessment-split">
            {/* Desktop left panel */}
            <aside className="brief-side">
              <BriefPanel brief={brief} chatHistory={chatHistory} designText={designText} twist={twist} stage={stage} />
            </aside>

            {/* Work area */}
            <div className="work-side">

              {/* CLARIFY */}
              {stage === "clarify" && (
                <section>
                  <div className="stage-header">
                    <h2>Stage 1 · Clarify</h2>
                    <StageTimer stage="clarify" active={stage === "clarify"} />
                  </div>
                  <p className="instruction">Ask the stakeholder questions to scope the problem before you design. When ready, move to Propose.</p>
                  {hints.length > 0 && (<div className="hints-panel"><p>Hints for this stage</p><ul>{hints.map((h, i) => <li key={i}>{h}</li>)}</ul></div>)}
                  <div className="chat-window">
                    {chatHistory.map((turn, i) => (
                      <div key={i} className={`chat-turn ${turn.role}`}>
                        <strong>{turn.role === "stakeholder" ? "Stakeholder" : "You"}</strong>
                        <p>{turn.text}</p>
                      </div>
                    ))}
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
                  <div className="stage-header">
                    <h2>Stage 2 · Propose</h2>
                    <StageTimer stage="propose" active={stage === "propose"} />
                  </div>
                  <p className="instruction">Describe your approach and architecture. Justify your tradeoffs against the constraints you discovered.</p>
                  {hints.length > 0 && (<div className="hints-panel"><p>Hints for this stage</p><ul>{hints.map((h, i) => <li key={i}>{h}</li>)}</ul></div>)}
                  <textarea rows={16} value={designText} onChange={(e) => setDesignText(e.target.value)} placeholder="My proposed architecture…&#10;Components:&#10;Tradeoffs:&#10;Assumptions:" />
                  <button onClick={submitDesign} disabled={!designText.trim() || loading}>{loading ? "Saving…" : "Lock in design → Start coding"}</button>
                </section>
              )}

              {/* BUILD */}
              {stage === "build" && (
                <section>
                  <div className="stage-header">
                    <h2>Stage 3 · Build</h2>
                    <StageTimer stage="build" active={stage === "build"} />
                  </div>
                  <p className="instruction">
                    Implement a working slice that demonstrates your design. Run it to verify.
                    <span style={{ display: "block", fontSize: ".8rem", color: "var(--text-muted)", marginTop: ".3rem" }}>
                      Code is optional - pseudo-code or a written approach is accepted if you are short on time.
                    </span>
                  </p>
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
                  <div className="stage-header">
                    <h2>Stage 4 · Adapt</h2>
                    <StageTimer stage="adapt" active={stage === "adapt"} />
                  </div>
                  <p className="instruction">New requirements have come in. Describe how your design and code adapt.</p>
                  {hints.length > 0 && (<div className="hints-panel"><p>Hints for this stage</p><ul>{hints.map((h, i) => <li key={i}>{h}</li>)}</ul></div>)}
                  <div className="twist-box"><strong>New requirement:</strong><p>{twist}</p></div>
                  <textarea rows={10} value={twistResponse} onChange={(e) => setTwistResponse(e.target.value)} placeholder="How my design adapts…&#10;What changes in the code…&#10;What breaks and needs rethinking…" />
                  <div style={{ margin: ".75rem 0" }}>
                    <button className="hints-toggle" style={{ fontSize: ".82rem", padding: ".3rem .75rem" }} onClick={() => setShowAdaptCode((v) => !v)}>
                      {showAdaptCode ? "Hide code editor" : "Update code (optional)"}
                    </button>
                    {!showAdaptCode && <span style={{ fontSize: ".78rem", color: "var(--text-muted)", marginLeft: ".75rem" }}>Submit updated code, or skip - scoring continues from your design response above.</span>}
                  </div>
                  {showAdaptCode && (
                    <>
                      <textarea className="code-editor" rows={16} value={adaptCode} onChange={(e) => setAdaptCode(e.target.value)} placeholder="// Update your implementation to address the new requirement" spellCheck={false} />
                      <div className="code-actions">
                        <button onClick={() => runCode(adaptCode, "adapt")} disabled={loading || !adaptCode.trim()}>{loading ? "Running…" : "▶ Run"}</button>
                      </div>
                      {adaptCodeOutput && <pre className="code-output">{adaptCodeOutput}</pre>}
                    </>
                  )}
                  <button onClick={submitAdapt} disabled={!twistResponse.trim() || loading}>{loading ? "Preparing debug stage…" : "Submit adaptation → Debug stage"}</button>
                </section>
              )}

              {/* DEBUG */}
              {stage === "debug" && (
                <section>
                  <div className="stage-header">
                    <h2>Stage 5 · Debug</h2>
                    <StageTimer stage="debug" active={stage === "debug"} />
                  </div>
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

            </div>{/* /work-side */}
          </div>{/* /assessment-split */}
        </>
      )}

      {/* ── DONE ── */}
      {stage === "done" && score && (
        <section style={{ maxWidth: 820, margin: "0 auto", padding: "0 1.25rem 4rem" }}>
          <h2>Your StackScore</h2>
          <div className="stack-score-hero">{score.stackScore}</div>
          <div className="level-scores">
            <span>Design: {score.levelScores.design}</span>
            <span>Code: {score.levelScores.code}</span>
          </div>
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
          <a href={score.scoreCardUrl} className="share-link" target="_blank">Share score card →</a>
          {!panAuthenticated && !candAuthenticated && (
            <p style={{ fontSize: ".82rem", color: "var(--text-muted)", marginTop: "1.25rem", textAlign: "center" }}>
              <a href="/login" style={{ color: "var(--accent)", fontWeight: 600 }}>Sign in</a>
              {" "}to track this score and see your improvement over time.
            </p>
          )}
        </section>
      )}
    </main>
  );
}

function stageIndex(s: Stage): number {
  return ["start", "clarify", "propose", "build", "adapt", "debug", "done"].indexOf(s);
}
