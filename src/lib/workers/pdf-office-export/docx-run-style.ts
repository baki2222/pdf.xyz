/**
 * Each of poppler's words, labelled with the formatting the page draws it in
 * — bold, italic, size, colour — for PDF to Word (since 2026-11-15).
 *
 * ── WHERE THE TEXT COMES FROM, AND WHERE THE STYLE DOES ─────────────────────
 *
 * EVERY CHARACTER the .docx holds is poppler's (`../pdf-text/flow`): its
 * reading order, its paragraphs, its words. pdf.js's page reader
 * (`./page-scan`) only LABELS them: each poppler word (a `FlowPiece`, in
 * poppler's frame) is matched by position to the pdf.js run drawn there
 * (mapped into poppler's frame through the page's `mediaFrame`), and takes
 * that run's style. The two readers never agree on the TEXT one to one
 * (ligatures, spacing, reading order), which is why the text is never taken
 * from the run; on a POSITION they agree to a fraction of a point.
 *
 * ── THE MATCH ───────────────────────────────────────────────────────────────
 *
 * Built once per page:
 *  - every visible line that is upright (within half a degree), whose runs
 *    all carry their position along the baseline (`offset`, `extent`) and
 *    none of whose runs is in a right-to-left script, puts each visible run's
 *    box in a bucket by its vertical centre ({@link BUCKET_PT} points);
 *  - every other line — turned, right-to-left (a run's offsets run against
 *    the reading direction there), or without offsets — is kept whole, with
 *    the one style ALL its visible runs share, if they share one.
 *
 * Per word: the run, in the word's bucket or the two beside it, whose box
 * holds the word's vertical centre and overlaps the word most across — if it
 * covers at least half the word's width; otherwise the whole line whose box
 * holds the word's centre, if that line has one style; otherwise NOTHING —
 * the word is written in Word's default style. An unmatched word is never
 * guessed: plain is the default, never a neighbour's bold.
 *
 * Invisible runs (an OCR layer) are not drawn in any style, so they label
 * nothing: an OCR'd scan comes through in Word's default style.
 *
 * ── WHAT A STYLE IS ─────────────────────────────────────────────────────────
 *
 * Bold and italic from the run's face; the size, in half-points, rounded and
 * held to Word's range (`HALF_POINTS_RANGE`); the colour, unless it is black,
 * unknown (a pattern fill) or mostly transparent. Not the typeface: Word has
 * the PDF's fonts only when the reader's machine does, and embedding them is
 * a separate piece of work.
 */
import type { FlowBox, FlowPiece, PdfFlowTextPage } from "../pdf-text/flow";
import { mapBox } from "./media-frame";
import { HALF_POINTS_RANGE } from "./docx-structure";
import type { ScannedPage, ScannedRun, ScannedTextLine } from "./page-scan";

export interface DocxRunStyle {
  bold?: true;
  italic?: true;
  /** Word's `w:sz`: half-points. */
  halfPoints?: number;
  /** "RRGGBB", never black. */
  color?: string;
}

/**
 * The most words one page's formatting is matched for; a page with more is
 * written in Word's default style, its text whole, and named in the result.
 *
 * MEASURED 2026-11-15 (Node 24, Windows dev host; a fresh process each,
 * `src/tests/docx-run-style-measure.ts`, held to bounds by
 * `docx-run-style.cap.test.ts`): the matcher alone over one page AT this
 * cap — 20,000 words, each its own run — took 12 ms and +2 MB of peak RSS
 * in lines of 20 words, and 9 ms and +2 MB with every word on ONE line
 * (every run in one bucket; 1,297 ms before the buckets were searched by
 * binary search). For scale, a whole 500-page document (41 words a page)
 * through the engine took 2.0 s and +54 MB, of which the check before
 * delivery's structural read-back was 200 ms. The cap is not what makes a
 * page cheap; it bounds the one shape the search is still linear in per
 * word — a single run as wide as the line among thousands of narrow ones in
 * one bucket — which took 640 ms and +3 MB at this count (`match-wide`).
 */
export const MAX_STYLED_PIECES_PER_PAGE = 20_000;

