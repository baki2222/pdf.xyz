// @vitest-environment node
/**
 * The sitemap index must name the sitemap that actually exists.
 *
 * An index is a pointer, and a pointer's failure mode is silence: it can name
 * a URL that 404s, or a stale hostname, and every crawler reads it as "this
 * site has no pages" rather than as an error. That is the same shape as the
 * defect the index was added to work around — a report that says nothing is
 * there while everything is.
 *
 * So the relationship is pinned in both directions: the index's `<loc>` must
 * be the URL the sitemap route actually serves at, and robots.txt must
 * advertise both entry points. Nothing here re-derives the URL by hand; each
 * side is read through the same accessor the framework uses.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GET } from "./sitemap-index.xml/route";
import { GET as pagesXml } from "./sitemaps/pages.xml/route";
import sitemap from "./sitemap";
import robots from "./robots";
import { siteConfig } from "@/lib/site";
import { guides } from "@/lib/guides";
import { LEGAL_UPDATED } from "@/lib/legal";

async function indexXml(): Promise<string> {
  return await GET().text();
}

/** Still served, still advertised in robots.txt — just no longer the index's child. */
const LEGACY_SITEMAP = new URL("/sitemap.xml", siteConfig.url).toString();

describe("the sitemap index points at a sitemap that exists", () => {
  it("is well-formed sitemapindex XML with the right namespace", async () => {
    const xml = await indexXml();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain(
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(xml.trimEnd().endsWith("</sitemapindex>")).toBe(true);
    // Exactly one child today. A second would need its own <loc>, and the
    // count is asserted so adding one cannot silently skip this file.
    expect([...xml.matchAll(/<sitemap>/g)]).toHaveLength(1);
  });

  it("names a child that a real route in src/app serves", async () => {
    // WAS `expect(loc).toBe(...)` against a constant typed by hand, under the
    // title "names the canonical sitemap URL, not a hand-typed one". The
    // relationship worth pinning is that the pointer RESOLVES: the <loc> path
    // must be a route file that exists, and `sitemaps-pages.test.ts` proves
    // that route serves exactly `sitemap()`'s URLs. Index → route → the one
    // URL list: the chain, not the unit.
    const xml = await indexXml();
    const loc = /<loc>([^<]+)<\/loc>/.exec(xml)?.[1];
    expect(loc, "the index names no child").toBeTruthy();
    const routeFile = path.join(
      process.cwd(),
      "src/app",
      new URL(loc!).pathname,
      "route.ts",
    );
    expect(
      existsSync(routeFile),
      "the index points at " + loc + " but " + routeFile + " does not exist",
    ).toBe(true);
    // Not the metadata-route sitemap, which Google has never read — see
    // src/app/sitemaps/pages.xml/route.ts for the measurements.
    expect(loc).not.toBe(LEGACY_SITEMAP);

    // And that URL is one the sitemap route really serves: every entry the
    // sitemap emits sits under the same origin, so a changed siteConfig.url
    // moves both or fails here.
    const entries = sitemap();
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(new URL(entry.url).origin).toBe(new URL(loc!).origin);
    }
  });

  it("carries the newest lastmod its child serves, never a literal", async () => {
    // WAS "derived from the catalogue": `startsWith(newest guide.updated)`.
    // That held while the child stamped every entry with "now", which made
    // the index OLDER than every page inside its child — a relationship this
    // test was asserting against the wrong source. The value must be the
    // child's own newest `<lastmod>`, read from the child's served bytes;
    // `sitemap-lastmod.test.ts` carries the clock-independence checks.
    const xml = await indexXml();
    const lastmod = /<lastmod>([^<]+)<\/lastmod>/.exec(xml)?.[1] ?? "";
    expect(Number.isNaN(Date.parse(lastmod))).toBe(false);
    const child = await pagesXml().text();
    const newestInChild = [...child.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)]
      .map((m) => m[1]!)
      .sort()
      .at(-1);
    expect(newestInChild, "the child serves no lastmod at all").toBeTruthy();
    expect(lastmod).toBe(newestInChild);
    // Still a date a human recorded — the newest of them. This said "today,
    // that is a guide's edit date" and compared against the guides alone,
    // which held until 2026-10-10, when the policies' own date
    // (`LEGAL_UPDATED`, which /privacy and /terms print and the child serves)
    // became the newest. Same relationship, the whole set of recorded dates.
    const newestRecorded = [LEGAL_UPDATED, ...guides.map((g) => g.updated)]
      .sort()
      .at(-1);
    expect(lastmod.startsWith(newestRecorded!)).toBe(true);
  });

  it("serves the content type and cache window crawlers need", async () => {
    const res = GET();
    expect(res.headers.get("content-type")).toContain("application/xml");
    const cache = res.headers.get("cache-control") ?? "";
    expect(cache).toMatch(/\bmax-age=0\b/);
    const sMaxAge = Number(/\bs-maxage=(\d+)\b/.exec(cache)?.[1] ?? 0);
    expect(sMaxAge).toBeGreaterThanOrEqual(3600);
  });

  it("robots.txt advertises both entry points", () => {
    const declared = robots().sitemap;
    const list = Array.isArray(declared) ? declared : [declared];
    expect(list).toContain(LEGACY_SITEMAP);
    expect(list).toContain(
      new URL("/sitemap-index.xml", siteConfig.url).toString(),
    );
  });
});
