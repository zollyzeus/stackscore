"use client";

import { useState } from "react";

type Decision = "shortlist" | "hold" | "reject" | null;
type ScoreRow = Record<string, unknown>;

const COLUMNS: { id: Decision | "unreviewed"; label: string; color: string }[] = [
  { id: "unreviewed", label: "Pending review",   color: "var(--text-muted)" },
  { id: "shortlist",  label: "Shortlisted",       color: "#3ecf8e" },
  { id: "hold",       label: "On hold",           color: "#f5a623" },
  { id: "reject",     label: "Rejected",          color: "#f56b6b" },
];

function grade(score: number) {
  if (score >= 85) return "#3ecf8e";
  if (score >= 70) return "#6c63ff";
  if (score >= 55) return "#5b8aff";
  if (score >= 40) return "#f5a623";
  return "#f56b6b";
}

export default function KanbanBoard({ initialRows }: { initialRows: ScoreRow[] }) {
  const [rows, setRows] = useState<ScoreRow[]>(initialRows);
  const [dragging, setDragging] = useState<string | null>(null);

  async function moveTo(docId: string, decision: Decision | "unreviewed") {
    const actual: Decision = decision === "unreviewed" ? null : decision;
    setRows((prev) => prev.map((r) => r.docId === docId ? { ...r, decision: actual } : r));
    try {
      await fetch("/api/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: docId, decision: actual }),
      });
    } catch { /* non-fatal */ }
  }

  function onDrop(e: React.DragEvent, colId: Decision | "unreviewed") {
    e.preventDefault();
    if (dragging) {
      moveTo(dragging, colId);
      setDragging(null);
    }
  }

  const colRows = (colId: Decision | "unreviewed") =>
    rows.filter((r) => {
      const d = r.decision as Decision;
      return colId === "unreviewed" ? !d : d === colId;
    });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "1rem" }}>
      {COLUMNS.map((col) => {
        const cards = colRows(col.id);
        return (
          <div
            key={String(col.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDrop(e, col.id)}
            style={{ background: "var(--surface)", border: "1px solid var(--border)", borderTop: `3px solid ${col.color}`, borderRadius: 12, padding: "1rem", minHeight: 300 }}
          >
            <div style={{ fontSize: ".72rem", fontWeight: 800, letterSpacing: ".09em", textTransform: "uppercase", color: col.color, marginBottom: ".75rem" }}>
              {col.label} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>({cards.length})</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: ".6rem" }}>
              {cards.map((r) => {
                const ss = r.stackScore as number;
                const c = grade(ss);
                const docId = r.docId as string;
                return (
                  <div
                    key={docId}
                    draggable
                    onDragStart={() => setDragging(docId)}
                    onDragEnd={() => setDragging(null)}
                    style={{ background: "var(--bg)", border: "1px solid var(--border)", borderLeft: `3px solid ${c}`, borderRadius: 8, padding: ".65rem .75rem", cursor: "grab", opacity: dragging === docId ? 0.5 : 1, transition: "opacity .15s" }}
                  >
                    <div style={{ fontWeight: 700, fontSize: ".83rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{(r.candidateName as string) ?? (r.candidateEmail as string) ?? "Anonymous"}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: ".5rem", marginTop: ".3rem" }}>
                      <span style={{ fontSize: ".9rem", fontWeight: 800, color: c }}>{ss}</span>
                      <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>{(r.role as string) ?? ""}</span>
                    </div>
                    {!!r.notes && <div style={{ fontSize: ".72rem", color: "var(--text-muted)", marginTop: ".3rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={r.notes as string}>{r.notes as string}</div>}
                    <div style={{ display: "flex", gap: ".4rem", marginTop: ".5rem", flexWrap: "wrap" }}>
                      <a href={`/score/${r.publicSlug}`} target="_blank" style={{ fontSize: ".72rem", color: "var(--accent)", textDecoration: "none" }}>View →</a>
                      {COLUMNS.filter((c2) => c2.id !== col.id && c2.id !== "unreviewed").map((c2) => (
                        <button key={String(c2.id)} onClick={() => moveTo(docId, c2.id)} style={{ fontSize: ".68rem", border: "1px solid var(--border)", borderRadius: 5, background: "transparent", color: c2.color, cursor: "pointer", padding: ".1rem .4rem", fontWeight: 600 }}>→ {c2.label}</button>
                      ))}
                      {col.id !== "unreviewed" && (
                        <button onClick={() => moveTo(docId, "unreviewed")} style={{ fontSize: ".68rem", border: "1px solid var(--border)", borderRadius: 5, background: "transparent", color: "var(--text-muted)", cursor: "pointer", padding: ".1rem .4rem" }}>✕ Clear</button>
                      )}
                    </div>
                  </div>
                );
              })}
              {cards.length === 0 && (
                <div style={{ fontSize: ".78rem", color: "var(--text-muted)", textAlign: "center", padding: "2rem 0" }}>Drop cards here</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
