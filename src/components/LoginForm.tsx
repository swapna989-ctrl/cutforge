"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Playfair_Display } from "next/font/google";
import AuthShell from "@/components/AuthShell";
import PasswordInput from "@/components/PasswordInput";
import GoogleButton from "@/components/GoogleButton";
import { useAuth } from "@/lib/auth";

const playfair = Playfair_Display({ subsets: ["latin"], weight: ["600"], style: ["normal", "italic"] });

export default function LoginForm() {
  const auth = useAuth();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Seeded from ?error=... when /auth/callback bounces back a failed OAuth or link confirmation.
  const [error, setError] = useState<string | null>(() => searchParams.get("error"));

  useEffect(() => {
    // A full navigation, not router.replace -- someone landing here already signed in may have
    // browsed anonymously in this same tab before, and Next's client-side router cache can still be
    // holding a stale, logged-out copy of a static page (e.g. /pricing) from back then. A real page
    // load clears that cache and gives the server (and its middleware -- see src/proxy.ts) a fresh
    // request with the real cookie, instead of trusting whatever the client already had cached.
    if (auth.ready && auth.user) window.location.href = "/dashboard";
  }, [auth.ready, auth.user]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setError(null);
    setSubmitting(true);
    const { error: signInError } = await auth.signInWithPassword(email, password);
    setSubmitting(false);
    if (signInError) {
      setError(signInError);
      return;
    }
    // A full navigation for the same reason as the effect above -- this is the moment auth state
    // just changed from anonymous to signed-in, which is exactly when a stale client-cached page
    // from before sign-in would otherwise survive into the new session.
    window.location.href = "/dashboard";
  }

  return (
    <AuthShell>
      <h1 className={`${playfair.className} text-2xl font-semibold text-[#1d1b1e] text-center mb-1 tracking-tight`}>
        Welcome <span className="italic text-[#9a4153]">back</span>
      </h1>
      <p className="text-xs text-[#7B7579] text-center mb-6">Sign in to pick up where you left off.</p>

      <GoogleButton />

      <div className="flex items-center space-x-3 my-5">
        <div className="flex-1 h-px bg-[#ECE5E6]" />
        <span className="text-[10px] uppercase tracking-widest text-[#7B7579]">or</span>
        <div className="flex-1 h-px bg-[#ECE5E6]" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-[#1d1b1e] mb-1.5">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@studio.com"
            className="w-full bg-white border border-[#ECE5E6] rounded-xl px-4 py-2.5 text-sm text-[#1d1b1e] placeholder-[#B3ACA6] focus:border-[#ed8395] focus:ring-2 focus:ring-[#ed8395]/20 outline-none transition-all"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-xs font-medium text-[#1d1b1e]">Password</label>
            <Link href="/forgot-password" className="text-xs text-[#9a4153] hover:text-[#7c2a3c] font-medium">
              Forgot password?
            </Link>
          </div>
          <PasswordInput value={password} onChange={setPassword} placeholder="••••••••" required />
        </div>

        {error && <p className="text-xs text-[#B0503E]">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full mt-2 py-2.5 rounded-full text-sm font-semibold bg-[#ed8395] text-white shadow-[0_6px_18px_-3px_rgba(237,131,149,0.35)] hover:bg-[#9a4153] transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="text-xs text-[#7B7579] text-center mt-6">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="text-[#1d1b1e] hover:text-[#9a4153] font-semibold">
          Create one
        </Link>
      </p>
    </AuthShell>
  );
}
