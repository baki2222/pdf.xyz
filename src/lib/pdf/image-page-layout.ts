/**
 * Image to PDF's page setup — the choices the runner offers and the geometry
 * each one draws — as a LEAF (no pdf-lib, no DOM), so the engine that lays
 * out the page, the chips that offer the choice and the copy that describes
 * it all read one table.
 *
 * Until 2026-10-24 the layout was fixed: one US Letter portrait page per
 * image with a 36pt margin, and two guards held the copy to "no page-size,
 * orientation or margin setting". Those guards were inverted when this
 * module arrived (claims-vs-capability.test.ts, tool-page-substance.test.ts):
 * the copy may now name a setting only if it is listed here, and every
 * listed page size is checked against the page the engine actually draws.
 *
 * The DEFAULTS are the old fixed layout, so a user who touches nothing gets
 * the PDF they always got.
 */
import { IMAGE_PAGE_MARGIN_PT, US_LETTER_PT } from "./page-geometry";

export type ImagePageSizeId = "fit" | "a4" | "letter" | "legal" | "a3" | "a5";

export interface ImagePageSize {
  id: ImagePageSizeId;
  /** The chip's label, and the name the copy uses. */
  label: string;
  /** Portrait size in points; absent for "fit", whose page is the image's. */
  size?: { width: number; height: number };
}

/** ISO 216 sizes in points (mm × 72 / 25.4), rounded to 0.01 pt. */
const mm = (value: number) => Math.round(((value * 72) / 25.4) * 100) / 100;

/** Every page size the runner offers, in the order its chips are drawn. */
export const IMAGE_PAGE_SIZES: readonly ImagePageSize[] = [
  { id: "fit", label: "Fit to image" },
  { id: "a4", label: "A4", size: { width: mm(210), height: mm(297) } },
  { id: "letter", label: "US Letter", size: { ...US_LETTER_PT } },
  { id: "legal", label: "US Legal", size: { width: 612, height: 1008 } },
  { id: "a3", label: "A3", size: { width: mm(297), height: mm(420) } },
  { id: "a5", label: "A5", size: { width: mm(148), height: mm(210) } },
];

export type ImageOrientationId = "auto" | "portrait" | "landscape";

export const IMAGE_ORIENTATIONS: readonly {
  id: ImageOrientationId;
  label: string;
}[] = [
  { id: "auto", label: "Auto" },
  { id: "portrait", label: "Portrait" },
  { id: "landscape", label: "Landscape" },
];

export type ImageMarginId = "none" | "small" | "large";

export const IMAGE_MARGINS: readonly {
  id: ImageMarginId;
  label: string;
  points: number;
}[] = [
  { id: "none", label: "None", points: 0 },
  { id: "small", label: "Small", points: 18 },
  { id: "large", label: "Large", points: IMAGE_PAGE_MARGIN_PT },
];

export type ImageOutputId = "single" | "per-image";

export const IMAGE_OUTPUTS: readonly { id: ImageOutputId; label: string }[] = [
  { id: "single", label: "One PDF" },
  { id: "per-image", label: "One PDF per image (ZIP)" },
];

export interface ImagePageOptions {
  pageSize: ImagePageSizeId;
  orientation: ImageOrientationId;
  margin: ImageMarginId;
}

/** The layout every image PDF had before these options existed. */
export const DEFAULT_IMAGE_PAGE_OPTIONS: Readonly<ImagePageOptions> = {
  pageSize: "letter",
  orientation: "portrait",
  margin: "large",
};

export const DEFAULT_IMAGE_OUTPUT: ImageOutputId = "single";

/**
 * PDF's implementation limit on a page side (ISO 32000-1, Annex C: 14,400
 * units). A "fit to image" page for a 6000 px photo would exceed it, so the
 * image is scaled down until the page fits.
 */
export const MAX_PAGE_SIDE_PT = 14_400;

export interface ImagePageLayout {
  pageWidth: number;
  pageHeight: number;
  /** Where the image is drawn, in points from the bottom-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export function imagePageSizeById(id: ImagePageSizeId): ImagePageSize {
  return IMAGE_PAGE_SIZES.find((s) => s.id === id) ?? IMAGE_PAGE_SIZES[2]!;
}

export function imageMarginPoints(id: ImageMarginId): number {
  return IMAGE_MARGINS.find((m) => m.id === id)?.points ?? IMAGE_PAGE_MARGIN_PT;
}

/**
 * The page and the image rectangle for one image of `width` × `height` (its
 * DISPLAYED size, in points — one image pixel is one point).
 *
 * The image keeps its proportions, is centred inside the margin box, and is
 * only ever scaled DOWN: one that already fits is placed at its own size and
 * never enlarged, exactly as the fixed layout always did. On "Fit to image"
 * the page is the image plus the margin on every side, and orientation does
 * not apply (the page already has the image's shape).
 */
export function imagePageLayout(
  width: number,
  height: number,
  options: ImagePageOptions = DEFAULT_IMAGE_PAGE_OPTIONS,
): ImagePageLayout {
  const margin = imageMarginPoints(options.margin);
  const size = imagePageSizeById(options.pageSize).size;

  if (!size) {
    // The page grows with the image, up to PDF's page-side limit.
    const room = MAX_PAGE_SIDE_PT - margin * 2;
    const scale = Math.min(1, room / width, room / height);
    const w = width * scale;
    const h = height * scale;
    return {
      pageWidth: w + margin * 2,
      pageHeight: h + margin * 2,
      x: margin,
      y: margin,
      width: w,
      height: h,
    };
  }

  const landscape =
    options.orientation === "landscape" ||
    (options.orientation === "auto" && width > height);
  const pageWidth = landscape ? size.height : size.width;
  const pageHeight = landscape ? size.width : size.height;
  const maxWidth = pageWidth - margin * 2;
  const maxHeight = pageHeight - margin * 2;
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  const w = width * scale;
  const h = height * scale;
  return {
    pageWidth,
    pageHeight,
    x: (pageWidth - w) / 2,
    y: (pageHeight - h) / 2,
    width: w,
    height: h,
  };
}
