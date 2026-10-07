import { outputName } from "./files";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";
import { awaitPdfjsDocument, loadPdfjs } from "./pdfjs";

/** One extracted page of selectable PDF text. Page numbers are 1-based. */
export interface ExtractedTextPage {
  pageNumber: number;
  text: string;
  characterCount: number;
}

/** Browser-side selectable-text extraction result. This is not OCR. */
export interface ExtractedPdfText {
  pageCount: number;
  pages: ExtractedTextPage[];
  text: string;
  characterCount: number;
  hasText: boolean;
}

export interface TextItemLike {
  str?: unknown;
  hasEOL?: unknown;
  /**
   * pdfjs `[a, b, c, d, e, f]`: scale/skew, then the baseline origin — e = x,
   * f = baseline y (PDF points, y up).
   */
  transform?: unknown;
  width?: unknown;
  height?: unknown;
  dir?: unknown;
  fontName?: unknown;
}

/**
 * One visual line of a page, with the geometry of the text that starts it.
 *
 * `x`/`y` come from the line's first item that carries VISIBLE text, and `size`
 * is the largest glyph height among those items. Both skip the zero-size
 * `{str:"", hasEOL:true}` items pdfjs's `appendEOL` pushes: those carry the
 * transform of the NEXT line (measured on pdfjs 6.1.200: the EOL after a title
 * at y=740 reports y=704, the heading below it), so reading geometry from them
 * would place every line one line too low. A line with no visible text has
 * `null` geometry rather than a guessed one.
 */
export interface TextLine {
  text: string;
  x: number | null;
  y: number | null;
  size: number | null;
  fontName: string | null;
}

/** An extracted page that also keeps its visual lines (see `extractPdfLines`). */
export interface ExtractedLinePage extends ExtractedTextPage {
  lines: TextLine[];
}

export interface ExtractedPdfLines extends ExtractedPdfText {
  pages: ExtractedLinePage[];
}

/**
 * Convert pdfjs text items into readable page text. pdfjs already provides real
 * space glyphs for most PDFs; this helper preserves them, honors explicit EOLs,
 * and avoids inventing text that is not present in the document.
 *
 * Lines come out in READING order — see {@link readingOrder}. Items without
 * geometry (as in unit tests) keep the order they were given in.
 */
export function textItemsToPlainText(items: TextItemLike[]): string {
  return plainTextOf(readingRuns(items));
}

/** The text of `runs`, each ending its own line, normalized. */
function plainTextOf(runs: TextItemLike[][]): string {
  return normalizeExtractedText(
    runs
      .map((run) => {
        let text = "";
        for (const item of run) {
          if (typeof item.str !== "string") continue;
          text += item.str;
          if (item.hasEOL === true) text += "\n";
        }
        return text.endsWith("\n") ? text : `${text}\n`;
      })
      .join(""),
  );
}

/**
 * A page's items as the runs to emit, in READING order: one run per line, in
 * the order {@link readingOrder} puts them — or the whole page as ONE run, in
 * stream order, wherever that is kept (no geometry, rotated text, too many
 * blocks, or a page already in order).
 *
 * The single place a page's order is decided. `textItemsToPlainText` and
 * `textItemsToLines` both emit from it, so PDF to Text's text and PDF to
 * Markdown's lines cannot disagree about it — they did, when the reordering
 * lived inside the text path alone and the lines kept stream order.
 */
function readingRuns(items: TextItemLike[]): TextItemLike[][] {
  const lines = itemLines(items);
  const order = lines ? readingOrder(lines) : null;
  if (!lines || !order) return [items];
  return order.flat().map((i) => items.slice(lines[i]!.start, lines[i]!.end));
}

/** A line's extent in PDF user space (y grows upward). */
interface Box {
  left: number;
  right: number;
  bottom: number;
  top: number;
  /** Font size of its largest item — the unit every tolerance is measured in. */
  size: number;
}

interface ItemLine {
  /** The line's items: `items.slice(start, end)`, EOL item included. */
  start: number;
  end: number;
  /** `null` for a line with no visible text (blank, or only whitespace). */
  box: Box | null;
}

/**
 * The box of one item, or `undefined` when its geometry cannot be trusted for
 * ordering: rotated or skewed (b, c ≠ 0), mirrored, vertical writing, or no
 * transform at all. Returns `null` for an item that draws nothing visible.
 */
