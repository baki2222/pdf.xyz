/**
 * A quarter turn chosen per image on JPG / PNG to PDF (audit png-to-pdf#2,
 * 2026-11-08): the card's Rotate button turns a sideways screenshot or a
 * phone scan before it is placed, instead of sending the user to Rotate PDF
 * afterwards.
 *
 * A LEAF, in its own module: only the image runner and `image-to-pdf.ts`
 * import it, so no other page pays for it.
 *
 * The turn is applied when the image is DRAWN, never to its pixels: the
 * JPEG's DCT data and the PNG's rows are embedded exactly as without it. It
 * comes on top of a turn the file itself asks for (a JPEG's EXIF Orientation,
 * a TIFF page's tag), which is applied first: the user turns what they SEE.
 */

/** Clockwise, in degrees. */
export type ImageQuarterTurn = 0 | 90 | 180 | 270;

export const IMAGE_ROTATION_LABELS = {
  /** The card button's visible tooltip and the copy's name for it. */
  button: "Rotate",
  /**
   * The accessible name, completed with the file's name and, once turned,
   * the angle it is at now, so a screen reader hears each press.
   */
  aria: (name: string, turn: number = 0) =>
    `Rotate ${name} a quarter turn clockwise${turn ? `, now ${turn}°` : ""}`,
} as const;

/** The turn after one more press: 0 → 90 → 180 → 270 → 0. */
export function nextQuarterTurn(turn: ImageQuarterTurn): ImageQuarterTurn {
  return ((turn + 90) % 360) as ImageQuarterTurn;
}

/** Whether a turn swaps the image's width and height. */
export const turnsSideways = (turn: ImageQuarterTurn | undefined): boolean =>
  turn === 90 || turn === 270;

/** The shape the reader sees after `turn`: the box the page is laid out for. */
export function turnedShape(
  shown: { width: number; height: number },
  turn: ImageQuarterTurn | undefined,
): { width: number; height: number } {
  return turnsSideways(turn)
    ? { width: shown.height, height: shown.width }
    : shown;
}

/**
 * Where to draw the UNTURNED image so that, turned `turn` degrees clockwise
 * about its own (x, y) corner — pdf-lib's `rotate`, which is counter-
 * clockwise, given `-turn` — it fills `rect` exactly. `rect` is the laid-out
 * box in the turned shape ({@link turnedShape}).
 */
export function unturnedBox(
  rect: { x: number; y: number; width: number; height: number },
  turn: ImageQuarterTurn,
): { x: number; y: number; width: number; height: number } {
  const { x, y, width: w, height: h } = rect;
  switch (turn) {
    case 90:
      return { x, y: y + h, width: h, height: w };
    case 180:
      return { x: x + w, y: y + h, width: w, height: h };
    case 270:
      return { x: x + w, y, width: h, height: w };
    default:
      return rect;
  }
}
