import { siteConfig } from "@/lib/site";
import { guides } from "@/lib/guides";
import { tools } from "@/lib/tools";

/**
 * /sitemap-index.xml — a sitemap index whose single child is /sitemap.xml.
 *
 * ── WHY THIS EXISTS, MEASURED ───────────────────────────────────────────────
 *
 * Google Search Console has reported "Sitemap could not be read" for
 * `https://pdf.xyz/sitemap.xml` since it was submitted on 2026-08-24, with
 * `Last read` empty and 0 discovered pages — through a resubmission on
 * 2026-09-18 and a second check on 2026-09-20. Every hypothesis about OUR side
 * was tested and refuted on 2026-09-20:
 *
 *   - the XML parses clean (DOMParser, 67 <url>, correct namespace, no
 *     duplicate <loc>, no BOM, closes with </urlset>);
 *   - it serves 200 `application/xml` in 10,948 bytes to every client shape
 *     tried — browser, datacenter IP, Googlebot UA, no UA, forced HTTP/1.1,
 *     and each of gzip / br / zstd / identity;
 *   - Cloudflare serves it from the edge (`cf-cache-status: HIT`, ~30 ms), so
 *     no origin timeout is possible;
 *   - Googlebot crawls the site normally (421 requests, host status "No
 *     problems", 97% HTTP 200);
 *   - and decisively, GSC's own live test fetched it and the source panel
 *     showed OUR EXACT XML, `/guides` entries included.
 *
 * A file that is valid, reachable, fast, and demonstrably read by Google,
 * reported as unreadable, is a stuck record on their side — and a stuck record
 * is only cleared by giving the report a URL it has never seen. That is what
 * this route is: a second, legitimate entry point, not a workaround dressed up
 * as architecture. Sitemap indexes are the standard shape for a growing site
 * anyway, so this stays useful after the record clears.
 *
 * It is deliberately NOT a copy of the sitemap. It names the canonical one, so
 * there is exactly one list of URLs in the system and this file cannot drift
 * away from it.
 */

/** The canonical child sitemap this index points at. */
const CHILD_SITEMAP = new URL("/sitemap.xml", siteConfig.url).toString();

/**
 * `lastmod` for the child. Derived from the catalogues the child is built
 * from — the guides carry real edit dates — rather than "now", so the value
 * means "the content changed then", which is what a crawler reads it as.
 * Falls back to the build date only if the catalogue somehow carries none.
 */
function childLastModified(): string {
  const dates = guides.map((guide) => guide.updated).filter(Boolean);
  const newest = dates.sort().at(-1);
  return newest ? `${newest}T00:00:00.000Z` : new Date().toISOString();
}

export function GET(): Response {
  // A health check, not decoration: an index pointing at an empty sitemap is
  // worse than no index, and this route cannot see the child's body.
  if (tools.length === 0) {
    throw new Error(
      "refusing to publish a sitemap index over an empty catalogue",
    );
  }

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    "<sitemap>",
    `<loc>${CHILD_SITEMAP}</loc>`,
    `<lastmod>${childLastModified()}</lastmod>`,
    "</sitemap>",
    "</sitemapindex>",
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml",
      // Same window the crawler-file rule gives its siblings in
      // next.config.mjs; stated here too because a Route Handler's response
      // headers are its own.
      "Cache-Control":
        "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
