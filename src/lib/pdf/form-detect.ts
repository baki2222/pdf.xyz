import type { NewCheckBoxField, NewTextField } from "./create-forms";
import type { Rect, Seg } from "./form-detect-paths";

/**
 * Create Forms field finder: the decisions. Given one page's straight lines,
 * small boxes and text (already read and placed by `./form-detect-read`),
 * propose where a fillable field might go, and say why each other shape was
 * passed over.
 *
 * LIMITS, in plain words. It looks at four shapes only: a run of
 * underscores typed in the text (labelled beside it, or, alone in a ruled
 * cell, by the cell to its left), a straight line with a label near it
 * (beside it, under it, at the top of the strip it closes, or on the
 * labelled line it continues), a small empty square (labelled beside it,
 * or by its row and the head of its column), and the empty right cells of
 * a two-column table whose left cells each hold one label line. It reads
 * only text that is
 * upright in the page's content and lines and boxes drawn in the PDF
 * itself, so it finds nothing on a scanned page (a picture of a form). It
 * PROPOSES and never writes: nothing here adds a field, and every proposal
 * is meant to be checked by a person. It leans towards missing a field
 * rather than proposing a wrong one, because a missed field costs one click
 * on Add field and a wrong one costs a review.
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
  { id: "table-cell", plain: "empty cells beside a label in a table" },
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
/** Characters by code point, so this source stays ASCII. */
const cp = (...points: number[]) => String.fromCodePoint(...points);

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
   * Was 3 until review round 5 fixes (finding 5): a two-row header
   * ("Vehicle reg:" / "Driver:") left its second line unlabelled.
   */
  LABEL_COLUMN_MIN: 2,
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
  /**
   * A CONTINUATION line (the 2nd and 3rd lines of "Address:"): a line with
   * no label up to this far under a line labelled from its left (or a
   * continuation itself), the nearest line above that overlaps it, ending
   * within GRID_ROW_EPS of where it ends and starting no more than
   * GRID_ROW_EPS right of where it starts, with no text between them and
   * no upright text on its own row to its left, takes that label.
   */
  CONTINUATION_BELOW: 28,
  /**
   * ... drawn at the labelled line's weight, within this (pt): a heavier
   * section separator under a form's last field is no continuation.
   */
  CONTINUATION_WEIGHT_EPS: 0.1,
  /**
   * A HEADING is no caption: text with text at least HEADING_SMALLER_BY pt
   * smaller starting at its x (within GRID_ROW_EPS) whose baseline is up to
   * HEADING_LEAD_EMS x its size under its own (the body under a heading),
   * that line itself with another no larger than it starting at its x
   * (within GRID_ROW_EPS) up to HEADING_LEAD_EMS x its size under it: a
   * body is two lines, one is a caption's hint (review round 4 fixes).
   * Equal sizes are a printed name over its role, which stays a caption.
   */
  HEADING_LEAD_EMS: 1.6,
  HEADING_SMALLER_BY: 0.5,
  /**
   * PROSE RULES (review round 4), read against the page's BODY size: the
   * size most of its upright characters are set in. "Smaller than the
   * body" is by at least HEADING_SMALLER_BY.
   *
   * A FOOTNOTE SEPARATOR: a rule starting at the left text margin (the
   * leftmost upright text, within GRID_ROW_EPS) and no longer than
   * FOOTNOTE_SPAN of the text column (leftmost to rightmost upright text),
   * over text smaller than the body that opens with a footnote marker
   * (FOOTNOTE_RE): that text is no caption.
   */
  FOOTNOTE_SPAN: 1 / 3,
  FOOTNOTE_RE: new RegExp(
    String.raw`^\s*(?:\d{1,3}(?!\d)|[*` +
      // dagger, double dagger, superscript 1 2 3 0, superscript 4 to 9
      cp(0x2020, 0x2021, 0xb9, 0xb2, 0xb3, 0x2070, 0x2074) +
      "-" +
      cp(0x2079) +
      "])",
    "u",
  ),
  /**
   * A TITLE RULE: a rule no longer than the upright text line over it
   * (within GRID_ROW_EPS) and centred on it (within GRID_ROW_EPS), that
   * line's baseline up to TITLE_ABOVE_EMS x its size over the rule and its
   * size at least TITLE_LARGER x the caption's: the caption is a byline.
   */
  TITLE_LARGER: 1.5,
  TITLE_ABOVE_EMS: 1.5,
  /**
   * A PULL QUOTE: exactly two rules of candidate length whose ends line up
   * (within GRID_ROW_EPS), the text between them upright, not smaller than
   * the body, and one sentence (ending as QUOTE_END_RE, of at least
   * QUOTE_MIN_WORDS words), with body text running GRID_COLUMN_GAP past
   * either end of the rules just under the lower one (in its caption
   * window) or just over the upper one (within CAPTION_MAX): the upper
   * rule takes no caption, and the lower none from that running text.
   */
  QUOTE_MIN_WORDS: 3,
  // A closing right single or double quotation mark may follow the stop.
  QUOTE_END_RE: new RegExp(`[.!?]["'${cp(0x2019, 0x201d)})]?$`, "u"),
  /**
   * A BOX CAPTION (review round 4 fixes): an outlined box's bottom edge,
   * with no left label, takes its one interior text when that text reaches
   * into the box's first CAPTION_SPAN and its top is -1 to CAPTION_MAX pt
   * under the box's top; or, in an empty box, the nearest upright text
   * whose descent is 0 to CAPTION_MAX pt over its top, reaching into the
   * same span. A NOTICE is never one: text ending as NOTICE_END_RE, of at
   * least NOTICE_MIN_WORDS words. Nor is an interior text without room to
   * write under it: from its descent to the box's bottom there is a
   * field's height for its size (TEXT_H_RULE), or at least MIN_FIELD_H
   * that is CAPTION_TOP_RATIO x the room over it (its ascent to the
   * box's top), the caption set in the top of a compact box.
   */
  NOTICE_END_RE: /[.!?]$/,
  NOTICE_MIN_WORDS: 4,
  CAPTION_TOP_RATIO: 2,
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
  /**
   * Band: the outer 8% of the page, and wider than 70% or repeated, or
   * labelled only by a caption with no labelled row-mate beside it (within
   * GRID_ROW_EPS of its row, not overlapping it).
   */
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
  /**
   * Comb (digit boxes): 2 or more equal squares edge to edge in a row. The
   * brief's 4 left a date's DD and MM pairs, a two-box "Age" and a three-box
   * "House no." as checkboxes (review round 3, finding 2; corpus N33).
   */
  COMB_MIN: 2,
  COMB_EPS: 1,
  /**
   * A checkbox GRID's column head: upright text over the column's top
   * square, its baseline up to this far above the square's top.
   */
  GRID_HEAD_ABOVE: 20,
  /**
   * A LABEL TABLE (a Word-exported "label | answer" table; the owner's
   * decision in review round 4): a ruled grid of exactly two columns and
   * at least CELL_ROWS_MIN rows, every left cell holding one upright label
   * line of at most CELL_LABEL_MAX characters (after `cleanLabel`) inside
   * it, every right cell empty. Each right cell becomes a field. The same
   * one-line left cell labels an underscore run typed alone in its cell.
   */
  CELL_ROWS_MIN: 2,
  CELL_LABEL_MAX: 40,
  /**
   * A label naming a signature line. "Initial" alone (or "Initial here")
   * is anchored, so "Initial deposit" stays a field (review round 4 fixes,
   * finding 25; corpus N43).
   */
  SIGNATURE_RE: /\b(sign(ature|ed)?|initials)\b|^\W*initial(\s+here)?\W*$/i,
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
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const LETTER = /\p{L}/u;
/** An item code ("A1", "12a"): one word of letters and digits, a digit in it. */
const ITEM_CODE = /^(?=.*\p{N})[\p{L}\p{N}]+$/u;

/**
 * Label text: underscores and trailing colons dropped, spaces collapsed.
 * The trailing colons, periods, dashes and spaces are trimmed one character
 * at a time from the end: an anchored `[...]+$` backtracked over every run
 * of them that did not end the string, which is quadratic in a long one.
 * A string with no letter or digit is no label: the "/" between a date's
 * box groups once named them (review round 3, finding 2).
 */
