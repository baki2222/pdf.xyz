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
 * #17, 2026-11-17): a TAP on the page places the field, a SWIPE that starts
 * on it scrolls the page and leaves the field alone, the page never gets
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

  // A finger that swipes up from the page scrolls the page, and the field
  // stays where the tap put it (review 2026-11-17: it followed the finger
  // to X 412, Y 210, silently). The browser takes the gesture as a scroll
  // and cancels the press; the card's numbers must come back unchanged.
  const placed = {
    x: await cardNumber(page, "f1", "X"),
    y: await cardNumber(page, "f1", "Y"),
  };
  const from = await sheetAt(sheet, 0.8, 0.8);
  const scrolledBefore = await page.evaluate(() => window.scrollY);
  await sheet.evaluate((el) => {
    const w = window as unknown as { sheetPresses: string[] };
    w.sheetPresses = [];
    for (const type of ["pointerdown", "pointercancel"])
      el.addEventListener(type, (e) =>
        w.sheetPresses.push(`${type}:${(e as PointerEvent).pointerType}`),
      );
  });
  const cdp = await page.context().newCDPSession(page);
  // One finger, pressed on the sheet and dragged 300 px up in steps.
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: from.x, y: from.y }],
  });
  for (let step = 1; step <= 10; step += 1)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: from.x, y: from.y - step * 30 }],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  // Health: the swipe pressed the SHEET with a finger, the browser took it
  // back as a scroll, and the page did scroll.
  expect(
    await page.evaluate(
      () => (window as unknown as { sheetPresses: string[] }).sheetPresses,
    ),
  ).toEqual(["pointerdown:touch", "pointercancel:touch"]);
  await expect
    .poll(
      async () => (await page.evaluate(() => window.scrollY)) - scrolledBefore,
    )
    .toBeGreaterThan(100);
  expect({
    x: await cardNumber(page, "f1", "X"),
    y: await cardNumber(page, "f1", "Y"),
  }).toEqual(placed);

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
