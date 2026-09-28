// @vitest-environment node
/**
 * The guide pages' structured data, read out of the RENDERED markup the way a
 * crawler reads it — not out of the builder that feeds it.
 *
 * WHAT SHIPPED: every guide's HowTo was named
 * `"How to use How to merge PDF files"`. The guide page passed `guide.title`
 * (already a how-to) to `howToSchema`, which prefixes "How to use" because it
 * was written for tool names. Measured on production 2026-09-20 at
 * https://pdf.xyz/guides/how-to-merge-pdf-files; all eleven guides carried it.
 * The builder was correct for its first caller, and nothing checked the
 * second.
 *
 * THE PROPERTY: the HowTo a guide page ships is named exactly the guide's
 * title — for EVERY guide, enumerated from the segment's own
 * `generateStaticParams`, never a typed list. The POSITIVE CONTROL is the tool
 * builder over every tool in the catalogue, rendered through the same
 * `<JsonLd>`: it must still read "How to use <Tool>", so a fix that simply
 * dropped the prefix everywhere fails here too.
 *
 * Why not render the tool page itself: it imports the chat-with-PDF panel,
 * which `chat-with-pdf-worker-panel.test.tsx` evaluates under a `vi.mock`, and
 * under `isolate: false` a second importer would receive that stub-bound
 * instance — `src/tests/mock-isolation.test.ts` refuses exactly that edge. The
 * tool page's call site belongs to another lane; the built
 * `tools/merge-pdf.html` read "How to use Merge PDF" when this landed.
 *
 * The same render also carries the TechArticle, whose `dateModified` is the
 * date the sitemap publishes for that URL — the composed chain from the page
 * a crawler reads to the sitemap it was sent by.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GuidePage, { generateStaticParams } from "./[slug]/page";
import sitemap from "../sitemap";
import { guides, getGuideBySlug } from "@/lib/guides";
import { tools } from "@/lib/tools";
import { siteConfig } from "@/lib/site";
import { JsonLd } from "@/components/seo/json-ld";
import { howToSchema } from "@/lib/structured-data";

type Node = Record<string, unknown>;

/** Every JSON-LD node in a render, parsed as a crawler parses it. */
function jsonLdOf(html: string): Node[] {
  return [
    ...html.matchAll(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    ),
  ].map((m) => JSON.parse(m[1] ?? "null") as Node);
}

function only(nodes: Node[], type: string, where: string): Node {
  const found = nodes.filter((n) => n["@type"] === type);
  expect(found, `${where}: expected exactly one ${type}`).toHaveLength(1);
  return found[0]!;
}

async function renderGuide(slug: string): Promise<Node[]> {
  const element = await GuidePage({ params: Promise.resolve({ slug }) });
  return jsonLdOf(renderToStaticMarkup(element));
}

const guideSlugs = generateStaticParams().map((p) => p.slug);

describe("guide structured data, as rendered", () => {
  it("the corpus is every guide the route prerenders", () => {
    // Health check: `[] ⊆ X` is vacuous. Eleven guides shipped the defect.
    expect(guideSlugs).toEqual(guides.map((g) => g.slug));
    expect(guideSlugs.length).toBeGreaterThanOrEqual(11);
  });

  it("every guide's HowTo is named exactly its title", async () => {
    const wrong: string[] = [];
    for (const slug of guideSlugs) {
      const guide = getGuideBySlug(slug)!;
      const howTo = only(await renderGuide(slug), "HowTo", slug);
      const name = String(howTo.name);
      if (name !== guide.title || /how to use how to/i.test(name)) {
        wrong.push(`${slug}: ${JSON.stringify(name)}`);
      }
      // And the steps are the page's steps, so the name is not all that is
      // checked on the node.
      expect(
        (howTo.step as Node[]).map((s) => s.text),
        slug,
      ).toEqual([...guide.steps]);
    }
    expect(wrong).toEqual([]);
  });

  it("positive control: the tool builder still reads 'How to use <Tool>' for every tool", () => {
    expect(tools.length).toBeGreaterThan(40);
    const wrong: string[] = [];
    for (const tool of tools) {
      const html = renderToStaticMarkup(
        <JsonLd data={howToSchema(tool.name, ["step"])} />,
      );
      const howTo = only(jsonLdOf(html), "HowTo", tool.slug);
      if (howTo.name !== `How to use ${tool.name}`) {
        wrong.push(`${tool.slug}: ${JSON.stringify(howTo.name)}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("each guide's TechArticle dateModified is the lastmod the sitemap publishes for it", async () => {
    const byUrl = new Map(sitemap().map((e) => [e.url, e.lastModified]));
    for (const slug of guideSlugs) {
      const url = new URL(`/guides/${slug}`, siteConfig.url).toString();
      const article = only(await renderGuide(slug), "TechArticle", slug);
      expect(article.dateModified, slug).toBe(getGuideBySlug(slug)!.updated);
      expect(byUrl.get(url), `${url} in sitemap()`).toBe(article.dateModified);
    }
  });
});
