import { test, expect } from "@playwright/test";
import { axeViolations } from "./chat-citations-fixture";
import {
  PAGE_SIZES,
  card,
  cardNumber,
  expectWidgetsAsSeen,
  openWithPdf,
  seenBoxes,
  sheetAt,
  widgetsAsViewed,
} from "./create-forms-preview-fixture";

/**
 * Create Fillable Forms: place fields on the page preview (backlog #17,
 * 2026-11-17), in the served page. Two fields — a text field on page 1 and
 * a radio group on page 2, which is turned /Rotate 90 with an inset crop —
 * are placed by clicking the preview, one is dragged and one nudged with the
 * keyboard; the form is then created and DOWNLOADED, and pdfjs (in the test
 * process) reads where each widget sits on the displayed page. Each must be
 * the box the preview showed, within half a pixel and pdf-lib's half-point
 * border; and each card's X/Y must be what the click asked for.
 */
const NAMES = { f1: "field_1", f2: "field_2" };

test("click, drag and nudge on the preview: the saved widgets are the boxes shown", async ({
  page,
}) => {
  const sheet = await openWithPdf(page);

  // Click page 1 a quarter in and 30% down: the text field's bottom-left
  // corner goes there.
  let at = await sheetAt(sheet, 0.25, 0.3);
  await page.mouse.click(at.x, at.y);
  const wantX = Math.round(((at.x - at.sheet.x) / at.sheet.width) * 612);
  const wantY = Math.round((1 - (at.y - at.sheet.y) / at.sheet.height) * 792);
  expect(
    Math.abs((await cardNumber(page, "f1", "X")) - wantX),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs((await cardNumber(page, "f1", "Y")) - wantY),
  ).toBeLessThanOrEqual(1);

  // A second field: a two-button radio group on page 2.
  await page.getByRole("button", { name: "Add field" }).click();
  const radio = card(page, "f2");
  await radio
    .getByRole("radiogroup", { name: "Field type" })
    .getByRole("radio", { name: "Radio" })
    .click();
  await radio.getByLabel(/Options/).fill("Yes\nNo");
  await radio.getByLabel("Button W", { exact: true }).fill("14");
  await radio.getByLabel("Button H", { exact: true }).fill("14");
  await radio.getByLabel("Page", { exact: true }).fill("2");
  await expect(
    page.getByText("Showing page 2, where field_2 is"),
  ).toBeVisible();
  await expect(sheet.locator("[data-field-box]")).toHaveCount(2);
  // The sheet is the page as displayed: landscape, the crop's shape.
  const shape = (await sheet.boundingBox())!;
  expect(shape.width / shape.height).toBeCloseTo(696 / 540, 2);
  // And so is the picture drawn in it.
  const img = sheet.locator("img");
  await expect(img).toHaveCount(1, { timeout: 20_000 });
  const ratio = await img.evaluate(
    (el: HTMLImageElement) => el.naturalWidth / el.naturalHeight,
  );
  expect(Math.abs(ratio - 696 / 540)).toBeLessThan(0.02);

  at = await sheetAt(sheet, 0.5, 0.5);
  await page.mouse.click(at.x, at.y);
  const rx = Math.round(((at.x - at.sheet.x) / at.sheet.width) * 696);
  const ry = Math.round((1 - (at.y - at.sheet.y) / at.sheet.height) * 540);
  expect(
    Math.abs((await cardNumber(page, "f2", "X")) - rx),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs((await cardNumber(page, "f2", "Y")) - ry),
  ).toBeLessThanOrEqual(1);

  // Nudge it with the keyboard: Shift+Right is 10 pt, Up is 1 pt.
  const before = {
    x: await cardNumber(page, "f2", "X"),
    y: await cardNumber(page, "f2", "Y"),
  };
  const radioBox = sheet.getByRole("button", { name: /^field_2, Radio group/ });
  await radioBox.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => cardNumber(page, "f2", "X")).toBe(before.x + 10);
  expect(await cardNumber(page, "f2", "Y")).toBe(before.y + 1);

  // Axe on the preview as it stands.
  expect(await axeViolations(page)).toEqual([]);
  const page2 = await seenBoxes(sheet);

  // Back to page 1, by selecting its card, and drag the text field.
  await card(page, "f1").getByLabel("X", { exact: true }).focus();
  await expect(
    page.getByText("Showing page 1, where field_1 is"),
  ).toBeVisible();
  const textBox = sheet.locator('[data-field-box][data-of="f1"]');
  await sheet.scrollIntoViewIfNeeded();
  const b = (await textBox.boundingBox())!;
  const s = (await sheet.boundingBox())!;
  const x0 = await cardNumber(page, "f1", "X");
  const y0 = await cardNumber(page, "f1", "Y");
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2 - 30, {
    steps: 6,
  });
  await page.mouse.up();
  expect(
    Math.abs((await cardNumber(page, "f1", "X")) - (x0 + (40 / s.width) * 612)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      (await cardNumber(page, "f1", "Y")) - (y0 + (30 / s.height) * 792),
    ),
  ).toBeLessThanOrEqual(1);
  const page1 = await seenBoxes(sheet);

  // Create, download, and read the widgets back.
  await page.getByRole("button", { name: "Create form" }).click();
  await expect(page.getByText("Fillable form ready")).toBeVisible({
    timeout: 20_000,
  });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download form PDF" }).click(),
  ]);
  const widgets = await widgetsAsViewed((await download.path())!);
  expect(widgets.map((w) => w.name).sort()).toEqual([
    "field_1",
    "field_2",
    "field_2",
  ]);
  expect(widgets.find((w) => w.page === 2)!.pageWidth).toBe(
    PAGE_SIZES[1].width,
  );
  expectWidgetsAsSeen(widgets, page1, 1, NAMES);
  expectWidgetsAsSeen(widgets, page2, 2, NAMES);
});
