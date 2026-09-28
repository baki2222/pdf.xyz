/**
 * Pure parsers for poppler `pdftotext` output.
 *
 * The worker cannot use the pdfjs-backed extractor in `@/lib/pdf/text` (nor the
 * pdfjs layout extractor that sat beside it until it was removed, unused, on
 * 2026-09-27): those are browser modules — pdfjs touches `DOMMatrix` at
 * import time and resolves a worker bundle via a browser URL, so on Node they
 * throw before reading a single byte. Everything that depended on them
 * (`pdf-to-word`, `pdf-to-excel`, `pdf-to-powerpoint`, `extract-tables`)
 * therefore failed every job on the worker while still reporting itself ready.
 *
 * The worker instead shells out to `pdftotext`, which is already installed in the
 * worker image. This module holds only the parsing — no Node built-ins — so every
 * branch is unit-testable without a binary; `./native` owns the subprocess.
 *
 * Normalization is deliberately shared with the browser path
 * ({@link normalizeExtractedText}, {@link joinPageTexts}) so both paths agree on
 * line endings, trailing whitespace, blank-line collapsing and page joining.
 *
 * ⚠️ THAT IS NOT THE SAME AS AGREEING ON THE TEXT, and this docblock used to
 * claim it was — *"so the same PDF yields the same text whichever extractor
 * produced it"*. It does not, and nothing here ever tested that it did. Measured
 * on production 2026-08-11: one document, **13,530** characters from the browser
 * extractor and **13,678** from this one.
 *
 * The two are different programs, not two configurations of one. `-layout` (see
 * `pdfTextArgs`) reconstructs the page's horizontal arrangement by padding
 * between columns with spaces; the browser's `textItemsToPlainText` appends
 * `item.str` and a newline on `hasEOL`, so it structurally cannot emit a space
 * that is not inside a text item. Shared normalization cannot remove the
 * difference because it only strips TRAILING whitespace — inter-column padding
 * is interior.
 *
 * Measured across six geometries (Xpdf `pdftotext` 4.00 locally, not the
 * worker's poppler build — the shape is the finding, not the magnitudes), this
 * extractor's length ÷ the drawn text's length ran from **1.0001** on
 * single-column prose to **1.8626** on an eight-column grid. It has no finite
 * worst case: a wide sparse table drives it arbitrarily high, so no constant
 * factor can convert one extractor's count into the other's.
 *
 * SINCE 2026-08-11 THE AI PATH COLLAPSES THAT PADDING — see
 * {@link collapseLayoutPadding} — bringing the worst case to **1.2031**. The
 * flag stays on, because **`-layout` is the only mode that reconstructs the
 * page's visual reading order**: poppler 22.12.0's default mode flattens a table
 * to one cell per line with no row boundaries, and `-raw` emits content-stream
 * order, which generators write out of visual order constantly. Both give a
 * model something fluent, complete and wrong. The full measurement, and the
 * earlier transposition claim that turned out to be specific to Xpdf 4.00, are
 * recorded at {@link collapseLayoutPadding}.
 *
 * Office export and table extraction still get the uncollapsed text, which is
 * what they read structure out of.
 */

import {
  joinPageTexts,
  normalizeExtractedText,
  type ExtractedPdfText,
  type ExtractedTextPage,
} from "@/lib/pdf/text";
import type {
  PdfLayout,
  PdfLayoutPage,
  PositionedTextItem,
} from "@/lib/workers/table-extract/engine";

/** `pdftotext` separates pages with a form feed. */
const PAGE_BREAK = "\f";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/**
 * Decode the XML entities poppler emits in `<word>` text. Unknown entities are
 * left verbatim rather than dropped — inventing or deleting characters would
 * silently corrupt the extracted document.
 */
export function decodeXmlEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g,
    (match, body: string) => {
      if (body.startsWith("#x") || body.startsWith("#X")) {
        const code = Number.parseInt(body.slice(2), 16);
        return Number.isFinite(code) && code > 0
          ? String.fromCodePoint(code)
          : match;
      }
      if (body.startsWith("#")) {
        const code = Number.parseInt(body.slice(1), 10);
        return Number.isFinite(code) && code > 0
          ? String.fromCodePoint(code)
          : match;
      }
      return NAMED_ENTITIES[body] ?? match;
    },
  );
}

