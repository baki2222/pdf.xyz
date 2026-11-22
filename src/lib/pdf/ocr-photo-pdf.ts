/**
 * Photos and scans made into ONE PDF in the browser, for OCR PDF's existing,
 * already-proved PDF path (audits ocr-pdf#2 and ocr-pdf#3, 2026-11-22).
 *
 *  - ocr-pdf#2. A JPG or PNG sent on its own goes to Tesseract, which has no
 *    straighten or turn step. With "Straighten crooked pages" or "Turn pages
 *    upright" ticked, the panel now puts the photo on a PDF page here first
 *    and sends that PDF, so OCRmyPDF's `--deskew` and `--rotate-pages` reach
 *    it exactly as they reach a scanned PDF. No new worker capability: the
 *    worker sees a one-page PDF.
 *  - ocr-pdf#3. "Combine into one PDF" puts every file, in the order listed,
 *    into one PDF here: each photo a page, each PDF all its pages. One upload
 *    and one job; the worker still reads one file per job
 *    (`OCR_MAX_INPUT_FILES`).
 *
 * Each photo's page: the JPEG is embedded as it is (its DCT stream, never
 * re-encoded; a PNG is embedded as PNG), its EXIF turn applied by the page's
 * drawing (`embedRasterImage` / `drawRasterImage`, the path JPG to PDF uses),
 * and the page sized from a resolution OCRmyPDF can trust: the one the file
 * declares, raised just enough that the page's longer side is no longer than
 * A4's. `ocrPageDpi` is the same rule the worker applies to an image it reads
 * itself (`ocrImageDpi` in `src/lib/workers/ocr-image.ts`);
 * `ocr-photo-pdf.test.ts` holds the two equal over a grid of sizes, since
 * this browser module cannot import that server one.
 *
 * Loaded on demand by the OCR panel and its batch, never on a first load.
 */
import {
  drawRasterImage,
  embedRasterImage,
  loadPdfLib,
  rasterDisplaySize,
  type RasterImageFormat,
} from "./pdf-lib";
import { loadPdf } from "./engine";
import { assemblePages, type PageSource } from "./page-copy";
import { storedImageDpi } from "./image-density";
import { baseName } from "./files";
import { OCR_IMAGE_PAGE_BOUND } from "@/lib/jobs/ocr";

/** One file to put into the PDF. */
export interface OcrPdfSource {
  name: string;
  /** The content type the upload would send (`image/jpeg`, `application/pdf`). */
  type: string;
  bytes: Uint8Array;
}

/** The longest page side, in inches, a photo's page may have: A4's. */
const MAX_PAGE_INCHES =
  Math.max(...Object.values(OCR_IMAGE_PAGE_BOUND.size!)) / 72;
/** The least resolution a page is given (a phone's own 72 dpi). */
const MIN_DPI = 72;
/** Tesseract's highest credible resolution; a figure above it is not believed. */
const MAX_CREDIBLE_DPI = 2400;

/**
 * The resolution a `width` x `height` photo's page is sized at: the declared
 * figure (null: none), raised just enough that the longer side fits A4's
 * length (never past what Tesseract believes), and never below 72 dpi.
 */
export function ocrPageDpi(
  width: number,
  height: number,
  declared: number | null,
): number {
  const fit = Math.ceil(Math.max(width, height) / MAX_PAGE_INCHES);
  return Math.max(MIN_DPI, declared ?? 0, Math.min(fit, MAX_CREDIBLE_DPI));
}

function rasterFormat(source: OcrPdfSource): RasterImageFormat | null {
  const b = source.bytes;
  if (b[0] === 0xff && b[1] === 0xd8) return "jpg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return "png";
  return null;
}

/**
 * One PDF holding every source, in order: a photo becomes one page, a PDF
 * gives all its pages. Throws the PDF engine's own plain-words error for a
 * PDF that cannot be opened (a password, damage), and a plain error for a
 * file that is neither.
 */
export async function buildOcrPdf(
  sources: readonly OcrPdfSource[],
): Promise<Uint8Array> {
  const lib = await loadPdfLib();
  // Every source becomes a document of its own, then the clean assembler
  // (`./page-copy`, the one path that copies pages: page-copy.test.ts holds
  // that no other code calls copyPages) joins them in order as a merge.
  const parts: PageSource[] = [];
  for (const source of sources) {
    const format = rasterFormat(source);
    if (format) {
      const one = await lib.PDFDocument.create();
      const image = await embedRasterImage(one, source.bytes, format);
      const shown = rasterDisplaySize(image);
      const declared = storedImageDpi(source.bytes) ?? null;
      const k = 72 / ocrPageDpi(shown.width, shown.height, declared);
      const width = shown.width * k;
      const height = shown.height * k;
      const page = one.addPage([width, height]);
      await drawRasterImage(page, image, { x: 0, y: 0, width, height });
      // Saved and read back, so the embedded image is a written object the
      // assembler can copy (pdf-lib writes an embedded image on save).
      parts.push({
        doc: await lib.PDFDocument.load(await one.save()),
        indices: [0],
      });
      continue;
    }
    if (
      source.type === "application/pdf" ||
      source.name.toLowerCase().endsWith(".pdf")
    ) {
      const from = await loadPdf(source.bytes);
      parts.push({ doc: from, indices: from.getPageIndices() });
      continue;
    }
    throw new Error(
      `${source.name} is not a PDF, JPG or PNG, so it cannot be added.`,
    );
  }
  const { out } = await assemblePages(lib, parts, { documentState: "merge" });
  out.setProducer("pdf.xyz");
  out.setCreator("pdf.xyz");
  return out.save();
}

/** The name the made PDF is uploaded under, so the result is named after it. */
export function ocrPdfName(
  sources: readonly Pick<OcrPdfSource, "name">[],
): string {
  const first = baseName(sources[0]?.name ?? "scan");
  return sources.length === 1 ? `${first}.pdf` : `${first}-combined.pdf`;
}
