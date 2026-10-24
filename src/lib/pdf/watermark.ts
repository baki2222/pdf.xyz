import type { PDFImage, PDFPage } from "pdf-lib";
import {
  drawRasterImage,
  embedRasterImage,
  loadPdfLib,
  rasterDisplaySize,
  type RasterImageFormat,
} from "./pdf-lib";
import { PdfEngineError } from "./engine";
import { outputName } from "./files";
import { PageRangeError, parsePageList } from "./ranges";
import { MAX_IMAGE_BYTES, MAX_IMAGE_MB } from "@/lib/tools/limits";
import {
  clamp,
  embedStampFont,
  loadPdf,
  normalizeRotation,
  placeCenteredStamp,
  placeTiltedStamp,
  resolveAlign,
  stampProducer,
  tilePlacements,
  toRgb,
  viewerSize,
  visibleBox,
  WATERMARK_INK,
  type RGB,
  type StampFontFamily,
  type StampPlacement,
  type StampPosition,
} from "./stamp";

/**
 * Stamp a text or image watermark on the pages of a PDF, fully in-browser.
 * By default it is one line of text, centred and tilted, on every page; the
 * caller can move it to any of the nine cells of the page or repeat it across
 * the page ("tile"), pick the pages, the font and the colour, use a PNG or
 * JPEG instead of text, and draw it behind the page's content instead of over
 * it. The mark lands where a reader expects and leans the right way even on
 * pages that carry a `/Rotate` flag or a CropBox.
 *
 * The requested font size (or image scale) is a CEILING, not a promise. A
 * fixed point size does not fit every page: "Property of Acme Corporation" is
 * ~860pt wide at 60pt and an A4 page is 595pt wide, so drawing it as asked cuts
 * letters off both ends — which is what this tool did, under "Stamped on all N
 * pages", until the fit below. Each page gets the largest size, up to the
 * requested one, at which the tilted mark fits the box a reader sees, and the
 * caller is told how many pages needed it so the result can say so.
 * `watermark.test.ts` reads the output back through pdfjs over every page size
 * pdf-lib defines. A tile is only drawn where the WHOLE copy is on the page.
 */

/**
 * Share of the visible box the tilted mark may span on each axis, so a shrunk
 * watermark keeps a margin instead of touching the page edges. The rest is the
 * inset a corner or edge position keeps from the sides it is aligned to.
 */
export const WATERMARK_FIT = 0.9;

/** Inset of an edge-aligned mark: half of what {@link WATERMARK_FIT} leaves. */
export const WATERMARK_INSET = (1 - WATERMARK_FIT) / 2;

/**
 * Share of each visible side ONE tiled copy may span. At {@link WATERMARK_FIT}
 * a tile is as big as a single mark, and the runner's default — 60pt
 * CONFIDENTIAL at 45° — tiled an A4 page with exactly one copy. Half the page
 * leaves room for the rows to repeat; a smaller size fits more of them.
 */
export const TILE_FIT = 0.5;

/** Where the mark goes: one of the nine cells, or repeated across the page. */
export type WatermarkPosition = StampPosition | "tile";

/** Whether the mark is drawn over the page's content or underneath it. */
export type WatermarkLayer = "over" | "behind";

/** Default width of an image mark, as a percentage of the visible page width. */
export const DEFAULT_IMAGE_SCALE = 50;

export interface WatermarkImage {
  /** PNG or JPEG bytes; the format is read from the bytes, not a name. */
  bytes: Uint8Array;
  /**
   * Width as a percentage (5–100) of the visible page width, before tilting.
   * Defaults to {@link DEFAULT_IMAGE_SCALE}. Like the font size, a ceiling: a
   * page too small for it gets the largest size that fits.
   */
  scale?: number;
}

export interface WatermarkOptions {
  /**
   * Font size in points, as an upper bound. Defaults to 60. A page too small to
   * hold the text at this size gets the largest size that fits.
   */
  fontSize?: number;
  /** Opacity, 0–1. Defaults to 0.18 so page content stays readable. */
  opacity?: number;
  /** Tilt in degrees (counter-clockwise). Defaults to 45. */
  rotation?: number;
  /** Ink color (0–1 channels). Defaults to a medium gray. */
  color?: RGB;
  /** Type family for text. Defaults to Helvetica (bold). */
  font?: StampFontFamily;
  /** Cell of the page, or "tile". Defaults to the centre. */
  position?: WatermarkPosition;
  /**
   * Pages to stamp, as typed ("1-3, 5", "4-"). Empty or absent means every
   * page.
   */
  pages?: string;
  /** Over (default) or behind the page's existing content. */
  layer?: WatermarkLayer;
  /** Stamp this image instead of the text. */
  image?: WatermarkImage;
}

