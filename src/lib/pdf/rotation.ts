import type { Rotation } from "./types";

/**
 * Snap any angle to the nearest valid PDF rotation (0 | 90 | 180 | 270).
 *
 * Its own module (re-exported by `./engine`) because the pdf.js loader needs
 * it, and importing it from `./engine` put the page-assembly engine in the
 * first load of every page that reads text or renders a page.
 *
 * A non-finite angle maps to 0, so a NaN can never reach pdf-lib's
 * `degrees()` (which throws a raw TypeError). The engines that take a plan
 * refuse one first (`refuseNonFiniteRotations` in `./engine`); this is the floor under them.
 */
export function normalizeAngle(angle: number): Rotation {
  if (!Number.isFinite(angle)) return 0;
  const snapped = (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
  return snapped as Rotation;
}

/**
 * A page's `/Rotate` as a viewer applies it: a multiple of 90 normalized into
 * [0, 360); anything else is ignored (treated as 0), which is what pdf.js
 * (`Page.rotate`) and Acrobat do. Read a page's STORED rotation through this,
 * not {@link normalizeAngle}: snapping `/Rotate 45` to 90 showed an upright
 * page sideways, and Rotate PDF then wrote 90 to a page the user never
 * touched (audit #45, measured at a7aa20cf).
 */
export function viewerRotation(angle: number): Rotation {
  if (!Number.isFinite(angle) || angle % 90 !== 0) return 0;
  return (((angle % 360) + 360) % 360) as Rotation;
}
