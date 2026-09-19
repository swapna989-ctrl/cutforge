import Link from "next/link";
import Image from "next/image";
import { Playfair_Display } from "next/font/google";

const playfair = Playfair_Display({ subsets: ["latin"], weight: ["500", "600"], style: ["normal", "italic"] });

export const metadata = {
  title: "Terms of Service — Flovura",
  description: "The terms that govern your use of Flovura.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[#FAF8F7]">
      <header className="border-b border-[#ECE5E6] bg-white">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-16 flex items-center">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/brand/logo.png" alt="" width={28} height={28} className="w-7 h-7 rounded-lg object-cover" />
            <span className={`${playfair.className} text-lg font-semibold text-[#9a4153] tracking-tight`}>Flovura</span>
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
        <h1 className={`${playfair.className} text-2xl sm:text-3xl font-semibold text-[#1d1b1e] tracking-tight mb-2`}>Terms of Service</h1>
        <p className="text-xs text-[#B3ACA6] mb-10">Last updated September 18, 2026</p>

        <div className="space-y-8 text-sm text-[#544244] leading-relaxed">
          <section>
            <p>
              These terms govern your use of flovuraai.com (the "Service"), operated by Flovura ("we," "us"). By creating an account
              or using the Service, you agree to these terms. If you don't agree, please don't use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#1d1b1e] mb-2">The Service</h2>
            <p>
              Flovura lets you upload a video, or provide a link to one, and automatically generates shorter clips from it with
              AI-planned hooks, captions, and viral-score estimates. Some output is watermarked or limited based on your plan and
              credit balance, as shown in the app.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#1d1b1e] mb-2">Your account</h2>
            <p>
              You're responsible for keeping your login credentials secure and for all activity under your account. You must provide
              accurate information when signing up and be at least 13 years old to use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#1d1b1e] mb-2">Your content</h2>
            <p className="mb-2">
              You retain all ownership rights to the videos you upload and the clips generated from them. By uploading a video, you
              grant us a limited license to store, process, and transform it solely to provide the Service to you (e.g. transcribing
              it, rendering clips, generating captions).
            </p>
            <p>
              You're responsible for making sure you have the rights to any video you upload or link to, and that it doesn't violate
              anyone else's rights or applicable law. We may remove content or suspend accounts that violate this.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#1d1b1e] mb-2">Credits and billing</h2>
            <p>
              Processing a video uses credits based on its length, as shown in the app. New accounts receive a small number of free
              credits; additional credits or subscription plans can be purchased. Pricing is shown in the app before you buy.
              Purchases and subscriptions are non-refundable except where required by law.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#1d1b1e] mb-2">Acceptable use</h2>
            <p className="mb-2">You agree not to use the Service to:</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Upload content you don't have the rights to, or that infringes someone else's intellectual property.</li>
              <li>Upload unlawful, defamatory, or harmful content.</li>
              <li>Attempt to disrupt, reverse-engineer, or gain unauthorized access to the Service.</li>
              <li>Use automated means to abuse free credits or otherwise circumvent billing.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#1d1b1e] mb-2">Service "as is"</h2>
            <p>
              The Service is provided "as is," without warranties of any kind. AI-generated outputs (clip selection, captions, viral
              scores) may contain errors and are provided for your convenience, not as guarantees of accuracy or performance. To the
              maximum extent permitted by law, we aren't liable for indirect or consequential damages arising from your use of the
              Service.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#1d1b1e] mb-2">Termination</h2>
            <p>
              You may stop using the Service and delete your account at any time. We may suspend or terminate accounts that violate
              these terms.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#1d1b1e] mb-2">Changes to these terms</h2>
            <p>We may update these terms from time to time. We'll update the date at the top of this page when we do.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#1d1b1e] mb-2">Contact us</h2>
            <p>
              Questions about these terms? Email us at{" "}
              <a href="mailto:swapna.builds@gmail.com" className="text-[#9a4153] underline underline-offset-2">
                swapna.builds@gmail.com
              </a>
              .
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
