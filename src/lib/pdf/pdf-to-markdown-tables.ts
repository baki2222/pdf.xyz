import type { MarkdownTable } from "./pdf-to-markdown";
import type { TextItemLike } from "./text";
import {
  detectTableRegionsOnPage,
  type PositionedTextItem,
} from "@/lib/workers/table-extract/detect";

/**
 * PDF to Markdown's tables: Extract Tables' own detector (`detect.ts`, the
 * one the worker runs over pdftotext's words), run in the browser over
 * pdf.js's items split into words.
 *
 * The detector was tuned on WORDS — pdftotext's one box per word — and its
 * tests warn that one item per cell or per line is a shape it never sees. A
 * pdf.js item is a run of words, so each is split here, with the letters
 * placed by estimate: a word space at {@link SPACE_EMS} of the font size (a
 * Helvetica space is 0.278 em), the rest of the item's width shared evenly by
 * its other characters. An even share for the spaces too would set every word
 * space at an average letter's width, about half an em — the detector's own
 * "wider than a word space" line (`PHRASE_GAP_HEIGHTS` in `detect.ts`).
 */
export const SPACE_EMS = 0.28;

/** One pdf.js item's words, each with an estimated box. Upright text only. */
export function wordsOfItem(item: TextItemLike): PositionedTextItem[] {
  const str = item.str;
  const t = item.transform;
  if (typeof str !== "string" || !str.trim() || !Array.isArray(t)) return [];
  const [a, b, c, d, x, y] = t as unknown[];
  const num = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v);
  if (!num(a) || !num(d) || !num(x) || !num(y) || b !== 0 || c !== 0) {
    return [];
  }
  const width = num(item.width) && item.width > 0 ? item.width : 0;
  const height =
    num(item.height) && item.height > 0 ? item.height : Math.abs(d);
  if (!width || !height) return [];

  const chars = [...str];
  const spaces = chars.filter((ch) => /\s/.test(ch)).length;
  const letters = chars.length - spaces;
  if (!letters) return [];
  // Spaces never take more than half the run, however many there are.
  const space = Math.min(SPACE_EMS * height, (width * 0.5) / (spaces || 1));
  const letter = (width - space * spaces) / letters;

  const words: PositionedTextItem[] = [];
  let at = x;
  let word: PositionedTextItem | null = null;
  for (const ch of chars) {
    if (/\s/.test(ch)) {
      word = null;
      at += space;
      continue;
    }
    if (!word) {
      word = { text: "", x: at, y, width: 0, height };
      words.push(word);
    }
    word.text += ch;
    word.width += letter;
    at += letter;
  }
  return words;
}

/** The tables the detector finds on one page, with where they sit. */
export function tablesOfPage(
  items: readonly TextItemLike[],
  pageNumber: number,
): MarkdownTable[] {
  return detectTableRegionsOnPage({
    pageNumber,
    // The detector reads only the words' boxes, never the page's size.
    width: 0,
    height: 0,
    items: items.flatMap(wordsOfItem),
  }).map(({ rows, top, bottom }) => ({ rows, top, bottom }));
}
