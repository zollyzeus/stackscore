"use client";

import { useState, useEffect } from "react";
import { MatrixPicker } from "../../components/MatrixPicker";

export default function Panel() {
  const [rowId, setRowId] = useState("");
  const [colId, setColId] = useState("");
  const [briefMode, setBriefMode] = useState<"matrix" | "custom">("matrix");
  const [customBrief, setCustomBrief] = useState("");
  const [role, setRole] = useState("Mid");
  const [expiresHours, setExpiresHours] = useState("48");
  const [candidateName, setCandidateName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [sessionUrl, setSessionUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/credits")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.remaining != null) setCreditsRemaining(d.remaining); })
      .catch(() => {});
  }, []);

  async function createSession() {
    if (briefMode === "matrix" && (!rowId || !colId)) return;
    if (briefMode === "custom" && !customBrief.trim()) return;
    setLoading(true);
    try {
      const body = briefMode === "custom"
        ? { mode: "custom", customBrief: customBrief.trim(), role }
        : { mode: "manual", rowId, columnId: colId, role };
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          expiresHours: expiresHours === "0" ? null : Number(expiresHours),
          ...(candidateName.trim() ? { candidateName: candidateName.trim() } : {}),
          ...(candidateEmail.trim() ? { candidateEmail: candidateEmail.trim() } : {}),
        }),
      });
      if (res.status === 402) {
        alert("Free tier exhausted. Please contact support to purchase additional assessments.");
        return;
      }
      const data = await res.json();
      const base = process.env.NEXT_PUBLIC_BASE_URL ?? window.location.origin;
      setSessionUrl(`${base}/assessment/${data.sessionId}`);
      // Refresh credits after successful creation
      fetch("/api/credits").then((r) => r.ok ? r.json() : null).then((d) => { if (d?.remaining != null) setCreditsRemaining(d.remaining); }).catch(() => {});
    } finally {
      setLoading(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(sessionUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }

  const expiryLabel = expiresHours === "0" ? "Never expires" : expiresHours === "24" ? "24 hours" : expiresHours === "48" ? "48 hours" : "7 days";

  return (
    <main className="panel">
      <style>{`
        .panel { max-width: 580px; margin: 0 auto; padding: 2.5rem 1.25rem 5rem; }
        .panel h1 { font-size: 1.5rem; font-weight: 800; margin-bottom: .5rem; }
        .panel p { color: var(--text-muted); margin-bottom: 1.5rem; font-size: .9rem; }
        .field-group { display: flex; flex-direction: column; gap: .5rem; margin-bottom: 1.25rem; }
        .field-label { font-size: .78rem; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: var(--text-muted); }
        .field-input { background: var(--surface); border: 1px solid var(--border); color: inherit; border-radius: 8px; padding: .5rem .75rem; font-size: .88rem; width: 100%; }
        .field-input:focus { outline: none; border-color: var(--accent); }
        .role-row, .expiry-row { display: flex; gap: .5rem; }
        .radio-btn { flex: 1; padding: .4rem; border: 1.5px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text-muted); cursor: pointer; font-weight: 600; font-size: .82rem; transition: all .15s; }
        .radio-btn.sel { border-color: var(--accent); color: var(--accent); background: var(--accent)11; }
        .radio-btn:hover:not(.sel) { border-color: var(--accent); }
        .session-link-box { margin-top: 1.5rem; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1.25rem; }
        .session-link-box h3 { font-size: .82rem; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: var(--accent); margin-bottom: .75rem; }
        .link-url { font-size: .82rem; word-break: break-all; color: var(--fg); background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: .5rem .75rem; display: block; margin-bottom: .75rem; }
        .link-actions { display: flex; gap: .5rem; flex-wrap: wrap; }
        .expiry-note { font-size: .75rem; color: var(--text-muted); margin-top: .5rem; }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: ".5rem", marginBottom: ".35rem" }}>
        <h1 style={{ margin: 0 }}>StackScore · Panelist</h1>
        {creditsRemaining !== null && (
          <span style={{ fontSize: ".75rem", fontWeight: 700, background: creditsRemaining > 0 ? "color-mix(in srgb, var(--accent) 12%, var(--surface))" : "#f56b6b22", border: `1px solid ${creditsRemaining > 0 ? "color-mix(in srgb, var(--accent) 30%, var(--border))" : "#f56b6b55"}`, color: creditsRemaining > 0 ? "var(--accent)" : "#f56b6b", borderRadius: 20, padding: ".2rem .7rem" }}>
            {creditsRemaining} assessment{creditsRemaining !== 1 ? "s" : ""} remaining
          </span>
        )}
      </div>
      <p>Configure an assessment and generate a shareable link for your candidate.</p>

      <div className="field-group">
        <label className="field-label">Problem brief</label>
        <div style={{ display: "flex", gap: ".5rem", marginBottom: ".75rem" }}>
          <button className={`radio-btn ${briefMode === "matrix" ? "sel" : ""}`} onClick={() => setBriefMode("matrix")}>Random matrix</button>
          <button className={`radio-btn ${briefMode === "custom" ? "sel" : ""}`} onClick={() => setBriefMode("custom")}>Custom brief</button>
        </div>
        {briefMode === "matrix" ? (
          <MatrixPicker selectedRow={rowId} selectedCol={colId} onSelect={(r, c) => { setRowId(r); setColId(c); }} />
        ) : (
          <textarea
            className="field-input"
            rows={5}
            placeholder="Write the full problem brief here. It will be shown to the candidate as the initial brief in Stage 1 (Clarify)."
            value={customBrief}
            onChange={(e) => setCustomBrief(e.target.value)}
            maxLength={2000}
            style={{ resize: "vertical" }}
          />
        )}
      </div>

      <div className="field-group">
        <label className="field-label">Candidate role calibration</label>
        <div className="role-row">
          {["Junior", "Mid", "Senior"].map((r) => (
            <button key={r} className={`radio-btn ${role === r ? "sel" : ""}`} onClick={() => setRole(r)}>{r}</button>
          ))}
        </div>
      </div>

      <div className="field-group">
        <label className="field-label">Link expiry</label>
        <div className="expiry-row">
          {[{ v: "24", l: "24 h" }, { v: "48", l: "48 h" }, { v: "168", l: "7 days" }, { v: "0", l: "Never" }].map(({ v, l }) => (
            <button key={v} className={`radio-btn ${expiresHours === v ? "sel" : ""}`} onClick={() => setExpiresHours(v)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="field-group">
        <label className="field-label">Candidate details (optional)</label>
        <input className="field-input" type="text" placeholder="Candidate name" value={candidateName} onChange={(e) => setCandidateName(e.target.value)} maxLength={120} />
        <input className="field-input" type="email" placeholder="Candidate email" value={candidateEmail} onChange={(e) => setCandidateEmail(e.target.value)} maxLength={254} />
      </div>

      <button
        onClick={createSession}
        disabled={(briefMode === "matrix" ? (!rowId || !colId) : !customBrief.trim()) || loading}
        style={{ width: "100%", padding: ".7rem", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: ".95rem", cursor: "pointer" }}
      >
        {loading ? "Creating session…" : "Generate assessment link"}
      </button>

      {sessionUrl && (
        <div className="session-link-box">
          <h3>Share this link with your candidate</h3>
          <span className="link-url">{sessionUrl}</span>
          <div className="link-actions">
            <button onClick={copyLink} style={{ flex: 1, padding: ".45rem .75rem", background: copied ? "#3ecf8e22" : "var(--surface)", border: `1px solid ${copied ? "#3ecf8e" : "var(--border)"}`, color: copied ? "#3ecf8e" : "inherit", borderRadius: 8, fontWeight: 600, fontSize: ".82rem", cursor: "pointer" }}>
              {copied ? "✓ Copied!" : "Copy link"}
            </button>
            <a href={sessionUrl} target="_blank" style={{ flex: 1, textAlign: "center", padding: ".45rem .75rem", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontWeight: 600, fontSize: ".82rem", color: "inherit", textDecoration: "none" }}>
              Preview →
            </a>
          </div>
          <p className="expiry-note">Expires: {expiryLabel === "Never expires" ? "Never" : `in ${expiryLabel}`} · Role: {role}</p>
        </div>
      )}
    </main>
  );
}
