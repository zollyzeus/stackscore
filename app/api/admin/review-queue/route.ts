import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/requireAdmin";
import { listReviewTasks, assignReviewTask, getReviewTask } from "../../../../lib/reviewQueue";
import { isReviewer } from "../../../../lib/reviewerRegistry";
import { logError } from "../../../../lib/logger";

/**
 * Manual verification pipeline (A3).
 *
 * GET  — every held submission and its state, for the admin console.
 * POST — assign one to a reviewer.
 */

export async function GET(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;
  try {
    const tasks = await listReviewTasks(undefined, 200);
    return NextResponse.json({
      tasks: tasks.map((t) => ({
        sessionId: t.sessionId,
        publicSlug: t.publicSlug,
        state: t.state,
        assignedTo: t.assignedTo ?? null,
        candidateName: t.candidateName ?? null,
        role: t.role ?? null,
        reason: (t.reason ?? "").slice(0, 300),
      })),
    });
  } catch (err) {
    logError("[admin/review-queue GET]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;
  try {
    const { sessionId, reviewerEmail } = await req.json() as {
      sessionId?: string; reviewerEmail?: string;
    };
    if (!sessionId || !reviewerEmail) {
      return NextResponse.json({ error: "sessionId and reviewerEmail required" }, { status: 400 });
    }
    const task = await getReviewTask(sessionId);
    if (!task) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (task.state === "submitted") {
      return NextResponse.json({ error: "already_submitted" }, { status: 409 });
    }
    // Assigning work to someone who cannot sign in to do it produces a task that silently
    // never moves, so the registry is checked here rather than discovered at their login.
    if (!(await isReviewer(reviewerEmail))) {
      return NextResponse.json(
        { error: "not_a_reviewer", message: "Add this address to the reviewer registry first." },
        { status: 400 },
      );
    }
    await assignReviewTask(sessionId, reviewerEmail);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("[admin/review-queue POST]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
