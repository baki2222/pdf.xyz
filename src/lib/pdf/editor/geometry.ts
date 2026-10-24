import { viewToContent, type PageBox, type PageRotation } from "../page-frame";
import type { Rect } from "./model";

/**
 * The three frames an editor object passes through, and the only maps between
 * them:
 *
 *   SCREEN  CSS pixels inside a page's overlay, top-left origin, y down.
 *           The pdf.js canvas under it is drawn at the same scale.
 *     ↕  × / ÷ `scale` (CSS px per point = zoom × {@link CSS_PX_PER_PT})
 *   VIEWER  points, top-left of the page AS DISPLAYED (CropBox ∩ MediaBox,
 *           after `/Rotate`), y down — where every object is stored.
 *     ↕  y-flip, then `viewToContent` (the one mapping every placing tool shares)
 *   CONTENT pdf-lib's unrotated user space, origin MediaBox bottom-left, y up.
 *
 * `geometry.test.ts` holds the composed chain SCREEN → CONTENT to
 * pdf.js's own `viewport.convertToPdfPoint` on real rotated and cropped pages:
 * an oracle that shares none of this code.
 */

/** 100% zoom shows a page at its physical size on a 96-dpi screen. */
export const CSS_PX_PER_PT = 96 / 72;

/** The range a person zooms in (buttons, menu, Ctrl+wheel, pinch). */
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 4;
/**
 * Fit width may go below {@link MIN_ZOOM}: a Letter page on a 360 px phone
 * fits at about 34%, and holding it at 50% would put half the page off
 * screen at the zoom that is supposed to show all of its width.
 */
export const MIN_FIT_ZOOM = 0.1;

export function clampZoom(zoom: number, min = MIN_ZOOM): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(min, zoom));
}

/** CSS pixels per point at a zoom level (a fit zoom included). */
export function scaleForZoom(zoom: number): number {
  return clampZoom(zoom, MIN_FIT_ZOOM) * CSS_PX_PER_PT;
}

/** The zoom that fits `pageWidth` points into `available` CSS pixels. */
export function fitWidthZoom(available: number, pageWidth: number): number {
  if (!(available > 0) || !(pageWidth > 0)) return 1;
  return clampZoom(available / (pageWidth * CSS_PX_PER_PT), MIN_FIT_ZOOM);
}

/**
 * The width "fit width" fits: the median page width, so one landscape page
 * in a portrait document does not shrink every other page to fit it (that
 * page scrolls sideways instead).
 */
export function typicalPageWidth(widths: readonly number[]): number {
  if (widths.length === 0) return 0;
  const sorted = [...widths].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

/** Screen (overlay CSS px) → viewer points. */
export function screenToViewer(
  px: number,
  py: number,
  scale: number,
): { x: number; y: number } {
  return { x: px / scale, y: py / scale };
}

/** Viewer points → screen (overlay CSS px). */
export function viewerToScreen(
  x: number,
  y: number,
  scale: number,
): { x: number; y: number } {
  return { x: x * scale, y: y * scale };
}

/** What the export needs to know about a page: its frame, as pdf-lib reads it. */
export interface ExportFrame {
  box: PageBox;
  rotation: PageRotation;
  /** Displayed width / height in points (after `/Rotate`). */
  width: number;
  height: number;
}

/** A viewer point (top-left origin, y down) → content space. */
export function viewerToContent(
  x: number,
  y: number,
  frame: ExportFrame,
): { x: number; y: number } {
  return viewToContent(x, frame.height - y, frame.box, frame.rotation);
}

/**
 * Where pdf-lib must anchor a viewer rect drawn with
 * `rotate: degrees(frame.rotation)`: the content-space image of the rect's
 * VISUAL bottom-left corner. Width then runs along the viewer's +x and height
 * along its +y (up), exactly as `edit.ts` places its boxes.
 */
export function rectAnchor(
  rect: Rect,
  frame: ExportFrame,
): { x: number; y: number } {
  return viewerToContent(rect.x, rect.y + rect.height, frame);
}

/** A content-space point → viewer points (top-left origin, y down). */
export function contentToViewer(
  x: number,
  y: number,
  frame: ExportFrame,
): { x: number; y: number } {
  const { box } = frame;
  let vx: number;
  let vy: number;
  switch (frame.rotation) {
    case 90:
      vx = y - box.y;
      vy = box.x + box.width - x;
      break;
    case 180:
      vx = box.x + box.width - x;
      vy = box.y + box.height - y;
      break;
    case 270:
      vx = box.y + box.height - y;
      vy = x - box.x;
      break;
    default:
      vx = x - box.x;
      vy = y - box.y;
  }
  return { x: vx, y: frame.height - vy };
}

/** A viewer rect → the content-space box it covers. */
export function viewerRectToContent(
  rect: Rect,
  frame: ExportFrame,
): { x0: number; y0: number; x1: number; y1: number } {
  const pts = [
    viewerToContent(rect.x, rect.y, frame),
    viewerToContent(rect.x + rect.width, rect.y, frame),
    viewerToContent(rect.x, rect.y + rect.height, frame),
    viewerToContent(rect.x + rect.width, rect.y + rect.height, frame),
  ];
  return {
    x0: Math.min(...pts.map((p) => p.x)),
    y0: Math.min(...pts.map((p) => p.y)),
    x1: Math.max(...pts.map((p) => p.x)),
    y1: Math.max(...pts.map((p) => p.y)),
  };
}

/** A guide line drawn while snapping: vertical at `x`, or horizontal at `y`. */
export type SnapGuide = { axis: "x"; at: number } | { axis: "y"; at: number };

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

/**
 * Snap a moving rect's edges and centre to the page's edges and centre lines.
 * Returns the correction to add and the guides to show. `threshold` is in
 * points (callers pass a screen distance ÷ scale, so it feels the same at
 * every zoom).
 */
export function snapRect(
  rect: Rect,
  pageWidth: number,
  pageHeight: number,
  threshold: number,
): SnapResult {
  const pick = (
    edges: number[],
    targets: number[],
  ): { delta: number; at: number } | null => {
    let best: { delta: number; at: number } | null = null;
    for (const edge of edges) {
      for (const target of targets) {
        const delta = target - edge;
        if (
          Math.abs(delta) <= threshold &&
          (!best || Math.abs(delta) < Math.abs(best.delta))
        ) {
          best = { delta, at: target };
        }
      }
    }
    return best;
  };
  const sx = pick(
    [rect.x, rect.x + rect.width / 2, rect.x + rect.width],
    [0, pageWidth / 2, pageWidth],
  );
  const sy = pick(
    [rect.y, rect.y + rect.height / 2, rect.y + rect.height],
    [0, pageHeight / 2, pageHeight],
  );
  const guides: SnapGuide[] = [];
  if (sx) guides.push({ axis: "x", at: sx.at });
  if (sy) guides.push({ axis: "y", at: sy.at });
  return { dx: sx?.delta ?? 0, dy: sy?.delta ?? 0, guides };
}

/** Keep a rect's top-left inside the page (a moved object may not leave it). */
export function clampRectToPage(
  rect: Rect,
  pageWidth: number,
  pageHeight: number,
): { dx: number; dy: number } {
  const maxX = Math.max(0, pageWidth - rect.width);
  const maxY = Math.max(0, pageHeight - rect.height);
  const x = Math.min(maxX, Math.max(0, rect.x));
  const y = Math.min(maxY, Math.max(0, rect.y));
  return { dx: x - rect.x, dy: y - rect.y };
}
