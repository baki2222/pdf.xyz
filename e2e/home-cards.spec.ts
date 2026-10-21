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
 * Measured on the served build (Windows Chromium, 2026-10-21): 4,983px at
 * 1440, 10,728px at 390. At 390 the footer alone (WP-09, out of scope) is
 * about 2,000px, and fifty cards that each carry a one-line summary and a
 * badge are about 5,400px stacked; dropping the summaries on a phone would
 * reach about 6,900, at the cost of the one thing the brief asked every
 * card to say. The bound is the measurement plus a platform margin (text
 * metrics differ between Windows and CI's Linux), so the page cannot grow
 * back toward 14,131 unseen.
 */
// Desktop: the brief's 5,000 plus the same platform margin.
const MAX_HEIGHT = { desktop: 5200, phone: 11300 } as const;

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

/*
 * Review of PR #199 (2026-10-21): a phone's first screen still read as
 * technical — the drop box printed every size limit ("PDF up to 100 MB ·
 * Word, Excel, PowerPoint up to 50 MB · …") — and the box's reserved
 * height left the chips far below it. The limits now sit behind a "File
 * limits" disclosure (the tool pages state them too), and the box is
 * compact on a phone.
 */
test.describe("a phone's first screen", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the size limits are behind a File limits disclosure", async ({
    page,
  }) => {
    await page.goto("/");
    const limits = page.getByText(/PDF up to \d+ MB/);
    await expect(limits).toBeHidden();
    await page.locator("#upload").getByText("File limits").click();
    await expect(limits).toBeVisible();
  });

  test("the chips start just past the first screen", async ({ page }) => {
    await page.goto("/");
    const top = await page
      .getByRole("group", { name: "Filter tools by category" })
      .evaluate((el) =>
        Math.round(el.getBoundingClientRect().top + window.scrollY),
      );
    // Measured at 390x844 on the served build (Windows Chromium,
    // 2026-10-21): 1,083 in the first round, when the desk reserved the
    // ticket's height; 868 with the compact box. The bound is that plus a
    // platform margin for text metrics.
    expect(top).toBeLessThanOrEqual(920);
  });
});