function itemBox(item: TextItemLike): Box | null | undefined {
  if (typeof item.str !== "string" || item.str.trim() === "") return null;
  const t = item.transform;
  if (!Array.isArray(t) || t.length < 6) return undefined;
  const [a, b, c, d, e, f] = t as unknown[];
  if (
    ![a, b, c, d, e, f].every((n) => typeof n === "number" && isFinite(n)) ||
    b !== 0 ||
    c !== 0 ||
    (a as number) <= 0 ||
    (d as number) <= 0 ||
    item.dir === "ttb"
  ) {
    return undefined;
  }
  const size = d as number;
  const width =
    typeof item.width === "number" && isFinite(item.width) ? item.width : 0;
  return {
    left: e as number,
    right: (e as number) + Math.max(width, 0),
    bottom: f as number,
    top: (f as number) + size,
    size,
  };
}

/**
 * Split items into lines at pdfjs's own EOLs, keeping each line's items as
 * stream order emits them. `null` when any visible item's geometry is
 * untrusted — the whole page then keeps stream order.
 */
function itemLines(items: TextItemLike[]): ItemLine[] | null {
  const lines: ItemLine[] = [];
  let start = 0;
  let text = "";
  let box: Box | null = null;
  for (let at = 0; at < items.length; at++) {
    const item = items[at]!;
    if (typeof item.str !== "string") continue;
    const own = itemBox(item);
    if (own === undefined) return null;
    if (own) {
      box = box
        ? {
            left: Math.min(box.left, own.left),
            right: Math.max(box.right, own.right),
            bottom: Math.min(box.bottom, own.bottom),
            top: Math.max(box.top, own.top),
            size: Math.max(box.size, own.size),
          }
        : own;
    }
    text += item.str;
    if (item.hasEOL === true) {
      lines.push({ start, end: at + 1, box });
      start = at + 1;
      text = "";
      box = null;
    }
  }
  if (text !== "") lines.push({ start, end: items.length, box });
  return lines;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Glyph size of one item: its height, or the transform's vertical scale when
 * pdfjs reports a height of 0 (it does for some fonts, and for spaces). */
function itemSize(item: TextItemLike): number | null {
  const height = finiteNumber(item.height);
  if (height !== null && height > 0) return height;
  if (Array.isArray(item.transform) && item.transform.length >= 4) {
    const c = finiteNumber(item.transform[2]);
    const d = finiteNumber(item.transform[3]);
    if (c !== null && d !== null) {
      const scale = Math.hypot(c, d);
      if (scale > 0) return scale;
    }
  }
  return null;
}

/**
 * Split pdfjs text items into visual lines, keeping each line's geometry, in
 * the same READING order as `textItemsToPlainText` — both emit from
 * {@link readingRuns}.
 *
 * The line boundaries are EXACTLY `textItemsToPlainText`'s — an item's
 * `hasEOL`, or a newline inside its string — so the lines' text, joined with
 * `\n` and normalized, is that function's output byte for byte. text.test.ts
 * pins the equality, on a page whose order changes as well as on ones that
 * keep stream order; text-reading-order.test.ts pins it on real PDFs through
 * `extractPdfLines` and the Markdown converter. Only the geometry is new.
 */
export function textItemsToLines(items: TextItemLike[]): TextLine[] {
  return readingRuns(items).flatMap(runLines);
}

/** {@link textItemsToLines} for one run, in the run's own order. */
function runLines(items: TextItemLike[]): TextLine[] {
  const lines: TextLine[] = [];
  let current: TextLine = emptyLine();

  function emptyLine(): TextLine {
    return { text: "", x: null, y: null, size: null, fontName: null };
  }
  const push = () => {
    lines.push(current);
    current = emptyLine();
  };

  for (const item of items) {
    if (typeof item.str !== "string") continue;
    const segments = item.str.split(/\r\n?|\n/);
    segments.forEach((segment, index) => {
      if (index > 0) push();
      current.text += segment;
      if (segment.trim().length === 0) return;
      const transform = Array.isArray(item.transform) ? item.transform : [];
      if (current.y === null) {
        current.x = finiteNumber(transform[4]);
        current.y = finiteNumber(transform[5]);
        current.fontName =
          typeof item.fontName === "string" ? item.fontName : null;
      }
      const size = itemSize(item);
      if (size !== null && (current.size === null || size > current.size)) {
        current.size = size;
      }
    });
    if (item.hasEOL === true) push();
  }
  if (current.text.length > 0) push();
  return lines;
}

const overlapsX = (a: Box, b: Box) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0;

const overlapsY = (a: Box, b: Box) =>
  Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom) > 0;

