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
 * blocks — which is the column-correct order. It has the opposite failure on a
 * TABLE: the same analysis treats each table column as a text column (measured,
 * poppler 25.07: a 4×3 grid came out as four three-line blocks), so reading
 * order alone would print the table transposed, one cell per paragraph. Both
 * failures are silent and both documents are common, so this module keeps the
 * geometry and uses it for exactly one decision: is this row of the page a
 * table row?
 *
 * The rules, each with its reason:
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
 *  3. **A table has a column of values.** At least one column in which every
 *     cell is short — under {@link LONG_CELL_WORDS} words: amounts, codes,
 *     quarters. Two columns of prose have none, whatever their line lengths
 *     elsewhere. (The first version of this rule counted long cells PER BAND
 *     and gave up at half: a label/amount row with a four-word label is
 *     exactly half, so no income statement, bank statement or SKU list with a
 *     text column ever formed a run, and every label was printed before every
 *     amount — measured, poppler 25.07, `incomeStatementPdf`.)
 *  4. **A table's cells are items, not wrapped text.** If any line of the run
 *     is a sentence carried over a line break inside its poppler block — a
 *     line of {@link LONG_CELL_WORDS}+ words followed by one that starts in
 *     lowercase — the run is running text set beside something aligned, and
 *     it is read in reading order. Checked in BOTH directions, so a run that
 *     starts at the tail of a paragraph ("…, and" / "it went well.") is
 *     rejected even when the paragraph's earlier lines sit outside the run.
 *     (Measured, poppler 25.07, `newsletterPdf`: without it, two paragraphs
 *     ending on short lines above aligned headings were cut, and their last
 *     lines written as one tab-separated row.) Scripts without letter case
 *     give this rule nothing to see; rule 3 still separates two columns of
 *     their prose, but a narrow list beside a paragraph is read as a table.
 *  5. **A table is {@link MIN_TABLE_ROWS} or more rows.** One aligned pair of
 *     short lines is as likely to be two column headings as a table.
 *  6. **Everything else is read in poppler's order**, one paragraph per block,
 *     lines joined with a space. A line that ends in a hyphen is joined to a
 *     lowercase continuation WITHOUT a space and WITH its hyphen: removing it
 *     would turn "well-known" into "wellknown", and deleting characters the
 *     document contains is a worse failure than keeping one it did not need.
 *     A soft hyphen (U+00AD) is only ever a line-break artefact, so it goes.
 *
 * Known limit: a cell that wraps onto a second line breaks its run (the
 * continuation is a one-cell band), so a table with multi-line cells is read
 * in poppler's order, column by column.
 *
 * A paragraph is a list of cells: one cell is a prose paragraph, two or more is
 * a table row, which the DOCX writer separates with tabs.
 */
import type { FlowLine, FlowPage, PdfFlowLayout } from "./parse";

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

/** One paragraph: a single prose cell, or a table row of two or more cells. */
export type FlowParagraph = readonly string[];

