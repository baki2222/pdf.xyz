/**
 * PDF to Excel's grid: `pdftotext -layout` lines placed into COLUMNS BY
 * POSITION, not split into cells by separators.
 *
 * What shipped split every line on `\t| {2,}|,` and dropped the empty pieces,
 * then numbered what was left 0, 1, 2… Measured on a real invoice through
 * poppler, that did two things to the numbers people convert PDFs to get:
 *
 *  - `1,250.00` became `1` and `250.00` in two columns, and `Widgets, blue`
 *    two cells — a comma is not a separator in `-layout` text, spacing is;
 *  - a row with an empty cell moved every later value one column LEFT, under
 *    the wrong header — `-layout` prints an empty cell as a wider run of
 *    spaces, and no separator rule can tell "one gap" from "a gap with an
 *    empty cell in it". Only the position can.
 *
 * So: a line's text runs are its SEGMENTS (words joined by single spaces; two
 * or more spaces end one). Lines with two or more segments may be table rows;
 * a run of them with no other line between is a BLOCK, and a block joins the
 * table above it (across blank lines or a one-run line) only when the union
 * of their rows keeps the larger one's columns apart. A table's columns are
 * the character spans that some row's segment covers — the gutters between
 * them are blank on every row — so each segment lands in the column it sits
 * in, and a column a row leaves empty stays an empty cell in that row.
 * A one-segment line between a table's rows, or directly below its last row
 * (an unlabeled total), is placed by where it starts, like any other cell —
 * and so is a refused LINE alone a blank line below a table with more
 * columns (a widely spaced row with a straddling cell, a page footer): its
 * runs land in the columns they start in, and change none of them.
 *
 * Nothing here ever splits a segment's own text. When the rows of one block
 * disagree (one long cell straddling two columns' positions), those columns
 * become one and the texts that share it are joined with a space.
 *
 * What is pinned, by layout-grid.test.ts ("values may be COMBINED, never
 * MOVED under another header"): in a table whose rows agree on the columns,
 * ANY subset of a row's cells, in any row including the last, lands under
 * its own header with the row's other cells empty. And ("a two-run line a
 * BLANK line away from the table never merges its columns"): a line of two
 * runs one blank line above the header or below the last row — prose with a
 * double space, an `Account … Period …` line, a page footer — leaves every
 * cell of the table where it was, even when its runs straddle the gutters.
 * And ("a row with one cell straddling the next column moves no value"):
 * with rows together or a blank line apart, every value stays under a
 * heading cell that holds its own heading. What is NOT promised:
 *  - a two-run line with NO blank line between it and the table is a row by
 *    every measure `-layout` gives, and if its runs straddle a gutter it
 *    merges those columns for the table (the test's positive control);
 *  - one overlong cell merges columns for its whole block, so a heading and
 *    the values under it can share a combined cell ("joins, never splits");
 *  - a second table a blank line below a first with more columns keeps its
 *    own columns only when two or more of its rows are together; a widely
 *    spaced one is placed row by row on the first table's columns;
 *  - a one-run line directly below a table that starts inside a column is
 *    taken as the table's (a centred footnote there lands under that column);
 *  - the caller trims each page, so a page's FIRST line loses its indent. A
 *    header row there that starts with an empty cell has its headings moved
 *    left (measured: "Date" lands in A, "Qty" and "Amount" share a cell), and
 *    where a shifted run straddles a gutter those columns merge for the table.
 */

interface Segment {
  start: number;
  end: number;
  text: string;
}
interface Span {
  start: number;
  end: number;
}
/** Consecutive lines of one page whose multi-segment rows share columns. */
interface Group {
  first: number;
  /** The last multi-segment line the group places. */
  last: number;
  /** The last line the group places: `last`, or a one-run line below it. */
  end: number;
  /** Line indexes of the rows that define the columns. */
  rows: number[];
  columns: Span[];
}

/** Text runs separated by two or more spaces (a tab counts as a gap). */
function segmentsOf(line: string): Segment[] {
  const segments: Segment[] = [];
  for (const m of line.replace(/\t/g, "  ").matchAll(/[^ ]+(?: [^ ]+)*/g))
    segments.push({
      start: m.index,
      end: m.index + m[0].length,
      text: m[0],
    });
  return segments;
}

/** The maximal character spans covered by any segment of the given lines. */
function columnsOf(lines: readonly Segment[][]): Span[] {
  const covered: boolean[] = [];
  for (const segments of lines)
    for (const s of segments)
      for (let i = s.start; i < s.end; i++) covered[i] = true;
  const spans: Span[] = [];
  for (let i = 0; i < covered.length; i++) {
    if (!covered[i]) continue;
    const start = i;
    while (covered[i + 1]) i++;
    spans.push({ start, end: i + 1 });
  }
  return spans;
}

/** Whether no span of `union` holds two of `columns` (each lies inside one). */
function keepsApart(union: readonly Span[], columns: readonly Span[]): boolean {
  const holder = columns.map((c) => union.findIndex((u) => u.end > c.start));
  return new Set(holder).size === holder.length;
}

