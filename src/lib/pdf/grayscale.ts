import { outputName } from "./files";
// The renderer (with pdf.js's loader) is imported when a run starts: this
// module's presets and names ride Grayscale PDF's first load.
const loadRender = () => import("./render");
import {
  createGrayscaleBuilder,
  grayscaleTitle,
  pageSizeForRaster,
  type GrayPageEncoding,
  type GrayPageRecord,
  type GrayscaleBuilder,
} from "./grayscale-builder";
import { GRAYSCALE_DPI_PRESETS } from "./offered-kinds";

// The builder and the title live in a leaf that does not import the renderer
// (see `./grayscale-builder`); re-exported so every caller keeps one import.
export {
  createGrayscaleBuilder,
  grayscaleTitle,
  pageSizeForRaster,
  type GrayPageEncoding,
  type GrayPageRecord,
  type GrayscaleBuilder,
};

// The presets live in the offered-kinds leaf, where the tool page's answer
// reads them too; re-exported so existing importers keep working.
export { GRAYSCALE_DPI_PRESETS };

export type GrayscaleDpiPreset = (typeof GRAYSCALE_DPI_PRESETS)[number]["id"];

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

export function grayscalePresetById(
  id: string,
): (typeof GRAYSCALE_DPI_PRESETS)[number] {
  return (
    GRAYSCALE_DPI_PRESETS.find((preset) => preset.id === id) ??
    GRAYSCALE_DPI_PRESETS[1]!
  );
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
  const { capturePdfPages, luminancePlane } = await loadRender();
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
