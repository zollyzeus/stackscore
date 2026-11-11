"use client";

import { useState } from "react";

const STAGE_LABELS: Record<string, string> = {
  clarify: "Stage 1 · Clarify",
  propose: "Stage 2 · Propose",
  build: "Stage 3 · Build",
  adapt: "Stage 4 · Adapt",
  debug: "Stage 5 · Debug",
};

interface Entry {
  role?: string;
  text?: string;
  code?: string;
  at?: string;
  elapsedSeconds?: number;
}

export default function TranscriptViewer({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [transcript, setTranscript] = useState<Record<string, Entry[]> | null>(null);
  const [error, setError] = useState("");

  async function load() {
    if (transcript) { setOpen((v) => !v); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch(`/api/transcript/${sessionId}`);
      if (!res.ok) { setError("Could not load transcript."); return; }
      const data = await res.json();
      setTranscript(data.transcript);
      setOpen(true);
    } catch { setError("Could not load transcript."); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ marginBottom: "2rem" }}>
      <button
        onClick={load}
        style={{ background: "none", border: "1px solid var(--border)", borderRadius: 8, padding: ".4rem .9rem", fontSize: ".78rem", fontWeight: 700, cursor: "pointer", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".07em" }}
      >
        {loading ? "Loading…" : open ? "▲ Hide full transcript" : "📄 View full submission transcript"}
      </button>
      {error && <p style={{ fontSize: ".78rem", color: "#f56b6b", marginTop: ".5rem" }}>{error}</p>}

      {open && transcript && (
        <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {["clarify", "propose", "build", "adapt", "debug"].map((stage) => {
            const entries = transcript[stage] ?? [];
            if (!entries.length) return null;
            return (
              <div key={stage}>
                <div style={{ fontSize: ".7rem", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: ".6rem" }}>
                  {STAGE_LABELS[stage] ?? stage}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: ".5rem" }}>
                  {entries.map((entry, i) => {
                    const isStakeholder = entry.role === "stakeholder";
                    const content = entry.text ?? entry.code ?? "";
                    if (!content) return null;
                    return (
                      <div key={i} style={{
                        background: isStakeholder ? "var(--surface)" : "var(--accent)11",
                        border: `1px solid ${isStakeholder ? "var(--border)" : "var(--accent)44"}`,
                        borderRadius: 8, padding: ".6rem .9rem",
                      }}>
                        <div style={{ fontSize: ".68rem", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: isStakeholder ? "var(--text-muted)" : "var(--accent)", marginBottom: ".35rem" }}>
                          {isStakeholder ? "Stakeholder" : "Candidate"}
                          {entry.at && <span style={{ fontWeight: 400, marginLeft: ".5rem" }}>{new Date(entry.at).toLocaleTimeString()}</span>}
                          {entry.elapsedSeconds != null && <span style={{ fontWeight: 400, marginLeft: ".5rem" }}>({Math.floor(entry.elapsedSeconds / 60)}m {entry.elapsedSeconds % 60}s elapsed)</span>}
                        </div>
                        {entry.code ? (
                          <pre style={{ margin: 0, fontSize: ".75rem", whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--fg)" }}>{content}</pre>
                        ) : (
                          <p style={{ margin: 0, fontSize: ".83rem", lineHeight: 1.6, color: "var(--fg)" }}>{content}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
