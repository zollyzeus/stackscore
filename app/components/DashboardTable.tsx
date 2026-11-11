"use client";

import { useState } from "react";
import DashboardRowActions from "./DashboardRowActions";

type ScoreRow = Record<string, unknown>;

function grade(score: number) {
  if (score >= 85) return { label: "Exceptional", color: "#3ecf8e" };
  if (score >= 70) return { label: "Strong", color: "#6c63ff" };
  if (score >= 55) return { label: "Proficient", color: "#5b8aff" };
  if (score >= 40) return { label: "Developing", color: "#f5a623" };
  return { label: "Needs Work", color: "#f56b6b" };
}

export default function DashboardTable({ rows, threshold }: { rows: ScoreRow[]; threshold: number }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) { next.delete(slug); return next; }
      if (next.size >= 3) return prev;
      next.add(slug);
      return next;
    });
  }

  if (!rows.length) {
    return (
      <div style={{ textAlign: "center", padding: "4rem 1.25rem", color: "var(--text-muted)" }}>
        <p style={{ fontSize: "2rem", marginBottom: ".5rem" }}>📋</p>
        <p>No assessments yet. Start one to see results here.</p>
      </div>
    );
  }

  return (
    <>
      <div style={{ overflowX: "auto", borderRadius: 12, border: "1px solid var(--border)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem" }}>
          <thead>
            <tr>
              <th scope="col" style={TH}>⊕</th>
              <th scope="col" style={TH}>Candidate</th>
              <th scope="col" style={TH}>Score</th>
              <th scope="col" style={TH}>Grade</th>
              <th scope="col" style={TH}>Design</th>
              <th scope="col" style={TH}>Code</th>
              <th scope="col" style={TH}>Role</th>
              <th scope="col" style={TH}>Domain × Level</th>
              <th scope="col" style={TH}>Date</th>
              <th scope="col" style={TH}>Pass / Fail</th>
              <th scope="col" style={TH}>Flags</th>
              <th scope="col" style={TH}>Decision / Notes</th>
              <th scope="col" style={TH}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const ss = s.stackScore as number;
              const { label: gradeLabel, color } = grade(ss);
              const ls = s.levelScores as { design: number; code: number } | undefined;
              const dateStr = s.createdAt &&
                typeof (s.createdAt as { toDate?: () => Date }).toDate === "function"
                ? (s.createdAt as { toDate: () => Date }).toDate().toLocaleDateString("en-IN", { day: "numeric", month: "short" })
                : "";
              const passed = ss >= threshold;
              const slug = s.publicSlug as string;
              const isChecked = selected.has(slug);

              return (
                <tr key={s.docId as string} style={{ background: isChecked ? "var(--accent)08" : undefined }}>
                  <td style={TD}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggle(slug)}
                      disabled={!isChecked && selected.size >= 3}
                      title={selected.size >= 3 && !isChecked ? "Max 3 candidates" : "Select for comparison"}
                      style={{ cursor: "pointer", accentColor: "var(--accent)", width: 15, height: 15 }}
                    />
                  </td>
                  <td style={{ ...TD, maxWidth: 160 }}>
                    {!!s.candidateName && <div style={{ fontWeight: 600, fontSize: ".83rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.candidateName as string}</div>}
                    {!!s.candidateEmail && <div style={{ fontSize: ".72rem", color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.candidateEmail as string}</div>}
                    {!s.candidateName && !s.candidateEmail && <span style={{ color: "var(--text-muted)" }}>-</span>}
                  </td>
                  <td style={TD}><span style={{ display: "inline-block", padding: ".2rem .55rem", borderRadius: 999, fontSize: ".78rem", fontWeight: 700, background: `${color}22`, color }}>{ss}</span></td>
                  <td style={{ ...TD, color, fontWeight: 600, fontSize: ".82rem" }}>{gradeLabel}</td>
                  <td style={{ ...TD, color: "var(--design-color)", fontWeight: 600 }}>{ls?.design ?? "-"}</td>
                  <td style={{ ...TD, color: "var(--code-color)", fontWeight: 600 }}>{ls?.code ?? "-"}</td>
                  <td style={{ ...TD, color: "var(--text-muted)" }}>{(s.role as string) ?? "-"}</td>
                  <td style={{ ...TD, color: "var(--text-muted)", fontSize: ".78rem" }}>{[s.rowLabel, s.columnLabel].filter(Boolean).join(" × ") || "-"}</td>
                  <td style={{ ...TD, color: "var(--text-muted)" }}>{dateStr}</td>
                  <td style={TD}><span style={{ display: "inline-block", padding: ".15rem .5rem", borderRadius: 999, fontSize: ".72rem", fontWeight: 700, background: passed ? "#3ecf8e22" : "#f56b6b22", color: passed ? "#3ecf8e" : "#f56b6b" }}>{passed ? "Pass" : "Fail"}</span></td>
                  <td style={TD}>
                    <div style={{ display: "flex", flexDirection: "column", gap: ".2rem", fontSize: ".72rem" }}>
                      {!!s.fastSubmit && <span title={`Fast: ${(s.fastSubmitStages as string[] | undefined)?.join(", ") ?? "?"}`} style={{ color: "#f5a623", fontWeight: 700 }}>⚡ Fast</span>}
                      {(s.tabSwitchCount as number) > 0 && <span title={`Tab switched ${s.tabSwitchCount} time(s)`} style={{ color: "#f56b6b", fontWeight: 700 }}>👁 {s.tabSwitchCount as number}× tab</span>}
                      {!!s.similarToSessionId && <span title={`${String(s.similarityScore ?? "?")}% similar to another submission`} style={{ color: "#c084fc", fontWeight: 700 }}>🔁 {String(s.similarityScore ?? "?")}% similar</span>}
                      {!s.fastSubmit && !((s.tabSwitchCount as number) > 0) && !s.similarToSessionId && <span style={{ color: "var(--text-muted)" }}>-</span>}
                    </div>
                  </td>
                  <td style={TD}>
                    <DashboardRowActions
                      sessionId={s.docId as string}
                      initialDecision={s.decision as "shortlist" | "hold" | "reject" | undefined}
                      initialNotes={s.notes as string | undefined}
                      scoreSlug={slug}
                    />
                  </td>
                  <td style={TD}><a href={`/score/${slug}`} style={{ fontSize: ".78rem", color: "var(--accent)", textDecoration: "none" }} target="_blank">View →</a></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Floating compare bar */}
      {selected.size > 0 && (
        <div style={{ position: "fixed", bottom: "1.5rem", left: "50%", transform: "translateX(-50%)", background: "var(--surface)", border: "1px solid var(--accent)", borderRadius: 12, padding: ".7rem 1.25rem", display: "flex", alignItems: "center", gap: ".75rem", boxShadow: "0 4px 24px #0006", zIndex: 100, fontSize: ".85rem", whiteSpace: "nowrap" }}>
          <span style={{ color: "var(--text-muted)", fontSize: ".78rem" }}>{selected.size} selected</span>
          {Array.from(selected).map((slug) => (
            <span key={slug} style={{ background: "var(--accent)22", color: "var(--accent)", borderRadius: 6, padding: ".15rem .55rem", fontSize: ".75rem" }}>
              {slug.slice(0, 8)}…
              <button onClick={() => toggle(slug)} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", marginLeft: ".2rem", fontSize: ".75rem" }}>✕</button>
            </span>
          ))}
          <a
            href={`/compare?slugs=${Array.from(selected).join(",")}`}
            style={{ background: selected.size >= 2 ? "var(--accent)" : "var(--border)", color: "#fff", border: "none", borderRadius: 8, padding: ".4rem .9rem", fontWeight: 700, fontSize: ".82rem", textDecoration: "none", pointerEvents: selected.size >= 2 ? "auto" : "none", opacity: selected.size >= 2 ? 1 : 0.5 }}
          >
            Compare →
          </a>
        </div>
      )}
    </>
  );
}

const TH: React.CSSProperties = {
  textAlign: "left", fontSize: ".7rem", fontWeight: 700, letterSpacing: ".08em",
  textTransform: "uppercase", color: "var(--text-muted)", padding: ".6rem .9rem",
  background: "var(--surface)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
};
const TD: React.CSSProperties = { padding: ".65rem .9rem", borderBottom: "1px solid var(--border)", verticalAlign: "middle" };
