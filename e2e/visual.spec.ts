import { expect, test, type Page } from "@playwright/test";
import { waitForHydration } from "./helpers";
import { visualRequested } from "./visual-request";

/**
 * Full-page screenshots for a reviewer, never a pixel gate: seven routes, at a
 * phone (390x844) and a desktop (1440x900), in the light and the dark scheme,
 * with reduced motion so every capture is a still end state. 28 images, saved
 * to each test's output directory (`test-results/`, ignored) and attached to
 * the report. They are not committed as baselines: fonts render differently on
 * Windows and on the Linux CI image, so a pixel comparison would fail on the
 * platform rather than on the design.
 *
 *   pnpm test:visual                                  # or
 *   VISUAL=1 pnpm test:e2e e2e/visual.spec.ts
 *
 * Skipped otherwise, and ignored by the default project (playwright.config.ts)
 * unless requested, through the one predicate both read (`visual-request.ts`).
 */

test.skip(
  !visualRequested(),
  "screenshots are on demand: VISUAL=1 or pnpm test:visual",
);

/** A guide, found the way a reader finds one: the first the guides index links. */
async function firstGuide(page: Page): Promise<string> {
  await page.goto("/guides");
  const href = await page
    .locator('main a[href^="/guides/"]')
    .first()
    .getAttribute("href");
  expect(href, "the guides index links no guide").toMatch(/^\/guides\/.+/);
  return href!;
}

const ROUTES: {
  name: string;
  url: (page: Page) => Promise<string>;
  status: number;
}[] = [
  { name: "home", url: async () => "/", status: 200 },
  { name: "tools", url: async () => "/tools", status: 200 },
  { name: "merge-pdf", url: async () => "/tools/merge-pdf", status: 200 },
  { name: "ocr-pdf", url: async () => "/tools/ocr-pdf", status: 200 },
  { name: "workspace", url: async () => "/workspace", status: 200 },
  { name: "guide", url: firstGuide, status: 200 },
  { name: "404", url: async () => "/nope", status: 404 },
];

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
] as const;

const SCHEMES = ["light", "dark"] as const;

for (const route of ROUTES) {
  for (const viewport of VIEWPORTS) {
    for (const scheme of SCHEMES) {
      test(`${route.name} @ ${viewport.name} ${scheme}`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({
          width: viewport.width,
          height: viewport.height,
        });
        await page.emulateMedia({
          colorScheme: scheme,
          reducedMotion: "reduce",
        });
        const url = await route.url(page);
        const res = await page.goto(url, { waitUntil: "load" });
        expect(res?.status(), url).toBe(route.status);
        await waitForHydration(page.locator("main"));
        await page.waitForLoadState("networkidle");
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        const file = testInfo.outputPath(
          `${route.name}-${viewport.name}-${scheme}.png`,
        );
        const png = await page.screenshot({ path: file, fullPage: true });
        // Health check: a blank or failed capture is small; a real page is not.
        expect(png.byteLength).toBeGreaterThan(10_000);
        await testInfo.attach(`${route.name}-${viewport.name}-${scheme}`, {
          path: file,
          contentType: "image/png",
        });
      });
    }
  }
}
