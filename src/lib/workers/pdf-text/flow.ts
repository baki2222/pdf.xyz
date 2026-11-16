/**
 * Turn poppler's reading-order layout into the PARAGRAPHS a word processor
 * expects — the text model behind PDF to Word.
 *
 * WHY THIS EXISTS. PDF to Word used to write one `<w:p>` per line of
 * `pdftotext -layout` output. `-layout` reproduces the page's visual
 * arrangement, so on a two-column page every printed row came out as the left
 * column's line, a run of spaces, and the right column's line — measured on
 * poppler 25.07, paragraph 1 of the DOCX was `"The quarterly results show that
 * revenue      Risks include currency exposure in the"`. Every two-column
 * report, paper and newsletter was scrambled, and every sentence was cut at
 * every printed line, so nothing reflowed when edited.
 *
 * poppler's `-bbox-layout` carries its reading-order analysis — flows and
 * blocks — which is MOSTLY the column-correct order. It has the opposite
 * failure on a TABLE: the same analysis treats each table column as a text
 * column (measured, poppler 25.07: a 4×3 grid came out as four three-line
 * blocks), so reading order alone would print the table transposed, one cell
 * per paragraph. Both failures are silent and both documents are common, so
 * this module keeps the geometry and uses it for three decisions: which order
 * the blocks are read in, which rows of the page are table rows, and where
 * inside a block one paragraph ends and the next begins.
 *
 * ORDER. poppler's reading order is followed only where the page gives it
 * nothing better: blocks are ordered by cutting the page along whitespace
 * that runs its full height (a gutter: left group first) or its full width
 * (top group first), recursively, and only a group that cannot be cut keeps
 * poppler's order. poppler cuts ACROSS first — measured, poppler 25.07,
 * `columnHeadingsPdf`: headings aligned across a two-column page came out
 * between the two columns' paragraphs, "Outlook", "Summary", then the left
 * column's body, so every heading was detached from the text under it.
 *
 * TABLES. The rules, each with its reason:
 *
 *  1. **A big horizontal gap splits a line into cells.** poppler may put a
 *     whole table row in one `<line>`; the gap between cells is many times a
 *     word space, while even justified prose rarely stretches a space past one
 *     em. {@link CELL_GAP_EMS} is that line.
 *  2. **A candidate table is a run of consecutive bands** (lines sharing a
 *     baseline) that each hold two or more cells. Nothing about the band on
 *     its own says "table": two columns of prose share baselines too, and a
 *     statement row holds one long label beside one short amount. So the run
 *     is judged as a whole, by its COLUMNS (cells grouped by overlapping x).
 *  3. **A table has a column of values**: every cell short — under
 *     {@link LONG_CELL_WORDS} words: amounts, codes, quarters — every cell on
 *     one shared edge (left, right or centre, within {@link ALIGN_EMS}), and
 *     the column not a LIST. Two columns of prose have no such column,
 *     whatever their line lengths elsewhere; words scattered over a diagram
 *     overlap without sharing an edge; and two bulleted lists side by side
 *     are short, aligned and on shared baselines — measured, poppler 25.07,
 *     `columnListsPdf`: without the list test, "• Strong cash\t- Currency
 *     swings", the lists interleaved item by item. A column is a list when at
 *     least half its cells start with a list marker ({@link isListItem}).
 *     (The first version counted long cells PER BAND and gave up at half: a
 *     label/amount row with a four-word label is exactly half, so no income
 *     statement ever formed a run — measured, `incomeStatementPdf`.)
 *  4. **A table's cells are items, not wrapped text.** If a line of the run
 *     carries a sentence over a line break inside its poppler block — a line
 *     of {@link LONG_CELL_WORDS}+ words followed by one that starts in
 *     lowercase — the run is running text set beside something aligned, and
 *     it is read in reading order. Scripts without letter case give this rule
 *     nothing to see; rule 3 still separates two columns of their prose, but
 *     a narrow list beside a paragraph is read as a table.
 *  5. **A run does not start or end inside a paragraph.** A first band holding
 *     a line whose block has a line of {@link LONG_CELL_WORDS}+ words just
 *     above it, outside the run, is that paragraph's tail, and leaves the run;
 *     likewise a last band holding a paragraph's first line. What is left is
 *     judged again. Measured, poppler 25.07, `newsletterPdf` and
 *     `columnHeadingsPdf`: two paragraphs ending on short lines above aligned
 *     headings were cut, and their last lines written as one tabbed row — and
 *     where the last line starts with a capital ("Costs fell."), nothing on
 *     the line itself says it continues anything.
 *  6. **A table is {@link MIN_TABLE_ROWS} or more rows.** One aligned pair of
 *     short lines is as likely to be two column headings as a table.
 *
 * Known limit: a cell that wraps onto a second line breaks its run (the
 * continuation is a one-cell band), so a table with multi-line cells is read
 * in poppler's order, column by column.
 *
 * PARAGRAPHS. Everything else is read block by block. poppler's block is not a
 * paragraph: set in one font, size and pitch, a whole letter — salutation,
 * paragraphs, a numbered list, the closing — is ONE block (measured, poppler
 * 25.07, `letterPdf`), and joining its lines wrote the letter as a single
 * paragraph. A new paragraph starts at line B, after line A, when
 * ({@link startsParagraph}):
 *
 *  - B starts with a list marker; otherwise never when B starts in lowercase,
 *    which continues a sentence;
 *  - the gap above B is wider than the block's usual line gap by half a line;
 *  - A is SHORT — under {@link SHORT_LINE_RATIO} of the block's widest line —
 *    and ends a sentence or clause (`.`, `!`, `?`, `:`, `;` or a salutation's
 *    `,`): only a paragraph's last line stops short of the measure, and a full
 *    line ending in a full stop is the middle of a justified paragraph;
 *  - A is a heading or a line of its own — under {@link HEADING_LINE_RATIO}
 *    of the widest, with no closing punctuation; or B is one, after a line
 *    that ends a sentence and before a line that does not continue it.
 *
 * Lines are joined with a space. A line that ends in a hyphen is joined to a
 * lowercase continuation WITHOUT a space and WITH its hyphen: removing it
 * would turn "well-known" into "wellknown", and deleting characters the
 * document contains is a worse failure than keeping one it did not need. A
 * soft hyphen (U+00AD) is only ever a line-break artefact, so it goes.
 *
 * Known limit: a block of short lines with no markers and no gaps — an
 * address on its own — has no line shorter than its widest, and is joined.
 *
 * A paragraph is a list of cells: one cell is a prose paragraph, two or more is
 * a table row. Since #28 slice 2 (2026-11-15) a row of a recognised table also
 * carries its GRID (`PdfFlowTextPage.tables`, `./table-grid`): which table it
 * belongs to and which column each cell sits in, so PDF to Word writes the
 * table as a Word table with each value in its column. A run split by white
 * space wider than `SEGMENT_GAP_PITCHES` band pitches is two tables (grid
 * SEGMENTS) — only identity changes, never a paragraph or its order. A table
 * the grid refuses, and a lone wide-gapped line, stay rows whose cells the
 * writer separates with tabs.
 */
