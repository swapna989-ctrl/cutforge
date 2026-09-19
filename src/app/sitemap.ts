import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/siteUrl";

// Only the pages an anonymous visitor (and so Google) can actually read.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, priority: 1 },
    { url: `${SITE_URL}/privacy`, priority: 0.3 },
    { url: `${SITE_URL}/terms`, priority: 0.3 },
  ];
}
