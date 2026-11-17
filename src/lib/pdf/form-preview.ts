import type { FieldBox } from "./field-boxes";

/**
 * The geometry of Create Fillable Forms' page preview (backlog #17,
 * 2026-11-17), as pure numbers so it is unit-tested without a browser.
 *
 * The preview works in the SAME unit as the card and the engine: points from
 * the bottom-left corner of the page as it is displayed (the CropBox, turned
 * by `/Rotate` — `page-frame.ts`, which `readFormContext` reads every page's
 * size through). The page picture is rendered in that orientation
 * (`usePageImageState`, orientation "displayed"), so a box is drawn at
 * `left: x / W`, `bottom: y / H` of the sheet with no turning of its own, and
 * a click or a drag is turned back into whole points the card shows and the
 * engine is handed. Nothing here maps into content space; the engine does
 * that, once, for whatever the card says.
 */

/** A page's displayed size, in points. */
export interface SheetSize {
  width: number;
  height: number;
}

/** A box as shares of the sheet, from its bottom-left: what the preview draws. */
export interface SheetBox {
  left: number;
  bottom: number;
  width: number;
  height: number;
}

/** A box in points, as shares of a page of `size` — drawn with `left`/`bottom` percentages. */
export function boxOnSheet(box: FieldBox, size: SheetSize): SheetBox {
  return {
    left: box.x / size.width,
    bottom: box.y / size.height,
    width: box.width / size.width,
    height: box.height / size.height,
  };
}

/** The smallest box holding every box (a radio group's whole stack). */
export function unionOf(boxes: readonly FieldBox[]): FieldBox | null {
  if (boxes.length === 0) return null;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * A point on the sheet as it is drawn (CSS px from its top-left, the sheet
 * `rect` px wide and high) in points from the page's bottom-left.
 */
export function sheetPoint(
  px: number,
  py: number,
  rect: { width: number; height: number },
  size: SheetSize,
): { x: number; y: number } {
  return {
    x: (px / rect.width) * size.width,
    y: (1 - py / rect.height) * size.height,
  };
}

/**
 * The X and Y a field gets when its lower-left corner is asked to go to
 * `to`: whole points (the card's NumberField keeps whole points too), moved
 * only as far as keeps every one of its boxes on the page — so a radio stack
 * is held up by its lowest button, not its first. `anchor` is the field's
 * current X/Y and `boxes` its boxes there (`fieldBoxes`), which fixes where
 * each box sits relative to X/Y. A field larger than the page sits at the
 * lowest X/Y that keeps it from running off the left and bottom; never
 * below 0, as the card refuses one.
 */
export function placeAt(
  to: { x: number; y: number },
  anchor: { x: number; y: number },
  boxes: readonly FieldBox[],
  size: SheetSize,
): { x: number; y: number } {
  const u = unionOf(boxes) ?? { ...anchor, width: 0, height: 0 };
  const left = u.x - anchor.x;
  const right = u.x + u.width - anchor.x;
  const below = u.y - anchor.y;
  const above = u.y + u.height - anchor.y;
  const clamp = (v: number, lo: number, hi: number) =>
    Math.max(0, Math.max(lo, Math.min(hi, v)));
  return {
    x: clamp(
      Math.round(to.x),
      Math.ceil(-left),
      Math.floor(size.width - right),
    ),
    y: clamp(
      Math.round(to.y),
      Math.ceil(-below),
      Math.floor(size.height - above),
    ),
  };
}
