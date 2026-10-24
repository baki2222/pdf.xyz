import type { PDFDocument, PDFFont, RGB as PdfLibRGB } from "pdf-lib";
import { loadPdf } from "./engine";
import { embedDrawingFont } from "./unicode-font";
import type { StandardFace } from "./font-packs";
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

/**
 * The size of the visible box as a reader sees it: width and height swap on a
 * quarter-turned page.
 */
export function viewerSize(
  box: PageBox,
  pageRotation: number,
): { width: number; height: number } {
  const rot = normalizeRotation(pageRotation);
  return rot === 90 || rot === 270
    ? { width: box.height, height: box.width }
    : { width: box.width, height: box.height };
}

/** The axis-aligned span of a `width × height` box turned by `tilt` degrees. */
export function tiltedSpan(
  width: number,
  height: number,
  tilt: number,
): { x: number; y: number } {
  const rad = (tilt * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return { x: width * cos + height * sin, y: width * sin + height * cos };
}

export interface PlaceTiltedInput {
  /** The page's visible box ({@link visibleBox}). */
  box: PageBox;
  pageRotation: number;
  /** The stamp's own (untilted) width and height. */
  width: number;
  height: number;
  /** Tilt (degrees, counter-clockwise) in the reader's frame. */
  tilt: number;
}

/**
 * Anchor a tilted stamp so its centre lands on `(cx, cy)` — a point in the
 * READER's frame ({@link viewToContent}) — and it leans by `tilt` there.
 *
 * With the centre of the visible page this is exactly
 * {@link placeCenteredStamp}: the page centre maps to the box centre under
 * every `/Rotate`, and the anchor is the same `centre − R(θ)·(w/2, h/2)`.
 */
export function placeTiltedAt(
  input: PlaceTiltedInput & { cx: number; cy: number },
): StampPlacement {
  const rot = normalizeRotation(input.pageRotation);
  const theta = rot + input.tilt;
  const rad = (theta * Math.PI) / 180;
  const centre = viewToContent(input.cx, input.cy, input.box, rot);
  const halfW = input.width / 2;
  const halfH = input.height / 2;
  return {
    x: centre.x - (halfW * Math.cos(rad) - halfH * Math.sin(rad)),
    y: centre.y - (halfW * Math.sin(rad) + halfH * Math.cos(rad)),
    rotate: theta,
  };
}

/**
 * Place a tilted stamp in one of the nine cells of the reader's page: its
 * tilted bounding box sits `inset` (a share of each visible side) in from the
 * edges it is aligned to, and centred on the axes it is not.
 */
export function placeTiltedStamp(
  input: PlaceTiltedInput & { h: HAlign; v: VAlign; inset: number },
): StampPlacement {
  const { width: vw, height: vh } = viewerSize(input.box, input.pageRotation);
  const span = tiltedSpan(input.width, input.height, input.tilt);
  const mx = vw * input.inset;
  const my = vh * input.inset;
  const cx =
    input.h === "left"
      ? mx + span.x / 2
      : input.h === "right"
        ? vw - mx - span.x / 2
        : vw / 2;
  const cy =
    input.v === "bottom"
      ? my + span.y / 2
      : input.v === "top"
        ? vh - my - span.y / 2
        : vh / 2;
  return placeTiltedAt({ ...input, cx, cy });
}

/** Upper bound on tiles drawn per page, so a tiny mark on a huge sheet stays cheap. */
export const MAX_TILES_PER_PAGE = 400;

/**
 * Repeat a tilted stamp across the reader's page: rows run along the tilt,
 * every other row shifted half a step, laid from the page centre. Only copies
 * whose WHOLE tilted box lies inside the visible page are kept, so no tile is
 * cut off at an edge; of the lattice through the centre and its three
 * half-step offsets, the one keeping the most copies wins. A stamp that fits
 * the page at all (the caller's fit) always yields at least the centre copy.
 */
export function tilePlacements(input: PlaceTiltedInput): StampPlacement[] {
  const { width: vw, height: vh } = viewerSize(input.box, input.pageRotation);
  const w = input.width;
  const h = input.height;
  const gap = 0.5 * h + 0.15 * w;
  const stepU = w + gap;
  const stepN = h + gap;
  const rad = (input.tilt * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const nx = -uy;
  const ny = ux;
  const reach = Math.hypot(vw, vh);
  const rows = Math.ceil(reach / stepN) + 1;
  const cols = Math.ceil(reach / stepU) + 1;
  const eps = 1e-6;
  const corners = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ] as const;
  const lattice = (phaseU: number, phaseN: number) => {
    const centres: { cx: number; cy: number }[] = [];
    for (let j = -rows; j <= rows; j += 1) {
      const shift = Math.abs(j) % 2 === 1 ? stepU / 2 : 0;
      for (let i = -cols; i <= cols; i += 1) {
        const along = (i + phaseU) * stepU + shift;
        const across = (j + phaseN) * stepN;
        const cx = vw / 2 + along * ux + across * nx;
        const cy = vh / 2 + along * uy + across * ny;
        const whole = corners.every(([a, b]) => {
          const px = cx + a * ux + b * nx;
          const py = cy + a * uy + b * ny;
          return px >= -eps && px <= vw + eps && py >= -eps && py <= vh + eps;
        });
        if (!whole) continue;
        centres.push({ cx, cy });
        if (centres.length >= MAX_TILES_PER_PAGE) return centres;
      }
    }
    return centres;
  };
  // The lattice through the page centre first, so a tie keeps the
  // symmetric layout; then the three half-step offsets, which fit more
  // copies on a page whose size falls between two rows.
  let best = lattice(0, 0);
  for (const [pu, pn] of [
    [0.5, 0],
    [0, 0.5],
    [0.5, 0.5],
  ] as const) {
    const next = lattice(pu, pn);
    if (next.length > best.length) best = next;
  }
  return best.map(({ cx, cy }) => placeTiltedAt({ ...input, cx, cy }));
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
  family: StampFontFamily = "helvetica",
): Promise<PDFFont> {
  return embedDrawingFont(doc, texts, STAMP_FACES[family][weight]);
}

/**
 * The type families a stamp may be set in. Each is a font built into the PDF
 * format, used as-is for Western text; anything else goes through
 * {@link embedDrawingFont} to the downloaded face that covers it, whichever
 * family was picked (Courier asks for "mono", so it may get the shipped
 * monospace face where that covers the text).
 */
export type StampFontFamily = "helvetica" | "times" | "courier";

export const STAMP_FONT_FAMILIES: readonly StampFontFamily[] = [
  "helvetica",
  "times",
  "courier",
] as const;

/** The name a reader sees for each family, as the runners label it. */
export const STAMP_FONT_LABELS: Record<StampFontFamily, string> = {
  helvetica: "Helvetica",
  times: "Times",
  courier: "Courier",
};

const STAMP_FACES: Record<
  StampFontFamily,
  Record<"regular" | "bold", StandardFace>
> = {
  helvetica: { regular: "sans", bold: "sans-bold" },
  times: { regular: "serif", bold: "serif-bold" },
  courier: { regular: "mono", bold: "mono-bold" },
};

/** Parse a `#rrggbb` colour into 0–1 channels; null when it is not one. */
export function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return null;
  return {
    r: parseInt(m[1]!, 16) / 255,
    g: parseInt(m[2]!, 16) / 255,
    b: parseInt(m[3]!, 16) / 255,
  };
}

/** `#rrggbb` for 0–1 channels — the value an `<input type="color">` takes. */
export function rgbToHex(color: RGB): string {
  const part = (v: number) =>
    Math.round(clamp(v, 0, 1) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`;
}
