"use client";

import { useState, useRef } from "react";

type Decision = "shortlist" | "hold" | "reject" | null;

interface Props {
  sessionId: string;
  initialDecision?: Decision;
  initialNotes?: string;
  scoreSlug?: string;
}

const DECISIONS: { value: Decision; label: string; color: string; bg: string }[] = [
  { value: "shortlist", label: "✓",  color: "#3ecf8e", bg: "#3ecf8e22" },
  { value: "hold",      label: "⊙",  color: "#f5a623", bg: "#f5a62322" },
  { value: "reject",    label: "✕",  color: "#f56b6b", bg: "#f56b6b22" },
];

export default function DashboardRowActions({ sessionId, initialDecision, initialNotes, scoreSlug }: Props) {
  const [decision, setDecision] = useState<Decision>(initialDecision ?? null);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [editingNotes, setEditingNotes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reEvalStatus, setReEvalStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const notesRef = useRef<HTMLTextAreaElement>(null);

  async function handleDecision(next: Decision) {
    const val = decision === next ? null : next; // toggle off if already selected
    setDecision(val);
    setSaving(true);
    try {
      await fetch("/api/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, decision: val }),
      });
    } catch { /* non-fatal */ }
    setSaving(false);
  }

  async function reEvaluate() {
    setReEvalStatus("running");
    try {
      const res = await fetch("/api/re-evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      setReEvalStatus(res.ok ? "done" : "error");
    } catch { setReEvalStatus("error"); }
    setTimeout(() => setReEvalStatus("idle"), 3000);
  }

  async function saveNotes() {
    setEditingNotes(false);
    setSaving(true);
    try {
      await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, notes }),
      });
    } catch { /* non-fatal */ }
    setSaving(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: ".35rem", minWidth: 120 }}>
      {/* Decision buttons */}
      <div style={{ display: "flex", gap: ".25rem" }}>
        {DECISIONS.map((d) => {
          const active = decision === d.value;
          return (
            <button
              key={d.value}
              title={d.value!.charAt(0).toUpperCase() + d.value!.slice(1)}
              disabled={saving}
              onClick={() => handleDecision(d.value)}
              style={{
                width: 26, height: 26, border: "1px solid",
                borderColor: active ? d.color : "var(--border)",
                borderRadius: 6, fontSize: ".8rem", fontWeight: 700, cursor: "pointer",
                background: active ? d.bg : "transparent",
                color: active ? d.color : "var(--text-muted)",
                transition: "all .12s",
              }}
            >
              {d.label}
            </button>
          );
        })}
      </div>

      {/* Re-evaluate */}
      <button
        title="Re-run judge on this submission"
        disabled={saving || reEvalStatus === "running"}
        onClick={reEvaluate}
        style={{
          fontSize: ".72rem", border: "1px solid var(--border)", borderRadius: 6,
          padding: ".2rem .5rem", background: "transparent", cursor: "pointer",
          color: reEvalStatus === "done" ? "#3ecf8e" : reEvalStatus === "error" ? "#f56b6b" : "var(--text-muted)",
          borderColor: reEvalStatus === "done" ? "#3ecf8e" : reEvalStatus === "error" ? "#f56b6b" : "var(--border)",
        }}
      >
        {reEvalStatus === "running" ? "⟳ Re-scoring…" : reEvalStatus === "done" ? "✓ Re-scored" : reEvalStatus === "error" ? "✕ Error" : "⟳ Re-score"}
      </button>

      {/* Notes */}
      {editingNotes ? (
        <textarea
          ref={notesRef}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
          onKeyDown={(e) => { if (e.key === "Escape") saveNotes(); }}
          rows={2}
          autoFocus
          placeholder="Add a note…"
          style={{
            fontSize: ".75rem", width: "100%", border: "1px solid var(--border)",
            borderRadius: 6, padding: ".25rem .4rem", background: "var(--surface)",
            color: "inherit", resize: "none",
          }}
        />
      ) : (
        <button
          onClick={() => { setEditingNotes(true); setTimeout(() => notesRef.current?.focus(), 10); }}
          style={{
            fontSize: ".72rem", textAlign: "left", border: "1px dashed var(--border)",
            borderRadius: 6, padding: ".2rem .4rem", background: "transparent",
            color: notes ? "var(--fg)" : "var(--text-muted)", cursor: "text",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160,
          }}
          title={notes || "Add a note"}
        >
          {notes || "Add note…"}
        </button>
      )}
    </div>
  );
}
