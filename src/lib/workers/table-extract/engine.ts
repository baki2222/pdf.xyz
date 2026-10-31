import JSZip from "jszip";
import {
  SheetStyles,
  STYLES_CONTENT_TYPE_OVERRIDE,
  stylesRelationship,
  worksheetXml,
  xmlEscape,
} from "../ooxml/sheet-cells";
import { CELL_GAP_EMS, isListItem, LONG_CELL_WORDS } from "../pdf-text/flow";
import { classifyPdfTextFailure } from "../pdf-office-export/encryption";
import {
  rethrowIfAttemptAbort,
  signalOption,
  type RunControl,
} from "../attempt-abort";

/**
 * Table extraction engine for the `extract-tables` tool.
 *
 * This is a real, heuristic table detector — not an AI model and not a fabricated
 * output. It works purely from the *positioned* selectable text of a PDF (each
 * run with its page coordinates), clusters those runs into rows and columns by
 * geometry, and only reports a table when an aligned grid of at least two columns
 * and two rows actually emerges. Scanned/image-only PDFs have no selectable text
 * and fail honestly as `no_text`; prose or single-column PDFs fail honestly as
 * `no_tables`. When tables are found, it emits a real ZIP holding one RFC-4180
 * CSV per table plus a combined multi-sheet XLSX workbook.
 *
 * The engine takes its layout extractor as an injected dependency so it stays
 * node-free and unit-testable: the production worker wires the NATIVE
 * `pdftotext -bbox-layout` extractor (`./native` → `pdf-text/native`), tests wire
 * a deterministic fake.
 *
 * ⚠️ IT IS NOT pdfjs, and this docblock said it was — twice: *"the same text pdfjs
 * exposes"* and *"the production worker wires the pdfjs-backed extractor"*. That
 * extractor loads pdfjs's main build, which throws under Node before reading a
 * byte, which is the whole reason `pdf-text/native` exists. The two extractors also do not agree on the
 * text: see `pdf-text/parse.ts`.
 */

export const EXTRACT_TABLES_TOOL = "extract-tables" as const;
/**
 * The engine name that ships inside every extract-tables job result.
 *
 * RENAMED 2026-08-11 from `pdfjs-layout-tables`, which named an extractor this
 * worker does not use — the pdfjs extractor it named loads pdfjs's main build,
 * which throws under Node before reading a byte. A contract that misdescribes itself is worse than
 * a contract change, and this is an opaque string only our own surfaces consume.
 * Job records written before that date carry the old value.
 */
export const EXTRACT_TABLES_ENGINE = "pdftotext-layout-tables" as const;

/** One positioned selectable-text run. Coordinates are PDF points; y grows upward. */
export interface PositionedTextItem {
  text: string;
  /** Left edge (PDF x). */
  x: number;
  /** Baseline/bottom (PDF y); larger y is higher on the page. */
  y: number;
  /** Rendered width of the run in points. */
  width: number;
  /** Rendered (font) height of the run in points. */
  height: number;
}

/** One page's positioned text plus its media box, 1-based page number. */
export interface PdfLayoutPage {
  pageNumber: number;
  width: number;
  height: number;
  items: PositionedTextItem[];
}

/** The positioned-text layout of a whole PDF. */
export interface PdfLayout {
  pageCount: number;
  pages: PdfLayoutPage[];
}

/** A detected table: its source page and its cells as ordered rows × columns. */
export interface DetectedTable {
  pageNumber: number;
  rows: string[][];
}

/** Pull the positioned layout of a PDF; absent ⇒ the engine fails as `unsupported`. */
export type PdfLayoutExtractor = (
  bytes: Uint8Array,
  run?: RunControl,
) => Promise<PdfLayout>;

export interface TableExtractDeps {
  extractLayout?: PdfLayoutExtractor;
  /**
   * Asked only after the extractor REFUSED the document: does it need a
   * password? Injectable for tests; defaults to the pdf-lib + byte-scan probe.
   */
  isEncrypted?: (bytes: Uint8Array) => Promise<boolean>;
  limits?: { maxInputBytes?: number; maxOutputBytes?: number };
}

