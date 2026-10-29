import type { Rotation } from "./types";

/**
 * Snap any angle to the nearest valid PDF rotation (0 | 90 | 180 | 270).
 *
 * Its own module (re-exported by `./engine`) because the pdf.js loader needs
 * it, and importing it from `./engine` put the page-assembly engine in the
 * first load of every page that reads text or renders a page.
 */
export function normalizeAngle(angle: number): Rotation {
  const snapped = (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
  return snapped as Rotation;
}
