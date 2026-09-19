import Link from "next/link";
import Image from "next/image";
import { Playfair_Display } from "next/font/google";
import PublicFooter from "@/components/PublicFooter";

const playfair = Playfair_Display({ subsets: ["latin"], weight: ["500", "600"], style: ["normal", "italic"] });

export const metadata = {
  title: "Privacy Policy — Flovura",
  description: "How Flovura collects, uses, and protects your data.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#FAF8F7] flex flex-col">
      <header className="border-b border-[#ECE5E6] bg-white">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-16 flex items-center">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/brand/logo.png" alt="" width={28} height={28} className="w-7 h-7 rounded-lg object-cover" />
            <span className={`${playfair.className} text-lg font-semibold text-[#9a4153] tracking-tight`}>Flovura</span>
          </Link>
        </div>
      </header>

      <main className="flex-1 w-full max-w-2xl mx-auto px-4 sm:px-6 py-12">
        <h1 className={`${playfair.className} text-2xl sm:text-3xl font-semibold text-[#1d1b1e] tracking-tight mb-2`}>Privacy Policy</h1>
        <p className="text-xs text-[#B3ACA6] mb-10">Last updated September 18, 2026</p>

        <div className="space-y-8 text-sm text-[#544244] leading-relaxed">
          <section>
            <p>
              This policy explains what information Flovura ("we," "us") collects when you use flovuraai.com (the "Service"), how we
              use it, and the choices you have. By using the Service, you agree to the collection and use of information as described
              here.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#1d1b1e] mb-2">Information we collect</h2>
            <p className="mb-2">
              <strong className="text-[#1d1b1e]">Account information.</strong> When you sign up, we collect your name and email address,
              either directly or from your Google account if you sign in with Google (in which case we receive your name, email
              address, and profile picture as authorized by Google).
            </p>
            <p className="mb-2">
              <strong className="text-[#1d1b1e]">Video content.</strong> The video files you upload, or that we download from a link you
              provide, along with the clips, captions, and metadata we generate from them.
            </p>
            <p>
              <strong className="text-[#1d1b1e]">Billing information.</strong> Your credit balance, plan, and purchase history. Flovura
              does not itself store payment card details — those are handled by our payment provider once real payments are enabled.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#1d1b1e] mb-2">How we use your information</h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>To process your videos: transcribing audio, planning clips, generating captions, and rendering output files.</li>
              <li>To operate your account: authentication, tracking your credit balance and plan, and remembering your preferences.</li>
              <li>To communicate with you about your account or the Service, such as billing or support matters.</li>
              <li>To maintain and improve the Service, including diagnosing failures in video processing.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#1d1b1e] mb-2">Third-party services we use</h2>
            <p className="mb-2">We rely on the following third-party services to operate Flovura. Your data is shared with them only as needed to provide the Service:</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li><strong className="text-[#1d1b1e]">Supabase</strong> — authentication and database storage for your account, project, and billing data.</li>
              <li><strong className="text-[#1d1b1e]">Cloudflare R2</strong> — storage for uploaded source videos and rendered output clips.</li>
              <li><strong className="text-[#1d1b1e]">OpenAI</strong> — transcribing your video's audio and generating clip plans, captions, and hooks.</li>
              <li><strong className="text-[#1d1b1e]">Google</strong> — if you choose to sign in with Google, for authenticating your account.</li>
              <li><strong className="text-[#1d1b1e]">Railway</strong> — hosting for our application and video-processing infrastructure.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#1d1b1e] mb-2">Data retention and deletion</h2>
            <p>
              We retain your videos and account data for as long as your account is active. You can delete individual projects and
              clips at any time from within the app. To delete your account and all associated data, contact us at the email below.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#1d1b1e] mb-2">Your rights</h2>
            <p>
              You may request access to, correction of, or deletion of your personal data at any time by contacting us. You can also
              update your name and email directly from Settings within the app.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#1d1b1e] mb-2">Children's privacy</h2>
            <p>The Service is not directed to children under 13, and we do not knowingly collect personal information from them.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#1d1b1e] mb-2">Changes to this policy</h2>
            <p>We may update this policy from time to time. We'll update the date at the top of this page when we do.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#1d1b1e] mb-2">Contact us</h2>
            <p>
              Questions about this policy or your data? Email us at{" "}
              <a href="mailto:swapna.builds@gmail.com" className="text-[#9a4153] underline underline-offset-2">
                swapna.builds@gmail.com
              </a>
              .
            </p>
          </section>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
