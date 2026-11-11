"use client";

import { useState } from "react";

export default function RetryButton({ slug }: { slug: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  async function retry() {
    setStatus("loading");
    try {
      const res = await fetch("/api/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      if (!res.ok) { setStatus("error"); return; }
      const { sessionId } = await res.json();
      window.location.href = `/assessment/${sessionId}`;
    } catch { setStatus("error"); }
  }

  return (
    <button
      onClick={retry}
      disabled={status === "loading"}
      style={{
        display: "inline-flex", alignItems: "center", gap: ".4rem",
        border: "1px solid var(--border)", borderRadius: 8, padding: ".4rem .9rem",
        background: "var(--surface)", color: status === "error" ? "#f56b6b" : "var(--text-muted)",
        fontSize: ".78rem", fontWeight: 600, cursor: "pointer",
      }}
    >
      {status === "loading" ? "⟳ Creating…" : status === "error" ? "✕ Error - try again" : "🔁 Retry with same brief"}
    </button>
  );
}
