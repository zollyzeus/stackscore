"use client";

export function ApproveRejectButtons({ email }: { email: string }) {
  async function act(action: "approve" | "reject") {
    const reason = action === "reject" ? prompt("Reason (optional):") ?? "" : "";
    const r = await fetch("/api/admin/panelist-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, action, reason }),
    });
    if (r.ok) window.location.reload();
    else alert("Action failed — check console");
  }
  return (
    <span style={{ display: "flex", gap: ".4rem" }}>
      <button onClick={() => act("approve")} style={{
        padding: ".25rem .65rem", borderRadius: 5, fontSize: ".75rem", fontWeight: 700,
        background: "#3ecf8e22", color: "#3ecf8e", border: "1px solid #3ecf8e55", cursor: "pointer",
      }}>Approve</button>
      <button onClick={() => act("reject")} style={{
        padding: ".25rem .65rem", borderRadius: 5, fontSize: ".75rem", fontWeight: 700,
        background: "#ef444422", color: "#ef4444", border: "1px solid #ef444455", cursor: "pointer",
      }}>Reject</button>
    </span>
  );
}

export function RevokePanelistButton({ email }: { email: string }) {
  async function revoke() {
    if (!confirm(`Revoke panelist access for ${email}?`)) return;
    const r = await fetch("/api/admin/panelists", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (r.ok) window.location.reload();
    else alert("Failed to revoke");
  }
  return (
    <button onClick={revoke} style={{
      padding: ".2rem .5rem", borderRadius: 5, fontSize: ".72rem",
      background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer",
    }}>Revoke</button>
  );
}

export function PromoteAdminButton({ email }: { email: string }) {
  async function promote() {
    if (!confirm(`Promote ${email} to admin?`)) return;
    const r = await fetch("/api/admin/admins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (r.ok) window.location.reload();
    else alert("Failed to promote");
  }
  return (
    <button onClick={promote} style={{
      padding: ".2rem .5rem", borderRadius: 5, fontSize: ".72rem",
      background: "#6c63ff22", border: "1px solid #6c63ff44", color: "#6c63ff", cursor: "pointer",
    }}>Make Admin</button>
  );
}

export function AwardCreditsButton({ email }: { email: string }) {
  async function award() {
    const val = prompt(`Award credits to ${email} (1–100):`);
    const amount = parseInt(val ?? "", 10);
    if (!amount || isNaN(amount)) return;
    const r = await fetch("/api/admin/credits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, amount }),
    });
    if (r.ok) { alert(`Awarded ${amount} credits`); window.location.reload(); }
    else alert("Failed");
  }
  return (
    <button onClick={award} style={{
      padding: ".2rem .5rem", borderRadius: 5, fontSize: ".72rem",
      background: "#f59e0b22", border: "1px solid #f59e0b44", color: "#f59e0b", cursor: "pointer",
    }}>+ Credits</button>
  );
}
