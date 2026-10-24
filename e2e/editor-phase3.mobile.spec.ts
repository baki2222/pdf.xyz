import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  captureDownload,
  pdfAnnotations,
  pdfPageTexts,
} from "./client-proof/artifacts";
import { fileInput, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";

/**
 * Edit PDF, Phase 3, on a touch phone (390 × 844, 3x): the Pages sheet
 * opened from the docked toolbar turns a page and inserts a blank one; a
 * check mark is placed with a tap and picked up with a LONG PRESS while the
 * Check tool is still on (a tap there would place another); and the
 * downloaded file has the pages as arranged.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

test("Pages sheet: rotate and insert; long-press selects; download", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const n of ["ONE", "TWO"]) {
    doc
      .addPage([612, 792])
      .drawText(`PAGE ${n}`, { x: 72, y: 720, size: 14, font });
  }
  await page.goto("/tools/edit-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "phone.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.locator('[data-editor-page="1"]')).toBeAttached({
    timeout: 20_000,
  });

  // Pages, from the dock.
  const pagesButton = page.getByRole("button", { name: "Pages", exact: true });
  await pagesButton.scrollIntoViewIfNeeded();
  await pagesButton.tap();
  const sheet = page.locator("[data-pages-sheet]");
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Rotate page 1" }).tap();
  await expect(page.locator('[data-editor-page="0"]')).toHaveAttribute(
    "data-page-pt",
    "792x612",
  );
  await sheet
    .getByRole("button", { name: "Insert a blank page after page 2" })
    .tap();
  await expect(sheet.locator("[data-rail-page]")).toHaveCount(3);
  // Nothing is wider than the phone with the sheet open.
  expect(
    await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]),
  ).toEqual([390, 390]);
  const dir = process.env.SHOTS_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, "p3-phone-pages.png") });
  }
  await sheet.getByRole("button", { name: "Done" }).tap();
  await expect(sheet).toHaveCount(0);

  // A check mark, tapped onto page 2.
  const check = page.getByRole("button", { name: "Check", exact: true });
  await check.scrollIntoViewIfNeeded();
  await check.tap();
  const two = page.locator('[data-editor-page="1"]');
  await two.scrollIntoViewIfNeeded();
  const box = (await two.boundingBox())!;
  const scale = box.width / 612;
  const x = box.x + 200 * scale;
  const y = box.y + 200 * scale;
  await page.touchscreen.tap(x, y);
  const mark = page.locator('[data-editor-page="1"] [data-object-kind="mark"]');
  await expect(mark).toHaveCount(1);

  // Long press on it: selected, the tool back to Select, nothing added.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  await page.waitForTimeout(700);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator("[data-properties-sheet]")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Select", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(mark).toHaveCount(1);
  await expect(mark).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Done" }).tap();

  const buf = await captureDownload(
    page,
    page.getByRole("button", { name: /apply & download/i }),
  );
  const texts = await pdfPageTexts(buf);
  expect(texts).toHaveLength(3);
  expect(texts[0]).toContain("PAGE ONE");
  expect(texts[1]).toContain("PAGE TWO");
  expect(texts[2]!.trim()).toBe("");
  expect((await pdfAnnotations(buf)).map((p) => p.rotate)).toEqual([90, 0, 0]);
});
