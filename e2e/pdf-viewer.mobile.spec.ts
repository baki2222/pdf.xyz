import { expect, test } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { VIEWER_LABELS } from "../src/lib/pdf/viewer-copy";
import { viewerProofPdf } from "../src/tests/viewer-fixtures";
import { fileInput, waitForHydration } from "./helpers";

/**
 * The PDF Viewer on a 375 px phone: every control the viewer draws is at
 * least 44 x 44 px, nothing makes the page scroll sideways, and the side
 * panel opens as a sheet over the pages (and closes on a pick).
 */

const SCREEN = 375;
const MIN = 44;

test.use({ viewport: { width: SCREEN, height: 812 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
  await page.goto("/tools/pdf-viewer");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "proof.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(viewerProofPdf()),
  });
  await expect(
    page.getByRole("region", { name: "PDF viewer: proof.pdf" }),
  ).toBeVisible({ timeout: 30_000 });
});

/** Controls under 44 px, and elements wider than the screen. */
async function measure(page: import("@playwright/test").Page) {
  return page.evaluate(
    ({ min, width }) => {
      const region = document.querySelector("[data-pdf-viewer]")!;
      const shown = (el: Element) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const controls = [
        ...region.querySelectorAll(
          'button, select, input:not([type="checkbox"]), label:has(input[type="checkbox"])',
        ),
      ].filter(shown);
      const small = controls
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width < min - 0.5 || r.height < min - 0.5;
        })
        .map((el) => {
          const r = el.getBoundingClientRect();
          const name =
            el.getAttribute("aria-label") ??
            (el.textContent ?? "").trim().slice(0, 30);
          return `${el.tagName} ${name} ${Math.round(r.width)}x${Math.round(r.height)}`;
        });
      return {
        controls: controls.length,
        small,
        pageWidth: document.documentElement.scrollWidth,
        width,
      };
    },
    { min: MIN, width: SCREEN },
  );
}

test("every viewer control is at least 44 px and the page does not scroll sideways", async ({
  page,
}) => {
  const m = await measure(page);
  // Health: the toolbar was measured, not an empty set.
  expect(m.controls).toBeGreaterThanOrEqual(10);
  expect(m.small).toEqual([]);
  expect(m.pageWidth).toBeLessThanOrEqual(SCREEN);

  // And with search open.
  await page.getByRole("button", { name: VIEWER_LABELS.search }).click();
  const withSearch = await measure(page);
  expect(withSearch.small).toEqual([]);
  expect(withSearch.pageWidth).toBeLessThanOrEqual(SCREEN);
});

test("thumbnails open as a sheet over the pages and close on a pick", async ({
  page,
}) => {
  await page.getByRole("button", { name: VIEWER_LABELS.thumbnails }).click();
  const sheet = page.locator('[data-viewer-sidebar="thumbnails"]');
  await expect(sheet).toBeVisible();
  const scroller = page.locator("[data-viewer-scroller]");
  const [s, p] = [
    (await sheet.boundingBox())!,
    (await scroller.boundingBox())!,
  ];
  // Over the pages, not beside them: the sheet covers the scroller's width.
  expect(s.width).toBeGreaterThanOrEqual(p.width - 1);
  const m = await measure(page);
  expect(m.small).toEqual([]);
  expect(m.pageWidth).toBeLessThanOrEqual(SCREEN);
  await page.locator("[data-viewer-thumbnail]").nth(2).click();
  await expect(sheet).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: VIEWER_LABELS.pageNumber }),
  ).toHaveValue("3");
});
