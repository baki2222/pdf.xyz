import {
  pageTextChunks,
  pagesWithoutText,
  type ExtractedPdfText,
} from "../text";
import { detectRunningLines } from "./running-lines";

/** What a comparison may set aside before diffing. Both default to off. */
export interface CompareOptions {
  /** "Total" and "TOTAL" compare as the same line. */
  ignoreCase?: boolean;
  /** Page numbers and running headers or footers are left out of both sides. */
  ignoreFurniture?: boolean;
}

/**
 * One line the diff compares, with where it came from. `key` is what the
 * diff matches on (the text, lowercased under `ignoreCase`); `text` is what a
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

/** The lines a comparison diffs under `options`, and what it set aside. */
export function comparableLines(
  extracted: Pick<ExtractedPdfText, "pages">,
  options: CompareOptions,
): { lines: ComparableLine[]; dropped: number; pagesWithoutText: number[] } {
  const all = linesOf(extracted);
  const running = options.ignoreFurniture
    ? detectRunningLines(all)
    : new Set<number>();
  const lines = all
    .filter((_, i) => !running.has(i))
    .map((line) =>
      options.ignoreCase ? { ...line, key: line.text.toLowerCase() } : line,
    );
  return {
    lines,
    dropped: running.size,
    pagesWithoutText: pagesWithoutText(extracted.pages),
  };
}
