"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Playfair_Display } from "next/font/google";
import AuthShell from "@/components/AuthShell";
import PasswordInput from "@/components/PasswordInput";
import GoogleButton from "@/components/GoogleButton";
import { useAuth } from "@/lib/auth";

const playfair = Playfair_Display({ subsets: ["latin"], weight: ["600"], style: ["normal", "italic"] });

export default function SignupPage() {
  const auth = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A full navigation, not router.replace -- see LoginForm's identical comment: this clears any
    // stale, logged-out page the client's router cache may still be holding from before sign-in.
    if (auth.ready && auth.user) window.location.href = "/dashboard";
  }, [auth.ready, auth.user]);

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
    window.location.href = "/dashboard";
  }

  return (
    <AuthShell>
      <h1 className={`${playfair.className} text-2xl font-semibold text-[#1d1b1e] text-center mb-1 tracking-tight`}>
        Create an <span className="italic text-[#9a4153]">account</span>
      </h1>
      <p className="text-xs text-[#7B7579] text-center mb-6">Turn your long videos into polished cuts in minutes.</p>

      <GoogleButton />

      <div className="flex items-center space-x-3 my-5">
        <div className="flex-1 h-px bg-[#ECE5E6]" />
        <span className="text-[10px] uppercase tracking-widest text-[#7B7579]">or</span>
        <div className="flex-1 h-px bg-[#ECE5E6]" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-[#1d1b1e] mb-1.5">Name</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Alex Rivera"
            className="w-full bg-white border border-[#ECE5E6] rounded-xl px-4 py-2.5 text-sm text-[#1d1b1e] placeholder-[#B3ACA6] focus:border-[#ed8395] focus:ring-2 focus:ring-[#ed8395]/20 outline-none transition-all"
          />
        </div>
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
          <label className="block text-xs font-medium text-[#1d1b1e] mb-1.5">Password</label>
          <PasswordInput value={password} onChange={setPassword} placeholder="••••••••" required />
        </div>

        {error && <p className="text-xs text-[#B0503E]">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full mt-2 py-2.5 rounded-full text-sm font-semibold bg-[#ed8395] text-white shadow-[0_6px_18px_-3px_rgba(237,131,149,0.35)] hover:bg-[#9a4153] transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
        >
          {submitting ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="text-xs text-[#7B7579] text-center mt-6">
        Already have an account?{" "}
        <Link href="/login" className="text-[#1d1b1e] hover:text-[#9a4153] font-semibold">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
