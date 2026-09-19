import { SITE_URL } from "@/lib/siteUrl";

// Only the pages an anonymous visitor (and so Google) can actually read.
const PAGES = [
  { path: "/", priority: 1 },
  { path: "/pricing", priority: 0.8 },
  { path: "/privacy", priority: 0.3 },
  { path: "/terms", priority: 0.3 },
];

// A hand-written route instead of app/sitemap.ts because the metadata-file convention can't emit
// the `xml-stylesheet` line below. That line points browsers at /sitemap.xsl so the sitemap shows
// as a readable table instead of a run of URLs (Safari, for one, drops the tags of unstyled XML
// and shows only the text run together). Search engines ignore the stylesheet and read the XML.
export function GET() {
  const urls = PAGES.map(
    ({ path, priority }) => `  <url>\n    <loc>${SITE_URL}${path}</loc>\n    <priority>${priority}</priority>\n  </url>`
  ).join("\n");

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