export function validateWatermarkText(text: string): void {
  if (text.trim().length === 0) {
    throw new PdfEngineError("Enter the watermark text to stamp.");
  }
}

export function watermarkedOutputName(sourceName: string): string {
  return outputName(sourceName || "document", "watermarked");
}

export interface WatermarkReport {
  bytes: Uint8Array;
  /** Pages stamped — every page, or the ones the page list picked. */
  pages: number;
  /** Pages in the document. */
  totalPages: number;
  /** Marks drawn in all: one per stamped page, more when tiled. */
  placements: number;
  /** Pages where the requested size did not fit and a smaller one was drawn. */
  shrunkPages: number;
  /**
   * The smallest text size actually drawn, in points. For an image mark this
   * is the requested font size, untouched: no text was drawn.
   */
  smallestFontSize: number;
}

/**
 * The factor (at most 1) by which text of the given size must shrink so that,
 * turned by `theta` degrees, its bounding box spans no more than
 * {@link WATERMARK_FIT} of the box on either axis.
 *
 * `theta` and the box are in the page's STORED (content) frame: `theta` is the
 * page's `/Rotate` plus the user's tilt, exactly what `placeCenteredStamp`
 * draws with. That is the same fit as "the tilt, in the reader's frame, with
 * width and height swapped on a quarter-turned page" — composed once, here,
 * instead of twice.
 */
export function fitWatermarkScale(input: {
  boxWidth: number;
  boxHeight: number;
  textWidth: number;
  textHeight: number;
  theta: number;
  /** Share of each side the mark may span; {@link WATERMARK_FIT} by default. */
  fit?: number;
}): number {
  const fit = input.fit ?? WATERMARK_FIT;
  const rad = (input.theta * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const spanX = input.textWidth * cos + input.textHeight * sin;
  const spanY = input.textWidth * sin + input.textHeight * cos;
  return Math.min(
    1,
    (fit * input.boxWidth) / spanX,
    (fit * input.boxHeight) / spanY,
  );
}

/** The raster container the bytes hold, or null for anything else. */
export function watermarkImageFormat(
  bytes: Uint8Array,
): RasterImageFormat | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every((b, i) => bytes[i] === b)) {
    return "png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "jpg";
  }
  return null;
}

/**
 * Why these bytes cannot be a watermark image, or null when they can: the
 * size cap JPG to PDF and PNG to PDF use, then the container. The runner asks
 * this when a picture is picked; {@link watermarkPdf} asks it again.
 */
export function watermarkImageProblem(bytes: Uint8Array): string | null {
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return `That image is over ${MAX_IMAGE_MB} MB. Pick a smaller one.`;
  }
  if (!watermarkImageFormat(bytes)) {
    return "The watermark image must be a PNG or JPEG file.";
  }
  return null;
}

/**
 * The 0-based page indices to stamp. A typed list goes through the same
 * parser as Extract and Remove pages, and a mistake in it is reported in its
 * words, before any page is touched.
 */
export function watermarkPageIndices(
  pages: string | undefined,
  pageCount: number,
): number[] {
  if (pages === undefined || pages.trim() === "") {
    return Array.from({ length: pageCount }, (_, i) => i);
  }
  try {
    return parsePageList(pages, pageCount);
  } catch (error) {
    if (error instanceof PageRangeError) {
      throw new PdfEngineError(error.message);
    }
    throw error;
  }
}

export async function addWatermark(
  bytes: Uint8Array,
  text: string,
  options: WatermarkOptions = {},
): Promise<Uint8Array> {
  return (await watermarkPdf(bytes, text, options)).bytes;
}

/** Where to draw a `width × height` mark on one page, in content space. */
function placementsFor(
  page: PDFPage,
  width: number,
  height: number,
  tilt: number,
  position: WatermarkPosition,
): StampPlacement[] {
  const box = visibleBox(page);
  const pageRotation = page.getRotation().angle;
  if (position === "tile") {
    return tilePlacements({ box, pageRotation, width, height, tilt });
  }
  if (position === "middle-center") {
    // The original path, kept literally: centred on the visible box, not on
    // (0,0)-(w,h), since a CropBox or a MediaBox that does not start at the
    // origin moves what a reader sees.
    return [
      placeCenteredStamp({
        box,
        pageRotation,
        textWidth: width,
        textHeight: height,
        tilt,
      }),
    ];
  }
  const { h, v } = resolveAlign(position);
  return [
    placeTiltedStamp({
      box,
      pageRotation,
      width,
      height,
      tilt,
      h,
      v,
      inset: WATERMARK_INSET,
    }),
  ];
}

/**
 * {@link addWatermark}, plus what happened on the way: how many pages were
 * stamped, how many marks were drawn and how many pages needed a smaller size
 * than the one asked for. A runner that only has the bytes can only say
 * "Stamped on all N pages".
 */
