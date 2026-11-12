import type { OTPType } from "./otp";
const FROM = process.env.RESEND_FROM ?? "noreply@stackscore.anandrajendran.dev";
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "https://stackscore.anandrajendran.dev";

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY not configured");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `StackScore <${FROM}>`, to: [to], subject, html }),
  });
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`);
}

export async function sendOTPEmail(to: string, code: string, type: OTPType): Promise<void> {
  const role = type === "panelist" ? "Panelist" : type === "admin" ? "Admin" : type === "reviewer" ? "Reviewer" : "Candidate";
  const dest = type === "panelist" ? "/dashboard" : type === "admin" ? "/admin" : type === "reviewer" ? "/review" : "/me";
  await sendEmail(
    to,
    `Your StackScore sign-in code: ${code}`,
    `
<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;">
  <p style="font-size:11px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:#6c63ff;margin:0 0 20px;">StackScore</p>
  <h1 style="font-size:22px;font-weight:800;margin:0 0 8px;">Your ${role} sign-in code</h1>
  <p style="color:#888;margin:0 0 28px;">Valid for 10 minutes. Do not share it.</p>
  <div style="background:#f4f4f8;border:1px solid #d8d8e8;border-radius:12px;padding:28px;text-align:center;margin-bottom:28px;">
    <span style="font-size:40px;font-weight:800;letter-spacing:.25em;color:#1a1a2e;">${code}</span>
  </div>
  <p style="color:#888;font-size:13px;">If you didn't request this, you can ignore the email.</p>
  <p style="color:#555;font-size:12px;margin-top:24px;">Sent by StackScore · <a href="${BASE_URL}${dest}" style="color:#6c63ff;">Go to ${dest}</a></p>
</div>
    `.trim()
  );
}
