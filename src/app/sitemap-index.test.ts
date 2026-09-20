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
import { describe, expect, it } from "vitest";
import { GET } from "./sitemap-index.xml/route";
import sitemap from "./sitemap";
import robots from "./robots";
import { siteConfig } from "@/lib/site";
import { guides } from "@/lib/guides";

async function indexXml(): Promise<string> {
  return await GET().text();
}

const CANONICAL_SITEMAP = new URL("/sitemap.xml", siteConfig.url).toString();

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

  it("names the canonical sitemap URL, not a hand-typed one", async () => {
    const xml = await indexXml();
    const loc = /<loc>([^<]+)<\/loc>/.exec(xml)?.[1];
    expect(loc).toBe(CANONICAL_SITEMAP);

    // And that URL is one the sitemap route really serves: every entry the
    // sitemap emits sits under the same origin, so a changed siteConfig.url
    // moves both or fails here.
    const entries = sitemap();
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(new URL(entry.url).origin).toBe(new URL(loc!).origin);
    }
  });

  it("carries a lastmod derived from the catalogue, never a literal", async () => {
    const xml = await indexXml();
    const lastmod = /<lastmod>([^<]+)<\/lastmod>/.exec(xml)?.[1] ?? "";
    expect(Number.isNaN(Date.parse(lastmod))).toBe(false);
    // The value must be one the guides catalogue actually holds — a date typed
    // into this route would drift the moment content changed.
    const newestGuideEdit = guides
      .map((guide) => guide.updated)
      .sort()
      .at(-1);
    expect(lastmod.startsWith(newestGuideEdit!)).toBe(true);
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
    expect(list).toContain(CANONICAL_SITEMAP);
    expect(list).toContain(
      new URL("/sitemap-index.xml", siteConfig.url).toString(),
    );
  });
});
