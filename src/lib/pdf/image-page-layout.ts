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

/**
 * "custom" (2026-11-08, audit jpg-to-pdf#3) is NOT in {@link IMAGE_PAGE_SIZES}:
 * its size is typed by the user and travels as `customSize`; its chip, units
 * and limits live in `image-page-custom.ts`.
 */
export type ImagePageSizeId =
  "fit" | "a4" | "letter" | "legal" | "a3" | "a5" | "custom";

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

/** "custom": typed by the user, carried as `customMarginPt`. */
export type ImageMarginId = "none" | "small" | "large" | "custom";

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

/**
 * What happens to a JPEG's camera and location details (Exif, GPS, XMP,
 * IPTC, comments, appended previews). "remove" strips those segments without
 * re-encoding (`stripJpegMetadata`); "keep" embeds the file with its metadata,
 * as every JPEG was until 2026-11-07, except that a turned photo's EXIF
 * Orientation value is rewritten to 1 (`uprightJpeg`) so no viewer turns it
 * twice; image-to-pdf.test.ts "are kept ... apart from the rotation tag"
 * holds that to the byte. Not page setup, but it rides on the same options
 * so every path that builds the PDF (the size ladder too) sees it.
 */
export type PhotoDetailsId = "remove" | "keep";

export const PHOTO_DETAILS_LABELS = {
  heading: "Photo location & camera details",
} as const;

export const PHOTO_DETAILS_CHOICES: readonly {
  id: PhotoDetailsId;
  label: string;
}[] = [
  { id: "remove", label: "Remove" },
  { id: "keep", label: "Keep" },
];

/**
 * Whether an image smaller than the paper is scaled up to the margin
 * (`image-enlarge.ts`, which holds the labels and the rule, so this module
 * — on OCR PDF's first load — carries the type alone). Absent reads as
 * "keep": placed at its own size, as every image always was.
 */
export type SmallImagesId = "keep" | "enlarge";

export interface ImagePageOptions {
  pageSize: ImagePageSizeId;
  orientation: ImageOrientationId;
  margin: ImageMarginId;
  /** Absent reads as "remove": the private choice is the default. */
  photoDetails?: PhotoDetailsId;
  smallImages?: SmallImagesId;
  /** With pageSize "custom": the typed size, portrait, in points. */
  customSize?: { width: number; height: number };
  /** With margin "custom": the typed margin, in points. */
  customMarginPt?: number;
  /**
   * "per-image": one bookmark per image in a one-PDF output
   * (`image-bookmarks.ts`, which holds the labels and the writer). Absent
   * reads as "none".
   */
  bookmarks?: "none" | "per-image";
}

/**
 * The layout every image PDF had before these options existed — and, since
 * 2026-11-07, photo details removed, which they were not before.
 */
export const DEFAULT_IMAGE_PAGE_OPTIONS: Readonly<ImagePageOptions> = {
  pageSize: "letter",
  orientation: "portrait",
  margin: "large",
  photoDetails: "remove",
};

/** Whether a JPEG's camera and location segments are stripped. */
export function removesPhotoDetails(options: ImagePageOptions): boolean {
  return options.photoDetails !== "keep";
}

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
  const margin =
    options.margin === "custom" && options.customMarginPt !== undefined
      ? options.customMarginPt
      : imageMarginPoints(options.margin);
  const size =
    options.pageSize === "custom" && options.customSize
      ? options.customSize
      : imagePageSizeById(options.pageSize).size;

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
