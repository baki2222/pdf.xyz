// @vitest-environment node
/**
 * Sitemap `<lastmod>` states when a page's content changed — never when the
 * sitemap was generated.
 *
 * WHAT SHIPPED: `const lastModified = new Date()` on every entry. Production's
 * /sitemap.xml on 2026-09-20 carried `2026-09-20T16:59:10.943Z` for all 67
 * URLs (`uniq -c` = 67), /terms included, while each guide's own TechArticle
 * said `dateModified: 2026-09-17` and /sitemap-index.xml dated its child
 * EARLIER than every entry inside it. A lastmod that moves when the page does
 * not is one Google learns to ignore, on every URL.
 *
 * THE PROPERTY: every lastmod is a date the page itself states, derived from
 * the source that page prints; an entry with no such date carries none; and
 * the output does not depend on the clock. Checked on the SERVED documents
 * (the Route Handlers' XML), not only on the function.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import sitemap from "./sitemap";
import { GET as pagesXml } from "./sitemaps/pages.xml/route";
import { GET as indexXml } from "./sitemap-index.xml/route";
import { guides } from "@/lib/guides";
import { LEGAL_UPDATED } from "@/lib/legal";
import { tools } from "@/lib/tools";
import { siteConfig } from "@/lib/site";
import { lastmodOf, newestLastmod } from "@/lib/seo/sitemap-xml";

const url = (p: string) => new URL(p, siteConfig.url).toString();

/** Every `<lastmod>` in a served document, in order. */
const lastmodsIn = (xml: string) =>
  [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]!);

afterEach(() => {
  vi.useRealTimers();
});

describe("sitemap lastmod is a content date, never the clock", () => {
  it("each guide's lastmod is its own `updated` date", () => {
    const byUrl = new Map(sitemap().map((e) => [e.url, e.lastModified]));
    // Health check: derived from the catalogue, bounded below.
    expect(guides.length).toBeGreaterThanOrEqual(11);
    for (const guide of guides) {
      expect(byUrl.get(url(`/guides/${guide.slug}`)), guide.slug).toBe(
        guide.updated,
      );
    }
  });

  it("the policy pages carry the date they print, and /guides its newest guide", () => {
    const byUrl = new Map(sitemap().map((e) => [e.url, e.lastModified]));
    expect(byUrl.get(url("/privacy"))).toBe(LEGAL_UPDATED);
    expect(byUrl.get(url("/terms"))).toBe(LEGAL_UPDATED);
    expect(byUrl.get(url("/guides"))).toBe(
      guides
        .map((g) => g.updated)
        .sort()
        .at(-1),
    );
  });

  it("every lastmod comes from a recorded content date, and pages with none carry none", () => {
    const honest = new Set([LEGAL_UPDATED, ...guides.map((g) => g.updated)]);
    const entries = sitemap();
    const dated = entries.filter((e) => e.lastModified !== undefined);
    const invented = dated
      .filter((e) => !honest.has(String(e.lastModified)))
      .map((e) => `${e.url} → ${String(e.lastModified)}`);
    expect(invented).toEqual([]);
    // Bounded at both ends: the guides, /guides and the two policies are
    // dated; the tool pages have no content date and must not be.
    expect(dated.length).toBe(guides.length + 3);
    const toolUrls = new Set(tools.map((t) => url(`/tools/${t.slug}`)));
    expect(toolUrls.size).toBeGreaterThan(40);
    expect(dated.filter((e) => toolUrls.has(e.url))).toEqual([]);
  });

  it("does not depend on the clock: the function and both served documents are identical a year apart", async () => {
    const snapshot = async () => ({
      entries: JSON.stringify(sitemap()),
      pages: await pagesXml().text(),
      index: await indexXml().text(),
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    const first = await snapshot();
    vi.setSystemTime(new Date("2031-06-15T12:34:56.000Z"));
    const second = await snapshot();
    expect(second).toEqual(first);
    // And no served lastmod is the fake "now" — a clock read at a coarser
    // granularity (e.g. a date-only "today") would survive the equality above
    // only if both runs shared a day, which a year apart they do not.
    for (const value of [
      ...lastmodsIn(first.pages),
      ...lastmodsIn(first.index),
    ]) {
      expect(value.startsWith("2030")).toBe(false);
    }
    // Positive control: the served child really does carry lastmods, so the
    // loop above is not vacuous.
    expect(lastmodsIn(first.pages).length).toBeGreaterThanOrEqual(
      guides.length,
    );
  });

  it("the index's lastmod is the newest lastmod its child actually serves", async () => {
    const childServed = lastmodsIn(await pagesXml().text());
    expect(childServed.length).toBeGreaterThan(0);
    const newestServed = [...childServed].sort().at(-1);

    const indexed = lastmodsIn(await indexXml().text());
    expect(indexed).toHaveLength(1);
    expect(indexed[0]).toBe(newestServed);
    // The one definition the route uses agrees with the served bytes.
    expect(newestLastmod(sitemap())).toBe(newestServed);
    // And the index is never older than any page inside its child.
    for (const value of childServed) {
      expect(indexed[0]! >= value, value).toBe(true);
    }
  });

  it("the index follows the child when a non-guide page is the newest", async () => {
    // Today the newest dated page IS a guide, so an index defined as "newest
    // guide.updated" (what this route WAS) serves the same bytes as one
    // defined over the child — a right answer from a wrong method. Age every
    // guide below the policy date for the length of this test so the two
    // definitions disagree, and read the REAL route.
    const saved = guides.map((g) => g.updated);
    try {
      for (const guide of guides) {
        (guide as { updated: string }).updated = "2020-01-01";
      }
      const indexed = lastmodsIn(await indexXml().text());
      expect(indexed).toEqual([
        new Date(`${LEGAL_UPDATED}T00:00:00.000Z`).toISOString(),
      ]);
      expect(indexed[0]).toBe(
        [...lastmodsIn(await pagesXml().text())].sort().at(-1),
      );
    } finally {
      guides.forEach((guide, i) => {
        (guide as { updated: string }).updated = saved[i]!;
      });
    }
    expect(guides.map((g) => g.updated)).toEqual(saved);
  });

  it("an index over a child with no dates omits lastmod rather than inventing one", () => {
    expect(newestLastmod([{ url: "https://pdf.xyz/a" }])).toBeUndefined();
    expect(
      lastmodOf({ url: "https://pdf.xyz/a", lastModified: "not a date" }),
    ).toBeUndefined();
    expect(
      lastmodOf({ url: "https://pdf.xyz/a", lastModified: "2026-09-17" }),
    ).toBe("2026-09-17T00:00:00.000Z");
  });

  it("tool pages share one priority, not one keyed on having an in-browser runner", () => {
    const toolUrls = new Set(tools.map((t) => url(`/tools/${t.slug}`)));
    const priorities = new Set(
      sitemap()
        .filter((e) => toolUrls.has(e.url))
        .map((e) => e.priority),
    );
    expect([...priorities]).toEqual([0.8]);
  });
});
