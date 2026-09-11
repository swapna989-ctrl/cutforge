"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export type AuthUser = { id: string; email: string; name: string };

type AuthContextValue = {
  user: AuthUser | null;
  ready: boolean;
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithPassword: (email: string, password: string, name: string) => Promise<{ error: string | null; needsEmailConfirmation: boolean }>;
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
  const [state, setState] = useState<{ user: AuthUser | null; ready: boolean }>({ user: null, ready: false });

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getSession().then(({ data: { session } }) => {
      setState({ user: mapUser(session?.user), ready: true });
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ user: mapUser(session?.user), ready: true });
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function signInWithPassword(email: string, password: string) {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }

  async function signUpWithPassword(email: string, password: string, name: string) {
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name }, emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) return { error: error.message, needsEmailConfirmation: false };
    return { error: null, needsEmailConfirmation: !data.session };
  }

  async function signInWithGoogle() {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    return { error: error?.message ?? null };
  }

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
  }

  async function updateProfile(patch: { name?: string; email?: string }) {
    const supabase = createClient();

    if (patch.name !== undefined) {
      const { error } = await supabase.auth.updateUser({ data: { full_name: patch.name } });
      if (error) return { error: error.message };
    }

    if (patch.email !== undefined && patch.email !== state.user?.email) {
      const { error } = await supabase.auth.updateUser({ email: patch.email });
      if (error) return { error: error.message };
      return { error: null, emailChangePending: true };
    }

    return { error: null };
  }

  async function resetPasswordForEmail(email: string) {
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    return { error: error?.message ?? null };
  }

  async function updatePassword(newPassword: string) {
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    return { error: error?.message ?? null };
  }

  return (
    <AuthContext.Provider
      value={{
        user: state.user,
        ready: state.ready,
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
