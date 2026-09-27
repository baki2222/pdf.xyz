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
    const lastmod = lastmodOf(entry);
    if (lastmod) lines.push(`<lastmod>${lastmod}</lastmod>`);
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

/**
 * An entry's `<lastmod>` as the served XML spells it, or `undefined` when the
 * entry carries no (valid) date — the one normalisation both the urlset and
 * the index read, so the index cannot compute "newest" over a different
 * spelling than the child serves.
 */
export function lastmodOf(
  entry: MetadataRoute.Sitemap[number],
): string | undefined {
  if (!entry.lastModified) return undefined;
  const date =
    entry.lastModified instanceof Date
      ? entry.lastModified
      : new Date(entry.lastModified);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * The newest `<lastmod>` among `entries`, or `undefined` when none carries a
 * date. A sitemap index's `<lastmod>` for a child is this over the child's
 * entries: the child changed when its newest page changed, and never earlier.
 */
export function newestLastmod(
  entries: MetadataRoute.Sitemap,
): string | undefined {
  // ISO-8601 in UTC compares correctly as a string.
  return entries
    .map(lastmodOf)
    .filter((value): value is string => value !== undefined)
    .sort()
    .at(-1);
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
