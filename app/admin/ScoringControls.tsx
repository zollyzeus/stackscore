"use client";

import { useEffect, useState } from "react";

/**
 * Scoring hold and calibration status (B5), plus the reviewer registry and the manual
 * verification queue (A3).
 *
 * Two separate switches, deliberately, because they answer different questions:
 *
 *   "Automatic hold"  — may the hourly monitor pause scoring on its own? Default OFF.
 *   "Hold now"        — is scoring paused right now, by a person?
 *
 * Collapsing them into one control would make the dangerous case invisible: an operator
 * flipping "pause scoring" would not be able to tell whether they were stopping the
 * pipeline now or arming an automation to stop it later, unattended, at 3am.
 */

interface Failure { fixtureId: string; axis: string; band: [number, number]; observed: number | null; why: string }
interface State {
  settings: { scoringHoldEnabled: boolean };
  hold: { active: boolean; reason?: string; automatic?: boolean; since?: string };
  calibration: {
    fingerprint: string | null;
    lastOkAt: string | null;
    lastResult: { ok: boolean; checkedAt: string; fingerprintChanged: boolean; failures: Failure[]; notes: string[] } | null;
  } | null;
}
interface Task {
  sessionId: string; publicSlug: string; state: string;
  assignedTo: string | null; candidateName: string | null; role: string | null; reason: string;
}

const card: React.CSSProperties = {
  border: "1px solid var(--border, #2a2a3e)", borderRadius: 12,
  padding: "1.1rem 1.2rem", marginBottom: "1.2rem",
};

