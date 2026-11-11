"use client";
import { Component, ReactNode } from "react";

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export default class AssessmentErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", minHeight: "100dvh", padding: "2rem", textAlign: "center",
        }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>⚠️</div>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: ".5rem" }}>Something went wrong</h1>
          <p style={{ color: "var(--text-muted)", maxWidth: 420, marginBottom: "1.5rem" }}>
            An unexpected error occurred during your assessment. Your progress may be partially saved.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: "var(--accent)", color: "#fff", border: "none",
              borderRadius: 8, padding: ".55rem 1.4rem", fontSize: ".9rem",
              fontWeight: 700, cursor: "pointer",
            }}
          >
            Reload page
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