/**
 * Above this many blocks a page keeps stream order. Ordering is quadratic in
 * a page's blocks, and a page where every label is its own block (a map, a
 * CAD drawing, a table drawn cell by cell) must not stall the tab it runs in.
 * `text-reading-order.test.ts` pins the boundary from both sides.
 */
export const MAX_ORDERED_BLOCKS = 1000;

interface Block {
  lines: number[];
  box: Box;
}

/**
 * The order to emit a page's lines in, as blocks of line indices — or `null`
 * when stream order already is the reading order (the common case, which then
 * stays byte-identical).
 *
 * pdfjs gives items in CONTENT-STREAM order, and generators draw out of visual
 * order constantly: a title after the body it heads, a running header last, a
 * footer or page number first. A global sort by y then x is NOT the fix — a
 * two-column page is drawn a column at a time, stream order is right for it,
 * and a y-sort interleaves the columns line by line. So:
 *
 *  1. Consecutive lines form a BLOCK while each sits just below the last
 *     (no upward step, no gap over two line heights), is set in much the
 *     same size (within a quarter) and overlaps it horizontally — a
 *     paragraph, a column run. The size rule keeps a running header off the
 *     title set just under it: joined, the header's other half on that
 *     baseline had no line of its own to sit beside, and read after the
 *     title. It also makes a section heading its own block, and so offers
 *     step 2 a cut inside a column; step 2 must refuse that cut (below).
 *  2. BANDS ({@link bandOrder}): where a horizontal cut crosses no block,
 *     everything above it reads before everything below — when the stream
 *     says the cut is real. It does when the blocks above are one unbroken
 *     run at an END of the stream, first or last. That is how a footer drawn
 *     first sinks under BOTH columns, and a header drawn last rises over
 *     both, as one move — rather than the columns being lifted past it one at
 *     a time, which is how the first version of this put the right column
 *     above the left. Two more shapes are trusted, both page FURNITURE in
 *     pieces on one baseline, and only when the pieces ARE one row of single
 *     lines (`isOneRow`): a running head with one piece drawn before the body
 *     and one after (the upper side SPLIT between the stream's two ends), and
 *     a footer the same way (the body a run in the MIDDLE, the pieces below
 *     it), which otherwise read `H_L | L | H_R | R` and put
 *     `Company Confidential` between the columns.
 *     Not trusted: a cut the stream crosses back and forth (two columns, each
 *     in two sections); a middle run over anything but one row — that is the
 *     right column's top section when the left column starts lower (a figure
 *     over it) and the right one has a gap below that section, and lifting it
 *     read `R1 | L | R2`; and a split over anything but one row.
 *     CHANGED 2026-10-08 (history kept): f4f53fd6 trusted ANY split and any
 *     middle run over single lines, and scrambled pages already in order —
 *     the last page of a two-column paper (left column's top first, right
 *     column last, the left column's lower part under a heading or a
 *     paragraph gap in the middle) read `Left A | Right | Left B`; a form or
 *     résumé of one-line blocks in two columns, the right a line higher,
 *     read `R1 | L1 | R2 …`. The base it replaced read all of them in stream
 *     order; `text-reading-order.test.ts` (NO_CUT_THERE) pins each.
 *     CHANGED 2026-10-08 again, second review (history kept): one row of
 *     single lines is a column heading row and a caption beside a column's
 *     last line too, and 9681f501 still lifted both: two 14 pt column
 *     headings, the right drawn after its body, read `Left Heading |
 *     Right Heading | LB | RB`; a left column of one caption on the baseline
 *     of the right column's footnote (or its last line, after a gap) read
 *     `R | caption | footnote`. So the split is refused when a piece drawn
 *     last heads a COLUMN (`headsAColumn`: it sits within a paragraph gap
 *     over a block another block runs beside), and the middle run is lifted
 *     only over pieces drawn before it that lie within its width — the ones
 *     step 3 would otherwise jump. The base read both right; OUT_OF_ORDER and
 *     NO_CUT_THERE pin them.
 *  3. Within a band ({@link columnOrder}), blocks keep stream order, except
 *     that a block moves in front of the first earlier block it overlaps
 *     horizontally AND lies wholly above — a title or heading drawn after
 *     what it heads. A block that runs BESIDE one already placed is a later
 *     column, and never moves in front of it, nor in front of a block that
 *     spans that column (a full-width footnote joined to the left column's
 *     foot).
 *
 * One shape stays ambiguous: a right column that ENDS above where the left
 * one starts, with none of it beside the left, is — to stream order and
 * geometry alike — a header drawn last over the right column, and reads first.
 *
 * Rotated, mirrored or vertical text anywhere on the page, items without
 * geometry, or more than {@link MAX_ORDERED_BLOCKS} blocks keep the whole page
 * in stream order: no judgement is better than a wrong one.
 *
 * `text-reading-order.test.ts` pins both directions on real PDFs: every body
 * composed with every piece of header and footer furniture, and with every
 * pair of pieces on one baseline, one drawn first and one last.
 */
