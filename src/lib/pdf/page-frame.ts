import type { PDFPage } from "pdf-lib";
import { normalizeAngle } from "./engine";
import { loadPdfLib } from "./pdf-lib";

/**
 * The page AS A READER SEES IT, and the mapping from that frame back into the
 * content space pdf-lib draws in.
 *
 * pdf-lib places annotations in the page's unrotated user space. A viewer shows
 * something else: only the CropBox (which may start anywhere, not at 0,0), turned
 * clockwise by the page's `/Rotate`. A box placed with raw `x, y` against
 * `page.getSize()` is therefore right only on an unrotated page whose boxes start
 * at the origin — on a `/Rotate 90` scan it lands on what the reader sees as a
 * side edge, drawn sideways, and on a page with an offset CropBox it can land off
 * the visible page entirely.
 *
 * Everything a caller positions for a READER — "the bottom of the page", "8% in
 * from the left" — belongs in the visible frame. {@link visiblePageFrame} reads
 * that frame from a page, and {@link placeVisibleRect} turns a rectangle in it
 * into the anchor + rotation pdf-lib's widget API expects. Both are pure (no
 * pdf-lib values at module top) so the math is unit-tested with plain numbers,
 * and the consumer-side proof — pdfjs reading the saved file — lives in the
 * request-signatures integration test.
 */

export type PageRotation = 0 | 90 | 180 | 270;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisiblePageFrame {
  /** Visible width in points, as displayed (after `/Rotate`). */
  width: number;
  /** Visible height in points, as displayed (after `/Rotate`). */
  height: number;
  /** The page's `/Rotate`, normalized to 0/90/180/270 (clockwise, as the spec defines it). */
  rotation: PageRotation;
  /**
   * The visible region in UNROTATED content space: the CropBox clipped to the
   * MediaBox (the spec's effective crop), whose origin need not be 0,0.
   */
  box: Box;
}

/** Intersect two boxes; falls back to `b` when they do not overlap (a malformed CropBox). */
function intersect(a: Box, b: Box): Box {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  if (x1 <= x0 || y1 <= y0) return b;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Normalize a box that a PDF may write with negative width/height. */
function normalizeBox(b: Box): Box {
  const x = Math.min(b.x, b.x + b.width);
  const y = Math.min(b.y, b.y + b.height);
  return { x, y, width: Math.abs(b.width), height: Math.abs(b.height) };
}

/** Build a frame from the raw page boxes and `/Rotate`. Pure — shared by the reader below and tests. */
export function frameFromBoxes(
  mediaBox: Box,
  cropBox: Box,
  rotateDegrees: number,
): VisiblePageFrame {
  const box = intersect(normalizeBox(cropBox), normalizeBox(mediaBox));
  const rotation = normalizeAngle(rotateDegrees);
  const swap = rotation === 90 || rotation === 270;
  return {
    width: swap ? box.height : box.width,
    height: swap ? box.width : box.height,
    rotation,
    box,
  };
}

/** Read a page's visible frame. */
export function visiblePageFrame(page: PDFPage): VisiblePageFrame {
  return frameFromBoxes(
    page.getMediaBox(),
    page.getCropBox(),
    page.getRotation().angle,
  );
}

/**
 * Where to hand a visible-frame rectangle to pdf-lib's `addToPage`.
 *
 * pdf-lib's `rotateRectangle` pivots a rotated widget on the `x, y` it is given,
 * so the anchor is NOT the content-space lower-left for 90/180/270 — it is the
 * content-space image of the visible rectangle's lower-left corner. `rotate`
 * equals the page's `/Rotate`: an annotation's `/MK /R` turns it counter-
 * clockwise, cancelling the page's clockwise display turn so the field reads
 * upright.
 */
export interface WidgetPlacement {
  x: number;
  y: number;
  /** Visible width — pass as-is; pdf-lib swaps it into content space itself. */
  width: number;
  /** Visible height — pass as-is. */
  height: number;
  rotate: PageRotation;
}

export function placeVisibleRect(
  frame: VisiblePageFrame,
  rect: Box,
): WidgetPlacement {
  const { x: ox, y: oy, width: w, height: h } = frame.box;
  const { x: vx, y: vy, width, height } = rect;
  const rotate = frame.rotation;
  switch (rotate) {
    case 90:
      return { x: ox + w - vy, y: oy + vx, width, height, rotate };
    case 180:
      return { x: ox + w - vx, y: oy + h - vy, width, height, rotate };
    case 270:
      return { x: ox + vy, y: oy + h - vx, width, height, rotate };
    default:
      return { x: ox + vx, y: oy + vy, width, height, rotate };
  }
}

/** What a browser learns about a picked PDF before it is sent anywhere. */
export interface PdfFrames {
  /** One visible frame per page, in page order. */
  frames: VisiblePageFrame[];
  /** The trailer names an encryption dictionary — the worker will refuse it. */
  encrypted: boolean;
}

/**
 * Read every page's visible frame from PDF bytes, client- or server-side.
 * Encrypted documents still expose their page tree, so `ignoreEncryption` is on
 * and the lock is REPORTED rather than collapsed into "unreadable". Returns
 * `null` for bytes that are not a readable PDF. Never throws.
 */
export async function readPdfFrames(
  bytes: Uint8Array,
): Promise<PdfFrames | null> {
  try {
    const { PDFDocument } = await loadPdfLib();
    const doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    const frames = doc.getPages().map(visiblePageFrame);
    if (frames.length === 0) return null;
    return { frames, encrypted: doc.isEncrypted };
  } catch {
    return null;
  }
}