export async function watermarkPdf(
  bytes: Uint8Array,
  text: string,
  options: WatermarkOptions = {},
): Promise<WatermarkReport> {
  const image = options.image;
  if (!image) validateWatermarkText(text);
  const imageProblem = image ? watermarkImageProblem(image.bytes) : null;
  if (imageProblem) throw new PdfEngineError(imageProblem);
  const imageFormat = image ? watermarkImageFormat(image.bytes) : null;

  const value = text.trim();
  const fontSize = clamp(options.fontSize ?? 60, 8, 240);
  const opacity = clamp(options.opacity ?? 0.18, 0.02, 1);
  const tilt = clamp(options.rotation ?? 45, -90, 90);
  const imageScale = clamp(image?.scale ?? DEFAULT_IMAGE_SCALE, 5, 100) / 100;
  const position = options.position ?? "middle-center";
  const behind = options.layer === "behind";
  const pdfLib = await loadPdfLib();
  const { degrees, rgb } = pdfLib;
  const color = toRgb(rgb, options.color ?? WATERMARK_INK);

  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const targets = watermarkPageIndices(options.pages, pages.length);

  let embedded: PDFImage | null = null;
  let aspect = 1;
  if (image && imageFormat) {
    try {
      embedded = await embedRasterImage(doc, image.bytes, imageFormat);
    } catch (error) {
      throw new PdfEngineError(
        "This image could not be read. Try saving it again as a PNG or JPEG.",
        { cause: error },
      );
    }
    const shown = rasterDisplaySize(embedded);
    aspect = shown.height / shown.width;
  }

  // One string, drawn on every stamped page — the whole corpus this document
  // stamps. Not embedded at all for an image mark.
  const font = embedded
    ? null
    : await embedStampFont(doc, [value], "bold", options.font);
  const textWidth = font ? font.widthOfTextAtSize(value, fontSize) : 0;
  const textHeight = font ? font.heightAtSize(fontSize) : 0;

  let shrunkPages = 0;
  let smallestFontSize = fontSize;
  let placements = 0;

  for (const index of targets) {
    const page = pages[index]!;
    const box = visibleBox(page);
    const pageRotation = page.getRotation().angle;
    const wanted = embedded
      ? (() => {
          const w = viewerSize(box, pageRotation).width * imageScale;
          return { width: w, height: w * aspect };
        })()
      : { width: textWidth, height: textHeight };
    const scale = fitWatermarkScale({
      boxWidth: box.width,
      boxHeight: box.height,
      textWidth: wanted.width,
      textHeight: wanted.height,
      theta: normalizeRotation(pageRotation) + tilt,
      fit: position === "tile" ? TILE_FIT : WATERMARK_FIT,
    });
    if (scale < 1) shrunkPages += 1;
    const width = wanted.width * scale;
    const height = wanted.height * scale;

    const spots = placementsFor(page, width, height, tilt, position);
    for (const spot of spots) {
      if (embedded) {
        await drawRasterImage(page, embedded, {
          x: spot.x,
          y: spot.y,
          width,
          height,
          opacity,
          rotate: degrees(spot.rotate),
        });
      } else {
        // Font metrics are linear in size, so the scaled box is exact.
        page.drawText(value, {
          x: spot.x,
          y: spot.y,
          size: fontSize * scale,
          font: font!,
          color,
          opacity,
          rotate: degrees(spot.rotate),
        });
      }
    }
    placements += spots.length;
    if (!embedded)
      smallestFontSize = Math.min(smallestFontSize, fontSize * scale);
    if (behind && spots.length > 0) sendDrawingToBack(page, pdfLib);
  }

  stampProducer(doc);
  return {
    bytes: await doc.save(),
    pages: targets.length,
    totalPages: pages.length,
    placements,
    shrunkPages,
    smallestFontSize,
  };
}

/**
 * Move what this run drew on `page` underneath the page's own content.
 *
 * pdf-lib appends every draw on a page to ONE new content stream, pushed last
 * onto `/Contents` (after it wraps the existing streams in `q … Q`), and each
 * draw is itself bracketed by `q … Q`. So the last stream is exactly the mark,
 * self-contained, and painting it first leaves it under everything else.
 * Opaque content — a scanned page, a filled background — then hides it.
 */
function sendDrawingToBack(
  page: PDFPage,
  pdfLib: Awaited<ReturnType<typeof loadPdfLib>>,
): void {
  const contents = page.node.Contents();
  if (!(contents instanceof pdfLib.PDFArray) || contents.size() < 2) return;
  const last = contents.get(contents.size() - 1);
  contents.remove(contents.size() - 1);
  contents.insert(0, last);
}
