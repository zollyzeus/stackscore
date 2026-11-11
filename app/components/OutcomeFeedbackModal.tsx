"use client";
import { useState } from "react";

interface Props {
  sessionId: string;
  candidateName?: string;
  stackScore?: number;
  onClose: () => void;
}

export default function OutcomeFeedbackModal({ sessionId, candidateName, stackScore, onClose }: Props) {
  const [rating, setRating] = useState<"exceeded" | "met" | "below" | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!rating) return;
    setSubmitting(true);
    try {
      await fetch("/api/outcome-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, rating, notes: notes.trim() || undefined }),
      });
      setDone(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <style>{`
        .ofm-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 300;
          display: flex; align-items: center; justify-content: center; padding: 1.25rem;
        }
        .ofm-card {
          background: var(--bg); border: 1px solid var(--border); border-radius: 16px;
          padding: 2rem; width: 100%; max-width: 440px;
          box-shadow: 0 20px 60px rgba(0,0,0,.35);
        }
        .ofm-title { font-size: 1.1rem; font-weight: 800; margin: 0 0 .4rem; }
        .ofm-sub { font-size: .83rem; color: var(--text-muted); margin: 0 0 1.5rem; }
        .ofm-choices { display: flex; flex-direction: column; gap: .6rem; margin-bottom: 1.25rem; }
        .ofm-choice {
          padding: .75rem 1rem; border-radius: 10px; font-size: .9rem; font-weight: 600;
          border: 1.5px solid var(--border); background: var(--surface); cursor: pointer;
          text-align: left; color: var(--fg); transition: border-color .15s, background .15s;
        }
        .ofm-choice:hover { border-color: var(--accent); }
        .ofm-choice.sel { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--surface)); }
        .ofm-textarea {
          width: 100%; border-radius: 8px; padding: .6rem .8rem; font-size: .85rem;
          border: 1px solid var(--border); background: var(--surface); color: var(--fg);
          resize: vertical; min-height: 72px; font-family: inherit;
          box-sizing: border-box;
        }
        .ofm-textarea:focus { outline: none; border-color: var(--accent); }
        .ofm-actions { display: flex; gap: .6rem; margin-top: 1rem; }
        .ofm-btn-primary {
          flex: 1; padding: .6rem; border-radius: 9px; font-size: .9rem; font-weight: 700;
          background: var(--accent); color: #fff; border: none; cursor: pointer;
        }
        .ofm-btn-primary:disabled { opacity: .55; cursor: not-allowed; }
        .ofm-btn-cancel {
          padding: .6rem 1rem; border-radius: 9px; font-size: .88rem; font-weight: 600;
          background: var(--surface); border: 1px solid var(--border); color: var(--text-muted);
          cursor: pointer;
        }
        .ofm-success { text-align: center; padding: 1rem 0; }
        .ofm-success-icon { font-size: 2.5rem; margin-bottom: .75rem; }
        .ofm-success-msg { font-size: .95rem; font-weight: 700; margin-bottom: .35rem; }
        .ofm-success-sub { font-size: .82rem; color: var(--text-muted); }
      `}</style>

      <div className="ofm-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="ofm-card">
          {done ? (
            <div className="ofm-success">
              <div className="ofm-success-icon">🎉</div>
              <div className="ofm-success-msg">Thank you — 1 free assessment credited</div>
              <div className="ofm-success-sub">Your feedback helps calibrate StackScore benchmarks for everyone.</div>
              <button className="ofm-btn-primary" style={{ marginTop: "1.25rem", width: "100%" }} onClick={onClose}>Done</button>
            </div>
          ) : (
            <>
              <div className="ofm-title">90-day Hiring Outcome</div>
              <div className="ofm-sub">
                {candidateName ? `How did ${candidateName}` : "How did this candidate"}
                {stackScore ? ` (StackScore ${stackScore})` : ""} perform on the job?
              </div>

              <div className="ofm-choices">
                {([
                  { value: "exceeded", label: "Exceeded expectations 🚀" },
                  { value: "met",      label: "Met expectations ✓" },
                  { value: "below",    label: "Below expectations ↓" },
                ] as const).map(({ value, label }) => (
                  <button
                    key={value}
                    className={`ofm-choice${rating === value ? " sel" : ""}`}
                    onClick={() => setRating(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <textarea
                className="ofm-textarea"
                placeholder="Any notes? (kept confidential, used to improve benchmarks)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={500}
              />

              <div className="ofm-actions">
                <button className="ofm-btn-cancel" onClick={onClose}>Cancel</button>
                <button className="ofm-btn-primary" disabled={!rating || submitting} onClick={submit}>
                  {submitting ? "Submitting…" : "Submit feedback"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
