import sitemap from "@/app/sitemap";
import { sitemapToXml } from "@/lib/seo/sitemap-xml";

/**
 * /sitemaps/pages.xml — every indexable page, served by a Route Handler.
 *
 * ── WHY THE SAME URL SET IS SERVED TWICE ────────────────────────────────────
 *
 * `/sitemap.xml` (Next's metadata-file convention, `src/app/sitemap.ts`) has
 * never once been read by Google. Search Console, measured 2026-09-18, -20 and
 * -27: "Couldn't fetch", before and after a resubmit, a week apart. Over the
 * same week `/sitemap-index.xml` — a Route Handler — was read with status
 * Success on 2026-09-20 and again on 2026-09-23. Both live on the same host,
 * behind the same CDN, under the same robots.txt.
 *
 * Every difference we can produce from outside came back identical for the
 * two URLs: plain GET, HEAD, `If-None-Match`, `If-Modified-Since`,
 * `Accept: application/xml`, an `RSC: 1` header, gzip as Googlebot requests
 * it, Googlebot's user agent, edge versus origin (cache-busted). Both parse as
 * well-formed XML with the right root and namespace. Whatever Google's fetcher
 * trips on is not observable from here — and a month of theorising has not
 * found it.
 *
 * The ONE difference that is observable is in the build output, noticed
 * 2026-09-27 while building this file: `/sitemap.xml` is `○` (prerendered
 * static) and both Route Handlers — the index Google reads, and this file —
 * are `ƒ` (rendered per request). Their bodies and headers are identical to
 * every probe above, so it is recorded as a lead, not as a cause.
 *
 * So this stops theorising and uses the shape that is PROVEN to be read: a
 * Route Handler, at a URL that carries no failure history in the property.
 * `/sitemap-index.xml` now names this file as its child. `/sitemap.xml` stays
 * — other crawlers read it, and robots.txt still advertises it.
 *
 * ── ONE DEFINITION ──────────────────────────────────────────────────────────
 *
 * The entries are `sitemap()` itself, not a copy. `sitemap.test`-style guards
 * and `route-indexability.test.ts` keep binding every indexable route to that
 * function, and `sitemaps-pages.test.ts` fails if this file ever serves a set
 * that differs from it. Two serialisations, one list.
 *
 * The success criterion is external and dated: in Search Console, this URL
 * appears under the index with a Last read date and Discovered pages > 0.
 */
export function GET(): Response {
  const entries = sitemap();
  // A health check, not decoration: an empty urlset is a valid document that
  // tells a crawler the site has no pages.
  if (entries.length === 0) {
    throw new Error("refusing to publish an empty sitemap");
  }
  return new Response(sitemapToXml(entries), {
    headers: {
      "Content-Type": "application/xml",
      // Same window as the sibling crawler files (next.config.mjs), stated
      // here because a Route Handler's headers are its own.
      "Cache-Control":
        "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
