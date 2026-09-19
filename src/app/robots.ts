import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/siteUrl";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Signed-in app screens and internal endpoints: nothing useful for a crawler to index
      // (they just bounce anonymous visitors to /login).
      disallow: ["/api/", "/auth/", "/dashboard", "/clipping", "/workspace", "/settings", "/shorts/", "/pricing"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