/**
 * Parse `pdftotext -layout` output into the browser extractor's shape. Pages are
 * split on the form feed; a trailing break yields no extra page. `hasText` stays
 * honest: an image-only PDF produces empty pages and `hasText:false`, which the
 * office-export engine reports as `no_text` instead of emitting a blank document.
 */
export function parseLayoutText(stdout: string): ExtractedPdfText {
  const chunks = stdout.split(PAGE_BREAK);
  // A document ending in a page break leaves one empty trailing chunk, which is a
  // separator artifact rather than a real page.
  if (chunks.length > 1 && chunks[chunks.length - 1]!.trim().length === 0) {
    chunks.pop();
  }
  const pages: ExtractedTextPage[] = chunks.map((chunk, index) => {
    const text = normalizeExtractedText(chunk);
    return { pageNumber: index + 1, text, characterCount: text.length };
  });
  const text = joinPageTexts(pages);
  return {
    pageCount: pages.length,
    pages,
    text,
    characterCount: text.length,
    hasText: text.trim().length > 0,
  };
}

const PAGE_TAG = /<page\b[^>]*>/gi;
const WORD_TAG = /<word\b([^>]*)>([\s\S]*?)<\/word>/gi;

/** Read a numeric XML attribute; `null` when absent or not a finite number. */
function attr(attrs: string, name: string): number | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(attrs);
  if (!match) return null;
  const value = Number.parseFloat(match[1]!);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parse `pdftotext -bbox-layout` XHTML into the positioned layout the table
 * engine consumes.
 *
 * The two coordinate systems differ and the conversion matters: poppler measures
 * from the page's TOP with y growing downward, while {@link PositionedTextItem}
 * is PDF-native — y grows UPWARD from the bottom, and `y` is the run's baseline.
 * So `y = pageHeight - yMax`, taking the box's lower edge as the baseline. Getting
 * this backwards would inverse row order and break table detection outright.
 */
export function parseBboxLayout(xhtml: string): PdfLayout {
  const pages: PdfLayoutPage[] = [];

  // Page bodies are the spans between consecutive <page> tags. Slicing this way
  // avoids a nested-tag regex, which XHTML this deep would not survive.
  const starts: { index: number; attrs: string }[] = [];
  PAGE_TAG.lastIndex = 0;
  for (let m = PAGE_TAG.exec(xhtml); m !== null; m = PAGE_TAG.exec(xhtml)) {
    starts.push({ index: m.index + m[0].length, attrs: m[0] });
  }

  for (let i = 0; i < starts.length; i += 1) {
    const { index, attrs: pageAttrs } = starts[i]!;
    const end = i + 1 < starts.length ? starts[i + 1]!.index : xhtml.length;
    const body = xhtml.slice(index, end);

    const width = attr(pageAttrs, "width") ?? 0;
    const height = attr(pageAttrs, "height") ?? 0;

    const items: PositionedTextItem[] = [];
    WORD_TAG.lastIndex = 0;
    for (let w = WORD_TAG.exec(body); w !== null; w = WORD_TAG.exec(body)) {
      const wordAttrs = w[1] ?? "";
      const text = decodeXmlEntities(w[2] ?? "");
      if (text.trim().length === 0) continue;

      const xMin = attr(wordAttrs, "xMin");
      const yMin = attr(wordAttrs, "yMin");
      const xMax = attr(wordAttrs, "xMax");
      const yMax = attr(wordAttrs, "yMax");
      if (xMin === null || yMin === null || xMax === null || yMax === null)
        continue;

      items.push({
        text,
        x: xMin,
        y: height - yMax,
        width: Math.max(0, xMax - xMin),
        height: Math.max(0, yMax - yMin),
      });
    }

    pages.push({ pageNumber: i + 1, width, height, items });
  }

  return { pageCount: pages.length, pages };
}