import type { FlowBlock, FlowLine, FlowPage, PdfFlowLayout } from "./parse";
import {
  chainColumns,
  MAX_TABLE_CELLS_PER_PAGE,
  MAX_TABLE_SLOTS_PER_PAGE,
  SEGMENT_GAP_PITCHES,
  tableGrid,
  wordTableDoubt,
} from "./table-grid";

/** Gap between words, in line heights, beyond which a line splits into cells. */
export const CELL_GAP_EMS = 2;
/**
 * A cell with at least this many words reads as text, not a table value: a
 * table needs one column where every cell is shorter, and only a line this
 * long can wrap a sentence onto the next.
 */
export const LONG_CELL_WORDS = 4;
/** A table needs at least this many consecutive table rows. */
export const MIN_TABLE_ROWS = 2;
/** How far, in line heights, a column's cells may stray from a shared edge. */
export const ALIGN_EMS = 0.5;
/**
 * A line narrower than this share of its block's widest line, ending a
 * sentence or clause, ends its paragraph.
 */
export const SHORT_LINE_RATIO = 0.7;
/**
 * A line narrower than this share of its block's widest line, with no closing
 * punctuation, is a heading or a line of its own (a name, a date).
 */
export const HEADING_LINE_RATIO = 0.5;

/**
 * Where a list item starts: a bullet or dash, a number, a lowercase letter or
 * roman numeral with `.` or `)`, or a capital with `)` — then a space and the
 * item. A capital with a full stop is left out: "J. Smith" is a name.
 */