export interface TableExtractMeta {
  engine: typeof EXTRACT_TABLES_ENGINE;
  tool: typeof EXTRACT_TABLES_TOOL;
  tableCount: number;
  pageCount: number;
  inputBytes: number;
  outputBytes: number;
}

export type TableExtractRun =
  | {
      ok: true;
      output: Uint8Array;
      filenameExt: "zip";
      contentType: "application/zip";
      meta: TableExtractMeta;
    }
  | {
      ok: false;
      kind:
        | "unsupported"
        | "no_text"
        | "no_tables"
        | "too_large"
        | "password_protected"
        | "unreadable"
        | "failed";
      limitBytes?: number;
      message: string;
    };

// ---------------------------------------------------------------------------
// Table detection
// ---------------------------------------------------------------------------

/**
 * Two words on one row belong to the same cell when the gap between them is
 * under this many line heights. A word space is ~0.3 of the height (Helvetica
 * 11pt: 3.06pt of 10.18pt, measured through poppler 25.07); a table gutter is
 * rarely under one em, and 0.5 still splits cells set half an em apart. A
 * justified line's stretched spaces are wider than this; `phrasesOf` joins
 * those by where they fall, not by how wide they are.
 */
export const PHRASE_GAP_HEIGHTS = 0.5;
/** A vertical gap over this many times a run's usual row pitch ends a table. */
export const TABLE_BREAK_PITCHES = 2;
/**
 * A first or last row further than this many row pitches from the rest of its
 * table, straddling its gutters, is not one of its rows ({@link looseEdge}).
 */
export const LOOSE_EDGE_PITCHES = 1.25;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid];
  const lo = sorted[mid - 1];
  if (hi === undefined) return 0;
  return sorted.length % 2 === 0 && lo !== undefined ? (lo + hi) / 2 : hi;
}

/**
 * Greedily cluster 1-D values into groups whose members are within
 * `tolerance` of the running cluster mean. Returns each cluster's mean, sorted
 * ascending.
 */
function clusterAnchors(values: number[], tolerance: number): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const clusters: { sum: number; count: number }[] = [];
  for (const value of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && value - last.sum / last.count <= tolerance) {
      last.sum += value;
      last.count += 1;
    } else {
      clusters.push({ sum: value, count: 1 });
    }
  }
  return clusters.map((c) => c.sum / c.count);
}

