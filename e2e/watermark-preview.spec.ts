import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { test, expect, type Locator } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { PDFJS_DOCUMENT_DEFAULTS } from "../src/lib/pdf/wasm-assets";
import { fileInput, waitForHydration } from "./helpers";

/**
 * Add Watermark's live preview (audit watermark-pdf#1), in the served page:
 * the first page is drawn with the mark over it, centred by default (the
 * positive control); the mark is DRAGGED to the top-left quadrant; the run is
 * downloaded and pdf.js, in the test process, reads where the watermark text
 * sits on page 1. It must be in the top-left quadrant, where the preview
 * showed it, within a few points.
 */

const PAGE = { width: 600, height: 800 };

async function onePagePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([PAGE.width, PAGE.height]);
  return Buffer.from(await doc.save());
}

/** The first mark's centre on the preview, in page points (top-left origin). */
async function markCentre(sheet: Locator) {
  const transform = await sheet
    .locator("[data-watermark-mark]")
    .first()
    .getAttribute("transform");
  const [, cx, cy] = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(transform!)!;
  return { cx: Number(cx), cy: Number(cy) };
}

/** Where pdf.js finds `text` on page 1: its baseline midpoint, viewer frame. */
async function textAsViewed(file: string, text: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const require = createRequire(join(process.cwd(), "package.json"));
  const dir = dirname(require.resolve("pdfjs-dist/package.json"));
  const task = pdfjs.getDocument({
    data: new Uint8Array(readFileSync(file)),
    useWorkerFetch: false,
    disableFontFace: true,
    ...PDFJS_DOCUMENT_DEFAULTS,
    wasmUrl: `${pathToFileURL(join(dir, "wasm")).href}/`,
  });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const items = (await page.getTextContent()).items.filter(
      (i) => "str" in i && i.str.includes(text),
    ) as { transform: number[]; width: number }[];
    expect(items).toHaveLength(1);
    const [a, b, , , e, f] = items[0]!.transform as number[];
    const len = Math.hypot(a!, b!) || 1;
    const end = [
      e! + (items[0]!.width * a!) / len,
      f! + (items[0]!.width * b!) / len,
    ];
    const [x0, y0] = vp.convertToViewportPoint(e!, f!);
    const [x1, y1] = vp.convertToViewportPoint(end[0]!, end[1]!);
    return { x: (x0! + x1!) / 2, y: (y0! + y1!) / 2 };
  } finally {
    await task.destroy();
  }
}

test("drag the mark on the preview: the download has it where the preview showed", async ({
  page,
}) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
  await page.goto("/tools/watermark-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "plain.pdf",
    mimeType: "application/pdf",
    buffer: await onePagePdf(),
  });
  const sheet = page.getByTestId("watermark-preview");
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  // The page itself is drawn under the mark.
  await expect(sheet.locator("img")).toHaveCount(1, { timeout: 20_000 });
  await expect(sheet.locator("[data-watermark-mark]")).toHaveCount(1);

  // Positive control: the default sits in the middle.
  const start = await markCentre(sheet);
  expect(start.cx).toBeCloseTo(PAGE.width / 2, 0);
  expect(start.cy).toBeCloseTo(PAGE.height / 2, 0);

  // Drag from the middle to a quarter in from the top-left.
  await sheet.scrollIntoViewIfNeeded();
  const box = (await sheet.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3, {
    steps: 8,
  });
  await page.mouse.up();
  await expect
    .poll(async () => (await markCentre(sheet)).cx)
    .toBeLessThan(PAGE.width / 2);
  const moved = await markCentre(sheet);
  expect(moved.cy).toBeLessThan(PAGE.height / 2);
  // No cell of the grid is chosen any more; the note says why.
  await expect(
    page
      .getByRole("radiogroup", { name: "Watermark position" })
      .getByRole("radio", { checked: true }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Add watermark" }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download watermarked PDF" })
    .click({ timeout: 30_000 });
  const file = await (await download).path();
  const seen = await textAsViewed(file!, "CONFIDENTIAL");
  expect(seen.x).toBeLessThan(PAGE.width / 2);
  expect(seen.y).toBeLessThan(PAGE.height / 2);
  // Where the preview drew it: the baseline midpoint is the mark's centre
  // moved down by half the mark's height along the tilt, a few points.
  expect(Math.abs(seen.x - moved.cx)).toBeLessThan(30);
  expect(Math.abs(seen.y - moved.cy)).toBeLessThan(30);
});
