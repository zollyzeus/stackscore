"use client";
import { useState, useEffect } from "react";

interface PanelistRow { email: string; active: boolean; invitedBy?: string; addedAt?: string; }

export default function PanelistManager() {
  const [panelists, setPanelists] = useState<PanelistRow[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function load() {
    try {
      const r = await fetch("/api/admin/panelists");
      if (r.ok) setPanelists((await r.json()).panelists ?? []);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setSuccess("");
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) { setError("Enter a valid email."); return; }
    setInviting(true);
    try {
      const r = await fetch("/api/admin/panelists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error ?? "Failed"); return; }
      setSuccess(`${email} added as panelist. They can now sign in via the Panelist tab.`);
      setInviteEmail("");
      await load();
    } finally { setInviting(false); }
  }

  async function deactivate(email: string) {
    if (!confirm(`Remove panelist access for ${email}?`)) return;
    await fetch("/api/admin/panelists", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    await load();
  }

  return (
    <div className="pm">
      <style>{`
        .pm { background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
          padding: 1.25rem 1.5rem; margin-top: 2.5rem; }
        .pm-heading { font-size: .72rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase;
          color: var(--text-muted); margin-bottom: 1rem; display: flex; align-items: center; gap: .5rem; }
        .pm-heading::after { content: ''; flex: 1; height: 1px; background: var(--border); }
        .pm-form { display: flex; gap: .5rem; flex-wrap: wrap; margin-bottom: 1rem; }
        .pm-input { flex: 1; min-width: 200px; padding: .55rem .85rem; border-radius: 8px; font-size: .88rem;
          border: 1.5px solid var(--border); background: var(--bg); color: var(--fg); outline: none; }
        .pm-input:focus { border-color: var(--accent); }
        .pm-btn { padding: .55rem 1.1rem; border-radius: 8px; font-size: .85rem; font-weight: 700;
          background: var(--accent); color: #fff; border: none; cursor: pointer; white-space: nowrap; }
        .pm-btn:disabled { opacity: .55; cursor: not-allowed; }
        .pm-err { font-size: .82rem; color: #ef4444; margin-bottom: .6rem; }
        .pm-ok { font-size: .82rem; color: #3ecf8e; margin-bottom: .6rem; }
        .pm-table { width: 100%; border-collapse: collapse; font-size: .84rem; }
        .pm-table th { font-size: .68rem; font-weight: 800; letter-spacing: .07em; text-transform: uppercase;
          color: var(--text-muted); padding: .4rem .6rem; text-align: left; border-bottom: 1px solid var(--border); }
        .pm-table td { padding: .5rem .6rem; border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent); }
        .pm-remove { background: none; border: none; color: var(--text-muted); font-size: .78rem;
          cursor: pointer; padding: .2rem .5rem; border-radius: 5px; }
        .pm-remove:hover { background: #ef444422; color: #ef4444; }
        .pm-badge { display: inline-block; padding: .15rem .45rem; border-radius: 4px; font-size: .68rem; font-weight: 700; }
        .pm-badge.active { background: #3ecf8e22; color: #3ecf8e; }
        .pm-badge.inactive { background: #ef444422; color: #ef4444; }
      `}</style>

      <div className="pm-heading">Team · Panelist Access</div>

      <form className="pm-form" onSubmit={invite}>
        <input
          className="pm-input"
          type="email"
          placeholder="colleague@company.com"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
        />
        <button className="pm-btn" type="submit" disabled={inviting || !inviteEmail.trim()}>
          {inviting ? "Adding…" : "Add panelist"}
        </button>
      </form>

      {error && <div className="pm-err">{error}</div>}
      {success && <div className="pm-ok">✓ {success}</div>}

      {loading ? (
        <div style={{ fontSize: ".82rem", color: "var(--text-muted)" }}>Loading…</div>
      ) : panelists.length === 0 ? (
        <div style={{ fontSize: ".82rem", color: "var(--text-muted)" }}>
          No panelists added yet. Invite your team above.
        </div>
      ) : (
        <table className="pm-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Status</th>
              <th>Added by</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {panelists.map((p) => (
              <tr key={p.email}>
                <td>{p.email}</td>
                <td>
                  <span className={`pm-badge ${p.active !== false ? "active" : "inactive"}`}>
                    {p.active !== false ? "Active" : "Revoked"}
                  </span>
                </td>
                <td style={{ color: "var(--text-muted)" }}>{p.invitedBy ?? "—"}</td>
                <td>
                  {p.active !== false && (
                    <button className="pm-remove" onClick={() => deactivate(p.email)}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
