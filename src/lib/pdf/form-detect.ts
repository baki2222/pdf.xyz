import type { NewCheckBoxField, NewTextField } from "./create-forms";
import type { Rect, Seg } from "./form-detect-paths";

/**
 * Create Forms field finder: the decisions. Given one page's straight lines,
 * small boxes and text (already read and placed by `./form-detect-read`),
 * propose where a fillable field might go, and say why each other shape was
 * passed over.
 *
 * LIMITS, in plain words. It looks at three shapes only: a run of
 * underscores typed in the text, a straight line with a label beside or
 * under it, and a small empty square. It reads only text that is upright in
 * the page's content and lines and boxes drawn in the PDF itself, so it finds
 * nothing on a scanned page (a picture of a form). It PROPOSES and never
 * writes: nothing here adds a field, and every proposal is meant to be
 * checked by a person. It leans towards missing a field rather than proposing
 * a wrong one, because a missed field costs one click on Add field and a
 * wrong one costs a review.
 *
 * Every shape it passes over is recorded in `excluded` with the FIRST rule
 * that decided it, in the order `classifyPage` documents. Which shapes each
 * rule catches, and which it must leave alone, is held by the generated
 * corpus in src/tests/form-detect-fixtures.ts, run both ways by
 * form-detect.corpus.test.ts (every rule finds or decides at least one case,
 * and every case is explained). Each threshold in {@link DETECT} has a test
 * at and just past its boundary in form-detect.test.ts.
 *
 * FRAME. Coordinates are PDF points with the origin at the bottom-left of the
 * page's visible box (CropBox clipped by MediaBox), BEFORE `/Rotate` turns
 * it: the frame the page's own content is upright in. For an unturned page
 * that is exactly the builder's card frame; `./form-detect-read` turns the
 * proposals into the card frame with `toCard`.
 *
 * Pure: no pdf.js and no pdf-lib. Only types come from ./create-forms.
 */

/** The shapes a proposal can come from; `plain` is the wording copy may use. */
export const DETECTION_RULES = [
  { id: "underscore-run", plain: "runs of underscores" },
  { id: "labelled-rule", plain: "blank lines next to a label" },
  { id: "square-checkbox", plain: "small empty boxes" },
] as const;

/** Why a shape was passed over, in the order they are decided (mostly). */
export const EXCLUSION_RULES = [
  { id: "underline" },
  { id: "full-width-divider" },
  { id: "page-band" },
  { id: "table-grid" },
  { id: "comb" },
  { id: "bullet" },
  { id: "signature" },
  { id: "existing-field" },
  { id: "existing-draft" },
  { id: "overlaps-text" },
  { id: "no-clearance" },
  { id: "duplicate" },
  { id: "off-page" },
  { id: "invalid" },
  { id: "unlabelled" },
  { id: "short-run" },
  { id: "rotated-label" },
] as const;

export type DetectionRuleId = (typeof DETECTION_RULES)[number]["id"];
export type ExclusionRuleId = (typeof EXCLUSION_RULES)[number]["id"];

/**
 * Every threshold, defined once. Each has a boundary test (at the value, and
 * just outside it) in form-detect.test.ts.
 */
export const DETECT = {
  /** A run is at least this many underscores (ASCII or full-width). */
  UNDERSCORE_MIN: 4,
  /**
   * Character advances in ems, for placing a run inside its text item. pdf.js
   * gives one width for the whole item, not one per character. When the
   * item's font family is known, underscores take their family's width
   * (Helvetica/Arial 0.556, Times 0.5, Courier 0.6) and the other characters
   * share what is left of the item's width by these weights; otherwise every
   * character is weighted and the total is scaled to the item's width.
   * Monospaced text weighs every character the same.
   */
  UNDERSCORE_EMS: {
    underscore: { "sans-serif": 0.556, serif: 0.5, monospace: 0.6 },
    unknownUnderscore: 0.5,
    space: 0.278,
    other: 0.5,
  },
  /** Fields are inset this far from each end of a run or a line. */
  FIELD_INSET: 1,
  /** A run narrower than this after the inset is `short-run`. */
  MIN_FIELD_W: 24,
  /** A line shorter than this is not a candidate. */
  RULE_MIN_LEN: 36,
  /** A line counts as level within this rise. */
  RULE_MAX_DY: 0.5,
  /** A stroked line no wider than this, or a filled bar no taller, is a rule. */
  RULE_MAX_WIDTH: 2,
  /** Collinear pieces this close are one line. */
  RULE_MERGE_GAP: 1,
  /** How far left of a line its label may end. */
  LABEL_LEFT_GAP_RULE: 36,
  /**
   * A LABEL COLUMN: labels set flush left and every line started at one tab
   * stop, so a short label ("City:") ends far from its line while a long one
   * ("Date of birth:") sits close. At least LABEL_COLUMN_MIN lines whose
   * left ends line up, and whose labels' left edges line up, each within
   * GRID_ROW_EPS, one of the labels within LABEL_LEFT_GAP_RULE: each line
   * in it takes the text to its left up to LABEL_COLUMN_GAP_MAX (2 in).
   */
  LABEL_COLUMN_MIN: 3,
  LABEL_COLUMN_GAP_MAX: 144,
  /** How far from a run or a square its label may be. */
  LABEL_LEFT_GAP: 24,
  /** A line's label baseline sits in [y - 2, y + 0.6 x size]. */
  LABEL_BELOW_RULE: 2,
  LABEL_ABOVE_RULE_EMS: 0.6,
  /** A run's label baseline sits within 0.3 x size of the run's. */
  RUN_BASELINE_EMS: 0.3,
  /** A caption's top sits 1 to 14 pt below the line, under its first 40%. */
  CAPTION_MIN: 1,
  CAPTION_MAX: 14,
  CAPTION_SPAN: 0.4,
  /** Field height: clamp(ems x size, min, max). */
  TEXT_H_RUN: { ems: 1.2, min: 12, max: 22 },
  TEXT_H_RULE: { ems: 1.4, min: 14, max: 22 },
  /** A run's field bottom is this many ems under its baseline. */
  RUN_BOTTOM_EMS: 0.15,
  /** A line's field bottom is this far above the line. */
  RULE_BOTTOM_GAP: 1,
  /** The size assumed for a line with no label text to measure. */
  DEFAULT_SIZE: 10,
  /** A field's top stays this far under the baseline of text above it. */
  CLEARANCE_GAP: 1,
  /** A field squeezed lower than this is `no-clearance`. */
  MIN_FIELD_H: 10,
  /** Text extent around its baseline, in ems: descent below, ascent above. */
  TEXT_DESCENT_EMS: 0.2,
  TEXT_ASCENT_EMS: 0.7,
  /** A checkbox square: 6..20 pt a side, sides within 20% of each other. */
  SQUARE_MIN: 6,
  SQUARE_MAX: 20,
  SQUARE_SKEW: 0.2,
  SQUARE_INSET: 1,
  /**
   * A square drawn as four separate lines: corners meeting within this are
   * joined into the box a `re` would have drawn.
   */
  JOIN_EPS: 0.5,
  /**
   * A work bound, not a shape: a corner with more than this many edges of a
   * square's size around it (within 1.5 pt) is left unjoined. A checkbox
   * corner has two to four; a crowd made the pairing cubic.
   */
  JOIN_CROWD: 16,
  /** Underline: a baseline 0..3 pt above the line along half its length. */
  UNDERLINE_MAX_GAP: 3,
  UNDERLINE_SPAN: 0.5,
  /** Divider: at least 85% of the page width, with no label to its left. */
  DIVIDER_SPAN: 0.85,
  /** Band: the outer 8% of the page, and wider than 70% or repeated. */
  BAND_EDGE: 0.08,
  BAND_SPAN: 0.7,
  BAND_REPEAT_EPS: 2,
  BAND_REPEAT_PAGES: 2,
  /** Grid: an end touched by 2 plumb lines, or 3 touching it anywhere. */
  GRID_TOUCH_EPS: 1,
  GRID_END_TOUCHES: 2,
  GRID_TOUCHES: 3,
  /**
   * Grid with no plumb lines (a table ruled in rows only): 3 or more rules
   * whose ends line up within 2 pt, at a pitch even within 2 pt, with text
   * in two or more columns (24 pt apart) in every row between them that
   * holds text, and at least one such row. A rule with a label to its left
   * is never one of a table's rows.
   */
  GRID_ROWS_MIN: 3,
  GRID_ROW_EPS: 2,
  GRID_PITCH_EPS: 2,
  GRID_COLUMN_GAP: 24,
  /** Comb: 4 or more equal squares edge to edge in a row. */
  COMB_MIN: 4,
  COMB_EPS: 1,
  /** A label naming a signature line. */
  SIGNATURE_RE: /\b(sign(ature|ed)?|initials)\b/i,
  /**
   * A letter's complimentary close. A line with no label to its left (only a
   * caption, the signer's printed name, or nothing) that has one of these up
   * to SIGNOFF_ABOVE pt above it is a signature line too. The close OPENS
   * its text item, after any of the lead words ("Yours sincerely", "With
   * kind regards", "Signed for and on behalf of"): a form's instruction that
   * only contains the words ("... on behalf of the patient, please give
   * your details:", "You are cordially invited") is not a close.
   */
  SIGNOFF_RE:
    /^\W*(?:(?:yours|very|kind|kindest|best|warm|warmest|with|signed|for|and)\s+)*(sincerely|regards|faithfully|truly|cordially|respectfully|on\s+behalf\s+of)\b/i,
  SIGNOFF_ABOVE: 80,
  /** Overlap with an existing field or card: IoU above this, or a centre inside. */
  IOU_EXISTING: 0.3,
  /** Duplicates: bottoms within 4 pt and overlapping by half. */
  DUP_DY: 4,
  DUP_OVERLAP: 0.5,
  /**
   * The engine's tolerance for a field fitting the page. A copy, not an
   * import (this module may not load create-forms.ts at run time);
   * form-detect.test.ts holds it equal to the engine's.
   */
  BOUND_EPS: 0.5,
  CAPS: { perPage: 60, perRun: 300, pages: 50 },
} as const;