/** The height of a bucket of run boxes, points. */
export const BUCKET_PT = 4;
/** A run must cover this share of a word's width to label it. */
export const MIN_COVER = 0.5;
/** A line within this many degrees of upright is matched word by word. */
const UPRIGHT_DEG = 0.5;
/** Below this opacity a colour is not what the reader sees. */
const MIN_ALPHA = 0.5;

const RTL_SCRIPT = /[\p{Script=Arabic}\p{Script=Hebrew}]/u;

type Box = readonly [number, number, number, number];

interface RunBox {
  box: Box;
  style: DocxRunStyle;
}

interface LineBox {
  box: Box;
  /** The style every visible run shares (a line of several is not kept). */
  style: DocxRunStyle;
}

/** The style a run is drawn in, as Word writes it. */
export function styleOfRun(run: ScannedRun): DocxRunStyle {
  const halfPoints = Math.min(
    HALF_POINTS_RANGE[1],
    Math.max(HALF_POINTS_RANGE[0], Math.round(run.size * 2)),
  );
  const color =
    run.color !== null &&
    /^[0-9A-Fa-f]{6}$/.test(run.color) &&
    run.color.toUpperCase() !== "000000" &&
    run.alpha >= MIN_ALPHA
      ? run.color.toUpperCase()
      : undefined;
  return {
    ...(run.bold ? { bold: true as const } : {}),
    ...(run.italic ? { italic: true as const } : {}),
    ...(Number.isFinite(halfPoints) ? { halfPoints } : {}),
    ...(color ? { color } : {}),
  };
}

/** Two styles are one run in Word when this is equal. */
export function styleKey(style: DocxRunStyle | null): string {
  if (!style) return "-";
  return `${style.bold ? "b" : ""}${style.italic ? "i" : ""}|${style.halfPoints ?? ""}|${style.color ?? ""}`;
}

