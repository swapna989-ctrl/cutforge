"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthShell from "@/components/AuthShell";
import PasswordInput from "@/components/PasswordInput";
import GoogleButton from "@/components/GoogleButton";
import { useAuth } from "@/lib/auth";

export default function SignupPage() {
  const auth = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (auth.ready && auth.user) router.replace("/dashboard");
  }, [auth.ready, auth.user, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setError(null);
    setSubmitting(true);
    const { error: signUpError } = await auth.signUpWithPassword(email, password, name);
    setSubmitting(false);
    if (signUpError) {
      setError(signUpError);
      return;
    }
    router.push("/dashboard");
  }

  return (
    <AuthShell>
      <h1 className="font-display text-2xl font-semibold text-white text-center mb-1">Create your account</h1>
      <p className="text-xs text-zinc-400 text-center mb-6 font-body">Start forging cuts in a couple of clicks.</p>

      <GoogleButton />

      <div className="flex items-center space-x-3 my-5">
        <div className="flex-1 h-px bg-white/[0.08]" />
        <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-600">or</span>
        <div className="flex-1 h-px bg-white/[0.08]" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-[11px] font-mono uppercase tracking-wide text-zinc-500 mb-1.5">Name</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Alex Rivera"
            className="w-full bg-[#0b0b0e] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:border-amber-300/40 outline-none transition-colors"
          />
        </div>
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
          <PasswordInput value={password} onChange={setPassword} placeholder="••••••••" required />
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full mt-2 py-2.5 rounded-full text-xs font-bold bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 text-[#241a03] shadow-cf-pill hover:brightness-110 hover:shadow-cf-pill-lg transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
        >
          {submitting ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="text-xs text-zinc-500 text-center mt-6 font-body">
        Already have an account?{" "}
        <Link href="/login" className="text-amber-200/90 hover:text-amber-200 font-medium">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
