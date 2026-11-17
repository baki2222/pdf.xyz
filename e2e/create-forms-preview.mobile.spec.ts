import { test, expect } from "@playwright/test";
import { axeViolations } from "./chat-citations-fixture";
import {
  cardNumber,
  expectWidgetsAsSeen,
  openWithPdf,
  seenBoxes,
  sheetAt,
  widgetsAsViewed,
} from "./create-forms-preview-fixture";

/**
 * Create Fillable Forms' page preview on a 375 x 812 touch phone (backlog
 * #17, 2026-11-17): a TAP on the page places the field, the page never gets
 * wider than the phone, every box is at least a 24 px target, axe finds
 * nothing, and the downloaded widget is the box the preview showed.
 */
test.use({ viewport: { width: 375, height: 812 } });

test("a tap on the preview places the field, and the saved widget is the box shown", async ({
  page,
}) => {
  const sheet = await openWithPdf(page);
  const at = await sheetAt(sheet, 0.4, 0.5);
  await page.touchscreen.tap(at.x, at.y);
  const wantX = Math.round(((at.x - at.sheet.x) / at.sheet.width) * 612);
  const wantY = Math.round((1 - (at.y - at.sheet.y) / at.sheet.height) * 792);
  await expect
    .poll(async () => Math.abs((await cardNumber(page, "f1", "X")) - wantX))
    .toBeLessThanOrEqual(1);
  expect(
    Math.abs((await cardNumber(page, "f1", "Y")) - wantY),
  ).toBeLessThanOrEqual(1);

  // Never wider than the phone, and the sheet fits inside it.
  const widths = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    view: window.innerWidth,
  }));
  expect(widths.doc).toBeLessThanOrEqual(widths.view);
  const s = (await sheet.boundingBox())!;
  expect(s.x).toBeGreaterThanOrEqual(0);
  expect(s.x + s.width).toBeLessThanOrEqual(375);
  // Every box is at least a 24 px target.
  const buttons = sheet.locator("button[data-preview-field]");
  expect(await buttons.count()).toBe(1);
  for (const box of await buttons.all()) {
    const r = (await box.boundingBox())!;
    expect(r.width).toBeGreaterThanOrEqual(24);
    expect(r.height).toBeGreaterThanOrEqual(24);
  }
  expect(await axeViolations(page)).toEqual([]);

  const seen = await seenBoxes(sheet);
  await page.getByRole("button", { name: "Create form" }).click();
  await expect(page.getByText("Fillable form ready")).toBeVisible({
    timeout: 20_000,
  });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download form PDF" }).click(),
  ]);
  const widgets = await widgetsAsViewed((await download.path())!);
  expectWidgetsAsSeen(widgets, seen, 1, { f1: "field_1" });
});
