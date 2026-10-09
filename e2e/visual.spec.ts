import { expect, test, type Page } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { categories } from "../src/lib/tools/categories";
import { categoryHref } from "../src/lib/tools/category-href";
import { waitForHydration } from "./helpers";
import { visualRequested } from "./visual-request";

/**
 * Full-page screenshots for a reviewer, never a pixel gate: every route in
 * ROUTES, at a phone (390x844) and a desktop (1440x900), in the light and the
 * dark scheme, with reduced motion so every capture is a still end state —
 * four images a route, saved to each test's output directory (`test-results/`,
 * ignored) and attached to the report. They are not committed as baselines: fonts render differently on
 * Windows and on the Linux CI image, so a pixel comparison would fail on the
 * platform rather than on the design.
 *
 * THE CONSENT BANNER IS CLOSED in those captures, by storing a decision before the
 * first navigation. It is `position: fixed`, so a full-page capture painted it
 * 600-900px down the page, where no visitor ever sees it — over the home drop
 * zone at 390, the merge page's steps at 1440, the 404's footer. Every capture
 * of 2026-10-09 carried it, on every machine (the banner renders whenever no
 * decision is stored). The key is imported from the module the banner reads,
 * never typed, and each capture asserts the banner is absent, so the seeding
 * cannot quietly stop working. The banner's own look is captured separately:
 * two VIEWPORT shots (one per scheme, phone width) with no decision stored,
 * where `position: fixed` puts it where a visitor sees it.
 *
 * The routes include each page TEMPLATE a design change can reach, not only
 * the busiest pages: the guides index and a category page joined on
 * 2026-10-09, because `SectionHeading` is their H1 and the type scale had
 * just given it two sizes. The category is the catalogue's first, through
 * `categoryHref`, so a renamed category moves the capture with it.
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

/** The banner's decline button: present exactly while the banner is open. */
const consentBanner = (page: Page) =>
  page
    .getByRole("region", { name: "Analytics consent" })
    .getByRole("button", { name: "No thanks" });

/** Load, hydrate, settle and wait for fonts: the still end state a capture records. */
async function settle(page: Page, url: string, status: number) {
  const res = await page.goto(url, { waitUntil: "load" });
  expect(res?.status(), url).toBe(status);
  await waitForHydration(page.locator("main"));
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

const ROUTES: {
  name: string;
  url: (page: Page) => Promise<string>;
  status: number;
}[] = [
  { name: "home", url: async () => "/", status: 200 },
  { name: "tools", url: async () => "/tools", status: 200 },
  {
    name: "category",
    url: async () => categoryHref(categories[0]!.id),
    status: 200,
  },
  { name: "guides", url: async () => "/guides", status: 200 },
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
        // Before ANY navigation (firstGuide navigates too): a stored decision
        // keeps the banner closed on every page this test loads.
        await page.addInitScript((key) => {
          window.localStorage.setItem(key, "denied");
        }, CONSENT_STORAGE_KEY);
        await page.setViewportSize({
          width: viewport.width,
          height: viewport.height,
        });
        await page.emulateMedia({
          colorScheme: scheme,
          reducedMotion: "reduce",
        });
        await settle(page, await route.url(page), route.status);
        // Health check: the seeding worked. The banner mounts only after
        // hydration, which settle() waited for; its positive control is the
        // banner capture below, which finds the same button visible.
        await expect(
          consentBanner(page),
          "the consent banner is open over a full-page capture: the stored decision did not take",
        ).toHaveCount(0);
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

for (const scheme of SCHEMES) {
  test(`consent banner @ 390 ${scheme} (viewport)`, async ({
    page,
  }, testInfo) => {
    // No decision stored: the banner a first-time visitor sees, captured at
    // the viewport (not the full page), where `position: fixed` places it.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await settle(page, "/", 200);
    // Positive control for the absence check above: the same locator finds
    // the open banner, so a toHaveCount(0) there is not a blind locator.
    await expect(consentBanner(page)).toBeVisible();
    const file = testInfo.outputPath(`consent-banner-390-${scheme}.png`);
    const png = await page.screenshot({ path: file, fullPage: false });
    expect(png.byteLength).toBeGreaterThan(10_000);
    await testInfo.attach(`consent-banner-390-${scheme}`, {
      path: file,
      contentType: "image/png",
    });
  });
}
