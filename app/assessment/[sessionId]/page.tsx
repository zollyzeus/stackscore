import { getSession } from "../../../lib/firestore";
import B2BAssessment from "./B2BAssessment";
import AssessmentErrorBoundary from "../../components/AssessmentErrorBoundary";

interface PageProps {
  params: { sessionId: string };
}

export default async function B2BSessionPage({ params }: PageProps) {
  const { sessionId } = params;

  let session: Awaited<ReturnType<typeof getSession>> | null = null;
  let fetchError: "not_found" | "expired" | "done" | "error" | null = null;

  try {
    session = await getSession(sessionId);
    if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
      fetchError = "expired";
    } else if (session.status === "evaluated") {
      fetchError = "done";
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fetchError = msg.includes("Unknown session") ? "not_found" : "error";
  }

  if (fetchError === "expired") {
    return <StatusPage icon="⏳" title="Link expired" body="This assessment link has passed its expiry time. Ask the panelist to generate a new link." />;
  }
  if (fetchError === "done") {
    return <StatusPage icon="✅" title="Already submitted" body="This assessment has already been completed and evaluated. Contact your panelist for the score card link." />;
  }
  if (fetchError === "not_found") {
    return <StatusPage icon="🔍" title="Link not found" body="This assessment link doesn't exist. Double-check the URL or ask the panelist to resend it." />;
  }
  if (fetchError === "error" || !session) {
    return <StatusPage icon="⚠️" title="Something went wrong" body="Unable to load your assessment. Try refreshing the page or contact your panelist." />;
  }

  return (
    <AssessmentErrorBoundary>
      <B2BAssessment
        sessionId={sessionId}
        brief={session.brief}
        initialRole={(session.role ?? "Mid") as "Junior" | "Mid" | "Senior"}
      />
    </AssessmentErrorBoundary>
  );
}

function StatusPage({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <main style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100dvh", padding: "2rem", textAlign: "center" }}>
      <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>{icon}</div>
      <h1 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: ".5rem" }}>{title}</h1>
      <p style={{ color: "var(--text-muted)", maxWidth: 420 }}>{body}</p>
    </main>
  );
}
