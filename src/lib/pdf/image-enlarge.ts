/**
 * "Small images" on JPG / PNG to PDF (audits jpg-to-pdf#4, png-to-pdf#4,
 * 2026-11-08): on a paper size, an image smaller than the space inside the
 * margin was always placed at its own size, so a screenshot or a web image
 * sat as a stamp in the middle of an A4 sheet. "Enlarge to fit" scales it UP
 * until it meets the margin, keeping its proportions. Off by default: it
 * trades sharpness for size, and the default PDF stays the one users had.
 *
 * Fit to image is untouched: its page is the image, so there is nothing to
 * fill. A LEAF that only the image runner, `image-to-pdf.ts` and the tool
 * copy import.
 */
import {
  MAX_PAGE_SIDE_PT,
  type ImagePageOptions,
  type SmallImagesId,
} from "./image-page-layout";

export const SMALL_IMAGES_LABELS = {
  heading: "Small images",
  /** Shown while Fit to image is chosen, when the choice does nothing. */
  fitNote: "Fit to image gives each page its image's own size.",
} as const;

export const SMALL_IMAGES_CHOICES: readonly {
  id: SmallImagesId;
  label: string;
}[] = [
  { id: "keep", label: "Keep size" },
  { id: "enlarge", label: "Enlarge to fit" },
];

/** Whether the options ask a small image to be scaled up to the margin. */
export function enlargesSmallImages(options: ImagePageOptions): boolean {
  return options.smallImages === "enlarge" && options.pageSize !== "fit";
}

/**
 * The size to hand `imagePageLayout` for `shown`: under "Enlarge to fit",
 * the same shape made at least as large as any page PDF allows, which the
 * layout (which only ever scales DOWN) then shrinks to exactly the space
 * inside the margin — so the enlargement and the ordinary fit are one rule.
 */
export function sizeForLayout(
  shown: { width: number; height: number },
  options: ImagePageOptions,
): { width: number; height: number } {
  if (!enlargesSmallImages(options)) return shown;
  const k = MAX_PAGE_SIDE_PT / Math.min(shown.width, shown.height);
  return k > 1 ? { width: shown.width * k, height: shown.height * k } : shown;
}
