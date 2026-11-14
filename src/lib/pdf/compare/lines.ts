import {
  pageTextChunks,
  pagesWithoutText,
  type ExtractedPdfText,
} from "../text";

/** What a comparison may set aside before diffing. Both default to off. */
export interface CompareOptions {
  /** "Total" and "TOTAL" compare as the same line. */
  ignoreCase?: boolean;
  /**
   * Page numbers and running headers or footers are set aside where both
   * files have them (`furniture.ts`).
   */
  ignoreFurniture?: boolean;
}

/**
 * The key "Ignore case" matches on: case FOLDED, not lowercased. Upper then
 * lower takes "ß" and "ﬃ" to "ss" and "ffi" on both sides and "ı" to "i";
 * the combining dot that "İ" lowercases with is then dropped. Until
 * 2026-11-14 this was `toLowerCase()`, and "İSTANBUL"/"istanbul" and
 * "STRASSE"/"straße" compared as changes under the option
 * (engine.test.ts, "ignore case folds case the way Unicode does"). The word
 * marks match on the same key.
 */
/** "i" and U+0307, built from its code: an invisible mark in source is a trap. */
const DOTTED_I = new RegExp(`i${String.fromCharCode(0x307)}`, "g");

export function foldCase(text: string): string {
  return text.toUpperCase().toLowerCase().replace(DOTTED_I, "i");
}

/**
 * One line the diff compares, with where it came from. `key` is what the
 * diff matches on (the text, case-folded under `ignoreCase`); `text` is what a
 * reader is shown, always verbatim. `occurrence` is its rank among the lines
 * with the same text on the same page, so a later slice can find THIS one.
 */
export interface ComparableLine {
  text: string;
  key: string;
  page: number;
  occurrence: number;
}

/**
 * The lines of a text as the comparison reads them: line endings unified,
 * runs of spaces and tabs collapsed, each line trimmed, blank lines dropped.
 */
export function normalizeComparableText(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean);
}

/**
 * Every comparable line of an extraction, page by page, with its page number.
 *
 * Built from `pageTextChunks` — the chunks `extracted.text` is joined from,
 * with their REAL page numbers — so the lines are exactly
 * `normalizeComparableText(extracted.text)`, which is what the comparison read
 * before pages were tracked (`lines.test.ts` holds that identity over real
 * PDFs), and a page with no text is skipped without shifting the numbers.
 */
export function linesOf(
  extracted: Pick<ExtractedPdfText, "pages">,
): ComparableLine[] {
  return pageTextChunks(extracted.pages).flatMap((chunk) => {
    const seen = new Map<string, number>();
    return normalizeComparableText(chunk.text).map((text) => {
      const occurrence = seen.get(text) ?? 0;
      seen.set(text, occurrence + 1);
      return { text, key: text, page: chunk.pageNumber, occurrence };
    });
  });
}

/**
 * The lines a comparison diffs under `options`, keyed. Every line is here:
 * what "ignore page headers and numbers" sets aside is decided against the
 * other document too, in `furniture.ts`. (Until 2026-11-14 the running
 * lines were dropped here, one document at a time, and a header that
 * differed between the files was dropped from both.)
 */
export function comparableLines(
  extracted: Pick<ExtractedPdfText, "pages">,
  options: CompareOptions,
): { lines: ComparableLine[]; pagesWithoutText: number[] } {
  const lines = linesOf(extracted).map((line) =>
    options.ignoreCase ? { ...line, key: foldCase(line.text) } : line,
  );
  return { lines, pagesWithoutText: pagesWithoutText(extracted.pages) };
}
