import { expect, test } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { sizeLabel } from "../src/lib/pdf/size-presets";
import {
  COMPRESS_TABLE_SIZES,
  LIMIT_TABLE_SIZES,
  SIZE_PARAM,
  sizeSpelling,
} from "../src/lib/pdf/size-targets";

/**
 * The size guides' tables (audit #2, 2026-11-17) on a phone, on the served
 * build: the page never scrolls sideways at 375 px (the narrowest phone the
 * layout is drawn for) or at 640 px (where `sm:` starts and text wraps most),
 * every row's anchor exists and a link to one lands on it, each row's link
 * opens its tool with its own size, and the table moves nothing as the page
 * loads. The rows are the same lists the catalogue builds them from
 * (`size-table.test.ts` holds the catalogue to them).
 */

const GUIDES = [
  {
    path: "/guides/how-to-compress-a-pdf-to-100-kb",
    tool: "compress-pdf",
    sizes: COMPRESS_TABLE_SIZES,
  },
  {
    path: "/guides/how-to-convert-jpg-to-pdf-under-100-kb",
    tool: "jpg-to-pdf",
    sizes: LIMIT_TABLE_SIZES,
  },
] as const;

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        value: number;
        hadRecentInput: boolean;
      }[])
        if (!entry.hadRecentInput)
          (window as unknown as { __cls: number }).__cls += entry.value;
    }).observe({ type: "layout-shift", buffered: true });
  }, CONSENT_STORAGE_KEY);
});

for (const width of [375, 640]) {
  for (const guide of GUIDES) {
    test(`${guide.path} at ${width} px: no sideways scroll, every row anchored and linked`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${guide.path}#size-2mb`);
      // Health check: the table is there, with one row per size.
      const rows = page.locator('tr[id^="size-"]');
      await expect(rows).toHaveCount(guide.sizes.length);
      await expect(page.locator("#size-2mb")).toBeInViewport();

      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        inner: window.innerWidth,
      }));
      expect(overflow.scroll).toBeLessThanOrEqual(overflow.inner);

      for (const bytes of guide.sizes) {
        const spelling = sizeSpelling(sizeLabel(bytes));
        const row = page.locator(`#size-${spelling}`);
        await row.scrollIntoViewIfNeeded();
        await expect(row).toBeVisible();
        await expect(row.getByRole("link")).toHaveAttribute(
          "href",
          `/tools/${guide.tool}?${SIZE_PARAM}=${spelling}`,
        );
      }
      const cls = await page.evaluate(
        () => (window as unknown as { __cls: number }).__cls,
      );
      expect(cls).toBeLessThanOrEqual(0.01);
    });
  }
}
