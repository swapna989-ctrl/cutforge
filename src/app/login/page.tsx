"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthShell from "@/components/AuthShell";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const auth = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (auth.ready && auth.user) router.replace("/dashboard");
  }, [auth.ready, auth.user, router]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setSubmitting(true);
    window.setTimeout(() => {
      auth.login(email);
      router.push("/dashboard");
    }, 600);
  }

  return (
    <AuthShell>
      <h1 className="font-display text-2xl font-semibold text-white text-center mb-1">Welcome back</h1>
      <p className="text-xs text-zinc-400 text-center mb-6 font-body">Sign in to pick up where you left off.</p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-[11px] font-mono uppercase tracking-wide text-zinc-500 mb-1.5">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@studio.com"
            className="w-full bg-[#0b0b0e] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:border-amber-300/40 outline-none transition-colors"
          />
        </div>
        <div>
          <label className="block text-[11px] font-mono uppercase tracking-wide text-zinc-500 mb-1.5">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full bg-[#0b0b0e] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:border-amber-300/40 outline-none transition-colors"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="cf-pill-main w-full mt-2 py-2.5 rounded-full text-xs font-bold bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 text-[#241a03] shadow-cf-pill hover:brightness-110 hover:shadow-cf-pill-lg transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="text-xs text-zinc-500 text-center mt-6 font-body">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="text-amber-200/90 hover:text-amber-200 font-medium">
          Create one
        </Link>
      </p>
    </AuthShell>
  );
}