/** One word of `-bbox-layout` output, in poppler's top-down page coordinates. */
export interface FlowWord {
  text: string;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

/** One printed line: its words, left to right, as poppler grouped them. */
export interface FlowLine {
  words: FlowWord[];
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

/** One poppler text block — the unit it lays out as a paragraph. */
export interface FlowBlock {
  /** 0-based index of the `<flow>` this block belongs to, in reading order. */
  flow: number;
  lines: FlowLine[];
}

export interface FlowPage {
  pageNumber: number;
  /** Blocks in poppler's READING order — flow by flow, not top to bottom. */
  blocks: FlowBlock[];
}

export interface PdfFlowLayout {
  pageCount: number;
  pages: FlowPage[];
}

const FLOW_TOKEN =
  /<page\b[^>]*>|<flow\b[^>]*>|<block\b[^>]*>|<line\b[^>]*>|<word\b([^>]*)>([\s\S]*?)<\/word>/gi;

/**
 * Parse `pdftotext -bbox-layout` XHTML KEEPING its hierarchy —
 * `<page>/<flow>/<block>/<line>/<word>` — which {@link parseBboxLayout} flattens
 * to a bag of words because the table engine re-derives rows itself.
 *
 * The hierarchy is the point. `-layout` text is the page's VISUAL arrangement: a
 * two-column page comes out as one line per printed row, the left column's line
 * glued to the right column's by a run of spaces, so every paragraph built from
 * it interleaves the columns. poppler's flows and blocks are its reading-order
 * analysis of the same page — the left column's blocks, then the right's. The
 * geometry stays attached so a caller can still recognise a TABLE, which the
 * reading-order analysis splits into one block per column (measured, poppler
 * 25.07: a 4×3 grid came out as four three-line blocks).
 *
 * Pages are counted from `<page>` tags, so a page with no text is still a page.
 * Words with no visible text or no usable box are skipped rather than guessed.
 */
export function parseBboxFlow(xhtml: string): PdfFlowLayout {
  const pages: FlowPage[] = [];
  let page: FlowPage | null = null;
  let flow = -1;
  let block: FlowBlock | null = null;
  let line: FlowLine | null = null;

  const openBlock = (): FlowBlock => {
    const next: FlowBlock = { flow: Math.max(flow, 0), lines: [] };
    page!.blocks.push(next);
    return next;
  };
  const openLine = (): FlowLine => {
    const target = block ?? (block = openBlock());
    const next: FlowLine = {
      words: [],
      xMin: Infinity,
      yMin: Infinity,
      xMax: -Infinity,
      yMax: -Infinity,
    };
    target.lines.push(next);
    return next;
  };

  FLOW_TOKEN.lastIndex = 0;
  for (let m = FLOW_TOKEN.exec(xhtml); m !== null; m = FLOW_TOKEN.exec(xhtml)) {
    const tag = m[0].slice(1, 5).toLowerCase();
    if (tag === "page") {
      page = { pageNumber: pages.length + 1, blocks: [] };
      pages.push(page);
      flow = -1;
      block = null;
      line = null;
      continue;
    }
    if (!page) continue;
    if (tag === "flow") {
      flow += 1;
      block = null;
      line = null;
    } else if (tag === "bloc") {
      block = openBlock();
      line = null;
    } else if (tag === "line") {
      line = openLine();
    } else {
      const text = decodeXmlEntities(m[2] ?? "").trim();
      if (text.length === 0) continue;
      const attrs = m[1] ?? "";
      const xMin = attr(attrs, "xMin");
      const yMin = attr(attrs, "yMin");
      const xMax = attr(attrs, "xMax");
      const yMax = attr(attrs, "yMax");
      if (xMin === null || yMin === null || xMax === null || yMax === null)
        continue;
      const target = line ?? (line = openLine());
      target.words.push({ text, xMin, yMin, xMax, yMax });
      target.xMin = Math.min(target.xMin, xMin);
      target.yMin = Math.min(target.yMin, yMin);
      target.xMax = Math.max(target.xMax, xMax);
      target.yMax = Math.max(target.yMax, yMax);
    }
  }

  // Drop the empty shells a word-less line or block leaves behind, so an
  // image-only page reads as a page with no blocks rather than blank ones.
  for (const p of pages) {
    for (const b of p.blocks) b.lines = b.lines.filter((l) => l.words.length);
    p.blocks = p.blocks.filter((b) => b.lines.length > 0);
  }
  return { pageCount: pages.length, pages };
}
