import { expect, test } from "@playwright/test";
import { uploadFiles } from "./helpers";
import { BOARDS, writeShapesPdf, zoomButton } from "./page-zoom-fixture";

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
