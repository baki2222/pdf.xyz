import type { PDFDocument, PDFFont, RGB as PdfLibRGB } from "pdf-lib";
import { loadPdf } from "./engine";
import { embedDrawingFont } from "./unicode-font";
import {
  normalizeRotation,
  viewToContent,
  visibleBox,
  type PageBox,
} from "./page-frame";

/**
 * Shared, pure primitives for stamping text onto existing PDF pages — used by
 * the page-numbers, watermark, and header/footer tools. Everything here is
 * isomorphic (pdf-lib only, no DOM) and the geometry is expressed as pure
 * functions so it can be unit-tested with plain numbers instead of brittle
 * visual assertions.
 *
 * Coordinate model: pdf-lib draws in the page's *unrotated* user space
 * (origin bottom-left, y up), but a reader sees only the page's visible box —
 * CropBox ∩ MediaBox, whose origin need not be 0,0 ({@link visibleBox}). A page may carry a `/Rotate` flag (0/90/180/270,
 * clockwise) that a viewer applies at display time. To make a stamp land where
 * the reader expects — a "bottom-center" footer at the visual bottom, reading
 * horizontally — `placeStamp` computes the anchor in the viewer's frame and
 * maps it back into content space, plus the text rotation that cancels the
 * page's display rotation.
 */

export { loadPdf };
export { normalizeRotation, viewToContent, visibleBox, type PageBox };

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
export function resolveAlign(position: StampPosition): {
  h: HAlign;
  v: VAlign;
} {
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
export function toRgb(
  rgbFn: (r: number, g: number, b: number) => PdfLibRGB,
  color: RGB,
) {
  return rgbFn(
    clamp(color.r, 0, 1),
    clamp(color.g, 0, 1),
    clamp(color.b, 0, 1),
  );
}

/** Clamp a number into an inclusive range. */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
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
    const replacement =
      value === undefined || value === null ? "" : String(value);
    out = out.replace(re, replacement);
  }
  return out;
}

/*
 * The part of a page a reader actually sees — the CropBox clipped to the
 * MediaBox (ISO 32000-1 §14.11.2), falling back to the MediaBox when the two do
 * not overlap, which is exactly what pdf.js computes for `page.view` — is
 * `visibleBox` from `./page-frame`, re-exported above. `page.getSize()` is the
 * MediaBox alone, and pdf-lib's `getCropBox()` is not clipped: anchoring a
 * stamp on either puts it in the cropped-away margin of any cropped page,
 * where no viewer draws it.
 */

export interface StampPlacement {
  /** Draw x in content space. */
  x: number;
  /** Draw y in content space. */
  y: number;
  /** Text rotation in degrees (counter-clockwise) to hand to pdf-lib. */
  rotate: number;
}

export interface PlaceStampInput {
  /**
   * The page's VISIBLE box in unrotated user space — {@link visibleBox}, not
   * `page.getSize()`. Required, origin included, because the defect it fixes
   * was a width and height with an implied origin of 0,0: correct for a fresh
   * page, and in the cropped-away margin of every cropped one.
   */
  box: PageBox;
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
  const { width: w, height: h } = input.box;
  const visualW = swap ? h : w;
  const visualH = swap ? w : h;

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

  // Map within the box's own width and height, THEN translate by its origin
  // (`viewToContent` adds the origin after the rotation): the rotation is
  // about the visible box, so adding the origin first would mirror it on the
  // 90/180/270 branches.
  const { x, y } = viewToContent(vx, vy, input.box, rot);
  return { x, y, rotate: rot };
}

export interface PlaceCenteredInput {
  /** The page's visible box ({@link visibleBox}); the stamp centres on it. */
  box: PageBox;
  pageRotation: number;
  textWidth: number;
  textHeight: number;
  /** Extra tilt (degrees, counter-clockwise) the user asked for. */
  tilt: number;
}

/**
 * Place a stamp centered on the visible page and tilted by `tilt` degrees in the
 * viewer's frame — the classic diagonal watermark. The box center is invariant
 * under `/Rotate`, so only the tilt has to absorb the page's display rotation.
 */
export function placeCenteredStamp(input: PlaceCenteredInput): StampPlacement {
  const rot = normalizeRotation(input.pageRotation);
  const theta = rot + input.tilt;
  const rad = (theta * Math.PI) / 180;
  const cx = input.box.x + input.box.width / 2;
  const cy = input.box.y + input.box.height / 2;
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

/**
 * Embed the face that can stamp EVERY string in `texts`; bold reads better for
 * watermarks.
 *
 * Western text still gets the built-in Helvetica and downloads nothing — the
 * path this function had before Unicode support, unchanged and free. Anything
 * else routes to {@link embedDrawingFont}, which fetches a real Noto face and
 * refuses, loudly and by name, when no shipped face can draw the characters.
 *
 * Why the WHOLE list and not a sample: page numbers substitute `{n}` per page
 * and header slots substitute `{date}`, so the string that needs a Bengali face
 * is frequently not the template the caller was holding. A font chosen from one
 * string is a font chosen from the wrong set — and the failure would surface as
 * pdf-lib throwing a raw `WinAnsi cannot encode` mid-loop, after some pages had
 * already been stamped.
 */
export async function embedStampFont(
  doc: PDFDocument,
  texts: readonly string[],
  weight: "regular" | "bold" = "regular",
): Promise<PDFFont> {
  return embedDrawingFont(doc, texts, weight === "bold" ? "sans-bold" : "sans");
}
