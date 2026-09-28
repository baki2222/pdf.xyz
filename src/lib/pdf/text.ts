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

export interface TextItemLike {
  str?: unknown;
  hasEOL?: unknown;
  /**
   * pdfjs `[a, b, c, d, e, f]`: scale/skew, then the baseline origin — e = x,
   * f = baseline y (PDF points, y up).
   */
  transform?: unknown;
  width?: unknown;
  height?: unknown;
  dir?: unknown;
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

/**
 * Convert pdfjs text items into readable page text. pdfjs already provides real
 * space glyphs for most PDFs; this helper preserves them, honors explicit EOLs,
 * and avoids inventing text that is not present in the document.
 *
 * Lines come out in READING order — see {@link readingOrder}. Items without
 * geometry (as in unit tests) keep the order they were given in.
 */
export function textItemsToPlainText(items: TextItemLike[]): string {
  const lines = itemLines(items);
  const order = lines ? readingOrder(lines) : null;
  if (!lines || !order) {
    let text = "";
    for (const item of items) {
      if (typeof item.str !== "string") continue;
      text += item.str;
      if (item.hasEOL === true) text += "\n";
    }
    return normalizeExtractedText(text);
  }
  return normalizeExtractedText(
    order
      .map((block) => {
        const text = block.map((i) => lines[i]!.text).join("");
        return text.endsWith("\n") ? text : `${text}\n`;
      })
      .join(""),
  );
}

/** A line's extent in PDF user space (y grows upward). */
interface Box {
  left: number;
  right: number;
  bottom: number;
  top: number;
  /** Font size of its largest item — the unit every tolerance is measured in. */
  size: number;
}

interface ItemLine {
  /** The line's text exactly as stream order emits it, EOL included. */
  text: string;
  /** `null` for a line with no visible text (blank, or only whitespace). */
  box: Box | null;
}

/**
 * The box of one item, or `undefined` when its geometry cannot be trusted for
 * ordering: rotated or skewed (b, c ≠ 0), mirrored, vertical writing, or no
 * transform at all. Returns `null` for an item that draws nothing visible.
 */
function itemBox(item: TextItemLike): Box | null | undefined {
  if (typeof item.str !== "string" || item.str.trim() === "") return null;
  const t = item.transform;
  if (!Array.isArray(t) || t.length < 6) return undefined;
  const [a, b, c, d, e, f] = t as unknown[];
  if (
    ![a, b, c, d, e, f].every((n) => typeof n === "number" && isFinite(n)) ||
    b !== 0 ||
    c !== 0 ||
    (a as number) <= 0 ||
    (d as number) <= 0 ||
    item.dir === "ttb"
  ) {
    return undefined;
  }
  const size = d as number;
  const width =
    typeof item.width === "number" && isFinite(item.width) ? item.width : 0;
  return {
    left: e as number,
    right: (e as number) + Math.max(width, 0),
    bottom: f as number,
    top: (f as number) + size,
    size,
  };
}

/**
 * Split items into lines at pdfjs's own EOLs, keeping each line's text as
 * stream order emits it. `null` when any visible item's geometry is untrusted
 * — the whole page then keeps stream order.
 */
function itemLines(items: TextItemLike[]): ItemLine[] | null {
  const lines: ItemLine[] = [];
  let text = "";
  let box: Box | null = null;
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    const own = itemBox(item);
    if (own === undefined) return null;
    if (own) {
      box = box
        ? {
            left: Math.min(box.left, own.left),
            right: Math.max(box.right, own.right),
            bottom: Math.min(box.bottom, own.bottom),
            top: Math.max(box.top, own.top),
            size: Math.max(box.size, own.size),
          }
        : own;
    }
    text += item.str;
    if (item.hasEOL === true) {
      lines.push({ text: `${text}\n`, box });
      text = "";
      box = null;
    }
  }
  if (text !== "") lines.push({ text, box });
  return lines;
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

const overlapsX = (a: Box, b: Box) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0;

const overlapsY = (a: Box, b: Box) =>
  Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom) > 0;

/**
 * Above this many blocks a page keeps stream order. Ordering is quadratic in
 * a page's blocks, and a page where every label is its own block (a map, a
 * CAD drawing, a table drawn cell by cell) must not stall the tab it runs in.
 * `text-reading-order.test.ts` pins the boundary from both sides.
 */
