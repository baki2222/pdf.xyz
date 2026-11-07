import type { Rect } from "./model";
import type { TextRun } from "./runs";

/**
 * Text markup: the four ISO 32000-1 §12.5.6.10 kinds a reviewer marks words
 * with — highlight, underline, strike-out and squiggly underline — and the
 * geometry the editor's overlay, the flattened export and the comment
 * writer (`comments.ts`) all draw them from, so the three cannot disagree.
 *
 * A text markup is a `highlight` object with a `markup` (absent on objects
 * made before 2026-11-08: a highlight). Its marked area is `quads` — one box
 * per line of the text selected, read from pdf.js's text runs
 * ({@link selectTextQuads}) and drawn as stored by the overlay, the
 * flattened export and the comment — or, for a box dragged where there is
 * no text (a scan), the box: flattened as drawn, saved as a comment snapped
 * to any text lines under it (`snapHighlightQuads`).
 *
 * Feature-scoped on purpose: only the editor's lazy chunk and its export
 * import this, never a first-load module (the bundle budget, 2026-11-07).
 */

export const TEXT_MARKUPS = [
  "highlight",
  "underline",
  "strikeout",
  "squiggly",
] as const;
export type TextMarkup = (typeof TEXT_MARKUPS)[number];

/** What the toolbar buttons, the Style menu and the page copy call each. */
export const TEXT_MARKUP_LABEL: Record<TextMarkup, string> = {
  highlight: "Highlight",
  underline: "Underline",
  strikeout: "Strikethrough",
  squiggly: "Squiggly",
};

/** The annotation subtype each is saved as (ISO 32000-1 Table 169). */
export const TEXT_MARKUP_SUBTYPE: Record<TextMarkup, string> = {
  highlight: "Highlight",
  underline: "Underline",
  strikeout: "StrikeOut",
  squiggly: "Squiggly",
};

export function markupOf(obj: { markup?: TextMarkup }): TextMarkup {
  return obj.markup ?? "highlight";
}

/*
 * Where a line sits in a quad. A run's box spans its font's descent (0.22
 * of the size) to its ascent (0.92) — `runs.ts` places it so — which puts
 * the baseline 0.92 / 1.14 of the way down. An underline sits just under
 * the baseline; a strike-out at the middle of the lower-case letters.
 */
const SPAN = 1.14;
const UNDERLINE_AT = (0.92 + 0.07) / SPAN;
const STRIKE_AT = (0.92 - 0.3) / SPAN;
const SQUIGGLE_AT = (0.92 + 0.1) / SPAN;

/** The stroke's width for a quad of this height, points. */
export function markupThickness(quadHeight: number): number {
  return Math.max(0.75, quadHeight * 0.06);
}

/**
 * The polyline a line markup draws across one quad, in the quad's own
 * frame (viewer points, horizontal text), and its width. Null for a
 * highlight, which fills the quad.
 */
export function markupStroke(
  quad: Rect,
  markup: TextMarkup,
): { points: { x: number; y: number }[]; width: number } | null {
  if (markup === "highlight") return null;
  const width = markupThickness(quad.height);
  const x0 = quad.x;
  const x1 = quad.x + quad.width;
  if (markup !== "squiggly") {
    const y =
      quad.y +
      quad.height * (markup === "underline" ? UNDERLINE_AT : STRIKE_AT);
    return {
      points: [
        { x: x0, y },
        { x: x1, y },
      ],
      width,
    };
  }
  const mid = quad.y + quad.height * SQUIGGLE_AT;
  const amp = Math.max(0.75, quad.height * 0.05);
  const step = Math.max(1.5, quad.height * 0.14);
  const points: { x: number; y: number }[] = [];
  let up = true;
  for (let x = x0; x < x1; x += step) {
    points.push({ x, y: mid + (up ? -amp : amp) });
    up = !up;
  }
  points.push({ x: x1, y: mid + (up ? -amp : amp) });
  return { points, width };
}

/* ------------------------------ selecting text ----------------------------- */

const ANGLE_TOLERANCE = 1;
/** How far outside a run's box a press still lands on it, points. */
const SLOP = 2;

function horizontal(run: TextRun): boolean {
  const a = ((run.angle % 360) + 360) % 360;
  return Math.min(a, 360 - a) <= ANGLE_TOLERANCE;
}

function contains(r: Rect, p: { x: number; y: number }, slop: number) {
  return (
    p.x >= r.x - slop &&
    p.x <= r.x + r.width + slop &&
    p.y >= r.y - slop &&
    p.y <= r.y + r.height + slop
  );
}

