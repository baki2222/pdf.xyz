/**
 * The page as a READER sees it, and the way back to the space pdf-lib draws in.
 *
 * pdf-lib draws in a page's unrotated content space: origin at the MediaBox's
 * bottom-left, y up. A viewer shows something else — only the CropBox (which
 * falls back to the MediaBox), turned clockwise by the page's `/Rotate`. Our own
 * Crop PDF and Rotate PDF write exactly those two entries, so a tool that takes
 * coordinates from a person has to take them in the viewer's frame and map them
 * here, or its output lands sideways or outside the visible page.
 *
 * Pure numbers only — no pdf-lib import — so every tool that places content can
 * share one definition without pulling another tool's code into its chunk.
 */

/** Snap any angle to the nearest 0/90/180/270, normalized to [0, 360). */
export function normalizeRotation(angle: number): 0 | 90 | 180 | 270 {
  const snapped = (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
  return snapped as 0 | 90 | 180 | 270;
}

/** A page box (MediaBox/CropBox) in unrotated content space. */
export interface PageBox {
  /** Lower-left corner — NOT necessarily 0,0 (a cropped page's rarely is). */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Map a point in the VIEWER's frame — points from the bottom-left corner of the
 * page as a reader sees it, i.e. `box` shown after the page's clockwise
 * `/Rotate` — into the unrotated content space pdf-lib draws in.
 *
 * `box` is the visible box in content space; its origin is added AFTER the
 * rotation, so a cropped page's bottom-left is its crop corner and not the
 * uncropped sheet's.
 *
 * Content drawn at the mapped point with pdf-lib's `rotate: degrees(rotation)`
 * (counter-clockwise) reads upright to the viewer, because it cancels the
 * page's clockwise display rotation; its local +x then runs along the viewer's
 * +x and its local +y along the viewer's +y.
 */
export function viewToContent(
  vx: number,
  vy: number,
  box: PageBox,
  rotation: number,
): { x: number; y: number } {
  const w = box.width;
  const h = box.height;
  switch (normalizeRotation(rotation)) {
    case 90:
      return { x: box.x + w - vy, y: box.y + vx };
    case 180:
      return { x: box.x + w - vx, y: box.y + h - vy };
    case 270:
      return { x: box.x + vy, y: box.y + h - vx };
    default:
      return { x: box.x + vx, y: box.y + vy };
  }
}

/**
 * A page's displayed size, accounting for its rotation: a page rotated 90°/270°
 * presents its box's height as its width and vice-versa. This is the space a
 * viewer-frame coordinate (a redaction rectangle, an edit's anchor) lives in.
 */
export function displayedPageSize(
  width: number,
  height: number,
  rotationDegrees = 0,
): { width: number; height: number } {
  const angle = ((Math.round(rotationDegrees) % 360) + 360) % 360;
  return angle === 90 || angle === 270
    ? { width: height, height: width }
    : { width, height };
}