export function cleanLabel(s: string): string | null {
  const mid = s
    .replace(/[_\uFF3F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let end = mid.length;
  while (end > 0 && TRAILING.test(mid[end - 1]!)) end--;
  const out = mid.slice(0, end).trim();
  return LETTER_OR_DIGIT.test(out) ? out : null;
}

/* ------------------------------------------------------------------ *
 *  Lines
 * ------------------------------------------------------------------ */

interface Line {
  x0: number;
  x1: number;
  y: number;
  /**
   * The bottom edge of a larger outlined box, with the box's top, while it
   * is merged with nothing: it takes the box's caption (`ruleCandidates`).
   */
  boxBottom?: { top: number };
  /**
   * The stroke's weight (a filled bar's height), for `continuationLines`:
   * merged pieces keep the first piece's. Undefined for a run's baseline.
   */
  w?: number;
  /**
   * The top edge of a larger outlined box (or a line merged with one): text
   * under it is inside the box, never its caption (see `ruleCandidates`).
   */
  boxTop?: boolean;
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
        w: s.width,
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
      raw.push({ x0: r.x0, x1: r.x1, y: (r.y0 + r.y1) / 2, w: h });
    } else if (r.filled && w <= DETECT.RULE_MAX_WIDTH && h > w) {
      verticals.push({ x: (r.x0 + r.x1) / 2, y0: r.y0, y1: r.y1 });
    } else if (r.stroked && r.width <= DETECT.RULE_MAX_WIDTH) {
      // A larger outlined box: its edges are lines like any other, except
      // that its top edge takes no caption from inside the box.
      raw.push(
        { x0: r.x0, x1: r.x1, y: r.y0, w: r.width, boxBottom: { top: r.y1 } },
        { x0: r.x0, x1: r.x1, y: r.y1, w: r.width, boxTop: true },
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
  // Merged rules keep their first piece's y, so those with a finite y are
  // in y order: the first that a piece joins is found from a binary search
  // of the window it can join in, not by scanning every rule (a stack of
  // 20,000 lines was quadratic; review round 4 fixes, finding 18). A rule
  // with a y that is not finite joins nothing, as before. Should the sort
  // have left them out of order, every rule is scanned as before.
  const finite: Line[] = [];
  let ordered = true;
  const joins = (m: Line, l: Line) =>
    Math.abs(m.y - l.y) <= DETECT.RULE_MAX_DY &&
    l.x0 <= m.x1 + DETECT.RULE_MERGE_GAP &&
    l.x1 >= m.x0 - DETECT.RULE_MERGE_GAP;
  for (const l of raw) {
    let hit: Line | undefined;
    if (!ordered) hit = rules.find((m) => joins(m, l));
    else if (Number.isFinite(l.y))
      for (
        let i = from(finite, (m) => m.y, l.y - DETECT.RULE_MAX_DY - 1);
        i < finite.length && finite[i]!.y <= l.y + DETECT.RULE_MAX_DY + 1;
        i++
      )
        if (joins(finite[i]!, l)) {
          hit = finite[i]!;
          break;
        }
    if (hit) {
      hit.x0 = Math.min(hit.x0, l.x0);
      hit.x1 = Math.max(hit.x1, l.x1);
      if (l.boxTop) hit.boxTop = true;
      // Merged with anything, it is no one box's bottom any more.
      delete hit.boxBottom;
    } else {
      const m = { ...l };
      rules.push(m);
      if (Number.isFinite(m.y)) {
        const last = finite[finite.length - 1];
        if (last && m.y < last.y) ordered = false;
        finite.push(m);
      }
    }
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
  /** A square labelled by its checkbox grid ({@link gridLabels}): no comb. */
  gridCell?: boolean;
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
 * Items (text items, or text pieces) by baseline, for the per-line and
 * per-field searches (a line's left label, its caption, its label
 * column's row, the words along it, the text over a field): each reads
 * only the items whose baseline can satisfy its test, in their page
 * order, so every exact test, tie-break and sum is unchanged. Items whose
 * baseline or size is not finite are in every slice, as every scan once
 * met them. Scanning every item for every line or field was quadratic on
 * a stacked page (review round 4 fixes, finding 18).
 */
interface YIndex<T> {
  /** Finite baseline and size, sorted by baseline. */
  sorted: T[];
  /** The rest, met by every slice. */
  odd: T[];
  order: Map<T, number>;
  y: (v: T) => number;
  minSize: number;
  maxSize: number;
}
type TextIndex = YIndex<CardText>;

function yIndex<T>(
  xs: readonly T[],
  y: (v: T) => number,
  size: (v: T) => number,
): YIndex<T> {
  const order = new Map<T, number>();
  const odd: T[] = [];
  const fine: T[] = [];
  let minSize = Infinity;
  let maxSize = -Infinity;
  xs.forEach((v, i) => {
    order.set(v, i);
    if (!Number.isFinite(y(v)) || !Number.isFinite(size(v))) odd.push(v);
    else {
      fine.push(v);
      minSize = Math.min(minSize, size(v));
      maxSize = Math.max(maxSize, size(v));
    }
  });
  fine.sort((a, b) => y(a) - y(b));
  return { sorted: fine, odd, order, y, minSize, maxSize };
}

const textIndex = (text: readonly CardText[]): TextIndex =>
  yIndex(
    text,
    (t) => t.y,
    (t) => t.size,
  );

/** The items with a baseline in [lo, hi] (and the odd ones), page order. */
function ySlice<T>(ix: YIndex<T>, lo: number, hi: number): T[] {
  const out: T[] = [...ix.odd];
  for (let i = from(ix.sorted, ix.y, lo); i < ix.sorted.length; i++) {
    const v = ix.sorted[i]!;
    if (ix.y(v) > hi) break;
    out.push(v);
  }
  return out.sort((a, b) => ix.order.get(a)! - ix.order.get(b)!);
}
const textBand = ySlice<CardText>;

/**
 * A line's label-band slice ({@link labelBand}): baselines in [y - 2,
 * y + 0.6 x the largest size], 1 pt generous at each end.
 */
function bandText(ix: TextIndex, r: Line): CardText[] {
  return textBand(ix, r.y - DETECT.LABEL_BELOW_RULE - 1, bandTop(ix, r) + 1);
}

/** The highest baseline a line's label band can reach on this page. */
function bandTop(ix: TextIndex, r: Line): number {
  return r.y + DETECT.LABEL_ABOVE_RULE_EMS * Math.max(0, ix.maxSize);
}

/** The items with a finite `y`, sorted by it (for {@link from}). */
function byY<T>(xs: readonly T[], y: (v: T) => number): T[] {
  return xs.filter((v) => Number.isFinite(y(v))).sort((a, b) => y(a) - y(b));
}

/** The first index of y-sorted `xs` whose `y` is at least `lo`. */
function from<T>(xs: readonly T[], y: (v: T) => number, lo: number): number {
  let a = 0;
  let z = xs.length;
  while (a < z) {
    const m = (a + z) >> 1;
    if (y(xs[m]!) < lo) a = m + 1;
    else z = m;
  }
  return a;
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
function labelColumns(
  p: CardPage,
  lines: PageLines,
  ix: TextIndex,
): Map<Line, LabelHit> {
  const eps = DETECT.GRID_ROW_EPS;
  type Row = { line: Line; hit: LabelHit; gap: number };
  const rows: Row[] = [];
  // The blockers are looked up by baseline in y-sorted lists, each slice
  // held to the exact test: scanning all text and all rules for every line
  // added two quadratic terms (review round 4 fixes, finding 18).
  const texts = byY(
    p.text.filter((t) => t.str.trim() !== ""),
    (t) => t.y,
  );
  const ruleYs = byY(lines.rules, (r) => r.y);
  let maxSize = 0;
  for (const t of texts) if (t.size > maxSize) maxSize = t.size;
  for (const r of lines.rules) {
    if (r.x1 - r.x0 < DETECT.RULE_MIN_LEN) continue;
    const band = labelBand(r);
    const hit = leftOf(
      bandText(ix, r),
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
    let textBetween = false;
    const textTop = r.y + DETECT.LABEL_ABOVE_RULE_EMS * maxSize;
    // From the first baseline at the band's bottom (so none under it: the
    // list holds finite baselines only, sorted), each held to its own
    // band's top. A test of the bottom here repeated `from`, and deleting
    // it stayed green (review round 6 test honesty, closing mutant sweep:
    // round 3's M21).
    for (let i = from(texts, (t) => t.y, band.lo); i < texts.length; i++) {
      const t = texts[i]!;
      if (t.y > textTop) break;
      if (t.y <= band.hi(t) && across(t.x, t.x + Math.max(0, t.width))) {
        textBetween = true;
        break;
      }
    }
    let ruleBetween = false;
    for (let i = from(ruleYs, (o) => o.y, band.lo); i < ruleYs.length; i++) {
      const o = ruleYs[i]!;
      if (o.y > top) break;
      if (o.y >= band.lo && across(o.x0, o.x1)) {
        ruleBetween = true;
        break;
      }
    }
    const plumbBetween = lines.verticals.some(
      (v) => v.x > right && v.x < r.x0 && v.y1 >= band.lo && v.y0 <= top,
    );
    if (textBetween || ruleBetween || plumbBetween) continue;
    rows.push({ line: r, hit, gap: r.x0 - right });
  }
  // Rows with the same line start and label edge have the same column, so
  // each such group is asked once, and its neighbours are looked up in
  // cells GRID_ROW_EPS wide (filtering every row for every row was
  // quadratic in a long column; finding 18). A group already labelled is
  // not labelled again.
  type Group = { x0: number; tx: number; rows: Row[]; anchor: boolean };
  const groups = new Map<string, Group>();
  for (const o of rows) {
    const k = `${o.line.x0}|${o.hit.text.x}`;
    let g = groups.get(k);
    if (!g) {
      g = { x0: o.line.x0, tx: o.hit.text.x, rows: [], anchor: false };
      groups.set(k, g);
    }
    g.rows.push(o);
    if (o.gap <= DETECT.LABEL_LEFT_GAP_RULE) g.anchor = true;
  }
  const cell = (a: number, b: number) =>
    `${Math.floor(a / eps)}|${Math.floor(b / eps)}`;
  const cells = new Map<string, Group[]>();
  for (const g of groups.values()) {
    const k = cell(g.x0, g.tx);
    const list = cells.get(k);
    if (list) list.push(g);
    else cells.set(k, [g]);
  }
  const out = new Map<Line, LabelHit>();
  const done = new Set<Group>();
  for (const seed of groups.values()) {
    const column: Group[] = [];
    const cx = Math.floor(seed.x0 / eps);
    const ct = Math.floor(seed.tx / eps);
    for (const dx of [-1, 0, 1])
      for (const dt of [-1, 0, 1])
        for (const g of cells.get(`${cx + dx}|${ct + dt}`) ?? [])
          if (
            Math.abs(g.x0 - seed.x0) <= eps &&
            Math.abs(g.tx - seed.tx) <= eps
          )
            column.push(g);
    const n = column.reduce((s, g) => s + g.rows.length, 0);
    if (n >= DETECT.LABEL_COLUMN_MIN && column.some((g) => g.anchor))
      for (const g of column) {
        if (done.has(g)) continue;
        done.add(g);
        for (const o of g.rows) out.set(o.line, o.hit);
      }
  }
  return out;
}

/**
 * The page's test of whether a text item is a heading ({@link
 * DETECT.HEADING_LEAD_EMS}): a smaller body of two lines starts at its x
 * directly under it. A heading under a border-top rule was
 * that rule's caption, a field on plain prose (review round 3, finding 6;
 * corpus N36).
 */
function headingTest(
  text: readonly CardText[],
  prose: Prose | null,
): (t: CardText) => boolean {
  const eps = DETECT.GRID_ROW_EPS;
  // Upright text by x (cells GRID_ROW_EPS wide, so text within eps of an x
  // is in its cell or a neighbour), each cell sorted by baseline. Scanning
  // every item for every caption made a page of small text under rules
  // quadratic (review round 4 fixes, finding 10).
  const cells = new Map<number, CardText[]>();
  for (const u of text) {
    if (!u.upright || u.str.trim() === "") continue;
    if (!Number.isFinite(u.x) || !Number.isFinite(u.y)) continue;
    const k = Math.floor(u.x / eps);
    const list = cells.get(k);
    if (list) list.push(u);
    else cells.set(k, [u]);
  }
  for (const list of cells.values()) list.sort((a, b) => a.y - b.y);
  // Whether upright text no larger than `size` starts at `top`'s x, its
  // baseline up to HEADING_LEAD_EMS x `top`'s size under `top`'s, and
  // passes `also`. The slice is found by a binary search 1 pt generous,
  // and every item in it is held to the exact predicate.
  const anyUnder = (
    top: CardText,
    size: number,
    also: (u: CardText) => boolean,
  ): boolean => {
    const reach = DETECT.HEADING_LEAD_EMS * top.size;
    const lo = top.y - reach - 1;
    const k = Math.floor(top.x / eps);
    for (const dk of [-1, 0, 1]) {
      const list = cells.get(k + dk);
      if (!list) continue;
      let a = 0;
      let z = list.length;
      while (a < z) {
        const m = (a + z) >> 1;
        if (list[m]!.y < lo) a = m + 1;
        else z = m;
      }
      for (let i = a; i < list.length && list[i]!.y < top.y; i++) {
        const u = list[i]!;
        if (
          u.size <= size &&
          Math.abs(u.x - top.x) <= eps &&
          top.y - u.y <= reach &&
          also(u)
        )
          return true;
      }
    }
    return false;
  };
  // `t` itself never passes: it is not smaller than itself. The body is
  // TWO lines: one smaller line under a caption is the caption's hint
  // ("(as shown on your passport)"), and read as a body it cost the line
  // its caption (review round 4 fixes, finding 3; corpus P37). And the
  // body is set in the page's body size: two hint lines smaller than it
  // were read as one, and a signature line lost its caption (review round
  // 5 fixes, finding 4; corpus P47). Unless the heading itself is set
  // larger than the body: a sidebar's heading over its smaller text
  // became a rule's caption (review round 6 fixes, finding 3; corpus N49).
  return (t) =>
    anyUnder(
      t,
      t.size - DETECT.HEADING_SMALLER_BY,
      (u) =>
        (!prose ||
          !smallerThanBody(u, prose) ||
          t.size >= prose.body + DETECT.HEADING_SMALLER_BY) &&
        anyUnder(u, u.size, () => true),
    );
}

/** What the prose rules read of the page ({@link DETECT.FOOTNOTE_SPAN}). */
interface Prose {
  /** The size most upright characters are set in. */
  body: number;
  /** The text column: leftmost and rightmost upright text. */
  left: number;
  right: number;
}

function proseOf(p: CardPage): Prose | null {
  const up = p.text.filter((t) => t.upright && t.str.trim() !== "");
  if (up.length === 0) return null;
  const chars = new Map<number, number>();
  for (const t of up) {
    const k = Math.round(t.size * 10) / 10;
    chars.set(k, (chars.get(k) ?? 0) + Array.from(t.str.trim()).length);
  }
  // A tie goes to the size met first: a page with two sizes of exactly
  // equal weight has no body size to speak of.
  let body = 0;
  let most = -1;
  for (const [k, n] of chars) if (n > most) [body, most] = [k, n];
  return {
    body,
    left: Math.min(...up.map((t) => t.x)),
    right: Math.max(...up.map((t) => t.x + Math.max(0, t.width))),
  };
}

/** Text smaller than the body by the heading step. */
const smallerThanBody = (t: CardText, prose: Prose) =>
  t.size <= prose.body - DETECT.HEADING_SMALLER_BY;

/**
 * Whether `t`, under line `r`, is the note under a footnote separator
 * ({@link DETECT.FOOTNOTE_SPAN}): a footnote's separator was a field
 * labelled with the footnote (review round 3, finding 6; corpus N40).
 */
function isFootnote(r: Line, t: CardText, prose: Prose | null): boolean {
  return (
    prose !== null &&
    DETECT.FOOTNOTE_RE.test(t.str) &&
    smallerThanBody(t, prose) &&
    Math.abs(r.x0 - prose.left) <= DETECT.GRID_ROW_EPS &&
    r.x1 - r.x0 <= DETECT.FOOTNOTE_SPAN * (prose.right - prose.left) + 1e-6
  );
}

/**
 * The size of the largest title line `r` sits under ({@link
 * DETECT.TITLE_LARGER}), or -Infinity: line `r` is a title rule for any
 * caption of at most 1 / TITLE_LARGER of it. The byline under a title's
 * rule was its caption (review round 3, finding 6; corpus N41). Read once
 * per line, not once per caption: the per-caption scan made a page of
 * small text under rules quadratic (review round 4 fixes, finding 10).
 */
function titleSize(r: Line, text: readonly CardText[]): number {
  const eps = DETECT.GRID_ROW_EPS;
  const mid = (r.x0 + r.x1) / 2;
  let best = -Infinity;
  for (const u of text) {
    if (
      u.upright &&
      u.str.trim() !== "" &&
      u.size > best &&
      u.y > r.y &&
      u.y - r.y <= DETECT.TITLE_ABOVE_EMS * u.size &&
      Math.abs(u.x + Math.max(0, u.width) / 2 - mid) <= eps &&
      r.x1 - r.x0 <= Math.max(0, u.width) + eps
    )
      best = u.size;
  }
  return best;
}

/**
 * The rules of PULL QUOTES ({@link DETECT.QUOTE_MIN_WORDS}), each with the
 * captions it may not take: the upper rule none at all, the lower none
 * that runs past the rules (the article going on). A pull quote's two
 * rules were fields labelled with the quote and the article (review round
 * 3, finding 6; corpus N42).
 */
function pullQuotes(
  p: CardPage,
  lines: PageLines,
  prose: Prose | null,
): Map<Line, (t: CardText) => boolean> {
  const out = new Map<Line, (t: CardText) => boolean>();
  if (!prose) return out;
  const eps = DETECT.GRID_ROW_EPS;
  const long = lines.rules.filter((r) => r.x1 - r.x0 >= DETECT.RULE_MIN_LEN);
  const bodyText = (t: CardText) =>
    t.upright && t.str.trim() !== "" && !smallerThanBody(t, prose);
  // Rules by their ends, in cells GRID_ROW_EPS wide: filtering every rule
  // for every rule was quadratic, and only "exactly two" is asked, so the
  // lookup stops at a third (review round 4 fixes, finding 18).
  const cellOf = (r: Line) =>
    `${Math.floor(r.x0 / eps)}|${Math.floor(r.x1 / eps)}`;
  const byEnds = new Map<string, Line[]>();
  for (const r of long) {
    const k = cellOf(r);
    const list = byEnds.get(k);
    if (list) list.push(r);
    else byEnds.set(k, [r]);
  }
  for (const lo of long) {
    const pair: Line[] = [];
    const c0 = Math.floor(lo.x0 / eps);
    const c1 = Math.floor(lo.x1 / eps);
    search: for (const d0 of [-1, 0, 1])
      for (const d1 of [-1, 0, 1])
        for (const r of byEnds.get(`${c0 + d0}|${c1 + d1}`) ?? []) {
          if (Math.abs(r.x0 - lo.x0) > eps || Math.abs(r.x1 - lo.x1) > eps)
            continue;
          pair.push(r);
          if (pair.length > 2) break search;
        }
    if (pair.length !== 2) continue;
    // Each pair is met twice; met from its upper rule, nothing is between.
    const hi = pair.find((r) => r !== lo)!;
    const between = p.text
      .filter(
        (t) =>
          t.str.trim() !== "" &&
          t.y > lo.y &&
          t.y < hi.y &&
          overlap(t.x, t.x + Math.max(0, t.width), lo.x0, lo.x1) > 0,
      )
      .sort((a, b) => b.y - a.y || a.x - b.x);
    if (!between.every(bodyText)) continue;
    // Nothing between joins to "", which is no sentence.
    const sentence = between.map((t) => t.str.trim()).join(" ");
    if (!DETECT.QUOTE_END_RE.test(sentence)) continue;
    if (sentence.split(/\s+/).length < DETECT.QUOTE_MIN_WORDS) continue;
    const runsOn = (t: CardText) =>
      bodyText(t) &&
      (t.x <= lo.x0 - DETECT.GRID_COLUMN_GAP ||
        t.x + Math.max(0, t.width) >= lo.x1 + DETECT.GRID_COLUMN_GAP);
    const near = p.text.some((t) => {
      if (!runsOn(t)) return false;
      const under = lo.y - (t.y + DETECT.TEXT_ASCENT_EMS * t.size);
      const over = t.y - hi.y;
      return (
        (under >= DETECT.CAPTION_MIN && under <= DETECT.CAPTION_MAX) ||
        (over > 0 && over <= DETECT.CAPTION_MAX)
      );
    });
    if (!near) continue;
    out.set(hi, () => true);
    out.set(lo, runsOn);
  }
  return out;
}

/**
 * Whether text lies wholly inside a drawn rect (a box, a cell) that ends
 * left of `x`: it is that rect's own text. The rects are bucketed by
 * height, so each question reads only the rects round the text's
 * baseline; scanning every rect for every box's left label was quadratic
 * in a column of boxes. A rect spanning more than `TALL` buckets (or with
 * an edge that is not finite) is met by every question instead.
 */
function boxHolder(p: CardPage): (t: CardText, x: number) => boolean {
  const STEP = 50;
  const TALL = 64;
  const band = (y: number) => Math.floor(y / STEP);
  const buckets = new Map<number, CardRect[]>();
  const tall: CardRect[] = [];
  for (const q of p.rects) {
    const b0 = band(q.y0);
    const b1 = band(q.y1);
    if (!(b1 - b0 <= TALL)) {
      tall.push(q);
      continue;
    }
    for (let b = b0; b <= b1; b++) {
      const list = buckets.get(b);
      if (list) list.push(q);
      else buckets.set(b, [q]);
    }
  }
  return (t, x) => {
    const right = t.x + Math.max(0, t.width);
    const holds = (q: CardRect) =>
      q.x1 <= x + 1 &&
      t.x >= q.x0 - 1 &&
      right <= q.x1 + 1 &&
      t.y > q.y0 &&
      t.y < q.y1;
    return (buckets.get(band(t.y)) ?? []).some(holds) || tall.some(holds);
  };
}

/**
 * The caption of an outlined box whose bottom edge is `r` and whose top is
 * at `top` ({@link DETECT.NOTICE_MIN_WORDS}): its one interior text, set
 * under its top-left, or, when it holds no text, the nearest upright text
 * just over its top. A notice (one sentence) is no caption, nor is an
 * interior text with less than a field's height of room under it. Both
 * searches read the page's baseline slice their window can reach, in page
 * order, with the exact tests unchanged: a scan of every text item per box
 * made a page of boxes quadratic in text (review round 6 test honesty,
 * cost finding 6).
 */
function boxCaption(ix: TextIndex, r: Line, top: number): LabelHit | null {
  const span = r.x0 + DETECT.CAPTION_SPAN * (r.x1 - r.x0);
  const inSpan = (t: CardText) =>
    overlap(t.x, t.x + Math.max(0, t.width), r.x0, span) > 0;
  const inside = textBand(ix, r.y, top).filter(
    (t) =>
      t.str.trim() !== "" &&
      t.y > r.y &&
      t.y < top &&
      overlap(t.x, t.x + Math.max(0, t.width), r.x0, r.x1) > 0,
  );
  let cap: CardText | undefined;
  if (inside.length === 1) {
    const t = inside[0]!;
    const gap = top - (t.y + DETECT.TEXT_ASCENT_EMS * t.size);
    // Room to write under it: a box only as tall as its text is a framed
    // notice, and a stop-less one ("Please use block capitals") was a
    // field squeezed under itself (review round 5 fixes, finding 2;
    // corpus N48). A caption sits in the top of its box and a notice about
    // its middle, so the room under it is a field's (MIN_FIELD_H) and more
    // than the room over it: asking a field's height for its size (14 pt)
    // cost compact tax-form boxes their fields (review round 6 fixes,
    // finding 2; corpus P51). A field's height for its size still counts
    // on its own, and short of it the caption is in the box's top: at
    // least CAPTION_TOP_RATIO x the room over it under it. "More than"
    // made a stop-less instruction framed 1 to 3 pt taller than A5's box
    // a field named after itself, which round 5 had proposed nothing for
    // (regression verify after review round 6).
    const under = t.y - DETECT.TEXT_DESCENT_EMS * t.size - r.y;
    const room =
      under >= textHeight(t.size, DETECT.TEXT_H_RULE) ||
      (under >= DETECT.MIN_FIELD_H && under >= DETECT.CAPTION_TOP_RATIO * gap);
    if (inSpan(t) && room && gap >= -1 && gap <= DETECT.CAPTION_MAX) cap = t;
  } else if (inside.length === 0) {
    const lo = top + DETECT.TEXT_DESCENT_EMS * ix.minSize;
    const hi = top + DETECT.CAPTION_MAX + DETECT.TEXT_DESCENT_EMS * ix.maxSize;
    for (const t of textBand(ix, lo, hi)) {
      if (!t.upright || !inSpan(t)) continue;
      const gap = t.y - DETECT.TEXT_DESCENT_EMS * t.size - top;
      if (gap < 0 || gap > DETECT.CAPTION_MAX) continue;
      if (!cap || t.y < cap.y) cap = t;
    }
  }
  if (!cap || !cap.upright) return null;
  const str = cleanLabel(cap.str);
  if (!str) return null;
  const s = cap.str.trim();
  const notice =
    DETECT.NOTICE_END_RE.test(s) &&
    s.split(/\s+/).length >= DETECT.NOTICE_MIN_WORDS;
  return notice ? null : { text: cap, str };
}

/** A line's candidate, whether a caption labelled it, and that text's size. */
interface RuleRow {
  c: Candidate;
  captioned: boolean;
  size: number | undefined;
}

/**
 * Strips captioned at their TOP (a W-9's): in a stack from {@link evenRuns}
 * whose every rule but the lowest is labelled by a caption under it, and
 * whose lowest has no label at all, each caption labels the rule BELOW it,
 * the lower edge of the strip it sits in, and the top rule is left without
 * one. Read as captions under their lines, every field sat one strip too
 * high and the first above the form (review round 3, finding 5; corpus
 * P29). A stack whose lowest line is captioned too (P20, P21, P25) is
 * captions under lines and is left alone, as is any stack with a line
 * labelled from its left, and any rows-only table (`rowTables`): its rows
 * repeat their columns, which strips do not, and its captions stay where
 * the table-grid seam (corpus N24, N31) reads them.
 */
function stripCaptions(
  lines: PageLines,
  rows: Map<Line, RuleRow>,
  rowTable: ReadonlySet<Line>,
): void {
  // Runs come lowest first, and two runs of one stack share the rule where
  // the pitch changes: the upper run reads that rule as the lower run left
  // it (moved, so bare), and the shift carries on up the whole stack.
  for (const { run } of evenRuns(lines.rules)) {
    if (run.some((r) => rowTable.has(r))) continue;
    const stack = run.map((r) => rows.get(r)!);
    const lowestBare = stack[0]!.c.labelState === "none";
    const upperCaptioned = stack.slice(1).every((s) => s.captioned);
    if (!lowestBare || !upperCaptioned) continue;
    const from = stack.map((s) => ({ label: s.c.label, size: s.size }));
    stack.forEach((s, k) => {
      const above = from[k + 1];
      s.c.label = above?.label ?? null;
      s.c.labelState = above ? "found" : "none";
      s.c.box.y1 =
        s.c.box.y0 +
        textHeight(above?.size ?? DETECT.DEFAULT_SIZE, DETECT.TEXT_H_RULE);
    });
  }
}

/**
 * Continuation lines ({@link DETECT.CONTINUATION_BELOW}): a multi-line
 * "Address:" or "Notes:" field draws its first line beside the label and
 * the rest under it from the margin, and those were all unlabelled (review
 * round 3, finding 8; corpus P32). Taken top down, so a continuation passes
 * its label on to the line under it. The own-row guard keeps a line whose
 * label just misses the 36 pt gap (P32's Date line) from inheriting the
 * label of the line above. A continuation counts as labelled from its
 * left, so a margin-to-margin one is no divider.
 */
function continuationLines(p: CardPage, rows: Map<Line, RuleRow>): void {
  const eps = DETECT.GRID_ROW_EPS;
  const sorted = [...rows.keys()].sort((a, b) => b.y - a.y);
  sorted.forEach((r, i) => {
    const row = rows.get(r)!;
    if (row.c.labelState !== "none") return;
    // The nearest line above that overlaps it, within reach.
    let above: Line | undefined;
    for (let j = i - 1; j >= 0; j--) {
      const o = sorted[j]!;
      if (o.y - r.y > DETECT.CONTINUATION_BELOW) break;
      if (o.y > r.y && overlap(o.x0, o.x1, r.x0, r.x1) > 0) {
        above = o;
        break;
      }
    }
    if (!above) return;
    const a = rows.get(above)!;
    // Labelled from its left (which implies a label), or a continuation.
    if (!a.c.leftLabel) return;
    if (Math.abs(above.x1 - r.x1) > eps || r.x0 > above.x0 + eps) return;
    // Drawn at the labelled line's weight: a heavier or lighter section
    // separator under a form's last field took its label (review round 4
    // fixes, finding 6; corpus P39).
    if (Math.abs((above.w ?? 0) - (r.w ?? 0)) > DETECT.CONTINUATION_WEIGHT_EPS)
      return;
    const textBetween = p.text.some(
      (t) =>
        t.str.trim() !== "" &&
        t.y > r.y &&
        t.y < above.y - DETECT.LABEL_BELOW_RULE &&
        overlap(t.x, t.x + Math.max(0, t.width), r.x0, r.x1) > 0,
    );
    if (textBetween) return;
    const band = labelBand(r);
    const ownRow = leftOf(p.text, r.x0, p.width, band.lo, band.hi).some(
      (h) => h.text.upright,
    );
    if (ownRow) return;
    row.c.label = a.c.label;
    row.c.labelState = "found";
    row.c.leftLabel = true;
    row.size = a.size;
    row.c.box.y1 =
      row.c.box.y0 +
      textHeight(a.size ?? DETECT.DEFAULT_SIZE, DETECT.TEXT_H_RULE);
  });
}

function ruleCandidates(
  p: CardPage,
  lines: PageLines,
  rowTable: ReadonlySet<Line>,
): Candidate[] {
  const out: Candidate[] = [];
  const rows = new Map<Line, RuleRow>();
  const ix = textIndex(p.text);
  const column = labelColumns(p, lines, ix);
  const prose = proseOf(p);
  const quotes = pullQuotes(p, lines, prose);
  const heading = headingTest(p.text, prose);
  const heldBy = boxHolder(p);
  for (const r of lines.rules) {
    const len = r.x1 - r.x0;
    if (len < DETECT.RULE_MIN_LEN) continue;
    const band = labelBand(r);
    // A box's bottom edge takes a left label anywhere up the box's side,
    // its baseline up to the box's top less its ascent: a label centred on
    // a box taller than about 18 pt sat above the band (review round 4
    // fixes, finding 24; corpus P44). Not in a label column's search.
    const boxTop = r.boxBottom?.top;
    const hi =
      boxTop === undefined
        ? band.hi
        : (t: CardText) =>
            Math.max(band.hi(t), boxTop - DETECT.TEXT_ASCENT_EMS * t.size);
    const left = leftOf(
      boxTop === undefined
        ? bandText(ix, r)
        : textBand(
            ix,
            band.lo - 1,
            Math.max(
              bandTop(ix, r),
              boxTop - DETECT.TEXT_ASCENT_EMS * Math.min(0, ix.minSize),
            ) + 1,
          ),
      r.x0,
      DETECT.LABEL_LEFT_GAP_RULE,
      band.lo,
      hi,
    );
    // Text inside another drawn box that ends left of this one is that
    // box's own caption: in a row of separate captioned boxes (a W-2's) a
    // neighbour's caption ends within the left gap, up this box's side,
    // and it labelled the box over the box's own caption (review round 6
    // fixes, finding 1; corpus P50). A label in a cell of its own beside
    // an EMPTY box still labels it. (The held hits are counted, not
    // tested for first: `some` before `filter` gave the same answers with
    // or without its test, a mutant nothing could see; regression verify
    // after review round 6.)
    const owned =
      boxTop === undefined ? left : left.filter((h) => !heldBy(h.text, r.x0));
    const mine =
      owned.length < left.length && boxCaption(ix, r, boxTop!) !== null
        ? owned
        : left;
    let pick = pickLabel(mine);
    let size = mine.find((h) => h.text.upright)?.text.size;
    // A line in a label column takes its column's label from farther away.
    const inColumn = pick.state === "found" ? undefined : column.get(r);
    if (inColumn) {
      pick = { label: inColumn.str, state: "found" };
      size = inColumn.text.size;
    }
    const leftLabel = pick.state === "found";
    let captioned = false;
    // A caption printed inside an outlined box's top-left once labelled the
    // box's TOP edge, placing the field above the box, outside it (review
    // round 3, finding 4; corpus N35).
    if (pick.state !== "found" && !r.boxTop) {
      const captions: LabelHit[] = [];
      let title: number | undefined;
      // The baselines a caption's window can reach (CAPTION_MIN to
      // CAPTION_MAX under the line, by its ascent), in page order: every
      // unlabelled line scanned every text item (review round 6 test
      // honesty, cost finding 6).
      const lo = r.y - DETECT.CAPTION_MAX - DETECT.TEXT_ASCENT_EMS * ix.maxSize;
      const hi = r.y - DETECT.CAPTION_MIN - DETECT.TEXT_ASCENT_EMS * ix.minSize;
      for (const t of textBand(ix, lo, hi)) {
        const top = t.y + DETECT.TEXT_ASCENT_EMS * t.size;
        const below = r.y - top;
        if (below < DETECT.CAPTION_MIN || below > DETECT.CAPTION_MAX) continue;
        const span = r.x0 + DETECT.CAPTION_SPAN * len;
        if (overlap(t.x, t.x + Math.max(0, t.width), r.x0, span) <= 0) continue;
        const str = cleanLabel(t.str);
        // Prose under a rule is no caption: a heading's body text, a
        // footnote, a byline under a title's rule, a pull quote's text.
        // Nor is a figure: a statement's total under its sum rule names
        // nothing (review round 6 fixes, finding 4; corpus N50).
        if (!str || !LETTER.test(str) || heading(t)) continue;
        if (isFootnote(r, t, prose)) continue;
        title ??= titleSize(r, p.text);
        if (title >= DETECT.TITLE_LARGER * t.size) continue;
        if (quotes.get(r)?.(t)) continue;
        captions.push({ text: t, str });
      }
      const cap = pickLabel(captions);
      if (cap.state === "found") {
        pick = cap;
        size = captions.find((h) => h.text.upright)?.text.size;
        captioned = true;
      } else if (pick.state === "none") pick = cap;
    }
    // A box's own caption labels its bottom edge, so the field sits inside
    // the box: a delivery note's "Received by" / "Date" boxes, a captioned
    // free-text box, got no field (review round 4 fixes, finding 22;
    // corpus N35, P42, P43, N44).
    if (pick.state !== "found" && r.boxBottom) {
      const cap = boxCaption(ix, r, r.boxBottom.top);
      if (cap) {
        pick = { label: cap.str, state: "found" };
        size = cap.text.size;
      }
    }
    const h = textHeight(size ?? DETECT.DEFAULT_SIZE, DETECT.TEXT_H_RULE);
    const bottom = r.y + DETECT.RULE_BOTTOM_GAP;
    const c: Candidate = {
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
    };
    out.push(c);
    rows.set(r, { c, captioned, size });
  }
  stripCaptions(lines, rows, rowTable);
  continuationLines(p, rows);
  return out;
}

function runCandidates(
  p: CardPage,
  all: Piece[],
  ix: TextIndex,
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
        // The run's band from the baseline index, not every item on the
        // page: per run that was quadratic in text items (review round 5
        // fixes, finding 7, where it was most of a ruled run grid's time).
        const lo = t.y - DETECT.RUN_BASELINE_EMS * t.size;
        const hits = leftOf(
          textBand(ix, lo, t.y + DETECT.RUN_BASELINE_EMS * t.size).filter(
            (o) => o !== t,
          ),
          pc.x0,
          DETECT.LABEL_LEFT_GAP,
          lo,
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

/**
 * Squares grouped by `key` (x0 for columns, y0 for rows): each group's keys
 * lie within {@link DETECT.COMB_EPS} of its first, and its sides within
 * COMB_EPS of its first's. Sorted, so linear after the sort.
 */
function squareGroups(
  squares: readonly CardRect[],
  key: (s: CardRect) => number,
): CardRect[][] {
  const eps = DETECT.COMB_EPS;
  const side = (s: CardRect) => s.x1 - s.x0;
  const split = (xs: CardRect[], k: (s: CardRect) => number) => {
    const out: CardRect[][] = [];
    for (const s of [...xs].sort((a, b) => k(a) - k(b))) {
      const g = out[out.length - 1];
      if (g && k(s) - k(g[0]!) <= eps) g.push(s);
      else out.push([s]);
    }
    return out;
  };
  return split([...squares], key).flatMap((g) => split(g, side));
}

/**
 * Labels for the squares of a checkbox GRID (a condition x Yes / No grid, a
 * 1-to-5 rating grid): a square with another of its size in its column and
 * in its row, in a row whose every square's column has a head of its own
 * (a distinct text item over the column's top square, up to
 * {@link DETECT.GRID_HEAD_ABOVE} pt above it), is labelled "<row text>
 * <head>", the row text being the nearest upright text left of the row's
 * first square. Such grids once proposed nothing, or with dot leaders only
 * the first column, named after the row alone (review round 3, finding 7;
 * corpus P30, P31). An option list in columns under one instruction is no
 * grid: its other columns have no head. A square with its own label on its
 * right does not take its grid label (`squareCandidates`; corpus P36).
 */
function gridLabels(
  p: CardPage,
  squares: readonly CardRect[],
): Map<CardRect, string> {
  const out = new Map<CardRect, string>();
  const columnOf = new Map<CardRect, CardRect[]>();
  for (const col of squareGroups(squares, (s) => s.x0))
    if (col.length >= 2) for (const s of col) columnOf.set(s, col);
  // A column's head: the nearest upright text over its top square, with
  // every other item on that baseline (within GRID_ROW_EPS) over the
  // square joined left to right: a head drawn as two items ("Not" "sure")
  // was named after the one first in the content stream (review round 4
  // fixes, finding 16). Every one of its items is its own in the distinct-
  // heads check, so one text across two columns is still no grid: only
  // the leftmost was compared, and "Not" + "sure" (over both) passed
  // (review round 5 fixes, finding 15).
  const headOf = new Map<CardRect[], { items: CardText[]; str: string }>();
  const groupOf = new Map<CardRect[], string>();
  for (const col of new Set(columnOf.values())) {
    const top = col.reduce((a, b) => (b.y1 > a.y1 ? b : a));
    const over: CardText[] = [];
    for (const t of p.text) {
      if (!t.upright || !cleanLabel(t.str)) continue;
      if (t.y <= top.y1 || t.y - top.y1 > DETECT.GRID_HEAD_ABOVE) continue;
      if (overlap(t.x, t.x + Math.max(0, t.width), top.x0, top.x1) <= 0)
        continue;
      over.push(t);
    }
    if (over.length === 0) continue;
    const base = Math.min(...over.map((t) => t.y));
    const words = over
      .filter((t) => t.y - base <= DETECT.GRID_ROW_EPS)
      .sort((a, b) => a.x - b.x);
    const str = cleanLabel(words.map((t) => t.str).join(" "));
    if (str) headOf.set(col, { items: words, str });
    // A GROUP head over it ("Left eye" over "Yes No"): the nearest upright
    // text over the head row, up to 2 x GRID_HEAD_ABOVE over the column's
    // top square, across the column. Read only where heads repeat (below).
    let group: CardText | undefined;
    for (const t of p.text) {
      if (!t.upright || !cleanLabel(t.str)) continue;
      if (t.y - base <= DETECT.GRID_ROW_EPS) continue;
      if (t.y - top.y1 > 2 * DETECT.GRID_HEAD_ABOVE) continue;
      if (overlap(t.x, t.x + Math.max(0, t.width), top.x0, top.x1) <= 0)
        continue;
      if (!group || t.y < group.y) group = t;
    }
    if (group) groupOf.set(col, cleanLabel(group.str)!);
  }
  for (const row of squareGroups(squares, (s) => s.y0)) {
    if (row.length < 2) continue;
    const heads = row.map((s) => {
      const col = columnOf.get(s);
      return col ? headOf.get(col) : undefined;
    });
    if (heads.some((h) => !h)) continue;
    const items = heads.flatMap((h) => h!.items);
    if (new Set(items).size !== items.length) continue;
    const first = row.reduce((a, b) => (b.x0 < a.x0 ? b : a));
    const rowText = leftOf(
      p.text,
      first.x0,
      p.width,
      first.y0 - DETECT.RUN_BASELINE_EMS * 12,
      () => first.y1,
    ).find((h) => h.text.upright);
    // Heads that repeat ("Yes No | Yes No" under "Left eye | Right eye")
    // gave each name twice; each takes its group head when every column
    // has one and that makes the names distinct (review round 5 fixes,
    // finding 6a; corpus P49). A comb's repeated heads ("D D M M") have
    // none, or one across them all, and stay as they are.
    let names = heads.map((h) => h!.str);
    if (new Set(names).size !== names.length) {
      const groups = row.map((s) => groupOf.get(columnOf.get(s)!));
      const grouped = names.map((h, k) => `${groups[k]} ${h}`);
      if (
        groups.every((g) => g !== undefined) &&
        new Set(grouped).size === grouped.length
      )
        names = grouped;
    }
    row.forEach((s, k) => {
      const head = names[k]!;
      out.set(s, rowText ? `${rowText.str} ${head}` : head);
    });
  }
  return out;
}

/**
 * A square's label is the nearest upright text on EITHER side, within
 * {@link DETECT.LABEL_LEFT_GAP}; a tie keeps the right. The right side was
 * once searched first and the left only when it found nothing, so in the
 * inline "Yes [] No []" the next answer word beat the box's own label and
 * every Yes box read "No" (review round 3, finding 1; corpus P28, whose
 * second row is the label-right control). A ROW of squares reads one side
 * for all of them (see below; corpus P35). A square in a headed grid takes
 * its grid label ({@link gridLabels}) instead.
 */
function squareCandidates(p: CardPage, lines: PageLines): Candidate[] {
  const grid = gridLabels(p, lines.squares);
  type Sides = {
    right: LabelHit[];
    left: LabelHit[];
    r: LabelHit | undefined;
    l: LabelHit | undefined;
    rGap: number;
    lGap: number;
  };
  const sides = new Map<CardRect, Sides>();
  for (const sq of lines.squares) {
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
    const left = leftOf(
      p.text,
      sq.x0,
      DETECT.LABEL_LEFT_GAP,
      sq.y0 - DETECT.RUN_BASELINE_EMS * 12,
      () => sq.y1,
    );
    const r = right.find((h) => h.text.upright);
    const l = left.find((h) => h.text.upright);
    sides.set(sq, {
      right,
      left,
      r,
      l,
      rGap: r ? r.text.x - sq.x1 : Infinity,
      lGap: l ? sq.x0 - (l.text.x + Math.max(0, l.text.width)) : Infinity,
    });
  }
  // A ROW reads one side when only that side gives every square a label of
  // its own (distinct items); when both do, the side nearer in sum, a tie
  // keeping the right. Decided per square, a box whose neighbour's option
  // sat nearer than its own label took the neighbour's (review round 4
  // fixes, finding 1; corpus P35).
  const rowLeft = new Map<CardRect, boolean>();
  for (const row of squareGroups(lines.squares, (s) => s.y0)) {
    if (row.length < 2) continue;
    const ss = row.map((s) => sides.get(s)!);
    const complete = (k: "l" | "r") =>
      ss.every((s) => s[k]) &&
      new Set(ss.map((s) => s[k]!.text)).size === ss.length;
    const lOk = complete("l");
    const rOk = complete("r");
    if (!lOk && !rOk) continue;
    const sum = (k: "lGap" | "rGap") => ss.reduce((a, s) => a + s[k], 0);
    const left = lOk && (!rOk || sum("lGap") < sum("rGap"));
    for (const s of row) rowLeft.set(s, left);
  }
  // A grid's heads name distinct choices; a comb's heads name character
  // positions, which repeat ("D D M M Y Y Y Y"). A row whose grid labels
  // repeat keeps its labels but not the comb exemption: two headed date
  // combs were proposed as 16 checkboxes (review round 5 fixes, finding 1;
  // corpus N47).
  const repeated = new Set<CardRect>();
  for (const row of squareGroups(lines.squares, (s) => s.y0)) {
    const ls = row.map((s) => grid.get(s));
    if (ls[0] !== undefined && new Set(ls).size !== ls.length)
      for (const s of row) repeated.add(s);
  }
  const out = lines.squares.map((sq) => {
    const { right, left, r, l, rGap, lGap } = sides.get(sq)!;
    const leftWins = rowLeft.get(sq) ?? lGap < rGap;
    let pick: ReturnType<typeof pickLabel>;
    // A square in a row that reads a side in full (every square its own
    // label) is an option, never a grid cell: two headed option lists side
    // by side once passed for a grid and took their headings (review round
    // 4 fixes, finding 2; P36). One word between two grid boxes ("or") is
    // no such row (finding 19).
    const inGrid = rowLeft.has(sq) ? undefined : grid.get(sq);
    if (inGrid) pick = { label: inGrid, state: "found" };
    else if (l && leftWins) pick = { label: l.str, state: "found" };
    else if (r) pick = { label: r.str, state: "found" };
    else {
      // No upright text on either side: "rotated" if either has some.
      pick = pickLabel(right);
      if (pick.state === "none") pick = pickLabel(left);
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
      gridCell: inGrid !== undefined && !repeated.has(sq),
    };
  });
  // A CHECKLIST column: 2+ equal squares in a column, each alone on its
  // row (one answer a row, not a grid) and none of which found a label,
  // takes for each square its row's first upright text (the leftmost on
  // its band). A ruled fee table's "Select" column, its names in the first
  // cell, proposed none of its boxes (review round 4 fixes, finding 23;
  // corpus P41). Without "alone", a headless Yes / No grid read
  // "Asthma", "Asthma". The text must hold a letter: a numbered list's
  // boxes were named "1" to "5" (review round 5 fixes, finding 3;
  // corpus P46). And an item code is passed over for its item: a Code |
  // Item | Returned checklist named its boxes "A1" to "D4" (review round 6
  // fixes, finding 5; corpus P52). A row whose only lettered text is a
  // code still takes the code.
  const bySquare = new Map(out.map((c) => [c.square, c]));
  // Rows by bottom alone (any size of square shares a row), within
  // COMB_EPS of the row's first.
  const rowCount = new Map<CardRect, number>();
  const byBottom = [...lines.squares].sort((a, b) => a.y0 - b.y0);
  for (let i = 0; i < byBottom.length;) {
    let j = i + 1;
    while (
      j < byBottom.length &&
      byBottom[j]!.y0 - byBottom[i]!.y0 <= DETECT.COMB_EPS
    )
      j++;
    for (let k = i; k < j; k++) rowCount.set(byBottom[k]!, j - i);
    i = j;
  }
  for (const col of squareGroups(lines.squares, (s) => s.x0)) {
    if (col.length < 2) continue;
    if (!col.every((s) => bySquare.get(s)!.labelState === "none")) continue;
    if (!col.every((s) => rowCount.get(s) === 1)) continue;
    for (const s of col) {
      const lettered = leftOf(
        p.text,
        s.x0,
        p.width,
        s.y0 - DETECT.RUN_BASELINE_EMS * 12,
        () => s.y1,
      ).filter((h) => h.text.upright && LETTER.test(h.str));
      const first =
        lettered.filter((h) => !ITEM_CODE.test(h.str)).pop() ?? lettered.pop();
      if (!first) continue;
      const c = bySquare.get(s)!;
      c.label = first.str;
      c.labelState = "found";
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  Table cells
 * ------------------------------------------------------------------ */

/**
 * Whether plumb lines at x (within {@link DETECT.GRID_TOUCH_EPS}) run the
 * whole way from y0 to y1, as one line or as pieces (a Word table draws
 * each cell's border on its own).
 */
function plumbCovers(
  verticals: PageLines["verticals"],
  x: number,
  y0: number,
  y1: number,
): boolean {
  return plumbCoverage(verticals, x)(y0, y1);
}

/**
 * {@link plumbCovers} at one x, for many questions: the plumb lines at x
 * are gathered and sorted once, and each question walks only the pieces
 * from its own y0 on. The pieces that start by y0 (within the touch eps)
 * only raise the reach to the farthest of their ends, a prefix maximum,
 * found by binary search. The label-table split asked about every pair of
 * a stack's rules, filtering every vertical on the page each time: a
 * Word-style table, each cell's border its own piece, cost rows x
 * verticals (review round 6 test honesty, cost finding 1).
 */
function plumbCoverage(
  verticals: PageLines["verticals"],
  x: number,
): (y0: number, y1: number) => boolean {
  const eps = DETECT.GRID_TOUCH_EPS;
  const at = verticals
    .filter((v) => Math.abs(v.x - x) <= eps)
    .sort((a, b) => a.y0 - b.y0);
  // farthest[k]: the farthest end of the first k pieces.
  const farthest: number[] = [-Infinity];
  for (const v of at)
    farthest.push(Math.max(farthest[farthest.length - 1]!, v.y1));
  return (y0, y1) => {
    // lo: how many pieces start by y0 (within the eps). They join at y0,
    // so the reach starts at the farthest of their ends, and the walk
    // takes the rest only through ends. y0 itself counts at the finish
    // (a question no taller than the eps), not in the walk: with y0 in
    // the walk, a search that counted too few gave the same answers, so
    // its boundary could move with every test green. Now a piece the
    // search leaves out joins only through an earlier piece's end.
    let lo = 0;
    let hi = at.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (at[m]!.y0 <= y0 + eps) lo = m + 1;
      else hi = m;
    }
    let reach = farthest[lo]!;
    for (let i = lo; i < at.length; i++) {
      if (at[i]!.y0 > reach + eps) break;
      reach = Math.max(reach, at[i]!.y1);
    }
    return Math.max(y0, reach) >= y1 - eps;
  };
}

/** Whether a level rule at y runs from x0 to x1 (rules are merged). */
function levelCovers(
  rules: readonly Line[],
  y: number,
  x0: number,
  x1: number,
): boolean {
  const eps = DETECT.GRID_TOUCH_EPS;
  return rules.some(
    (r) => Math.abs(r.y - y) <= eps && r.x0 <= x0 + eps && r.x1 >= x1 - eps,
  );
}

/** The four sides of a cell are drawn, each the whole way. */
function closedCell(lines: PageLines, c: Edges): boolean {
  return (
    levelCovers(lines.rules, c.y0, c.x0, c.x1) &&
    levelCovers(lines.rules, c.y1, c.x0, c.x1) &&
    plumbCovers(lines.verticals, c.x0, c.y0, c.y1) &&
    plumbCovers(lines.verticals, c.x1, c.y0, c.y1)
  );
}

/**
 * The ruled cell round (x, y): the nearest level rule under and over the
 * point, the nearest plumb line left and right of it, when all four close
 * the cell. Null when the point is in no closed cell.
 */
function cellAround(lines: PageLines, x: number, y: number): Edges | null {
  let y0 = -Infinity;
  let y1 = Infinity;
  for (const r of lines.rules) {
    if (r.x0 > x || r.x1 < x) continue;
    if (r.y < y) y0 = Math.max(y0, r.y);
    else if (r.y > y) y1 = Math.min(y1, r.y);
  }
  let x0 = -Infinity;
  let x1 = Infinity;
  for (const v of lines.verticals) {
    if (v.y0 > y || v.y1 < y) continue;
    if (v.x < x) x0 = Math.max(x0, v.x);
    else if (v.x > x) x1 = Math.min(x1, v.x);
  }
  const c = { x0, y0, x1, y1 };
  return Object.values(c).every(Number.isFinite) && closedCell(lines, c)
    ? c
    : null;
}

/** Text whose baseline is inside the cell and which reaches across it. */
function textIn(ix: TextIndex, c: Edges): CardText[] {
  // Read from the cell's baseline slice: a scan of every text item per
  // cell made a ruled grid of runs quadratic in text (review round 5
  // fixes, finding 7).
  return textBand(ix, c.y0, c.y1).filter(
    (t) =>
      t.str.trim() !== "" &&
      t.y > c.y0 &&
      t.y < c.y1 &&
      overlap(t.x, t.x + Math.max(0, t.width), c.x0, c.x1) > 0.5,
  );
}

/**
 * The one label line a cell holds: its text all upright, starting inside
 * the cell (within 1 pt of its left border), on one baseline (within
 * {@link DETECT.GRID_ROW_EPS}), and read with `cleanLabel` into at most
 * {@link DETECT.CELL_LABEL_MAX} characters. Null for two lines, none, or
 * anything else. Text reaching past the right border needs no check here:
 * it is in the next cell too, which both callers require to be empty.
 */
function cellLabel(ix: TextIndex, c: Edges): string | null {
  const items = textIn(ix, c).sort((a, b) => a.x - b.x);
  if (items.length === 0) return null;
  const first = items[0]!;
  const one = items.every(
    (t) =>
      t.upright &&
      t.x >= c.x0 - 1 &&
      Math.abs(t.y - first.y) <= DETECT.GRID_ROW_EPS,
  );
  if (!one) return null;
  const str = cleanLabel(items.map((t) => t.str).join(" "));
  if (!str || Array.from(str).length > DETECT.CELL_LABEL_MAX) return null;
  return str;
}

/**
 * The fields of LABEL TABLES ({@link DETECT.CELL_ROWS_MIN}): stacks of
 * rules whose ends line up (within {@link DETECT.GRID_ROW_EPS}), split
 * wherever the outer plumb lines break (two tables at one margin), with
 * exactly three plumb lines inside, at the two ends and one between, each
 * running the stack's whole height, and no other line inside. Every row's
 * left cell must hold one label line ({@link cellLabel}) and every right
 * cell nothing at all: no text (an underscore run included), no square. A
 * header row, a value column, a third column, or a left cell of two lines
 * or none leaves the whole grid to `table-grid` (corpus N4, N39).
 */
function tableCells(ix: TextIndex, lines: PageLines): Candidate[] {
  const eps = DETECT.GRID_ROW_EPS;
  const tEps = DETECT.GRID_TOUCH_EPS;
  const long = lines.rules
    .filter((r) => r.x1 - r.x0 >= DETECT.RULE_MIN_LEN)
    .sort((a, b) => a.y - b.y);
  // Long rules by their ends, in cells GRID_ROW_EPS wide, so a seed's
  // stack is gathered from its cell and the eight round it: filtering
  // every long rule for every seed was quadratic in rules (review round 5
  // fixes, finding 8). Each cell keeps `long`'s order (by y).
  const cellOf = (a: number, b: number) =>
    `${Math.floor(a / eps)}|${Math.floor(b / eps)}`;
  const ends = new Map<string, Line[]>();
  const at = new Map(long.map((r, i) => [r, i]));
  for (const r of long) {
    const k = cellOf(r.x0, r.x1);
    const list = ends.get(k);
    if (list) list.push(r);
    else ends.set(k, [r]);
  }
  const seen = new Set<Line>();
  const out: Candidate[] = [];
  for (const seed of long) {
    if (seen.has(seed)) continue;
    const near: Line[] = [];
    const c0 = Math.floor(seed.x0 / eps);
    const c1 = Math.floor(seed.x1 / eps);
    for (const d0 of [-1, 0, 1])
      for (const d1 of [-1, 0, 1])
        for (const r of ends.get(`${c0 + d0}|${c1 + d1}`) ?? [])
          if (
            Math.abs(r.x0 - seed.x0) <= eps &&
            Math.abs(r.x1 - seed.x1) <= eps
          )
            near.push(r);
    const stack = near.sort((a, b) => at.get(a)! - at.get(b)!);
    stack.forEach((r) => seen.add(r));
    // Split where the outer plumb lines do not join two rules.
    const parts: Line[][] = [[stack[0]!]];
    // Each outer x's plumb lines are gathered once per stack, and only for
    // a stack of two rules or more: a lone rule asks nothing.
    let outer: ((y0: number, y1: number) => boolean)[] | undefined;
    for (let i = 1; i < stack.length; i++) {
      const a = stack[i - 1]!;
      const b = stack[i]!;
      outer ??= [seed.x0, seed.x1].map((x) =>
        plumbCoverage(lines.verticals, x),
      );
      const joined = outer[0]!(a.y, b.y) && outer[1]!(a.y, b.y);
      if (joined) parts[parts.length - 1]!.push(b);
      else parts.push([b]);
    }
    for (const part of parts) {
      if (part.length - 1 < DETECT.CELL_ROWS_MIN) continue;
      const lo = part[0]!.y;
      const hi = part[part.length - 1]!.y;
      const xs: number[] = [];
      for (const v of lines.verticals
        .filter(
          (v) =>
            v.x >= seed.x0 - tEps &&
            v.x <= seed.x1 + tEps &&
            v.y1 > lo + tEps &&
            v.y0 < hi - tEps,
        )
        .sort((a, b) => a.x - b.x))
        if (xs.length === 0 || v.x - xs[xs.length - 1]! > tEps) xs.push(v.x);
      // The part's outer plumb lines are among them (it was split where
      // they break), so three are the two ends and one column line.
      if (xs.length !== 3) continue;
      const mid = xs[1]!;
      if (!plumbCovers(lines.verticals, mid, lo, hi)) continue;
      const stray = lines.rules.some(
        (r) =>
          !part.includes(r) &&
          r.y > lo + tEps &&
          r.y < hi - tEps &&
          overlap(r.x0, r.x1, seed.x0, seed.x1) > tEps,
      );
      if (stray) continue;
      const rows: Candidate[] = [];
      for (let i = 1; i < part.length; i++) {
        const y0 = part[i - 1]!.y;
        const y1 = part[i]!.y;
        const label = cellLabel(ix, { x0: seed.x0, x1: mid, y0, y1 });
        const cell = { x0: mid, x1: seed.x1, y0, y1 };
        const empty =
          textIn(ix, cell).length === 0 &&
          !lines.squares.some(
            (s) =>
              overlap(s.x0, s.x1, mid, seed.x1) > 0 && s.y1 > y0 && s.y0 < y1,
          );
        if (!label || !empty) break;
        const inset = DETECT.FIELD_INSET;
        rows.push({
          rule: "table-cell",
          type: "text",
          box: {
            x0: mid + inset,
            x1: seed.x1 - inset,
            y0: y0 + inset,
            y1: y1 - inset,
          },
          line: null,
          square: null,
          label,
          labelState: "found",
          leftLabel: true,
          ownPiece: null,
          order: 0,
        });
      }
      if (rows.length === part.length - 1) out.push(...rows);
    }
  }
  return out;
}

/**
 * An underscore run typed ALONE in a ruled cell, with no label of its own,
 * takes the label of the cell to its left in the same row when that cell
 * holds one label line ({@link cellLabel}): its label sits across the cell
 * border, past {@link DETECT.LABEL_LEFT_GAP} (review round 3, finding 9;
 * the owner's decision in round 4; corpus P33).
 */
function cellRunLabels(
  ix: TextIndex,
  lines: PageLines,
  pix: YIndex<Piece>,
  runs: readonly Candidate[],
): void {
  for (const c of runs) {
    const pc = c.ownPiece;
    if (!pc || c.labelState !== "none") continue;
    const mid = pc.baseline + DETECT.RUN_BASELINE_EMS * pc.size;
    const cell = cellAround(lines, (pc.x0 + pc.x1) / 2, mid);
    if (!cell) continue;
    // The cell's pieces from the baseline index: `every` over all pieces
    // for every run was quadratic (review round 5 fixes, finding 7).
    const alone = ySlice(pix, cell.y0, cell.y1).every(
      (o) =>
        o === pc ||
        !(
          o.baseline > cell.y0 &&
          o.baseline < cell.y1 &&
          overlap(o.x0, o.x1, cell.x0, cell.x1) > 0.5
        ),
    );
    if (!alone) continue;
    const left = cellAround(lines, cell.x0 - DETECT.GRID_ROW_EPS, mid);
    if (
      !left ||
      Math.abs(left.x1 - cell.x0) > DETECT.GRID_TOUCH_EPS ||
      Math.abs(left.y0 - cell.y0) > DETECT.GRID_TOUCH_EPS ||
      Math.abs(left.y1 - cell.y1) > DETECT.GRID_TOUCH_EPS
    )
      continue;
    const label = cellLabel(ix, left);
    if (!label) continue;
    c.label = label;
    c.labelState = "found";
    c.leftLabel = true;
  }
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
  const out = new Set<Line>();
  const words = yIndex(
    all.filter((pc) => pc.kind === "text"),
    (pc) => pc.baseline,
    (pc) => pc.size,
  );
  const columns = (lo: Line, hi: Line, x0: number, x1: number) => {
    const inBand = ySlice(words, lo.y, hi.y)
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
  for (const { seed, run: runOf } of evenRuns(rules)) {
    // The columns of each row (between two rules) that holds text.
    const filled = runOf
      .slice(1)
      .map((hi, i) => columns(runOf[i]!, hi, seed.x0, seed.x1))
      .filter((n) => n > 0);
    if (filled.length > 0 && filled.every((n) => n >= 2))
      runOf.forEach((r) => out.add(r));
  }
  return out;
}

/**
 * Stacks of rules at an even pitch, lowest first: rules of candidate length
 * whose two ends line up within {@link DETECT.GRID_ROW_EPS} of the stack's
 * first (its `seed`), split where the pitch breaks by more than
 * {@link DETECT.GRID_PITCH_EPS} from the run's first pitch (a break starts
 * the next run at the rule before it), each run
 * {@link DETECT.GRID_ROWS_MIN} rules or more. Read by `rowTables` and by
 * `stripCaptions`.
 */
function evenRuns(rules: readonly Line[]): { seed: Line; run: Line[] }[] {
  const eps = DETECT.GRID_ROW_EPS;
  const long = rules.filter((r) => r.x1 - r.x0 >= DETECT.RULE_MIN_LEN);
  const seen = new Set<Line>();
  const runs: { seed: Line; run: Line[] }[] = [];
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
    let from = 0;
    for (let k = 2; k <= stack.length; k++) {
      const even =
        k < stack.length &&
        Math.abs(
          stack[k]!.y - stack[k - 1]!.y - (stack[from + 1]!.y - stack[from]!.y),
        ) <= DETECT.GRID_PITCH_EPS;
      if (even) continue;
      const run = stack.slice(from, k);
      if (run.length >= DETECT.GRID_ROWS_MIN) runs.push({ seed, run });
      from = k - 1;
    }
  }
  return runs;
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
 *
 * The close is read from the baselines SIGNOFF_ABOVE over the line: a scan
 * of every text item per candidate made a page of boxes quadratic in text
 * (review round 6 test honesty, cost finding 6).
 */
function underSignOff(
  ix: TextIndex,
  c: Candidate,
  lines: readonly Line[],
): boolean {
  const line = c.line;
  if (!line || c.leftLabel) return false;
  return textBand(ix, line.y, line.y + DETECT.SIGNOFF_ABOVE).some(
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
 *
 * A checkbox is never resized: text that would lower its top lies inside
 * its square, and is text on it. Lowered like a text field's, a hint digit
 * once left a 14 x 2 checkbox the builder's validation accepts (review
 * round 3, finding 3; corpus N34, and the squareness check over every
 * corpus run in form-detect.corpus.test.ts).
 */
/**
 * The pieces {@link clearBox} can act on for `c`: resting on or over its
 * box (baseline from its bottom + 0.2 x the smallest size up to its top +
 * CLEARANCE_GAP) or reaching up across its bottom (baseline from its
 * bottom - 0.7 x the largest size up to its bottom + 0.2 x the largest),
 * 1 pt generous at each end (finding 18).
 */
function clearSlice(pix: YIndex<Piece>, c: Candidate): Piece[] {
  const y0 = c.box.y0;
  const lo = Math.min(
    y0 + DETECT.TEXT_DESCENT_EMS * pix.minSize,
    y0 - DETECT.TEXT_ASCENT_EMS * pix.maxSize,
  );
  const hi = Math.max(
    c.box.y1 + DETECT.CLEARANCE_GAP,
    y0 + DETECT.TEXT_DESCENT_EMS * pix.maxSize,
  );
  return ySlice(pix, lo - 1, hi + 1);
}

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
      if (pc.baseline < c.box.y1 + DETECT.CLEARANCE_GAP) {
        if (c.type === "checkbox") overlapsText = true;
        else box.y1 = Math.min(box.y1, pc.baseline - DETECT.CLEARANCE_GAP);
      }
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
  const pix = yIndex(
    all,
    (pc) => pc.baseline,
    (pc) => pc.size,
  );
  const lines = readLines(p);
  const rowTable = rowTables(lines.rules, all);
  const tix = textIndex(p.text);
  const runs = runCandidates(p, all, tix);
  cellRunLabels(tix, lines, pix, runs.cands);
  const cands = [
    ...ruleCandidates(p, lines, rowTable),
    ...runs.cands,
    ...squareCandidates(p, lines),
    ...tableCells(tix, lines),
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
  const signOffLines = [
    ...lines.rules.filter((r) => r.x1 - r.x0 >= DETECT.RULE_MIN_LEN),
    ...runs.cands.flatMap((c) => (c.line ? [c.line] : [])),
  ];
  const labelledSquares = cands.filter(
    (c) => c.square && c.labelState === "found",
  );

  // Labelled lines by row (cells GRID_ROW_EPS tall), for the band rule's
  // row-mates: looked up, not scanned, so a band of lines stays linear.
  const rowEps = DETECT.GRID_ROW_EPS;
  const labelledRows = new Map<number, Line[]>();
  for (const c of cands) {
    if (!c.line || c.labelState !== "found") continue;
    const k = Math.floor(c.line.y / rowEps);
    const list = labelledRows.get(k);
    if (list) list.push(c.line);
    else labelledRows.set(k, [c.line]);
  }
  const rowMate = (line: Line) => {
    const k = Math.floor(line.y / rowEps);
    for (const dk of [-1, 0, 1])
      for (const o of labelledRows.get(k + dk) ?? [])
        if (
          o !== line &&
          Math.abs(o.y - line.y) <= rowEps &&
          overlap(o.x0, o.x1, line.x0, line.x1) <= 0
        )
          return true;
    return false;
  };

  type Survivor = { c: Candidate; box: Edges };
  const survivors: Survivor[] = [];
  for (const c of cands) {
    // 3. Signature lines belong to Edit PDF's signature field.
    if (
      on("signature") &&
      ((c.label && DETECT.SIGNATURE_RE.test(c.label)) ||
        underSignOff(tix, c, signOffLines))
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
        const along = ySlice(
          pix,
          line.y - 1,
          line.y + DETECT.UNDERLINE_MAX_GAP + 1,
        )
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
      // A line labelled only by the text under it, in the band: a header or
      // footer rule, which a one-page document repeats nowhere (review
      // round 3, finding 6; corpus N37). A run's label is always a left one.
      // A line with a labelled ROW-MATE beside it is a form's row: a dense
      // form's last row was dropped as a footer (review round 4 fixes,
      // finding 4; corpus P38). A lone captioned line in the band still is.
      const captionOnly =
        !c.leftLabel && c.labelState === "found" && !rowMate(c.line);
      if (
        len > DETECT.BAND_SPAN * p.width ||
        captionOnly ||
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
      // A square its headed grid labels is a checkbox, however close its
      // neighbour: a Yes / No grid of boxes 1 pt apart was a comb (review
      // round 4 fixes, finding 7; corpus P40). Not when its row's heads
      // repeat: those name a comb's character positions (round 5, finding
      // 1; corpus N47).
      if (on("comb") && comb.has(c.square) && !c.gridCell) {
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
    const cleared = clearBox(c, clearSlice(pix, c));
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
        // Sorted by bottom: nothing later is within DUP_DY either. With
        // `continue` here the pass was quadratic in labelled squares
        // (review round 4 fixes, finding 11).
        if (b.c.box.y0 - a.c.box.y0 > DETECT.DUP_DY) break;
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
