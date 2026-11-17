import { expect, test } from "@playwright/test";
import { uploadFiles } from "./helpers";
import {
  BOARDS,
  dialogViolations,
  shownAspect,
  writeShapesPdf,
  zoomButton,
} from "./page-zoom-fixture";

/**
 * "View page N larger" on a 375 x 812 phone (backlog #9, 2026-11-17): the
 * button is a 44 px target on every board, and the dialog it opens fits the
 * screen.
 */
test.use({ viewport: { width: 375, height: 812 } });

for (const board of BOARDS) {
  test(`${board.slug}: a 44 px button and a dialog that fits`, async ({
    page,
  }) => {
    await page.goto(`/tools/${board.slug}`);
    await uploadFiles(page, await writeShapesPdf());
    await expect(page.getByText("shapes.pdf").first()).toBeVisible();
    await board.reveal?.(page);
    const button = zoomButton(page, 1);
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    expect(box, "the button is laid out").not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await button.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("img")).toBeVisible();
    const d = await dialog.boundingBox();
    expect(d).not.toBeNull();
    expect(d!.x).toBeGreaterThanOrEqual(0);
    expect(d!.y).toBeGreaterThanOrEqual(0);
    expect(d!.x + d!.width).toBeLessThanOrEqual(375 + 0.5);
    expect(d!.y + d!.height).toBeLessThanOrEqual(812 + 0.5);
    // Its controls are on screen, not pushed below the fold.
    for (const name of [/close/i, /next page/i]) {
      const control = await dialog.getByRole("button", { name }).boundingBox();
      expect(control!.y + control!.height).toBeLessThanOrEqual(812 + 0.5);
    }
    // No sideways scroll on the page behind it.
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
}

// A phone short enough that the page does not fit beside the controls
// (360px of page in a 336px area, measured 2026-11-18): the page area
// scrolls, so it is a named tab stop. Here the scrollbars overlay the
// content, as on a real phone, so nothing about the area's own box changes
// when the page arrives; the dialog has to notice the page itself (the
// desktop spec's classic scrollbar resizes the area and would hide that).
test.describe("a 320 x 480 phone", () => {
  test.use({ viewport: { width: 320, height: 480 } });
  test("the page area scrolls and is a named tab stop", async ({ page }) => {
    await page.goto("/tools/rotate-pdf");
    await uploadFiles(page, await writeShapesPdf());
    // The board's scrolling grid takes a tap meant for the tile's button on
    // a screen this short; the keyboard opens it the same way.
    await zoomButton(page, 1).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await shownAspect(dialog);
    const area = dialog.getByRole("region", { name: "Page 1" });
    expect(
      await area.evaluate((el) => el.scrollHeight - el.clientHeight),
      "health: the page overflows",
    ).toBeGreaterThan(0);
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(area).toBeFocused();
    expect(await dialogViolations(page)).toEqual([]);
  });
});