const LIST_MARKER =
  /^(?:[•◦▪▫‣⁃∙·●○■□*–—-]|\(?(?:\d{1,3}|[a-z]|[ivx]{1,4})[.)]|\(?[A-Z]\))\s+\S/u;

/** True when `text` opens with a list marker and an item after it. */
export function isListItem(text: string): boolean {
  return LIST_MARKER.test(text);
}

/** Ends a sentence or a clause: `.` `!` `?` `:` `;` `,`, then any closers. */
const ENDS_CLAUSE = /[.!?:;,]["'”’»)\]]*$/u;
/** Ends a sentence: `.` `!` `?` `:`, then any closers. */
const ENDS_SENTENCE = /[.!?:]["'”’»)\]]*$/u;
/** Ends in a letter or digit — no closing punctuation at all. */
const ENDS_BARE = /[\p{L}\p{N}]$/u;
const STARTS_LOWER = /^\p{Ll}/u;

/** U+00AD, written as an escape so the instrument can be read. */
const SOFT_HYPHEN = "\u00AD";

/** One paragraph: a single prose cell, or a table row of two or more cells. */
export type FlowParagraph = readonly string[];

/** A paragraph's bounds on its page: x0, y0, x1, y1 in poppler's frame. */
export type FlowBox = readonly [number, number, number, number];

/**
 * One of poppler's words as it stands in a cell's text: the text it adds —
 * the word, with the separator that joins it to the word before at its HEAD
 * (`" word"`), or a soft hyphen cut from its tail where the next line
 * continues it — and the word's own box. A cell's pieces concatenate to the
 * cell's text EXACTLY; PDF to Word gives each piece its formatting
 * (`../pdf-office-export/docx-run-style`), so the text never changes.
 */
export interface FlowPiece {
  text: string;
  box: FlowBox;
}

export interface PdfFlowTextPage {
  pageNumber: number;
  paragraphs: FlowParagraph[];
  /**
   * Each paragraph's bounds, parallel to `paragraphs`: the union of the
   * lines it was built from, in poppler's `-bbox-layout` frame (points from
   * the top left of the media box, the page's /Rotate applied). PDF to Word
   * places pictures among the paragraphs by them. Absent from a page built
   * by hand rather than from a layout.
   */
  boxes?: FlowBox[];
  /**
   * Each paragraph's cells as poppler's words, parallel to `paragraphs`:
   * `pieces[i][c]` concatenates to `paragraphs[i][c]`, exactly. Absent from
   * a page built by hand; PDF to Word then writes each cell as one run.
   */
  pieces?: FlowPiece[][][];
  /**
   * #28 slice 2: each paragraph's table row, parallel to `paragraphs` —
   * undefined for prose, a lone wide-gapped line, and a table the grid
   * refused. Absent when the page has no Word table, and from a page built
   * by hand. {@link flowPageText} reads neither this nor `tablesAsTabs`.
   */
  tables?: (FlowTableRow | undefined)[];
  /**
   * Tables (grid segments) this page recognised but keeps as tab-separated
   * rows: over a cap, more than 63 columns, one column, a segment of one
   * row, or a grid that failed its order check. Absent when 0.
   */
  tablesAsTabs?: number;
}

/**
 * One row of a Word table: the table's id on its page, the table's column
 * x-ranges (one array, shared by every row of the table), and the column
 * each of the row's cells sits in — non-decreasing; two cells of one row may
 * share a column (a header spanning sub-columns chains them).
 */
export interface FlowTableRow {
  table: number;
  spans: readonly (readonly [number, number])[];
  col: readonly number[];
}

/** What PDF to Word writes: every page, in order, as paragraphs. */
export interface PdfFlowText {
  pageCount: number;
  pages: PdfFlowTextPage[];
}

interface Cell {
  text: string;
  words: number;
  xMin: number;
  xMax: number;
  /** Its words, each with the separator before it: they concatenate to `text`. */
  pieces: FlowPiece[];
}

interface PlacedLine {
  line: FlowLine;
  /** The lines before and after this one in its poppler block, if any. */
  prev: FlowLine | null;
  next: FlowLine | null;
  cells: Cell[];
  yCenter: number;
  height: number;
}

function joinWords(words: readonly { text: string }[]): string {
  return words.map((w) => w.text).join(" ");
}

/** Split a line into cells wherever the gap between two words is table-wide. */
function lineCells(line: FlowLine): Cell[] {
  const height = Math.max(1, line.yMax - line.yMin);
  const words = [...line.words].sort((a, b) => a.xMin - b.xMin);
  const cells: Cell[] = [];
  let run: typeof words = [];
  for (const word of words) {
    const prev = run[run.length - 1];
    if (prev && word.xMin - prev.xMax > CELL_GAP_EMS * height) {
      cells.push(cellOf(run));
      run = [];
    }
    run.push(word);
  }
  if (run.length) cells.push(cellOf(run));
  return cells;
}

function cellOf(words: readonly FlowLine["words"][number][]): Cell {
  // A loop, not Math.max(...spread): a line of tens of thousands of words
  // would overflow the argument list.
  let xMax = -Infinity;
  for (const w of words) if (w.xMax > xMax) xMax = w.xMax;
  return {
    text: joinWords(words),
    words: words.length,
    xMin: words[0]!.xMin,
    xMax,
    pieces: words.map((w, k) => ({
      text: k === 0 ? w.text : ` ${w.text}`,
      box: [w.xMin, w.yMin, w.xMax, w.yMax] as const,
    })),
  };
}

/** Group lines into horizontal bands that share a baseline, top to bottom. */
function bands(lines: PlacedLine[]): PlacedLine[][] {
  const sorted = [...lines].sort((a, b) => a.yCenter - b.yCenter);
  const out: PlacedLine[][] = [];
  for (const line of sorted) {
    const band = out[out.length - 1];
    const anchor = band?.[0];
    if (
      anchor &&
      Math.abs(line.yCenter - anchor.yCenter) <=
        0.5 * Math.min(line.height, anchor.height)
    ) {
      band!.push(line);
    } else {
      out.push([line]);
    }
  }
  return out;
}

/** Two or more cells side by side: a band that COULD be a table row. */
function isAlignedBand(band: PlacedLine[]): boolean {
  return band.reduce((n, l) => n + l.cells.length, 0) >= 2;
}

/**
 * A run's cells grouped into columns: cells whose x-ranges overlap, chained.
 * The SAME rule the Word table's grid uses (`./table-grid`, #28 slice 2): one
 * function, so a table's columns here and in Word cannot disagree.
 */
function columns(run: PlacedLine[][]): Cell[][] {
  return chainColumns(run.flatMap((band) => band.flatMap((l) => l.cells)))
    .groups;
}

/** The least and greatest of `xs` — a loop, not a spread (#28 slice 2). */
function extent(xs: readonly number[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of xs) {
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  return [lo, hi];
}

const lineText = (line: FlowLine) => joinWords(line.words);
const lineWidth = (line: FlowLine) => line.xMax - line.xMin;
const lineHeight = (line: FlowLine) => Math.max(1, line.yMax - line.yMin);

/** Every cell of `column` on one left, right or centre edge (rule 3). */
function sharesAnEdge(column: readonly Cell[], tolerance: number): boolean {
  // A loop, not Math.max(...xs): a column of 10^5 cells overflowed the
  // argument list before any table cap ran (#28 slice 2, 2026-11-15).
  const spread = (xs: number[]) => {
    const [lo, hi] = extent(xs);
    return hi - lo;
  };
  return [
    column.map((c) => c.xMin),
    column.map((c) => c.xMax),
    column.map((c) => (c.xMin + c.xMax) / 2),
  ].some((edge) => spread(edge) <= tolerance);
}

/** Rule 3: short cells on a shared edge, and not a list. */
function isValueColumn(column: readonly Cell[], tolerance: number): boolean {
  const listItems = column.filter((c) => isListItem(c.text)).length;
  return (
    column.every((cell) => cell.words < LONG_CELL_WORDS) &&
    sharesAnEdge(column, tolerance) &&
    2 * listItems < column.length
  );
}

/** `upper` carries a sentence over the line break into `lower` (rule 4). */
function wrapsInto(upper: FlowLine | null, lower: FlowLine | null): boolean {
  return (
    upper !== null &&
    lower !== null &&
    upper.words.length >= LONG_CELL_WORDS &&
    STARTS_LOWER.test(lineText(lower))
  );
}

/**
 * Rule 5: drop a first band that is a paragraph's tail and a last band that
 * is a paragraph's head — a band holding a line whose neighbour in its own
 * block, outside the run, is a line of prose.
 */
function trimParagraphEdges(run: PlacedLine[][]): PlacedLine[][] {
  const out = [...run];
  const inRun = new Set(out.flatMap((band) => band.map((l) => l.line)));
  const prose = (line: FlowLine | null) =>
    line !== null && !inRun.has(line) && line.words.length >= LONG_CELL_WORDS;
  while (out.length && out[0]!.some((l) => prose(l.prev))) {
    for (const l of out.shift()!) inRun.delete(l.line);
  }
  while (out.length && out[out.length - 1]!.some((l) => prose(l.next))) {
    for (const l of out.pop()!) inRun.delete(l.line);
  }
  return out;
}

/** Rules 3, 4 and 6: is this run of aligned bands a table? */
function isTable(run: PlacedLine[][]): boolean {
  if (run.length < MIN_TABLE_ROWS) return false;
  const tolerance =
    ALIGN_EMS * extent(run.flatMap((band) => band.map((l) => l.height)))[0];
  if (!columns(run).some((column) => isValueColumn(column, tolerance)))
    return false;
  return !run.some((band) => band.some((l) => wrapsInto(l.line, l.next)));
}

interface OrderedBlock {
  block: FlowBlock;
  /** poppler's position for this block — the order of last resort. */
  index: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/**
 * Split `blocks` wherever nothing spans the whitespace between two of them
 * along one axis — `lo`/`hi` read that axis — in order along it.
 */
function cut(
  blocks: readonly OrderedBlock[],
  lo: (b: OrderedBlock) => number,
  hi: (b: OrderedBlock) => number,
): OrderedBlock[][] {
  const sorted = [...blocks].sort((a, b) => lo(a) - lo(b));
  const groups: OrderedBlock[][] = [];
  let reach = -Infinity;
  for (const block of sorted) {
    if (groups.length && lo(block) < reach)
      groups[groups.length - 1]!.push(block);
    else groups.push([block]);
    reach = Math.max(reach, hi(block));
  }
  return groups;
}

/** Reading order: gutters first, then whitespace across, then poppler's. */
function xyCut(blocks: readonly OrderedBlock[]): OrderedBlock[] {
  if (blocks.length <= 1) return [...blocks];
  const across = cut(
    blocks,
    (b) => b.xMin,
    (b) => b.xMax,
  );
  if (across.length > 1) return across.flatMap(xyCut);
  const down = cut(
    blocks,
    (b) => b.yMin,
    (b) => b.yMax,
  );
  if (down.length > 1) return down.flatMap(xyCut);
  return [...blocks].sort((a, b) => a.index - b.index);
}

/** The page's blocks in column-by-column reading order. */
function readingOrder(blocks: readonly FlowBlock[]): FlowBlock[] {
  return xyCut(
    blocks.map((block, index) => {
      const [x0, y0, x1, y1] = boxOfLines(block.lines);
      return { block, index, xMin: x0, xMax: x1, yMin: y0, yMax: y1 };
    }),
  ).map((b) => b.block);
}

/** What {@link startsParagraph} knows about the block it reads. */
interface BlockMeasure {
  widest: number;
  /** The block's usual gap between lines: the lower median. */
  gap: number;
}

function measureBlock(lines: readonly FlowLine[]): BlockMeasure {
  const gaps = lines
    .slice(1)
    .map((l, i) => l.yMin - lines[i]!.yMax)
    .sort((a, b) => a - b);
  return {
    widest: extent(lines.map(lineWidth))[1],
    gap: gaps.length ? gaps[Math.floor((gaps.length - 1) / 2)]! : 0,
  };
}

/** A heading, or a line of its own: short, with no closing punctuation. */
function standsAlone(line: FlowLine, measure: BlockMeasure): boolean {
  return (
    lineWidth(line) < HEADING_LINE_RATIO * measure.widest &&
    ENDS_BARE.test(lineText(line))
  );
}

/**
 * Does line `i` of a block start a new paragraph after line `i - 1`? The
 * rules, and why, are in this module's docblock under PARAGRAPHS.
 */
function startsParagraph(
  lines: readonly FlowLine[],
  i: number,
  measure: BlockMeasure = measureBlock(lines),
): boolean {
  const a = lines[i - 1];
  const b = lines[i];
  if (!a || !b) return false;
  const textA = lineText(a);
  const textB = lineText(b);
  if (isListItem(textB)) return true;
  if (STARTS_LOWER.test(textB)) return false;
  if (
    b.yMin - a.yMax >
    measure.gap + 0.5 * Math.min(lineHeight(a), lineHeight(b))
  )
    return true;
  if (
    lineWidth(a) < SHORT_LINE_RATIO * measure.widest &&
    ENDS_CLAUSE.test(textA)
  )
    return true;
  if (standsAlone(a, measure)) return true;
  const c = lines[i + 1];
  return (
    ENDS_SENTENCE.test(textA) &&
    standsAlone(b, measure) &&
    c !== undefined &&
    !STARTS_LOWER.test(lineText(c))
  );
}

/** Join a paragraph's lines, mending line-break hyphenation. */
function joinLines(texts: readonly string[]): string {
  let out = "";
  for (const text of texts) {
    if (out.length === 0) {
      out = text;
    } else if (out.endsWith(SOFT_HYPHEN)) {
      out = out.slice(0, -1) + text;
    } else if (/\p{L}-$/u.test(out) && STARTS_LOWER.test(text)) {
      out += text;
    } else {
      out += ` ${text}`;
    }
  }
  return out;
}

/**
 * {@link joinLines} over pieces: the SAME three branches, so the pieces
 * concatenate to exactly the text `joinLines` makes — the separator goes at
 * the head of the next line's first piece (`" word"`); a soft hyphen is cut
 * from the tail of the line before; a letter-hyphen line joins a lowercase
 * continuation with nothing between.
 */
function joinPieces(lines: readonly (readonly FlowPiece[])[]): FlowPiece[] {
  const out: FlowPiece[] = [];
  let joined = "";
  for (const line of lines) {
    const text = line.map((p) => p.text).join("");
    if (out.length === 0 && joined.length === 0) {
      for (const piece of line) out.push(piece);
      joined = text;
      continue;
    }
    if (joined.endsWith(SOFT_HYPHEN)) {
      const last = out[out.length - 1]!;
      const cut = last.text.slice(0, -1);
      if (cut.length > 0) out[out.length - 1] = { ...last, text: cut };
      else out.pop();
      joined = joined.slice(0, -1);
      for (const piece of line) out.push(piece);
      joined += text;
    } else if (/\p{L}-$/u.test(joined) && STARTS_LOWER.test(text)) {
      for (const piece of line) out.push(piece);
      joined += text;
    } else {
      const [first, ...rest] = line;
      if (first) out.push({ ...first, text: ` ${first.text}` }, ...rest);
      joined += ` ${text}`;
    }
  }
  return out;
}

/** The union of `lines`' boxes — loops, not spreads, for very long lists. */
function boxOfLines(lines: readonly FlowLine[]): FlowBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const l of lines) {
    if (l.xMin < x0) x0 = l.xMin;
    if (l.yMin < y0) y0 = l.yMin;
    if (l.xMax > x1) x1 = l.xMax;
    if (l.yMax > y1) y1 = l.yMax;
  }
  return [x0, y0, x1, y1];
}

/** One paragraph and the lines it was built from, as their bounds. */
export interface PlacedParagraph {
  cells: FlowParagraph;
  box: FlowBox;
  /** Each cell as poppler's words: `pieces[c]` concatenates to `cells[c]`. */
  pieces: FlowPiece[][];
  /** Its Word-table row (#28 slice 2); absent for everything else. */
  row?: FlowTableRow;
}

/**
 * A recognised table's rows split into grid SEGMENTS (#28 slice 2): a new
 * segment starts where the centre-to-centre gap between two bands is more
 * than `SEGMENT_GAP_PITCHES` times the run's median gap. Two tables set one
 * above the other with white space between are then two tables, and the
 * second's values are never placed under the first one's headings.
 */
function segments<T>(rows: readonly T[], centres: readonly number[]): T[][] {
  const gaps = centres.slice(1).map((c, k) => c - centres[k]!);
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted.length
    ? sorted[Math.floor((sorted.length - 1) / 2)]!
    : 0;
  const out: T[][] = [];
  rows.forEach((row, k) => {
    if (k === 0 || gaps[k - 1]! > SEGMENT_GAP_PITCHES * median) out.push([]);
    out[out.length - 1]!.push(row);
  });
  return out;
}

/**
 * The paragraphs of one page, in reading order, with its tables kept as
 * rows — each with the bounds of the lines it was built from.
 */
export function placedParagraphs(page: FlowPage): PlacedParagraph[] {
  return placedPage(page).paragraphs;
}

/** {@link placedParagraphs}, and how many tables stay tabbed rows. */
function placedPage(page: FlowPage): {
  paragraphs: PlacedParagraph[];
  tablesAsTabs: number;
} {
  const placed = new Map<FlowLine, PlacedLine>();
  for (const block of page.blocks)
    block.lines.forEach((line, i) =>
      placed.set(line, {
        line,
        prev: block.lines[i - 1] ?? null,
        next: block.lines[i + 1] ?? null,
        cells: lineCells(line),
        yCenter: (line.yMin + line.yMax) / 2,
        height: lineHeight(line),
      }),
    );

  // Tables: maximal runs of consecutive aligned bands, trimmed of paragraph
  // edges (rule 5), that pass isTable.
  const tableOf = new Map<FlowLine, PlacedParagraph[]>();
  let run: PlacedLine[][] = [];
  // #28 slice 2: what this page may still write as Word tables, and the
  // tables (grid segments) it keeps as tabbed rows.
  const budget = {
    cells: MAX_TABLE_CELLS_PER_PAGE,
    slots: MAX_TABLE_SLOTS_PER_PAGE,
  };
  let tables = 0;
  let tablesAsTabs = 0;
  const closeRun = () => {
    const table = trimParagraphEdges(run);
    if (isTable(table)) {
      const built = table.map((band) => {
        const cells = band
          .flatMap((l) => l.cells)
          .sort((a, b) => a.xMin - b.xMin);
        const row: PlacedParagraph = {
          cells: cells.map((c) => c.text),
          box: boxOfLines(band.map((l) => l.line)),
          pieces: cells.map((c) => c.pieces),
        };
        return { row, cells };
      });
      // The grid, per segment and never across one. Only identity is
      // stamped here: the rows, and their order, are what they were.
      for (const segment of segments(
        built,
        table.map((band) => band[0]!.yCenter),
      )) {
        if (segment.length < MIN_TABLE_ROWS) continue;
        // A one-row segment is not a table (rule 6), so not counted as one
        // kept as tabs: it is the line it was. Every other refusal — the
        // grid's (caps, columns) and, since review round 2, a doubtful
        // table's (`wordTableDoubt`: too few rows, no column of figures, a
        // column of sentences, a heading over no value) — stays the tabbed
        // rows main wrote, and is counted.
        const cells = segment.map((r) => r.cells);
        const geometry = tableGrid(cells, budget);
        const grid =
          typeof geometry === "string"
            ? geometry
            : (wordTableDoubt(cells, geometry) ?? geometry);
        if (typeof grid === "string") {
          tablesAsTabs += 1;
          continue;
        }
        let count = 0;
        for (const r of segment) count += r.cells.length;
        budget.cells -= count;
        budget.slots -= segment.length * grid.spans.length;
        const id = tables++;
        segment.forEach((r, k) => {
          r.row.row = { table: id, spans: grid.spans, col: grid.col[k]! };
        });
      }
      const rows = built.map((r) => r.row);
      for (const band of table) for (const l of band) tableOf.set(l.line, rows);
    }
    run = [];
  };
  for (const band of bands([...placed.values()])) {
    if (isAlignedBand(band)) run.push(band);
    else closeRun();
  }
  closeRun();

  const paragraphs: PlacedParagraph[] = [];
  const emitted = new Set<PlacedParagraph[]>();
  for (const block of readingOrder(page.blocks)) {
    const measure = measureBlock(block.lines);
    let prose: FlowLine[] = [];
    const flush = () => {
      if (prose.length)
        paragraphs.push({
          cells: [joinLines(prose.map((l) => placed.get(l)!.cells[0]!.text))],
          box: boxOfLines(prose),
          pieces: [
            joinPieces(prose.map((l) => placed.get(l)!.cells[0]!.pieces)),
          ],
        });
      prose = [];
    };
    block.lines.forEach((line, i) => {
      const table = tableOf.get(line);
      if (table) {
        flush();
        if (!emitted.has(table)) {
          emitted.add(table);
          // A loop, not push(...table): a table of 10^5 rows overflowed the
          // argument list (#28 slice 2, `docx-table-measure.ts spread`).
          for (const row of table) paragraphs.push(row);
        }
        return;
      }
      const cells = placed.get(line)!.cells;
      if (cells.length > 1) {
        // A lone wide-gapped line — a header's left and right halves, say — is
        // kept as one tabbed row rather than run into the prose around it:
        // still a tabbed paragraph, not a Word table (#28 slice 2): one line
        // is as likely a header's halves as a row; two such lines in a row
        // are a run and are judged by isTable.
        flush();
        paragraphs.push({
          cells: cells.map((c) => c.text),
          box: boxOfLines([line]),
          pieces: cells.map((c) => c.pieces),
        });
        return;
      }
      if (prose.length && startsParagraph(block.lines, i, measure)) flush();
      prose.push(line);
    });
    flush();
  }
  return { paragraphs, tablesAsTabs };
}

/** The paragraphs of one page, in reading order, with its tables kept as rows. */
export function flowParagraphs(page: FlowPage): FlowParagraph[] {
  return placedParagraphs(page).map((p) => p.cells);
}

/** Every page of a parsed `-bbox-layout` document as paragraphs. */
export function flowText(layout: PdfFlowLayout): PdfFlowText {
  return {
    pageCount: layout.pageCount,
    pages: layout.pages.map((page) => {
      const { paragraphs: placed, tablesAsTabs } = placedPage(page);
      const tables = placed.map((p) => p.row);
      return {
        pageNumber: page.pageNumber,
        paragraphs: placed.map((p) => p.cells),
        boxes: placed.map((p) => p.box),
        pieces: placed.map((p) => p.pieces),
        ...(tables.some(Boolean) ? { tables } : {}),
        ...(tablesAsTabs > 0 ? { tablesAsTabs } : {}),
      };
    }),
  };
}

/**
 * A page's paragraphs as plain text, one per line. A table row reads as its
 * cells joined by tab — the order docx-structure reads a `w:tbl` row in
 * (empty slots skipped). #28 slice 2.
 *
 * Translate SENDS this text to the model (2026-11-16, reading order), in
 * place of the page's `-layout` text, but only where
 * `../translate/reading-order` (`translatePageBlocks`) lets it: the same ink,
 * no longer than `-layout`, and no right-to-left script. It is the ONE
 * per-page flow text; there is no Translate variant. The tests that hold the
 * gate and the weighing are `reading-order.test.ts` and
 * `reading-order.chain.test.ts` beside that module.
 */
export function flowPageText(page: PdfFlowTextPage): string {
  return page.paragraphs.map((p) => p.join("\t")).join("\n");
}
