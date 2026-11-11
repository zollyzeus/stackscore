"use client";

import { useState } from "react";

interface Props {
  slugs: string[];
}

export default function CompareSelector({ slugs }: Props) {
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(slug: string) {
    setSelected((prev) =>
      prev.includes(slug)
        ? prev.filter((s) => s !== slug)
        : prev.length >= 3 ? prev : [...prev, slug]
    );
  }

  function goCompare() {
    if (selected.length >= 2) {
      window.location.href = `/compare?slugs=${selected.join(",")}`;
    }
  }

  return (
    <>
      {/* Per-row checkboxes injected via data attribute - rendered by the server table */}
      {slugs.map((slug) => (
        <span key={slug} data-compare-slug={slug} style={{ display: "none" }} />
      ))}

      {selected.length > 0 && (
        <div style={{
          position: "fixed", bottom: "1.5rem", left: "50%", transform: "translateX(-50%)",
          background: "var(--surface)", border: "1px solid var(--accent)", borderRadius: 12,
          padding: ".6rem 1.25rem", display: "flex", alignItems: "center", gap: ".75rem",
          boxShadow: "0 4px 24px #0006", zIndex: 100, fontSize: ".85rem",
        }}>
          <span style={{ color: "var(--text-muted)" }}>
            {selected.length} selected {selected.length < 2 ? "(select at least 2)" : ""}
          </span>
          {selected.map((slug) => (
            <span key={slug} style={{ background: "var(--accent)22", color: "var(--accent)", borderRadius: 6, padding: ".15rem .5rem", fontSize: ".75rem" }}>
              {slug.slice(0, 8)}…
              <button onClick={() => toggle(slug)} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", marginLeft: ".25rem", fontSize: ".75rem" }}>✕</button>
            </span>
          ))}
          <button
            onClick={goCompare}
            disabled={selected.length < 2}
            style={{ background: selected.length >= 2 ? "var(--accent)" : "var(--border)", color: selected.length >= 2 ? "#fff" : "var(--text-muted)", border: "none", borderRadius: 8, padding: ".4rem .9rem", fontWeight: 700, cursor: selected.length >= 2 ? "pointer" : "not-allowed", fontSize: ".82rem" }}
          >
            Compare →
          </button>
        </div>
      )}

      {/* Render checkboxes for each slug */}
      <style>{`
        .compare-cb { width: 15px; height: 15px; cursor: pointer; accent-color: var(--accent); }
      `}</style>
      {slugs.map((slug) => (
        <input
          key={slug}
          type="checkbox"
          className="compare-cb"
          checked={selected.includes(slug)}
          onChange={() => toggle(slug)}
          title="Select for comparison"
          style={{ display: "none" }}
          data-slug={slug}
        />
      ))}
    </>
  );
}
