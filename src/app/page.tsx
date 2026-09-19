import type { Metadata } from "next";
import LandingPage from "@/components/LandingPage";
import { SITE_URL } from "@/lib/siteUrl";
import { SOCIAL_LINKS } from "@/lib/social";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// Tells Google the site's name and logo explicitly (its "site name" and brand-result logo come
// from WebSite/Organization markup on the homepage, not from guessing off the <title>).
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: "Flovura",
      alternateName: ["Flovura AI", "Flovuraai"],
      url: `${SITE_URL}/`,
    },
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "Flovura",
      url: `${SITE_URL}/`,
      logo: `${SITE_URL}/icon.png`,
      sameAs: SOCIAL_LINKS.map((social) => social.href),
    },
  ],
};

// Signed-in visitors are redirected to /dashboard by src/proxy.ts before this ever renders, so
// this can be plain server-rendered HTML that crawlers read immediately.
export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <LandingPage />
    </>
  );
}
