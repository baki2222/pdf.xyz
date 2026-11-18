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

  // The page area scrolls only when the page does not fit beside the
  // dialog's controls: measured on 2026-11-18 it never did at 1280x800,
  // 1280x500, 812x375, 375x812, 360x640 or 320x568 (on a short desktop
  // window the dialog itself scrolls instead), and did at 320x480 (360px
  // of page in 348px). A box that is always a tab stop was an empty stop
  // between Close and Next page at every common size, so it is one exactly
  // while it scrolls (review finding, 2026-11-18).
  test("the page area is a tab stop only while it scrolls", async ({
    page,
  }) => {
    await page.goto("/tools/rotate-pdf");
    await uploadFiles(page, await writeShapesPdf());
    const dialog = page.getByRole("dialog");
    const area = dialog.getByRole("region", { name: "Page 1" });
    const open = async (width: number, height: number) => {
      await page.setViewportSize({ width, height });
      await zoomButton(page, 1).click();
      await shownAspect(dialog);
      await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
      return area.evaluate((el) => el.scrollHeight - el.clientHeight);
    };

    // It does not fit (opened first, so the page is drawn afresh and the
    // area learns it overflows only when the image arrives): the area is the
    // next stop, named by the heading, and the arrow keys scroll it; axe
    // finds nothing in the dialog.
    expect(await open(320, 480), "health: the page overflows").toBeGreaterThan(
      0,
    );
    await page.keyboard.press("Tab");
    await expect(area).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect
      .poll(() => area.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
    expect(await dialogViolations(page)).toEqual([]);

    // The window grows with the dialog open: the page fits, and the area
    // stops being a stop.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect
      .poll(() => area.evaluate((el) => el.scrollHeight - el.clientHeight))
      .toBe(0);
    await expect(area).not.toHaveAttribute("tabindex");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // It fits from the start: Tab goes from Close straight to Previous page.
    expect(await open(1280, 800), "health: the page fits").toBe(0);
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("button", { name: /previous page/i }),
    ).toBeFocused();
  });
});
