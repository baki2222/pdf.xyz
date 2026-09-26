// @vitest-environment node
/**
 * The internal-link graph, built from what a crawler receives.
 *
 * WHAT WAS MEASURED (production HTML of all 67 sitemap URLs, before this
 * change): the homepage linked no individual guide; every guide had exactly
 * four inbound links; `/tools/compare-pdf` had two — the homepage and
 * `/tools`, nothing else. Search Console knew about 30 of 67 URLs. The pages
 * written for long-tail "how to" queries sat at the weakest point of the
 * graph, and nothing could have said so, because no check ever looked at
 * links as a GRAPH — only at one page's markup at a time.
 *
 * So this renders every sitemap URL inside the header and footer, in a fresh
 * process (`src/tests/render-site-links.ts`), and asks graph questions:
 *
 *  - every URL the sitemap asks crawlers to index is linked from at least
 *    {@link MIN_INBOUND} OTHER pages;
 *  - every guide is linked from the homepage;
 *  - every category landing page is linked from every page (the footer);
 *  - a `?category=` link comes only from the file still pending its switch
 *    to `categoryHref` (see `category-href.test.ts`).
 *
 * The node set is `sitemap()` — derived, never typed — bounded at both ends,
 * and each predicate is run against a mutated copy of the real graph so a
 * blind predicate cannot report the strongest possible pass.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import sitemap from "./sitemap";
import { categories, tools } from "@/lib/tools";
import { guides } from "@/lib/guides";
import { categoryHref } from "@/lib/tools/category-href";
import { withoutComments } from "@/lib/tools/copy-surface";

const ROOT = process.cwd();
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const HARNESS = path.join(ROOT, "src", "tests", "render-site-links.ts");

type Graph = Record<string, string[]>;

/**
 * The floor, and why it is three: by construction every tool is linked from
 * `/tools`, the homepage's catalogue, and its category page; every guide from
 * `/guides`, the homepage's guides band, and the category page of a tool it
 * teaches; every other page from the footer on every page. Three is the
 * weakest of those guarantees — `/tools/compare-pdf` sat BELOW it at two.
 */
const MIN_INBOUND = 3;

let cached: Graph | undefined;
function renderGraph(): Graph {
  cached ??= JSON.parse(
    execFileSync(process.execPath, [TSX_CLI, HARNESS], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
    }),
  ) as Graph;
  return cached;
}

function inbound(graph: Graph): Map<string, Set<string>> {
  const map = new Map(Object.keys(graph).map((n) => [n, new Set<string>()]));
  for (const [source, targets] of Object.entries(graph)) {
    for (const target of targets) {
      if (target !== source) map.get(target)?.add(source);
    }
  }
  return map;
}

/** URLs linked from fewer than `floor` other pages, with their sources. */
function underLinked(graph: Graph, floor = MIN_INBOUND): string[] {
  return [...inbound(graph)]
    .filter(([, sources]) => sources.size < floor)
    .map(([node, sources]) => `${node} ← ${[...sources].join(", ") || "∅"}`);
}

function guidesMissingFromHome(graph: Graph): string[] {
  const home = new Set(graph["/"] ?? []);
  return guides
    .map((g) => `/guides/${g.slug}`)
    .filter((href) => !home.has(href));
}

function pagesMissingCategoryLinks(graph: Graph): string[] {
  const wanted = categories.map((c) => categoryHref(c.id));
  return Object.entries(graph)
    .filter(([, targets]) => wanted.some((href) => !targets.includes(href)))
    .map(([page]) => page);
}

/** Pages that link a `?category=` URL, other than tool pages (pending). */
function queryLinkSources(graph: Graph): string[] {
  const toolPages = new Set(tools.map((t) => `/tools/${t.slug}`));
  return Object.entries(graph)
    .filter(([, targets]) => targets.some((t) => t.includes("?category=")))
    .map(([page]) => page)
    .filter((page) => !toolPages.has(page));
}

/** A copy of the graph with every edge `source → target` matching removed. */
function without(
  graph: Graph,
  drop: (source: string, target: string) => boolean,
): Graph {
  return Object.fromEntries(
    Object.entries(graph).map(([s, ts]) => [s, ts.filter((t) => !drop(s, t))]),
  );
}

describe("internal-link graph", () => {
  it("covers exactly the sitemap, and is big enough to mean something", () => {
    const graph = renderGraph();
    const nodes = Object.keys(graph).sort();
    const expected = sitemap()
      .map((e) => new URL(e.url).pathname)
      .sort();
    expect(nodes).toEqual(expected);
    // Bounded from the catalogues, not a typed count: the fixed pages sit in
    // a small window on top of tools + guides + categories.
    const floor = tools.length + guides.length + categories.length;
    expect(nodes.length).toBeGreaterThanOrEqual(floor + 3);
    expect(nodes.length).toBeLessThan(floor + 20);
    // Every page rendered its chrome: a page with a handful of links means the
    // header/footer did not render, and every inbound count would be low for
    // the wrong reason.
    const thin = Object.entries(graph)
      .filter(([, targets]) => targets.length < categories.length + 5)
      .map(([page, targets]) => `${page}: ${targets.length}`);
    expect(thin).toEqual([]);
  }, 120_000);

  it("the harness wraps pages in the chrome the root layout actually mounts", () => {
    // The harness renders SiteHeader + page + SiteFooter because the layout
    // does; if the layout stopped mounting either, the graph above would be
    // crediting links no reader receives.
    const layout = withoutComments(
      readFileSync(path.join(ROOT, "src", "app", "layout.tsx"), "utf8"),
    );
    expect(layout).toMatch(/<SiteHeader\s*\/>/);
    expect(layout).toMatch(/<SiteFooter\s*\/>/);
  });

  it("the predicates see a defect when one is introduced", () => {
    const graph = renderGraph();
    // Controls, run THROUGH the predicates on the real graph with the fix
    // removed. Each would be empty if its predicate had gone blind.
    // The shape `/tools/compare-pdf` had: linked from the homepage and the
    // hub, and nowhere else. Built on a tool the catalogue guarantees exists,
    // so the control does not depend on today's `related` lists.
    const victim = `/tools/${tools[0]?.slug}`;
    const hubOnly = without(
      graph,
      (s, t) => t === victim && s !== "/" && s !== "/tools",
    );
    expect(underLinked(hubOnly)).toEqual([`${victim} ← /, /tools`]);
    const noHomeGuides = without(
      graph,
      (s, t) => s === "/" && t.startsWith("/guides/"),
    );
    expect(guidesMissingFromHome(noHomeGuides)).toHaveLength(guides.length);
    const noFooterAi = without(graph, (_s, t) => t === categoryHref("ai"));
    expect(pagesMissingCategoryLinks(noFooterAi).length).toBe(
      Object.keys(graph).length,
    );
    const legacy = {
      ...graph,
      "/": [...(graph["/"] ?? []), "/tools?category=ai"],
    };
    expect(queryLinkSources(legacy)).toEqual(["/"]);
  }, 120_000);

  it(`every sitemap URL is linked from at least ${MIN_INBOUND} other pages`, () => {
    expect(underLinked(renderGraph())).toEqual([]);
  }, 120_000);

  it("the homepage links every guide", () => {
    expect(guidesMissingFromHome(renderGraph())).toEqual([]);
  }, 120_000);

  it("every page links every category landing page", () => {
    expect(pagesMissingCategoryLinks(renderGraph())).toEqual([]);
  }, 120_000);

  it("no page but a pending tool page links a ?category= URL", () => {
    expect(queryLinkSources(renderGraph())).toEqual([]);
  }, 120_000);
});
