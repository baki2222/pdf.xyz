import type { PdfLayout, PdfLayoutPage, PositionedTextItem } from "@/lib/workers/table-extract/engine";

/**
 * Positioned selectable-text extraction for table detection.
 *
 * This is the geometric counterpart to `./text.ts`: instead of flattening a page
 * to a string, it keeps each pdfjs text run's page coordinates (x, y, width,
 * height) so the table engine can recover rows and columns from real layout. Like
 * text extraction it performs NO OCR — scanned/image-only pages return empty item
 * lists and the engine fails honestly as `no_text`.
 */

interface PdfTextItemLike {
  str?: unknown;
  width?: unknown;
  height?: unknown;
  /** pdfjs transform matrix [a, b, c, d, e, f]; e = x, f = y (PDF points, y up). */
  transform?: unknown;
}

let workerConfigured = false;

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  if (!workerConfigured) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    workerConfigured = true;
  }
  return pdfjs;
}

/** Convert a raw pdfjs text-content items array into positioned runs. */
export function textItemsToPositioned(items: PdfTextItemLike[]): PositionedTextItem[] {
  const positioned: PositionedTextItem[] = [];
  for (const item of items) {
    if (typeof item.str !== "string" || item.str.trim().length === 0) continue;
    const transform = item.transform;
    if (!Array.isArray(transform) || transform.length < 6) continue;
    const x = Number(transform[4]);
    const y = Number(transform[5]);
    const width = typeof item.width === "number" ? item.width : 0;
    // pdfjs height can be 0 for some fonts; fall back to the transform's scale.
    const height = typeof item.height === "number" && item.height > 0 ? item.height : Math.abs(Number(transform[3])) || 0;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    positioned.push({ text: item.str, x, y, width, height });
  }
  return positioned;
}

/**
 * Extract the positioned-text layout of a PDF using pdfjs. Deliberately does not
 * OCR: image-only pages yield empty `items`, which the table engine reports as
 * `no_text` rather than inventing content.
 */
export async function extractPdfLayout(bytes: Uint8Array): Promise<PdfLayout> {
  const pdfjs = await loadPdfjs();
  const data = bytes.slice();
  const loadingTask = pdfjs.getDocument({ data, verbosity: 0 });
  const doc = await loadingTask.promise;

  try {
    const pages: PdfLayoutPage[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent({ includeMarkedContent: false });
        pages.push({
          pageNumber,
          width: viewport.width,
          height: viewport.height,
          items: textItemsToPositioned(content.items as PdfTextItemLike[]),
        });
      } finally {
        page.cleanup();
      }
    }
    return { pageCount: doc.numPages, pages };
  } finally {
    try {
      doc.cleanup();
    } catch {
      // best effort
    }
    await loadingTask.destroy().catch(() => {});
  }
}
