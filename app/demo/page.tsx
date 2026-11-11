"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function DemoPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"starting" | "error">("starting");

  useEffect(() => {
    fetch("/api/demo", { method: "POST" })
      .then((r) => r.json())
      .then((d) => {
        if (d.sessionId) {
          router.push(`/assessment/${d.sessionId}?demo=1`);
        } else {
          setStatus("error");
        }
      })
      .catch(() => setStatus("error"));
  }, [router]);

  return (
    <main style={{ maxWidth: 480, margin: "8rem auto", padding: "0 1.5rem", textAlign: "center" }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spinner { width: 36px; height: 36px; border: 3px solid var(--border);
          border-top-color: var(--accent); border-radius: 50%;
          animation: spin .8s linear infinite; margin: 0 auto 1.5rem; }
      `}</style>

      {status === "starting" ? (
        <>
          <div className="spinner" />
          <div style={{ fontSize: ".7rem", fontWeight: 800, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--accent)", marginBottom: ".75rem" }}>
            StackScore Demo
          </div>
          <h1 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: ".5rem" }}>
            Preparing your live assessment…
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: ".9rem", lineHeight: 1.65 }}>
            Loading a real engineering brief. The 5-stage assessment starts the moment it&apos;s ready - no sign-up needed.
          </p>
        </>
      ) : (
        <>
          <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>⚠️</div>
          <h1 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: ".5rem" }}>Couldn&apos;t start demo</h1>
          <p style={{ color: "var(--text-muted)", fontSize: ".9rem" }}>Something went wrong setting up the session.</p>
          <a href="/assessment" style={{ display: "inline-block", marginTop: "1.5rem", background: "var(--accent)", color: "#fff", padding: ".6rem 1.4rem", borderRadius: 8, fontWeight: 600, textDecoration: "none" }}>
            Start a fresh assessment →
          </a>
        </>
      )}
    </main>
  );
}
