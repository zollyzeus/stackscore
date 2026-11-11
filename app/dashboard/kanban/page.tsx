import { getAllScores } from "../../../lib/firestore";
import KanbanBoard from "../../components/KanbanBoard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function KanbanPage() {
  let scores: Awaited<ReturnType<typeof getAllScores>> = [];
  try {
    scores = await getAllScores(500);
  } catch {
    /* Firestore unavailable */
  }

  const serialize = (s: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(s).map(([k, v]) => {
        if (v && typeof v === "object" && typeof (v as { toDate?: unknown }).toDate === "function")
          return [k, (v as { toDate: () => Date }).toDate().toISOString()];
        return [k, v];
      })
    );

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem 1.25rem 5rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "2rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h1 style={{ fontSize: "1.3rem", fontWeight: 700, margin: 0 }}>Pipeline Kanban</h1>
        </div>
        <a href="/dashboard" style={{ fontSize: ".82rem", color: "var(--text-muted)", textDecoration: "none" }}>← Table view</a>
      </div>
      <KanbanBoard initialRows={scores.map(serialize)} />
    </main>
  );
}