/** A box in points: lower-left corner and size. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A segment in the page frame (see the module docblock). */
export type CardSeg = Seg;
/** A rectangle in the page frame. */
export type CardRect = Rect;

/** One text item in the page frame. */
export interface CardText {
  str: string;
  /** Left end of the baseline. */
  x: number;
  /** Baseline height. */
  y: number;
  width: number;
  size: number;
  /**
   * Upright in content space (b = c = 0, a > 0, d > 0, not vertical
   * writing). Text that is not upright is still seen (it can block a field)
   * but can never be a label; its x, y and width are then its bounding box.
   */
  upright: boolean;
  /** pdf.js's font family, when known: places a run inside its item. */
  family?: "serif" | "sans-serif" | "monospace";
}

export interface CardPage {
  /** 1-based page number. */
  page: number;
  width: number;
  height: number;
  segs: CardSeg[];
  rects: CardRect[];
  text: CardText[];
  /** Existing form widgets on this page. */
  widgets: Box[];
  /** Share of the page covered by images, 0..1. */
  imageCover: number;
}

/** Where a field might go, in the same frame as its page. Whole points. */
export interface FieldProposal {
  key: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  type: "text" | "checkbox";
  label: string | null;
  rule: DetectionRuleId;
}

export interface DetectCounts {
  /** Shapes considered. */
  candidates: number;
  proposals: number;
  /** Lines labelled as a signature: left for Edit PDF's signature field. */
  signatureLines: number;
  /** Shapes already covered by a field in the PDF. */
  alreadyFields: number;
  /** Shapes whose only label is not upright text. */
  rotatedText: number;
  /** Proposals the builder's own validation still refused. */
  invalid: number;
  /** Proposals not shown because a cap was reached. */
  capped: number;
  /** Pages not searched (too complex, or past the page cap). */
  pagesNotSearched: number;
}

export interface Excluded {
  rule: ExclusionRuleId;
  page: number;
  box: Box;
}

