"use client";
import { createContext, useContext, useEffect, useState, useCallback } from "react";

interface AuthState { authenticated: boolean; name: string | null; loading: boolean; }
interface AuthCtx extends AuthState { logout: () => Promise<void>; refresh: () => Promise<void>; }

const Ctx = createContext<AuthCtx>({ authenticated: false, name: null, loading: true, logout: async () => {}, refresh: async () => {} });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ authenticated: false, name: null, loading: true });

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/auth/me");
      if (r.ok) {
        const d = await r.json();
        setState({ authenticated: d.authenticated, name: d.name ?? null, loading: false });
      } else {
        setState({ authenticated: false, name: null, loading: false });
      }
    } catch {
      setState({ authenticated: false, name: null, loading: false });
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setState({ authenticated: false, name: null, loading: false });
    window.location.href = "/login";
  }, []);

  return <Ctx.Provider value={{ ...state, logout, refresh }}>{children}</Ctx.Provider>;
}

export function useAuth() { return useContext(Ctx); }
