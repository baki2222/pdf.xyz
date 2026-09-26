import type { MetadataRoute } from "next";

/**
 * Serialise a `MetadataRoute.Sitemap` to `<urlset>` XML by hand.
 *
 * Next.js already does this for `src/app/sitemap.ts`, and that is the point:
 * this exists so the SAME entries can be served from a Route Handler instead
 * of from the metadata-file convention — see `src/app/sitemaps/pages.xml`
 * for why. One definition of the URL set (`sitemap()`), two serialisations.
 *
 * Only what the sitemap protocol defines is emitted. Values are XML-escaped:
 * a URL is allowed to contain `&`, and a raw `&` in a `<loc>` makes the whole
 * document unparseable, which a crawler reports as "could not be read".
 */
export function sitemapToXml(entries: MetadataRoute.Sitemap): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const entry of entries) {
    lines.push("<url>");
    lines.push(`<loc>${escapeXml(entry.url)}</loc>`);
    if (entry.lastModified) {
      const date =
        entry.lastModified instanceof Date
          ? entry.lastModified
          : new Date(entry.lastModified);
      if (!Number.isNaN(date.getTime())) {
        lines.push(`<lastmod>${date.toISOString()}</lastmod>`);
      }
    }
    if (entry.changeFrequency) {
      lines.push(`<changefreq>${entry.changeFrequency}</changefreq>`);
    }
    if (typeof entry.priority === "number") {
      lines.push(`<priority>${entry.priority}</priority>`);
    }
    lines.push("</url>");
  }
  lines.push("</urlset>", "");
  return lines.join("\n");
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