/** A card already in the builder (page and box in the card frame). */
export interface Placement {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ClassifyOptions {
  /** Rules to skip: the seam the corpus's mutation tests use. */
  disable?: ReadonlySet<ExclusionRuleId>;
  /** Cards already in the builder, in this page's frame. */
  drafts?: readonly Placement[];
  /** {@link bandLines} of the OTHER pages, for the repeated-band rule. */
  repeatsAcrossPages?: readonly CardSeg[][];
}

export function emptyCounts(): DetectCounts {
  return {
    candidates: 0,
    proposals: 0,
    signatureLines: 0,
    alreadyFields: 0,
    rotatedText: 0,
    invalid: 0,
    capped: 0,
    pagesNotSearched: 0,
  };
}

/* ------------------------------------------------------------------ *
 *  Text: where each character sits
 * ------------------------------------------------------------------ */

// Built from DETECT.UNDERSCORE_MIN, so the constant is the one that decides
// (it once sat beside a literal {4,} that nothing tied it to).
const UNDERSCORE_RUN = new RegExp(`[_\\uFF3F]{${DETECT.UNDERSCORE_MIN},}`, "g");
const isUnderscore = (ch: string) => ch === "_" || ch === "\uFF3F";
const isSpace = (ch: string) => /\s/.test(ch);

/**
 * Each character's [left, right] along the item's baseline, estimated from
 * {@link DETECT.UNDERSCORE_EMS} and the item's width.
 */
export function charSpans(t: CardText): [number, number][] {
  const chars = Array.from(t.str);
  const ems = DETECT.UNDERSCORE_EMS;
  const mono = t.family === "monospace";
  const known = t.family !== undefined;
  const u = known
    ? ems.underscore[t.family as keyof typeof ems.underscore]
    : ems.unknownUnderscore;
  const weight = (ch: string) =>
    isUnderscore(ch) ? u : mono ? u : isSpace(ch) ? ems.space : ems.other;
  const weights = chars.map(weight);
  const width = Math.max(0, t.width);
  let adv: number[];
  const underscoreTotal = chars.reduce(
    (s, ch) => s + (isUnderscore(ch) ? u * t.size : 0),
    0,
  );
  const otherWeight = chars.reduce(
    (s, ch, i) => s + (isUnderscore(ch) ? 0 : weights[i]!),
    0,
  );
  if (known && !mono && otherWeight > 0 && underscoreTotal <= width) {
    // Underscores at their family's width; the rest share what is left.
    const rest = width - underscoreTotal;
    adv = chars.map((ch, i) =>
      isUnderscore(ch) ? u * t.size : (weights[i]! / otherWeight) * rest,
    );
  } else {
    const total = weights.reduce((s, w) => s + w, 0);
    adv = weights.map((w) => (total > 0 ? (w / total) * width : 0));
  }
  const spans: [number, number][] = [];
  let x = t.x;
  for (const a of adv) {
    spans.push([x, x + a]);
    x += a;
  }
  return spans;
}

interface Piece {
  kind: "text" | "run";
  x0: number;
  x1: number;
  baseline: number;
  size: number;
  item: number;
  /** Character range within the item (code points). */
  from: number;
  to: number;
}

/** An item split into underscore runs and the words around them. */
function pieces(t: CardText, item: number): Piece[] {
  const chars = Array.from(t.str);
  if (!t.upright) {
    return t.str.trim()
      ? [
          {
            kind: "text",
            x0: t.x,
            x1: t.x + Math.max(0, t.width),
            baseline: t.y,
            size: t.size,
            item,
            from: 0,
            to: chars.length,
          },
        ]
      : [];
  }
  const spans = charSpans(t);
  const out: Piece[] = [];
  const runs: [number, number][] = [];
  const joined = chars.join("");
  // Code-point offsets of each underscore run.
  for (const m of joined.matchAll(UNDERSCORE_RUN)) {
    const from = Array.from(joined.slice(0, m.index)).length;
    runs.push([from, from + Array.from(m[0]).length]);
  }
  const inRun = (i: number) => runs.some(([a, b]) => i >= a && i < b);
  let i = 0;
  while (i < chars.length) {
    const run = runs.find(([a]) => a === i);
    if (run) {
      out.push({
        kind: "run",
        x0: spans[run[0]]![0],
        x1: spans[run[1] - 1]![1],
        baseline: t.y,
        size: t.size,
        item,
        from: run[0],
        to: run[1],
      });
      i = run[1];
      continue;
    }
    if (isSpace(chars[i]!)) {
      i++;
      continue;
    }
    let j = i;
    while (j < chars.length && !isSpace(chars[j]!) && !inRun(j)) j++;
    out.push({
      kind: "text",
      x0: spans[i]![0],
      x1: spans[j - 1]![1],
      baseline: t.y,
      size: t.size,
      item,
      from: i,
      to: j,
    });
    i = j;
  }
  return out;
}

const TRAILING = /[\s:.\-\u2013\u2014]/u;

/**
 * Label text: underscores and trailing colons dropped, spaces collapsed.
 * The trailing colons, periods, dashes and spaces are trimmed one character
 * at a time from the end: an anchored `[...]+$` backtracked over every run
 * of them that did not end the string, which is quadratic in a long one.
 */
export function cleanLabel(s: string): string | null {
  const mid = s
    .replace(/[_\uFF3F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let end = mid.length;
  while (end > 0 && TRAILING.test(mid[end - 1]!)) end--;
  const out = mid.slice(0, end).trim();
  return out.length > 0 ? out : null;
}

/* ------------------------------------------------------------------ *
 *  Lines
 * ------------------------------------------------------------------ */

interface Line {
  x0: number;
  x1: number;
  y: number;
}

interface PageLines {
  /** Level rules (merged), any length. */
  rules: Line[];
  /** Plumb lines, for the grid rule. */
  verticals: { x: number; y0: number; y1: number }[];
  squares: CardRect[];
}

function isSquare(r: CardRect): boolean {
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  return (
    w >= DETECT.SQUARE_MIN &&
    h >= DETECT.SQUARE_MIN &&
    w <= DETECT.SQUARE_MAX &&
    h <= DETECT.SQUARE_MAX &&
    Math.abs(w - h) <= DETECT.SQUARE_SKEW * Math.max(w, h)
  );
}

/**
 * Boxes drawn as four separate stroked lines (generated forms often draw a
 * checkbox that way), joined into the Rect a `re` would have given, so they
 * are read, and excluded, exactly as one. Only edges a square could have
 * (SQUARE_MIN to SQUARE_MAX long) are tried, and each corner is looked up in
 * a map. A corner crowded with more than {@link DETECT.JOIN_CROWD} such
 * edges is left unjoined, so each bottom edge tries at most JOIN_CROWD
 * lefts, rights and tops and the cost stays linear in the page's segments.
 * (Without that bound the map did not make it linear: 2,400 edges at one
 * corner, every left paired with every right, took 12.7 s.)
 */
function joinSquares(segs: readonly CardSeg[]): {
  rects: CardRect[];
  used: Set<CardSeg>;
} {
  const eps = DETECT.JOIN_EPS;
  const fits = (len: number) =>
    len >= DETECT.SQUARE_MIN - eps && len <= DETECT.SQUARE_MAX + eps;
  type Level = { x0: number; x1: number; y: number; s: CardSeg };
  type Plumb = { x: number; y0: number; y1: number; s: CardSeg };
  const key = (a: number, b: number) => `${Math.round(a)}|${Math.round(b)}`;
  const levels = new Map<string, Level[]>();
  const plumbs = new Map<string, Plumb[]>();
  const add = <T>(m: Map<string, T[]>, k: string, v: T) => {
    const list = m.get(k);
    if (list) list.push(v);
    else m.set(k, [v]);
  };
  const near = <T>(m: Map<string, T[]>, a: number, b: number): T[] => {
    const lists: T[][] = [];
    let n = 0;
    for (const da of [-1, 0, 1])
      for (const db of [-1, 0, 1]) {
        const list = m.get(key(a + da, b + db));
        if (list) {
          lists.push(list);
          n += list.length;
        }
      }
    return n > DETECT.JOIN_CROWD ? [] : lists.flat();
  };
  const bottoms: Level[] = [];
  for (const s of segs) {
    if (!s.stroked) continue;
    const dx = Math.abs(s.x1 - s.x0);
    const dy = Math.abs(s.y1 - s.y0);
    if (dy <= eps && fits(dx)) {
      const l = {
        x0: Math.min(s.x0, s.x1),
        x1: Math.max(s.x0, s.x1),
        y: (s.y0 + s.y1) / 2,
        s,
      };
      add(levels, key(l.x0, l.y), l);
      bottoms.push(l);
    } else if (dx <= eps && fits(dy)) {
      const v = {
        x: (s.x0 + s.x1) / 2,
        y0: Math.min(s.y0, s.y1),
        y1: Math.max(s.y0, s.y1),
        s,
      };
      add(plumbs, key(v.x, v.y0), v);
    }
  }
  const used = new Set<CardSeg>();
  const rects: CardRect[] = [];
  const close = (a: number, b: number) => Math.abs(a - b) <= eps;
  for (const b of bottoms) {
    if (used.has(b.s)) continue;
    const free = <T extends { s: CardSeg }>(xs: T[]) =>
      xs.filter((x) => !used.has(x.s) && x.s !== b.s);
    for (const left of free(near(plumbs, b.x0, b.y))) {
      if (!close(left.x, b.x0) || !close(left.y0, b.y)) continue;
      const right = free(near(plumbs, b.x1, b.y)).find(
        (v) =>
          v !== left &&
          close(v.x, b.x1) &&
          close(v.y0, b.y) &&
          close(v.y1, left.y1),
      );
      if (!right) continue;
      const top = free(near(levels, b.x0, left.y1)).find(
        (l) => close(l.x0, b.x0) && close(l.x1, b.x1) && close(l.y, left.y1),
      );
      if (!top) continue;
      const four = [b, left, right, top];
      four.forEach((e) => used.add(e.s));
      rects.push({
        x0: Math.min(b.x0, top.x0, left.x),
        y0: Math.min(b.y, left.y0, right.y0),
        x1: Math.max(b.x1, top.x1, right.x),
        y1: Math.max(top.y, left.y1, right.y1),
        width: Math.max(...four.map((e) => e.s.width)),
        stroked: true,
        filled: false,
        lum: Math.max(...four.map((e) => e.s.lum)),
      });
      break;
    }
  }
  return { rects, used };
}

/** The page's level rules, plumb lines and squares. */
function readLines(p: CardPage): PageLines {
  const raw: Line[] = [];
  const verticals: PageLines["verticals"] = [];
  const squares: CardRect[] = [];
  const joined = joinSquares(p.segs);
  for (const s of p.segs) {
    if (joined.used.has(s)) continue;
    const dy = Math.abs(s.y1 - s.y0);
    const dx = Math.abs(s.x1 - s.x0);
    if (!s.stroked || s.width > DETECT.RULE_MAX_WIDTH) continue;
    if (dy <= DETECT.RULE_MAX_DY && dx > 0) {
      raw.push({
        x0: Math.min(s.x0, s.x1),
        x1: Math.max(s.x0, s.x1),
        y: (s.y0 + s.y1) / 2,
      });
    } else if (dx <= DETECT.RULE_MAX_DY && dy > 0) {
      verticals.push({
        x: (s.x0 + s.x1) / 2,
        y0: Math.min(s.y0, s.y1),
        y1: Math.max(s.y0, s.y1),
      });
    }
  }
  for (const r of [...p.rects, ...joined.rects]) {
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    if (isSquare(r)) {
      squares.push(r);
    } else if (r.filled && h <= DETECT.RULE_MAX_WIDTH && w > h) {
      raw.push({ x0: r.x0, x1: r.x1, y: (r.y0 + r.y1) / 2 });
    } else if (r.filled && w <= DETECT.RULE_MAX_WIDTH && h > w) {
      verticals.push({ x: (r.x0 + r.x1) / 2, y0: r.y0, y1: r.y1 });
    } else if (r.stroked && r.width <= DETECT.RULE_MAX_WIDTH) {
      // A larger outlined box: its edges are lines like any other.
      raw.push(
        { x0: r.x0, x1: r.x1, y: r.y0 },
        { x0: r.x0, x1: r.x1, y: r.y1 },
      );
      verticals.push(
        { x: r.x0, y0: r.y0, y1: r.y1 },
        { x: r.x1, y0: r.y0, y1: r.y1 },
      );
    }
  }
  // Merge collinear pieces.
  raw.sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const rules: Line[] = [];
  for (const l of raw) {
    const hit = rules.find(
      (m) =>
        Math.abs(m.y - l.y) <= DETECT.RULE_MAX_DY &&
        l.x0 <= m.x1 + DETECT.RULE_MERGE_GAP &&
        l.x1 >= m.x0 - DETECT.RULE_MERGE_GAP,
    );
    if (hit) {
      hit.x0 = Math.min(hit.x0, l.x0);
      hit.x1 = Math.max(hit.x1, l.x1);
    } else rules.push({ ...l });
  }
  return { rules, verticals, squares };
}

/**
 * The lines on a page that the band rule compares across pages: its rules of
 * candidate length and its underscore runs, as level segments. Rules only, so
 * the memory kept per page is bounded by the walker's primitive cap.
 */
export function bandLines(p: CardPage): CardSeg[] {
  const out: CardSeg[] = [];
  const seg = (x0: number, x1: number, y: number): CardSeg => ({
    x0,
    y0: y,
    x1,
    y1: y,
    width: 0,
    stroked: true,
    filled: false,
    lum: 0,
  });
  for (const r of readLines(p).rules)
    if (r.x1 - r.x0 >= DETECT.RULE_MIN_LEN) out.push(seg(r.x0, r.x1, r.y));
  p.text.forEach((t, i) => {
    for (const pc of pieces(t, i))
      if (pc.kind === "run" && t.upright) out.push(seg(pc.x0, pc.x1, t.y));
  });
  return out;
}

/* ------------------------------------------------------------------ *
 *  Candidates
 * ------------------------------------------------------------------ */

interface Edges {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Candidate {
  rule: DetectionRuleId;
  type: "text" | "checkbox";
  box: Edges;
  /** The line a text field sits on (a rule, or a run's baseline). */
  line: Line | null;
  square: CardRect | null;
  label: string | null;
  /** "none": no label candidate; "rotated": only text that is not upright. */
  labelState: "found" | "none" | "rotated";
  /** The rule had a label to its LEFT (the divider rule asks this). */
  leftLabel: boolean;
  /** The run's own piece, which may not block its own field. */
  ownPiece: Piece | null;
  order: number;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

function textHeight(
  size: number,
  h: { ems: number; min: number; max: number },
): number {
  return clamp(h.ems * size, h.min, h.max);
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

interface LabelHit {
  text: CardText;
  str: string;
}

/** Text items to the left of x, ending within `gap`, baseline in [lo, hi]. */
function leftOf(
  text: readonly CardText[],
  x: number,
  gap: number,
  lo: number,
  hi: (t: CardText) => number,
): LabelHit[] {
  const hits: { hit: LabelHit; right: number }[] = [];
  for (const t of text) {
    const right = t.x + Math.max(0, t.width);
    if (right > x + 1 || x - right > gap) continue;
    if (t.y < lo || t.y > hi(t)) continue;
    const str = cleanLabel(t.str);
    if (!str) continue;
    hits.push({ hit: { text: t, str }, right });
  }
  hits.sort((a, b) => b.right - a.right);
  return hits.map((h) => h.hit);
}

function pickLabel(hits: LabelHit[]): {
  label: string | null;
  state: Candidate["labelState"];
} {
  const up = hits.find((h) => h.text.upright);
  if (up) return { label: up.str, state: "found" };
  if (hits.length > 0) return { label: null, state: "rotated" };
  return { label: null, state: "none" };
}

/** Where a line's label may sit: baselines in [y - 2, y + 0.6 x size]. */
function labelBand(r: Line): { lo: number; hi: (t: CardText) => number } {
  return {
    lo: r.y - DETECT.LABEL_BELOW_RULE,
    hi: (t) => r.y + DETECT.LABEL_ABOVE_RULE_EMS * t.size,
  };
}

/**
 * The labels lines take as members of a LABEL COLUMN, by line. A form that
 * sets its labels flush left and starts every line at one tab stop leaves
 * a short label ("City:") far from its line while a long one ("Date of
 * birth:") sits close, and {@link DETECT.LABEL_LEFT_GAP_RULE} alone read
 * the short ones as unlabelled (review round 2, finding 6; the owner's
 * decision). A lone line keeps that gap.
 *
 * A line of candidate length is a ROW when the nearest text to its left on
 * its label band, ending within {@link DETECT.LABEL_COLUMN_GAP_MAX}, is
 * upright, and nothing else lies between that text and the line: no other
 * text on the band, no level rule on the band, no plumb line crossing it.
 * A COLUMN is {@link DETECT.LABEL_COLUMN_MIN} or more rows whose lines'
 * left ends, and whose labels' left edges, each lie within
 * {@link DETECT.GRID_ROW_EPS} of one row's (the idiom of `rowTables`), at
 * least one of whose labels ends within LABEL_LEFT_GAP_RULE of its line:
 * the column is anchored by a label the lone-line rule already accepts.
 */
function labelColumns(p: CardPage, lines: PageLines): Map<Line, LabelHit> {
  const eps = DETECT.GRID_ROW_EPS;
  type Row = { line: Line; hit: LabelHit; gap: number };
  const rows: Row[] = [];
  for (const r of lines.rules) {
    if (r.x1 - r.x0 < DETECT.RULE_MIN_LEN) continue;
    const band = labelBand(r);
    const hit = leftOf(
      p.text,
      r.x0,
      DETECT.LABEL_COLUMN_GAP_MAX,
      band.lo,
      band.hi,
    )[0];
    if (!hit || !hit.text.upright) continue;
    const right = hit.text.x + Math.max(0, hit.text.width);
    const top = band.hi(hit.text);
    // Strictly between: the label (ending at `right`) and the line itself
    // (starting at r.x0) overlap this gap by nothing, so neither blocks.
    const across = (x0: number, x1: number) => overlap(x0, x1, right, r.x0) > 0;
    const textBetween = p.text.some(
      (t) =>
        t.str.trim() !== "" &&
        t.y >= band.lo &&
        t.y <= band.hi(t) &&
        across(t.x, t.x + Math.max(0, t.width)),
    );
    const ruleBetween = lines.rules.some(
      (o) => o.y >= band.lo && o.y <= top && across(o.x0, o.x1),
    );
    const plumbBetween = lines.verticals.some(
      (v) => v.x > right && v.x < r.x0 && v.y1 >= band.lo && v.y0 <= top,
    );
    if (textBetween || ruleBetween || plumbBetween) continue;
    rows.push({ line: r, hit, gap: r.x0 - right });
  }
  const out = new Map<Line, LabelHit>();
  for (const seed of rows) {
    const column = rows.filter(
      (o) =>
        Math.abs(o.line.x0 - seed.line.x0) <= eps &&
        Math.abs(o.hit.text.x - seed.hit.text.x) <= eps,
    );
    if (
      column.length >= DETECT.LABEL_COLUMN_MIN &&
      column.some((o) => o.gap <= DETECT.LABEL_LEFT_GAP_RULE)
    )
      for (const o of column) out.set(o.line, o.hit);
  }
  return out;
}

function ruleCandidates(p: CardPage, lines: PageLines): Candidate[] {
  const out: Candidate[] = [];
  const column = labelColumns(p, lines);
  for (const r of lines.rules) {
    const len = r.x1 - r.x0;
    if (len < DETECT.RULE_MIN_LEN) continue;
    const band = labelBand(r);
    const left = leftOf(
      p.text,
      r.x0,
      DETECT.LABEL_LEFT_GAP_RULE,
      band.lo,
      band.hi,
    );
    let pick = pickLabel(left);
    let size = left.find((h) => h.text.upright)?.text.size;
    // A line in a label column takes its column's label from farther away.
    const inColumn = pick.state === "found" ? undefined : column.get(r);
    if (inColumn) {
      pick = { label: inColumn.str, state: "found" };
      size = inColumn.text.size;
    }
    const leftLabel = pick.state === "found";
    if (pick.state !== "found") {
      const captions: LabelHit[] = [];
      for (const t of p.text) {
        const top = t.y + DETECT.TEXT_ASCENT_EMS * t.size;
        const below = r.y - top;
        if (below < DETECT.CAPTION_MIN || below > DETECT.CAPTION_MAX) continue;
        const span = r.x0 + DETECT.CAPTION_SPAN * len;
        if (overlap(t.x, t.x + Math.max(0, t.width), r.x0, span) <= 0) continue;
        const str = cleanLabel(t.str);
        if (str) captions.push({ text: t, str });
      }
      const cap = pickLabel(captions);
      if (cap.state === "found") {
        pick = cap;
        size = captions.find((h) => h.text.upright)?.text.size;
      } else if (pick.state === "none") pick = cap;
    }
    const h = textHeight(size ?? DETECT.DEFAULT_SIZE, DETECT.TEXT_H_RULE);
    const bottom = r.y + DETECT.RULE_BOTTOM_GAP;
    out.push({
      rule: "labelled-rule",
      type: "text",
      box: {
        x0: r.x0 + DETECT.FIELD_INSET,
        x1: r.x1 - DETECT.FIELD_INSET,
        y0: bottom,
        y1: bottom + h,
      },
      line: r,
      square: null,
      label: pick.label,
      labelState: pick.state,
      leftLabel,
      ownPiece: null,
      order: 0,
    });
  }
  return out;
}

function runCandidates(
  p: CardPage,
  all: Piece[],
): { cands: Candidate[]; short: Edges[] } {
  const cands: Candidate[] = [];
  const short: Edges[] = [];
  // Each item's pieces, in order, in one pass: filtering `all` once per item
  // was quadratic in the page's text items, which nothing caps.
  const byItem = new Map<number, Piece[]>();
  for (const pc of all) {
    const list = byItem.get(pc.item);
    if (list) list.push(pc);
    else byItem.set(pc.item, [pc]);
  }
  p.text.forEach((t, item) => {
    if (!t.upright) return;
    const mine = byItem.get(item) ?? [];
    mine.forEach((pc, k) => {
      if (pc.kind !== "run") return;
      const x0 = pc.x0 + DETECT.FIELD_INSET;
      const x1 = pc.x1 - DETECT.FIELD_INSET;
      const bottom = t.y - DETECT.RUN_BOTTOM_EMS * t.size;
      const box = {
        x0,
        x1,
        y0: bottom,
        y1: bottom + textHeight(t.size, DETECT.TEXT_H_RUN),
      };
      if (x1 - x0 < DETECT.MIN_FIELD_W) {
        short.push(box);
        return;
      }
      // The words before it in the same item, back to the previous run.
      const prevRun = mine
        .slice(0, k)
        .reverse()
        .find((q) => q.kind === "run");
      const chars = Array.from(t.str);
      let label = cleanLabel(
        chars.slice(prevRun ? prevRun.to : 0, pc.from).join(""),
      );
      let state: Candidate["labelState"] = label ? "found" : "none";
      if (!label && !prevRun) {
        const hits = leftOf(
          p.text.filter((o) => o !== t),
          pc.x0,
          DETECT.LABEL_LEFT_GAP,
          t.y - DETECT.RUN_BASELINE_EMS * t.size,
          () => t.y + DETECT.RUN_BASELINE_EMS * t.size,
        );
        const pick = pickLabel(hits);
        label = pick.label;
        state = pick.state;
      }
      cands.push({
        rule: "underscore-run",
        type: "text",
        box,
        line: { x0: pc.x0, x1: pc.x1, y: t.y },
        square: null,
        label,
        labelState: state,
        leftLabel: state === "found",
        ownPiece: pc,
        order: 0,
      });
    });
  });
  return { cands, short };
}

function squareCandidates(p: CardPage, lines: PageLines): Candidate[] {
  return lines.squares.map((sq) => {
    const right: LabelHit[] = [];
    for (const t of p.text) {
      const gap = t.x - sq.x1;
      if (gap < -1 || gap > DETECT.LABEL_LEFT_GAP) continue;
      if (t.y < sq.y0 - DETECT.RUN_BASELINE_EMS * t.size || t.y > sq.y1)
        continue;
      const str = cleanLabel(t.str);
      if (str) right.push({ text: t, str });
    }
    right.sort((a, b) => a.text.x - b.text.x);
    let pick = pickLabel(right);
    if (pick.state !== "found") {
      const left = leftOf(
        p.text,
        sq.x0,
        DETECT.LABEL_LEFT_GAP,
        sq.y0 - DETECT.RUN_BASELINE_EMS * 12,
        () => sq.y1,
      );
      const l = pickLabel(left);
      if (l.state === "found" || pick.state === "none") pick = l;
    }
    const side =
      Math.min(sq.x1 - sq.x0, sq.y1 - sq.y0) - 2 * DETECT.SQUARE_INSET;
    const x0 = sq.x0 + DETECT.SQUARE_INSET;
    const y0 = sq.y0 + DETECT.SQUARE_INSET;
    return {
      rule: "square-checkbox" as const,
      type: "checkbox" as const,
      box: { x0, y0, x1: x0 + side, y1: y0 + side },
      line: null,
      square: sq,
      label: pick.label,
      labelState: pick.state,
      leftLabel: false,
      ownPiece: null,
      order: 0,
    };
  });
}

/* ------------------------------------------------------------------ *
 *  Exclusions
 * ------------------------------------------------------------------ */

function inBand(y: number, height: number): boolean {
  return y < DETECT.BAND_EDGE * height || y > (1 - DETECT.BAND_EDGE) * height;
}

/** Band-rule cells: BAND_REPEAT_EPS wide, so a repeat is in a neighbour. */
const bandCell = (y: number, x0: number) =>
  `${Math.round(y / DETECT.BAND_REPEAT_EPS)}|${Math.round(x0 / DETECT.BAND_REPEAT_EPS)}`;

/** Each page's band lines by cell, built once per list (the reader hands the same list for every page it compares). */
const BAND_INDEX = new WeakMap<readonly CardSeg[], Map<string, CardSeg[]>>();

function bandIndex(segs: readonly CardSeg[]): Map<string, CardSeg[]> {
  let index = BAND_INDEX.get(segs);
  if (index) return index;
  index = new Map();
  for (const s of segs) {
    const k = bandCell((s.y0 + s.y1) / 2, Math.min(s.x0, s.x1));
    const list = index.get(k);
    if (list) list.push(s);
    else index.set(k, [s]);
  }
  BAND_INDEX.set(segs, index);
  return index;
}

/**
 * On how many pages this line appears, itself included. Each other page's
 * lines are looked up by cell: scanning every list for every line cost
 * pages^2 x lines^2 for a run (24 s for 50 pages of 2,000 band lines).
 */
function repeatedOn(
  line: Line,
  others: readonly CardSeg[][] | undefined,
): number {
  if (!others) return 1;
  const eps = DETECT.BAND_REPEAT_EPS;
  const yc = Math.round(line.y / eps);
  const xc = Math.round(line.x0 / eps);
  const cells: string[] = [];
  for (const dy of [-1, 0, 1])
    for (const dx of [-1, 0, 1]) cells.push(`${yc + dy}|${xc + dx}`);
  let pages = 1;
  for (const segs of others) {
    const index = bandIndex(segs);
    const hit = cells.some((k) =>
      (index.get(k) ?? []).some(
        (s) =>
          Math.abs(Math.min(s.x0, s.x1) - line.x0) <= eps &&
          Math.abs(Math.max(s.x0, s.x1) - line.x1) <= eps &&
          Math.abs((s.y0 + s.y1) / 2 - line.y) <= eps,
      ),
    );
    if (hit) pages++;
  }
  return pages;
}

function gridTouches(line: Line, verticals: PageLines["verticals"]): boolean {
  const eps = DETECT.GRID_TOUCH_EPS;
  const touching = verticals.filter(
    (v) =>
      v.x >= line.x0 - eps &&
      v.x <= line.x1 + eps &&
      line.y >= v.y0 - eps &&
      line.y <= v.y1 + eps,
  );
  const atEnd = (x: number) =>
    touching.filter((v) => Math.abs(v.x - x) <= eps).length;
  return (
    touching.length >= DETECT.GRID_TOUCHES ||
    atEnd(line.x0) >= DETECT.GRID_END_TOUCHES ||
    atEnd(line.x1) >= DETECT.GRID_END_TOUCHES
  );
}

/**
 * The rules of tables ruled in rows only: no plumb line for
 * {@link gridTouches} to find, so the rows themselves are the sign. A stack
 * of {@link DETECT.GRID_ROWS_MIN} or more candidate rules whose two ends line
 * up, at an even pitch, where at least one row (the space between two of
 * them) holds text and EVERY row that holds text has two or more columns: a
 * table repeats its columns row after row (a blank table has its header).
 * Stacked lines with one caption each (a form's name / street / city) are
 * left alone, and so is an address block whose one City / State / ZIP row
 * has three captions: one such row once made the whole stack a table.
 *
 * A rule with a label to its LEFT is a field's line whatever its neighbours
 * (`classifyPage` asks this, not this function): a rows-only table's rules
 * span its first column, so its row text sits above and below each rule,
 * never to its left. Without that, one "DD MM YYYY" hint under one line of
 * a labelled stack made the whole stack a table.
 */
function rowTables(rules: readonly Line[], all: readonly Piece[]): Set<Line> {
  const eps = DETECT.GRID_ROW_EPS;
  const out = new Set<Line>();
  const long = rules.filter((r) => r.x1 - r.x0 >= DETECT.RULE_MIN_LEN);
  const seen = new Set<Line>();
  const words = all.filter((pc) => pc.kind === "text");
  const columns = (lo: Line, hi: Line, x0: number, x1: number) => {
    const inBand = words
      .filter(
        (pc) =>
          pc.baseline > lo.y &&
          pc.baseline < hi.y &&
          pc.x0 >= x0 - 1 &&
          pc.x1 <= x1 + 1,
      )
      .sort((a, b) => a.x0 - b.x0);
    let n = 0;
    let right = -Infinity;
    for (const pc of inBand) {
      if (pc.x0 - right >= DETECT.GRID_COLUMN_GAP) n++;
      right = Math.max(right, pc.x1);
    }
    return n;
  };
  for (const seed of long) {
    if (seen.has(seed)) continue;
    const stack = long
      .filter(
        (r) =>
          !seen.has(r) &&
          Math.abs(r.x0 - seed.x0) <= eps &&
          Math.abs(r.x1 - seed.x1) <= eps,
      )
      .sort((a, b) => a.y - b.y);
    stack.forEach((r) => seen.add(r));
    // Runs of even pitch; a break starts the next run at the rule before it.
    let from = 0;
    for (let k = 2; k <= stack.length; k++) {
      const even =
        k < stack.length &&
        Math.abs(
          stack[k]!.y - stack[k - 1]!.y - (stack[from + 1]!.y - stack[from]!.y),
        ) <= DETECT.GRID_PITCH_EPS;
      if (even) continue;
      const runOf = stack.slice(from, k);
      if (runOf.length >= DETECT.GRID_ROWS_MIN) {
        // The columns of each row (between two rules) that holds text.
        const filled = runOf
          .slice(1)
          .map((hi, i) => columns(runOf[i]!, hi, seed.x0, seed.x1))
          .filter((n) => n > 0);
        if (filled.length > 0 && filled.every((n) => n >= 2))
          runOf.forEach((r) => out.add(r));
      }
      from = k - 1;
    }
  }
  return out;
}

/**
 * A line with no label to its left under a letter's complimentary close
 * ("Yours sincerely,"): the signature line of a sign-off, whose caption is
 * the signer's printed name, not a field's label. The close is upright text
 * matching {@link DETECT.SIGNOFF_RE}, up to {@link DETECT.SIGNOFF_ABOVE} pt
 * above the line, and over it or over where its label would be.
 *
 * Only the FIRST line under the close is its signature line: no other of
 * `lines` (the page's rules of candidate length and its underscore runs)
 * lies between the close and this line across its width. The Print name and
 * Date lines of a sign-off block are fields; every caption-only line within
 * reach once read as a signature.
 *
 * The line may be drawn or typed: an underscore run with no label of its own
 * under a close is the signature line too (only drawn lines were once
 * asked, so a typed one was proposed as a field named after nothing).
 */
function underSignOff(
  p: CardPage,
  c: Candidate,
  lines: readonly Line[],
): boolean {
  const line = c.line;
  if (!line || c.leftLabel) return false;
  return p.text.some(
    (t) =>
      t.upright &&
      t.y > line.y &&
      t.y - line.y <= DETECT.SIGNOFF_ABOVE &&
      overlap(
        t.x,
        t.x + Math.max(0, t.width),
        line.x0 - DETECT.LABEL_LEFT_GAP_RULE,
        line.x1,
      ) > 0 &&
      DETECT.SIGNOFF_RE.test(t.str) &&
      !lines.some(
        (r) =>
          r !== line &&
          r.y > line.y &&
          r.y < t.y &&
          overlap(r.x0, r.x1, line.x0, line.x1) > 0,
      ),
  );
}

/**
 * Squares in a row of {@link DETECT.COMB_MIN} or more equal, adjoining ones.
 * The next square in a row is looked up by its lower-left corner (cells
 * COMB_EPS wide, so it is in a neighbour of the last one's lower-right):
 * scanning the whole list for it made a page of graph-paper cells quadratic.
 */
function combSquares(squares: CardRect[]): Set<CardRect> {
  const eps = DETECT.COMB_EPS;
  const comb = new Set<CardRect>();
  const sorted = [...squares].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const rank = new Map(sorted.map((s, i) => [s, i]));
  const cell = (x: number, y: number) =>
    `${Math.round(x / eps)}|${Math.round(y / eps)}`;
  const byCorner = new Map<string, CardRect[]>();
  for (const s of sorted) {
    const k = cell(s.x0, s.y0);
    const list = byCorner.get(k);
    if (list) list.push(s);
    else byCorner.set(k, [s]);
  }
  const used = new Set<CardRect>();
  for (const start of sorted) {
    if (used.has(start)) continue;
    const row = [start];
    const inRow = new Set(row);
    let last = start;
    for (;;) {
      // The first in sorted order, as a scan of `sorted` would find it.
      let next: CardRect | undefined;
      const cx = Math.round(last.x1 / eps);
      const cy = Math.round(last.y0 / eps);
      for (const dx of [-1, 0, 1])
        for (const dy of [-1, 0, 1])
          for (const s of byCorner.get(`${cx + dx}|${cy + dy}`) ?? [])
            if (
              !inRow.has(s) &&
              Math.abs(s.y0 - last.y0) <= eps &&
              Math.abs(s.y1 - last.y1) <= eps &&
              Math.abs(s.x1 - s.x0 - (last.x1 - last.x0)) <= eps &&
              Math.abs(s.x0 - last.x1) <= eps &&
              (!next || rank.get(s)! < rank.get(next)!)
            )
              next = s;
      if (!next) break;
      row.push(next);
      inRow.add(next);
      last = next;
    }
    row.forEach((s) => used.add(s));
    if (row.length >= DETECT.COMB_MIN) row.forEach((s) => comb.add(s));
  }
  return comb;
}

function area(b: Edges): number {
  return Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
}

function edgesOf(b: Box): Edges {
  return { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height };
}

function boxOf(e: Edges): Box {
  return { x: e.x0, y: e.y0, width: e.x1 - e.x0, height: e.y1 - e.y0 };
}

/** IoU above the threshold, or either box's centre inside the other. */
export function overlapsExisting(a: Edges, b: Edges): boolean {
  const inter =
    overlap(a.x0, a.x1, b.x0, b.x1) * overlap(a.y0, a.y1, b.y0, b.y1);
  const union = area(a) + area(b) - inter;
  if (union > 0 && inter / union > DETECT.IOU_EXISTING) return true;
  const inside = (o: Edges, c: Edges) => {
    const cx = (c.x0 + c.x1) / 2;
    const cy = (c.y0 + c.y1) / 2;
    return cx >= o.x0 && cx <= o.x1 && cy >= o.y0 && cy <= o.y1;
  };
  return inside(a, b) || inside(b, a);
}

/**
 * The field's box with its top lowered under any text above it, and whether
 * text sits across its bottom edge. Text "above" is text whose descent clears
 * the bottom; text whose descent hangs below the bottom while its ascent
 * reaches above it sits on the field's own line.
 */
function clearBox(
  c: Candidate,
  all: readonly Piece[],
): { box: Edges; overlapsText: boolean } {
  const box = { ...c.box };
  let overlapsText = false;
  for (const pc of all) {
    if (pc === c.ownPiece) continue;
    if (overlap(pc.x0, pc.x1, box.x0, box.x1) <= 0.5) continue;
    const lower = pc.baseline - DETECT.TEXT_DESCENT_EMS * pc.size;
    const upper = pc.baseline + DETECT.TEXT_ASCENT_EMS * pc.size;
    if (lower >= box.y0) {
      if (pc.baseline < c.box.y1 + DETECT.CLEARANCE_GAP)
        box.y1 = Math.min(box.y1, pc.baseline - DETECT.CLEARANCE_GAP);
    } else if (upper > box.y0 && pc.kind === "text") {
      overlapsText = true;
    }
  }
  return { box, overlapsText };
}

function roundEdges(e: Edges): Edges {
  const x0 = Math.round(e.x0);
  const y0 = Math.round(e.y0);
  return { x0, y0, x1: Math.round(e.x1), y1: Math.round(e.y1) };
}

/**
 * Classify one page. Per candidate, the deciding rule is the first of:
 *
 *  1. the shape itself (`short-run`)
 *  2. the label search
 *  3. `signature`
 *  4. `underline`, `full-width-divider`, `page-band`, `table-grid`, `comb`,
 *     `bullet`, then `unlabelled` / `rotated-label`
 *  5. `overlaps-text`
 *  6. `existing-field`, `existing-draft`
 *  7. `duplicate`
 *  8. `no-clearance`
 *  9. `off-page` (on the box rounded to whole points, as the engine sees it)
 *
 * A line with no label is `unlabelled`. A square with no label is kept only
 * beside two or more labelled squares of its size in the same row or column.
 * `invalid` is decided later, by {@link filterValid}.
 */
export function classifyPage(
  p: CardPage,
  o: ClassifyOptions = {},
): { proposals: FieldProposal[]; excluded: Excluded[]; counts: DetectCounts } {
  const on = (id: ExclusionRuleId) => !o.disable?.has(id);
  const counts = emptyCounts();
  const excluded: Excluded[] = [];
  const exclude = (rule: ExclusionRuleId, box: Edges) => {
    excluded.push({ rule, page: p.page, box: boxOf(box) });
    if (rule === "signature") counts.signatureLines++;
    if (rule === "existing-field") counts.alreadyFields++;
    if (rule === "rotated-label") counts.rotatedText++;
  };

  const all = p.text.flatMap((t, i) => pieces(t, i));
  const lines = readLines(p);
  const runs = runCandidates(p, all);
  const cands = [
    ...ruleCandidates(p, lines),
    ...runs.cands,
    ...squareCandidates(p, lines),
  ];
  cands.forEach((c, i) => (c.order = i));
  counts.candidates = cands.length + runs.short.length;

  // 1. The shape: runs too short to hold a field.
  for (const box of runs.short)
    if (on("short-run")) exclude("short-run", box);
    else
      cands.push({
        rule: "underscore-run",
        type: "text",
        box,
        line: { x0: box.x0, x1: box.x1, y: box.y0 },
        square: null,
        label: null,
        labelState: "none",
        leftLabel: false,
        ownPiece: null,
        order: cands.length,
      });

  const comb = combSquares(lines.squares);
  const rowTable = rowTables(lines.rules, all);
  const signOffLines = [
    ...lines.rules.filter((r) => r.x1 - r.x0 >= DETECT.RULE_MIN_LEN),
    ...runs.cands.flatMap((c) => (c.line ? [c.line] : [])),
  ];
  const labelledSquares = cands.filter(
    (c) => c.square && c.labelState === "found",
  );

  type Survivor = { c: Candidate; box: Edges };
  const survivors: Survivor[] = [];
  for (const c of cands) {
    // 3. Signature lines belong to Edit PDF's signature field.
    if (
      on("signature") &&
      ((c.label && DETECT.SIGNATURE_RE.test(c.label)) ||
        underSignOff(p, c, signOffLines))
    ) {
      exclude("signature", c.box);
      continue;
    }
    // 4. Shapes that are not fields.
    if (c.line && c.rule === "labelled-rule") {
      const line = c.line;
      const len = line.x1 - line.x0;
      if (on("underline")) {
        // Upright words 0..3 pt over the line, along half of it together.
        const along = all
          .filter(
            (pc) =>
              pc.kind === "text" &&
              p.text[pc.item]!.upright &&
              pc.baseline - line.y >= 0 &&
              pc.baseline - line.y <= DETECT.UNDERLINE_MAX_GAP,
          )
          .reduce((s, pc) => s + overlap(pc.x0, pc.x1, line.x0, line.x1), 0);
        if (along >= DETECT.UNDERLINE_SPAN * len - 1e-6) {
          exclude("underline", c.box);
          continue;
        }
      }
      if (
        on("full-width-divider") &&
        len >= DETECT.DIVIDER_SPAN * p.width &&
        !c.leftLabel
      ) {
        exclude("full-width-divider", c.box);
        continue;
      }
    }
    if (c.line && on("page-band") && inBand(c.line.y, p.height)) {
      const len = c.line.x1 - c.line.x0;
      if (
        len > DETECT.BAND_SPAN * p.width ||
        repeatedOn(c.line, o.repeatsAcrossPages) >= DETECT.BAND_REPEAT_PAGES
      ) {
        exclude("page-band", c.box);
        continue;
      }
    }
    if (
      c.line &&
      c.rule === "labelled-rule" &&
      on("table-grid") &&
      (gridTouches(c.line, lines.verticals) ||
        (rowTable.has(c.line) && !c.leftLabel))
    ) {
      exclude("table-grid", c.box);
      continue;
    }
    if (c.square) {
      if (on("comb") && comb.has(c.square)) {
        exclude("comb", c.box);
        continue;
      }
      if (on("bullet") && c.square.filled) {
        exclude("bullet", c.box);
        continue;
      }
    }
    if (c.labelState === "rotated" && c.rule !== "underscore-run") {
      if (on("rotated-label")) {
        exclude("rotated-label", c.box);
        continue;
      }
    } else if (c.labelState === "none" && c.rule !== "underscore-run") {
      const sq = c.square;
      const grouped =
        sq !== null &&
        labelledSquares.filter(
          (l) =>
            l.square !== sq &&
            Math.abs(l.square!.x1 - l.square!.x0 - (sq.x1 - sq.x0)) <=
              DETECT.COMB_EPS &&
            (Math.abs(l.square!.x0 - sq.x0) <= DETECT.COMB_EPS ||
              Math.abs(l.square!.y0 - sq.y0) <= DETECT.COMB_EPS),
        ).length >= 2;
      if (!grouped && on("unlabelled")) {
        exclude("unlabelled", c.box);
        continue;
      }
    }
    // 5. Text on the field's own line.
    const cleared = clearBox(c, all);
    if (on("overlaps-text") && cleared.overlapsText) {
      exclude("overlaps-text", c.box);
      continue;
    }
    // 6. Already a field, or already a card.
    if (
      on("existing-field") &&
      p.widgets.some((w) => overlapsExisting(c.box, edgesOf(w)))
    ) {
      exclude("existing-field", c.box);
      continue;
    }
    if (
      on("existing-draft") &&
      (o.drafts ?? []).some(
        (d) => d.page === p.page && overlapsExisting(c.box, edgesOf(d)),
      )
    ) {
      exclude("existing-draft", c.box);
      continue;
    }
    survivors.push({ c, box: cleared.box });
  }

  // 7. Duplicates: keep a line's geometry, with a run's label when it has one.
  survivors.sort((a, b) => a.c.box.y0 - b.c.box.y0 || a.c.order - b.c.order);
  const gone = new Set<Survivor>();
  if (on("duplicate")) {
    for (let i = 0; i < survivors.length; i++) {
      const a = survivors[i]!;
      if (gone.has(a)) continue;
      for (let j = i + 1; j < survivors.length; j++) {
        const b = survivors[j]!;
        if (gone.has(b) || a.c.type !== b.c.type) continue;
        if (Math.abs(a.c.box.y0 - b.c.box.y0) > DETECT.DUP_DY) continue;
        const ov = overlap(a.c.box.x0, a.c.box.x1, b.c.box.x0, b.c.box.x1);
        const shorter = Math.min(
          a.c.box.x1 - a.c.box.x0,
          b.c.box.x1 - b.c.box.x0,
        );
        if (shorter <= 0 || ov < DETECT.DUP_OVERLAP * shorter) continue;
        let keep = a;
        let drop = b;
        if (b.c.rule === "labelled-rule" && a.c.rule === "underscore-run") {
          keep = b;
          drop = a;
        }
        if (drop.c.rule === "underscore-run" && drop.c.label)
          keep.c.label = drop.c.label;
        exclude("duplicate", drop.c.box);
        gone.add(drop);
        if (drop === a) break;
      }
    }
  }

  const proposals: FieldProposal[] = [];
  for (const s of survivors) {
    if (gone.has(s)) continue;
    // 8. Room to type.
    if (
      on("no-clearance") &&
      s.c.type === "text" &&
      s.box.y1 - s.box.y0 < DETECT.MIN_FIELD_H
    ) {
      exclude("no-clearance", s.c.box);
      continue;
    }
    // 9-10. Whole points, inside the page as the engine checks it.
    const r = roundEdges(s.box);
    const fits =
      r.x0 >= 0 &&
      r.y0 >= 0 &&
      r.x1 <= p.width + DETECT.BOUND_EPS &&
      r.y1 <= p.height + DETECT.BOUND_EPS &&
      r.x1 > r.x0 &&
      r.y1 > r.y0;
    if (on("off-page") && !fits) {
      exclude("off-page", s.c.box);
      continue;
    }
    proposals.push({
      key: `${p.page}:${s.c.rule}:${r.x0}:${r.y0}`,
      page: p.page,
      x: r.x0,
      y: r.y0,
      width: r.x1 - r.x0,
      height: r.y1 - r.y0,
      type: s.c.type,
      label: s.c.label,
      rule: s.c.rule,
    });
  }
  proposals.sort((a, b) => b.y - a.y || a.x - b.x);
  if (proposals.length > DETECT.CAPS.perPage) {
    counts.capped += proposals.length - DETECT.CAPS.perPage;
    proposals.length = DETECT.CAPS.perPage;
  }
  counts.proposals = proposals.length;
  return { proposals, excluded, counts };
}

/* ------------------------------------------------------------------ *
 *  Names, drafts, and the second bound
 * ------------------------------------------------------------------ */

const NAME_MAX = 40;

/**
 * A field name from a label: accents dropped (NFKD, combining marks
 * removed), lower case, anything else between letters and digits becomes
 * "_", at most 40 characters. Never contains "." (a period would make the
 * part before it a group: see groupClash in create-forms.ts), never starts
 * with a digit, and is unique against `taken`, counting a taken "a.b" as
 * taking "a". A label with nothing left falls back to text_N / checkbox_N.
 * Held by the nameFor tests in form-detect.test.ts and the composed chain in
 * form-detect.pdfjs.test.ts.
 */
export function nameFor(
  label: string | null,
  type: "text" | "checkbox",
  taken: ReadonlySet<string>,
  n: number,
): string {
  let base = (label ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, NAME_MAX)
    .replace(/_+$/g, "");
  if (/^[0-9]/.test(base)) base = `field_${base}`.slice(0, NAME_MAX);
  if (!base) base = `${type}_${n}`;
  const clash = (name: string) => {
    for (const t of taken)
      if (t === name || t.startsWith(`${name}.`)) return true;
    return false;
  };
  if (!clash(base)) return base;
  for (let k = 2; ; k++) {
    const suffix = `_${k}`;
    const candidate = `${base.slice(0, NAME_MAX - suffix.length)}${suffix}`;
    if (!clash(candidate)) return candidate;
  }
}

/**
 * Proposals as the builder's field specs: named by {@link nameFor} against
 * `taken` (and each other), with the defaults a new card has (no default
 * value, single line, unchecked).
 */
export function proposalToDraftFields(
  proposals: readonly FieldProposal[],
  taken: Iterable<string> = [],
): (NewTextField | NewCheckBoxField)[] {
  const names = new Set(taken);
  const perType = { text: 0, checkbox: 0 };
  return proposals.map((p) => {
    perType[p.type]++;
    const name = nameFor(p.label, p.type, names, perType[p.type]);
    names.add(name);
    const at = {
      name,
      page: p.page,
      x: p.x,
      y: p.y,
      width: p.width,
      height: p.height,
    };
    return p.type === "text"
      ? { type: "text" as const, ...at, multiline: false }
      : { type: "checkbox" as const, ...at, checked: false };
  });
}

/**
 * Drop what the builder's own validation still refuses: the second,
 * independent bound on everything above. `validate` is the runner's
 * `validateFormFields` (bound to the PDF's page sizes and names); errors not
 * tied to one proposal (index -1) are ignored. Repeats until what is kept
 * passes, since dropping one can clear another's duplicate-name error.
 */
export function filterValid<T>(
  proposals: T[],
  validate: (all: T[]) => { index: number }[],
): { kept: T[]; invalid: number } {
  let kept = proposals.slice();
  for (let round = 0; round <= proposals.length; round++) {
    const bad = new Set(
      validate(kept)
        .map((e) => e.index)
        .filter((i) => i >= 0 && i < kept.length),
    );
    if (bad.size === 0) break;
    kept = kept.filter((_, i) => !bad.has(i));
  }
  return { kept, invalid: proposals.length - kept.length };
}
