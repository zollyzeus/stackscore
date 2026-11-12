"use client";

import { useEffect, useState } from "react";
import rubric from "../../../data/rubric.json";

/**
 * Blind review form (A3).
 *
 * The reviewer sees the candidate's submission and the rubric — including the anchor bands,
 * which is the point: the anchors exist so a 0-100 scale means the same thing to a human as
 * it does to the judge. They never see the AI's scores, and the server never sends them
 * (see app/api/review/submission/route.ts). Hiding them client-side would not be hiding.
 */

interface Axis { id: string; label: string; description: string; anchors?: Record<string, string>; note?: string }
interface Submission {
  sessionId: string;
  brief: string;
  role: string | null;
  rowLabel: string | null;
  columnLabel: string | null;
  candidateName: string | null;
  stages: { clarifying: string; design: string; code: string; twist: string; debug: string };
  task: { state: string; assignedTo: string | null };
}

const AXES: Axis[] = rubric.levels.flatMap((l) =>
  l.axes.map((a) => ({
    id: a.id,
    label: a.label,
    description: a.description,
    anchors: (a as { anchors?: Record<string, string> }).anchors,
    note: (a as { note?: string }).note,
  }))
);
const BANDS = rubric.scale.bands;

function Stage({ title, body }: { title: string; body: string }) {
  return (
    <section style={{ marginBottom: "1.6rem" }}>
      <h3 style={{ fontSize: ".82rem", fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: ".5rem" }}>
        {title}
      </h3>
      {body.trim()
        ? <pre style={{
            whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: ".85rem", lineHeight: 1.6,
            background: "var(--surface, rgba(255,255,255,0.03))", border: "1px solid var(--border, #2a2a3e)",
            borderRadius: 10, padding: "1rem", margin: 0, fontFamily: "ui-monospace, monospace",
          }}>{body}</pre>
        : <p style={{ color: "var(--text-muted)", fontSize: ".85rem", fontStyle: "italic" }}>Nothing submitted for this stage.</p>}
    </section>
  );
}

