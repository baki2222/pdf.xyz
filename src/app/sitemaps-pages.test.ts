// @vitest-environment node
/**
 * /sitemaps/pages.xml serves exactly the URL set `sitemap()` defines.
 *
 * The route exists because Google has never read the metadata-route
 * `/sitemap.xml` while reading the Route Handler index fine (measurements in
 * `src/app/sitemaps/pages.xml/route.ts`). Serving the same set twice is only
 * safe if it is the same set — a second list that drifts from the first would
 * be exactly the "claim true when written, stale underneath" defect this repo
 * keeps paying for. So this compares the SERVED document, parsed, against the
 * function, in both directions.
 */
import { describe, expect, it } from "vitest";
import { GET } from "./sitemaps/pages.xml/route";
import sitemap from "./sitemap";
import { escapeXml, sitemapToXml } from "@/lib/seo/sitemap-xml";

async function served(): Promise<{ xml: string; res: Response }> {
  const res = GET();
  return { xml: await res.clone().text(), res };
}

/** `<loc>` values, un-escaped — read the way a crawler reads them. */
function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
    m[1]!
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&"),
  );
}

describe("/sitemaps/pages.xml", () => {
  it("is a well-formed urlset with the protocol namespace", async () => {
    const { xml } = await served();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
    // Every <url> is closed — a truncated document is the "could not be
    // read" shape this route exists to get away from.
    expect([...xml.matchAll(/<url>/g)].length).toBe(
      [...xml.matchAll(/<\/url>/g)].length,
    );
  });

  it("serves exactly the URLs sitemap() defines, in both directions", async () => {
    const { xml } = await served();
    const servedUrls = locs(xml).sort();
    const defined = sitemap()
      .map((e) => e.url)
      .sort();

    // Health check first: `[] = []` is a vacuous pass. The site publishes the
    // home, catalogue, 50 tool pages, the guides and the policies.
    expect(defined.length, "sitemap() is implausibly small").toBeGreaterThan(
      60,
    );

    expect(servedUrls).toEqual(defined);
  });

  it("serves the content type and cache window crawlers need", async () => {
    const { res } = await served();
    expect(res.headers.get("content-type")).toContain("application/xml");
    const cache = res.headers.get("cache-control") ?? "";
    expect(cache).toMatch(/\bmax-age=0\b/);
  });

  it("escapes what XML requires, so one odd URL cannot break the document", () => {
    // Positive control THROUGH the serialiser: an unescaped `&` makes the
    // whole file unparseable.
    const xml = sitemapToXml([{ url: "https://pdf.xyz/a?b=1&c=2" }]);
    expect(xml).toContain("<loc>https://pdf.xyz/a?b=1&amp;c=2</loc>");
    expect(xml).not.toContain("b=1&c=2");
    expect(escapeXml(`<"'&>`)).toBe("&lt;&quot;&apos;&amp;&gt;");
  });
});