export const MAX_ORDERED_BLOCKS = 1000;

interface Block {
  lines: number[];
  box: Box;
}

/**
 * The order to emit a page's lines in, as blocks of line indices — or `null`
 * when stream order already is the reading order (the common case, which then
 * stays byte-identical).
 *
 * pdfjs gives items in CONTENT-STREAM order, and generators draw out of visual
 * order constantly: a title after the body it heads, a running header last, a
 * footer or page number first. A global sort by y then x is NOT the fix — a
 * two-column page is drawn a column at a time, stream order is right for it,
 * and a y-sort interleaves the columns line by line. So:
 *
 *  1. Consecutive lines form a BLOCK while each sits just below the last
 *     (no upward step, no gap over two line heights) and overlaps it
 *     horizontally — a paragraph, a column run.
 *  2. BANDS ({@link bandOrder}): where a horizontal cut crosses no block and
 *     the blocks above it are drawn as one unbroken run at an END of the
 *     stream — first or last — everything above reads before everything
 *     below. That is how a footer drawn first sinks under BOTH columns, and a
 *     header drawn last rises over both, as one move — rather than the
 *     columns being lifted past it one at a time, which is how the first
 *     version of this put the right column above the left. A cut the stream
 *     crosses back and forth (two columns, each in two sections) is not
 *     trusted, and neither is a run in the MIDDLE of the stream: that is the
 *     right column's top section when the left column starts lower (a figure
 *     over it) and the right one has a gap below that section, and lifting it
 *     read `R1 | L | R2`. Both pages read a column at a time.
 *  3. Within a band ({@link columnOrder}), blocks keep stream order, except
 *     that a block moves in front of the first earlier block it overlaps
 *     horizontally AND lies wholly above — a title or heading drawn after
 *     what it heads. A block that runs BESIDE one already placed is a later
 *     column, and never moves in front of it, nor in front of a block that
 *     spans that column (a full-width footnote joined to the left column's
 *     foot).
 *
 * One shape stays ambiguous: a right column that ENDS above where the left
 * one starts, with none of it beside the left, is — to stream order and
 * geometry alike — a header drawn last over the right column, and reads first.
 *
 * Rotated, mirrored or vertical text anywhere on the page, items without
 * geometry, or more than {@link MAX_ORDERED_BLOCKS} blocks keep the whole page
 * in stream order: no judgement is better than a wrong one.
 *
 * `text-reading-order.test.ts` pins both directions on real PDFs, and every
 * body composed with every piece of header and footer furniture.
 */
function readingOrder(lines: ItemLine[]): number[][] | null {
  const blocks: Block[] = [];
  let current: Block | null = null;
  let last: Box | null = null;
  for (let i = 0; i < lines.length; i++) {
    const box = lines[i]!.box;
    if (!box) {
      // A blank line belongs to whatever it follows.
      if (current) current.lines.push(i);
      else blocks.push((current = { lines: [i], box: emptyBox() }));
      continue;
    }
    const unit = Math.max(box.size, last?.size ?? 0);
    const continues =
      current !== null &&
      last !== null &&
      box.bottom <= last.bottom + unit * 0.5 &&
      last.bottom - box.top <= unit * 2 &&
      overlapsX(box, current.box);
    if (continues && current) {
      current.lines.push(i);
      current.box = union(current.box, box);
    } else {
      blocks.push((current = { lines: [i], box }));
    }
    last = box;
  }
  if (blocks.length > MAX_ORDERED_BLOCKS) return null;

  // Only leading blank lines can form a box-less block; they stay in front.
  const ordered = [
    ...blocks.filter((block) => isEmptyBox(block.box)),
    ...bandOrder(blocks.filter((block) => !isEmptyBox(block.box))),
  ];
  const moved = ordered.some((block, i) => block !== blocks[i]);
  return moved ? ordered.map((block) => block.lines) : null;
}

/** Whether `upper` lies wholly above `lower`, within a quarter line. */
const liesAbove = (upper: Box, lower: Box) =>
  upper.bottom >= lower.top - lower.size * 0.25;

/**
 * Split `blocks` (in stream order) at the highest horizontal cut that no block
 * crosses and whose upper side is drawn as one unbroken run at the start or
 * the end of the stream, then order each side the same way; with no such cut,
 * fall back to {@link columnOrder}.
 */