export default function ReviewPage({ params }: { params: { sessionId: string } }) {
  const [sub, setSub] = useState<Submission | null>(null);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ stackScore: number } | null>(null);

  useEffect(() => {
    fetch(`/api/review/submission?sessionId=${encodeURIComponent(params.sessionId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 403 ? "This submission is assigned to another reviewer." : "Could not load the submission.");
        return r.json();
      })
      .then(setSub)
      .catch((e) => setError(e.message));
  }, [params.sessionId]);

  async function submit() {
    setSaving(true);
    setError("");
    setMissing([]);
    try {
      const res = await fetch("/api/review/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: params.sessionId, scores, feedback, notes }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 400 && data.error === "incomplete") {
        setMissing([...(data.missing ?? []), ...(data.invalid ?? [])]);
        setError("Every axis needs a score from 0 to 100 before this can be submitted.");
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Could not submit the review.");
      setDone({ stackScore: data.stackScore });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit the review.");
    } finally {
      setSaving(false);
    }
  }

  if (error && !sub) {
    return <main style={{ maxWidth: 680, margin: "5rem auto", padding: "0 1.5rem" }}>
      <p role="alert" style={{ color: "#ffb3b3" }}>{error}</p>
      <p style={{ marginTop: "1rem" }}><a href="/review">← Back to the queue</a></p>
    </main>;
  }
  if (!sub) return <main style={{ maxWidth: 680, margin: "5rem auto", padding: "0 1.5rem" }}><p>Loading…</p></main>;

  if (done) {
    return <main style={{ maxWidth: 680, margin: "5rem auto", padding: "0 1.5rem" }}>
      <h1 style={{ fontSize: "1.4rem", fontWeight: 800 }}>Review submitted</h1>
      <p style={{ color: "var(--text-muted)", marginTop: ".6rem" }}>
        StackScore {done.stackScore}/100. The candidate&apos;s score card now shows this as a
        human-reviewed result.
      </p>
      <p style={{ marginTop: "1.4rem" }}><a className="lb-btn" href="/review">← Back to the queue</a></p>
    </main>;
  }

  return (
    <main style={{ maxWidth: 980, margin: "2.5rem auto", padding: "0 1.5rem" }}>
      <p style={{ marginBottom: "1rem" }}><a href="/review" style={{ fontSize: ".85rem" }}>← Queue</a></p>
      <h1 style={{ fontSize: "1.4rem", fontWeight: 800, marginBottom: ".3rem" }}>
        Review: {sub.candidateName ?? "Candidate"}{sub.role ? ` · ${sub.role}` : ""}
      </h1>
      <div style={{
        padding: "10px 13px", borderRadius: 9, marginBottom: "1.8rem", fontSize: ".83rem",
        background: "rgba(108,99,255,0.1)", border: "1px solid #6c63ff", color: "#c9c5ff",
      }}>
        The AI judge produced no scores for this submission, and none are shown to you by
        design. Score it as you would a submission you were handed cold.
      </div>

      <Stage title="Problem brief" body={sub.brief} />
      <Stage title="Stage 1 — Clarifying Q&A" body={sub.stages.clarifying} />
      <Stage title="Stage 2 — Design proposal" body={sub.stages.design} />
      <Stage title="Stage 3 — Code" body={sub.stages.code} />
      <Stage title="Stage 4 — Twist response" body={sub.stages.twist} />
      <Stage title="Stage 5 — Debug response" body={sub.stages.debug} />

      <h2 style={{ fontSize: "1.1rem", fontWeight: 800, margin: "2.4rem 0 .4rem" }}>Scoring</h2>
      <p style={{ color: "var(--text-muted)", fontSize: ".85rem", marginBottom: "1.4rem" }}>
        {rubric.scale.note}
      </p>

      {AXES.map((ax) => (
        <div key={ax.id} style={{
          border: `1px solid ${missing.includes(ax.id) ? "#a33" : "var(--border, #2a2a3e)"}`,
          borderRadius: 10, padding: "1rem", marginBottom: "1rem",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start" }}>
            <div>
              <strong style={{ fontSize: ".95rem" }}>{ax.id} — {ax.label}</strong>
              <div style={{ color: "var(--text-muted)", fontSize: ".83rem", marginTop: 2 }}>{ax.description}</div>
            </div>
            <input
              type="number" min={0} max={100} inputMode="numeric"
              aria-label={`${ax.id} score`}
              value={scores[ax.id] ?? ""}
              onChange={(e) => setScores((s) => ({ ...s, [ax.id]: e.target.value }))}
              style={{
                width: 84, padding: ".5rem .6rem", borderRadius: 8, textAlign: "center",
                border: "1px solid var(--border, #2a2a3e)", background: "transparent",
                color: "inherit", fontSize: "1rem", fontWeight: 700,
              }}
            />
          </div>

          {ax.note && (
            <p style={{ fontSize: ".8rem", color: "#ffd9a3", marginTop: ".6rem" }}>{ax.note}</p>
          )}
          {ax.anchors && (
            <ul style={{ margin: ".7rem 0 0", padding: 0, listStyle: "none", fontSize: ".8rem", lineHeight: 1.5 }}>
              {BANDS.map((b) => (
                <li key={b} style={{ display: "flex", gap: ".6rem", marginBottom: ".3rem" }}>
                  <span style={{ fontWeight: 800, color: "var(--text-muted)", minWidth: 58 }}>{b}</span>
                  <span style={{ color: "var(--text-muted)" }}>{ax.anchors?.[b]}</span>
                </li>
              ))}
              {ax.anchors.scoredElsewhere && (
                <li style={{ marginTop: ".4rem", color: "#9ad", fontStyle: "italic" }}>
                  Not this axis: {ax.anchors.scoredElsewhere}
                </li>
              )}
            </ul>
          )}

          <textarea
            placeholder={`Feedback for ${ax.id} (optional)`}
            aria-label={`${ax.id} feedback`}
            value={feedback[ax.id] ?? ""}
            onChange={(e) => setFeedback((f) => ({ ...f, [ax.id]: e.target.value }))}
            rows={2}
            style={{
              width: "100%", marginTop: ".7rem", padding: ".55rem .7rem", borderRadius: 8,
              border: "1px solid var(--border, #2a2a3e)", background: "transparent",
              color: "inherit", fontSize: ".85rem", fontFamily: "inherit", resize: "vertical",
            }}
          />
        </div>
      ))}

      <label style={{ display: "block", fontWeight: 700, margin: "1.6rem 0 .5rem" }}>
        Overall notes (optional)
      </label>
      <textarea
        value={notes} onChange={(e) => setNotes(e.target.value)} rows={4}
        aria-label="Overall notes"
        style={{
          width: "100%", padding: ".7rem", borderRadius: 9, border: "1px solid var(--border, #2a2a3e)",
          background: "transparent", color: "inherit", fontSize: ".9rem", fontFamily: "inherit",
        }}
      />

      {error && (
        <div role="alert" style={{
          marginTop: "1.2rem", padding: "12px 14px", borderRadius: 10,
          background: "rgba(163,51,51,0.12)", border: "1px solid #a33", color: "#ffb3b3", fontSize: ".88rem",
        }}>
          {error}
          {missing.length > 0 && <div style={{ marginTop: ".4rem" }}>Missing or invalid: {missing.join(", ")}</div>}
        </div>
      )}

      <button
        className="lb-btn" onClick={submit} disabled={saving}
        style={{ marginTop: "1.6rem", width: "100%", padding: ".9rem" }}
      >
        {saving ? "Submitting…" : "Submit review"}
      </button>
    </main>
  );
}
