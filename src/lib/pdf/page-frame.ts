import type { PDFPage } from "pdf-lib";
import { normalizeRotation } from "./stamp";

/**
 * The page a READER sees, and the way back from it to pdf-lib's draw space.
 *
 * pdf-lib draws in a page's unrotated media-box space. A viewer shows the crop
 * box (clipped to the media box) turned clockwise by the page's `/Rotate`. Any
 * tool that takes coordinates "from the bottom-left corner of the page" is
 * talking about the second frame, and must map through here before drawing or
 * placing anything — otherwise every page the site's own Rotate or Crop tool has
 * touched puts the user's work somewhere else.
 *
 * One home for the mapping so the tools that take displayed coordinates
 * (annotate, create-forms) cannot drift apart. `placeStamp` in stamp.ts is the
 * same transform expressed for an aligned anchor.
 */

/**
 * Where a page's visible area sits in pdf-lib's unrotated draw space, and how a
 * viewer turns it: the crop box (clipped to the media box, as viewers do) plus
 * the page's `/Rotate` snapped to a quarter turn.
 */
export interface PageFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
}

/** The size a reader sees: a quarter-turned page swaps its width and height. */
export function displayedSize(frame: PageFrame): {
  width: number;
  height: number;
} {
  return frame.rotation === 90 || frame.rotation === 270
    ? { width: frame.height, height: frame.width }
    : { width: frame.width, height: frame.height };
}

/**
 * Map a point typed in the DISPLAYED frame (points from the visible page's
 * bottom-left) into pdf-lib's unrotated draw space. `/Rotate` turns the page
 * clockwise for display, so this is the inverse turn — the transform
 * `placeStamp` uses — offset by the visible box's origin.
 */
export function toContentSpace(
  point: { x: number; y: number },
  frame: PageFrame,
): { x: number; y: number } {
  const { x: ox, y: oy, width: w, height: h } = frame;
  const { x: vx, y: vy } = point;
  switch (frame.rotation) {
    case 90:
      return { x: ox + w - vy, y: oy + vx };
    case 180:
      return { x: ox + w - vx, y: oy + h - vy };
    case 270:
      return { x: ox + vy, y: oy + h - vx };
    default:
      return { x: ox + vx, y: oy + vy };
  }
}

interface Corners {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function corners(box: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Corners {
  return {
    x0: Math.min(box.x, box.x + box.width),
    y0: Math.min(box.y, box.y + box.height),
    x1: Math.max(box.x, box.x + box.width),
    y1: Math.max(box.y, box.y + box.height),
  };
}

/** Read a page's visible frame from pdf-lib. */
export function pageFrame(page: PDFPage): PageFrame {
  const media = corners(page.getMediaBox());
  const crop = corners(page.getCropBox());
  // Viewers show the crop box clipped to the media box; a crop box that does
  // not overlap it at all is ignored in favour of the media box.
  const clipped: Corners = {
    x0: Math.max(media.x0, crop.x0),
    y0: Math.max(media.y0, crop.y0),
    x1: Math.min(media.x1, crop.x1),
    y1: Math.min(media.y1, crop.y1),
  };
  const box =
    clipped.x1 > clipped.x0 && clipped.y1 > clipped.y0 ? clipped : media;
  return {
    x: box.x0,
    y: box.y0,
    width: box.x1 - box.x0,
    height: box.y1 - box.y0,
    rotation: normalizeRotation(page.getRotation().angle),
  };
}
