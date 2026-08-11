import { outputName } from "./files";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";

/** One extracted page of selectable PDF text. Page numbers are 1-based. */
export interface ExtractedTextPage {
  pageNumber: number;
  text: string;
  characterCount: number;
}

/** Browser-side selectable-text extraction result. This is not OCR. */
export interface ExtractedPdfText {
  pageCount: number;
  pages: ExtractedTextPage[];
  text: string;
  characterCount: number;
  hasText: boolean;
}

interface TextItemLike {
  str?: unknown;
  hasEOL?: unknown;
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

/**
 * Convert pdfjs text items into readable page text. pdfjs already provides real
 * space glyphs for most PDFs; this helper preserves them, honors explicit EOLs,
 * and avoids inventing text that is not present in the document.
 */
export function textItemsToPlainText(items: TextItemLike[]): string {
  let text = "";
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    text += item.str;
    if (item.hasEOL === true) text += "\n";
  }
  return normalizeExtractedText(text);
}

/** Normalize line endings and whitespace without changing the words themselves. */
export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Collapse `pdftotext -layout`'s inter-column padding to a single space, keeping
 * every line break.
 *
 * `-layout` reconstructs a page's horizontal arrangement by padding between
 * columns, which carries TWO things: that cells are separated (load-bearing) and
 * how wide the gap is (not). This keeps the first and discards the second.
 *
 * MEASURED 2026-08-11, a four-column table, same PDF three ways:
 *
 * ```
 *   -layout   97 chars   Region  Q1    Q2    Q3 / North   1200  1350  1410
 *   default   79 chars   Region North South East / Q1 1200 980 1440   ← TRANSPOSED
 *   -raw      76 chars   Region Q1 Q2 Q3 / North 1200 1350 1410
 * ```
 *
 * The middle row is why the AI engines still pass `-layout` and collapse
 * afterwards rather than simply dropping the flag: `pdftotext`'s default mode
 * re-derives reading order and grouped that table by COLUMN, transposing it.
 * Handing a model a transposed table is a silent semantic corruption, and a far
 * worse defect than an inflated character count. Collapsing `-layout` reaches the
 * same 76 characters as `-raw` with the rows intact.
 *
 * On ordinary prose this is a no-op — single-column text has no runs of two or
 * more spaces, which is why the extractor divergence was 1.0001 there.
 */
export function collapseLayoutPadding(text: string): string {
  return text.replace(/[ \t]{2,}/g, " ");
}

/** The separator `joinPageTexts` puts between pages. Exported so a caller can
 * compute offsets into the joined string without guessing it. */
export const PAGE_JOIN = "\n\n";

/**
 * The normalized, non-empty page blocks that `joinPageTexts` joins — WITH their
 * real page numbers.
 *
 * Exported because normalization changes lengths and empty pages are dropped,
 * so anything reasoning about offsets or page numbers in the joined string must
 * use these exact chunks. Deriving them separately is how a truncation notice
 * ends up naming a page that is off by however many blank pages preceded it.
 */
export function pageTextChunks(
  pages: Pick<ExtractedTextPage, "text" | "pageNumber">[],
): { pageNumber: number; text: string }[] {
  return pages
    .map((page) => ({
      pageNumber: page.pageNumber,
      text: normalizeExtractedText(page.text),
    }))
    .filter((chunk) => chunk.text.length > 0);
}

/** Join page blocks with a single blank line between non-empty pages. */
export function joinPageTexts(
  pages: Pick<ExtractedTextPage, "text" | "pageNumber">[],
): string {
  return pageTextChunks(pages)
    .map((chunk) => chunk.text)
    .join(PAGE_JOIN);
}

export function textOutputName(sourceName: string): string {
  return outputName(sourceName, "text", "txt");
}

/**
 * Extract selectable text from a PDF in the browser. It deliberately does not
 * perform OCR; scanned/image-only documents return `hasText:false` so the UI can
 * honestly point users to OCR PDF.
 */
export async function extractPdfText(
  bytes: Uint8Array,
): Promise<ExtractedPdfText> {
  const pdfjs = await loadPdfjs();
  const data = bytes.slice();
  const loadingTask = pdfjs.getDocument({ data, ...PDFJS_DOCUMENT_DEFAULTS });
  const doc = await loadingTask.promise;

  try {
    const pages: ExtractedTextPage[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      try {
        const content = await page.getTextContent({
          includeMarkedContent: false,
        });
        const text = textItemsToPlainText(content.items as TextItemLike[]);
        pages.push({
          pageNumber,
          text,
          characterCount: text.length,
        });
      } finally {
        page.cleanup();
      }
    }

    const text = joinPageTexts(pages);
    return {
      pageCount: doc.numPages,
      pages,
      text,
      characterCount: text.length,
      hasText: text.trim().length > 0,
    };
  } finally {
    try {
      doc.cleanup();
    } catch {
      // best effort
    }
    await loadingTask.destroy().catch(() => {});
  }
}
