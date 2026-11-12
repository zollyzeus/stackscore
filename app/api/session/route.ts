import { NextRequest, NextResponse } from "next/server";
import { randomCell, manualCell } from "../../../lib/matrix";
import { generateBrief } from "../../../lib/vertex";
import { createSession, db } from "../../../lib/firestore";
import { allocateFromBank } from "../../../lib/scenarioBank";
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

    // Try live generation; fall back to scenario bank if both Gemini and Claude Haiku fail.
    let brief: string;
    let bankFields: Record<string, unknown> = {};

    if (body.bankPackId) {
      // Caller already allocated a pack (via /api/generate-problem); fetch its data.
      const packSnap = await db().collection("scenarioBank").doc(String(body.bankPackId)).get();
      if (packSnap.exists) {
        const pack = packSnap.data()!;
        brief = pack.brief as string;
        bankFields = {
          bankPackId: packSnap.id,
          bankTwistColumnId: pack.twistColumnId,
          bankTwistColumnLabel: pack.twistColumnLabel,
          bankTwist: pack.twist,
        };
        Object.assign(cell, {
          rowId: pack.rowId, columnId: pack.columnId,
          rowLabel: pack.rowLabel, columnLabel: pack.columnLabel,
          seed: pack.seed, pressure: pack.pressure,
        });
      } else {
        // Pack not found — fall through to live generation
        ({ brief, bankFields } = await generateBriefWithFallback(cell));
      }
    } else {
      ({ brief, bankFields } = await generateBriefWithFallback(cell));
    }

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
      ...bankFields,
    } as Parameters<typeof createSession>[0]);

    // Patch allocatedToSession on the bank pack now that we have the real session ID.
    if (bankFields.bankPackId) {
      await db().collection("scenarioBank").doc(String(bankFields.bankPackId)).update({ allocatedToSession: sessionId });
    }

    return NextResponse.json({ sessionId, cell, brief });
  } catch (err) {
    logError("[session]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

type BriefResult = { brief: string; bankFields: Record<string, unknown> };

async function generateBriefWithFallback(cell: {
  rowId: string; columnId: string;
  rowLabel: string; columnLabel: string;
  seed: string; pressure: string;
}): Promise<BriefResult> {
  try {
    const brief = await generateBrief({
      rowLabel: cell.rowLabel,
      columnLabel: cell.columnLabel,
      seed: cell.seed,
      pressure: cell.pressure,
    });
    return { brief, bankFields: {} };
  } catch (liveErr) {
    console.warn("[session] live brief generation failed, trying bank:", liveErr instanceof Error ? liveErr.message : liveErr);
    const pack = await allocateFromBank("__pending__", { rowId: cell.rowId });
    if (pack) {
      Object.assign(cell, {
        rowId: pack.rowId, columnId: pack.columnId,
        rowLabel: pack.rowLabel, columnLabel: pack.columnLabel,
        seed: pack.seed, pressure: pack.pressure,
      });
      return {
        brief: pack.brief,
        bankFields: {
          bankPackId: pack.id,
          bankTwistColumnId: pack.twistColumnId,
          bankTwistColumnLabel: pack.twistColumnLabel,
          bankTwist: pack.twist,
        },
      };
    }
    // Bank empty — last resort static template
    const brief = `You are tasked with designing a ${cell.rowLabel.toLowerCase()} system. Key constraint: ${cell.columnLabel} — specifically ${cell.pressure}. What clarifying questions would you ask before proposing a solution?`;
    return { brief, bankFields: {} };
  }
}
