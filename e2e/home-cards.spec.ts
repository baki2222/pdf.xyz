import { expect, test } from "@playwright/test";
import { getAllToolSlugs } from "../src/lib/tools";
import { toolFamilies } from "../src/lib/tools/families";
import { GUIDE_META } from "../src/lib/guides/meta.generated";

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
 *
 * DERIVED FROM THE CARD COUNT since 2026-10-30. The bound was a typed height
 * (5,200 at 1440, 11,300 at 390) written for fifty cards, and the owner's
 * brief puts EVERY tool on the home page as a card — so four new tools
 * (PR #233) made a correct page "too tall" (5,275 on CI): the number held
 * the catalogue's size, not the page's compactness. What the brief asks is
 * that the page around the grid stays short and each card stays a card, so
 * the bound is now two parts, each measured and each held on its own:
 *
 *   height  <  CHROME_MAX  +  rows × ROW_MAX
 *
 * `rows` is read from the page (distinct card tops) and must equal
 * ceil(cards / columns), so a grid that silently stacked into one column
 * cannot buy itself room. Measured on the served build (Windows Chromium,
 * 2026-10-30, 54 tools): at 1440, 5 columns × 11 rows, grid 1,686px
 * (153.3px a row), the rest of the page 3,587px; at 390, 1 column × 54
 * rows, grid 6,181px (114.5 a row), the rest 4,173px. Each MAX is that
 * measurement plus the same platform margin as before. At fifty tools the
 * derived bound is 5,250 / 10,700 — no looser than the typed one was.
 */
// Re-measured 2026-10-30 with the guide list taken out (below): 3,650 and
// 4,450 until then, when the chrome still held the list.
const CHROME_MAX = { desktop: 3280, phone: 4260 } as const;
const ROW_MAX = { desktop: 160, phone: 125 } as const;

/**
 * THE GUIDE LIST IS THE SECOND GRID, since 2026-10-30. The home page links
 * every guide (`internal-links.test.ts`: the guides' strongest inbound
 * links), in a column list (`guides-section.tsx`), so a guide added to the
 * catalogue grows the page by design — and the typed CHROME_MAX above held
 * that list's size the way the typed height once held the card count. Three
 * guides (36 → 39, PR #241) put one row on the list and took the chrome to
 * 3,650 on CI. The same cure as the cards: the list is measured on its own,
 * its rows read from the page and held to ceil(visible / columns), and
 * subtracted from the chrome:
 *
 *   height  <  CHROME_MAX  +  rows × ROW_MAX  +  guideRows × GUIDE_ROW_MAX
 *
 * On a phone the list shows its first few and hides the rest, so its rows
 * do not grow there; the derivation still reads what is visible.
 *
 * Measured on the served build (Windows Chromium, 2026-10-30, 54 tools, 39
 * guides): at 1440, guides 3 columns × 13 rows = 436px (33.5 a row), the
 * rest of the page 3,215px; at 390, 6 shown in 1 × 6 = 192px (32.0 a row),
 * the rest 3,981px. Each MAX is the measurement plus the margin the card
 * bound already used (63px desktop, 277px phone for the chrome; a few px a
 * row). CI measured 3,650 for chrome + list at 39 guides; this run read
 * 3,651, so the margin is not spent on the platform difference.
 */
const GUIDE_ROW_MAX = { desktop: 36, phone: 36 } as const;

interface HomeMeasure {
  page: number;
  grid: number;
  rows: number;
  guides: number;
  guideRows: number;
}

/** The page's height against the derived bound — one predicate for both uses. */
function fitsBound(m: HomeMeasure, kind: keyof typeof CHROME_MAX): string[] {
  const out: string[] = [];
  const chrome = m.page - m.grid - m.guides;
  if (chrome >= CHROME_MAX[kind])
    out.push(`the page around the grid and the guide list is ${chrome}px`);
  if (m.grid / m.rows >= ROW_MAX[kind])
    out.push(`a row of cards is ${(m.grid / m.rows).toFixed(1)}px`);
  if (m.guides / m.guideRows >= GUIDE_ROW_MAX[kind])
    out.push(`a row of guides is ${(m.guides / m.guideRows).toFixed(1)}px`);
  if (
    m.page >=
    CHROME_MAX[kind] +
      m.rows * ROW_MAX[kind] +
      m.guideRows * GUIDE_ROW_MAX[kind]
  )
    out.push(
      `the page is ${m.page}px for ${m.rows} card rows and ${m.guideRows} guide rows`,
    );
  return out;
}

const grid = "section#tools ul[data-tool-grid] > li";
const guideList = "section#guides ul > li";

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

for (const [name, viewport, kind] of [
  ["1440", { width: 1440, height: 900 }, "desktop"],
  ["390", { width: 390, height: 844 }, "phone"],
] as const) {
  test(`at ${name}px the home page is no taller than its cards need`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    // Health: a page that failed to render is short too.
    await expect(page.locator(grid)).toHaveCount(getAllToolSlugs().length);
    const m = await page.evaluate(
      ([cardSel, guideSel]) => {
        /** Rows, columns and height of a list's VISIBLE items. */
        const measure = (selector: string) => {
          const items = [...document.querySelectorAll(selector)].filter(
            (li) => li.getClientRects().length > 0,
          );
          const tops = items.map((li) =>
            Math.round(li.getBoundingClientRect().top + window.scrollY),
          );
          const rowTops = [...new Set(tops)];
          const list = items[0]?.parentElement?.getBoundingClientRect();
          return {
            height: Math.round(list?.height ?? 0),
            rows: rowTops.length,
            cols: tops.filter((t) => t === rowTops[0]).length,
            items: items.length,
          };
        };
        const cards = measure(cardSel);
        const guides = measure(guideSel);
        return {
          page: document.documentElement.scrollHeight,
          grid: cards.height,
          rows: cards.rows,
          cols: cards.cols,
          cards: cards.items,
          guides: guides.height,
          guideRows: guides.rows,
          guideCols: guides.cols,
          guideItems: guides.items,
        };
      },
      [grid, guideList] as const,
    );
    console.log(
      `home ${name}: page ${m.page}, cards ${m.cols}×${m.rows} = ${m.grid} (${(m.grid / m.rows).toFixed(1)}/row), guides ${m.guideItems} in ${m.guideCols}×${m.guideRows} = ${m.guides} (${(m.guides / m.guideRows).toFixed(1)}/row), rest ${m.page - m.grid - m.guides}`,
    );
    expect(m.page).toBeGreaterThan(1500);
    // The rows are the grid's, not a stack: ceil(cards / columns).
    expect(m.rows).toBe(Math.ceil(m.cards / m.cols));
    // The guide list is a grid too, and it was found: every guide on a
    // wide screen, some on a phone.
    expect(m.guideItems).toBeGreaterThan(0);
    if (kind === "desktop") expect(m.guideItems).toBe(GUIDE_META.length);
    expect(m.guideRows).toBe(Math.ceil(m.guideItems / m.guideCols));
    expect(fitsBound(m, kind)).toEqual([]);
    // Positive controls through the same predicate: 400px more page around
    // the grids, rows of cards 20px taller, or rows of guides 20px taller,
    // must each be caught.
    expect(
      fitsBound({ ...m, page: m.page + 400 }, kind).length,
    ).toBeGreaterThan(0);
    expect(
      fitsBound(
        { ...m, grid: m.grid + 20 * m.rows, page: m.page + 20 * m.rows },
        kind,
      ).length,
    ).toBeGreaterThan(0);
    expect(
      fitsBound(
        {
          ...m,
          guides: m.guides + 20 * m.guideRows,
          page: m.page + 20 * m.guideRows,
        },
        kind,
      ).length,
    ).toBeGreaterThan(0);
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
