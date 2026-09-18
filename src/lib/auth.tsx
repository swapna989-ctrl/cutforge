"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { friendlyAuthMessage } from "@/lib/authErrors";

export type AuthUser = { id: string; email: string; name: string };

type AuthContextValue = {
  user: AuthUser | null;
  ready: boolean;
  /** True when the current session came from a password-recovery link, not a normal sign-in. */
  isPasswordRecovery: boolean;
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithPassword: (email: string, password: string, name: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  logout: () => Promise<void>;
  updateProfile: (patch: { name?: string; email?: string }) => Promise<{ error: string | null; emailChangePending?: boolean }>;
  resetPasswordForEmail: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function mapUser(u: SupabaseUser | null | undefined): AuthUser | null {
  if (!u) return null;
  const name = (u.user_metadata?.full_name as string | undefined) || u.email?.split("@")[0] || "there";
  return { id: u.id, email: u.email ?? "", name };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ user: AuthUser | null; ready: boolean; isPasswordRecovery: boolean }>({
    user: null,
    ready: false,
    isPasswordRecovery: false,
  });

  useEffect(() => {
    const supabase = createClient();

    // onAuthStateChange fires once immediately with the current session (as an "INITIAL_SESSION"
    // event), so a separate getSession() call is redundant — worse, its promise can resolve after
    // a later auth change and overwrite newer state with stale data.
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setState((prev) => ({
        user: mapUser(session?.user),
        ready: true,
        isPasswordRecovery: event === "PASSWORD_RECOVERY" ? true : event === "SIGNED_OUT" ? false : prev.isPasswordRecovery,
      }));
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function signInWithPassword(email: string, password: string) {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? friendlyAuthMessage(error.message) : null };
  }

  async function signUpWithPassword(email: string, password: string, name: string) {
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } });
    if (error) return { error: friendlyAuthMessage(error.message) };
    if (!data.session) {
      // The Supabase project still has "Confirm email" turned on, so signUp() didn't return a
      // session. Surface this as an actionable error rather than silently bouncing the user
      // between /dashboard and /login.
      return {
        error: "Account created, but this project still requires email confirmation. Turn off \"Confirm email\" in Supabase (Authentication → Sign In / Providers → Email) to sign in immediately.",
      };
    }
    return { error: null };
  }

  async function signInWithGoogle() {
    const supabase = createClient();
    // The bare flovuraai.com apex domain is inconsistently reachable (confirmed during Google
    // OAuth brand verification: Google's crawler couldn't reach it, only www worked) -- a user who
    // loaded the login page from the bare domain would get redirected back to it after a
    // successful Google sign-in and land on a browser-level connection error. Normalized only for
    // that one specific origin; localhost and www are untouched, so local dev testing still works.
    const origin = window.location.origin === "https://flovuraai.com" ? "https://www.flovuraai.com" : window.location.origin;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${origin}/auth/callback` },
    });
    return { error: error ? friendlyAuthMessage(error.message) : null };
  }

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
  }

  async function updateProfile(patch: { name?: string; email?: string }) {
    const supabase = createClient();

    if (patch.name !== undefined) {
      const { error } = await supabase.auth.updateUser({ data: { full_name: patch.name } });
      if (error) return { error: friendlyAuthMessage(error.message) };
    }

    if (patch.email !== undefined && patch.email !== state.user?.email) {
      const { error } = await supabase.auth.updateUser({ email: patch.email });
      if (error) return { error: friendlyAuthMessage(error.message) };
      return { error: null, emailChangePending: true };
    }

    return { error: null };
  }

  async function resetPasswordForEmail(email: string) {
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    return { error: error ? friendlyAuthMessage(error.message) : null };
  }

  async function updatePassword(newPassword: string) {
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    return { error: error ? friendlyAuthMessage(error.message) : null };
  }

  return (
    <AuthContext.Provider
      value={{
        user: state.user,
        ready: state.ready,
        isPasswordRecovery: state.isPasswordRecovery,
        signInWithPassword,
        signUpWithPassword,
        signInWithGoogle,
        logout,
        updateProfile,
        resetPasswordForEmail,
        updatePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
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
