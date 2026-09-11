"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import AuthShell from "@/components/AuthShell";
import { useAuth } from "@/lib/auth";

export default function ForgotPasswordPage() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email) return;
    setError(null);
    setSubmitting(true);
    const { error: resetError } = await auth.resetPasswordForEmail(email);
    setSubmitting(false);
    if (resetError) {
      setError(resetError);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell>
        <div className="text-center">
          <span className="material-symbols-outlined text-amber-200 text-3xl mb-3 inline-block">mark_email_unread</span>
          <h1 className="font-display text-2xl font-semibold text-white mb-1">Check your email</h1>
          <p className="text-xs text-zinc-400 font-body">
            If an account exists for <span className="text-zinc-200">{email}</span>, we sent a link to reset your password.
          </p>
          <Link href="/login" className="inline-block mt-6 text-xs font-medium text-amber-200/90 hover:text-amber-200 underline underline-offset-2">
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="font-display text-2xl font-semibold text-white text-center mb-1">Reset your password</h1>
      <p className="text-xs text-zinc-400 text-center mb-6 font-body">Enter your email and we&apos;ll send you a reset link.</p>

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

        {error && <p className="text-xs text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="cf-pill-main w-full mt-2 py-2.5 rounded-full text-xs font-bold bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 text-[#241a03] shadow-cf-pill hover:brightness-110 hover:shadow-cf-pill-lg transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
        >
          {submitting ? "Sending…" : "Send reset link"}
        </button>
      </form>

      <p className="text-xs text-zinc-500 text-center mt-6 font-body">
        Remembered it?{" "}
        <Link href="/login" className="text-amber-200/90 hover:text-amber-200 font-medium">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
