// @vitest-environment node
/**
 * Server-rendered content may grow and may not shrink — held against a
 * committed baseline over EVERY page the build prerendered.
 *
 * The redesign layers client islands over server pages (a ticket, a palette,
 * a drop layer, smarter 404s). The cheapest way for that to hurt search is
 * quiet: a heading or link moves from the server HTML into an island that
 * renders after hydration. Every component test stays green, the page looks
 * identical in a browser, and the HTML a crawler indexes has lost it. So this
 * reads the built HTML itself — what a crawler, or a reader with JavaScript
 * off, receives — and compares it with `ssr-baseline.json`:
 *
 *  - title, meta description, canonical and robots must be UNCHANGED;
 *  - every H1, H2, JSON-LD `@type` (nested ones included) and internal link
 *    the baseline recorded must still be there. Additions are allowed.
 *
 * The page set is derived from the build (`prerenderedPages()`), not typed.
 * To accept a removal you meant: `pnpm build && pnpm ssr:baseline`, and say in
 * the commit which entries went and why.
 *
 * Runs under `pnpm test:bundle` (it needs `.next`), never `pnpm test`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { categories, getAllToolSlugs, getToolsByCategory } from "@/lib/tools";
import { prerenderedPages } from "../../scripts/page-weight";
import {
  pageContent,
  removals,
  snapshotBuild,
  type PageContent,
  type SsrSnapshot,
} from "../../scripts/ssr-content";

const NEXT_DIR = path.join(process.cwd(), ".next");
const BASELINE = path.join(process.cwd(), "src", "deploy", "ssr-baseline.json");

describe("the extractor reads what a crawler reads", () => {
  const html = `<!DOCTYPE html><html><head>
    <title>Merge PDF &amp; more — pdf.xyz</title>
    <meta name="description" content="Combine PDFs &quot;in order&quot;."/>
    <meta name="robots" content="index, follow"/>
    <link rel="canonical" href="https://pdf.xyz/tools/merge-pdf"/>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","potentialAction":{"@type":"SearchAction","target":{"@type":"EntryPoint","urlTemplate":"https://pdf.xyz/tools?q={q}"}}}</script>
    <script type="application/ld+json">{"@graph":[{"@type":["WebApplication","Thing"]},{"@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem"}]}]}</script>
    </head><body>
    <h1 class="x">Every PDF tool.<!-- --> <span class="mark-sweep">Private&nbsp;by design.</span></h1>
    <h2>  How it
      works </h2><h2>How it works</h2><h2>Questions</h2>
    <a href="/tools/merge-pdf">Merge</a>
    <a href="/tools?category=ai">AI</a>
    <a href="https://pdf.xyz/guides">Guides</a>
    <a href="https://pdf.xyz">Home</a>
    <a href="https://github.com/x/y">External</a>
    <a href="//cdn.example.com/x">Protocol-relative</a>
    <a href="#steps">In-page</a>
    <a href="mailto:hi@pdf.xyz">Mail</a>
    <a>No href</a>
    <script>self.__next_f.push([1,"{\\"href\\":\\"/never-a-link\\"}"])</script>
  </body></html>`;

  it("decodes entities, drops React's comment separators and collapses whitespace", () => {
    const page = pageContent(html);
    expect(page.title).toBe("Merge PDF & more — pdf.xyz");
    expect(page.description).toBe('Combine PDFs "in order".');
    expect(page.h1).toEqual(["Every PDF tool. Private by design."]);
    expect(page.h2).toEqual(["How it works", "Questions"]);
  });

  it("collects JSON-LD types recursively — nested, in @graph, and in arrays", () => {
    expect(pageContent(html).jsonLdTypes).toEqual([
      "BreadcrumbList",
      "EntryPoint",
      "ListItem",
      "SearchAction",
      "Thing",
      "WebApplication",
      "WebSite",
    ]);
  });

  it("keeps internal links only, and never reads the flight data as a link", () => {
    expect(pageContent(html).links).toEqual([
      "/",
      "/guides",
      "/tools/merge-pdf",
      "/tools?category=ai",
    ]);
  });

  it("reads the head fields a search result is made of", () => {
    const page = pageContent(html);
    expect(page.canonical).toBe("https://pdf.xyz/tools/merge-pdf");
    expect(page.robots).toBe("index, follow");
  });

  it("a JSON-LD block that does not parse is an error, not an empty type set", () => {
    expect(() =>
      pageContent(
        '<html><head><script type="application/ld+json">{"@type":</script></head></html>',
        "broken.html",
      ),
    ).toThrow(/broken\.html/);
  });
});

describe("removals() fails a loss and allows a gain", () => {
  const page = (over: Partial<PageContent> = {}): PageContent => ({
    title: "T",
    description: "D",
    canonical: "https://pdf.xyz/x",
    robots: "index, follow",
    h1: ["H"],
    h2: ["A", "B"],
    jsonLdTypes: ["HowTo", "HowToStep"],
    links: ["/a", "/b"],
    ...over,
  });
  const snap = (pages: Record<string, PageContent>): SsrSnapshot => ({ pages });

  it("an identical build, or one that only ADDS, has no removals", () => {
    const before = snap({ "x.html": page() });
    expect(removals(before, before)).toEqual([]);
    const grown = snap({
      "x.html": page({
        h2: ["A", "B", "C"],
        jsonLdTypes: ["FAQPage", "HowTo", "HowToStep"],
        links: ["/a", "/b", "/c"],
      }),
      "new.html": page(),
    });
    expect(removals(before, grown)).toEqual([]);
  });

  it("names every loss: a page, a heading, a type, a link and a changed head field", () => {
    const before = snap({ "x.html": page(), "gone.html": page() });
    const after = snap({
      "x.html": page({
        title: "T2",
        h1: ["H2"],
        h2: ["A"],
        jsonLdTypes: ["HowTo"],
        links: ["/a"],
      }),
    });
    expect(removals(before, after)).toEqual([
      'x.html: title changed from "T" to "T2"',
      'x.html: h1 lost "H"',
      'x.html: h2 lost "B"',
      'x.html: jsonLdTypes lost "HowToStep"',
      'x.html: links lost "/b"',
      "gone.html: the page is no longer prerendered",
    ]);
  });
});

describe("the build keeps every piece of server-rendered content the baseline recorded", () => {
  const built = existsSync(path.join(NEXT_DIR, "server", "app"));

  it("has a build to measure", () => {
    expect(built, "no .next — run `pnpm build` first (CI does)").toBe(true);
  });

  it("health check: the baseline and the build are both the whole site", () => {
    if (!built) return;
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as SsrSnapshot;
    // Floors, so an empty or truncated read cannot pass every ⊆ check below;
    // the ceilings are plausibility bounds (89 pages on 2026-10-09), not
    // measurements.
    for (const count of [
      Object.keys(baseline.pages).length,
      prerenderedPages(NEXT_DIR).length,
    ]) {
      expect(count).toBeGreaterThanOrEqual(60);
      expect(count).toBeLessThanOrEqual(200);
    }
    // Every tool page is in the baseline: the set it was written from was the
    // derived page set, not a sample.
    for (const slug of getAllToolSlugs()) {
      expect(baseline.pages, slug).toHaveProperty([`tools/${slug}.html`]);
    }
  });

  it("positive control: the extractor sees real structure on the real build", () => {
    if (!built) return;
    const { pages } = snapshotBuild(NEXT_DIR);
    // Every page has a title and exactly one H1 (the 404 and the error page
    // included), and every tool page carries structured data and links.
    for (const [html, page] of Object.entries(pages)) {
      expect(page.title, html).not.toBe("");
      expect(page.h1, html).toHaveLength(1);
    }
    for (const slug of getAllToolSlugs()) {
      const page = pages[`tools/${slug}.html`]!;
      expect(page.jsonLdTypes.length, slug).toBeGreaterThan(0);
      expect(page.links.length, slug).toBeGreaterThan(5);
    }
    // The home page links every tool by its slug (redesign invariant G.3),
    // derived from the catalogue.
    const home = new Set(pages["index.html"]!.links);
    expect(
      getAllToolSlugs().filter((slug) => !home.has(`/tools/${slug}`)),
    ).toEqual([]);
  });

  it("the /tools hub serves the whole catalogue, unfiltered, whatever a query will rank", () => {
    if (!built) return;
    // The explorer ranks `?q=` after hydration; the server never sees the
    // query, so the served page must be the complete catalogue a crawler
    // reads — every tool linked, every category's heading — and none of the
    // headings only a query renders. Derived from the catalogue, not typed.
    const page = snapshotBuild(NEXT_DIR).pages["tools.html"]!;
    const links = new Set(page.links);
    expect(
      getAllToolSlugs().filter((slug) => !links.has(`/tools/${slug}`)),
    ).toEqual([]);
    const missing = categories
      .filter((category) => getToolsByCategory(category.id).length > 0)
      .filter((category) => !page.h2.some((h) => h.startsWith(category.name)));
    expect(missing.map((c) => c.name)).toEqual([]);
    expect(
      page.h2.filter((h) =>
        /^(?:Best matches|Closest matches|Nothing matches|Nothing that|Nothing in|No tool here opens|Searching for|Search results)/.test(
          h,
        ),
      ),
    ).toEqual([]);
  });

  it("no page lost a heading, a structured-data type, a link or a head field", () => {
    if (!built) return;
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as SsrSnapshot;
    expect(
      removals(baseline, snapshotBuild(NEXT_DIR)),
      "server-rendered content was removed. If a client island now renders it, a crawler no longer sees it — render it on the server. If the removal is meant, run `pnpm build && pnpm ssr:baseline` and say in the commit what went and why.",
    ).toEqual([]);
    // Parses every built page: the WP-09 footer (50 tool links on each) and
    // WP-13's guide contents took it past vitest's 5 s default on CI
    // (2026-10-21) — the same class as 2b20baa7.
  }, 30_000);
});
