import { NextRequest, NextResponse } from "next/server";
import { randomCell, manualCell } from "../../../lib/matrix";
import { generateBrief } from "../../../lib/vertex";
import { createSession } from "../../../lib/firestore";
import { requirePanelist, getPanelistEmail } from "../../../lib/requirePanelist";
import { getCandidateSessionFromRequest } from "../../../lib/candidateAuth";
import { rateLimit } from "../../../lib/rateLimit";
import { checkAndDeductPanelistCredit, checkAndDeductCandidateCredit } from "../../../lib/freeCredits";
import { logError } from "../../../lib/logger";
import { nanoid } from "nanoid";

/**
 * POST /api/session
 * Creates a new session, generates the problem brief, persists to Firestore.
 * B2C: { mode: "random" }  — rate-limited, no auth required
 * B2B: { mode: "manual" | "custom" } — panelist auth required
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Custom brief mode — panelist writes their own brief; skip matrix + AI generation
    if (body.mode === "custom") {
      const deny = await requirePanelist(req);
      if (deny) return deny;
      if (!body.customBrief?.trim()) {
        return new NextResponse("customBrief required for mode=custom", { status: 400 });
      }
      const pEmail = await getPanelistEmail(req);
      if (pEmail) {
        const allowed = await checkAndDeductPanelistCredit(pEmail);
        if (!allowed) {
          return NextResponse.json({ error: "free_tier_exhausted", creditsRemaining: 0 }, { status: 402 });
        }
      }
      const expiresHours = body.expiresHours ? Number(body.expiresHours) : null;
      const expiresAt = expiresHours && expiresHours > 0
        ? new Date(Date.now() + expiresHours * 3_600_000).toISOString()
        : undefined;
      const brief = String(body.customBrief).slice(0, 2000);
      const sessionId = await createSession({
        mode: "b2b",
        rowId: "custom",
        columnId: "custom",
        brief,
        candidateId: body.candidateId ?? nanoid(),
        panelistId: body.panelistId,
        ...(body.role ? { role: body.role } : {}),
        ...(body.candidateName ? { candidateName: String(body.candidateName).slice(0, 120) } : {}),
        ...(body.candidateEmail ? { candidateEmail: String(body.candidateEmail).toLowerCase().trim().slice(0, 254) } : {}),
        ...(expiresAt ? { expiresAt } : {}),
      } as Parameters<typeof createSession>[0]);
      return NextResponse.json({ sessionId, brief });
    }

    if (body.mode === "manual") {
      const deny = await requirePanelist(req);
      if (deny) return deny;
      const pEmail = await getPanelistEmail(req);
      if (pEmail) {
        const allowed = await checkAndDeductPanelistCredit(pEmail);
        if (!allowed) {
          return NextResponse.json({ error: "free_tier_exhausted", creditsRemaining: 0 }, { status: 402 });
        }
      }
    }

    // For B2C runs the candidate's own verified email owns the session. Taking it from
    // the cookie rather than the client-supplied field both binds the session (so only
    // its owner can submit it for evaluation) and stops a candidate claiming a score
    // card under somebody else's address.
    let ownerEmail: string | undefined;

    if (body.mode === "random") {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
      if (!await rateLimit("assess:" + ip, 1)) {
        return NextResponse.json({ error: "rate_limited" }, { status: 429 });
      }
      const candSession = await getCandidateSessionFromRequest(req);
      if (!candSession?.email) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      ownerEmail = candSession.email;
      // Check per-candidate self-assessment limit
      const allowed = await checkAndDeductCandidateCredit(candSession.email);
      if (!allowed) {
        return NextResponse.json({ error: "self_assessment_limit_reached", limit: 3 }, { status: 402 });
      }
    }

    const cell = body.mode === "manual"
      ? manualCell(body.rowId, body.columnId)
      : randomCell();

    const brief = await generateBrief({
      rowLabel: cell.rowLabel,
      columnLabel: cell.columnLabel,
      seed: cell.seed,
      pressure: cell.pressure,
    });

    const expiresHours = body.expiresHours ? Number(body.expiresHours) : null;
    const expiresAt = expiresHours && expiresHours > 0
      ? new Date(Date.now() + expiresHours * 3_600_000).toISOString()
      : undefined;

    const sessionId = await createSession({
      mode: body.mode === "manual" ? "b2b" : "b2c",
      rowId: cell.rowId,
      columnId: cell.columnId,
      brief,
      candidateId: body.candidateId ?? nanoid(),
      panelistId: body.panelistId,
      ...(body.role ? { role: body.role } : {}),
      ...(body.candidateName ? { candidateName: String(body.candidateName).slice(0, 120) } : {}),
      ...(ownerEmail
        ? { candidateEmail: ownerEmail }
        : body.candidateEmail
          ? { candidateEmail: String(body.candidateEmail).toLowerCase().trim().slice(0, 254) }
          : {}),
      ...(expiresAt ? { expiresAt } : {}),
    } as Parameters<typeof createSession>[0]);

    return NextResponse.json({ sessionId, cell, brief });
  } catch (err) {
    logError("[session]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
