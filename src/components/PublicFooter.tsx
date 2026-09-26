import Link from "next/link";
import Image from "next/image";
import { Playfair_Display } from "next/font/google";
import { SOCIAL_LINKS } from "@/lib/social";

const playfair = Playfair_Display({ subsets: ["latin"], weight: ["500", "600"], style: ["normal", "italic"] });

const LINK_CLASS = "text-xs text-[#7B7579] hover:text-[#1d1b1e] transition-colors";

// Brand glyphs aren't in the Material Symbols font the rest of the UI uses, so these are inline.
const SOCIAL_ICONS: Record<(typeof SOCIAL_LINKS)[number]["name"], React.ReactNode> = {
  Instagram: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  ),
  X: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  ),
};

/** Footer for every page an anonymous visitor (and Google) can see. Links to the legal pages from
 *  the homepage on purpose -- Google's OAuth verification looks for the privacy policy there. */
export default function PublicFooter() {
  return (
    <footer className="border-t border-[#ECE5E6]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Image src="/brand/logo.png" alt="" width={22} height={22} className="w-[22px] h-[22px] rounded-md object-cover" />
          <span className={`${playfair.className} text-sm font-semibold text-[#9a4153]`}>Flovura</span>
          <span className="text-xs text-[#B3ACA6]">© {new Date().getFullYear()}</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          <Link href="/#features" className={LINK_CLASS}>
            Features
          </Link>
          <Link href="/pricing" className={LINK_CLASS}>
            Pricing
          </Link>
          <Link href="/community" className={LINK_CLASS}>
            Community
          </Link>
          <Link href="/privacy" className={LINK_CLASS}>
            Privacy
          </Link>
          <Link href="/terms" className={LINK_CLASS}>
            Terms
          </Link>
          <Link href="/login" className={LINK_CLASS}>
            Sign in
          </Link>
          <span className="flex items-center gap-3 sm:pl-2 sm:border-l sm:border-[#ECE5E6]">
            {SOCIAL_LINKS.map((social) => (
              <a
                key={social.name}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Flovura on ${social.name}`}
                className="text-[#7B7579] hover:text-[#9a4153] transition-colors"
              >
                {SOCIAL_ICONS[social.name]}
              </a>
            ))}
          </span>
        </div>
      </div>
    </footer>
  );
}
