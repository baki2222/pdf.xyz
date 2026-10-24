import type { CropMargins } from "./crop";
import { MIN_CROP_DIMENSION } from "./page-geometry";

/**
 * Auto-crop: find where a page's ink is and propose margins that trim the
 * white around it. Pure — it reads RGBA pixels it is handed and returns
 * numbers — so the browser's pdf.js render (`render.ts`
 * `rasterizeEachPage`) and the Node render a test uses go through the same
 * arithmetic. The proof is not this file's own unit test: it is
 * `auto-crop.test.ts` rendering a fixture with known margins, cropping it
 * with these margins, and rendering the SAVED file again to see that every
 * mark is still on the page.
 *
 * Frame: pixels are of the page AS DISPLAYED (crop box, then `/Rotate`), and
 * margins come back in that frame in points — the frame `cropPdf` reads.
 */

/** RGBA pixels, 4 bytes each, row-major, top row first. */
export interface RasterPage {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

/** A page's displayed size in points. */
export interface PageSizePt {
  width: number;
  height: number;
}

/**
 * How far from white a pixel must be, on its darkest channel (0–255), to
 * count as ink. Small enough that light-grey text, a pale highlight or a thin
 * hairline counts; large enough that a render's near-white noise does not.
 */
export const INK_THRESHOLD = 20;

/**
 * Points of white kept outside the ink on every side: covers anti-aliased
 * edges too faint to pass {@link INK_THRESHOLD} and the half-pixel the low
 * analysis resolution cannot see.
 */
export const AUTO_CROP_PAD_PT = 6;

/** The analysis render's longer side, in pixels (about 36 dpi on A4). */
export const AUTO_CROP_LONG_SIDE_PX = 420;

/** The inked region in pixels: left/top inclusive, right/bottom exclusive. */
export interface InkBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The bounding box of every ink pixel, or null for a page with none. */
export function findInkBox(
  page: RasterPage,
  threshold = INK_THRESHOLD,
): InkBox | null {
  const { width, height, data } = page;
  if (data.length < width * height * 4) {
    // A short buffer would read as white past its end — the convenient
    // direction for "this page is blank". Loud instead.
    throw new Error(
      `raster is ${data.length} bytes, expected ${width * height * 4}`,
    );
  }
  const cut = 255 - threshold;
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      if (
        Math.min(data[i]!, data[i + 1]!, data[i + 2]!) < cut &&
        data[i + 3]! > 0
      ) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return null;
  return { left, top, right: right + 1, bottom: bottom + 1 };
}

/** Round a margin DOWN to 0.01 pt, so rounding never trims into the pad. */
const floor2 = (value: number) => Math.max(0, Math.floor(value * 100) / 100);

/**
 * Margins (points, displayed frame) that keep `ink` plus `pad` on a page of
 * `size` rendered at `raster`'s pixel size, never leaving less than
 * {@link MIN_CROP_DIMENSION} on either axis.
 */
export function marginsForInk(
  ink: InkBox,
  raster: { width: number; height: number },
  size: PageSizePt,
  pad = AUTO_CROP_PAD_PT,
): CropMargins {
  const sx = size.width / raster.width;
  const sy = size.height / raster.height;
  const margins = {
    left: floor2(ink.left * sx - pad),
    right: floor2((raster.width - ink.right) * sx - pad),
    top: floor2(ink.top * sy - pad),
    bottom: floor2((raster.height - ink.bottom) * sy - pad),
  };
  return fitMinimum(margins, size);
}

/** Give back margin evenly on an axis that would end up too small. */
function fitMinimum(m: CropMargins, size: PageSizePt): CropMargins {
  const fit = (a: number, b: number, span: number): [number, number] => {
    const over = a + b - (span - MIN_CROP_DIMENSION);
    if (over <= 0) return [a, b];
    if (span <= MIN_CROP_DIMENSION) return [0, 0];
    const total = a + b;
    const keep = Math.max(0, total - over);
    return [floor2((a / total) * keep), floor2((b / total) * keep)];
  };
  const [left, right] = fit(m.left, m.right, size.width);
  const [top, bottom] = fit(m.top, m.bottom, size.height);
  return { top, right, bottom, left };
}

export interface AutoCropPlan {
  /** Each page's own margins; null for a page with no ink (left uncropped). */
  perPage: (CropMargins | null)[];
  /**
   * One set of margins for every inked page: per edge, the smallest any page
   * needs, so the same crop keeps every page's ink (the union of their
   * content boxes when the pages are one size). Null when no page has ink.
   */
  uniform: CropMargins | null;
  /** 0-based indices of pages with no ink at all. */
  blank: number[];
  /** 0-based indices the render could not read; also left uncropped. */
  unread: number[];
}

/** Turn one analysis per page into a plan. */
export function planAutoCrop(
  pages: readonly ({ ink: InkBox | null; raster: RasterPage } | null)[],
  sizes: readonly PageSizePt[],
  pad = AUTO_CROP_PAD_PT,
): AutoCropPlan {
  const blank: number[] = [];
  const unread: number[] = [];
  const perPage = pages.map((page, i) => {
    const size = sizes[i];
    if (!page || !size) {
      unread.push(i);
      return null;
    }
    if (!page.ink) {
      blank.push(i);
      return null;
    }
    return marginsForInk(page.ink, page.raster, size, pad);
  });
  const inked = perPage.filter((m): m is CropMargins => m !== null);
  const uniform =
    inked.length === 0
      ? null
      : {
          top: Math.min(...inked.map((m) => m.top)),
          right: Math.min(...inked.map((m) => m.right)),
          bottom: Math.min(...inked.map((m) => m.bottom)),
          left: Math.min(...inked.map((m) => m.left)),
        };
  return { perPage, uniform, blank, unread };
}

/**
 * The margins to crop with, per page, for the chosen way of applying a plan:
 * each page its own box, or the uniform box on every inked page. Blank and
 * unread pages stay null — uncropped.
 */
export function appliedMargins(
  plan: AutoCropPlan,
  mode: "per-page" | "uniform",
): (CropMargins | null)[] {
  if (mode === "per-page") return plan.perPage;
  return plan.perPage.map((m) => (m && plan.uniform ? plan.uniform : null));
}
