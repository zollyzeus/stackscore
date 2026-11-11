"use client";

import { useEffect, useState } from "react";

interface Attempt {
  date: string;
  stackScore: number;
  design: number;
  code: number;
  scoreCardUrl: string;
}

export default function AttemptTrajectory({ candidateEmail }: { candidateEmail: string }) {
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);

  useEffect(() => {
    fetch(`/api/trajectory?email=${encodeURIComponent(candidateEmail)}`)
      .then((r) => r.json())
      .then((d) => { if (d.attempts?.length >= 2) setAttempts(d.attempts); })
      .catch(() => {});
  }, [candidateEmail]);

  if (!attempts) return null;

  const max = 100;

  return (
    <div style={{ marginBottom: "2rem" }}>
      <div style={{ fontSize: ".72rem", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: ".75rem", display: "flex", alignItems: "center", gap: ".5rem" }}>
        Score trajectory
        <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: "1rem", overflowX: "auto", padding: ".5rem 0 .25rem" }}>
        {attempts.map((a, i) => {
          const delta = i > 0 ? a.stackScore - attempts[i - 1].stackScore : null;
          const pct = (a.stackScore / max) * 100;
          const color = a.stackScore >= 70 ? "#6c63ff" : a.stackScore >= 55 ? "#5b8aff" : "#f5a623";
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: ".3rem", minWidth: 60 }}>
              <div style={{ fontSize: ".75rem", fontWeight: 700, color }}>
                {a.stackScore}
                {delta !== null && (
                  <span style={{ fontSize: ".68rem", marginLeft: ".2rem", color: delta > 0 ? "#3ecf8e" : delta < 0 ? "#f56b6b" : "var(--text-muted)" }}>
                    {delta > 0 ? `+${delta}` : delta < 0 ? String(delta) : "="}
                  </span>
                )}
              </div>
              <a
                href={a.scoreCardUrl}
                title={`Attempt ${i + 1}: ${a.date}`}
                style={{ display: "block", textDecoration: "none" }}
              >
                <div style={{ width: 32, background: color, borderRadius: 4, height: `${Math.max(pct * 0.8, 8)}px` }} />
              </a>
              <div style={{ fontSize: ".62rem", color: "var(--text-muted)", textAlign: "center" }}>#{i + 1}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
