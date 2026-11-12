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
  /** True when the judge never ran and the score is a mechanical substitute. */
  judgeFallback?: boolean;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.PANELIST_EMAIL;
  if (!apiKey || !to) return;

  const candidateDisplay = params.candidateName
    ? `${params.candidateName}${params.candidateEmail ? ` (${params.candidateEmail})` : ""}`
    : params.candidateEmail ?? "A candidate";

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://stackscore.anandrajendran.dev";
  const url = `${baseUrl}${params.scoreCardUrl}`;

  // A substituted score must never arrive looking like an assessment result. The subject
  // line carries it too, because that is all a panelist sees in a notification list.
  const fallbackBanner = params.judgeFallback
    ? `<p style="margin:0 0 16px;padding:12px 14px;border-radius:8px;background:#3a1d1d;border:1px solid #a33;color:#ffb3b3;font-size:13px;">
<strong>This is not a judged score.</strong> The AI judge failed for this submission and
StackScore substituted a mechanical placeholder based only on which stages contained text.
It does not reflect the quality of the work. Re-run the evaluation before making any
decision on this candidate.</p>`
    : "";

  const html = `
<p>Hi,</p>
${fallbackBanner}
<p><strong>${candidateDisplay}</strong> has completed their StackScore assessment${params.role ? ` (${params.role} level)` : ""}.</p>
<table cellpadding="0" cellspacing="0" style="margin:16px 0;">
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
        subject: params.judgeFallback
          ? `[JUDGE FAILED - not a real score] StackScore: ${candidateDisplay}`
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
