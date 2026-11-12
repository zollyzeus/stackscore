"use client";

import { useEffect, useState } from "react";

/**
 * Reviewer queue (A3).
 *
 * Shows only what is needed to pick up work. No scores, no grades, no "the AI thought this
 * was weak" — the API does not send them, and this page could not display them if it tried.
 */

interface Task {
  id: string;
  candidateName: string | null;
  role: string | null;
  state: string;
  reason: string;
}

export default function ReviewQueuePage() {
  const [assigned, setAssigned] = useState<Task[]>([]);
  const [pool, setPool] = useState<Task[]>([]);
  const [completed, setCompleted] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/review/tasks");
      if (!res.ok) throw new Error(res.status === 403 ? "Not registered as a reviewer." : "Could not load tasks.");
      const data = await res.json();
      setAssigned(data.assigned ?? []);
      setPool(data.pool ?? []);
      setCompleted(data.completed ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load tasks.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function claim(id: string) {
    const res = await fetch("/api/review/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: id }),
    });
    if (res.status === 409) {
      const d = await res.json().catch(() => ({}));
      setError(d.by ? `Already claimed by ${d.by}.` : "Already claimed.");
      load();
      return;
    }
    if (res.ok) window.location.href = `/review/${id}`;
  }

  const Row = ({ t, action }: { t: Task; action: React.ReactNode }) => (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem",
      padding: "0.9rem 1rem", border: "1px solid var(--border, #2a2a3e)", borderRadius: 10,
      marginBottom: ".6rem",
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>
          {t.candidateName ?? "Candidate"}{t.role ? ` · ${t.role}` : ""}
        </div>
        <div style={{ fontSize: ".78rem", color: "var(--text-muted)", marginTop: 2 }}>
          Held because the AI judge failed. You are scoring this from scratch.
        </div>
      </div>
      {action}
    </div>
  );

  return (
    <main style={{ maxWidth: 820, margin: "3rem auto", padding: "0 1.5rem" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 800, marginBottom: ".3rem" }}>Review queue</h1>
      <p style={{ color: "var(--text-muted)", fontSize: ".9rem", marginBottom: "2rem" }}>
        These submissions could not be scored automatically. You will see the candidate&apos;s
        work and the rubric — never the AI&apos;s scores, which do not exist for these.
      </p>

      {error && (
        <div role="alert" style={{
          padding: "12px 14px", borderRadius: 10, marginBottom: "1.2rem",
          background: "rgba(163,51,51,0.12)", border: "1px solid #a33", color: "#ffb3b3",
          fontSize: ".9rem",
        }}>{error}</div>
      )}

      {loading ? <p style={{ color: "var(--text-muted)" }}>Loading…</p> : (
        <>
          <h2 style={{ fontSize: "1rem", fontWeight: 800, margin: "0 0 .8rem" }}>
            Assigned to you ({assigned.length})
          </h2>
          {assigned.length === 0
            ? <p style={{ color: "var(--text-muted)", fontSize: ".88rem", marginBottom: "2rem" }}>Nothing assigned.</p>
            : <div style={{ marginBottom: "2rem" }}>{assigned.map((t) => (
                <Row key={t.id} t={t} action={
                  <a className="lb-btn" href={`/review/${t.id}`} style={{ whiteSpace: "nowrap" }}>Review →</a>
                } />
              ))}</div>}

          <h2 style={{ fontSize: "1rem", fontWeight: 800, margin: "0 0 .8rem" }}>
            Unclaimed ({pool.length})
          </h2>
          {pool.length === 0
            ? <p style={{ color: "var(--text-muted)", fontSize: ".88rem", marginBottom: "2rem" }}>Queue is empty.</p>
            : <div style={{ marginBottom: "2rem" }}>{pool.map((t) => (
                <Row key={t.id} t={t} action={
                  <button className="lb-btn" onClick={() => claim(t.id)} style={{ whiteSpace: "nowrap" }}>Claim</button>
                } />
              ))}</div>}

          {completed.length > 0 && (
            <>
              <h2 style={{ fontSize: "1rem", fontWeight: 800, margin: "0 0 .8rem" }}>
                Completed ({completed.length})
              </h2>
              <div>{completed.map((t) => (
                <Row key={t.id} t={t} action={<span style={{ color: "#3ecf8e", fontWeight: 700 }}>Submitted</span>} />
              ))}</div>
            </>
          )}
        </>
      )}
    </main>
  );
}
