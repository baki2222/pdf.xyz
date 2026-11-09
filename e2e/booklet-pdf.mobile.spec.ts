import { expect, test } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import {
  BOOKLET_BINDINGS,
  BOOKLET_FLIPS,
  BOOKLET_SHEETS,
} from "../src/lib/pdf/booklet";
import { N_UP_MARGINS } from "../src/lib/pdf/n-up";
import { fileInput, makePdfBytes, waitForHydration } from "./helpers";

/**
 * PDF Booklet Maker on a phone (375 px wide): with a PDF open, every control
 * the editor draws — each option chip, the back-cover checkbox's row and the
 * run button — is at least 44 px tall (chips 44 px each way), and nothing
 * reaches past the screen's edge. Measured in a real browser, on the served
 * build, with the back cover OFF (4 pages: nothing to move, a one-line hint)
 * and on offer (6 pages).
 *
 * WAS chips only (`button[aria-pressed]`): the checkbox, the one control
 * this tool gave a new state, measured 293 x 38 at 375 px with 4 pages and
 * looked the same off as on (review, 2026-11-10).
 */

const SCREEN = 375;
const MIN = 44;

test.use({ viewport: { width: SCREEN, height: 812 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

/** The option chips the editor draws, derived from the tables it maps. */
const CHIPS =
  BOOKLET_SHEETS.length +
  BOOKLET_BINDINGS.length +
  BOOKLET_FLIPS.length +
  N_UP_MARGINS.length;

for (const pages of [4, 6]) {
  test(`the booklet editor's controls are thumb-sized and nothing overflows at 375 px (${pages} pages)`, async ({
    page,
  }) => {
    await page.goto("/tools/booklet-pdf");
    const input = fileInput(page);
    await waitForHydration(input);
    await input.setInputFiles({
      name: "zine.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await makePdfBytes("zine", pages)),
    });
    const editor = page.locator('[data-single-pdf-runner="loaded"]');
    await expect(
      editor.getByRole("button", { name: /^create booklet$/i }),
    ).toBeVisible();

    const measured = await page.evaluate(
      ({ min, width }) => {
        const shown = (el: Element) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const label = (el: Element) =>
          (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
        const chips = [
          ...document.querySelectorAll(
            '[data-single-pdf-runner="loaded"] button[aria-pressed]',
          ),
        ].filter(shown);
        const rows = [
          ...document.querySelectorAll(
            '[data-single-pdf-runner="loaded"] label:has(input[type="checkbox"])',
          ),
          ...document.querySelectorAll(
            '[data-single-pdf-runner="loaded"] button:not([aria-pressed])',
          ),
        ].filter(shown);
        const size = (el: Element) => {
          const r = el.getBoundingClientRect();
          return `${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`;
        };
        const small = [
          ...chips.filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width < min - 0.5 || r.height < min - 0.5;
          }),
          ...rows.filter((el) => el.getBoundingClientRect().height < min - 0.5),
        ].map(size);
        const box = document.querySelector<HTMLInputElement>(
          '[data-single-pdf-runner="loaded"] label:has(input[type="checkbox"]) input',
        );
        const look = box
          ? {
              opacity: getComputedStyle(box).opacity,
              color: getComputedStyle(box.closest("label")!).color,
            }
          : null;
        const overflow: string[] = [];
        for (const el of document.querySelectorAll("body *")) {
          if (!shown(el) || getComputedStyle(el).position === "fixed") continue;
          const r = el.getBoundingClientRect();
          if (r.right > width + 1 || r.left < -1)
            overflow.push(`${el.tagName.toLowerCase()} "${label(el)}"`);
        }
        return {
          chips: chips.length,
          rows: rows.map(size),
          look,
          small,
          overflow,
          scrollWidth: document.documentElement.scrollWidth,
        };
      },
      { min: MIN, width: SCREEN },
    );
    // Health: the measurement saw every chip the editor draws, the checkbox
    // row and the run button.
    expect(measured.chips).toBe(CHIPS);
    expect(measured.rows.some((r) => r.startsWith("Keep the last page"))).toBe(
      true,
    );
    expect(measured.rows.some((r) => /^Create booklet/i.test(r))).toBe(true);
    // Off is seen, not only announced: 4 pages leave nothing to move.
    expect(measured.look).not.toBeNull();
    expect(Number(measured.look!.opacity) < 1).toBe(pages % 4 === 0);
    expect(measured.small, "tap targets under 44 px").toEqual([]);
    expect(measured.overflow, "elements past the 375 px screen").toEqual([]);
    expect(measured.scrollWidth).toBeLessThanOrEqual(SCREEN);

    // Control for the overflow predicate: a 400 px box must be caught.
    const caught = await page.evaluate((width) => {
      const box = document.createElement("div");
      box.style.width = `${width + 25}px`;
      box.style.height = "10px";
      document.body.appendChild(box);
      const r = box.getBoundingClientRect();
      box.remove();
      return r.right > width + 1;
    }, SCREEN);
    expect(caught).toBe(true);
  });
}
