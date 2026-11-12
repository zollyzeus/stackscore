/**
 * Optional email notification via Resend API.
 * Only fires if RESEND_API_KEY and PANELIST_EMAIL env vars are set.
 * Non-fatal — errors are logged but don't break evaluation.
 */
export async function notifyPanelist(params: {
  candidateName?: string;
  candidateEmail?: string;
  stackScore: number;
  gradeLabel: string;
  scoreCardUrl: string;
  role?: string;
  /**
   * Provenance of the score (A3). Anything other than "judged"/"reviewed" means the number
   * in this email is provisional or absent, and the mail has to say so -- a panelist who
   * reads only the subject line must not be told a held submission scored 0.
   */
  judgeStatus?: "judged" | "partial" | "pending_review" | "reviewed";
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.PANELIST_EMAIL;
  if (!apiKey || !to) return;

  const candidateDisplay = params.candidateName
    ? `${params.candidateName}${params.candidateEmail ? ` (${params.candidateEmail})` : ""}`
    : params.candidateEmail ?? "A candidate";

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://stackscore.anandrajendran.dev";
  const url = `${baseUrl}${params.scoreCardUrl}`;

  // A provisional or held score must never arrive looking like a final result. The subject
  // line carries it too, because that is all a panelist sees in a notification list.
  const status = params.judgeStatus ?? "judged";
  const banners: Record<string, string> = {
    partial: `<p style="margin:0 0 16px;padding:12px 14px;border-radius:8px;background:#3a2d1d;border:1px solid #a80;color:#ffd9a3;font-size:13px;">
<strong>Partially judged \u2014 subject to change.</strong> The calibrated judge was
unavailable, so this was scored by a reduced pass. The numbers are real model output but are
not comparable to a normal StackScore, and a full re-judge is queued. Wait for the final
score before making a decision.</p>`,
    pending_review: `<p style="margin:0 0 16px;padding:12px 14px;border-radius:8px;background:#3a1d1d;border:1px solid #a33;color:#ffb3b3;font-size:13px;">
<strong>On hold for human verification.</strong> The AI judge could not score this
submission, so no score has been produced. It has been queued for a human reviewer. There is
nothing to act on yet.</p>`,
  };
  const fallbackBanner = banners[status] ?? "";

  const html = `
<p>Hi,</p>
${fallbackBanner}
<p><strong>${candidateDisplay}</strong> has completed their StackScore assessment${params.role ? ` (${params.role} level)` : ""}.</p>
<table cellpadding="0" cellspacing="0" style="margin:16px 0;${status === "pending_review" ? "display:none;" : ""}">
  <tr><td style="padding:4px 12px 4px 0;color:#888;font-size:13px;">Score</td><td style="font-size:22px;font-weight:800;color:#f5a623;">${params.stackScore} / 100</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#888;font-size:13px;">Grade</td><td style="font-size:14px;font-weight:600;">${params.gradeLabel}</td></tr>
</table>
<p><a href="${url}" style="display:inline-block;background:#6c63ff;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:700;">View full score card →</a></p>
<p style="color:#888;font-size:12px;margin-top:24px;">Sent by StackScore · AI-judged technical assessment</p>
`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "StackScore <noreply@stackscore.anandrajendran.dev>",
        to: [to],
        subject:
          status === "pending_review"
            ? `[ON HOLD - awaiting human review] StackScore: ${candidateDisplay}`
            : status === "partial"
              ? `[PARTIAL - subject to change] StackScore: ${candidateDisplay} ~${params.stackScore}`
              : `StackScore: ${candidateDisplay} scored ${params.stackScore} (${params.gradeLabel})`,
        html,
      }),
    });
    if (!res.ok) {
      console.error("[notify] Resend error:", res.status, await res.text());
    }
  } catch (err) {
    console.error("[notify] Failed to send email:", err);
  }
}

function gradeLabel(score: number): string {
  if (score >= 85) return "Exceptional";
  if (score >= 70) return "Strong";
  if (score >= 55) return "Proficient";
  if (score >= 40) return "Developing";
  return "Needs Work";
}

export { gradeLabel };
