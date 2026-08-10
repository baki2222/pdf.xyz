/**
 * Pure parsers for poppler `pdftotext` output.
 *
 * The worker cannot use the pdfjs-backed extractors in `@/lib/pdf/text` and
 * `@/lib/pdf/layout`: those are browser modules — pdfjs touches `DOMMatrix` at
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
 * ({@link normalizeExtractedText}, {@link joinPageTexts}) so the same PDF yields
 * the same text whichever extractor produced it.
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
