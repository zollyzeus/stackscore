"use client";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";

const IDLE_MS  = 15 * 60 * 1000; // 15 min
const WARN_MS  =  2 * 60 * 1000; // warn 2 min before logout
const TICK_MS  = 30 * 1000;      // check every 30 s

export default function IdleGuard() {
  const { authenticated } = useAuth();
  const [candActive, setCandActive]   = useState(false);
  const [adminActive, setAdminActive] = useState(false);
  const [showWarn, setShowWarn]     = useState(false);
  const [countdown, setCountdown]   = useState(WARN_MS / 1000);
  const lastRef   = useRef(Date.now());
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const countRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // Detect candidate and admin sessions. Admin is the highest-privilege role, so it
  // must arm the idle timer too — previously only panelist and candidate did, which left
  // an admin console logged in indefinitely.
  useEffect(() => {
    fetch("/api/auth/candidate-me")
      .then(r => r.ok ? r.json() : null)
      .then(d => setCandActive(!!(d?.authenticated)))
      .catch(() => setCandActive(false));
    fetch("/api/auth/admin-me")
      .then(r => r.ok ? r.json() : null)
      .then(d => setAdminActive(!!(d?.authenticated)))
      .catch(() => setAdminActive(false));
  }, []);

  const isLoggedIn = authenticated || candActive || adminActive;

  async function doLogout() {
    setShowWarn(false);
    // Clear every role cookie that is actually present, then leave.
    //
    // The logout endpoints are called directly rather than via AuthProvider.logout(),
    // because that helper navigates to /login itself — two concurrent assignments to
    // window.location.href race, and the second can abort the first, leaving the user
    // on the page with a cleared cookie.  IdleGuard owns this navigation.
    await Promise.allSettled([
      authenticated ? fetch("/api/auth/logout", { method: "POST" }) : Promise.resolve(),
      candActive ? fetch("/api/auth/candidate-logout", { method: "POST" }) : Promise.resolve(),
      adminActive ? fetch("/api/auth/admin-logout", { method: "POST" }) : Promise.resolve(),
    ]);
    window.location.href = "/login?reason=idle";
  }

  /**
   * Marks the session active again.
   *
   * Events originating INSIDE the warning dialog are ignored. Otherwise the window-level
   * `mousedown` listener fires before React's delegated `click` handler, sets showWarn to
   * false, and unmounts the dialog — so React never dispatches the click to the button
   * that was pressed. The visible symptom was that "Log out now" merely dismissed the
   * dialog and left the user signed in.
   *
   * "Stay logged in" calls this directly, so dismissing on purpose still works.
   */
  function resetIdle(e?: Event) {
    if (
      e &&
      overlayRef.current &&
      e.target instanceof Node &&
      overlayRef.current.contains(e.target)
    ) {
      return;
    }
    lastRef.current = Date.now();
    if (showWarn) {
      setShowWarn(false);
      if (countRef.current) { clearInterval(countRef.current); countRef.current = null; }
    }
  }

  useEffect(() => {
    if (!isLoggedIn) return;

    const EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"];
    EVENTS.forEach(e => window.addEventListener(e, resetIdle, { passive: true }));

    timerRef.current = setInterval(() => {
      const idle = Date.now() - lastRef.current;
      if (idle >= IDLE_MS) {
        doLogout();
      } else if (idle >= IDLE_MS - WARN_MS && !showWarn) {
        setShowWarn(true);
        setCountdown(Math.round((IDLE_MS - idle) / 1000));
        countRef.current = setInterval(() => {
          setCountdown(c => {
            if (c <= 1) { clearInterval(countRef.current!); return 0; }
            return c - 1;
          });
        }, 1000);
      }
    }, TICK_MS);

    return () => {
      EVENTS.forEach(e => window.removeEventListener(e, resetIdle));
      if (timerRef.current)  clearInterval(timerRef.current);
      if (countRef.current)  clearInterval(countRef.current);
    };
  }, [isLoggedIn, showWarn]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!showWarn) return null;

  const mins = Math.floor(countdown / 60);
  const secs = countdown % 60;
  const display = mins > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : `${secs}s`;

  return (
    <>
      <style>{`
        .idle-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,.65); z-index: 999;
          display: flex; align-items: center; justify-content: center; padding: 1.5rem;
        }
        .idle-modal {
          background: var(--surface); border: 1.5px solid var(--border); border-radius: 16px;
          padding: 2rem 2.25rem; max-width: 380px; width: 100%; text-align: center;
          box-shadow: 0 24px 60px rgba(0,0,0,.35);
        }
        .idle-modal-icon { font-size: 2rem; margin-bottom: .75rem; }
        .idle-modal h3 { font-size: 1.1rem; font-weight: 700; margin: 0 0 .5rem; }
        .idle-modal p  { font-size: .88rem; color: var(--text-muted); margin: 0 0 1.5rem; line-height: 1.6; }
        .idle-countdown {
          font-size: 2rem; font-weight: 800; color: var(--accent);
          font-variant-numeric: tabular-nums; margin-bottom: 1.5rem;
        }
        .idle-btns { display: flex; gap: .75rem; justify-content: center; }
        .idle-btns button { padding: .6rem 1.4rem; font-size: .9rem; }
        .idle-btn-stay  { background: var(--accent); color: #fff; }
        .idle-btn-logout { background: none; border: 1px solid var(--border); color: var(--text-muted); }
        .idle-btn-logout:hover { border-color: #ef4444; color: #ef4444; background: none; }
      `}</style>
      <div ref={overlayRef} className="idle-overlay" role="alertdialog" aria-modal="true" aria-label="Session timeout warning">
        <div className="idle-modal">
          <div className="idle-modal-icon">🔒</div>
          <h3>Still there?</h3>
          <p>You&apos;ve been inactive for a while. For your security, you&apos;ll be logged out in:</p>
          <div className="idle-countdown">{display}</div>
          <div className="idle-btns">
            <button className="idle-btn-stay" onClick={() => resetIdle()}>Stay logged in</button>
            <button className="idle-btn-logout" onClick={doLogout}>Log out now</button>
          </div>
        </div>
      </div>
    </>
  );
}
