import { embedRasterImage, loadPdfLib } from "./pdf-lib";
import { baseName } from "./files";
import { encodeGrayJpeg } from "./gray-jpeg";
import { clampJpegQuality } from "./pdf-to-image";
import type { RasterCanvasInfo, RasterPage } from "./render";

/**
 * The part of Grayscale PDF that WRITES the output — the DeviceGray page
 * builder and the output title — kept apart from the page loop in
 * `./grayscale` because that loop imports `./render`, and `render.ts` uses
 * `import.meta.url`.
 *
 * WHY A LEAF. The browser proof (`e2e/client-proof/cases.ts`) builds its
 * grayscale controls with this builder and checks titles with
 * `grayscaleTitle`. Playwright loads that suite as CommonJS, where
 * `import.meta` is a syntax error, so importing them from `./grayscale` made
 * the whole client-proof spec fail to load — every client tool proof dark,
 * reported as zero tests. `src/tests/e2e-cjs-load.test.ts` compiles every
 * module that suite loads the way Playwright does; the same move was made for
 * redact's constants (`./redact-defaults`). The renderer is imported here for
 * TYPES only, which TypeScript erases.
 */

const PRODUCER = "pdf.xyz";

/** Default JPEG quality — what the canvas encoder was asked for before. */
const DEFAULT_QUALITY = 0.88;

/**
 * How one page image was stored. BOTH are single-channel DeviceGray images; the
 * encoding is chosen per page, whichever is smaller.
 */
export type GrayPageEncoding = "jpeg" | "flate";

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
