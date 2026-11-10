import { expect, test } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { VIEWER_LABELS } from "../src/lib/pdf/viewer-copy";
import { viewerProofPdf } from "../src/tests/viewer-fixtures";
import { fileInput, waitForHydration } from "./helpers";

/**
 * The PDF Viewer on a 375 px phone: every control the viewer tool draws is
 * at least 44 x 44 px — the toolbar, search, both side-panel tabs and
 * "Open another PDF" (the review of 2026-11-10 found the Bookmarks rows at
 * 36 px and that link at 16 px, outside the set this spec measured) —
 * nothing makes the page scroll sideways, the viewer is no taller than the
 * screen, and the side panel opens as a sheet over the pages that takes
 * focus, closes on Escape or a pick, and hides the pages it covers.
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
      // The whole tool, not only the viewer region: "Open another PDF" sits
      // outside it.
      const region = document.querySelector("[data-pdf-viewer-tool]")!;
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

test("the viewer is no taller than the screen, its toolbar at most three rows", async ({
  page,
}) => {
  // History (review, 2026-11-10): the toolbar wrapped to four rows (201
  // px) over a 633 px column, so the viewer was 834 px on an 812 px screen.
  const m = await page.evaluate(() => {
    const region = document.querySelector("[data-pdf-viewer]")!;
    const toolbar = region.querySelector('[role="toolbar"]')!;
    const scroller = region.querySelector("[data-viewer-scroller]")!;
    const shown = [...toolbar.children].filter(
      (el) =>
        el.getBoundingClientRect().width > 1 &&
        el.getBoundingClientRect().height > 1,
    );
    return {
      region: region.getBoundingClientRect().height,
      rows: new Set(
        shown.map((el) => Math.round(el.getBoundingClientRect().top)),
      ).size,
      scroller: scroller.getBoundingClientRect().height,
      screen: window.innerHeight,
    };
  });
  expect(m.region).toBeLessThanOrEqual(m.screen);
  // Was four rows; zoom +/- give way to the zoom menu on a phone. Rows are
  // counted from the controls' own tops (a row of 44 px controls each).
  expect(m.rows).toBeGreaterThanOrEqual(1);
  expect(m.rows).toBeLessThanOrEqual(3);
  // Positive control: the pages still get most of the screen.
  expect(m.scroller).toBeGreaterThan(m.screen * 0.6);
});

test("bookmarks open as a sheet whose rows are 44 px", async ({ page }) => {
  await page.getByRole("button", { name: VIEWER_LABELS.bookmarks }).click();
  const sheet = page.locator('[data-viewer-sidebar="bookmarks"]');
  await expect(sheet.getByRole("button", { name: "Third page" })).toBeVisible();
  const m = await measure(page);
  // Health: the bookmark rows were in the measured set.
  const rows = await sheet.locator("[data-viewer-bookmark]").count();
  expect(rows).toBe(2);
  expect(m.small).toEqual([]);
});

test("the sheet takes focus, Escape closes it and gives focus back, and the pages under it are inert", async ({
  page,
}) => {
  const toggle = page.getByRole("button", { name: VIEWER_LABELS.thumbnails });
  await toggle.click();
  const sheet = page.locator('[data-viewer-sidebar="thumbnails"]');
  await expect(sheet).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .querySelector("[data-viewer-sidebar]")
            ?.contains(document.activeElement) ?? false,
      ),
    )
    .toBe(true);
  await expect(page.locator("[data-viewer-scroller]")).toHaveAttribute(
    "inert",
    "",
  );
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await expect(page.locator("[data-viewer-scroller]")).not.toHaveAttribute(
    "inert",
    "",
  );
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
