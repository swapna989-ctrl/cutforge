"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AuthShell from "@/components/AuthShell";
import PasswordInput from "@/components/PasswordInput";
import { useAuth } from "@/lib/auth";

export default function ResetPasswordPage() {
  const auth = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password) return;
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setError(null);
    setSubmitting(true);
    const { error: updateError } = await auth.updatePassword(password);
    setSubmitting(false);
    if (updateError) {
      setError(updateError);
      return;
    }
    setDone(true);
    window.setTimeout(() => router.push("/dashboard"), 1500);
  }

  if (!auth.ready) return null;

  if (!auth.user) {
    return (
      <AuthShell>
        <div className="text-center">
          <span className="material-symbols-outlined text-red-400 text-3xl mb-3 inline-block">link_off</span>
          <h1 className="font-display text-2xl font-semibold text-white mb-1">Link expired</h1>
          <p className="text-xs text-zinc-400 font-body">This password reset link is invalid or has expired. Request a new one.</p>
          <Link
            href="/forgot-password"
            className="inline-block mt-6 text-xs font-medium text-amber-200/90 hover:text-amber-200 underline underline-offset-2"
          >
            Send a new link
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell>
        <div className="text-center">
          <span className="material-symbols-outlined text-emerald-400 text-3xl mb-3 inline-block">check_circle</span>
          <h1 className="font-display text-2xl font-semibold text-white mb-1">Password updated</h1>
          <p className="text-xs text-zinc-400 font-body">Taking you to your dashboard…</p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="font-display text-2xl font-semibold text-white text-center mb-1">Set a new password</h1>
      <p className="text-xs text-zinc-400 text-center mb-6 font-body">Choose a new password for {auth.user.email}.</p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-[11px] font-mono uppercase tracking-wide text-zinc-500 mb-1.5">New password</label>
          <PasswordInput value={password} onChange={setPassword} placeholder="••••••••" required />
        </div>
        <div>
          <label className="block text-[11px] font-mono uppercase tracking-wide text-zinc-500 mb-1.5">Confirm password</label>
          <PasswordInput value={confirmPassword} onChange={setConfirmPassword} placeholder="••••••••" required />
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="cf-pill-main w-full mt-2 py-2.5 rounded-full text-xs font-bold bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 text-[#241a03] shadow-cf-pill hover:brightness-110 hover:shadow-cf-pill-lg transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
        >
          {submitting ? "Updating…" : "Update password"}
        </button>
      </form>
    </AuthShell>
  );
}