function readingOrder(lines: ItemLine[]): number[][] | null {
  const blocks: Block[] = [];
  let current: Block | null = null;
  let last: Box | null = null;
  for (let i = 0; i < lines.length; i++) {
    const box = lines[i]!.box;
    if (!box) {
      // A blank line belongs to whatever it follows.
      if (current) current.lines.push(i);
      else blocks.push((current = { lines: [i], box: emptyBox() }));
      continue;
    }
    const unit = Math.max(box.size, last?.size ?? 0);
    const continues =
      current !== null &&
      last !== null &&
      box.bottom <= last.bottom + unit * 0.5 &&
      withinParagraphGap(last, box) &&
      Math.max(box.size, last.size) <= Math.min(box.size, last.size) * 1.25 &&
      overlapsX(box, current.box);
    if (continues && current) {
      current.lines.push(i);
      current.box = union(current.box, box);
    } else {
      blocks.push((current = { lines: [i], box }));
    }
    last = box;
  }
  if (blocks.length > MAX_ORDERED_BLOCKS) return null;

  // Only leading blank lines can form a box-less block; they stay in front.
  const ordered = [
    ...blocks.filter((block) => isEmptyBox(block.box)),
    ...bandOrder(blocks.filter((block) => !isEmptyBox(block.box))),
  ];
  const moved = ordered.some((block, i) => block !== blocks[i]);
  return moved ? ordered.map((block) => block.lines) : null;
}

/**
 * Whether `lower` starts no more than two line heights under `upper` — the
 * gap a block's next line may follow at. Over it is a new paragraph.
 */
const withinParagraphGap = (upper: Box, lower: Box) =>
  upper.bottom - lower.top <= Math.max(upper.size, lower.size) * 2;

/** Whether `upper` lies wholly above `lower`, within a quarter line. */
const liesAbove = (upper: Box, lower: Box) =>
  upper.bottom >= lower.top - lower.size * 0.25;

/**
 * Where stream positions `at` (distinct, of `count` blocks) were drawn:
 * `"start"` or `"end"` for one unbroken run at that end of the stream,
 * `"split"` for some first and the rest last (none in between), `"middle"`
 * for one unbroken run touching neither end, `null` for anything else.
 */
function drawnWhere(
  at: number[],
  count: number,
): "start" | "end" | "split" | "middle" | null {
  const sorted = [...at].sort((a, b) => a - b);
  const first = sorted[0]!;
  const final = sorted.at(-1)!;
  if (final - first + 1 === sorted.length) {
    if (first === 0) return "start";
    if (final === count - 1) return "end";
    return "middle";
  }
  let head = 0;
  while (head < sorted.length && sorted[head] === head) head++;
  const split =
    head > 0 &&
    sorted
      .slice(head)
      .every((position, i) => position === count - (sorted.length - head) + i);
  return split ? "split" : null;
}

/** A block no taller than one line of its largest text. */
const isOneLine = (box: Box) => box.top - box.bottom <= box.size * 1.5;

/**
 * Whether `boxes` are one-line blocks on ONE row — some horizontal line
 * crosses every one of them — as the pieces of a running head or a footer
 * are. Two columns of single lines are many rows, not one.
 */
