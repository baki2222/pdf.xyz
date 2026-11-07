/**
 * A custom page size and a custom margin on JPG / PNG to PDF (audits
 * jpg-to-pdf#3 and png-to-pdf#5, 2026-11-08). The six paper chips and three
 * margins stay as they are; "Custom" beside each takes a number in
 * millimetres or inches, for an ID-card or passport-photo sheet, a receipt
 * roll, a 4 × 6 in photo print, A6, Tabloid or a size a portal dictates.
 *
 * A LEAF of its own: only the image runner, `image-to-pdf.ts` and the tool
 * copy import it. `image-page-layout.ts` (on OCR PDF's first load) learns
 * only the two ids and the two point values it lays out with.
 *
 * A custom size is held PORTRAIT (short side first), like every listed size,
 * so Orientation works on it exactly as on A4: Portrait, Landscape, or Auto
 * by the image's shape.
 */
import {
  MAX_PAGE_SIDE_PT,
  imageMarginPoints,
  imagePageSizeById,
  type ImagePageOptions,
} from "./image-page-layout";

export type LengthUnitId = "mm" | "in";

export const LENGTH_UNITS: readonly {
  id: LengthUnitId;
  label: string;
  /** Points in one unit. */
  points: number;
}[] = [
  { id: "mm", label: "mm", points: 72 / 25.4 },
  { id: "in", label: "in", points: 72 },
];

/** The smallest page side a custom size may have: half an inch. */
export const MIN_CUSTOM_PAGE_PT = 36;
/** The largest: PDF's own limit on a page side (200 in). */
export const MAX_CUSTOM_PAGE_PT = MAX_PAGE_SIDE_PT;
/** The largest custom margin: two inches. */
export const MAX_CUSTOM_MARGIN_PT = 144;
/** What a margin must leave free across the page's short side, at least. */
export const MIN_PRINTABLE_PT = 18;

export const CUSTOM_PAGE_LABELS = {
  /** The chip after the paper sizes, and after the margins. */
  chip: "Custom",
  width: "Custom page width",
  height: "Custom page height",
  unit: "Unit",
  margin: "Custom margin",
} as const;

const unitPoints = (unit: LengthUnitId) =>
  LENGTH_UNITS.find((u) => u.id === unit)!.points;

/** "105", "4.5" or "4,5" in `unit`, as points; undefined if not a number > 0. */
export function lengthToPoints(
  text: string,
  unit: LengthUnitId,
): number | undefined {
  const t = text.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(t)) return undefined;
  const value = Number(t);
  return value > 0 ? value * unitPoints(unit) : undefined;
}

/** A number of points shown back in `unit`, at most two decimals. */
export function pointsToLength(points: number, unit: LengthUnitId): string {
  return String(Math.round((points / unitPoints(unit)) * 100) / 100);
}

/** "36 mm" or "0.5 in": a point value in the unit the user is typing in. */
const shown = (points: number, unit: LengthUnitId) =>
  `${pointsToLength(points, unit)} ${unit}`;

/**
 * The custom size from what was typed, held portrait; or the sentence that
 * says what is wrong with it, in the unit being typed.
 */
export function customPageSize(
  width: string,
  height: string,
  unit: LengthUnitId,
): { width: number; height: number } | { problem: string } {
  const w = lengthToPoints(width, unit);
  const h = lengthToPoints(height, unit);
  if (w === undefined || h === undefined)
    return {
      problem: `Enter the page's width and height as numbers in ${unit}.`,
    };
  const [short, long] = w <= h ? [w, h] : [h, w];
  if (short < MIN_CUSTOM_PAGE_PT || long > MAX_CUSTOM_PAGE_PT)
    return {
      problem: `Each side of a custom page must be from ${shown(MIN_CUSTOM_PAGE_PT, unit)} to ${shown(MAX_CUSTOM_PAGE_PT, unit)}.`,
    };
  return { width: short, height: long };
}

/** The custom margin from what was typed; or what is wrong with it. */
export function customMargin(
  text: string,
  unit: LengthUnitId,
): number | { problem: string } {
  const t = text.trim();
  // 0 is a margin ("None", typed); lengthToPoints only takes sizes above 0.
  const points = /^0+([.,]0+)?$/.test(t) ? 0 : lengthToPoints(t, unit);
  if (points === undefined || points > MAX_CUSTOM_MARGIN_PT)
    return {
      problem: `Enter a margin from 0 to ${shown(MAX_CUSTOM_MARGIN_PT, unit)}.`,
    };
  return points;
}

/**
 * Why `options` cannot be laid out, or undefined when they can: a margin
 * that leaves less than {@link MIN_PRINTABLE_PT} across the page's short
 * side. Checked by the runner before Create PDF and by the engine again.
 */
export function pageSetupProblem(
  options: ImagePageOptions,
  unit: LengthUnitId = "mm",
): string | undefined {
  const margin =
    options.margin === "custom" && options.customMarginPt !== undefined
      ? options.customMarginPt
      : imageMarginPoints(options.margin);
  const size =
    options.pageSize === "custom"
      ? options.customSize
      : imagePageSizeById(options.pageSize).size;
  if (options.pageSize === "custom" && !size)
    return "Enter a custom page size.";
  if (!size) return undefined; // Fit to image: the page grows with the margin.
  const short = Math.min(size.width, size.height);
  if (short - margin * 2 < MIN_PRINTABLE_PT)
    return `That margin leaves no room for the image on a ${shown(short, unit)} wide page. Choose a smaller margin.`;
  return undefined;
}

/** "12.7 mm (0.5 in)": a bound in both units, as the copy states it. */
const both = (points: number) =>
  `${Number(pointsToLength(points, "mm")).toLocaleString("en-US")} mm (${Number(pointsToLength(points, "in")).toLocaleString("en-US")} in)`;

/**
 * The page copy's account of the two Custom chips, every number from the
 * limits above. image-tools-w3-copy.test.ts holds the pages that quote it;
 * image-page-custom.test.ts holds the examples (A6, 4 × 6 in) to the page
 * the engine draws.
 */
export const CUSTOM_PAGE_COPY = `${CUSTOM_PAGE_LABELS.chip} beside the page sizes takes a width and height of your own in mm or inches, such as 105 × 148 mm for A6 or 4 × 6 in for a photo print, from ${both(MIN_CUSTOM_PAGE_PT)} to ${both(MAX_CUSTOM_PAGE_PT)} a side, and Orientation turns it as it turns A4; ${CUSTOM_PAGE_LABELS.chip} beside the margins takes a margin from 0 to ${both(MAX_CUSTOM_MARGIN_PT)}.`;
