import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Inter, JetBrains_Mono } from "next/font/google";
import { AuthProvider } from "@/lib/auth";
import { PrefsProvider } from "@/lib/prefs";
import { BillingProvider } from "@/lib/billing";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Flovura — AI clips from your long-form video",
  description:
    "Drop in a video or paste a link. Flovura finds the strongest moments, plans multiple clips with a viral score, and burns in captions — ready to post.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`dark ${plusJakarta.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-screen relative selection:bg-amber-200 selection:text-black">
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- App Router has no pages/_document.js */}
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
        <AuthProvider>
          <PrefsProvider>
            <BillingProvider>{children}</BillingProvider>
          </PrefsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
