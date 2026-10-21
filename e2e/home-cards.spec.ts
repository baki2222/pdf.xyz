import { expect, test } from "@playwright/test";
import { getAllToolSlugs } from "../src/lib/tools";
import { toolFamilies } from "../src/lib/tools/families";

/**
 * The home page's tool cards, through the served page (owner's brief,
 * 2026-10-21). `tool-grid.test.tsx` holds the markup against a render in the
 * test process; this reads what the SERVER sends and what a real browser
 * shows: every card in the HTML, the chips filtering after hydration, every
 * card with scripts off, and the page's height — the brief's measure of
 * "short".
 *
 * Heights measured on production before the redesign (2026-10-21): 9,821px
 * at 1440 and 14,131px at 390. The brief's targets: under about 5,000 and
 * about 7,000.
 *
 * THE PHONE TARGET IS NOT MET, and this bound says so rather than hiding it.
 * Measured on the served build (Windows Chromium, 2026-10-21): 4,98x px at
 * 1440, 10,7xx px at 390. At 390 the footer alone (WP-09, out of scope) is
 * about 2,000px, and fifty cards that each carry a one-line summary and a
 * badge are about 5,400px stacked; dropping the summaries on a phone would
 * reach about 6,900, at the cost of the one thing the brief asked every
 * card to say. The bound is the measurement plus a platform margin (text
 * metrics differ between Windows and CI's Linux), so the page cannot grow
 * back toward 14,131 unseen.
 */
const MAX_HEIGHT = { desktop: 5000, phone: 11300 } as const;

const grid = "section#tools ul[data-tool-grid] > li";

test("the served HTML carries a card for every tool, none hidden", async ({
  request,
}) => {
  const html = await (await request.get("/")).text();
  const missing = getAllToolSlugs().filter(
    (slug) => !html.includes(`href="/tools/${slug}"`),
  );
  expect(missing).toEqual([]);
  // The grid's items as served: as many as tools, and none `hidden`.
  const list = html.match(/<ul[^>]*data-tool-grid[^>]*>([\s\S]*?)<\/ul>/);
  expect(list, "no card grid in the served HTML").not.toBeNull();
  const items = list![1]!.match(/<li\b[^>]*>/g) ?? [];
  expect(items).toHaveLength(getAllToolSlugs().length);
  expect(items.filter((li) => /\shidden\b/.test(li))).toEqual([]);
});

test("a chip narrows the grid to its family, and All brings every card back", async ({
  page,
}) => {
  await page.goto("/");
  const chips = page.getByRole("group", { name: "Filter tools by category" });
  await expect(chips).toBeVisible();
  const cards = page.locator(grid);
  await expect(cards.filter({ visible: true })).toHaveCount(
    getAllToolSlugs().length,
  );
  for (const family of toolFamilies()) {
    const chip = chips.getByRole("button", {
      name: new RegExp(`^${family.label}\\b`),
    });
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(cards.filter({ visible: true }), family.id).toHaveCount(
      family.tools.length,
    );
  }
  await chips.getByRole("button", { name: /^All\b/ }).click();
  await expect(cards.filter({ visible: true })).toHaveCount(
    getAllToolSlugs().length,
  );
});

test.describe("with JavaScript off", () => {
  test.use({ javaScriptEnabled: false });

  test("every card shows", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(grid).filter({ visible: true })).toHaveCount(
      getAllToolSlugs().length,
    );
  });
});

for (const [name, viewport, max] of [
  ["1440", { width: 1440, height: 900 }, MAX_HEIGHT.desktop],
  ["390", { width: 390, height: 844 }, MAX_HEIGHT.phone],
] as const) {
  test(`at ${name}px the home page is under ${max}px tall`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const height = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );
    // Health: a page that failed to render is short too.
    await expect(page.locator(grid)).toHaveCount(getAllToolSlugs().length);
    expect(height).toBeGreaterThan(1500);
    expect(height).toBeLessThan(max);
  });
}
