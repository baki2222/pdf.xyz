import { embedRasterImage, loadPdfLib } from "./pdf-lib";
import { baseName, outputName } from "./files";
import { encodeGrayJpeg } from "./gray-jpeg";
import { clampJpegQuality } from "./pdf-to-image";
import {
  capturePdfPages,
  luminancePlane,
  type RasterCanvasInfo,
  type RasterPage,
} from "./render";
import { GRAYSCALE_DPI_PRESETS } from "./offered-kinds";

const PRODUCER = "pdf.xyz";

// The presets live in the offered-kinds leaf, where the tool page's answer
// reads them too; re-exported so existing importers keep working.
export { GRAYSCALE_DPI_PRESETS };

export type GrayscaleDpiPreset = (typeof GRAYSCALE_DPI_PRESETS)[number]["id"];

/** Default JPEG quality — what the canvas encoder was asked for before. */
const DEFAULT_QUALITY = 0.88;

export interface GrayscaleOptions {
  dpi?: number;
  quality?: number;
  /**
   * The uploaded file's name. The output's Title falls back to its stem when
   * the source PDF carries no title of its own.
   */
  sourceName?: string;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

/**
 * How one page image was stored. BOTH are single-channel DeviceGray images; the
 * encoding is chosen per page, whichever is smaller.
 */
export type GrayPageEncoding = "jpeg" | "flate";

export interface GrayscaleResult {
  bytes: Uint8Array;
  pageCount: number;
  totalImageBytes: number;
  /**
   * Images the renderer could not decode, and which are therefore missing from
   * the output. This tool rasterizes through the same path as redact and the
   * image converters, so it can lose content the same way and says so.
   */
  undecodedImages: number;
}

/**
 * Said on the result screen when the output is larger than the input. Pages
 * become JPEGs, so a text PDF grows by two orders of magnitude (x146 at 96 DPI,
 * x310 at 150, measured); a scan can shrink, which is why this is conditional.
 */
export const GRAYSCALE_GREW_NOTE =
  "Pages are now images, so text-based PDFs usually get larger.";

export function grayscaleOutputName(sourceName: string): string {
  return outputName(sourceName || "document", "grayscale");
}

/**
 * The output document's Title: the source's own title when it has one, else
 * the uploaded file's stem — marked as the grayscale copy either way, so the
 * converted file is not indistinguishable from its original (or from every
 * other converted file) in a viewer's tab and window title.
 */
export function grayscaleTitle(
  sourceTitle: string | null | undefined,
  sourceName: string | undefined,
): string {
  const own = sourceTitle?.replace(/\s+/g, " ").trim();
  const stem = baseName(sourceName ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const name = own || stem;
  return name ? `${name} (grayscale)` : "Grayscale PDF";
}

export function grayscalePresetById(
  id: string,
): (typeof GRAYSCALE_DPI_PRESETS)[number] {
  return (
    GRAYSCALE_DPI_PRESETS.find((preset) => preset.id === id) ??
    GRAYSCALE_DPI_PRESETS[1]!
  );
}

export function pageSizeForRaster(
  page: Pick<RasterPage, "pageWidth" | "pageHeight" | "width" | "height">,
): [number, number] {
  const width =
    Number.isFinite(page.pageWidth) && page.pageWidth > 0
      ? page.pageWidth
      : page.width;
  const height =
    Number.isFinite(page.pageHeight) && page.pageHeight > 0
      ? page.pageHeight
      : page.height;
  return [Math.max(1, width), Math.max(1, height)];
}

/** One page as it went into the output document. */
export interface GrayPageRecord {
  encoding: GrayPageEncoding;
  /** Stored (compressed) size of the page image stream, in bytes. */
  imageBytes: number;
}

/**
 * Builds the grayscale output one page at a time, from luminance planes.
 *
 * Every page image is a SINGLE-CHANNEL image — `/ColorSpace /DeviceGray` —
 * because that, not how the pixels look, is what a print driver, a print
 * shop's preflight and Acrobat's Output Preview read to decide whether a file
 * is colour. (The canvas JPEG this replaced was three-component, so pdf-lib
 * embedded neutral pixels as DeviceRGB: grey to the eye, colour to the printer.)
 *
 * Each plane is stored both ways and the smaller is kept:
 *  - a one-component baseline JPEG (`DCTDecode`), which wins on photographs
 *    and scans; or
 *  - the raw plane under `FlateDecode`, which is LOSSLESS and wins on text —
 *    measured at 150 DPI on a Letter page of body text, 125 KB against 270 KB.
 * So no page is ever larger than the one-component JPEG alone, and text pages
 * lose no sharpness to JPEG ringing.
 *
 * Pure pdf-lib, DOM-free: the Node tests drive this same builder.
 */
export interface GrayscaleBuilder {
  addPage(plane: Uint8Array, page: RasterCanvasInfo): Promise<GrayPageRecord>;
  /** One record per page added so far, in page order. */
  readonly pages: readonly GrayPageRecord[];
  save(title: string): Promise<Uint8Array>;
}

export async function createGrayscaleBuilder({
  quality = DEFAULT_QUALITY,
}: { quality?: number } = {}): Promise<GrayscaleBuilder> {
  const {
    PDFDocument,
    concatTransformationMatrix,
    drawObject,
    popGraphicsState,
    pushGraphicsState,
  } = await loadPdfLib();
  const doc = await PDFDocument.create();
  doc.setProducer(PRODUCER);
  doc.setCreator(PRODUCER);
  const jpegQuality = clampJpegQuality(quality);
  const pages: GrayPageRecord[] = [];
  const record = (entry: GrayPageRecord): GrayPageRecord => {
    pages.push(entry);
    return entry;
  };

  return {
    pages,
    async addPage(plane, page) {
      if (plane.length !== page.width * page.height) {
        throw new RangeError(
          `Page ${page.index + 1}: luminance plane holds ${plane.length} samples for a ${page.width}×${page.height} image.`,
        );
      }
      const [pageWidth, pageHeight] = pageSizeForRaster(page);
      const jpeg = encodeGrayJpeg(plane, page.width, page.height, jpegQuality);
      const flate = doc.context.flateStream(plane, {
        Type: "XObject",
        Subtype: "Image",
        Width: page.width,
        Height: page.height,
        ColorSpace: "DeviceGray",
        BitsPerComponent: 8,
      });

      // No background fill: the image is opaque and covers the whole page.
      const outPage = doc.addPage([pageWidth, pageHeight]);
      if (flate.contents.length <= jpeg.length) {
        const name = outPage.node.newXObject("Im", doc.context.register(flate));
        outPage.pushOperators(
          pushGraphicsState(),
          concatTransformationMatrix(pageWidth, 0, 0, pageHeight, 0, 0),
          drawObject(name),
          popGraphicsState(),
        );
        return record({ encoding: "flate", imageBytes: flate.contents.length });
      }
      // pdf-lib maps a one-component JPEG to DeviceGray.
      const image = await embedRasterImage(doc, jpeg, "jpg");
      outPage.drawImage(image, {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
      });
      return record({ encoding: "jpeg", imageBytes: jpeg.length });
    },
    async save(title) {
      doc.setTitle(title);
      return doc.save();
    },
  };
}

/**
 * Convert a PDF to a grayscale PDF by rendering every page locally, taking its
 * luminance plane, and rebuilding a PDF of single-channel (DeviceGray) page
 * images at matching page dimensions.
 *
 * Honest scope: this is a print/raster output. It intentionally flattens text,
 * vectors, forms, and annotations into page images; selectable text is not
 * preserved, and neither are bookmarks or links. Use it for print/ink
 * workflows, not archival/editable output.
 */
export async function grayscalePdf(
  bytes: Uint8Array,
  options: GrayscaleOptions = {},
): Promise<GrayscaleResult> {
  const builder = await createGrayscaleBuilder({ quality: options.quality });
  let sourceTitle: string | null = null;
  const pages = await capturePdfPages(bytes, {
    dpi: options.dpi ?? 150,
    signal: options.signal,
    onProgress: options.onProgress,
    onDocument: (info) => {
      sourceTitle = info.title;
    },
    capture: (canvas, page) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      const { data } = ctx.getImageData(0, 0, page.width, page.height);
      return builder.addPage(luminancePlane(data), page);
    },
  });
  // Counted from the builder, not from `pages`: on an abort the page being
  // captured is already in the document when the loop stops.
  if (builder.pages.length === 0)
    throw new Error("No pages could be rendered from this PDF.");

  return {
    bytes: await builder.save(grayscaleTitle(sourceTitle, options.sourceName)),
    pageCount: builder.pages.length,
    totalImageBytes: builder.pages.reduce(
      (sum, page) => sum + page.imageBytes,
      0,
    ),
    undecodedImages: pages.reduce((sum, page) => sum + page.undecodedImages, 0),
  };
}
