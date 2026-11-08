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
  })
    .map(({ rows, top, bottom }) => ({ rows, top, bottom }))
    .filter((table) => !isMarkerList(table));
}

/**
 * A bullet or numbered list's marker: what sits alone in the first column
 * of a list the detector reads as two columns.
 */
const LIST_MARKER =
  /^(?:[•◦▪▫‣⁃∙·●○■□►▸–—*+-]|\(?(?:\d{1,3}|[a-z]|[ivx]{1,4})[.)])$/i;

/**
 * True when a "table" is really a list: its first column holds nothing but
 * list markers (or nothing, on a wrapped item's hanging line), and at least
 * one of them. The detector sees a marker and its text as two columns with a
 * gap between, which a hanging indent makes look like a grid. PR #287's CI
 * (run 42431179321) caught it: the e2e proof's two bullet items came out as
 * a two-column GFM table, the wrapped line as a third row, and the list was
 * gone. Kept to Markdown: Extract Tables' own detector is unchanged.
 */
export function isMarkerList(table: Pick<MarkdownTable, "rows">): boolean {
  const first = table.rows.map((row) => (row[0] ?? "").trim());
  return (
    first.some((cell) => cell !== "") &&
    first.every((cell) => cell === "" || LIST_MARKER.test(cell))
  );
}
