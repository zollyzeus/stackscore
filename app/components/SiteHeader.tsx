"use client";
import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { useAuth } from "./AuthProvider";

interface CandidateSession { authenticated: boolean; email?: string; name?: string; }
interface AdminSession { authenticated: boolean; email?: string; name?: string; }

const NAV = [
  { href: "/demo",       label: "Try Demo" },
  { href: "/why",        label: "Why StackScore" },
  { href: "/me",         label: "My Scores" },
  { href: "/dashboard",  label: "Dashboard" },
  { href: "/panel",      label: "For Hiring" },
];

// Pages where we render a minimal transparent header (no background)
const IMMERSIVE = ["/assessment", "/demo"];

function getInitialTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "dark";
  const stored = localStorage.getItem("ss_theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export default function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [candMenuOpen, setCandMenuOpen] = useState(false);
  const [candSession, setCandSession] = useState<CandidateSession | null>(null);
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [adminSession, setAdminSession] = useState<AdminSession | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const drawerRef = useRef<HTMLElement>(null);
  const { authenticated, name, logout } = useAuth();

  useEffect(() => {
    setTheme(getInitialTheme());
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("ss_theme", next); } catch {}
  }

  useEffect(() => {
    fetch("/api/auth/candidate-me")
      .then(r => r.ok ? r.json() : null)
      .then((d: CandidateSession | null) => setCandSession(d));
  }, [pathname]);

  useEffect(() => {
    fetch("/api/auth/admin-me")
      .then(r => r.ok ? r.json() : null)
      .then((d: AdminSession | null) => setAdminSession(d));
  }, [pathname]);

  async function logoutCandidate() {
    await fetch("/api/auth/candidate-logout", { method: "POST" });
    setCandSession(null);
    setCandMenuOpen(false);
    window.location.href = "/login";
  }

  async function logoutAdmin() {
    await fetch("/api/auth/admin-logout", { method: "POST" });
    setAdminSession(null);
    setAdminMenuOpen(false);
    window.location.href = "/login";
  }

  const isImmersive = IMMERSIVE.some((p) => pathname.startsWith(p));

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close menu on route change
  useEffect(() => { setOpen(false); }, [pathname]);

  // Focus trap + Escape key for mobile drawer
  useEffect(() => {
    if (!open) return;
    const drawer = drawerRef.current;
    if (!drawer) return;
    const focusable = drawer.querySelectorAll<HTMLElement>(
      'a, button, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setOpen(false); return; }
      if (e.key !== "Tab") return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last?.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <style>{`
        .sh {
          position: sticky; top: 0; z-index: 100;
          height: 56px;
          display: flex; align-items: center;
          padding-left: max(20px, env(safe-area-inset-left,0px));
          padding-right: max(20px, env(safe-area-inset-right,0px));
          transition: background .2s, border-color .2s, box-shadow .2s;
        }
        .sh.solid {
          background: var(--bg);
          border-bottom: 1px solid var(--border);
          box-shadow: 0 1px 12px rgba(0,0,0,.18);
        }
        .sh.immersive { background: transparent; border-bottom: 1px solid transparent; }
        .sh.immersive.solid {
          background: color-mix(in srgb, var(--bg) 92%, transparent);
          border-bottom-color: var(--border);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }
        .sh-inner {
          max-width: 1080px; margin: 0 auto; width: 100%;
          display: flex; align-items: center; gap: 0;
        }
        .sh-logo {
          display: flex; align-items: center;
          text-decoration: none; flex-shrink: 0; margin-right: auto;
          background: #fff; border-radius: 7px; padding: 3px 10px;
        }
        .sh-logo:hover { text-decoration: none; opacity: .88; }
        .sh-logo img { height: 26px; width: auto; display: block; }
        .sh-logo .logo-light { display: none; }
        @media (prefers-color-scheme: light) {
          :root:not([data-theme="dark"]) .sh-logo { background: transparent; padding: 3px 4px; }
          :root:not([data-theme="dark"]) .sh-logo .logo-light { display: block; }
          :root:not([data-theme="dark"]) .sh-logo .logo-dark { display: none; }
        }
        :root[data-theme="light"] .sh-logo { background: transparent; padding: 3px 4px; }
        :root[data-theme="light"] .sh-logo .logo-light { display: block; }
        :root[data-theme="light"] .sh-logo .logo-dark { display: none; }
        /* User menu */
        .sh-user { display: flex; align-items: center; gap: .5rem; margin-left: .75rem; }
        .sh-avatar {
          width: 30px; height: 30px; border-radius: 50%;
          background: var(--accent); color: #fff; font-size: .78rem; font-weight: 700;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
          cursor: pointer; border: none; transition: opacity .15s;
        }
        .sh-avatar:hover { opacity: .85; }
        .sh-user-dropdown {
          position: absolute; top: 48px; right: max(20px, env(safe-area-inset-right,0px));
          background: var(--bg); border: 1px solid var(--border); border-radius: 10px;
          box-shadow: 0 8px 24px rgba(0,0,0,.25); min-width: 180px; z-index: 200;
          overflow: hidden;
        }
        .sh-user-name { padding: .7rem 1rem; font-size: .82rem; font-weight: 600; border-bottom: 1px solid var(--border); }
        .sh-user-dropdown a, .sh-user-dropdown button {
          display: block; width: 100%; text-align: left; padding: .6rem 1rem;
          font-size: .83rem; color: var(--text-muted); background: none; border: none;
          cursor: pointer; text-decoration: none; transition: background .12s;
        }
        .sh-user-dropdown a:hover, .sh-user-dropdown button:hover { background: var(--surface); color: var(--fg); text-decoration: none; }
        .sh-nav {
          display: flex; align-items: center; gap: .15rem;
          list-style: none; margin: 0; padding: 0;
        }
        .sh-nav a {
          font-size: .83rem; font-weight: 500; color: var(--text-muted);
          text-decoration: none; padding: .35rem .7rem; border-radius: 6px;
          transition: color .15s, background .15s;
          white-space: nowrap;
        }
        .sh-nav a:hover { color: var(--text); background: var(--surface); text-decoration: none; }
        .sh-nav a.active { color: var(--accent); }
        .sh-cta {
          font-size: .82rem; font-weight: 700;
          background: var(--accent); color: #fff;
          padding: .38rem 1rem; border-radius: 7px;
          text-decoration: none; margin-left: .75rem; flex-shrink: 0;
          transition: opacity .15s;
        }
        .sh-cta:hover { opacity: .88; text-decoration: none; color: #fff; }
        .sh-theme-toggle {
          display: flex; align-items: center; justify-content: center;
          background: none; border: 1px solid var(--border); color: var(--text-muted);
          cursor: pointer; padding: .32rem; border-radius: 6px; margin-left: .5rem;
          flex-shrink: 0; width: 30px; height: 30px; transition: border-color .15s, color .15s, background .15s;
        }
        .sh-theme-toggle:hover { background: var(--surface); color: var(--text); border-color: var(--accent); }
        .sh-burger {
          display: none; background: none; border: none;
          color: var(--text-muted); cursor: pointer; padding: .4rem;
          border-radius: 6px; margin-left: .5rem; flex-shrink: 0;
        }
        .sh-burger:hover { background: var(--surface); color: var(--text); }
        /* Mobile drawer */
        .sh-drawer {
          position: fixed; inset: 56px 0 0 0; z-index: 99;
          background: var(--bg); border-top: 1px solid var(--border);
          padding: 1.25rem max(20px, env(safe-area-inset-left,0px));
          display: flex; flex-direction: column; gap: .25rem;
          transform: translateY(-8px); opacity: 0;
          pointer-events: none;
          transition: opacity .18s, transform .18s;
        }
        .sh-drawer.open {
          transform: translateY(0); opacity: 1; pointer-events: all;
        }
        .sh-drawer a {
          font-size: 1rem; font-weight: 500; color: var(--text-muted);
          text-decoration: none; padding: .65rem .5rem;
          border-bottom: 1px solid var(--border);
          transition: color .12s;
        }
        .sh-drawer a:last-child { border-bottom: none; }
        .sh-drawer a:hover { color: var(--accent); text-decoration: none; }
        .sh-drawer a.active { color: var(--accent); font-weight: 700; }
        .sh-drawer-brand {
          display: flex; align-items: center; gap: .4rem;
          padding-bottom: 1rem; margin-bottom: .25rem;
          border-bottom: 1px solid var(--border);
        }
        .sh-drawer-brand img { width: 24px; height: 24px; object-fit: contain; }
        .sh-drawer-brand span {
          font-size: .78rem; font-weight: 800; letter-spacing: .16em;
          text-transform: uppercase; color: var(--accent);
        }
        .sh-drawer .sh-cta {
          margin: .75rem 0 0; text-align: center;
          padding: .65rem 1rem; font-size: .92rem; border-radius: 8px;
        }
        @media (max-width: 680px) {
          .sh-nav, .sh-cta { display: none !important; }
          .sh-burger { display: flex !important; align-items: center; }
        }
      `}</style>

      <header className={`sh${isImmersive ? " immersive" : ""}${scrolled ? " solid" : ""}`}>
        <div className="sh-inner">
          <a href="/" className="sh-logo">
            <Image src="/logo-brand.png" alt="StackScore" width={120} height={26} style={{ height: 26, width: "auto" }} className="logo-dark" />
            <Image src="/logo-brand-light.png" alt="StackScore" width={120} height={26} style={{ height: 26, width: "auto" }} className="logo-light" />
          </a>
          <nav aria-label="Main navigation">
            <ul className="sh-nav">
              {NAV.map((n) => (
                <li key={n.href}>
                  <a href={n.href} className={pathname === n.href ? "active" : ""}>{n.label}</a>
                </li>
              ))}
            </ul>
          </nav>
          <a href="/demo" className="sh-cta">Try free →</a>
          {authenticated && name && (
            <div className="sh-user" style={{ position: "relative" }}>
              <button className="sh-avatar" onClick={() => setUserMenuOpen(o => !o)} aria-label="User menu">
                {name[0].toUpperCase()}
              </button>
              {userMenuOpen && (
                <div className="sh-user-dropdown" onClick={() => setUserMenuOpen(false)}>
                  <div className="sh-user-name">{name}</div>
                  <a href="/dashboard">Dashboard</a>
                  <a href="/panel">Create Assessment</a>
                  <a href="/compare">Compare Candidates</a>
                  <button onClick={logout}>Sign out</button>
                </div>
              )}
            </div>
          )}
          {adminSession?.authenticated && (
            <div className="sh-user" style={{ position: "relative" }}>
              <button className="sh-avatar" style={{ background: "#6c63ff" }}
                onClick={() => setAdminMenuOpen(o => !o)} aria-label="Admin menu" title={adminSession.email}>
                {(adminSession.name ?? adminSession.email ?? "A")[0].toUpperCase()}
              </button>
              {adminMenuOpen && (
                <div className="sh-user-dropdown" onClick={() => setAdminMenuOpen(false)}>
                  <div className="sh-user-name">{adminSession.name ?? adminSession.email} · Admin</div>
                  <a href="/admin">Admin Console</a>
                  <button onClick={logoutAdmin}>Sign out</button>
                </div>
              )}
            </div>
          )}
          {candSession?.authenticated && (
            <div className="sh-user" style={{ position: "relative" }}>
              <button className="sh-avatar"
                onClick={() => setCandMenuOpen(o => !o)} aria-label="Candidate menu" title={candSession.email}>
                {(candSession.name ?? candSession.email ?? "C")[0].toUpperCase()}
              </button>
              {candMenuOpen && (
                <div className="sh-user-dropdown" onClick={() => setCandMenuOpen(false)}>
                  <div className="sh-user-name">{candSession.name ?? candSession.email}</div>
                  <a href="/me">My Scores</a>
                  <a href="/assessment">Take Assessment</a>
                  <button onClick={logoutCandidate}>Sign out</button>
                </div>
              )}
            </div>
          )}
          {!candSession?.authenticated && !authenticated && !adminSession?.authenticated && (
            <a href="/login" style={{ fontSize: ".82rem", color: "var(--accent)", marginLeft: ".75rem", textDecoration: "none", fontWeight: 600 }}>
              Sign in
            </a>
          )}
          <button
            className="sh-theme-toggle"
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            onClick={toggleTheme}
            title={theme === "dark" ? "Light mode" : "Dark mode"}
          >
            {theme === "dark"
              ? /* sun */ <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              : /* moon */ <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            }
          </button>
          <button
            className="sh-burger"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open
              ? <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
              : <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            }
          </button>
        </div>
      </header>

      {/* Mobile drawer */}
      <nav ref={drawerRef} className={`sh-drawer${open ? " open" : ""}`} aria-label="Mobile navigation">
        <div className="sh-drawer-brand">
          <Image src="/logo.png" alt="" aria-hidden="true" width={24} height={24} />
          <span>StackScore</span>
        </div>
        {NAV.map((n) => (
          <a key={n.href} href={n.href} className={pathname === n.href ? "active" : ""}>{n.label}</a>
        ))}
        <a href="/demo" className="sh-cta">Try free →</a>
      </nav>
    </>
  );
}