function nearestIndex(anchors: number[], value: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < anchors.length; i += 1) {
    const anchor = anchors[i];
    if (anchor === undefined) continue;
    const dist = Math.abs(anchor - value);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/** Words of one row that sit close enough together to be one cell's text. */
interface Phrase {
  text: string;
  x0: number;
  x1: number;
  words: number;
}

/** One printed row of the page: its phrases, left to right. */
interface PageRow {
  y: number;
  phrases: Phrase[];
}

interface Span {
  start: number;
  end: number;
}

/** A row's words left to right, and the gaps between neighbours. */
interface WordRow {
  words: PositionedTextItem[];
  /** `gaps[i]` is the white space between `words[i]` and `words[i + 1]`. */
  gaps: Span[];
  height: number;
}

function wordRowOf(items: PositionedTextItem[], fallback: number): WordRow {
  const words = [...items].sort((a, b) => a.x - b.x);
  const gaps = words.slice(1).map((word, i) => ({
    start: words[i]!.x + words[i]!.width,
    end: word.x,
  }));
  const height = Math.max(0, ...words.map((w) => w.height)) || fallback;
  return { words, gaps, height };
}

/** A row's gaps at least {@link PHRASE_GAP_HEIGHTS} wide. */
function wideGaps(row: WordRow): Span[] {
  return row.gaps.filter(
    (g) => g.end - g.start >= PHRASE_GAP_HEIGHTS * row.height,
  );
}

/**
 * A row's words, left to right, joined into phrases. A gap splits two cells
 * when it is
 *  - {@link CELL_GAP_EMS} line heights or wider (the width PDF to Word splits
 *    a line into cells at), or
 *  - wider than a word space ({@link PHRASE_GAP_HEIGHTS}) and LINED UP with a
 *    gap as wide in the row above or below — a gutter runs down a table.
 * Every other gap joins its words: a word space, and the stretched space of a
 * JUSTIFIED line, which lands somewhere else on every line.
 *
 * Measured, poppler 25.07, `letterPdf`: justification stretched every space
 * of a line to 15.9pt in 11pt text, a space and a half. Split at every gap
 * wider than a word space, three such lines became a row of one-word cells
 * each, and a thirteen-column "table". Width alone cannot tell those spaces
 * from a tight gutter: the heading row of an auto-sized table
 * (`autoSizedTablePdf`), each heading as wide as its column, sets its
 * headings one padding apart, as evenly as justification — and those gaps
 * line up with the rows under it.
 */
function phrasesOf(row: WordRow, neighbours: readonly WordRow[]): Phrase[] {
  const { words, gaps, height } = row;
  const beside = neighbours.flatMap(wideGaps);
  const splits = gaps.map((g) => {
    const width = g.end - g.start;
    if (width < PHRASE_GAP_HEIGHTS * height) return false;
    if (width >= CELL_GAP_EMS * height) return true;
    return beside.some((b) => b.start < g.end && b.end > g.start);
  });
  const phrases: Phrase[] = [];
  words.forEach((word, i) => {
    const text = word.text.trim();
    const count = text.split(/\s+/).length;
    const last = phrases[phrases.length - 1];
    if (last && i > 0 && !splits[i - 1]) {
      last.text = `${last.text} ${text}`;
      last.x1 = Math.max(last.x1, word.x + word.width);
      last.words += count;
    } else
      phrases.push({ text, x0: word.x, x1: word.x + word.width, words: count });
  });
  return phrases;
}

/**
 * The columns of a run of table rows, as x-spans between GUTTERS: x-ranges no
 * row's phrase covers. Columns come from whitespace, never from left edges, so
 * a column of right-aligned amounts under a left-aligned header is ONE column
 * (every one of its phrases overlaps the others), and a multi-word cell is one
 * phrase in one column.
 *
 * One row in three may bridge a gutter the others agree on — a header that
 * spans two columns — without merging them, but only when every phrase over
 * that range crosses it end to end. A phrase that sits INSIDE the range (a
 * header over a column its rows leave empty) is a column of its own, not a
 * bridge.
 */
function columnsOf(rows: readonly PageRow[]): Span[] {
  const phrases = rows.flatMap((row) => row.phrases);
  const edges = [...new Set(phrases.flatMap((p) => [p.x0, p.x1]))].sort(
    (a, b) => a - b,
  );
  if (edges.length < 2) return [];
  const tolerated = Math.floor(rows.length / 3);
  // Each elementary interval between consecutive edges, with how many rows
  // cover it.
  const pieces = edges.slice(0, -1).map((start, i) => {
    const end = edges[i + 1]!;
    const count = rows.filter((row) =>
      row.phrases.some((p) => p.x0 <= start && p.x1 >= end),
    ).length;
    return { start, end, count };
  });

  const gutters: Span[] = [];
  const addZeroRuns = (from: number, to: number) => {
    for (let i = from; i <= to; i++) {
      if (pieces[i]!.count > 0) continue;
      const start = pieces[i]!.start;
      while (i + 1 <= to && pieces[i + 1]!.count === 0) i++;
      gutters.push({ start, end: pieces[i]!.end });
    }
  };
  for (let i = 0; i < pieces.length; i++) {
    if (pieces[i]!.count > tolerated) continue;
    const from = i;
    while (i + 1 < pieces.length && pieces[i + 1]!.count <= tolerated) i++;
    const low = { start: pieces[from]!.start, end: pieces[i]!.end };
    const interior = from > 0 && i < pieces.length - 1;
    const bridged =
      tolerated > 0 &&
      interior &&
      phrases
        .filter((p) => p.x1 > low.start && p.x0 < low.end)
        .every((p) => p.x0 <= low.start && p.x1 >= low.end);
    if (bridged) gutters.push(low);
    else addZeroRuns(from, i);
  }

  const columns: Span[] = [];
  let start = edges[0]!;
  for (const gutter of gutters) {
    columns.push({ start, end: gutter.start });
    start = gutter.end;
  }
  columns.push({ start, end: edges[edges.length - 1]! });
  return columns;
}

/** The columns a phrase overlaps, by index. */
function overlapped(columns: readonly Span[], phrase: Phrase): number[] {
  const out: number[] = [];
  columns.forEach((span, i) => {
    if (phrase.x1 > span.start && phrase.x0 < span.end) out.push(i);
  });
  return out;
}

/** The column a phrase lands in: the leftmost it overlaps, else the nearest. */
function columnFor(columns: readonly Span[], phrase: Phrase): number {
  const hit = overlapped(columns, phrase)[0];
  if (hit !== undefined) return hit;
  let best = 0;
  let bestDist = Infinity;
  columns.forEach((span, i) => {
    const dist = Math.min(
      Math.abs(span.start - phrase.x1),
      Math.abs(phrase.x0 - span.end),
    );
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  });
  return best;
}

/**
 * A one-phrase row belongs to the table around or directly above it only when
 * it sits in ONE column past the first: a wrapped description, an amount-only
 * total. A title, caption, paragraph line or footer starts in the first column
 * or spans several, and ends the table there.
 */
function fitsAsCell(columns: readonly Span[], row: PageRow): boolean {
  const phrase = row.phrases[0]!;
  const first = columns[0]!;
  const last = columns[columns.length - 1]!;
  return (
    phrase.x0 >= first.end &&
    phrase.x0 < last.end &&
    overlapped(columns, phrase).length <= 1
  );
}

/**
 * Join two neighbouring columns that no row fills both of, when the left one
 * holds only the FIRST row's cell and the right one two or more values. That is
 * a heading set flush LEFT over values set flush RIGHT in a column wider than
 * both (`reportTablesPdf`, "Staff"): no phrase of one overlaps the other, so
 * white space runs between them on every row and the gutter rule splits
 * them, one column holding only the heading. Joining never puts two cells of
 * one row together, so it cannot merge data; and it needs the heading row,
 * so two lines of runs that share no column — a staircase — stay apart.
 */
function joinComplementaryColumns(cells: string[][][]): string[][][] {
  let out = cells;
  let c = 0;
  while (c + 1 < (out[0]?.length ?? 0)) {
    const a = out.map((row) => row[c]!.length > 0);
    const b = out.map((row) => row[c + 1]!.length > 0);
    const disjoint = a.every((filled, r) => !(filled && b[r]));
    const heading = (f: boolean[]) =>
      f[0] === true && f.filter(Boolean).length === 1;
    const values = (f: boolean[]) => f.filter(Boolean).length >= 2;
    if (disjoint && heading(a) && values(b)) {
      out = out.map((row) => [
        ...row.slice(0, c),
        [...row[c]!, ...row[c + 1]!],
        ...row.slice(c + 2),
      ]);
      c = Math.max(0, c - 1);
    } else c += 1;
  }
  return out;
}

/** A candidate region: its rows top to bottom, and the columns they define. */
interface Region {
  rows: PageRow[];
  columns: Span[];
}

const isMulti = (row: PageRow) => row.phrases.length >= 2;

/**
 * The index of a first or last row that is set apart from the table and is
 * not one of its rows, or null: a row of two or more phrases more than
 * {@link LOOSE_EDGE_PITCHES} of the other rows' pitch away from them, with a
 * phrase that straddles one of THEIR gutters. That is the line above a header
 * or below a total that happens to hold two runs — an address beside a
 * `Period: …` note, a footer's text beside its page number — which, taken
 * in, laid its runs across the table's columns. A heading that spans the
 * columns under it sits at the table's own pitch and stays.
 */
function looseEdge(rows: readonly PageRow[]): number | null {
  if (rows.filter(isMulti).length < 3) return null;
  const pitchOf = (part: readonly PageRow[]) =>
    median(part.slice(1).map((row, i) => part[i]!.y - row.y));
  const straddles = (row: PageRow, rest: readonly PageRow[]) => {
    const columns = columnsOf(rest.filter(isMulti));
    return row.phrases.some((p) => overlapped(columns, p).length >= 2);
  };
  const [top, next] = [rows[0]!, rows[1]!];
  const below = rows.slice(1);
  if (
    top.y - next.y > LOOSE_EDGE_PITCHES * pitchOf(below) &&
    straddles(top, below)
  )
    return 0;
  const end = rows.length - 1;
  const [bottom, prev] = [rows[end]!, rows[end - 1]!];
  const above = rows.slice(0, end);
  if (
    prev.y - bottom.y > LOOSE_EDGE_PITCHES * pitchOf(above) &&
    straddles(bottom, above)
  )
    return end;
  return null;
}

/**
 * Settle a run of rows (starting and ending on multi-phrase rows) into
 * regions: compute its columns, and split it at the first one-phrase row that
 * does not fit them. Each part is settled again against its own columns.
 */
function settle(run: PageRow[]): Region[] {
  const first = run.findIndex(isMulti);
  let last = run.length - 1;
  while (last >= 0 && !isMulti(run[last]!)) last -= 1;
  if (first === -1 || first === last) return [];
  const rows = run.slice(first, last + 1);
  const loose = looseEdge(rows);
  if (loose !== null)
    return settle(loose === 0 ? rows.slice(1) : rows.slice(0, -1));
  const columns = columnsOf(rows.filter(isMulti));
  const breakAt = rows.findIndex(
    (row) => !isMulti(row) && !fitsAsCell(columns, row),
  );
  if (breakAt === -1) return [{ rows, columns }];
  return [
    ...settle(rows.slice(0, breakAt)),
    ...settle(rows.slice(breakAt + 1)),
  ];
}

/** Split rows wherever the vertical gap is far above the run's usual pitch. */
function splitAtGaps(rows: PageRow[]): PageRow[][] {
  if (rows.length < 2) return [rows];
  const gaps = rows.slice(1).map((row, i) => rows[i]!.y - row.y);
  const limit = TABLE_BREAK_PITCHES * median(gaps);
  const parts: PageRow[][] = [[rows[0]!]];
  rows.slice(1).forEach((row, i) => {
    if (gaps[i]! > limit) parts.push([row]);
    else parts[parts.length - 1]!.push(row);
  });
  return parts;
}

/**
 * The rules a region must pass to be reported as a table, so prose and
 * accidental alignments are not:
 *  - two columns each filled in two or more rows. Two lines of two runs
 *    that share no column — a staircase, as a letterhead's lines can be —
 *    are not a table;
 *  - a column of VALUES: one column in which every cell is under
 *    {@link LONG_CELL_WORDS} words, and fewer than half of them list items.
 *    Two columns of prose share baselines and gutters exactly like a table,
 *    and two bulleted lists side by side are short and aligned too
 *    (`columnListsPdf`); neither has such a column. PDF to Word tells a
 *    table from columns of text the same way (`pdf-text/flow`), and also
 *    asks that column's cells to share an edge; this does not;
 *  - no sentence WRAPS from one row into the next: a cell of
 *    {@link LONG_CELL_WORDS}+ words above a cell, in the same column, that
 *    starts in lowercase. That is a paragraph set beside a short list, whose
 *    list gives the region its column of values. Checked only between rows
 *    that each hold two or more phrases, so a table cell that wraps onto a
 *    one-phrase continuation row does not reject its table.
 */
function isTableGrid(
  rows: string[][],
  columnCount: number,
  multi: readonly boolean[],
): boolean {
  const filled = (cell: string | undefined) => (cell?.length ?? 0) > 0;
  const columnFilled = Array.from(
    { length: columnCount },
    (_, c) => rows.filter((cells) => filled(cells[c])).length,
  );
  if (columnFilled.filter((count) => count >= 2).length < 2) return false;
  const words = (cell: string) => cell.split(/\s+/).filter(Boolean).length;
  const columns = Array.from({ length: columnCount }, (_, c) => c);
  const hasValueColumn = columns.some((c) => {
    const cells = rows.map((row) => row[c] ?? "").filter(Boolean);
    const listItems = cells.filter(isListItem).length;
    return (
      cells.every((cell) => words(cell) < LONG_CELL_WORDS) &&
      2 * listItems < cells.length
    );
  });
  if (!hasValueColumn) return false;
  const wraps = rows
    .slice(1)
    .some(
      (below, i) =>
        multi[i] &&
        multi[i + 1] &&
        columns.some(
          (c) =>
            words(rows[i]![c] ?? "") >= LONG_CELL_WORDS &&
            /^\p{Ll}/u.test(below[c] ?? ""),
        ),
    );
  return !wraps;
}

/**
 * Recover the tables on a single page from its positioned WORDS — what
 * `pdftotext -bbox-layout` gives, one item per word.
 *
 *  1. Rows: words clustered by baseline, top to bottom.
 *  2. Phrases: a row's neighbouring words joined across word spaces and the
 *     stretched spaces of justified text (`phrasesOf`), so "North America"
 *     and "Unit price" are one cell each and a justified line one phrase.
 *  3. Regions: runs of rows with two or more phrases, split at a vertical gap
 *     well above the run's pitch ({@link TABLE_BREAK_PITCHES}) and at any
 *     one-phrase row that is not a cell of the table (a title, a caption, a
 *     paragraph line), less a first or last row set apart that straddles the
 *     others' gutters (`looseEdge`). A page can hold several tables; each is
 *     its own.
 *  4. Columns: per region, from whitespace GUTTERS (see `columnsOf`), each
 *     phrase in the column it overlaps — so right-aligned amounts under a
 *     left-aligned header stay in one column.
 *  5. Each region passes `isTableGrid` or is not reported.
 *
 * Until 2026-09-27 this clustered every WORD by its left edge over the whole
 * page and reported the page as one grid or none. On the words poppler
 * really gives, "Units sold" became two columns, a right-aligned amount
 * column two more, a title a data row, and a title plus one sentence of prose
 * made a page with a clean table report none; while every two-column prose
 * page was reported as a table. Its tests fed it one item per CELL and one
 * per LINE, shapes the extractor never emits. The tests now read captured
 * poppler output (`@/tests/poppler-samples`) and real poppler.
 *
 * Known limits: two tables side by side on the same rows read as one wide
 * table; a wrapped cell in the FIRST column ends its table; a centred
 * one-line note directly under a table can be taken as its last row.
 */
export function detectTablesOnPage(page: PdfLayoutPage): DetectedTable[] {
  const items = page.items.filter((item) => item.text.trim().length > 0);
  if (items.length < 4) return [];

  const medianHeight = median(items.map((item) => item.height)) || 10;
  const rowTolerance = Math.max(2, medianHeight * 0.6);

  // Rows: cluster by vertical anchor, then order top-to-bottom.
  const rowAnchors = clusterAnchors(
    items.map((item) => item.y),
    rowTolerance,
  )
    .slice()
    .sort((a, b) => b - a);
  const rowItems: PositionedTextItem[][] = rowAnchors.map(() => []);
  for (const item of items)
    rowItems[nearestIndex(rowAnchors, item.y)]!.push(item);
  const wordRows = rowItems.map((its) => wordRowOf(its, medianHeight));
  const rows: PageRow[] = rowAnchors.map((y, r) => ({
    y,
    phrases: phrasesOf(
      wordRows[r]!,
      [wordRows[r - 1], wordRows[r + 1]].filter(
        (w): w is WordRow => w !== undefined,
      ),
    ),
  }));

  // Candidate regions: every row from the first multi-phrase one down, cut
  // at large vertical gaps, then settled against their own columns — which
  // is where titles, captions and paragraph lines drop out.
  const firstMulti = rows.findIndex(isMulti);
  const regions: Region[] =
    firstMulti === -1
      ? []
      : splitAtGaps(rows.slice(firstMulti)).flatMap(settle);

  // A region's tail: one-phrase rows directly below its last row that sit in
  // one of its columns (an amount-only total). It stops at a row of two or
  // more phrases (one `looseEdge` left out), at a gap over
  // TABLE_BREAK_PITCHES of the table's pitch (a page number under a column),
  // and at a row that does not fit as a cell (a note spanning columns, a
  // mark past the right edge).
  const tables: DetectedTable[] = [];
  for (const region of regions) {
    const pitch = median(
      region.rows.slice(1).map((row, i) => region.rows[i]!.y - row.y),
    );
    let at = rows.indexOf(region.rows[region.rows.length - 1]!);
    for (let next = rows[at + 1]; next; next = rows[at + 1]) {
      if (
        isMulti(next) ||
        rows[at]!.y - next.y > TABLE_BREAK_PITCHES * pitch ||
        !fitsAsCell(region.columns, next)
      )
        break;
      region.rows.push(next);
      at += 1;
    }

    const placed = region.rows.map((row) => {
      const cells: string[][] = region.columns.map(() => []);
      for (const phrase of row.phrases)
        cells[columnFor(region.columns, phrase)]!.push(phrase.text);
      return cells;
    });
    const grid = joinComplementaryColumns(placed).map((cells) =>
      cells.map((texts) => texts.join(" ")),
    );
    if (isTableGrid(grid, grid[0]?.length ?? 0, region.rows.map(isMulti)))
      tables.push({ pageNumber: page.pageNumber, rows: grid });
  }
  return tables;
}

// ---------------------------------------------------------------------------
// CSV / XLSX serialization
// ---------------------------------------------------------------------------

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serialize rows to an RFC-4180 CSV string: CRLF row separators, no trailing CRLF. */
export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/** Build a single, multi-sheet XLSX workbook — one sheet per detected table. */
async function buildXlsx(tables: DetectedTable[]): Promise<Uint8Array> {
  // Cells, column letters and number rules are shared with PDF to Excel —
  // see `../ooxml/sheet-cells`. Sheets first: they register the formats that
  // `xl/styles.xml` must declare.
  const styles = new SheetStyles();
  const sheets = tables.map((table) => worksheetXml(table.rows, styles));
  const zip = new JSZip();
  const sheetOverrides = tables
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("");
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetOverrides}${STYLES_CONTENT_TYPE_OVERRIDE}</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${tables
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join(
        "",
      )}${stylesRelationship(`rId${tables.length + 1}`)}</Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${tables
      .map(
        (table, i) =>
          `<sheet name="${xmlEscape(`Table ${i + 1} (p${table.pageNumber})`)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
      )
      .join("")}</sheets></workbook>`,
  );
  sheets.forEach((sheet, i) =>
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheet),
  );
  zip.file("xl/styles.xml", styles.xml());
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

/**
 * Package detected tables into a real ZIP: one RFC-4180 CSV per table
 * (`table-1.csv`, `table-2.csv`, …) plus a combined `tables.xlsx` workbook.
 */
export async function buildTablesZip(
  tables: DetectedTable[],
): Promise<Uint8Array> {
  const zip = new JSZip();
  tables.forEach((table, i) =>
    zip.file(`table-${i + 1}.csv`, toCsv(table.rows)),
  );
  zip.file("tables.xlsx", await buildXlsx(tables));
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Run the full table-extraction flow honestly: reject oversized input before
 * touching the extractor, fail as `unsupported` when no extractor is wired, as
 * `no_text` for scanned/image-only PDFs, as `no_tables` when no aligned grid is
 * found, and as `failed` if the extractor throws — never a fabricated ZIP. On
 * success, return a real ZIP of CSVs + a combined XLSX.
 */
export async function runTableExtract(
  input: Uint8Array,
  deps: TableExtractDeps,
  /** The attempt's abort signal, passed to pdftotext. */
  signal?: AbortSignal,
): Promise<TableExtractRun> {
  const { extractLayout } = deps;
  if (!extractLayout) {
    return {
      ok: false,
      kind: "unsupported",
      message:
        "Table extraction requires the PDF layout extractor, which is not available in this environment.",
    };
  }
  const maxInput = deps.limits?.maxInputBytes;
  if (maxInput !== undefined && input.byteLength > maxInput) {
    return {
      ok: false,
      kind: "too_large",
      limitBytes: maxInput,
      message: "The PDF input exceeds the worker's size limit.",
    };
  }
  try {
    const layout = await extractLayout(input, signalOption(signal));
    const hasText = layout.pages.some((page) =>
      page.items.some((item) => item.text.trim().length > 0),
    );
    if (!hasText) {
      return {
        ok: false,
        kind: "no_text",
        message:
          "This PDF has no selectable text, so no tables can be extracted. Run OCR PDF first, then try again.",
      };
    }
    const tables = layout.pages.flatMap((page) => detectTablesOnPage(page));
    if (tables.length === 0) {
      return {
        ok: false,
        kind: "no_tables",
        message:
          "No table-like structure was detected in this PDF's selectable text.",
      };
    }
    const output = await buildTablesZip(tables);
    const maxOutput = deps.limits?.maxOutputBytes;
    if (maxOutput !== undefined && output.byteLength > maxOutput) {
      // Deterministic: the same PDF builds the same archive on every attempt,
      // so a retryable `failed` here could only fail again.
      return {
        ok: false,
        kind: "too_large",
        limitBytes: maxOutput,
        message: "The extracted tables archive exceeds the worker size limit.",
      };
    }
    return {
      ok: true,
      output,
      filenameExt: "zip",
      contentType: "application/zip",
      meta: {
        engine: EXTRACT_TABLES_ENGINE,
        tool: EXTRACT_TABLES_TOOL,
        tableCount: tables.length,
        pageCount: layout.pageCount,
        inputBytes: input.byteLength,
        outputBytes: output.byteLength,
      },
    };
  } catch (error) {
    rethrowIfAttemptAbort(error);
    // Every throw used to land here as one retryable `failed`, so a
    // password-protected statement was requeued twice with nothing changed
    // and then reported as "could not be processed". Ask the shared
    // classifier what the failure says about the DOCUMENT first; only a run
    // that did not finish stays retryable.
    switch (await classifyPdfTextFailure(error, input, deps.isEncrypted)) {
      case "too_large":
        return {
          ok: false,
          kind: "too_large",
          message:
            "The text layout extracted from this PDF exceeds the worker's limit.",
        };
      case "password_protected":
        return {
          ok: false,
          kind: "password_protected",
          message:
            "This PDF is password-protected. Unlock it with Unlock PDF, then extract its tables.",
        };
      case "unreadable":
        return {
          ok: false,
          kind: "unreadable",
          message:
            "This PDF could not be opened. It may be damaged; Repair PDF can often fix that.",
        };
      default:
        return {
          ok: false,
          kind: "failed",
          message: "The PDF could not be processed for table extraction.",
        };
    }
  }
}
