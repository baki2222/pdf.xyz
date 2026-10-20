import { expect, test } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { waitForHydration } from "./helpers";

/**
 * The guide article on a 390px phone (design spec D.9, WP-13): body copy
 * measures 16px (it was 15px below `sm`), the contents are one collapsed
 * `<details>`, and the "Open {tool}" bar stays on screen while the article
 * scrolls — above the consent banner while the banner is open, so the one
 * never covers the other.
 */
const GUIDE = "/guides/how-to-merge-pdf-files";

test("body copy measures 16px, the contents are collapsed", async ({
  page,
}) => {
  await page.goto(GUIDE);
  const sizes = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        "article p, article ol li > span",
      ),
    ]
      .filter((el) => (el.textContent ?? "").length > 80)
      .map((el) => parseFloat(getComputedStyle(el).fontSize)),
  );
  expect(sizes.length).toBeGreaterThan(3);
  expect(sizes.filter((s) => s < 16)).toEqual([]);
  const details = page.locator("details[data-guide-contents]");
  await expect(details).toBeVisible();
  await expect(details).not.toHaveAttribute("open");
  await expect(page.locator("nav[data-guide-contents]")).toBeHidden();
});

test("the open bar stays on screen mid-article, without the banner", async ({
  page,
}) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
  await page.goto(GUIDE);
  await waitForHydration(page.locator("main"));
  const bar = page.locator("[data-guide-open-bar]");
  await page.locator("#faq").scrollIntoViewIfNeeded();
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!;
  const vh = page.viewportSize()!.height;
  // Pinned to the bottom edge of the viewport.
  expect(Math.abs(box.y + box.height - vh)).toBeLessThanOrEqual(2);
  await expect(bar.getByRole("link", { name: /Open Merge PDF/ })).toBeVisible();
});

test("with the consent banner open, the bar sits above it", async ({
  page,
}) => {
  await page.goto(GUIDE);
  await waitForHydration(page.locator("main"));
  const banner = page.getByRole("region", { name: "Analytics consent" });
  await expect(banner).toBeVisible();
  await page.locator("#faq").scrollIntoViewIfNeeded();
  const bar = (await page.locator("[data-guide-open-bar]").boundingBox())!;
  const b = (await banner.boundingBox())!;
  // Health: both are on screen, so the comparison is about real boxes.
  expect(bar.height).toBeGreaterThan(30);
  expect(bar.y + bar.height).toBeLessThanOrEqual(b.y + 1);
});
