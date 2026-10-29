import type { PDFPage } from "pdf-lib";
import { normalizeAngle } from "./rotation";
import { loadPdfLib } from "./pdf-lib";

/**
 * The page AS A READER SEES IT, and the mapping from that frame back into the
 * content space pdf-lib draws in.
 *
 * pdf-lib draws (and places annotations) in the page's unrotated user space:
 * origin at the MediaBox's bottom-left, y up. A viewer shows something else:
 * only the CropBox (which may start anywhere, not at 0,0), turned clockwise by
 * the page's `/Rotate`. A box placed with raw `x, y` against `page.getSize()` is
 * therefore right only on an unrotated page whose boxes start at the origin — on
 * a `/Rotate 90` scan it lands on what the reader sees as a side edge, drawn
 * sideways, and on a page with an offset CropBox it can land off the visible
 * page entirely. Our own Crop PDF and Rotate PDF write exactly those two
 * entries, so every tool that takes a position from a person has to take it in
 * the viewer's frame and map it here.
 *
 * ONE reader and ONE mapping, shared by every tool that places content (Edit,
 * Sign, Annotate, Create forms, stamps — header/footer, page numbers,
 * watermark — Crop, Request signatures), so they cannot disagree about what
 * "the page" is:
 *
 *  - {@link visiblePageFrame} (alias {@link viewerFrame}) reads the frame from a
 *    page; {@link frameFromBoxes} is the same read over plain numbers;
 *    {@link pageFrame} is the same read, flattened for Annotate and Create
 *    forms; {@link visibleBox} is its box alone, for the stamps and the
 *    watermark.
 *  - {@link viewToContent} maps a visible-frame point into content space.
 *    {@link placeVisibleRect} is that mapping expressed as the anchor +
 *    rotation pdf-lib's widget API expects, and {@link toContentSpace} is it
 *    over a flattened frame.
 *
 * The geometry is pure numbers so it is unit-tested without a document
 * (`page-frame.test.ts`, against a rotation-matrix oracle); only
 * {@link readPdfFrames} loads pdf-lib, and it does so through the one dynamic
 * boundary in `./pdf-lib`. The consumer-side proofs — pdfjs reading the saved
 * file — are in `edit-placement.test.ts`, `signature-placement.test.ts`,
 * `annotate.pdfjs.test.ts`, `create-forms.pdfjs.test.ts` and the
 * request-signatures integration test.
 */

export type PageRotation = 0 | 90 | 180 | 270;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A page box (MediaBox/CropBox) in unrotated content space. */
export type PageBox = Box;

/** Snap any angle to the nearest 0/90/180/270, normalized to [0, 360). */
export const normalizeRotation: (angle: number) => PageRotation =
  normalizeAngle;

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

/** The name Edit and Sign read the frame by; the same shape and the same reader. */
export type ViewerFrame = VisiblePageFrame;

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

/** Build a frame from the raw page boxes and `/Rotate`. Pure — shared by the reader below and tests. */
export function frameFromBoxes(
  mediaBox: Box,
  cropBox: Box,
  rotateDegrees: number,
): VisiblePageFrame {
  const box = intersect(normalizeBox(cropBox), normalizeBox(mediaBox));
  const rotation = normalizeRotation(rotateDegrees);
  return {
    ...displayedPageSize(box.width, box.height, rotation),
    rotation,
    box,
  };
}

/** The part of a pdf-lib `PDFPage` a visible frame is read from. */
export type FramedPage = Pick<
  PDFPage,
  "getMediaBox" | "getCropBox" | "getRotation"
>;

/** Read a page's visible frame. */
export function visiblePageFrame(page: FramedPage): VisiblePageFrame {
  return frameFromBoxes(
    page.getMediaBox(),
    page.getCropBox(),
    page.getRotation().angle,
  );
}

/**
 * The part of a page a reader sees, as a box in content space: the `box` of
 * {@link visiblePageFrame}, for callers that need no rotation (stamps
 * centre on it and turn separately; the watermark fits inside it). Takes only
 * the two boxes, so a caller that has no `/Rotate` in hand can still ask.
 */
export function visibleBox(
  page: Pick<FramedPage, "getMediaBox" | "getCropBox">,
): Box {
  return frameFromBoxes(page.getMediaBox(), page.getCropBox(), 0).box;
}

/**
 * One page as the reader sees it — {@link visiblePageFrame} under the name the
 * Edit and Sign tools use. Not a second reader: the same function.
 */
export const viewerFrame: (page: FramedPage) => ViewerFrame = visiblePageFrame;

/**
 * A page's visible frame, flattened: the visible box in unrotated content
 * space (`x, y, width, height` — the box's own, NOT the displayed size) plus
 * the page's normalized `/Rotate`. The shape Annotate and Create forms place
 * with; read by {@link pageFrame}, the same reader as {@link visiblePageFrame}.
 */
export interface PageFrame extends Box {
  rotation: PageRotation;
}

/** Read a page's visible frame, flattened — {@link visiblePageFrame}, reshaped. */
export function pageFrame(page: FramedPage): PageFrame {
  const { box, rotation } = visiblePageFrame(page);
  return { ...box, rotation };
}

/** The size a reader sees of a flattened frame: a quarter turn swaps the axes. */
export function displayedSize(frame: PageFrame): {
  width: number;
  height: number;
} {
  return displayedPageSize(frame.width, frame.height, frame.rotation);
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

/** {@link viewToContent} over a flattened {@link PageFrame}. */
export function toContentSpace(
  point: { x: number; y: number },
  frame: PageFrame,
): { x: number; y: number } {
  return viewToContent(point.x, point.y, frame, frame.rotation);
}

/**
 * Where to hand a visible-frame rectangle to pdf-lib's `addToPage`.
 *
 * pdf-lib's `rotateRectangle` pivots a rotated widget on the `x, y` it is given,
 * so the anchor is NOT the content-space lower-left for 90/180/270 — it is the
 * content-space image of the visible rectangle's lower-left corner
 * ({@link viewToContent}). `rotate` equals the page's `/Rotate`: an annotation's
 * `/MK /R` turns it counter-clockwise, cancelling the page's clockwise display
 * turn so the field reads upright.
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
  const { x, y } = viewToContent(rect.x, rect.y, frame.box, frame.rotation);
  return {
    x,
    y,
    width: rect.width,
    height: rect.height,
    rotate: frame.rotation,
  };
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