const isOneRow = (boxes: Box[]) =>
  boxes.length > 0 &&
  boxes.every(isOneLine) &&
  Math.max(...boxes.map((box) => box.bottom)) <
    Math.min(...boxes.map((box) => box.top));

/**
 * Whether `piece` heads a COLUMN among `blocks`: it sits over one of them,
 * which starts no further under it than a paragraph's next line may, and some
 * other block runs beside that one (overlapping it vertically, not
 * horizontally). Added 2026-10-08 for a column heading drawn after its body,
 * which is one row with its neighbour's heading — as a running head in pieces
 * is — but belongs to its own column.
 */
const headsAColumn = (piece: Block, blocks: Block[]) =>
  blocks.some(
    (headed) =>
      overlapsX(piece.box, headed.box) &&
      // "sits over": checked here, not left to the caller. withinParagraphGap
      // alone is vacuously true when `headed` is the HIGHER box; today's one
      // caller only passes the lower side of a cut, so this changes nothing
      // there, but the predicate now means what its docblock says.
      liesAbove(piece.box, headed.box) &&
      withinParagraphGap(piece.box, headed.box) &&
      blocks.some(
        (beside) =>
          beside !== headed &&
          overlapsY(beside.box, headed.box) &&
          !overlapsX(beside.box, headed.box),
      ),
  );

/**
 * Split `blocks` (in stream order) at the highest horizontal cut that no block
 * crosses and that the stream vouches for — the upper side drawn as one
 * unbroken run at the start or the end of the stream; or, for page furniture
 * in pieces on one baseline, a split upper side that IS one row of single
 * lines none of whose last-drawn pieces heads a column (a running head), or a
 * middle run over a lower side that is one row, every piece drawn before the
 * run lying within its width (a footer) — then order each side the same way;
 * with no such cut, fall back to {@link columnOrder}. See
 * {@link readingOrder}, step 2.
 */
function bandOrder(blocks: Block[]): Block[] {
  if (blocks.length < 2) return blocks;
  const byTop = blocks
    .map((block, at) => ({ block, at }))
    .sort((a, b) => b.block.box.top - a.block.box.top || a.at - b.at);
  let floor: Box | null = null;
  for (let k = 1; k < byTop.length; k++) {
    const { block } = byTop[k - 1]!;
    if (!floor || block.box.bottom < floor.bottom) floor = block.box;
    // Blocks after k have tops no higher than this one's, so clearing it
    // clears them all.
    if (!liesAbove(floor, byTop[k]!.block.box)) continue;
    const upper = byTop.slice(0, k);
    const above = new Set(upper.map((entry) => entry.block));
    const where = drawnWhere(
      upper.map((entry) => entry.at),
      blocks.length,
    );
    // One unbroken run at an END: the order already reads right (start), or
    // a header drawn last / a body drawn after its footer (end).
    const atAnEnd = where === "start" || where === "end";
    // A SPLIT upper side is trusted only when it is one row of single lines —
    // a running head in pieces, one drawn first and one last. Anything else
    // drawn at both ends over a middle run is a body: the last page of a
    // two-column paper puts the left column's upper part first and the right
    // column last, over the left column's lower part (a section heading, a
    // paragraph gap), and lifting them spliced the right column into the left.
    //
    // CHANGED 2026-10-08, second review (history kept): one row was not
    // enough. Two column headings, the right one drawn after its body, are
    // one row too, and the lift put the right heading over the LEFT column's
    // body. So no piece the lift MOVES — one drawn last — may head a column:
    // sit within a paragraph gap over a block that another block runs beside.
    // That piece is the column's heading, and columnOrder lifts it over its
    // own column alone. A running head sits in the margin, clear of the
    // columns; one just over a block with nothing beside it (a title, or a
    // header drawn last under it) still moves.
    const lower = blocks.filter((b) => !above.has(b));
    const firstBelow = blocks.findIndex((b) => !above.has(b));
    const headInPieces =
      where === "split" &&
      isOneRow(upper.map((entry) => entry.block.box)) &&
      !upper.some(
        (entry) => entry.at > firstBelow && headsAColumn(entry.block, lower),
      );
    // A run in the MIDDLE is a later column's top section when an earlier
    // column beside it starts lower, and lifting it puts the later column in
    // front of the earlier one — so it is trusted only over a lower side that
    // is ONE row of single lines: a footer in pieces, drawn first and last.
    // Two columns of single lines (a form, a résumé) are many rows.
    //
    // CHANGED 2026-10-08, second review (history kept): and only when every
    // piece the lift moves the run in front of — each one drawn BEFORE it —
    // lies under the run's width. That is the piece columnOrder would
    // otherwise jump one column at a time, putting `Company Confidential`
    // between the columns. A piece OUTSIDE the run's width is an earlier
    // column's (a figure's caption alone in the left column, on the right
    // column's last baseline) and reads before it, where stream order put it;
    // lifting the run read `R | caption | footnote`.
    const runStart = Math.min(...upper.map((entry) => entry.at));
    const runWidth = upper.reduce<Box>(
      (box, entry) => union(box, entry.block.box),
      emptyBox(),
    );
    const footInPieces =
      where === "middle" &&
      isOneRow(lower.map((b) => b.box)) &&
      blocks
        .slice(0, runStart)
        .every((piece) => overlapsX(piece.box, runWidth));
    if (atAnEnd || headInPieces || footInPieces) {
      return [
        ...bandOrder(blocks.filter((b) => above.has(b))),
        ...bandOrder(blocks.filter((b) => !above.has(b))),
      ];
    }
  }
  return columnOrder(blocks);
}

