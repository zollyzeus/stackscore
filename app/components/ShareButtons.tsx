"use client";
import { useState } from "react";

export default function ShareButtons({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);

  const url = typeof window !== "undefined"
    ? `${window.location.origin}/score/${slug}`
    : `/score/${slug}`;

  async function copy() {
    try { await navigator.clipboard.writeText(url); } catch { selectFallback(); }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  function selectFallback() {
    const el = document.createElement("textarea");
    el.value = url; el.style.position = "fixed"; el.style.opacity = "0";
    document.body.appendChild(el); el.select();
    document.execCommand("copy"); document.body.removeChild(el);
  }

  return (
    <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
      <button onClick={copy} style={{
        padding: ".45rem .9rem", borderRadius: 8, fontSize: ".82rem", fontWeight: 600,
        background: copied ? "#3ecf8e22" : "var(--bg)", border: `1px solid ${copied ? "#3ecf8e" : "var(--border)"}`,
        color: copied ? "#3ecf8e" : "var(--text-muted)", cursor: "pointer", transition: "all .2s",
      }}>
        {copied ? "✓ Copied!" : "Copy link"}
      </button>
      <a href={`/api/verify/${slug}`} target="_blank" rel="noopener noreferrer" style={{
        padding: ".45rem .9rem", borderRadius: 8, fontSize: ".82rem", fontWeight: 600,
        background: "var(--bg)", border: "1px solid var(--border)",
        color: "var(--text-muted)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: ".3rem",
      }}>
        Verify JSON ↗
      </a>
    </div>
  );
}
