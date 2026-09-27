import { outputName } from "./files";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";
import { awaitPdfjsDocument, loadPdfjs } from "./pdfjs";

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
 * WHY THE FLAG STAYS ON AND THE PADDING IS REMOVED AFTERWARDS, rather than the
 * simpler-looking "just drop `-layout`": **`-layout` is the only mode that
 * reconstructs the page's VISUAL READING ORDER.** The other two each give that
 * up, in different ways, and both failures are silent.
 *
 * Measured on the production worker, `pdftotext` **22.12.0** (poppler), a
 * four-column table:
 *
 * ```
 *   -layout   142 chars   Region   Q1     Q2     Q3   /  North    1200   1350
 *   default   115 chars   Region|Q1|Q2|Q3|North|1200|1350|1410|South|…
 *   -raw       95 chars   Region Q1 Q2 Q3  /  North 1200 1350 1410
 * ```
 *
 * **default** is row-major but flattened — one cell per line, no row boundaries.
 * A model can only recover the table by assuming a fixed width and counting,
 * which works on a perfect rectangle and breaks on a merged or missing cell.
 *
 * **`-raw`** means "strings in content-stream order", which is not visual order:
 * a page whose generator emitted blocks 4, 2, 1, 3 comes out 4, 2, 1, 3.
 * Generators do this constantly — LaTeX, Word exports, anything with footnotes
 * or flowed columns. A summary or translation built on that is fluent, complete
 * and **in the wrong order**, with nothing to warn. Same family as running OCR
 * in the wrong language.
 *
 * ⚠️ AN EARLIER VERSION OF THIS NOTE SAID `default` TRANSPOSES THE TABLE. That
 * was measured on Xpdf `pdftotext` 4.00, which groups by column; poppler 22.12.0
 * flattens instead. **The claim was binary-specific and does not reproduce on the
 * binary we ship** — recorded so the next person testing elsewhere is not
 * confused by it. The conclusion did not change, but the reason it rested on was
 * wrong, and a reason that does not reproduce is worse than no reason.
 *
 * On ordinary prose this collapse is a no-op — single-column text has no runs of
 * two or more spaces, which is why the extractor divergence was 1.0001 there.
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

/**
 * The page numbers `joinPageTexts` DROPS — pages whose text normalizes to
 * nothing (a scanned sheet with no text layer, a blank separator).
 *
 * The join leaves no marker where they were: survivors are joined with the
 * same blank line as a paragraph break, which the worker parse path and the
 * AI page-offset math rely on. So a caller that reports "from N pages" must
 * name these, or a partly scanned document reads as complete. Derived as the
 * complement of {@link pageTextChunks}, so "empty" means exactly what the join
 * means by it — `text.test.ts` pins the two as a partition.
 */
export function pagesWithoutText(
  pages: Pick<ExtractedTextPage, "text" | "pageNumber">[],
): number[] {
  const kept = new Set(pageTextChunks(pages).map((chunk) => chunk.pageNumber));
  return pages
    .map((page) => page.pageNumber)
    .filter((pageNumber) => !kept.has(pageNumber));
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
  const doc = await awaitPdfjsDocument(loadingTask);

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

/**
 * Whether a PDF has ANY selectable text — the same answer as
 * `extractPdfText(bytes).hasText`, but it stops at the first page that has
 * some, so a normal document costs one page's parse rather than all of them.
 *
 * The predicate is `pageTextChunks` itself (a page counts when its normalized
 * text is non-empty), which is exactly what makes the joined text — and so
 * `hasText` — non-empty. `ai-text-preflight.test.ts` pins the two against each
 * other over blank, image-only, whitespace-only and late-text fixtures.
 *
 * Throws when pdfjs cannot open the file (encrypted, damaged); a caller that
 * has no verdict must not invent one.
 */
export async function pdfHasSelectableText(
  bytes: Uint8Array,
): Promise<boolean> {
  const pdfjs = await loadPdfjs();
  const data = bytes.slice();
  const loadingTask = pdfjs.getDocument({ data, ...PDFJS_DOCUMENT_DEFAULTS });
  const doc = await awaitPdfjsDocument(loadingTask);
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      try {
        const content = await page.getTextContent({
          includeMarkedContent: false,
        });
        const text = textItemsToPlainText(content.items as TextItemLike[]);
        if (pageTextChunks([{ pageNumber, text }]).length > 0) return true;
      } finally {
        page.cleanup();
      }
    }
    return false;
  } finally {
    try {
      doc.cleanup();
    } catch {
      // best effort
    }
    await loadingTask.destroy().catch(() => {});
  }
}
