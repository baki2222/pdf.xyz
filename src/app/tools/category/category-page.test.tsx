// @vitest-environment node
/**
 * The category landing pages, read as a crawler reads them: the rendered
 * markup and the metadata Next emits — not the copy module that feeds them.
 *
 * WHY THESE PAGES EXIST: every category link on the site went to
 * `/tools?category=<id>`, a filtered view canonicalised to `/tools`, so the
 * eight category intents ("PDF converter", "AI PDF tools") had no page that
 * could rank and every tool breadcrumb's middle crumb was a non-canonical URL.
 *
 * The corpus is `categories` (what `generateStaticParams` reads), each page's
 * tool list is checked against the catalogue it is drawn from, and the JSON-LD
 * is checked against the links the SAME render produced — the composed chain,
 * so structured data cannot describe a list the reader does not see.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CategoryPage, {
  dynamicParams,
  generateMetadata,
  generateStaticParams,
} from "./[category]/page";
import { categories, getToolsByCategory, tools } from "@/lib/tools";
import { categoryHref } from "@/lib/tools/category-href";
import { categoryPageCopy } from "@/lib/tools/category-pages";
import { processingMeta } from "@/lib/tools/processing";
import { siteConfig } from "@/lib/site";

interface Rendered {
  id: string;
  html: string;
  h1: string[];
  headings: { level: number; text: string }[];
  toolLinks: string[];
  jsonLd: Record<string, unknown>[];
}

const textOf = (markup: string) =>
  markup
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

async function render(id: string): Promise<Rendered> {
  const element = await CategoryPage({
    params: Promise.resolve({ category: id }),
  });
  const html = renderToStaticMarkup(element);
  const headings = [
    ...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g),
  ].map((m) => ({ level: Number(m[1]), text: textOf(m[2] ?? "") }));
  const jsonLd = [
    ...html.matchAll(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    ),
  ].map((m) => JSON.parse(m[1] ?? "null") as Record<string, unknown>);
  const toolLinks = [...html.matchAll(/href="\/tools\/([a-z0-9-]+)"/g)]
    .map((m) => m[1] ?? "")
    .filter((slug) => slug !== "category");
  return {
    id,
    html,
    h1: headings.filter((h) => h.level === 1).map((h) => h.text),
    headings,
    toolLinks,
    jsonLd,
  };
}

const ids = generateStaticParams().map((p) => p.category);

describe("category landing pages", () => {
  it("prerender exactly the categories, and nothing else renders", () => {
    // Health check: the corpus is the catalogue's category list, bounded.
    expect(ids).toEqual(categories.map((c) => c.id));
    expect(ids.length).toBeGreaterThanOrEqual(8);
    // A closed set: anything outside generateStaticParams is a real 404
    // rather than a 200 page that says "not found".
    expect(dynamicParams).toBe(false);
  });

  it("each page is indexable, self-canonical, and titled for its own intent", async () => {
    const titles = new Set<string>();
    for (const id of ids) {
      const meta = await generateMetadata({
        params: Promise.resolve({ category: id }),
      });
      expect(meta.alternates?.canonical, id).toBe(
        new URL(categoryHref(id), siteConfig.url).toString(),
      );
      expect(meta.robots, id).toEqual({ index: true, follow: true });
      expect(meta.title, id).toBe(categoryPageCopy[id].title);
      titles.add(String(meta.title));
    }
    expect(titles.size, "two categories share a <title>").toBe(ids.length);
  });

  it("each page has one unique H1 and headings that do not skip a level", async () => {
    const h1s = new Set<string>();
    for (const id of ids) {
      const page = await render(id);
      expect(page.h1, id).toEqual([categoryPageCopy[id].heading]);
      h1s.add(page.h1[0] ?? "");
      let previous = 0;
      for (const heading of page.headings) {
        expect(
          heading.level,
          `${id}: <h${heading.level}> "${heading.text}" after <h${previous}>`,
        ).toBeLessThanOrEqual(previous + 1);
        previous = heading.level;
      }
    }
    expect(h1s.size, "two categories share an H1").toBe(ids.length);
  });

  it("each page lists exactly its category's tools, with name, tagline and where it runs", async () => {
    const seen: string[] = [];
    for (const id of ids) {
      const page = await render(id);
      const expected = getToolsByCategory(id).map((t) => t.slug);
      expect(page.toolLinks, id).toEqual(expected);
      const text = textOf(page.html);
      for (const tool of getToolsByCategory(id)) {
        expect(text, `${id}: ${tool.slug} name`).toContain(tool.name);
        expect(text, `${id}: ${tool.slug} tagline`).toContain(
          textOf(tool.tagline),
        );
        expect(text, `${id}: ${tool.slug} runs`).toContain(
          processingMeta[tool.processing].short,
        );
      }
      seen.push(...page.toolLinks);
    }
    // Relationship, not a count: together the pages cover the catalogue once.
    expect([...seen].sort()).toEqual(tools.map((t) => t.slug).sort());
  });

  it("the 'where these run' counts are the tools' own processing modes", async () => {
    for (const id of ids) {
      const page = await render(id);
      const text = textOf(page.html);
      const members = getToolsByCategory(id);
      for (const mode of Object.keys(processingMeta) as Array<
        keyof typeof processingMeta
      >) {
        const count = members.filter((t) => t.processing === mode).length;
        const line = `${processingMeta[mode].label}: ${count}`;
        if (count > 0) expect(text, id).toContain(line);
        else expect(text, id).not.toContain(`${processingMeta[mode].label}:`);
      }
    }
  });

  it("JSON-LD: a breadcrumb to itself and an ItemList of the tools the page links", async () => {
    for (const id of ids) {
      const page = await render(id);
      const self = new URL(categoryHref(id), siteConfig.url).toString();
      const crumbs = page.jsonLd.find((n) => n["@type"] === "BreadcrumbList");
      const items = (crumbs?.itemListElement ?? []) as { item: string }[];
      expect(items.length, id).toBeGreaterThanOrEqual(2);
      expect(items.at(-1)?.item, id).toBe(self);
      // A crumb with a query string is a crumb to a non-canonical URL.
      expect(
        items.filter((i) => i.item.includes("?")),
        id,
      ).toEqual([]);

      const collection = page.jsonLd.find(
        (n) => n["@type"] === "CollectionPage",
      );
      expect(collection?.url, id).toBe(self);
      const list = (collection?.mainEntity ?? {}) as {
        itemListElement?: { url: string }[];
      };
      // The composed chain: the structured list IS the rendered list.
      expect(
        (list.itemListElement ?? []).map((i) => new URL(i.url).pathname),
        id,
      ).toEqual(page.toolLinks.map((slug) => `/tools/${slug}`));
    }
  });

  it("each page links every other category's landing page", async () => {
    for (const id of ids) {
      const page = await render(id);
      for (const other of ids.filter((o) => o !== id)) {
        expect(page.html, `${id} → ${other}`).toContain(
          `href="${categoryHref(other)}"`,
        );
      }
    }
  });
});