/** `[x, y, w, h]` turned `rotation` degrees clockwise about its centre, as a box. */
function turnedBox(line: ScannedTextLine): Box {
  const cx = line.x + line.width / 2;
  const cy = line.y + line.height / 2;
  const a = (line.rotation * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [dx, dy] of [
    [-line.width / 2, -line.height / 2],
    [line.width / 2, -line.height / 2],
    [-line.width / 2, line.height / 2],
    [line.width / 2, line.height / 2],
  ] as const) {
    const x = cx + dx * cos - dy * sin;
    const y = cy + dx * sin + dy * cos;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/**
 * One bucket's runs, sorted by their left edge, and the widest of them: a
 * word's candidates are the runs starting between its left edge less that
 * width and its right edge — found by binary search, so a page of every run
 * on one line is not a search of every run per word.
 */
interface Bucket {
  runs: RunBox[];
  widest: number;
}

interface PageIndex {
  buckets: Map<number, Bucket>;
  /** Whole lines, by every bucket their box spans. */
  lines: Map<number, LineBox[]>;
}

/** The first index in `runs` (sorted by left edge) whose left edge is >= x. */
function firstFrom(runs: readonly RunBox[], x: number): number {
  let lo = 0;
  let hi = runs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (runs[mid]!.box[0] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The page's runs, indexed for matching (see the module docblock). */
function indexOf(scanned: ScannedPage): PageIndex {
  const byBucket = new Map<number, RunBox[]>();
  const lines = new Map<number, LineBox[]>();
  const frame = scanned.mediaFrame;
  for (const item of scanned.items) {
    if (item.kind !== "text") continue;
    const visible = item.runs.filter((r) => !r.invisible && r.text.trim());
    if (visible.length === 0) continue;
    const upright = Math.min(item.rotation, 360 - item.rotation) < UPRIGHT_DEG;
    const located = item.runs.every(
      (r) => r.offset !== undefined && r.extent !== undefined,
    );
    const rtl = item.runs.some((r) => RTL_SCRIPT.test(r.text));
    if (upright && located && !rtl) {
      for (const run of visible) {
        const box = mapBox(frame, [
          item.x + run.offset!,
          item.y,
          item.x + run.offset! + run.extent!,
          item.y + item.height,
        ]);
        const bucket = Math.floor((box[1] + box[3]) / 2 / BUCKET_PT);
        const list = byBucket.get(bucket);
        const entry = { box, style: styleOfRun(run) };
        if (list) list.push(entry);
        else byBucket.set(bucket, [entry]);
      }
      continue;
    }
    const first = styleOfRun(visible[0]!);
    const key = styleKey(first);
    // A line of several styles labels nothing as a whole: not indexed.
    if (!visible.every((r) => styleKey(styleOfRun(r)) === key)) continue;
    const box = mapBox(frame, turnedBox(item));
    const entry: LineBox = { box, style: first };
    const top = Math.floor(box[1] / BUCKET_PT);
    const bottom = Math.floor(box[3] / BUCKET_PT);
    for (let b = top; b <= bottom; b++) {
      const list = lines.get(b);
      if (list) list.push(entry);
      else lines.set(b, [entry]);
    }
  }
  const buckets = new Map<number, Bucket>();
  for (const [b, runs] of byBucket) {
    runs.sort((p, q) => p.box[0] - q.box[0]);
    let widest = 0;
    for (const r of runs) widest = Math.max(widest, r.box[2] - r.box[0]);
    buckets.set(b, { runs, widest });
  }
  return { buckets, lines };
}

function matchPiece(box: FlowBox, index: PageIndex): DocxRunStyle | null {
  const cx = (box[0] + box[2]) / 2;
  const cy = (box[1] + box[3]) / 2;
  const width = Math.max(box[2] - box[0], 1e-6);
  const bucket = Math.floor(cy / BUCKET_PT);
  let best: RunBox | null = null;
  let bestOverlap = 0;
  for (let b = bucket - 1; b <= bucket + 1; b++) {
    const found = index.buckets.get(b);
    if (!found) continue;
    const { runs, widest } = found;
    for (
      let k = firstFrom(runs, box[0] - widest);
      k < runs.length && runs[k]!.box[0] < box[2];
      k++
    ) {
      const run = runs[k]!;
      if (cy < run.box[1] || cy > run.box[3]) continue;
      const overlap =
        Math.min(box[2], run.box[2]) - Math.max(box[0], run.box[0]);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = run;
      }
    }
  }
  if (best && bestOverlap >= MIN_COVER * width) return best.style;
  for (const line of index.lines.get(bucket) ?? []) {
    if (
      line.style &&
      cx >= line.box[0] &&
      cx <= line.box[2] &&
      cy >= line.box[1] &&
      cy <= line.box[3]
    )
      return line.style;
  }
  return null;
}

export interface PageRunStyles {
  /** Parallel to `page.pieces`: each word's style, or null (Word's default). */
  styles: (DocxRunStyle | null)[][][];
  /** Words given a style. */
  matched: number;
  /** Words on the page. */
  total: number;
  /** The page had more than {@link MAX_STYLED_PIECES_PER_PAGE} words. */
  capped: boolean;
}

/**
 * Every word's style on one page (see the module docblock). All null — and
 * counted by the caller — when the page reader did not read the page's text
 * (`textUnread`), read no page, or the page has more words than the cap.
 */
export function runStylesOf(
  page: PdfFlowTextPage,
  scanned: ScannedPage | undefined,
): PageRunStyles {
  const pieces: readonly (readonly (readonly FlowPiece[])[])[] =
    page.pieces ?? [];
  let total = 0;
  for (const paragraph of pieces)
    for (const cell of paragraph) total += cell.length;
  const none = () =>
    pieces.map((paragraph) => paragraph.map((cell) => cell.map(() => null)));
  const capped = total > MAX_STYLED_PIECES_PER_PAGE;
  if (capped || !scanned || scanned.textUnread)
    return { styles: none(), matched: 0, total, capped };
  const index = indexOf(scanned);
  let matched = 0;
  const styles = pieces.map((paragraph) =>
    paragraph.map((cell) =>
      cell.map((piece) => {
        const style = matchPiece(piece.box, index);
        if (style) matched += 1;
        return style;
      }),
    ),
  );
  return { styles, matched, total, capped };
}
