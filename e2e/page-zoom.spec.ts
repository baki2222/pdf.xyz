import { expect, test } from "@playwright/test";
import { uploadFiles } from "./helpers";
import {
  BOARDS,
  PAGE_SIZES,
  dialogViolations,
  shownAspect,
  writeShapesPdf,
  zoomButton,
} from "./page-zoom-fixture";

/**
 * "View page N larger" on every page board (backlog #9, 2026-11-17), in a
 * real browser against `next start`: open by mouse and by keyboard, Escape
 * closes and focus goes back, the enlarged image is the right page (each of
 * the three pages has its own shape), and axe finds nothing in the dialog.
 */
const aspect = (n: number) => PAGE_SIZES[n - 1]![0] / PAGE_SIZES[n - 1]![1];

test.describe("page boards · view a page larger", () => {
  for (const board of BOARDS) {
    test(`${board.slug}: mouse, keyboard, the right page, axe`, async ({
      page,
    }) => {
      const source = await writeShapesPdf();
      await page.goto(`/tools/${board.slug}`);
      await uploadFiles(page, source);
      await expect(page.getByText("shapes.pdf").first()).toBeVisible();
      await board.reveal?.(page);

      // Mouse: page 2 opens, and is page 2.
      const second = zoomButton(page, 2);
      await second.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      expect(await shownAspect(dialog)).toBeCloseTo(aspect(2), 1);
      expect(await dialogViolations(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(second).toBeFocused();

      // Keyboard: Tab reaches the last page's button. Split's last page has
      // no cut of its own, so from page 2's cut it is two Tabs (page 2's
      // button, then page 3's); elsewhere one Tab from page 3's own control.
      // (Until review, Split targeted page 2 here: page 3's button could not
      // be reached by any key.)
      const target = zoomButton(page, 3);
      const start =
        board.slug === "split-pdf"
          ? page.getByRole("button", { name: "Cut after page 2" })
          : board.slug === "organize-pages"
            ? page.getByRole("button", { name: /^Reorder page 3/ })
            : // Resize's tiles add the page size to the name.
              page.getByRole("button", { name: /^Page 3(,|$)/ });
      await start.focus();
      let reached = false;
      for (let i = 0; i < 6 && !reached; i++) {
        await page.keyboard.press("Tab");
        reached = await target.evaluate((el) => el === document.activeElement);
      }
      expect(reached, "Tab reaches the enlarge button").toBe(true);
      await page.keyboard.press("Enter");
      await expect(dialog).toBeVisible();
      expect(await shownAspect(dialog)).toBeCloseTo(aspect(3), 1);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(target).toBeFocused();
    });
  }

  test("rotate-pdf: the enlarged page is turned as it will come out, and the tile keeps its selection", async ({
    page,
  }) => {
    await page.goto("/tools/rotate-pdf");
    await uploadFiles(page, await writeShapesPdf());
    const tile = page.getByRole("button", { name: "Page 2", exact: true });
    await page.getByRole("button", { name: "Rotate page 2 right" }).click();
    const pressed = await tile.getAttribute("aria-pressed");
    await zoomButton(page, 2).click();
    const dialog = page.getByRole("dialog");
    expect(await shownAspect(dialog)).toBeCloseTo(1 / aspect(2), 1);
    await page.keyboard.press("Escape");
    await expect(tile).toHaveAttribute("aria-pressed", pressed!);
  });

  test("organize-pages: the dialog walks the new order", async ({ page }) => {
    await page.goto("/tools/organize-pages");
    await uploadFiles(page, await writeShapesPdf());
    await page.getByRole("button", { name: "Move page 1 right" }).click();
    await zoomButton(page, 2).click();
    const dialog = page.getByRole("dialog", {
      name: "Page 2, position 1 of 3",
    });
    expect(await shownAspect(dialog)).toBeCloseTo(aspect(2), 1);
    await dialog.getByRole("button", { name: /next page/i }).click();
    const next = page.getByRole("dialog", { name: "Page 1, position 2 of 3" });
    await expect(next).toBeVisible();
    expect(await shownAspect(next)).toBeCloseTo(aspect(1), 1);
  });

  test("split-pdf: the enlarge button leaves the cut alone", async ({
    page,
  }) => {
    await page.goto("/tools/split-pdf");
    await uploadFiles(page, await writeShapesPdf());
    const cut = page.getByRole("button", { name: "Cut after page 1" });
    const pressed = await cut.getAttribute("aria-pressed");
    await zoomButton(page, 1).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(cut).toHaveAttribute("aria-pressed", pressed!);
  });
});
