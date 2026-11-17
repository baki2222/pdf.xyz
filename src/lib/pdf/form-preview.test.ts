// @vitest-environment node
/**
 * The page preview's geometry (backlog #17): a box drawn from the card's
 * numbers, and a pointer turned back into the numbers the card shows.
 *
 * The properties, each with a control that fails without it:
 *  - a box is drawn at x / W, y / H of the sheet, from its bottom-left;
 *  - a point read off the sheet and drawn again lands where it was read;
 *  - `placeAt` gives whole points and keeps EVERY box on the page — a radio
 *    stack is held up by its lowest button, which a check of the first box
 *    alone would miss;
 *  - asked for a spot already on the page, `placeAt` moves the field there
 *    exactly (rounded), so a click is not quietly re-aimed.
 */
import { describe, expect, it } from "vitest";
import { fieldBoxes, RADIO_STACK_GAP } from "./field-boxes";
import { boxOnSheet, placeAt, sheetPoint, unionOf } from "./form-preview";

const LETTER = { width: 612, height: 792 };
const TURNED = { width: 792, height: 612 };

const radio = (x: number, y: number, n = 3) => ({
  type: "radio",
  x,
  y,
  width: 14,
  height: 14,
  options: Array.from({ length: n }, (_, i) => `o${i}`),
});

const onPage = (
  boxes: { x: number; y: number; width: number; height: number }[],
  size: { width: number; height: number },
) =>
  boxes.every(
    (b) =>
      b.x >= 0 &&
      b.y >= 0 &&
      b.x + b.width <= size.width &&
      b.y + b.height <= size.height,
  );

describe("the preview draws a box where its numbers put it", () => {
  it("as shares of the displayed page, from its bottom-left", () => {
    expect(
      boxOnSheet({ x: 72, y: 700, width: 200, height: 24 }, LETTER),
    ).toEqual({
      left: 72 / 612,
      bottom: 700 / 792,
      width: 200 / 612,
      height: 24 / 792,
    });
    // A quarter-turned page is drawn on its DISPLAYED size: the same box is a
    // different share of it. A preview that used the stored size would pass
    // the line above and fail this one.
    const turned = boxOnSheet(
      { x: 72, y: 500, width: 200, height: 24 },
      TURNED,
    );
    expect(turned.left).toBeCloseTo(72 / 792, 12);
    expect(turned.bottom).toBeCloseTo(500 / 612, 12);
  });

  it("a radio group is its whole downward stack, from the engine's own fieldBoxes", () => {
    const boxes = fieldBoxes(radio(100, 400));
    expect(boxes.map((b) => b.y)).toEqual([
      400,
      400 - (14 + RADIO_STACK_GAP),
      400 - 2 * (14 + RADIO_STACK_GAP),
    ]);
    expect(unionOf(boxes)).toEqual({
      x: 100,
      y: 400 - 2 * (14 + RADIO_STACK_GAP),
      width: 14,
      height: 14 + 2 * (14 + RADIO_STACK_GAP),
    });
    expect(unionOf([])).toBeNull();
  });

  it("a point read off the sheet is drawn again where it was read", () => {
    const rect = { width: 420, height: 420 * (792 / 612) };
    for (const [px, py] of [
      [0, 0],
      [210, 100],
      [419, rect.height - 1],
    ] as const) {
      const p = sheetPoint(px, py, rect, LETTER);
      const s = boxOnSheet({ ...p, width: 0, height: 0 }, LETTER);
      expect(s.left * rect.width).toBeCloseTo(px, 9);
      expect((1 - s.bottom) * rect.height).toBeCloseTo(py, 9);
    }
    // Control: the top of the sheet is the TOP of the page, not y = 0.
    expect(sheetPoint(0, 0, rect, LETTER).y).toBe(792);
  });
});

describe("placeAt turns a pointer into the card's numbers", () => {
  it("a spot on the page is taken exactly, in whole points", () => {
    const text = { type: "text", x: 72, y: 700, width: 200, height: 24 };
    expect(
      placeAt({ x: 100.4, y: 300.6 }, text, fieldBoxes(text), LETTER),
    ).toEqual({ x: 100, y: 301 });
  });

  it("never lets a box run off the page, a radio stack's lowest button included", () => {
    const text = { type: "text", x: 72, y: 700, width: 200, height: 24 };
    expect(placeAt({ x: 600, y: 790 }, text, fieldBoxes(text), LETTER)).toEqual(
      {
        x: 612 - 200,
        y: 792 - 24,
      },
    );
    expect(placeAt({ x: -40, y: -5 }, text, fieldBoxes(text), LETTER)).toEqual({
      x: 0,
      y: 0,
    });
    const r = radio(100, 400);
    const at = placeAt({ x: 50, y: 3 }, r, fieldBoxes(r), LETTER);
    // The first button's y could be 3; the third's would then be -37.
    expect(at.y).toBe(2 * (14 + RADIO_STACK_GAP));
    expect(onPage(fieldBoxes({ ...r, ...at }), LETTER)).toBe(true);
    // Control: the same ask without the clamp runs off the page.
    expect(onPage(fieldBoxes({ ...r, x: 50, y: 3 }), LETTER)).toBe(false);
  });

  it("over every spot of a grid, on two page shapes, each result is on the page", () => {
    let checked = 0;
    for (const size of [LETTER, TURNED, { width: 300.5, height: 200.25 }]) {
      for (const spec of [
        { type: "text", x: 0, y: 0, width: 120, height: 30 },
        radio(10, 100, 4),
      ]) {
        for (let gx = -50; gx <= size.width + 50; gx += 37)
          for (let gy = -50; gy <= size.height + 50; gy += 41) {
            const at = placeAt({ x: gx, y: gy }, spec, fieldBoxes(spec), size);
            expect(Number.isInteger(at.x) && Number.isInteger(at.y)).toBe(true);
            expect(onPage(fieldBoxes({ ...spec, ...at }), size)).toBe(true);
            checked += 1;
          }
      }
    }
    // Health: the grid really ran (a vacuous loop passes everything).
    expect(checked).toBeGreaterThan(400);
  });

  it("a field larger than the page sits at the lowest numbers the card accepts", () => {
    const big = { type: "text", x: 0, y: 0, width: 900, height: 900 };
    expect(placeAt({ x: 300, y: 300 }, big, fieldBoxes(big), LETTER)).toEqual({
      x: 0,
      y: 0,
    });
  });
});