/** Stream order, with a block drawn late lifted over what it heads. */
function columnOrder(blocks: Block[]): Block[] {
  const ordered: Block[] = [];
  for (const block of blocks) {
    let at = ordered.findIndex(
      (earlier) =>
        overlapsX(block.box, earlier.box) && liesAbove(block.box, earlier.box),
    );
    if (at >= 0) {
      const target = ordered[at]!.box;
      // A block that runs BESIDE one already placed is a later column. It
      // must not land in front of that column, nor in front of a block that
      // spans it (a full-width footnote joined to the left column's foot).
      const refused = ordered.some(
        (placed, i) =>
          !overlapsX(placed.box, block.box) &&
          overlapsY(placed.box, block.box) &&
          (i >= at || overlapsX(placed.box, target)),
      );
      if (refused) at = -1;
    }
    if (at < 0) ordered.push(block);
    else ordered.splice(at, 0, block);
  }
  return ordered;
}

function union(a: Box, b: Box): Box {
  if (isEmptyBox(a)) return b;
  return {
    left: Math.min(a.left, b.left),
    right: Math.max(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
    top: Math.max(a.top, b.top),
    size: Math.max(a.size, b.size),
  };
}

const emptyBox = (): Box => ({
  left: Infinity,
  right: -Infinity,
  bottom: Infinity,
  top: -Infinity,
  size: 0,
});

const isEmptyBox = (box: Box) => box.left > box.right;

/** Normalize line endings and whitespace without changing the words themselves. */
export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Collapse `pdftotext -layout`'s inter-column padding to a single space, keeping
 * every line break.
 *
 * `-layout` reconstructs a page's horizontal arrangement by padding between
 * columns, which carries TWO things: that cells are separated (load-bearing) and
 * how wide the gap is (not). This keeps the first and discards the second.
 *
 * WHY THE FLAG STAYS ON AND THE PADDING IS REMOVED AFTERWARDS, rather than the
 * simpler-looking "just drop `-layout`": **`-layout` is the only mode that
 * reconstructs the page's VISUAL READING ORDER.** The other two each give that
 * up, in different ways, and both failures are silent.
 *
 * Measured on the production worker, `pdftotext` **22.12.0** (poppler), a
 * four-column table:
 *
 * ```
 *   -layout   142 chars   Region   Q1     Q2     Q3   /  North    1200   1350
 *   default   115 chars   Region|Q1|Q2|Q3|North|1200|1350|1410|South|…
 *   -raw       95 chars   Region Q1 Q2 Q3  /  North 1200 1350 1410
 * ```
 *
 * **default** is row-major but flattened — one cell per line, no row boundaries.
 * A model can only recover the table by assuming a fixed width and counting,
 * which works on a perfect rectangle and breaks on a merged or missing cell.
 *
 * **`-raw`** means "strings in content-stream order", which is not visual order:
 * a page whose generator emitted blocks 4, 2, 1, 3 comes out 4, 2, 1, 3.
 * Generators do this constantly — LaTeX, Word exports, anything with footnotes
 * or flowed columns. A summary or translation built on that is fluent, complete
 * and **in the wrong order**, with nothing to warn. Same family as running OCR
 * in the wrong language.
 *
 * ⚠️ AN EARLIER VERSION OF THIS NOTE SAID `default` TRANSPOSES THE TABLE. That
 * was measured on Xpdf `pdftotext` 4.00, which groups by column; poppler 22.12.0
 * flattens instead. **The claim was binary-specific and does not reproduce on the
 * binary we ship** — recorded so the next person testing elsewhere is not
 * confused by it. The conclusion did not change, but the reason it rested on was
 * wrong, and a reason that does not reproduce is worse than no reason.
 *
 * On ordinary prose this collapse is a no-op — single-column text has no runs of
 * two or more spaces, which is why the extractor divergence was 1.0001 there.
 */
export function collapseLayoutPadding(text: string): string {
  return text.replace(/[ \t]{2,}/g, " ");
}

/** The separator `joinPageTexts` puts between pages. Exported so a caller can
 * compute offsets into the joined string without guessing it. */
export const PAGE_JOIN = "\n\n";

/**
 * The normalized, non-empty page blocks that `joinPageTexts` joins — WITH their
 * real page numbers.
 *
 * Exported because normalization changes lengths and empty pages are dropped,
 * so anything reasoning about offsets or page numbers in the joined string must
 * use these exact chunks. Deriving them separately is how a truncation notice
 * ends up naming a page that is off by however many blank pages preceded it.
 */
export function pageTextChunks(
  pages: Pick<ExtractedTextPage, "text" | "pageNumber">[],
): { pageNumber: number; text: string }[] {
  return pages
    .map((page) => ({
      pageNumber: page.pageNumber,
      text: normalizeExtractedText(page.text),
    }))
    .filter((chunk) => chunk.text.length > 0);
}

/**
 * The page numbers `joinPageTexts` DROPS — pages whose text normalizes to
 * nothing (a scanned sheet with no text layer, a blank separator).
 *
 * The join leaves no marker where they were: survivors are joined with the
 * same blank line as a paragraph break, which the worker parse path and the
 * AI page-offset math rely on. So a caller that reports "from N pages" must
 * name these, or a partly scanned document reads as complete. Derived as the
 * complement of {@link pageTextChunks}, so "empty" means exactly what the join
 * means by it — `text.test.ts` pins the two as a partition.
 */
export function pagesWithoutText(
  pages: Pick<ExtractedTextPage, "text" | "pageNumber">[],
): number[] {
  const kept = new Set(pageTextChunks(pages).map((chunk) => chunk.pageNumber));
  return pages
    .map((page) => page.pageNumber)
    .filter((pageNumber) => !kept.has(pageNumber));
}

/** Join page blocks with a single blank line between non-empty pages. */
export function joinPageTexts(
  pages: Pick<ExtractedTextPage, "text" | "pageNumber">[],
): string {
  return pageTextChunks(pages)
    .map((chunk) => chunk.text)
    .join(PAGE_JOIN);
}

export function textOutputName(sourceName: string): string {
  return outputName(sourceName, "text", "txt");
}

/**
 * Which pdfjs build reads the bytes. The browser build is the only one a user
 * runs; a jsdom test passes pdfjs's legacy build, which is the same parser with
 * the DOM polyfills Node lacks, so the rest of the extraction — the part that
 * decides `hasText` — is the code that ships.
 */
export type PdfTextReader = () => Promise<
  Pick<typeof import("pdfjs-dist"), "getDocument">
>;

/**
 * Open a PDF with pdfjs and hand each page's text items to `perPage`. The one
 * `getDocument` call both extractors share, so they cannot drift in options.
 */
async function readPageTextItems<T>(
  bytes: Uint8Array,
  perPage: (items: TextItemLike[], pageNumber: number) => T,
  loadReader: PdfTextReader = loadPdfjs,
): Promise<{ pageCount: number; pages: T[] }> {
  const pdfjs = await loadReader();
  const data = bytes.slice();
  const loadingTask = pdfjs.getDocument({ data, ...PDFJS_DOCUMENT_DEFAULTS });
  const doc = await awaitPdfjsDocument(loadingTask);

  try {
    const pages: T[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      try {
        const content = await page.getTextContent({
          includeMarkedContent: false,
        });
        pages.push(perPage(content.items as TextItemLike[], pageNumber));
      } finally {
        page.cleanup();
      }
    }
    return { pageCount: doc.numPages, pages };
  } finally {
    try {
      doc.cleanup();
    } catch {
      // best effort
    }
    await loadingTask.destroy().catch(() => {});
  }
}

function textPage(
  items: TextItemLike[],
  pageNumber: number,
): ExtractedTextPage {
  const text = textItemsToPlainText(items);
  return { pageNumber, text, characterCount: text.length };
}

/**
 * One page as `extractPdfLines` builds it, from that page's pdfjs items.
 * Exported so a test can drive the exact per-page composition over items from
 * a real pdfjs run (the browser build cannot load in Node).
 */
export function linePageFromItems(
  items: TextItemLike[],
  pageNumber: number,
): ExtractedLinePage {
  // One order for both: the text and the lines come from the same runs.
  const runs = readingRuns(items);
  const text = plainTextOf(runs);
  return {
    pageNumber,
    text,
    characterCount: text.length,
    lines: runs.flatMap(runLines),
  };
}

/** Assemble per-page results into the document result both extractors return. */
export function assembleExtraction<P extends ExtractedTextPage>(
  pageCount: number,
  pages: P[],
): Omit<ExtractedPdfText, "pages"> & { pages: P[] } {
  const text = joinPageTexts(pages);
  return {
    pageCount,
    pages,
    text,
    characterCount: text.length,
    hasText: text.trim().length > 0,
  };
}

/**
 * Extract selectable text from a PDF in the browser. It deliberately does not
 * perform OCR; scanned/image-only documents return `hasText:false` so the UI can
 * honestly point users to OCR PDF.
 */
export async function extractPdfText(
  bytes: Uint8Array,
  /** See {@link PdfTextReader}; tests pass pdfjs's legacy build. */
  loadReader: PdfTextReader = loadPdfjs,
): Promise<ExtractedPdfText> {
  const { pageCount, pages } = await readPageTextItems(
    bytes,
    textPage,
    loadReader,
  );
  return assembleExtraction(pageCount, pages);
}

/**
 * `extractPdfText`, plus each page's visual lines with their geometry.
 *
 * A separate function rather than a new field on `extractPdfText`, because
 * pdf-to-text, compare-pdf and translate (whose `pageTextChunks` offsets and
 * page numbers depend on the text) must not change. Every text field here is
 * computed by the same code from the same items, so `hasText`, `pageCount` and
 * `characterCount` — the scanned-PDF path — are identical.
 */
export async function extractPdfLines(
  bytes: Uint8Array,
): Promise<ExtractedPdfLines> {
  const { pageCount, pages } = await readPageTextItems(
    bytes,
    linePageFromItems,
  );
  return assembleExtraction(pageCount, pages);
}

/**
 * Whether a PDF has ANY selectable text — the same answer as
 * `extractPdfText(bytes).hasText`, but it stops at the first page that has
 * some, so a normal document costs one page's parse rather than all of them.
 *
 * The predicate is `pageTextChunks` itself (a page counts when its normalized
 * text is non-empty), which is exactly what makes the joined text — and so
 * `hasText` — non-empty. `ai-text-preflight.test.ts` pins the two against each
 * other over blank, image-only, whitespace-only and late-text fixtures.
 *
 * Throws when pdfjs cannot open the file (encrypted, damaged); a caller that
 * has no verdict must not invent one.
 */
export async function pdfHasSelectableText(
  bytes: Uint8Array,
): Promise<boolean> {
  const pdfjs = await loadPdfjs();
  const data = bytes.slice();
  const loadingTask = pdfjs.getDocument({ data, ...PDFJS_DOCUMENT_DEFAULTS });
  const doc = await awaitPdfjsDocument(loadingTask);
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      try {
        const content = await page.getTextContent({
          includeMarkedContent: false,
        });
        const text = textItemsToPlainText(content.items as TextItemLike[]);
        if (pageTextChunks([{ pageNumber, text }]).length > 0) return true;
      } finally {
        page.cleanup();
      }
    }
    return false;
  } finally {
    try {
      doc.cleanup();
    } catch {
      // best effort
    }
    await loadingTask.destroy().catch(() => {});
  }
}
