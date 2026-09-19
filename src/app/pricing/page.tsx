import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Playfair_Display } from "next/font/google";
import PublicPricing from "@/components/PublicPricing";
import PublicFooter from "@/components/PublicFooter";

const playfair = Playfair_Display({ subsets: ["latin"], weight: ["500", "600"], style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: "Pricing — Flovura",
  description:
    "Flovura pricing: monthly plans from ₹499 and one-off credit packs for turning long videos into AI-planned shorts, watermark-free. Start with a free credit.",
  alternates: { canonical: "/pricing" },
};

// This is the public page anonymous visitors (and Google) get at /pricing. Signed-in users are
// rewritten by src/proxy.ts to /pricing/account, the in-app version with their balance and plan
// controls, so every existing in-app link to /pricing keeps working unchanged.
export default function PricingPage() {
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

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-14">
        <PublicPricing />
      </main>

      <PublicFooter />
    </div>
  );
}