/** The run under `p`, among horizontal runs, or null. */
export function runUnder(
  runs: readonly TextRun[],
  p: { x: number; y: number },
): TextRun | null {
  return runs.find((r) => horizontal(r) && contains(r.rect, p, SLOP)) ?? null;
}

/** The run nearest `p`: the same line first, then the nearest line. */
function nearestRun(list: readonly TextRun[], p: { x: number; y: number }) {
  let best = 0;
  let bestScore = Infinity;
  list.forEach((r, i) => {
    const dy = Math.max(0, r.rect.y - p.y, p.y - (r.rect.y + r.rect.height));
    const dx = Math.max(0, r.rect.x - p.x, p.x - (r.rect.x + r.rect.width));
    const score = dy * 1000 + dx;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/** The character boundary nearest `x` in a run (its letters taken as equal widths). */
function charAt(run: TextRun, x: number): number {
  const n = run.str.length;
  const t = run.rect.width > 0 ? (x - run.rect.x) / run.rect.width : 0;
  return Math.max(0, Math.min(n, Math.round(t * n)));
}

const SPACE = /\s/;
function wordStart(str: string, i: number): number {
  while (i > 0 && !SPACE.test(str[i - 1]!)) i -= 1;
  return i;
}
function wordEnd(str: string, i: number): number {
  while (i < str.length && !SPACE.test(str[i]!)) i += 1;
  return i;
}

/**
 * The text a press-and-drag from `a` to `b` selects, as one quad per line
 * (viewer points) — or null when `a` is not on text, and the drag is a box.
 *
 * Like a viewer's text selection: from the word under `a` to the word under
 * (or nearest) `b`, in the runs' reading order (pdf.js's), whole words at
 * both ends, each line clipped to what is selected on it. A press without a
 * drag selects the one word under it. Horizontal text only: turned text is
 * marked with a box.
 */
export function selectTextQuads(
  runs: readonly TextRun[],
  a: { x: number; y: number },
  b: { x: number; y: number },
): Rect[] | null {
  const list = runs.filter(horizontal);
  const startRun = runUnder(list, a);
  if (!startRun) return null;
  let i = list.indexOf(startRun);
  let ci = charAt(startRun, a.x);
  let j = nearestRun(list, b);
  let cj = charAt(list[j]!, b.x);
  if (j < i || (j === i && cj < ci)) {
    [i, j] = [j, i];
    [ci, cj] = [cj, ci];
  }
  ci = wordStart(list[i]!.str, ci);
  cj = wordEnd(list[j]!.str, cj);
  const pieces: Rect[] = [];
  for (let k = i; k <= j; k++) {
    const run = list[k]!;
    const n = run.str.length;
    const c0 = k === i ? ci : 0;
    const c1 = k === j ? cj : n;
    if (c1 <= c0 || n === 0) continue;
    const x0 = run.rect.x + (run.rect.width * c0) / n;
    const x1 = run.rect.x + (run.rect.width * c1) / n;
    pieces.push({
      x: x0,
      y: run.rect.y,
      width: x1 - x0,
      height: run.rect.height,
    });
  }
  if (pieces.length === 0) return null;
  // Pieces side by side on one line merge; a column gutter does not.
  const out: Rect[] = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    const sameLine =
      last &&
      Math.abs(last.y + last.height / 2 - (p.y + p.height / 2)) <
        Math.min(last.height, p.height) / 2;
    const gap = last ? p.x - (last.x + last.width) : Infinity;
    if (
      last &&
      sameLine &&
      gap >= -1 &&
      gap <= Math.min(last.height, p.height)
    ) {
      const x0 = Math.min(last.x, p.x);
      const y0 = Math.min(last.y, p.y);
      const x1 = Math.max(last.x + last.width, p.x + p.width);
      const y1 = Math.max(last.y + last.height, p.y + p.height);
      out[out.length - 1] = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    } else out.push(p);
  }
  return out;
}

/** The box around a set of quads. */
export function quadsBounds(quads: readonly Rect[]): Rect {
  const x0 = Math.min(...quads.map((q) => q.x));
  const y0 = Math.min(...quads.map((q) => q.y));
  const x1 = Math.max(...quads.map((q) => q.x + q.width));
  const y1 = Math.max(...quads.map((q) => q.y + q.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/* ----------------------------- highlighter pen ----------------------------- */

/**
 * The highlighter pen (audit annotate-pdf#5, 2026-11-08): freehand ink with
 * `highlighter: true`, a wide stroke in the highlight's colour, painted with
 * the Multiply blend — overlay, flattened page and /Ink appearance alike —
 * so the words under it stay readable instead of being washed over.
 */
export const HIGHLIGHTER_LABEL = "Highlighter";
export const HIGHLIGHTER_WIDTH = 12;
export const HIGHLIGHTER_OPACITY = 0.5;