export interface PdfFlowTextPage {
  pageNumber: number;
  paragraphs: FlowParagraph[];
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
  return {
    text: joinWords(words),
    words: words.length,
    xMin: words[0]!.xMin,
    xMax: Math.max(...words.map((w) => w.xMax)),
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

/** A run's cells grouped into columns: cells whose x-ranges overlap, chained. */
function columns(run: PlacedLine[][]): Cell[][] {
  const cells = run
    .flatMap((band) => band.flatMap((l) => l.cells))
    .sort((a, b) => a.xMin - b.xMin);
  const out: { xMax: number; cells: Cell[] }[] = [];
  for (const cell of cells) {
    const last = out[out.length - 1];
    if (last && cell.xMin <= last.xMax) {
      last.cells.push(cell);
      last.xMax = Math.max(last.xMax, cell.xMax);
    } else {
      out.push({ xMax: cell.xMax, cells: [cell] });
    }
  }
  return out.map((c) => c.cells);
}

const lineText = (line: FlowLine) => joinWords(line.words);

/** `upper` carries a sentence over the line break into `lower` (rule 4). */
function wrapsInto(upper: FlowLine | null, lower: FlowLine | null): boolean {
  return (
    upper !== null &&
    lower !== null &&
    upper.words.length >= LONG_CELL_WORDS &&
    /^\p{Ll}/u.test(lineText(lower))
  );
}

/** Rules 3–5: is this run of aligned bands a table? */
function isTable(run: PlacedLine[][]): boolean {
  if (run.length < MIN_TABLE_ROWS) return false;
  const hasValueColumn = columns(run).some((column) =>
    column.every((cell) => cell.words < LONG_CELL_WORDS),
  );
  if (!hasValueColumn) return false;
  return !run.some((band) =>
    band.some((l) => wrapsInto(l.prev, l.line) || wrapsInto(l.line, l.next)),
  );
}

/** Join a block's lines into one paragraph, mending line-break hyphenation. */
function joinLines(texts: readonly string[]): string {
  let out = "";
  for (const text of texts) {
    if (out.length === 0) {
      out = text;
    } else if (out.endsWith("­")) {
      out = out.slice(0, -1) + text;
    } else if (/\p{L}-$/u.test(out) && /^\p{Ll}/u.test(text)) {
      out += text;
    } else {
      out += ` ${text}`;
    }
  }
  return out;
}

/** The paragraphs of one page, in reading order, with its tables kept as rows. */
export function flowParagraphs(page: FlowPage): FlowParagraph[] {
  const placed = new Map<FlowLine, PlacedLine>();
  for (const block of page.blocks)
    block.lines.forEach((line, i) =>
      placed.set(line, {
        line,
        prev: block.lines[i - 1] ?? null,
        next: block.lines[i + 1] ?? null,
        cells: lineCells(line),
        yCenter: (line.yMin + line.yMax) / 2,
        height: Math.max(1, line.yMax - line.yMin),
      }),
    );

  // Tables: maximal runs of consecutive aligned bands that pass isTable.
  const tableOf = new Map<FlowLine, FlowParagraph[]>();
  let run: PlacedLine[][] = [];
  const closeRun = () => {
    if (isTable(run)) {
      const rows = run.map((band) =>
        band
          .flatMap((l) => l.cells)
          .sort((a, b) => a.xMin - b.xMin)
          .map((c) => c.text),
      );
      for (const band of run) for (const l of band) tableOf.set(l.line, rows);
    }
    run = [];
  };
  for (const band of bands([...placed.values()])) {
    if (isAlignedBand(band)) run.push(band);
    else closeRun();
  }
  closeRun();

  const paragraphs: FlowParagraph[] = [];
  const emitted = new Set<FlowParagraph[]>();
  for (const block of page.blocks) {
    let prose: string[] = [];
    const flush = () => {
      if (prose.length) paragraphs.push([joinLines(prose)]);
      prose = [];
    };
    for (const line of block.lines) {
      const table = tableOf.get(line);
      if (table) {
        flush();
        if (!emitted.has(table)) {
          emitted.add(table);
          paragraphs.push(...table);
        }
        continue;
      }
      const cells = placed.get(line)!.cells;
      if (cells.length > 1) {
        // A lone wide-gapped line — a header's left and right halves, say — is
        // kept as one tabbed row rather than run into the prose around it.
        flush();
        paragraphs.push(cells.map((c) => c.text));
      } else {
        prose.push(cells[0]!.text);
      }
    }
    flush();
  }
  return paragraphs;
}

/** Every page of a parsed `-bbox-layout` document as paragraphs. */
export function flowText(layout: PdfFlowLayout): PdfFlowText {
  return {
    pageCount: layout.pageCount,
    pages: layout.pages.map((page) => ({
      pageNumber: page.pageNumber,
      paragraphs: flowParagraphs(page),
    })),
  };
}

/** A page's paragraphs as plain text, one per line — for counting, not output. */
export function flowPageText(page: PdfFlowTextPage): string {
  return page.paragraphs.map((p) => p.join("\t")).join("\n");
}
