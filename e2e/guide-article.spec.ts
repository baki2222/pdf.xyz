import { expect, test, type Page } from "@playwright/test";
import { waitForHydration } from "./helpers";

/**
 * The guide article in the browser at 1440 (design spec D.9, WP-13).
 *
 * `src/app/guides/guide-layout.test.tsx` holds the markup; this holds what
 * a reader at a desktop width actually gets: body copy that MEASURES at
 * least 16px, the contents rail beside the article (and the collapsed copy
 * gone), still in view after a long scroll, and no sticky open bar — that
 * is for narrow screens. The guide is found the way a reader finds one,
 * from the index, and every guide the index links is measured.
 */

/** Every guide the index links. */
async function guideHrefs(page: Page): Promise<string[]> {
  await page.goto("/guides");
  const hrefs = await page
    .locator('main a[href^="/guides/"]')
    .evaluateAll((as) => [
      ...new Set(as.map((a) => a.getAttribute("href") ?? "")),
    ]);
  return hrefs.filter((h) => /^\/guides\/.+/.test(h));
}

/** Runs in the page: the computed size of every body paragraph of the article. */
function bodySizes(): { size: number; text: string }[] {
  return [
    ...document.querySelectorAll<HTMLElement>(
      "article p, article ol li > span",
    ),
  ]
    .filter((el) => (el.textContent ?? "").length > 80)
    .map((el) => ({
      size: parseFloat(getComputedStyle(el).fontSize),
      text: (el.textContent ?? "").slice(0, 40),
    }));
}

test.describe("a guide at 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("body copy measures at least 16px on every guide", async ({ page }) => {
    const hrefs = await guideHrefs(page);
    // Health: the index links the catalogue, not one guide.
    expect(hrefs.length).toBeGreaterThanOrEqual(11);
    const small: string[] = [];
    for (const href of hrefs) {
      await page.goto(href);
      const sizes = await page.evaluate(bodySizes);
      // Health: a page with no measured paragraph measured nothing.
      expect(sizes.length, href).toBeGreaterThan(3);
      for (const s of sizes)
        if (s.size < 16) small.push(`${href}: ${s.size}px — ${s.text}`);
    }
    expect(small).toEqual([]);
  });

  test("the contents rail sits beside the article and stays in view; the collapsed copy and the bar are gone", async ({
    page,
  }) => {
    const [href] = await guideHrefs(page);
    await page.goto(href!);
    await waitForHydration(page.locator("main"));
    const rail = page.locator("nav[data-guide-contents]");
    await expect(rail).toBeVisible();
    await expect(page.locator("details[data-guide-contents]")).toBeHidden();
    await expect(page.locator("[data-guide-open-bar]")).toBeHidden();

    const article = await page.locator("article").boundingBox();
    const box = await rail.boundingBox();
    // In the left gutter: entirely left of the article column.
    expect(box!.x + box!.width).toBeLessThanOrEqual(article!.x + 1);

    // Sticky: after scrolling to the FAQ, the rail is still on screen.
    await page.locator("#faq, section[id]").last().scrollIntoViewIfNeeded();
    const after = await rail.boundingBox();
    expect(after!.y).toBeGreaterThanOrEqual(0);
    expect(after!.y).toBeLessThan(900);
    // Each link goes to a section on the page.
    const targets = await rail
      .locator("a")
      .evaluateAll((as) =>
        as.map((a) => !!document.querySelector(a.getAttribute("href")!)),
      );
    expect(targets.length).toBeGreaterThanOrEqual(3);
    expect(targets.every(Boolean)).toBe(true);
  });
});