export default function ScoringControls() {
  const [state, setState] = useState<State | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [reviewers, setReviewers] = useState<{ email: string; active?: boolean }[]>([]);
  const [newReviewer, setNewReviewer] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function load() {
    const [s, t, r] = await Promise.all([
      fetch("/api/admin/settings").then((x) => x.ok ? x.json() : null).catch(() => null),
      fetch("/api/admin/review-queue").then((x) => x.ok ? x.json() : null).catch(() => null),
      fetch("/api/admin/reviewers").then((x) => x.ok ? x.json() : null).catch(() => null),
    ]);
    if (s) setState(s);
    if (t) setTasks(t.tasks ?? []);
    if (r) setReviewers(r.reviewers ?? []);
  }
  useEffect(() => { load(); }, []);

  async function post(url: string, body: unknown, ok: string) {
    setBusy(true); setMsg("");
    try {
      const res = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      setMsg(res.ok ? ok : (d.message ?? d.error ?? "Failed."));
      await load();
    } finally { setBusy(false); }
  }

  if (!state) return null;

  const cal = state.calibration?.lastResult;
  const activeReviewers = reviewers.filter((r) => r.active !== false);

  return (
    <section style={{ marginTop: "2.5rem" }}>
      <h2 style={{ fontSize: "1.15rem", fontWeight: 800, marginBottom: "1rem" }}>
        Scoring &amp; calibration
      </h2>

      {msg && <p style={{ fontSize: ".85rem", color: "var(--text-muted)", marginBottom: ".8rem" }}>{msg}</p>}

      {/* Calibration status */}
      <div style={card}>
        <strong style={{ display: "block", marginBottom: ".5rem" }}>Calibration probe</strong>
        {!cal ? (
          <p style={{ color: "var(--text-muted)", fontSize: ".86rem" }}>
            Has not run yet. The hourly monitor records its result here.
          </p>
        ) : (
          <>
            <p style={{ fontSize: ".9rem", marginBottom: ".4rem" }}>
              <span style={{
                fontWeight: 800,
                color: cal.ok ? "#3ecf8e" : "#ef4444",
              }}>{cal.ok ? "Passing" : "FAILING"}</span>
              <span style={{ color: "var(--text-muted)", marginLeft: ".6rem", fontSize: ".82rem" }}>
                checked {new Date(cal.checkedAt).toLocaleString()}
              </span>
            </p>
            {cal.fingerprintChanged && (
              <p style={{ fontSize: ".84rem", color: "#ffd9a3", marginBottom: ".4rem" }}>
                The rubric or judge changed since the last check — the committed sweep
                results describe a different judge and are now stale. Re-run the full sweep.
              </p>
            )}
            {cal.failures.length > 0 && (
              <ul style={{ margin: ".4rem 0 0 1rem", padding: 0, fontSize: ".83rem", color: "#ffb3b3" }}>
                {cal.failures.map((f, i) => (
                  <li key={i} style={{ marginBottom: ".25rem" }}>
                    {f.fixtureId}/{f.axis}: {f.observed ?? "no result"} (needs {f.band[0]}–{f.band[1]})
                  </li>
                ))}
              </ul>
            )}
            {cal.notes.map((n, i) => (
              <p key={i} style={{ fontSize: ".8rem", color: "var(--text-muted)", marginTop: ".4rem" }}>{n}</p>
            ))}
          </>
        )}
      </div>

      {/* The two switches */}
      <div style={card}>
        <label style={{ display: "flex", gap: ".7rem", alignItems: "flex-start", cursor: "pointer" }}>
          <input
            type="checkbox" disabled={busy}
            checked={state.settings.scoringHoldEnabled}
            onChange={(e) => post("/api/admin/settings", { scoringHoldEnabled: e.target.checked },
              e.target.checked ? "Automatic hold enabled." : "Automatic hold disabled.")}
            style={{ marginTop: 3 }}
          />
          <span>
            <strong>Let the monitor pause scoring automatically</strong>
            <span style={{ display: "block", color: "var(--text-muted)", fontSize: ".83rem", marginTop: 2 }}>
              Off by default. When on, a failed hourly calibration probe pauses all judging
              until the probe passes again. Candidates can still submit — their work is
              queued, never lost — but no scores are produced. Leave this off unless you are
              watching the system.
            </span>
          </span>
        </label>
      </div>

      <div style={{ ...card, borderColor: state.hold.active ? "#a33" : undefined }}>
        <label style={{ display: "flex", gap: ".7rem", alignItems: "flex-start", cursor: "pointer" }}>
          <input
            type="checkbox" disabled={busy}
            checked={state.hold.active}
            onChange={(e) => post("/api/admin/settings", { holdActive: e.target.checked },
              e.target.checked ? "Scoring paused." : "Scoring resumed.")}
            style={{ marginTop: 3 }}
          />
          <span>
            <strong style={{ color: state.hold.active ? "#ffb3b3" : undefined }}>
              Pause scoring now
            </strong>
            <span style={{ display: "block", color: "var(--text-muted)", fontSize: ".83rem", marginTop: 2 }}>
              {state.hold.active
                ? `Paused since ${state.hold.since ? new Date(state.hold.since).toLocaleString() : "unknown"}`
                  + ` — ${state.hold.reason ?? "no reason recorded"}`
                  + (state.hold.automatic ? " (engaged by the monitor)" : " (engaged manually)")
                : "Submissions are being judged normally."}
            </span>
          </span>
        </label>
      </div>

      {/* Reviewer registry */}
      <div style={card}>
        <strong style={{ display: "block", marginBottom: ".6rem" }}>
          Reviewers ({activeReviewers.length})
        </strong>
        <div style={{ display: "flex", gap: ".5rem", marginBottom: ".7rem" }}>
          <input
            type="email" placeholder="reviewer@company.com" value={newReviewer}
            onChange={(e) => setNewReviewer(e.target.value)}
            style={{
              flex: 1, padding: ".45rem .6rem", borderRadius: 8, fontSize: ".86rem",
              border: "1px solid var(--border, #2a2a3e)", background: "transparent", color: "inherit",
            }}
          />
          <button
            className="lb-btn" disabled={busy || !newReviewer.includes("@")}
            onClick={() => { post("/api/admin/reviewers", { email: newReviewer }, "Reviewer added."); setNewReviewer(""); }}
          >Add</button>
        </div>
        {activeReviewers.length === 0
          ? <p style={{ color: "var(--text-muted)", fontSize: ".83rem" }}>
              No reviewers yet. Held submissions cannot be assigned until there is at least one.
            </p>
          : <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: ".86rem" }}>
              {activeReviewers.map((r) => (
                <li key={r.email} style={{ padding: ".25rem 0" }}>{r.email}</li>
              ))}
            </ul>}
      </div>

      {/* Manual verification pipeline */}
      <div style={card}>
        <strong style={{ display: "block", marginBottom: ".6rem" }}>
          Held for human review ({tasks.filter((t) => t.state !== "submitted").length})
        </strong>
        {tasks.length === 0
          ? <p style={{ color: "var(--text-muted)", fontSize: ".83rem" }}>
              Nothing held. Submissions land here when the judge fails twice.
            </p>
          : tasks.map((t) => (
              <div key={t.sessionId} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                gap: "1rem", padding: ".55rem 0", borderTop: "1px solid var(--border, #2a2a3e)",
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: ".88rem" }}>
                    {t.candidateName ?? t.sessionId.slice(0, 10)}{t.role ? ` · ${t.role}` : ""}
                  </div>
                  <div style={{ color: "var(--text-muted)", fontSize: ".78rem" }}>
                    {t.state === "submitted" ? "Reviewed" : t.assignedTo ? `Assigned to ${t.assignedTo}` : "Unassigned"}
                  </div>
                </div>
                {t.state !== "submitted" && (
                  <select
                    disabled={busy || activeReviewers.length === 0}
                    defaultValue=""
                    onChange={(e) => e.target.value && post(
                      "/api/admin/review-queue",
                      { sessionId: t.sessionId, reviewerEmail: e.target.value },
                      "Assigned.",
                    )}
                    style={{
                      padding: ".35rem .5rem", borderRadius: 7, fontSize: ".8rem",
                      border: "1px solid var(--border, #2a2a3e)", background: "transparent", color: "inherit",
                    }}
                  >
                    <option value="">Assign to…</option>
                    {activeReviewers.map((r) => <option key={r.email} value={r.email}>{r.email}</option>)}
                  </select>
                )}
              </div>
            ))}
      </div>
    </section>
  );
}
