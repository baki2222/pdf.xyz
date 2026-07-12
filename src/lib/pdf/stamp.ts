import { rgb, StandardFonts, type PDFDocument, type PDFFont } from "pdf-lib";
import { loadPdf } from "./engine";

/**
 * Shared, pure primitives for stamping text onto existing PDF pages — used by
 * the page-numbers, watermark, and header/footer tools. Everything here is
 * isomorphic (pdf-lib only, no DOM) and the geometry is expressed as pure
 * functions so it can be unit-tested with plain numbers instead of brittle
 * visual assertions.
 *
 * Coordinate model: pdf-lib draws in the page's *unrotated* media-box space
 * (origin bottom-left, y up). A page may carry a `/Rotate` flag (0/90/180/270,
 * clockwise) that a viewer applies at display time. To make a stamp land where
 * the reader expects — a "bottom-center" footer at the visual bottom, reading
 * horizontally — `placeStamp` computes the anchor in the viewer's frame and
 * maps it back into content space, plus the text rotation that cancels the
 * page's display rotation.
 */

export { loadPdf };

export const STAMP_PRODUCER = "pdf.xyz";

export type HAlign = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";

export type StampPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "middle-center"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

/** Every position, in reading order — handy for building a 3×3 picker. */
export const STAMP_POSITIONS: readonly StampPosition[] = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;

/** Split a compound position into its horizontal and vertical alignment. */
export function resolveAlign(position: StampPosition): { h: HAlign; v: VAlign } {
  const [v, h] = position.split("-") as [VAlign, HAlign];
  return { h, v };
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Default ink for page numbers and headers/footers — a calm dark slate. */
export const INK: RGB = { r: 0.28, g: 0.31, b: 0.38 };

/** Default ink for watermarks — a lighter gray meant to sit behind content. */
export const WATERMARK_INK: RGB = { r: 0.45, g: 0.47, b: 0.53 };

/** Convert our plain RGB (0–1 channels) into a pdf-lib color. */
export function toRgb(color: RGB) {
  return rgb(clamp(color.r, 0, 1), clamp(color.g, 0, 1), clamp(color.b, 0, 1));
}

/** Clamp a number into an inclusive range. */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Snap any angle to the nearest 0/90/180/270, normalized to [0, 360). */
export function normalizeRotation(angle: number): 0 | 90 | 180 | 270 {
  const snapped = (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
  return snapped as 0 | 90 | 180 | 270;
}

const TOKEN_PATTERNS: { re: RegExp; key: "n" | "total" | "date" }[] = [
  { re: /\{n\}/gi, key: "n" },
  { re: /\{page\}/gi, key: "n" },
  { re: /\{total\}/gi, key: "total" },
  { re: /\{pages\}/gi, key: "total" },
  { re: /\{date\}/gi, key: "date" },
];

export interface StampTokens {
  /** Current page number (already offset by any start value). */
  n?: number;
  /** Denominator for "n of total". */
  total?: number;
  /** Pre-formatted date string; the runner supplies the locale value. */
  date?: string;
}

/**
 * Substitute dynamic fields into a template. Supported tokens (case-insensitive):
 * `{n}`/`{page}` → current page, `{total}`/`{pages}` → page count, `{date}`.
 * Unknown braces are left untouched so literal text survives.
 */
export function applyTokens(template: string, tokens: StampTokens): string {
  let out = template;
  for (const { re, key } of TOKEN_PATTERNS) {
    const value = tokens[key];
    const replacement = value === undefined || value === null ? "" : String(value);
    out = out.replace(re, replacement);
  }
  return out;
}

export interface StampPlacement {
  /** Draw x in content space. */
  x: number;
  /** Draw y in content space. */
  y: number;
  /** Text rotation in degrees (counter-clockwise) to hand to pdf-lib. */
  rotate: number;
}

export interface PlaceStampInput {
  /** Unrotated media-box width. */
  pageWidth: number;
  /** Unrotated media-box height. */
  pageHeight: number;
  /** The page's `/Rotate` value in degrees (clockwise). */
  pageRotation: number;
  textWidth: number;
  textHeight: number;
  h: HAlign;
  v: VAlign;
  margin: number;
}

/**
 * Place an aligned stamp so it lands at the requested spot in the *viewer's*
 * frame and reads horizontally, even when the page carries a `/Rotate` flag.
 *
 * Strategy: compute the baseline-left anchor inside the rotated (visible) box,
 * then map that point back into unrotated content space and rotate the glyphs
 * to cancel the page's display rotation.
 */
export function placeStamp(input: PlaceStampInput): StampPlacement {
  const rot = normalizeRotation(input.pageRotation);
  const swap = rot === 90 || rot === 270;
  const visualW = swap ? input.pageHeight : input.pageWidth;
  const visualH = swap ? input.pageWidth : input.pageHeight;

  const vx =
    input.h === "left"
      ? input.margin
      : input.h === "right"
        ? visualW - input.margin - input.textWidth
        : (visualW - input.textWidth) / 2;
  const vy =
    input.v === "bottom"
      ? input.margin
      : input.v === "top"
        ? visualH - input.margin - input.textHeight
        : (visualH - input.textHeight) / 2;

  const w = input.pageWidth;
  const h = input.pageHeight;
  switch (rot) {
    case 90:
      return { x: w - vy, y: vx, rotate: 90 };
    case 180:
      return { x: w - vx, y: h - vy, rotate: 180 };
    case 270:
      return { x: vy, y: h - vx, rotate: 270 };
    default:
      return { x: vx, y: vy, rotate: 0 };
  }
}

export interface PlaceCenteredInput {
  pageWidth: number;
  pageHeight: number;
  pageRotation: number;
  textWidth: number;
  textHeight: number;
  /** Extra tilt (degrees, counter-clockwise) the user asked for. */
  tilt: number;
}

/**
 * Place a stamp centered on the page and tilted by `tilt` degrees in the
 * viewer's frame — the classic diagonal watermark. The page center is invariant
 * under `/Rotate`, so only the tilt has to absorb the page's display rotation.
 */
export function placeCenteredStamp(input: PlaceCenteredInput): StampPlacement {
  const rot = normalizeRotation(input.pageRotation);
  const theta = rot + input.tilt;
  const rad = (theta * Math.PI) / 180;
  const cx = input.pageWidth / 2;
  const cy = input.pageHeight / 2;
  const halfW = input.textWidth / 2;
  const halfH = input.textHeight / 2;
  // anchor = center − R(theta)·(halfW, halfH) so the text's bounding-box center
  // lands exactly on the page center after rotation.
  const x = cx - (halfW * Math.cos(rad) - halfH * Math.sin(rad));
  const y = cy - (halfW * Math.sin(rad) + halfH * Math.cos(rad));
  return { x, y, rotate: theta };
}

/** Stamp our producer/creator so exported files identify their origin. */
export function stampProducer(doc: PDFDocument): void {
  doc.setProducer(STAMP_PRODUCER);
  doc.setCreator(STAMP_PRODUCER);
}

/** Embed a standard font for stamping; bold reads better for watermarks. */
export function embedStampFont(
  doc: PDFDocument,
  weight: "regular" | "bold" = "regular",
): Promise<PDFFont> {
  return doc.embedFont(
    weight === "bold" ? StandardFonts.HelveticaBold : StandardFonts.Helvetica,
  );
}
