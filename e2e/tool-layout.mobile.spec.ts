import { expect, test, type Page } from "@playwright/test";
import { getAllToolSlugs, getToolsByCategory } from "../src/lib/tools";
import { categories } from "../src/lib/tools/categories";
import { categoryHref } from "../src/lib/tools/category-href";
import { getRunnerKind } from "../src/lib/pdf/registry";

/**
 * The working surface above the fold on a phone (390×844, the `mobile`
 * project). Each number is a page-coordinate measured in a real browser
 * after load, never inferred from class names.
 *
 * Measured on the build before WP-06 (2026-10-10, design/batch-b @ 8d4888a9):
 *
 *     /tools            first tool card at 724px
 *     /                 the toolbox section 3,678px tall
 *     /tools/word-to-pdf  the worker panel at 2,192px (under the whole intro)
 *     /tools/ocr-pdf      the worker panel at 2,511px
 *     /tools/merge-pdf    the runner panel at 342px (already above the fold)
 *
 * The redesign spec also asks for the word-to-pdf panel's DropSheet under
 * 420px. That drop zone does not exist yet: the Office panel mounts its
 * picker only once `/api/worker/status` answers ready, and a local build has
 * no worker. What this package controls is where the PANEL sits — head, then
 * panel, then the details — and that is what is held here; the DropSheet's
 * own position binds with the panel redesign that renders it on the server.
 */

/** Top of the first element matching `selector`, in page coordinates. */
async function topOf(page: Page, selector: string): Promise<number> {
  const el = page.locator(selector).first();
  await el.waitFor({ state: "attached" });
  return el.evaluate((node) =>
    Math.round(node.getBoundingClientRect().top + window.scrollY),
  );
}

test("/tools: the first tool card starts above 560px", async ({ page }) => {
  await page.goto("/tools");
  const top = await page
    .getByRole("main")
    .locator('a[href^="/tools/"]')
    .evaluateAll((links) => {
      const first = links.find((a) =>
        /^\/tools\/[a-z0-9-]+$/.test(a.getAttribute("href") ?? ""),
      );
      return first
        ? Math.round(first.getBoundingClientRect().top + window.scrollY)
        : null;
    });
  expect(top, "no tool card found on /tools").not.toBeNull();
  expect(top!).toBeLessThan(560);
});

test("/: the toolbox section is at most 1,100px tall, and still links every tool", async ({
  page,
}) => {
  await page.goto("/");
  const toolbox = page.locator("section#tools");
  const height = await toolbox.evaluate((el) =>
    Math.round(el.getBoundingClientRect().height),
  );
  expect(height).toBeLessThanOrEqual(1100);
  // Hidden on a phone is not removed: every tool is still linked in the HTML.
  const hrefs = await toolbox
    .locator('a[href^="/tools/"]')
    .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
  const linked = new Set(hrefs);
  const missing = getAllToolSlugs().filter(
    (slug) => !linked.has(`/tools/${slug}`),
  );
  expect(missing).toEqual([]);
});

test("/: on a phone each toolbox card shows its first three tools and a link to all of them", async ({
  page,
}) => {
  await page.goto("/");
  const toolbox = page.locator("section#tools");
  for (const category of categories) {
    const heading = toolbox.getByRole("heading", {
      level: 3,
      name: new RegExp(`^${category.name.replace(/[&]/g, "\\$&")}`),
    });
    await expect(heading, category.id).toBeVisible();
    await expect(heading.getByRole("link"), category.id).toHaveAttribute(
      "href",
      categoryHref(category.id),
    );
    // The card is the heading's nearest ancestor that also holds the rows.
    const card = heading.locator(
      "xpath=ancestor::*[.//a[starts-with(@href, '/tools/') and not(contains(@href, '/category/'))]][1]",
    );
    const shown = await card
      .locator('a[href^="/tools/"]:not([href*="/category/"])')
      .evaluateAll(
        (links) =>
          links.filter((a) => (a as HTMLElement).offsetParent !== null).length,
      );
    expect(shown, category.id).toBe(
      Math.min(3, getToolsByCategory(category.id).length),
    );
  }
});

for (const slug of ["merge-pdf", "word-to-pdf", "ocr-pdf"]) {
  test(`/tools/${slug}: the tool's panel starts above 400px`, async ({
    page,
  }) => {
    await page.goto(`/tools/${slug}`);
    expect(await topOf(page, "[data-tool-panel]")).toBeLessThan(400);
  });
}

test("every tool page fits a phone: its facts row never scrolls and the page never scrolls sideways", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const slugs = getAllToolSlugs();
  // Health: both layouts are in the set, so neither is checked vacuously.
  expect(slugs.some((slug) => getRunnerKind(slug))).toBe(true);
  expect(slugs.some((slug) => !getRunnerKind(slug))).toBe(true);
  const overflowing: string[] = [];
  for (const slug of slugs) {
    await page.goto(`/tools/${slug}`, { waitUntil: "domcontentloaded" });
    const fit = await page.evaluate(() => {
      const facts = document.querySelector("[data-tool-facts]");
      return {
        facts: facts ? facts.scrollWidth - facts.clientWidth : null,
        page:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      };
    });
    if (fit.facts === null) overflowing.push(`${slug}: no facts row`);
    else if (fit.facts > 0)
      overflowing.push(`${slug}: facts row ${fit.facts}px too wide`);
    if (fit.page > 0) overflowing.push(`${slug}: page ${fit.page}px too wide`);
  }
  expect(overflowing).toEqual([]);
});
