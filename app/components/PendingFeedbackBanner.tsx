"use client";
import { useState } from "react";
import OutcomeFeedbackModal from "./OutcomeFeedbackModal";

interface PendingItem {
  docId: string;
  candidateName?: string;
  stackScore?: number;
  role?: string;
  hiredAt?: string;
}

export default function PendingFeedbackBanner({ items }: { items: PendingItem[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);

  const visible = items.filter((i) => !dismissed.includes(i.docId));
  if (visible.length === 0) return null;

  const active = visible.find((i) => i.docId === openId);

  return (
    <>
      <style>{`
        .pfb { background: color-mix(in srgb, var(--accent) 8%, var(--surface));
          border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
          border-radius: 14px; padding: 1.1rem 1.25rem; margin-bottom: 1.75rem; }
        .pfb-heading { font-size: .72rem; font-weight: 800; letter-spacing: .1em;
          text-transform: uppercase; color: var(--accent); margin-bottom: .75rem; }
        .pfb-cards { display: flex; flex-wrap: wrap; gap: .6rem; }
        .pfb-card {
          background: var(--bg); border: 1px solid var(--border); border-radius: 10px;
          padding: .75rem 1rem; display: flex; align-items: center; gap: .75rem;
          flex-wrap: wrap; min-width: 220px;
        }
        .pfb-card-info { flex: 1; }
        .pfb-card-name { font-size: .88rem; font-weight: 700; }
        .pfb-card-meta { font-size: .72rem; color: var(--text-muted); margin-top: .15rem; }
        .pfb-card-score { font-size: 1.5rem; font-weight: 800; color: var(--score-gold); }
        .pfb-card-btn {
          padding: .4rem .85rem; border-radius: 7px; font-size: .78rem; font-weight: 700;
          background: var(--accent); color: #fff; border: none; cursor: pointer;
        }
        .pfb-dismiss-btn {
          background: none; border: none; color: var(--text-muted); font-size: 1rem;
          cursor: pointer; padding: 0 .25rem; line-height: 1;
        }
      `}</style>

      <div className="pfb">
        <div className="pfb-heading">📋 Pending 90-Day Feedback ({visible.length})</div>
        <div className="pfb-cards">
          {visible.map((item) => (
            <div key={item.docId} className="pfb-card">
              <div className="pfb-card-score">{item.stackScore ?? "—"}</div>
              <div className="pfb-card-info">
                <div className="pfb-card-name">{item.candidateName ?? "Candidate"}</div>
                <div className="pfb-card-meta">
                  {item.role ? `${item.role} · ` : ""}
                  Hired {item.hiredAt ? Math.round((Date.now() - new Date(item.hiredAt).getTime()) / (1000 * 60 * 60 * 24)) : "?"} days ago
                </div>
              </div>
              <button className="pfb-card-btn" onClick={() => setOpenId(item.docId)}>
                Give feedback
              </button>
              <button
                className="pfb-dismiss-btn"
                title="Dismiss for now"
                onClick={() => setDismissed((d) => [...d, item.docId])}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {active && (
        <OutcomeFeedbackModal
          sessionId={active.docId}
          candidateName={active.candidateName}
          stackScore={active.stackScore}
          onClose={() => {
            setOpenId(null);
            setDismissed((d) => [...d, active.docId]);
          }}
        />
      )}
    </>
  );
}
