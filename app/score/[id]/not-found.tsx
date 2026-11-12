/**
 * Rendered with an HTTP 404 when a score slug does not resolve.
 *
 * Previously this markup lived inline in page.tsx and was returned with a 200 -- a
 * soft-404, where the page says "not found" but the status line says otherwise. That is
 * not cosmetic: crawlers index the page, uptime checks count it as healthy, and any caller
 * branching on res.ok treats a missing score card as a present one.
 */
export default function ScoreNotFound() {
  return (
    <main style={{ maxWidth: 560, margin: "6rem auto", padding: "0 1.5rem", textAlign: "center" }}>
      <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🔍</div>
      <h1 style={{ marginBottom: ".5rem" }}>Score card not found</h1>
      <p style={{ color: "var(--text-muted)" }}>
        This link may be incorrect or the assessment hasn&apos;t been evaluated yet.
      </p>
      <a
        href="/"
        style={{
          display: "inline-block", marginTop: "1.5rem", background: "var(--accent)",
          color: "#fff", padding: ".6rem 1.4rem", borderRadius: 8, fontWeight: 600,
          textDecoration: "none",
        }}
      >
        Try an assessment →
      </a>
    </main>
  );
}
