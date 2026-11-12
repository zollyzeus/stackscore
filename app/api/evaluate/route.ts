import { NextRequest, NextResponse } from "next/server";
import { judgeSubmission, generateSummaryAndTips } from "../../../lib/judge";
import { computeScoreCard } from "../../../lib/scoring";
import { getTranscript, getSession, saveScore, updateScoreFields, getAllScores } from "../../../lib/firestore";
import { extractFromTranscript } from "../../../lib/transcriptExtract";
import { similarity } from "../../../lib/similarity";
import { notifyPanelist, gradeLabel } from "../../../lib/notify";
import { logError } from "../../../lib/logger";
import { requirePanelist } from "../../../lib/requirePanelist";
import { getCandidateSessionFromRequest } from "../../../lib/candidateAuth";
import { nanoid } from "nanoid";

/**
 * POST /api/evaluate
 * { sessionId }
 * Gathers all stage artifacts from Firestore, runs the rubric-constrained
 * judge pass, computes the weighted StackScore, persists, and returns
 * the full score card + a public slug for the shareable score-card URL.
 *
 * Auth: accepts ss_panel (panelist) OR ss_cand where the candidate's email
 * matches the session's candidateEmail (candidate submitting their own assessment).
 */
export async function POST(req: NextRequest) {
  const panelistErr = await requirePanelist(req);
  if (panelistErr) {
    // Not a panelist — check if this is the candidate submitting their own session
    const candSession = await getCandidateSessionFromRequest(req);
    if (!candSession) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    // Candidate email ownership is verified below after session is fetched
    const { sessionId } = await req.clone().json();
    if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
    const session = await getSession(sessionId).catch(() => null);
    if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
    const sessionAny = session as unknown as Record<string, unknown>;
    const owner = sessionAny.candidateEmail as string | undefined;
    // A session with no recorded candidateEmail (B2C self-serve) is claimable only by
    // the candidate whose checkpoint/transcript it is; require an explicit match so a
    // logged-in candidate cannot trigger a judge run on an arbitrary session id.
    if (!owner || owner.toLowerCase().trim() !== candSession.email.toLowerCase().trim()) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  try {
    const { sessionId, tabSwitchCount } = await req.json();
    const [session, transcript] = await Promise.all([
      getSession(sessionId),
      getTranscript(sessionId),
    ]);

    const extract = (stage: string, field: string) => extractFromTranscript(transcript, stage, field);

    const twistText = extract("adapt", "text");
    const adaptCode = extract("adapt", "code");
    const submissionInput = {
      brief: session.brief,
      clarifyingTranscript: extract("clarify", "text"),
      designProposal: extract("propose", "text"),
      code: extract("build", "code") || "(no build code submitted — candidate may have used pseudo-code or skipped for time)",
      twistResponse: adaptCode.trim()
        ? `${twistText}\n\n[Revised code after twist]\n${adaptCode}`
        : twistText,
      debugResponse: extract("debug", "code"),
    };

    let axisScores: import("../../../lib/scoring").AxisScores;
    let feedback: Record<string, string>;
    let evidence: Record<string, string> = {};
    let thinkingLog: string | undefined;
    // Set only on the fallback path below. Everything downstream that presents or
    // aggregates this score has to be able to tell a judged card from a substituted one.
    let judgeFallback = false;
    let judgeFallbackReason: string | undefined;

    const sessionAny = session as unknown as Record<string, unknown>;
    try {
      ({ axisScores, feedback, evidence, thinkingLog } = await judgeSubmission({
        ...submissionInput,
        role: sessionAny.role as string | undefined,
      }));
    } catch (judgeErr: unknown) {
      // Judge failed — score based on what was submitted (blank = 0, something = 20 baseline)
      // JUDGE_FALLBACK is the alert token: the service stays healthy during a judge
      // outage, so this log line is the only runtime signal that scoring is broken.
      // Alert on it. AUDIT_TODO D8 ran undetected for want of exactly this.
      judgeFallbackReason = judgeErr instanceof Error ? judgeErr.message : String(judgeErr);
      judgeFallback = true;
      console.error("[evaluate] JUDGE_FALLBACK judge failed, substituting mechanical scores:", judgeFallbackReason);
      const hasDesign = submissionInput.designProposal.trim().length > 20;
      const hasCode = submissionInput.code.trim().length > 20;
      const hasClarify = submissionInput.clarifyingTranscript.trim().length > 10;
      const hasAdapt = submissionInput.twistResponse.trim().length > 10;
      const base = (v: boolean) => v ? 20 : 0;
      axisScores = {
        D1: base(hasClarify), D2: base(hasDesign), D3: base(hasDesign),
        D4: base(hasAdapt),   D5: base(hasDesign),
        K1: base(hasCode),    K2: base(hasCode),   K3: base(hasCode),
        K4: base(hasCode),    K5: base(hasCode),   K6: 50,
      };
      feedback = {
        D1: hasClarify ? "Some clarifying questions provided." : "No clarifying questions submitted.",
        D2: hasDesign ? "A design proposal was submitted." : "No design proposal submitted.",
        D3: hasDesign ? "Design constraints partially addressed." : "No constraints addressed.",
        D4: hasAdapt ? "Adaptation response provided." : "No adaptation response submitted.",
        D5: hasDesign ? "Some tradeoffs considered." : "No tradeoffs discussed.",
        K1: hasCode ? "Code was submitted." : "No code submitted.",
        K2: hasCode ? "Code structure present." : "No code to evaluate.",
        K3: hasCode ? "Some implementation detail present." : "Nothing to evaluate.",
        K4: hasCode ? "Debug attempt noted." : "No debug response.",
        K5: hasCode ? "Code submitted for review." : "No code submitted.",
        K6: "AI tool usage could not be assessed from the submitted content.",
      };
      evidence = {};
    }

    const scoreCard = computeScoreCard(axisScores);
    const publicSlug = nanoid(10);

    // Velocity flag: flag stages where submission was implausibly fast
    const proposeElapsed = (() => {
      const entries = (transcript["propose"] ?? []) as Array<Record<string, unknown>>;
      const e = entries.find((x) => typeof x.elapsedSeconds === "number");
      return typeof e?.elapsedSeconds === "number" ? (e.elapsedSeconds as number) : null;
    })();
    const adaptElapsed = (() => {
      const entries = (transcript["adapt"] ?? []) as Array<Record<string, unknown>>;
      const e = entries.find((x) => typeof x.elapsedSeconds === "number");
      return typeof e?.elapsedSeconds === "number" ? (e.elapsedSeconds as number) : null;
    })();
    const fastStages: string[] = [];
    if (proposeElapsed !== null && proposeElapsed < 90) fastStages.push("propose");
    if (adaptElapsed !== null && adaptElapsed < 60) fastStages.push("adapt");
    const fastSubmit = fastStages.length > 0;

    await saveScore(sessionId, publicSlug, scoreCard, feedback, {
      brief: session.brief,
      designProposal: submissionInput.designProposal,
      rowLabel: sessionAny.rowLabel as string | undefined,
      columnLabel: sessionAny.columnLabel as string | undefined,
      role: sessionAny.role as string | undefined,
      candidateName: sessionAny.candidateName as string | undefined,
      candidateEmail: sessionAny.candidateEmail as string | undefined,
      ...(fastSubmit ? { fastSubmit: true, fastSubmitStages: fastStages } : {}),
      ...(typeof tabSwitchCount === "number" && tabSwitchCount > 0 ? { tabSwitchCount } : {}),
      ...(thinkingLog ? { thinkingLog } : {}),
      ...(Object.keys(evidence).length > 0 ? { evidence } : {}),
      ...(judgeFallback ? { judgeFallback: true, judgeFallbackReason } : {}),
    });

    // Webhook on completion (non-fatal, background)
    const webhookUrl = process.env.WEBHOOK_URL;
    if (webhookUrl) {
      fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "assessment.completed",
          sessionId,
          publicSlug,
          stackScore: scoreCard.stackScore,
          levelScores: scoreCard.levelScores,
          axisScores,
          candidateName: sessionAny.candidateName,
          candidateEmail: sessionAny.candidateEmail,
          role: sessionAny.role,
          fastSubmit,
          tabSwitchCount,
          judgeFallback,
          scoreCardUrl: `/score/${publicSlug}`,
          timestamp: new Date().toISOString(),
        }),
      }).catch(console.error);
    }

    // Email panelist notification (non-fatal, background)
    notifyPanelist({
      candidateName: sessionAny.candidateName as string | undefined,
      candidateEmail: sessionAny.candidateEmail as string | undefined,
      stackScore: scoreCard.stackScore,
      gradeLabel: gradeLabel(scoreCard.stackScore),
      judgeFallback,
      scoreCardUrl: `/score/${publicSlug}`,
      role: sessionAny.role as string | undefined,
    }).catch(console.error);

    // Generate summary + tips in the background — doesn't block candidate's result
    generateSummaryAndTips({
      brief: session.brief,
      role: sessionAny.role as string | undefined,
      axisScores,
      feedback,
    }).then(({ summary, tips }) => {
      if (summary) {
        return updateScoreFields(sessionId, { summary, ...(Object.keys(tips).length ? { tips } : {}) });
      }
    }).catch(console.error);

    // Similarity check: compare design proposal against recent submissions
    const designText = submissionInput.designProposal;
    if (designText && designText.length > 100) {
      getAllScores(100).then((recent) => {
        const others = recent.filter((s) => s.docId !== sessionId);
        for (const other of others) {
          const otherDesign = (other.designProposal as string | undefined) ?? "";
          if (!otherDesign) continue;
          const sim = similarity(designText, otherDesign);
          if (sim > 0.6) {
            updateScoreFields(sessionId, { similarToSessionId: other.docId as string, similarityScore: Math.round(sim * 100) }).catch(console.error);
            break;
          }
        }
      }).catch(console.error);
    }

    return NextResponse.json({
      ...scoreCard,
      feedback,
      scoreCardUrl: `/score/${publicSlug}`,
    });
  } catch (err) {
    logError("[evaluate]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
