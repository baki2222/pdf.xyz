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

export interface TextItemLike {
  str?: unknown;
  hasEOL?: unknown;
  /** pdfjs transform [a, b, c, d, e, f]; e = x, f = baseline y (PDF points, y up). */
  transform?: unknown;
  height?: unknown;
  fontName?: unknown;
}

/**
 * One visual line of a page, with the geometry of the text that starts it.
 *
 * `x`/`y` come from the line's first item that carries VISIBLE text, and `size`
 * is the largest glyph height among those items. Both skip the zero-size
 * `{str:"", hasEOL:true}` items pdfjs's `appendEOL` pushes: those carry the
 * transform of the NEXT line (measured on pdfjs 6.1.200: the EOL after a title
 * at y=740 reports y=704, the heading below it), so reading geometry from them
 * would place every line one line too low. A line with no visible text has
 * `null` geometry rather than a guessed one.
 */
export interface TextLine {
  text: string;
  x: number | null;
  y: number | null;
  size: number | null;
  fontName: string | null;
}

/** An extracted page that also keeps its visual lines (see `extractPdfLines`). */
export interface ExtractedLinePage extends ExtractedTextPage {
  lines: TextLine[];
}

export interface ExtractedPdfLines extends ExtractedPdfText {
  pages: ExtractedLinePage[];
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

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Glyph size of one item: its height, or the transform's vertical scale when
 * pdfjs reports a height of 0 (it does for some fonts, and for spaces). */
function itemSize(item: TextItemLike): number | null {
  const height = finiteNumber(item.height);
  if (height !== null && height > 0) return height;
  if (Array.isArray(item.transform) && item.transform.length >= 4) {
    const c = finiteNumber(item.transform[2]);
    const d = finiteNumber(item.transform[3]);
    if (c !== null && d !== null) {
      const scale = Math.hypot(c, d);
      if (scale > 0) return scale;
    }
  }
  return null;
}

/**
 * Split pdfjs text items into visual lines, keeping each line's geometry.
 *
 * The line boundaries are EXACTLY `textItemsToPlainText`'s — an item's
 * `hasEOL`, or a newline inside its string — so the lines' text, joined with
 * `\n` and normalized, is that function's output byte for byte (text.test.ts
 * pins the equality). Only the geometry is new.
 */
export function textItemsToLines(items: TextItemLike[]): TextLine[] {
  const lines: TextLine[] = [];
  let current: TextLine = emptyLine();

  function emptyLine(): TextLine {
    return { text: "", x: null, y: null, size: null, fontName: null };
  }
  const push = () => {
    lines.push(current);
    current = emptyLine();
  };

  for (const item of items) {
    if (typeof item.str !== "string") continue;
    const segments = item.str.split(/\r\n?|\n/);
    segments.forEach((segment, index) => {
      if (index > 0) push();
      current.text += segment;
      if (segment.trim().length === 0) return;
      const transform = Array.isArray(item.transform) ? item.transform : [];
      if (current.y === null) {
        current.x = finiteNumber(transform[4]);
        current.y = finiteNumber(transform[5]);
        current.fontName =
          typeof item.fontName === "string" ? item.fontName : null;
      }
      const size = itemSize(item);
      if (size !== null && (current.size === null || size > current.size)) {
        current.size = size;
      }
    });
    if (item.hasEOL === true) push();
  }
  if (current.text.length > 0) push();
  return lines;
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
 * Open a PDF with pdfjs and hand each page's text items to `perPage`. The one
 * `getDocument` call both extractors share, so they cannot drift in options.
 */
async function readPageTextItems<T>(
  bytes: Uint8Array,
  perPage: (items: TextItemLike[], pageNumber: number) => T,
): Promise<{ pageCount: number; pages: T[] }> {
  const pdfjs = await loadPdfjs();
  const data = bytes.slice();
  const loadingTask = pdfjs.getDocument({ data, ...PDFJS_DOCUMENT_DEFAULTS });
  const doc = await loadingTask.promise;

  try {
    const pages: T[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      try {
        const content = await page.getTextContent({
          includeMarkedContent: false,
        });
        pages.push(perPage(content.items as TextItemLike[], pageNumber));
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

function textPage(
  items: TextItemLike[],
  pageNumber: number,
): ExtractedTextPage {
  const text = textItemsToPlainText(items);
  return { pageNumber, text, characterCount: text.length };
}

/**
 * One page as `extractPdfLines` builds it, from that page's pdfjs items.
 * Exported so a test can drive the exact per-page composition over items from
 * a real pdfjs run (the browser build cannot load in Node).
 */
export function linePageFromItems(
  items: TextItemLike[],
  pageNumber: number,
): ExtractedLinePage {
  return { ...textPage(items, pageNumber), lines: textItemsToLines(items) };
}

/** Assemble per-page results into the document result both extractors return. */
export function assembleExtraction<P extends ExtractedTextPage>(
  pageCount: number,
  pages: P[],
): Omit<ExtractedPdfText, "pages"> & { pages: P[] } {
  const text = joinPageTexts(pages);
  return {
    pageCount,
    pages,
    text,
    characterCount: text.length,
    hasText: text.trim().length > 0,
  };
}

/**
 * Extract selectable text from a PDF in the browser. It deliberately does not
 * perform OCR; scanned/image-only documents return `hasText:false` so the UI can
 * honestly point users to OCR PDF.
 */
export async function extractPdfText(
  bytes: Uint8Array,
): Promise<ExtractedPdfText> {
  const { pageCount, pages } = await readPageTextItems(bytes, textPage);
  return assembleExtraction(pageCount, pages);
}

/**
 * `extractPdfText`, plus each page's visual lines with their geometry.
 *
 * A separate function rather than a new field on `extractPdfText`, because
 * pdf-to-text, compare-pdf and translate (whose `pageTextChunks` offsets and
 * page numbers depend on the text) must not change. Every text field here is
 * computed by the same code from the same items, so `hasText`, `pageCount` and
 * `characterCount` — the scanned-PDF path — are identical.
 */
export async function extractPdfLines(
  bytes: Uint8Array,
): Promise<ExtractedPdfLines> {
  const { pageCount, pages } = await readPageTextItems(
    bytes,
    linePageFromItems,
  );
  return assembleExtraction(pageCount, pages);
}
