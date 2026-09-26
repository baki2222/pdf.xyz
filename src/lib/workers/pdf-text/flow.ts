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
 *  2. **A table row is a band of the page (lines sharing a baseline) holding
 *     two or more cells, most of them short.** Two columns of PROSE also share
 *     baselines, so alignment alone cannot tell them apart; length can — a
 *     prose line carries a sentence, a cell carries a value.
 *     {@link LONG_CELL_WORDS} and {@link MAX_LONG_CELL_SHARE} draw that line.
 *  3. **A table is two or more consecutive table rows.** One aligned pair of
 *     short lines is as likely to be two column headings as a table.
 *  4. **Everything else is read in poppler's order**, one paragraph per block,
 *     lines joined with a space. A line that ends in a hyphen is joined to a
 *     lowercase continuation WITHOUT a space and WITH its hyphen: removing it
 *     would turn "well-known" into "wellknown", and deleting characters the
 *     document contains is a worse failure than keeping one it did not need.
 *     A soft hyphen (U+00AD) is only ever a line-break artefact, so it goes.
 *
 * A paragraph is a list of cells: one cell is a prose paragraph, two or more is
 * a table row, which the DOCX writer separates with tabs.
 */
import type { FlowLine, FlowPage, PdfFlowLayout } from "./parse";

/** Gap between words, in line heights, beyond which a line splits into cells. */
export const CELL_GAP_EMS = 2;
/** A cell with at least this many words reads as prose, not a table value. */
export const LONG_CELL_WORDS = 4;
/** A band stops being a table row once this share of its cells are prose-long. */
export const MAX_LONG_CELL_SHARE = 0.5;
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
}

interface PlacedLine {
  line: FlowLine;
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
      cells.push({
        text: joinWords(run),
        words: run.length,
        xMin: run[0]!.xMin,
      });
      run = [];
    }
    run.push(word);
  }
  if (run.length)
    cells.push({ text: joinWords(run), words: run.length, xMin: run[0]!.xMin });
  return cells;
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

function isTableBand(band: PlacedLine[]): boolean {
  const cells = band.flatMap((l) => l.cells);
  if (cells.length < 2) return false;
  const long = cells.filter((c) => c.words >= LONG_CELL_WORDS).length;
  return long / cells.length < MAX_LONG_CELL_SHARE;
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
    for (const line of block.lines)
      placed.set(line, {
        line,
        cells: lineCells(line),
        yCenter: (line.yMin + line.yMax) / 2,
        height: Math.max(1, line.yMax - line.yMin),
      });

  // Tables: maximal runs of consecutive table bands, MIN_TABLE_ROWS or more.
  const tableOf = new Map<FlowLine, FlowParagraph[]>();
  let run: PlacedLine[][] = [];
  const closeRun = () => {
    if (run.length >= MIN_TABLE_ROWS) {
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
    if (isTableBand(band)) run.push(band);
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
