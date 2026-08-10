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

/** Join page blocks with a single blank line between non-empty pages. */
export function joinPageTexts(pages: Pick<ExtractedTextPage, "text">[]): string {
  return pages
    .map((page) => normalizeExtractedText(page.text))
    .filter((text) => text.length > 0)
    .join("\n\n");
}

export function textOutputName(sourceName: string): string {
  return outputName(sourceName, "text", "txt");
}

/**
 * Extract selectable text from a PDF in the browser. It deliberately does not
 * perform OCR; scanned/image-only documents return `hasText:false` so the UI can
 * honestly point users to OCR PDF.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<ExtractedPdfText> {
  const pdfjs = await loadPdfjs();
  const data = bytes.slice();
  const loadingTask = pdfjs.getDocument({ data, ...PDFJS_DOCUMENT_DEFAULTS });
  const doc = await loadingTask.promise;

  try {
    const pages: ExtractedTextPage[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      try {
        const content = await page.getTextContent({ includeMarkedContent: false });
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
