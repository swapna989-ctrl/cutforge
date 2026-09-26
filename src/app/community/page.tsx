import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Playfair_Display } from "next/font/google";
import PublicFooter from "@/components/PublicFooter";

const playfair = Playfair_Display({ subsets: ["latin"], weight: ["500", "600"], style: ["normal", "italic"] });

// The one place this link lives -- update here if the invite ever needs to change (Discord invite
// links can expire/reset; this one was confirmed live before shipping).
const DISCORD_INVITE_URL = "https://discord.gg/tmRbZKQdA";

export const metadata: Metadata = {
  title: "Community — Flovura",
  description: "Join the Flovura beta community on Discord — share feedback, see what's shipping next, and get help fast.",
  alternates: { canonical: "/community" },
};

// A single, simple public page for the beta launch -- no in-app feed/posts (that's a much bigger
// build), just a clear path into the real Discord server where beta users actually talk to us.
// Reachable both from the landing page's header and, once signed in, the nav drawer (NavDrawer.tsx).
export default function CommunityPage() {
  return (
    <div className="min-h-screen bg-[#FAF8F7] flex flex-col">
      <header className="sticky top-0 z-40 w-full bg-[#FAF8F7]/90 backdrop-blur-xl border-b border-[#ECE5E6]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/brand/logo.png" alt="" width={28} height={28} className="w-7 h-7 rounded-lg object-cover" priority />
            <span className={`${playfair.className} text-lg font-semibold text-[#9a4153] tracking-tight`}>Flovura</span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link href="/login" className="text-sm font-medium text-[#544244] hover:text-[#1d1b1e] transition-colors px-2">
              Sign in
            </Link>
            <Link
              href="/signup"
              className="text-sm font-semibold text-white bg-[#ed8395] hover:bg-[#9a4153] px-4 py-2 rounded-full shadow-[0_6px_18px_-3px_rgba(237,131,149,0.35)] transition-all duration-150"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 py-20 text-center">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#fdd5e1]/60 text-[#9a4153] text-[11px] font-semibold tracking-wide mb-5">
          <span className="material-symbols-outlined text-[14px]">forum</span>
          <span>Beta community</span>
        </div>
        <h1 className={`${playfair.className} text-3xl sm:text-4xl font-semibold text-[#1d1b1e] tracking-tight mb-4`}>
          Come talk to us on <span className="italic text-[#9a4153]">Discord</span>.
        </h1>
        <p className="text-sm text-[#7B7579] leading-relaxed max-w-md mx-auto mb-8">
          Beta feedback, what&apos;s shipping next, and the fastest way to reach us directly if something breaks — this is where it
          all happens while Flovura is in beta.
        </p>
        <a
          href={DISCORD_INVITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 py-3 px-7 rounded-full bg-[#5865F2] text-white font-semibold text-sm shadow-[0_6px_18px_-3px_rgba(88,101,242,0.35)] hover:bg-[#4752c4] transition-all duration-150 active:scale-[0.98]"
        >
          <span>Join the Discord</span>
          <span className="material-symbols-outlined text-[18px]">arrow_outward</span>
        </a>
      </main>

      <PublicFooter />
    </div>
  );
}
