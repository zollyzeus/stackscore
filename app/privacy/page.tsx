export const metadata = { title: "Privacy Policy - StackScore" };

export default function PrivacyPage() {
  const updated = "9 November 2026";
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "3rem 1.25rem 5rem" }}>
      <style>{`
        .legal h1 { font-size: 2rem; font-weight: 800; margin: 0 0 .4rem; }
        .legal .updated { font-size: .82rem; color: var(--text-muted); margin: 0 0 2.5rem; }
        .legal h2 { font-size: 1.1rem; font-weight: 700; margin: 2rem 0 .5rem; }
        .legal p, .legal li { font-size: .95rem; line-height: 1.7; color: var(--text-secondary, var(--fg)); }
        .legal ul { padding-left: 1.4rem; margin: .4rem 0 .8rem; }
        .legal a { color: var(--accent); }
      `}</style>
      <div className="legal">
        <h1>Privacy Policy</h1>
        <p className="updated">Last updated: {updated}</p>

        <p>StackScore (&ldquo;we&rdquo;, &ldquo;our&rdquo;, &ldquo;us&rdquo;) is an AI-powered technical assessment platform. This policy explains what data we collect, how we use it, and your rights.</p>

        <h2>1. Data we collect</h2>
        <ul>
          <li><strong>Assessment responses</strong> - your code and design answers, submitted during a session.</li>
          <li><strong>Identity information</strong> - name and email address you provide when starting an assessment or signing in.</li>
          <li><strong>Session metadata</strong> - timestamps, role, assessment configuration, and score results.</li>
          <li><strong>Usage signals</strong> - tab-switch events (proctoring) recorded during active assessment sessions only.</li>
        </ul>

        <h2>2. How we use your data</h2>
        <ul>
          <li>To evaluate and score your technical assessment using AI models.</li>
          <li>To show you your own score history on the <em>My Scores</em> page.</li>
          <li>To provide hiring panelists with candidate results on assessments they configured.</li>
          <li>To send OTP sign-in codes via email (Resend).</li>
        </ul>
        <p>We do not sell your data, use it for advertising, or share it with third parties except as described below.</p>

        <h2>3. Third-party services</h2>
        <ul>
          <li><strong>Google Gemini &amp; Anthropic Claude</strong> - AI scoring. Assessment responses are sent to these APIs and subject to their data policies.</li>
          <li><strong>Google Firebase / Firestore</strong> - data storage, hosted in the United States.</li>
          <li><strong>Resend</strong> - transactional email delivery for OTP codes.</li>
          <li><strong>Google OAuth</strong> - optional sign-in method; we receive your email and display name only.</li>
        </ul>

        <h2>4. Data retention</h2>
        <p>Assessment records are retained indefinitely to support score history. OTP codes expire after 10 minutes and are deleted on use. You may request deletion of your data at any time by emailing us.</p>

        <h2>5. Cookies</h2>
        <p>We set one session cookie per role you sign in as: <code>ss_panel</code> (panelist), <code>ss_cand</code> (candidate), and <code>ss_admin</code> (admin — IP-restricted), each valid for 7 days. Signing in as one role clears the others, so only one is active in your browser at a time. These are HMAC-signed, HttpOnly, and contain no third-party tracking.</p>

        <h2>6. Your rights</h2>
        <p>You may request access to, correction of, or deletion of your personal data by emailing <a href="mailto:greyinofficial@gmail.com">greyinofficial@gmail.com</a>. We will respond within 30 days.</p>

        <h2>7. Changes</h2>
        <p>We may update this policy. Material changes will be noted with a new &ldquo;Last updated&rdquo; date.</p>

        <h2>8. Contact</h2>
        <p>Questions? Email <a href="mailto:greyinofficial@gmail.com">greyinofficial@gmail.com</a>.</p>
      </div>
    </main>
  );
}