function bandOrder(blocks: Block[]): Block[] {
  if (blocks.length < 2) return blocks;
  const byTop = blocks
    .map((block, at) => ({ block, at }))
    .sort((a, b) => b.block.box.top - a.block.box.top || a.at - b.at);
  let floor: Box | null = null;
  let first = Infinity;
  let final = -Infinity;
  for (let k = 1; k < byTop.length; k++) {
    const { block, at } = byTop[k - 1]!;
    if (!floor || block.box.bottom < floor.bottom) floor = block.box;
    first = Math.min(first, at);
    final = Math.max(final, at);
    // Blocks after k have tops no higher than this one's, so clearing it
    // clears them all.
    const cut = liesAbove(floor, byTop[k]!.block.box);
    // The upper side must be one unbroken run at an END of the stream: drawn
    // first (the order already reads right) or last (a header drawn last, a
    // body drawn after its footer). A run in the MIDDLE is a later column's
    // top section when an earlier column beside it starts lower, and lifting
    // it would put the later column in front of the earlier one.
    const unbroken = final - first + 1 === k;
    const atAnEnd = first === 0 || final === blocks.length - 1;
    if (cut && unbroken && atAnEnd) {
      const above = new Set(byTop.slice(0, k).map((entry) => entry.block));
      return [
        ...bandOrder(blocks.filter((b) => above.has(b))),
        ...bandOrder(blocks.filter((b) => !above.has(b))),
      ];
    }
  }
  return columnOrder(blocks);
}

/** Stream order, with a block drawn late lifted over what it heads. */
function columnOrder(blocks: Block[]): Block[] {
  const ordered: Block[] = [];
  for (const block of blocks) {
    let at = ordered.findIndex(
      (earlier) =>
        overlapsX(block.box, earlier.box) && liesAbove(block.box, earlier.box),
    );
    if (at >= 0) {
      const target = ordered[at]!.box;
      // A block that runs BESIDE one already placed is a later column. It
      // must not land in front of that column, nor in front of a block that
      // spans it (a full-width footnote joined to the left column's foot).
      const refused = ordered.some(
        (placed, i) =>
          !overlapsX(placed.box, block.box) &&
          overlapsY(placed.box, block.box) &&
          (i >= at || overlapsX(placed.box, target)),
      );
      if (refused) at = -1;
    }
    if (at < 0) ordered.push(block);
    else ordered.splice(at, 0, block);
  }
  return ordered;
}

function union(a: Box, b: Box): Box {
  if (isEmptyBox(a)) return b;
  return {
    left: Math.min(a.left, b.left),
    right: Math.max(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
    top: Math.max(a.top, b.top),
    size: Math.max(a.size, b.size),
  };
}

const emptyBox = (): Box => ({
  left: Infinity,
  right: -Infinity,
  bottom: Infinity,
  top: -Infinity,
  size: 0,
});

const isEmptyBox = (box: Box) => box.left > box.right;

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
 * Which pdfjs build reads the bytes. The browser build is the only one a user
 * runs; a jsdom test passes pdfjs's legacy build, which is the same parser with
 * the DOM polyfills Node lacks, so the rest of the extraction — the part that
 * decides `hasText` — is the code that ships.
 */
export type PdfTextReader = () => Promise<
  Pick<typeof import("pdfjs-dist"), "getDocument">
>;

/**
 * Open a PDF with pdfjs and hand each page's text items to `perPage`. The one
 * `getDocument` call both extractors share, so they cannot drift in options.
 */
async function readPageTextItems<T>(
  bytes: Uint8Array,
  perPage: (items: TextItemLike[], pageNumber: number) => T,
  loadReader: PdfTextReader = loadPdfjs,
): Promise<{ pageCount: number; pages: T[] }> {
  const pdfjs = await loadReader();
  const data = bytes.slice();
  const loadingTask = pdfjs.getDocument({ data, ...PDFJS_DOCUMENT_DEFAULTS });
  const doc = await awaitPdfjsDocument(loadingTask);

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
  /** See {@link PdfTextReader}; tests pass pdfjs's legacy build. */
  loadReader: PdfTextReader = loadPdfjs,
): Promise<ExtractedPdfText> {
  const { pageCount, pages } = await readPageTextItems(
    bytes,
    textPage,
    loadReader,
  );
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
