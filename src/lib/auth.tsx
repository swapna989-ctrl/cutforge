"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type AuthUser = { name: string; email: string };
type AuthState = { user: AuthUser | null; ready: boolean };

const STORAGE_KEY = "cutforge_auth";

const AuthContext = createContext<{
  user: AuthUser | null;
  ready: boolean;
  login: (email: string, name?: string) => void;
  logout: () => void;
  updateProfile: (patch: Partial<AuthUser>) => void;
} | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, ready: false });

  useEffect(() => {
    // Deferred to an effect (not a lazy useState initializer) so the first client render
    // matches the server-rendered markup before we read browser-only localStorage.
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ user: raw ? (JSON.parse(raw) as AuthUser) : null, ready: true });
    } catch {
      setState({ user: null, ready: true });
    }
  }, []);

  function login(email: string, name?: string) {
    const user: AuthUser = { email, name: name?.trim() || email.split("@")[0] };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    setState({ user, ready: true });
  }

  function logout() {
    window.localStorage.removeItem(STORAGE_KEY);
    setState({ user: null, ready: true });
  }

  function updateProfile(patch: Partial<AuthUser>) {
    setState((prev) => {
      if (!prev.user) return prev;
      const user = { ...prev.user, ...patch };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
      return { user, ready: true };
    });
  }

  return (
    <AuthContext.Provider value={{ user: state.user, ready: state.ready, login, logout, updateProfile }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** Redirects to /login if there's no signed-in user. Returns the auth state so callers can wait on `ready`. */
export function useRequireAuth() {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.ready && !auth.user) router.replace("/login");
  }, [auth.ready, auth.user, router]);

  return auth;
}
