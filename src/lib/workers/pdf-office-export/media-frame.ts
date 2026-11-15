/** Boxes between the page reader's frame and poppler's (`mediaFrame`). */

type Box = readonly [number, number, number, number];

/**
 * `box` through the affine map `m`, as an axis-aligned box: from the page
 * reader's frame (the page as displayed) into poppler's (`mediaFrame`).
 * PDF to Word maps each picture (`./docx-layout`) and each run
 * (`./docx-run-style`) through it.
 */
export function mapBox(m: readonly number[] | undefined, box: Box): Box {
  if (!m) return box;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of [
    [box[0], box[1]],
    [box[2], box[1]],
    [box[0], box[3]],
    [box[2], box[3]],
  ] as const) {
    const px = m[0]! * x + m[2]! * y + m[4]!;
    const py = m[1]! * x + m[3]! * y + m[5]!;
    if (px < x0) x0 = px;
    if (py < y0) y0 = py;
    if (px > x1) x1 = px;
    if (py > y1) y1 = py;
  }
  return [x0, y0, x1, y1];
}
