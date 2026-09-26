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
 * or more spaces end one). Lines with two or more segments are table rows, and
 * a run of them (blank lines between allowed) is a BLOCK. A block's columns are
 * the character spans that some row's segment covers — the gutters between
 * them are blank on every row — so each segment lands in the column it sits
 * in, and a column a row leaves empty stays an empty cell in that row.
 *
 * Nothing here ever splits a segment's own text. When the rows disagree (one
 * long cell straddling two columns' positions), those columns become one and
 * the texts that share it are joined with a space — values may be COMBINED,
 * never MOVED under another header.
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
  last: number;
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

/**
 * The column a segment belongs to: the span it starts in, else the first span
 * to its right, else the last. Rows that defined the columns always hit the
 * first case; a one-segment line inside a table (a wrapped description) is
 * placed by where it starts.
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

  // Blocks: runs of multi-segment lines, blank lines allowed between them
  // (poppler prints one between widely spaced rows), any other line ends one.
  const blocks: number[][] = [];
  let open: number[] | null = null;
  for (let i = 0; i < segments.length; i++) {
    const count = segments[i]!.length;
    if (count >= 2) {
      if (!open) {
        open = [];
        blocks.push(open);
      }
      open.push(i);
    } else if (count === 1) open = null;
  }

  // Groups: a block joins the one above when their rows still share columns —
  // the union keeps at least as many columns as either had. That rejoins a
  // table cut by a one-line row (a wrapped cell), and keeps a prose line that
  // happens to hold a double space from collapsing a table's columns.
  const groups: Group[] = [];
  for (const block of blocks) {
    const columns = columnsOf(block.map((i) => segments[i]!));
    const prev = groups[groups.length - 1];
    if (prev) {
      const rows = [...prev.rows, ...block];
      const union = columnsOf(rows.map((i) => segments[i]!));
      if (union.length >= Math.max(prev.columns.length, columns.length)) {
        prev.rows = rows;
        prev.columns = union;
        prev.last = block[block.length - 1]!;
        continue;
      }
    }
    groups.push({
      first: block[0]!,
      last: block[block.length - 1]!,
      rows: block,
      columns,
    });
  }

  const grid: (string | null)[][] = [];
  let g = 0;
  segments.forEach((segs, i) => {
    if (segs.length === 0) return;
    while (groups[g] && groups[g]!.last < i) g++;
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