/**
 * The column a segment belongs to: the span it starts in, else the first span
 * to its right, else the last. Rows that defined the columns always hit the
 * first case; a one-segment line inside a table (a wrapped description), and
 * a refused line placed on a table's columns, are placed by where they start.
 */
function columnFor(columns: readonly Span[], start: number): number {
  const i = columns.findIndex((span) => span.end > start);
  return i === -1 ? columns.length - 1 : i;
}

/**
 * One page's lines as sheet rows. Each non-blank line is one row; a cell is
 * `null` where that row has nothing in that column.
 */
export function layoutGrid(pageText: string): (string | null)[][] {
  const lines = pageText.split("\n");
  const segments = lines.map(segmentsOf);

  // Blocks: runs of CONSECUTIVE multi-segment lines. A blank line ends one
  // as surely as a one-run line does: poppler prints a blank line between
  // widely spaced rows, but also between a table and the page footer or the
  // two-run line above its header, and nothing in the text tells those apart.
  // At 4ebfb4a a blank line let the block run on, so a footer joined the
  // table unexamined and its runs bridged the gutters. Every block now joins
  // a table only through the test below.
  const blocks: number[][] = [];
  let open: number[] | null = null;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i]!.length >= 2) {
      if (!open) {
        open = [];
        blocks.push(open);
      }
      open.push(i);
    } else open = null;
  }

  // Groups: a block joins the group above when the union of their rows keeps
  // the columns of whichever has MORE of them (on a tie, of both) — no span of
  // the union holds two of them. That rejoins a table's widely spaced rows
  // and a table cut by a one-line row (a wrapped cell), whose cells sit in
  // the table's columns, and keeps out a line whose runs straddle a gutter.
  // Counting the union's columns is not the same test: a footer that merges
  // two columns and adds one past the right edge keeps the count.
  //
  // A refused LINE, alone and only blank lines below a table with more
  // columns, is placed on that table's columns by where each run starts —
  // as a one-run line is — and changes none of them. That is a widely spaced
  // row whose cell straddles a gutter, which laid out on its own columns
  // would number its cells in order and move every value after the long one
  // under the wrong heading; or a page footer, whose runs land in the
  // columns they start in, the table untouched.
  const groups: Group[] = [];
  const blankBetween = (from: number, to: number) =>
    segments.slice(from + 1, to).every((segs) => segs.length === 0);
  for (const block of blocks) {
    const columns = columnsOf(block.map((i) => segments[i]!));
    const prev = groups[groups.length - 1];
    if (prev) {
      const rows = [...prev.rows, ...block];
      const union = columnsOf(rows.map((i) => segments[i]!));
      const larger = prev.columns.length - columns.length;
      if (
        (larger < 0 || keepsApart(union, prev.columns)) &&
        (larger > 0 || keepsApart(union, columns))
      ) {
        prev.rows = rows;
        prev.columns = union;
        prev.last = prev.end = block[block.length - 1]!;
        continue;
      }
      if (
        block.length === 1 &&
        larger > 0 &&
        blankBetween(prev.last, block[0]!)
      ) {
        prev.last = prev.end = block[0]!;
        continue;
      }
    }
    groups.push({
      first: block[0]!,
      last: block[block.length - 1]!,
      end: block[block.length - 1]!,
      rows: block,
      columns,
    });
  }

  // A table's tail: the one-run lines directly below its last row (blank
  // lines allowed, as between rows) are placed by position too, exactly as
  // the same line is BETWEEN two rows. That is an unlabeled total, a balance
  // brought forward, an amount-only continuation, which `-layout` prints as
  // spaces then one value; left out, it went to column A under the first
  // header. The tail stops at a line that starts in the first column (a
  // title or paragraph after the table, which lands in A either way) or
  // past the table's right edge (under no column), and at the next table.
  groups.forEach((group, k) => {
    const stop = groups[k + 1]?.first ?? segments.length;
    const left = group.columns[0]!.end;
    const right = group.columns[group.columns.length - 1]!.end;
    for (let i = group.last + 1; i < stop; i++) {
      const segs = segments[i]!;
      if (segs.length === 0) continue;
      const start = segs[0]!.start;
      if (segs.length !== 1 || start < left || start >= right) break;
      group.end = i;
    }
  });

  const grid: (string | null)[][] = [];
  let g = 0;
  segments.forEach((segs, i) => {
    if (segs.length === 0) return;
    while (groups[g] && groups[g]!.end < i) g++;
    const group = groups[g];
    if (!group || i < group.first) {
      // Outside every table: a title, an address, a paragraph line.
      grid.push([segs.map((s) => s.text).join(" ")]);
      return;
    }
    const row: (string | null)[] = Array.from(
      { length: group.columns.length },
      () => null,
    );
    for (const s of segs) {
      const c = columnFor(group.columns, s.start);
      row[c] = row[c] === null ? s.text : `${row[c]} ${s.text}`;
    }
    while (row.length > 0 && row[row.length - 1] === null) row.pop();
    grid.push(row);
  });
  return grid;
}
