import { expect, test, type Locator, type Page } from "@playwright/test";
import { categories } from "../src/lib/tools/categories";
import { categoryHref } from "../src/lib/tools/category-href";
import { getAllToolSlugs, getToolsByCategory } from "../src/lib/tools";
import { processingSplit } from "../src/lib/tools/processing-split";
import { waitForHydration } from "./helpers";

/**
 * `/tools` as a crawler reads it, then as a reader uses it.
 *
 * TWO HALVES, because the page is two things. The served HTML is the whole
 * catalogue — `/tools` is prerendered and reads no `searchParams`
 * (`pages-static.test.ts`) — so what a crawler or a no-script reader gets is
 * checked with script OFF: the heading outline, a linked H2 per category with
 * its description, the guides aside, and a link to every tool. Ranking and
 * filtering happen after hydration from `window.location`, so they are
 * checked with script ON and never asserted of the served HTML (the redesign
 * spec's "?q=merge puts Merge PDF first in the served HTML" cannot be true of
 * a static page, and should not be).
 *
 * Every expected set is DERIVED — the categories, the slugs, the never-upload
 * partition — never typed, so a tool or a category added tomorrow is checked
 * without this file changing.
 */

const SLUG_HREF = /^\/tools\/[a-z0-9-]+$/;

/** Distinct `/tools/{slug}` links inside `main`, category pages excluded. */
async function toolHrefs(scope: Locator): Promise<Set<string>> {
  const hrefs = await scope
    .locator('a[href^="/tools/"]')
    .evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
  return new Set(hrefs.filter((href) => SLUG_HREF.test(href)));
}

/** Tool links in document order (cards, in the order they are shown). */
async function toolOrder(page: Page): Promise<string[]> {
  const hrefs = await page
    .getByRole("main")
    .locator('a[href^="/tools/"]')
    .evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
  return hrefs.filter((href) => SLUG_HREF.test(href));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const everyTool = new Set(getAllToolSlugs().map((slug) => `/tools/${slug}`));

test.describe("/tools as served, script off", () => {
  test.use({ javaScriptEnabled: false });

  test("one H1, then H2s, then card H3s — no level is skipped", async ({
    page,
  }) => {
    await page.goto("/tools");
    const levels = await page
      .getByRole("main")
      .locator("h1, h2, h3, h4, h5, h6")
      .evaluateAll((hs) => hs.map((h) => Number(h.tagName.slice(1))));
    // Health: the outline is the page, not an empty main.
    expect(levels.length).toBeGreaterThan(everyTool.size);
    expect(levels[0]).toBe(1);
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    const jumps = levels
      .map((level, i) => (i > 0 ? level - levels[i - 1]! : 0))
      .filter((step) => step > 1);
    expect(jumps, `heading levels in order: ${levels.join(" ")}`).toEqual([]);
  });

  test("a linked H2 and its description per category, the guides aside, and nothing else at H2", async ({
    page,
  }) => {
    await page.goto("/tools");
    const main = page.getByRole("main");
    for (const category of categories) {
      const heading = main.getByRole("heading", {
        level: 2,
        name: new RegExp(`^${escape(category.name)}`),
      });
      await expect(heading).toHaveCount(1);
      await expect(heading.getByRole("link")).toHaveAttribute(
        "href",
        categoryHref(category.id),
      );
      await expect(main.getByText(category.description)).toBeVisible();
    }
    const aside = main.getByRole("heading", {
      level: 2,
      name: "Not sure which tool you need?",
    });
    await expect(aside).toHaveCount(1);
    await expect(
      main.getByRole("complementary").getByRole("link", { name: /guides/i }),
    ).toHaveAttribute("href", "/guides");
    // Nine content H2s: one per category, plus the guides aside. A search
    // heading ("Best matches for …") is client-only and must not be served.
    await expect(main.getByRole("heading", { level: 2 })).toHaveCount(
      categories.length + 1,
    );
    await expect(
      main.getByRole("heading", { name: /matches for|searching for/i }),
    ).toHaveCount(0);
  });

  test("links every tool in the catalogue, and only tools in it", async ({
    page,
  }) => {
    await page.goto("/tools");
    const served = await toolHrefs(page.getByRole("main"));
    // Health: a collapsed set would make the equality below meaningless.
    expect(everyTool.size).toBeGreaterThanOrEqual(40);
    expect([...served].sort()).toEqual([...everyTool].sort());
  });
});

test.describe("/tools after hydration", () => {
  test("?q=merge ranks Merge PDF first", async ({ page }) => {
    await page.goto("/tools?q=merge");
    await waitForHydration(
      page.getByRole("searchbox", { name: /search tools/i }),
    );
    await expect(
      page.getByRole("heading", { level: 2, name: "Best matches for “merge”" }),
    ).toBeVisible();
    expect((await toolOrder(page))[0]).toBe("/tools/merge-pdf");
  });

  test("?category=ai shows the AI tools and nothing else", async ({ page }) => {
    await page.goto("/tools?category=ai");
    const chip = page.getByRole("button", { name: /^AI/ });
    await waitForHydration(chip);
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    const ai = getToolsByCategory("ai").map((t) => `/tools/${t.slug}`);
    expect(ai.length).toBeGreaterThan(0);
    await expect
      .poll(async () => [...(await toolHrefs(page.getByRole("main")))].sort())
      .toEqual(ai.sort());
  });

  test("?runs=never-uploads shows exactly the tools that never upload, and says so", async ({
    page,
  }) => {
    await page.goto("/tools?runs=never-uploads");
    const radio = page.getByRole("radio", { name: /^Never uploads/ });
    await waitForHydration(radio);
    await expect(radio).toBeChecked();
    const never = processingSplit().neverUploads.map((t) => `/tools/${t.slug}`);
    expect(never.length).toBeGreaterThan(0);
    await expect
      .poll(async () => [...(await toolHrefs(page.getByRole("main")))].sort())
      .toEqual(never.sort());
    // The radio's own count is the partition's.
    await expect(radio).toHaveAccessibleName(
      new RegExp(`^Never uploads ${never.length}$`),
    );
  });

  test("an unknown ?runs= falls back to every tool, never an empty grid", async ({
    page,
  }) => {
    await page.goto("/tools?runs=bogus");
    const all = page.getByRole("radio", { name: /^All/ });
    await waitForHydration(all);
    await expect(all).toBeChecked();
    expect(await toolHrefs(page.getByRole("main"))).toEqual(everyTool);
  });
});

test.describe("/tools at 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the search field and the result count share one row", async ({
    page,
  }) => {
    await page.goto("/tools");
    const search = page.getByRole("searchbox", { name: /search tools/i });
    await waitForHydration(search);
    const field = (await search.boundingBox())!;
    const count = (await page.locator("[data-result-count]").boundingBox())!;
    const middle = count.y + count.height / 2;
    expect(middle).toBeGreaterThan(field.y);
    expect(middle).toBeLessThan(field.y + field.height);
  });
});
