"use client";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";

function GoogleButton({ href }: { href: string }) {
  return (
    <a href={href} style={{
      display: "flex", alignItems: "center", justifyContent: "center", gap: ".6rem",
      width: "100%", padding: ".65rem", borderRadius: 10, fontSize: ".95rem", fontWeight: 600,
      border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--fg)",
      textDecoration: "none", boxSizing: "border-box",
    }}>
      <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/><path fill="none" d="M0 0h48v48H0z"/></svg>
      Continue with Google
    </a>
  );
}

type UserType = "candidate" | "panelist" | "admin";

function LoginForm() {
  const params = useSearchParams();
  const urlError = params.get("error");
  const urlType = params.get("type") as UserType | null;
  // Admin is never a public toggle option — only reachable via a direct ?type=admin link
  // (e.g. the middleware redirect from /admin), never chosen from the Candidate/Panelist UI.
  const isAdminMode = urlType === "admin";

  const [type, setType] = useState<UserType>(urlType === "panelist" ? "panelist" : isAdminMode ? "admin" : "candidate");
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(urlError ? "Google sign-in failed. Try OTP instead." : "");
  const [notice, setNotice] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  const defaultNext = type === "panelist" ? "/dashboard" : type === "admin" ? "/admin" : "/me";

  /**
   * `next` is attacker-controllable, and it is assigned to window.location.href after a
   * successful sign-in. Only same-origin absolute paths are allowed, so
   * ?next=https://evil.com (phishing) and ?next=javascript:... (script execution) are
   * both rejected. Mirrors the server-side check in /api/auth/google/callback.
   */
  const rawNext = params.get("next");
  const next =
    rawNext &&
    rawNext.startsWith("/") &&
    !rawNext.startsWith("//") &&
    !rawNext.includes("://") &&
    !rawNext.includes("\\")
      ? rawNext
      : defaultNext;

  // Auto-redirect if already signed in
  useEffect(() => {
    const checkUrl = type === "candidate" ? "/api/auth/candidate-me" : type === "admin" ? "/api/auth/admin-me" : "/api/auth/me";
    fetch(checkUrl).then(r => r.ok ? r.json() : null).then((d: { authenticated?: boolean } | null) => {
      if (d?.authenticated) window.location.href = defaultNext;
    });
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-fill from localStorage for candidates
  useEffect(() => {
    if (type === "candidate") {
      try {
        const saved = localStorage.getItem("ss_candidate");
        if (saved) {
          const { name: n, email: e } = JSON.parse(saved);
          if (n) setName(n);
          if (e) setEmail(e);
        }
      } catch { /* ignore */ }
    }
  }, [type]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown(c => c - 1), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  // Reset step when switching type
  function switchType(t: UserType) {
    setType(t); setStep("email"); setCode(""); setError("");
  }

  async function sendOTP() {
    if (!email.trim() || !email.includes("@")) { setError("Enter a valid email."); return; }
    setLoading(true); setError(""); setNotice("");
    const r = await fetch("/api/auth/send-otp", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), type }),
    });
    const d = await r.json();
    setLoading(false);
    if (r.status === 202 && d.error === "pending_approval") {
      setNotice("Your panelist access request has been submitted. We'll review it shortly.");
      return;
    }
    if (!r.ok) {
      if (d.error === "access_denied") { setError("Your access request was not approved. Contact support."); return; }
      setError(d.error ?? "Failed to send code."); return;
    }
    setStep("code"); setResendCooldown(60);
  }

  async function verifyOTP(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError("");
    const r = await fetch("/api/auth/verify-otp", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), code: code.trim(), type, name: name.trim() }),
    });
    const d = await r.json();
    setLoading(false);
    if (!r.ok) { setError(d.error ?? "Invalid or expired code."); return; }
    if (type === "candidate") {
      try { localStorage.setItem("ss_candidate", JSON.stringify({ email: email.trim(), name: name.trim() })); } catch { /* ignore */ }
    }
    window.location.href = next;
  }

  const googleUrl = `/api/auth/google?type=${type}&next=${encodeURIComponent(type === "panelist" ? "/dashboard" : "/me")}`;

  const copy = {
    candidate: { title: "Candidate sign in", sub: "Track your assessment scores and improvement over time." },
    panelist:  { title: "Panelist sign in",  sub: "Access the hiring dashboard and candidate pipeline." },
    admin:     { title: "Admin sign in",     sub: "Restricted to the admin registry, from an allow-listed network only." },
  }[type];

  return (
    <main style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
      <style>{`
        .lb { width:100%; max-width:400px; background:var(--surface); border:1px solid var(--border); border-radius:16px; padding:2.5rem 2rem; }
        .lb-logo { text-align:center; margin-bottom:1.75rem; }
        .lb-logo a { display:inline-flex; align-items:center; background:#fff; border-radius:7px; padding:4px 12px; text-decoration:none; }
        .lb-logo img { height:30px; width:auto; display:block; }
        .lb-logo .logo-light { display: none; }
        @media (prefers-color-scheme: light) {
          :root:not([data-theme="dark"]) .lb-logo .logo-light { display: block; }
          :root:not([data-theme="dark"]) .lb-logo .logo-dark { display: none; }
        }
        :root[data-theme="light"] .lb-logo .logo-light { display: block; }
        :root[data-theme="light"] .lb-logo .logo-dark { display: none; }
        .lb-toggle { display:flex; background:var(--bg); border:1px solid var(--border); border-radius:10px; padding:3px; gap:3px; margin-bottom:1.75rem; }
        .lb-toggle-btn {
          flex:1; padding:.45rem .5rem; border-radius:7px; font-size:.85rem; font-weight:600;
          border:none; cursor:pointer; background:none; color:var(--text-muted);
          transition:background .15s, color .15s;
        }
        .lb-toggle-btn.active { background:var(--surface); color:var(--fg); box-shadow:0 1px 4px rgba(0,0,0,.15); }
        .lb-title { font-size:1.05rem; font-weight:700; text-align:center; margin-bottom:.3rem; }
        .lb-sub { font-size:.82rem; color:var(--text-muted); text-align:center; margin-bottom:1.5rem; line-height:1.5; }
        .lb-label { display:block; font-size:.75rem; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:.07em; margin-bottom:.35rem; }
        .lb-input { width:100%; padding:.6rem .8rem; border-radius:8px; font-size:.95rem; border:1px solid var(--border); background:var(--bg); color:var(--fg); outline:none; transition:border-color .15s; box-sizing:border-box; margin-bottom:.9rem; }
        .lb-input:focus { border-color:var(--accent); }
        .lb-btn { width:100%; padding:.7rem; border-radius:10px; font-size:1rem; font-weight:700; background:var(--accent); color:#fff; border:none; cursor:pointer; transition:opacity .15s; }
        .lb-btn:hover:not(:disabled) { opacity:.88; }
        .lb-btn:disabled { opacity:.55; cursor:not-allowed; }
        .lb-err { background:#ff444422; border:1px solid #ff4444; color:#ff6666; border-radius:8px; padding:.55rem .85rem; font-size:.82rem; margin-bottom:.9rem; }
        .lb-notice { background:#3ecf8e22; border:1px solid #3ecf8e55; color:#3ecf8e; border-radius:8px; padding:.55rem .85rem; font-size:.82rem; margin-bottom:.9rem; }
        .lb-divider { display:flex; align-items:center; gap:.75rem; margin:1.1rem 0; color:var(--text-muted); font-size:.73rem; }
        .lb-divider::before,.lb-divider::after { content:""; flex:1; height:1px; background:var(--border); }
      `}</style>

      <div className="lb">
        <div className="lb-logo"><a href="/"><img src="/logo-brand.png" alt="StackScore" className="logo-dark" /><img src="/logo-brand-light.png" alt="StackScore" className="logo-light" /></a></div>

        {/* Type toggle — admin is never a selectable option here, only reachable via a direct admin link */}
        {!isAdminMode && (
          <div className="lb-toggle" role="group" aria-label="Sign in as">
            <button className={`lb-toggle-btn${type === "candidate" ? " active" : ""}`} onClick={() => switchType("candidate")}>
              Candidate
            </button>
            <button className={`lb-toggle-btn${type === "panelist" ? " active" : ""}`} onClick={() => switchType("panelist")}>
              Panelist
            </button>
          </div>
        )}

        <p className="lb-title">{copy.title}</p>
        <p className="lb-sub">{copy.sub}</p>

        {error && <div className="lb-err">{error}</div>}
        {notice && <div className="lb-notice">✓ {notice}</div>}

        {step === "email" ? (
          <>
            <label className="lb-label">Email</label>
            <input className="lb-input" type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder={type === "panelist" ? "you@company.com" : "you@example.com"}
              autoFocus onKeyDown={e => e.key === "Enter" && sendOTP()} />
            <label className="lb-label">Name <span style={{ fontWeight:400, textTransform:"none", letterSpacing:0 }}>(optional)</span></label>
            <input className="lb-input" type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="Your name" />
            <button className="lb-btn" onClick={sendOTP} disabled={loading || !email.trim()}>
              {loading ? "Sending…" : "Send sign-in code →"}
            </button>
            {!isAdminMode && (
              <>
                <div className="lb-divider">or</div>
                <GoogleButton href={googleUrl} />
              </>
            )}
          </>
        ) : (
          <form onSubmit={verifyOTP}>
            <p style={{ fontSize: ".83rem", color: "var(--text-muted)", marginBottom: "1.1rem", textAlign: "center" }}>
              Code sent to <strong>{email}</strong>
            </p>
            <input className="lb-input" type="text" inputMode="numeric" maxLength={6}
              value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000" autoFocus
              style={{ textAlign: "center", letterSpacing: ".35em", fontSize: "1.5rem", fontWeight: 700 }} />
            <button className="lb-btn" type="submit" disabled={loading || code.length !== 6}>
              {loading ? "Verifying…" : "Sign in →"}
            </button>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: ".7rem", fontSize: ".8rem" }}>
              <button type="button" onClick={() => { setStep("email"); setCode(""); setError(""); }}
                style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
                ← Change email
              </button>
              <button type="button" onClick={sendOTP} disabled={resendCooldown > 0 || loading}
                style={{ background: "none", border: "none", color: resendCooldown > 0 ? "var(--text-muted)" : "var(--accent)", cursor: resendCooldown > 0 ? "default" : "pointer" }}>
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center" }}><p style={{ color: "var(--text-muted)" }}>Loading…</p></main>}>
      <LoginForm />
    </Suspense>
  );
}
