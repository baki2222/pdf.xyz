import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import {
  JPEG_30X20,
  JPEG_30X20_EXIF6,
  JPEG_HEIGHT,
  JPEG_WIDTH,
} from "../src/tests/jpeg-fixtures";
import { captureDownload, pdfPageImages } from "./client-proof/artifacts";
import { waitForHydration } from "./helpers";

/**
 * Scan to PDF on a phone (375 px wide, the `mobile` project's touch device):
 * the pages arrive through the CAMERA input — the `<input capture>` the
 * "Take photo" button opens — set with `setInputFiles`, since no test can
 * open a real camera. Then: nothing wider than the screen, every control a
 * thumb needs at least 44 px, and the PDF that downloads holds the photos
 * upright, in the order shown, as one-channel pages (the default Document
 * clean-up).
 *
 * Screenshots of each stage go to `SCAN_SHOTS_DIR` when it is set (the PR's
 * evidence); the assertions do not depend on them.
 */

const SCREEN = 375;
const MIN = 44;

test.use({ viewport: { width: SCREEN, height: 812 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.SCAN_SHOTS_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `newtools-${name}.png`) });
}

/** What is past the screen's edge, and which tap targets are too small. */
function measure(page: Page) {
  return page.evaluate(
    ({ min, width }) => {
      const shown = (el: Element) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const label = (el: Element) =>
        (el.getAttribute("aria-label") ?? el.textContent ?? "")
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 40);
      const small: string[] = [];
      const targets = document.querySelectorAll(
        "[data-scan-runner] button, [data-tool-panel] [data-run-trigger]",
      );
      for (const el of targets) {
        if (!shown(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < min - 0.5 || r.height < min - 0.5)
          small.push(
            `${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`,
          );
      }
      const overflow: string[] = [];
      for (const el of document.querySelectorAll("body *")) {
        if (!shown(el) || getComputedStyle(el).position === "fixed") continue;
        const r = el.getBoundingClientRect();
        if (r.right > width + 1 || r.left < -1)
          overflow.push(`${el.tagName.toLowerCase()} "${label(el)}"`);
      }
      return {
        targets: targets.length,
        small,
        overflow,
        scrollWidth: document.documentElement.scrollWidth,
      };
    },
    { min: MIN, width: SCREEN },
  );
}

test("scan two pages with the camera input at 375 px and download one PDF", async ({
  page,
}) => {
  await page.goto("/tools/scan-to-pdf");
  const camera = page.locator("input[data-scan-camera]");
  await expect(camera).toHaveAttribute("capture", "environment");
  await expect(camera).toHaveAttribute("accept", "image/*");
  const take = page.getByRole("button", { name: "Take photo", exact: true });
  await waitForHydration(take);
  await shot(page, "scan-1-empty");

  // Page 1: a portrait photo stored landscape with EXIF Orientation 6, as a
  // phone camera saves one. Page 2: the same pixels with no tag.
  await camera.setInputFiles({
    name: "image.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(JPEG_30X20_EXIF6),
  });
  await expect(page.locator("[data-scan-page]")).toHaveCount(1);
  // After the first page the button asks for the next one.
  await expect(
    page.getByRole("button", { name: "Take photo of the next page" }),
  ).toBeVisible();
  await camera.setInputFiles({
    name: "image.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(JPEG_30X20),
  });
  await expect(page.locator("[data-scan-page]")).toHaveCount(2);
  await expect(page.getByAltText("Page 2 preview")).toBeVisible();
  await page.locator("[data-scan-runner]").scrollIntoViewIfNeeded();
  await shot(page, "scan-2-pages");

  const measured = await measure(page);
  expect(measured.overflow, "elements past the 375 px screen").toEqual([]);
  expect(measured.scrollWidth).toBeLessThanOrEqual(SCREEN);
  // Health: the measurement saw the tile buttons and the chips.
  expect(measured.targets).toBeGreaterThanOrEqual(12);
  expect(measured.small, "tap targets under 44 px").toEqual([]);

  // Control for the overflow predicate: a 400 px box must be caught.
  const control = await page.evaluate((width) => {
    const box = document.createElement("div");
    box.style.width = "400px";
    box.textContent = "wide";
    document.querySelector("main")?.append(box);
    const caught = box.getBoundingClientRect().right > width + 1;
    box.remove();
    return caught;
  }, SCREEN);
  expect(control).toBe(true);

  await page.getByRole("button", { name: "US Letter" }).click();
  await expect(page.getByRole("button", { name: "US Letter" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await shot(page, "scan-3-options");

  const run = page.getByRole("button", { name: /^create pdf$/i });
  await run.click();
  await expect(
    page.getByRole("heading", { name: /scan saved as pdf/i }),
  ).toBeVisible();
  await shot(page, "scan-4-result");
  const buf = await captureDownload(
    page,
    page.getByRole("button", { name: /^download pdf$/i }),
  );

  const doc = await PDFDocument.load(buf);
  expect(doc.getPageCount()).toBe(2);
  const sizes = doc.getPages().map((p) => {
    const { width, height } = p.getSize();
    return [Math.round(width), Math.round(height)];
  });
  // US Letter: portrait for the EXIF-turned photo, landscape for the other.
  expect(sizes).toEqual([
    [612, 792],
    [792, 612],
  ]);
  const images = (await pdfPageImages(buf)).map((p) => p[0]);
  expect(images.map((i) => [i?.width, i?.height])).toEqual([
    [JPEG_HEIGHT, JPEG_WIDTH],
    [JPEG_WIDTH, JPEG_HEIGHT],
  ]);
  for (const image of images) {
    expect(image?.colorSpace).toBe("/DeviceGray");
    expect(image?.bitsPerComponent).toBe(8);
  }
});
