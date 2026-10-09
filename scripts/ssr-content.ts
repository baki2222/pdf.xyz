/**
 * What a crawler — or a reader with JavaScript off — gets from each page the
 * build prerendered, reduced to the parts that must never silently shrink:
 * the H1, the section H2s, the structured-data types and the internal links,
 * plus the head fields a search result is made of (title, description,
 * canonical, robots).
 *
 * ONE extractor, shared by `scripts/ssr-baseline.ts` (which writes
 * `src/deploy/ssr-baseline.json` from a build) and `src/deploy/ssr-content.test.ts`
 * (which compares a build against it), so the baseline and the check cannot
 * read a page two different ways.
 *
 * Why it exists: the redesign layers client islands over server-rendered
 * pages, and the cheapest way to break SEO is to move one heading or link from
 * the server HTML into a client island that renders only after hydration. Every
 * component test would stay green; the HTML a crawler indexes would not.
 *
 * The parser is jsdom's own `DOMParser` (the one member `src/types/jsdom.d.ts`
 * declares), so text is real `textContent` — React's `<!-- -->` separators and
 * entity escapes are resolved by an HTML parser, not by regexes. Scripts never
 * run. JSON-LD types are collected RECURSIVELY, so a nested type that is
 * dropped (`SearchAction` inside `WebSite`, `ListItem` inside `ItemList`) is
 * seen as dropped.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { prerenderedPages } from "./page-weight";

export interface PageContent {
  title: string;
  description: string | null;
  canonical: string | null;
  robots: string | null;
  /** Every H1's text, in document order. */
  h1: string[];
  /** Unique H2 texts, sorted. */
  h2: string[];
  /** Unique JSON-LD `@type` values, nested ones included, sorted. */
  jsonLdTypes: string[];
  /** Unique internal hrefs (`/…`, or this site's own origin stripped), sorted. */
  links: string[];
}

export interface SsrSnapshot {
  pages: Record<string, PageContent>;
}

/** The site's own origin: absolute links to it are internal links. */
export const SITE_ORIGIN = "https://pdf.xyz";

const text = (el: Element | null): string =>
  (el?.textContent ?? "").replace(/\s+/g, " ").trim();

const uniqueSorted = (values: Iterable<string>): string[] =>
  [...new Set(values)].sort();

function collectTypes(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectTypes(item, into);
    return;
  }
  if (node === null || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (key === "@type") {
      for (const t of Array.isArray(value) ? value : [value])
        if (typeof t === "string") into.add(t);
    } else {
      collectTypes(value, into);
    }
  }
}

let parser: DOMParser | undefined;

/** Extract one page. A JSON-LD block that does not parse is an error, not an empty set. */
export function pageContent(html: string, where = "page"): PageContent {
  parser ??= new new JSDOM().window.DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const meta = (name: string) =>
    doc.querySelector(`meta[name="${name}"]`)?.getAttribute("content") ?? null;
  const types = new Set<string>();
  for (const script of doc.querySelectorAll(
    'script[type="application/ld+json"]',
  )) {
    let data: unknown;
    try {
      data = JSON.parse(script.textContent ?? "");
    } catch (error) {
      throw new Error(
        `ssr-content: ${where} has a JSON-LD block that does not parse: ${(error as Error).message}`,
      );
    }
    collectTypes(data, types);
  }
  const links: string[] = [];
  for (const a of doc.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href") ?? "";
    if (href.startsWith(SITE_ORIGIN + "/") || href === SITE_ORIGIN)
      links.push(href.slice(SITE_ORIGIN.length) || "/");
    else if (href.startsWith("/") && !href.startsWith("//")) links.push(href);
  }
  return {
    title: text(doc.querySelector("title")),
    description: meta("description"),
    canonical:
      doc.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
    robots: meta("robots"),
    h1: [...doc.querySelectorAll("h1")].map((h) => text(h)),
    h2: uniqueSorted([...doc.querySelectorAll("h2")].map((h) => text(h))),
    jsonLdTypes: uniqueSorted(types),
    links: uniqueSorted(links),
  };
}

/** Every prerendered page of a build, extracted. */
export function snapshotBuild(nextDir: string): SsrSnapshot {
  const pages: Record<string, PageContent> = {};
  for (const html of prerenderedPages(nextDir)) {
    pages[html] = pageContent(
      readFileSync(path.join(nextDir, "server", "app", html), "utf8"),
      html,
    );
  }
  return { pages };
}

/**
 * What the current build LOST against the baseline. Additions are allowed
 * (the redesign only adds to server pages); removals and changed head fields
 * are returned, one line each, so a failure names every loss at once.
 */
export function removals(
  baseline: SsrSnapshot,
  current: SsrSnapshot,
): string[] {
  const out: string[] = [];
  for (const [html, before] of Object.entries(baseline.pages)) {
    const now = current.pages[html];
    if (!now) {
      out.push(`${html}: the page is no longer prerendered`);
      continue;
    }
    for (const field of [
      "title",
      "description",
      "canonical",
      "robots",
    ] as const) {
      if (before[field] !== now[field])
        out.push(
          `${html}: ${field} changed from ${JSON.stringify(before[field])} to ${JSON.stringify(now[field])}`,
        );
    }
    for (const field of ["h1", "h2", "jsonLdTypes", "links"] as const) {
      const have = new Set(now[field]);
      for (const value of before[field])
        if (!have.has(value))
          out.push(`${html}: ${field} lost ${JSON.stringify(value)}`);
    }
  }
  return out;
}
