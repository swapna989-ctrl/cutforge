<?xml version="1.0" encoding="UTF-8"?>
<!-- Presentation only: makes /sitemap.xml readable in a browser. Crawlers ignore this file. -->
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9" exclude-result-prefixes="sm">
  <xsl:output method="html" encoding="UTF-8" indent="yes"/>
  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title>Sitemap — Flovura</title>
        <style>
          body { margin: 0; background: #FAF8F7; color: #544244; font: 14px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
          main { max-width: 720px; margin: 0 auto; padding: 48px 16px; }
          h1 { margin: 0 0 4px; font: 600 26px Georgia, "Times New Roman", serif; color: #1d1b1e; }
          p { margin: 0 0 24px; color: #7B7579; font-size: 13px; }
          table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #ECE5E6; border-radius: 12px; overflow: hidden; }
          th, td { text-align: left; padding: 12px 16px; border-bottom: 1px solid #ECE5E6; }
          th { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #7B7579; background: #FAF8F7; }
          tr:last-child td { border-bottom: 0; }
          td.p { width: 90px; color: #7B7579; }
          a { color: #9a4153; text-decoration: none; word-break: break-all; }
          a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <main>
          <h1>Flovura sitemap</h1>
          <p>
            <xsl:value-of select="count(sm:urlset/sm:url)"/> pages listed for search engines.
          </p>
          <table>
            <thead>
              <tr><th>URL</th><th>Priority</th></tr>
            </thead>
            <tbody>
              <xsl:for-each select="sm:urlset/sm:url">
                <tr>
                  <td><a href="{sm:loc}"><xsl:value-of select="sm:loc"/></a></td>
                  <td class="p"><xsl:value-of select="sm:priority"/></td>
                </tr>
              </xsl:for-each>
            </tbody>
          </table>
        </main>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
