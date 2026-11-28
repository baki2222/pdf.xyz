import type {
  NewCheckBoxField,
  NewRadioField,
  NewTextField,
} from "./create-forms";
import type { Rect, Seg } from "./form-detect-paths";

/**
 * Create Forms field finder: the decisions. Given one page's straight lines,
 * small boxes and text (already read and placed by `./form-detect-read`),
 * propose where a fillable field might go, and say why each other shape was
 * passed over.
 *
 * LIMITS, in plain words. It looks at ten shapes only (slice S4 added
 * the seventh, and one field over stacked lines; see {@link DETECT_BOXES};
 * slice S5 the eighth, the empty cells of a ruled table under a header
 * row, see {@link DETECT_TABLES}; slice S6 the ninth and tenth, a
 * labelled row of four or more character boxes as one text field limited
 * to its boxes, and three or more option squares stacked at the builder's
 * radio gap as one radio group, see {@link DETECT_COMBS}):
 * an empty outlined box with a label, its field filling it, and three or
 * more equal blank lines under one caption, one field over them all; a run of
 * underscores typed in the text (labelled beside it, or, alone in a ruled
 * cell, by the cell to its left), a straight line with a label near it
 * (beside it, under it, at the top of the strip it closes, or on the
 * labelled line it continues), a small empty square (labelled beside it,
 * or by its row and the head of its column), the empty right cells of
 * a two-column table whose left cells each hold one label line, a row of
 * dots typed after a label that leads to nothing on its line, and an empty
 * box symbol (U+2610, U+25A1) typed beside its label. Box glyphs of symbol
 * fonts that pdf.js does not read as those code points (ZapfDingbats'
 * squares read as the letters "n" to "r") are not seen. It reads
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
  { id: "dot-leader", plain: "dotted lines after a label" },
  { id: "box-glyph", plain: "box symbols in the text" },
  { id: "entry-box", plain: "larger empty boxes to write in" },
  { id: "header-cell", plain: "empty table cells under a heading" },
  { id: "comb-boxes", plain: "rows of boxes for single letters" },
  { id: "radio-stack", plain: "stacked boxes for a single choice" },
] as const;

/** Why a shape was passed over, in the order they are decided (mostly). */
export const EXCLUSION_RULES = [
  { id: "underline" },
  { id: "full-width-divider" },
  { id: "page-band" },
  { id: "table-grid" },
  { id: "filled-cells" },
  { id: "large-table" },
  { id: "filled-box" },
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
  { id: "toc-leader" },
  { id: "ticked-box" },
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
  SIGNATURE_RE: /\b(sign(atures?|ed)?|initials)\b|^\W*initial(\s+here)?\W*$/i,
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

/**
 * The thresholds of the two shapes typed in the text itself (slice S3):
 * rows of dots and box symbols. Kept apart from {@link DETECT} so its
 * literal table stays the brief's; this one has its own literal table, and
 * each value a boundary test, in form-detect-precision.test.ts.
 */
export const DETECT_TEXT_SHAPES = {
  /**
   * A DOT LEADER is at least this many dots: full stops, each optionally
   * one space apart (". . . ."), or ellipses (each counts as
   * LEADER_ELLIPSIS_DOTS). It is a blank only after a label on its line,
   * and never when it leads to something further along its line, at any
   * distance (a page number, a price, text, a box): that is a table of
   * contents or a price list (`toc-leader`). Only the next blank's label
   * is not an entry (see `leaderCandidates`). A short one is `short-run`,
   * as a run is.
   */
  LEADER_MIN_DOTS: 8,
  LEADER_ELLIPSIS_DOTS: 3,
  /**
   * A BOX SYMBOL (U+2610 or U+25A1) is drawn as a square standing on the
   * baseline, centred in its advance. Its side is taken as the smaller of
   * the advance and BOX_SIDE_EMS x the size: inside the drawn square on
   * every face measured (form-detect-precision.test.ts), so the field sits
   * on the box a reader sees, not on the character's whole em.
   */
  BOX_SIDE_EMS: 0.75,
  /**
   * A BULLETED LIST drawn with box symbols is not a checklist: at least
   * BULLET_COLUMN_MIN boxes that each open their line, in one column
   * (within DETECT.GRID_ROW_EPS), each followed by a sentence of at least
   * BULLET_MIN_WORDS words (`bullet`). Short items ("Passport") are a
   * checklist and are proposed.
   */
  BULLET_MIN_WORDS: 8,
  BULLET_COLUMN_MIN: 3,
} as const;

/**
 * The thresholds of slice S4 (entry boxes and stacked lines), kept apart from
 * {@link DETECT} so each literal table stays its own slice's; this one's
 * literal table, and each value's boundary test, are in
 * form-detect-boxes.test.ts.
 */
export const DETECT_BOXES = {
  /**
   * An ENTRY BOX is an outlined box, closed on its own (a `re`, a closed
   * four-edge path, or four separate lines whose corners meet within
   * DETECT.JOIN_EPS), at least ENTRY_MIN_W wide and at most ENTRY_MAX_SPAN
   * of the page's width, ENTRY_MIN_H to ENTRY_MAX_H tall. With a label (the
   * search an outlined box's bottom edge already has: beside it, just over
   * its top, or just under it) and no text inside, its field fills it,
   * inset DETECT.FIELD_INSET. A box with text inside keeps the field along
   * its bottom edge that it had before (`labelled-rule`), labelled by its
   * own caption only (see `entryBoxes`), and a box of any other size is
   * read as before too. An entry box is no `full-width-divider`: that
   * exclusion (DETECT.DIVIDER_SPAN, 0.85 of the page) is for lines, and a
   * box up to ENTRY_MAX_SPAN wide with a label and nothing in it is a
   * full-width comment box (review round 1, false positives 6: decided,
   * and pinned by corpus P71). Its outline may be heavier than
   * DETECT.RULE_MAX_WIDTH.
   */
  ENTRY_MIN_W: 40,
  ENTRY_MAX_SPAN: 0.9,
  ENTRY_MIN_H: 12,
  ENTRY_MAX_H: 120,
  /**
   * A box at least max(MULTILINE_MIN_H, MULTILINE_EMS x its label's size)
   * tall (DETECT.DEFAULT_SIZE when it has no label text) is a box for
   * several lines of writing: its field is multiline.
   */
  MULTILINE_MIN_H: 36,
  MULTILINE_EMS: 2.2,
  /**
   * STACKED LINES under one label: a stack `evenRuns` finds (3 or more
   * rules whose ends line up, at an even pitch: the fewest that show a
   * pitch at all), at a pitch of STACK_PITCH_MIN up to (not including)
   * STACK_PITCH_MAX, no rule of it labelled, a box's edge or a table's row,
   * no text between its lowest and highest rule, and a caption just over
   * its highest (the search an empty box's top has): ONE multiline field
   * from its lowest rule to the top of its highest one's writing space.
   * Under the minimum pitch it is a double rule, not lines to write on.
   */
  STACK_PITCH_MIN: 12,
  STACK_PITCH_MAX: 30,
  /**
   * What is drawn within this of a box's edge is its border, not inside it
   * (a neighbour's edge drawn up against it, a fill laid under its outline
   * a little larger): see `filled-box`.
   */
  BORDER_EPS: 2,
  /**
   * A picture reaching a box's inside, up to this many times its width and
   * height, is the box's picture: a photo placed larger than its frame and
   * clipped to it, or bleeding a little past it (review round 1, false
   * positives 1). A larger one is a picture the form is drawn over.
   */
  IMAGE_BLEED: 2,
  /**
   * Level lines inside a box across at least this share of its width are
   * writing lines: a box tall enough for several lines holding only those
   * is a lined comment box, one multiline field (review round 1, guards
   * HIGH). Any other line inside it is something drawn in it.
   */
  LINED_SPAN: 0.8,
  /**
   * A box enclosed on all four sides by lines more than BORDER_EPS and at
   * most this far outside it is the inner line of a double frame (a
   * certificate's border): decoration, `filled-box` (review round 1,
   * false positives 8).
   */
  DOUBLE_GAP: 6,
  /**
   * A work bound, not a shape: what is drawn on a page is looked up in
   * cells this many points square when asking whether a box holds
   * anything, so the question costs the cells a box covers, not the page.
   */
  PAINT_CELL: 50,
} as const;

/**
 * The thresholds of slice S5 (tables: empty ruled cells), kept apart as
 * S4's are; this one's literal table, and each value's boundary test, are
 * in form-detect-tables.test.ts. Row heights reuse DETECT_BOXES' entry-box
 * bounds (a cell is a field's room), and a head over a grid reuses
 * DETECT.CAPTION_MAX; see {@link tables}.
 */
export const DETECT_TABLES = {
  /**
   * A table with more empty cells than this to suggest is not expanded:
   * it is one `large-table` entry, said in ONE summary line, so a sign-up
   * sheet does not flood the review list (200 is expanded, 201 is not).
   */
  TABLE_MAX_CELLS: 200,
  /**
   * A grid of ONE row is read only as an address strip: this many touching
   * boxes, each captioned (City | State | ZIP). More is a table's band.
   */
  STRIP_MIN_CELLS: 2,
  STRIP_MAX_CELLS: 4,
  /**
   * A fill over a whole cell at or above this luminance is a tint behind
   * it (a zebra row at 0.9, a shaded header at 0.8); darker is paint in it
   * (a redaction at 0.2, a grey "office use" column at 0.5), and the cell
   * is not empty. A fill over part of a cell is paint at any colour (a
   * chart's bar). Review round 1 of S5, false-positives HIGH.
   */
  TINT_MIN_LUM: 0.75,
} as const;

/**
 * The thresholds of slice S6 (combs and radio clusters), kept apart from
 * {@link DETECT} as S3's and S5's are; its literal table, and each value a
 * boundary test, are in form-detect-combs.test.ts.
 */
export const DETECT_COMBS = {
  /**
   * A COMB ROW (character boxes: equal squares edge to edge, the
   * `DETECT.COMB_MIN` run) becomes text fields once it holds this many
   * cells in all and has a label: one field per run, its character limit
   * the run's cell count. Fewer cells, or no label, stay `comb` (a short
   * "Age" pair or "House no." three is not worth a field of its own).
   */
  COMB_FIELD_MIN: 4,
  /**
   * Runs of a date's "DD MM YYYY" stand apart: runs on one row, of one
   * cell size, up to this many cell widths apart, with nothing lettered
   * between them (a "/" may be), are one comb row.
   */
  COMB_GROUP_GAP_CELLS: 1,
  /**
   * A comb row with nothing to its left on its row takes a CAPTION over
   * it: upright text wider than one cell, its baseline up to this far over
   * the row's top, reaching into the row's first CAPTION_SPAN. A head over
   * each cell ("D D M M") is narrower than a cell and is no caption.
   */
  COMB_CAPTION_ABOVE: 14,
  /**
   * A comb row's label on its LEFT: the nearest upright lettered text on
   * its row ending at most this far from the first box, with no printed
   * line or square between them. Within `DETECT.LABEL_LEFT_GAP` it wins;
   * farther, a caption over the row wins over it. Review round 1 of S6:
   * the search had no limit, so in a two-column form "Name ____" named a
   * comb captioned "PIN" 260 pt away, and "Office use only" one 430 pt
   * away.
   */
  COMB_LABEL_GAP: 180,
  /**
   * A SCALE, not a comb: two or more DISTINCT heads ("1 2 3 4 5",
   * "Strongly disagree ... Strongly agree") on one baseline over a run,
   * up to this far over its top, the run's stack sharing them (runs of one
   * x, length and cell size, each at most COMB_STACK_GAP_CELLS cells under
   * the one above). A rating row is ticked once, never typed into, so its
   * boxes stay `comb`. Heads that repeat ("D D M M") or are a date's
   * ("DD", "MM", "YYYY") are no scale. Review round 1 of S6.
   */
  COMB_SCALE_ABOVE: 40,
  COMB_STACK_GAP_CELLS: 2,
  /**
   * A RADIO STACK: RADIO_MIN or more equal squares in one column, each
   * labelled on its right with a label of its own, each the next one's
   * pitch apart with a gap of RADIO_STACK_GAP +- RADIO_GAP_EPS: one radio
   * group, a button per square. RADIO_STACK_GAP is a COPY of the builder's
   * (field-boxes.ts, a first-load module this chunk may not import);
   * form-detect-combs.test.ts holds the two equal. The builder stacks its
   * buttons at exactly that gap, so a stack at any other pitch could not be
   * drawn where it is printed, and stays checkboxes.
   */
  RADIO_MIN: 3,
  RADIO_STACK_GAP: 6,
  RADIO_GAP_EPS: 1,
  /** A stack's caption: upright text whose descent is 0 to this over its top square. */
  RADIO_CAPTION_ABOVE: 14,
  /**
   * Text up to this far over a stack that asks for more than one answer
   * ({@link MULTI_ANSWER}: "Tick all that apply") leaves it checkboxes, as
   * do options in the first person ({@link OWN_CHOICE}: "I agree to the
   * terms"). Two stacks side by side on the same rows stay checkboxes too,
   * unless each has a caption of its own (a list in columns). A radio
   * group allows ONE answer, so a multi-answer list made one would lose
   * answers. Review round 1 of S6, false-positives HIGH.
   */
  RADIO_VETO_ABOVE: 28,
  /**
   * The veto reads LINES, not pdf.js items, and reads on past
   * RADIO_VETO_ABOVE while lines follow at this many sizes apart (a line
   * and a blank one at 1.5 leading), up to RADIO_VETO_REACH over the top
   * square or under the bottom one; under the stack it starts at a line
   * within RADIO_VETO_BELOW ("You may tick more than one."). Verify round
   * of S6: an instruction drawn a word per call, wrapped, at the end of
   * the caption's line or two lines over it, or under the stack, went
   * unread, and the list was made one radio group.
   */
  RADIO_VETO_LEADING: 3,
  RADIO_VETO_REACH: 72,
  RADIO_VETO_BELOW: 20,
  /** Items this many sizes apart or less are one word; farther, a space. */
  WORD_GAP_EMS: 0.1,
  /** Items this many sizes apart or less are one phrase (a caption's words). */
  RADIO_PHRASE_GAP_EMS: 1,
  /**
   * The builder stacks buttons at whole points, RADIO_STACK_GAP apart, so
   * at a fractional pitch they drift off the printed squares row by row: a
   * stack whose buttons' centres would fall farther than this from their
   * squares' stays checkboxes. Review round 1 of S6 (8 options at a 17.5
   * pt pitch hung 3.8 pt off the last square).
   */
  RADIO_CENTRE_EPS: 1,
} as const;

/**
 * Words over an option stack that ask for MORE than one answer: each shape
 * a way of saying it, each caught by one of form-detect-combs.test.ts'
 * multi-answer captions, and each of those caught (house rule 1).
 */
export const MULTI_ANSWER: readonly RegExp[] = [
  // Plural only: "Which of these applies to you?" asks for one.
  /\b(?:that|which) apply\b/i,
  // Not "Select any one", which asks for one.
  /\b(?:tick|check|select|choose|mark|circle)\s+(?:all|any|each|every|several|multiple)\b(?!\s+one\b)/i,
  /\b(?:one or more|more than one|as many as)\b/i,
];

/**
 * Options that are the person's own statement, ticked each on its own
 * ("I agree to the terms", "Send me the newsletter"), never one of a set.
 */
export const OWN_CHOICE: readonly RegExp[] = [
  /^(?:I|we)\b/i,
  /^(?:send|email|keep|sign|add|contact|call|text) me\b/i,
];

/** Box symbols, empty: a ballot box and a white square. */
export const EMPTY_BOXES: readonly string[] = [cp(0x2610), cp(0x25a1)];
/** Box symbols already answered: with a tick, with a cross (`ticked-box`). */
export const TICKED_BOXES: readonly string[] = [cp(0x2611), cp(0x2612)];

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
  /**
   * Each code point's advance in points, summing to `width`, read from the
   * glyphs the page draws (./form-detect-glyphs), when every one is known.
   * Places a run, a row of dots or a box symbol where it is drawn.
   */
  advances?: readonly number[];
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
  /** The boxes images are painted into, when known (an image frame's picture). */
  images?: Box[];
  /** The boxes of painted curves, when known (a logo, a pie, a scribble). */
  curves?: Box[];
}

/** Where a field might go, in the same frame as its page. Whole points. */
export interface FieldProposal {
  key: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  type: "text" | "checkbox" | "radio";
  label: string | null;
  rule: DetectionRuleId;
  /**
   * Set (true) only on a text field meant for several lines: a tall entry
   * box, or one field over stacked lines. The builder's card then has
   * "Multiple lines" on, and the saved field its multiline flag.
   */
  multiline?: true;
  /**
   * A comb's text field (slice S6): its character limit, the number of
   * boxes it spans. The card's "Max length", and the saved field's
   * /MaxLen. (No comb flag: the builder has no way to set one.)
   */
  maxLength?: number;
  /**
   * A radio group (slice S6): its choices, top to bottom, one button per
   * printed square. The box above is the TOP button's; the builder stacks
   * the rest downward from it at its own gap (`fieldBoxes`).
   */
  options?: string[];
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
  /** Tables of over DETECT_TABLES.TABLE_MAX_CELLS empty cells, not expanded. */
  largeTables: number;
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
    largeTables: 0,
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
  if (t.advances && t.advances.length === chars.length) {
    const spans: [number, number][] = [];
    let x = t.x;
    for (const a of t.advances) {
      spans.push([x, x + a]);
      x += a;
    }
    return spans;
  }
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
  /** A text piece that is a row of dots, or one box symbol. */
  tag?: "leader" | "box";
  x0: number;
  x1: number;
  baseline: number;
  size: number;
  item: number;
  /** Character range within the item (code points). */
  from: number;
  to: number;
}

const BOX_SET = new Set([...EMPTY_BOXES, ...TICKED_BOXES]);
/** Text after a box that makes it a legend's key ("[] = not applicable"). */
const LEGEND = /^\s*[=\u2261]/u;
/** A line number or a list marker in a margin: "12", "a)", "3.", "iv.". */
const MARGIN_MARK = /^(?:\p{N}{1,4}|[\p{L}\p{N}]{1,4}[.)])$/u;
const isBox = (ch: string) => BOX_SET.has(ch);
const ELLIPSIS = cp(0x2026);
// Dots, each optionally one space from the next; counted below.
const LEADER_RUN = new RegExp(`[.${ELLIPSIS}](?: ?[.${ELLIPSIS}])+`, "g");
const leaderDots = (s: string) =>
  Array.from(s).reduce(
    (n, ch) =>
      n +
      (ch === "."
        ? 1
        : ch === ELLIPSIS
          ? DETECT_TEXT_SHAPES.LEADER_ELLIPSIS_DOTS
          : 0),
    0,
  );

/** Code-point ranges [from, to) of each match of `re` in `chars`. */
function ranges(
  chars: readonly string[],
  re: RegExp,
  keep: (m: string) => boolean = () => true,
): [number, number][] {
  const out: [number, number][] = [];
  const joined = chars.join("");
  for (const m of joined.matchAll(re)) {
    if (!keep(m[0])) continue;
    const from = Array.from(joined.slice(0, m.index)).length;
    out.push([from, from + Array.from(m[0]).length]);
  }
  return out;
}

/**
 * An item split into underscore runs, rows of dots, box symbols and the
 * words around them. A row of dots and a box symbol are text pieces (they
 * block another shape's field like any text) tagged so their own rules
 * can find them.
 */
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
  // Code-point offsets of each special range, by where it starts.
  const special = new Map<
    number,
    { to: number; kind: Piece["kind"]; tag?: Piece["tag"] }
  >();
  for (const [a, b] of ranges(chars, UNDERSCORE_RUN))
    special.set(a, { to: b, kind: "run" });
  for (const [a, b] of ranges(
    chars,
    LEADER_RUN,
    (m) => leaderDots(m) >= DETECT_TEXT_SHAPES.LEADER_MIN_DOTS,
  ))
    special.set(a, { to: b, kind: "text", tag: "leader" });
  chars.forEach((ch, i) => {
    if (isBox(ch)) special.set(i, { to: i + 1, kind: "text", tag: "box" });
  });
  const inSpecial = new Array<boolean>(chars.length).fill(false);
  for (const [a, r] of special)
    for (let k = a; k < r.to; k++) inSpecial[k] = true;
  const piece = (
    from: number,
    to: number,
    kind: Piece["kind"],
    tag?: Piece["tag"],
  ): Piece => ({
    kind,
    ...(tag ? { tag } : {}),
    x0: spans[from]![0],
    x1: spans[to - 1]![1],
    baseline: t.y,
    size: t.size,
    item,
    from,
    to,
  });
  let i = 0;
  while (i < chars.length) {
    const r = special.get(i);
    if (r) {
      out.push(piece(i, r.to, r.kind, r.tag));
      i = r.to;
      continue;
    }
    if (isSpace(chars[i]!)) {
      i++;
      continue;
    }
    let j = i;
    while (j < chars.length && !isSpace(chars[j]!) && !inSpecial[j]) j++;
    out.push(piece(i, j, "text"));
    i = j;
  }
  return out;
}

const TRAILING = /[\s:.\-\u2013\u2014]/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const LETTER = /\p{L}/u;
const DIGIT = /\p{Nd}/u;
const WORD = /[\p{L}\p{N}]+/gu;
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
  boxBottom?: { top: number; rect: CardRect };
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
  /** The top edge of an outlined box, with the box, while merged with nothing. */
  topOf?: CardRect;
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
 *
 * Slice S4: edges an ENTRY BOX could have ({@link DETECT_BOXES}: level ones
 * ENTRY_MIN_W to ENTRY_MAX_SPAN of the page wide, plumb ones ENTRY_MIN_H to
 * ENTRY_MAX_H tall) are joined the same way, so a box drawn as four lines
 * is read as one drawn with `re`.
 */
function joinSquares(
  segs: readonly CardSeg[],
  pageWidth: number,
): {
  rects: CardRect[];
  used: Set<CardSeg>;
} {
  const eps = DETECT.JOIN_EPS;
  const side = (len: number) =>
    len >= DETECT.SQUARE_MIN - eps && len <= DETECT.SQUARE_MAX + eps;
  const fitsLevel = (len: number) =>
    side(len) ||
    (len >= DETECT_BOXES.ENTRY_MIN_W - eps &&
      len <= DETECT_BOXES.ENTRY_MAX_SPAN * pageWidth + eps);
  const fitsPlumb = (len: number) =>
    side(len) ||
    (len >= DETECT_BOXES.ENTRY_MIN_H - eps &&
      len <= DETECT_BOXES.ENTRY_MAX_H + eps);
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
    if (dy <= eps && fitsLevel(dx)) {
      const l = {
        x0: Math.min(s.x0, s.x1),
        x1: Math.max(s.x0, s.x1),
        y: (s.y0 + s.y1) / 2,
        s,
      };
      add(levels, key(l.x0, l.y), l);
      bottoms.push(l);
    } else if (dx <= eps && fitsPlumb(dy)) {
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

/**
 * Outlined boxes with a box drawn again within GRID_TOUCH_EPS of it on
 * every side (a doubled bold border, slice S5) kept once, the larger: two
 * copies 1 pt apart touched each other's plumb lines and passed the box
 * over as a table's (`table-grid`). Copies further apart stay two boxes,
 * one a `duplicate` (S4). Filled boxes are left as they are (a fill under
 * an outline is the box's fill). Each box is looked up by its lower-left
 * corner, and a corner crowded past DETECT.JOIN_CROWD is not looked through,
 * so the cost stays linear in the page's boxes.
 */
function onceEach(rects: CardRect[]): CardRect[] {
  const eps = DETECT.GRID_TOUCH_EPS;
  const key = (x: number, y: number) => `${Math.round(x)}|${Math.round(y)}`;
  const byCorner = new Map<string, number[]>();
  const kept: CardRect[] = [];
  const same = (a: CardRect, b: CardRect) =>
    Math.abs(a.x0 - b.x0) <= eps &&
    Math.abs(a.y0 - b.y0) <= eps &&
    Math.abs(a.x1 - b.x1) <= eps &&
    Math.abs(a.y1 - b.y1) <= eps;
  for (const r of rects) {
    if (!r.stroked || r.filled) {
      kept.push(r);
      continue;
    }
    let hit = -1;
    let n = 0;
    for (const dx of [-1, 0, 1])
      for (const dy of [-1, 0, 1]) {
        const list = byCorner.get(key(r.x0 + dx, r.y0 + dy)) ?? [];
        n += list.length;
        if (n <= DETECT.JOIN_CROWD)
          for (const i of list) if (hit < 0 && same(kept[i]!, r)) hit = i;
      }
    if (hit >= 0) {
      const o = kept[hit]!;
      if ((r.x1 - r.x0) * (r.y1 - r.y0) > (o.x1 - o.x0) * (o.y1 - o.y0))
        kept[hit] = r;
      continue;
    }
    const k = key(r.x0, r.y0);
    const list = byCorner.get(k);
    if (list) list.push(kept.length);
    else byCorner.set(k, [kept.length]);
    kept.push(r);
  }
  return kept;
}

/** The page's level rules, plumb lines and squares. */
function readLines(p: CardPage): PageLines {
  const raw: Line[] = [];
  const verticals: PageLines["verticals"] = [];
  const squares: CardRect[] = [];
  const joined = joinSquares(p.segs, p.width);
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
  for (const r of onceEach([...p.rects, ...joined.rects])) {
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    if (isSquare(r)) {
      squares.push(r);
    } else if (r.filled && h <= DETECT.RULE_MAX_WIDTH && w > h) {
      raw.push({ x0: r.x0, x1: r.x1, y: (r.y0 + r.y1) / 2, w: h });
    } else if (r.filled && w <= DETECT.RULE_MAX_WIDTH && h > w) {
      verticals.push({ x: (r.x0 + r.x1) / 2, y0: r.y0, y1: r.y1 });
    } else if (
      r.stroked &&
      (r.width <= DETECT.RULE_MAX_WIDTH || entrySized(r, p.width))
    ) {
      // A larger outlined box: its edges are lines like any other, except
      // that its top edge takes no caption from inside the box. An entry
      // box's outline may be heavier than a rule (a 3 pt frame passed with
      // no reason given: review round 1 of slice S4, geometry 3).
      raw.push(
        {
          x0: r.x0,
          x1: r.x1,
          y: r.y0,
          w: r.width,
          boxBottom: { top: r.y1, rect: r },
        },
        { x0: r.x0, x1: r.x1, y: r.y1, w: r.width, boxTop: true, topOf: r },
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
      // Merged with anything, it is no one box's bottom (or top) any more.
      delete hit.boxBottom;
      delete hit.topOf;
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
  type: "text" | "checkbox" | "radio";
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
  /**
   * A row of dots that leads to something at its line's end (a page
   * number, a price, text, a box): `toc-leader`.
   */
  leadsTo?: boolean;
  /** A box symbol: answered, one of a row of character boxes, a bullet. */
  glyph?: { ticked: boolean; comb: boolean; bullet: boolean };
  /** A field for several lines (a tall entry box, or stacked lines). */
  multiline?: boolean;
  /**
   * The bottom edge of an entry-sized box that holds something drawn or
   * painted: a fill, a picture, or other lines or boxes (`filled-box`).
   */
  boxPainted?: boolean;
  /** A comb's text field: its cell count (slice S6). */
  maxLength?: number;
  /**
   * A radio stack (slice S6): its choices top to bottom, and its top
   * button in whole points. `box` is the whole printed stack.
   */
  radio?: { options: string[]; top: Edges };
  /**
   * The box is what was printed and is never lowered under text above it:
   * text over it is text ON it (a comb's cells, a radio stack), as with a
   * checkbox (see {@link clearBox}).
   */
  fixed?: boolean;
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
function boxCaption(
  ix: TextIndex,
  r: Line,
  top: number,
  reach: number = DETECT.CAPTION_MAX,
): LabelHit | null {
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
  } else if (inside.length === 0) cap = overTop(ix, r, top, reach);
  if (!cap || !cap.upright) return null;
  const str = cleanLabel(cap.str);
  if (!str) return null;
  const s = cap.str.trim();
  const notice =
    DETECT.NOTICE_END_RE.test(s) &&
    s.split(/\s+/).length >= DETECT.NOTICE_MIN_WORDS;
  return notice ? null : { text: cap, str };
}

/**
 * The nearest upright text just over a box's top (its descent 0 to `reach`
 * over it, reaching into the box's first CAPTION_SPAN), whatever the box
 * holds: {@link boxCaption}'s caption of an empty box.
 */
function overTop(
  ix: TextIndex,
  r: Pick<Line, "x0" | "x1">,
  top: number,
  reach: number = DETECT.CAPTION_MAX,
): CardText | undefined {
  const span = r.x0 + DETECT.CAPTION_SPAN * (r.x1 - r.x0);
  const lo = top + DETECT.TEXT_DESCENT_EMS * ix.minSize;
  const hi = top + reach + DETECT.TEXT_DESCENT_EMS * ix.maxSize;
  let cap: CardText | undefined;
  for (const t of textBand(ix, lo, hi)) {
    if (!t.upright || overlap(t.x, t.x + Math.max(0, t.width), r.x0, span) <= 0)
      continue;
    const gap = t.y - DETECT.TEXT_DESCENT_EMS * t.size - top;
    if (gap < 0 || gap > reach) continue;
    if (!cap || t.y < cap.y) cap = t;
  }
  return cap;
}

/** A line's candidate, whether a caption labelled it, and that text's size. */
interface RuleRow {
  c: Candidate;
  captioned: boolean;
  size: number | undefined;
  /** The caption under the line that labelled it, when one did. */
  under?: CardText;
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
    // A box's edge is no continuation line, nor does it hand one on: the
    // label beside one box ran down the boxes under it (review round 1 of
    // slice S4, false positives 5).
    if (r.boxTop || r.boxBottom) return;
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
    if (!above || above.boxTop || above.boxBottom) return;
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

/** Whether an outlined box is an entry box's size ({@link DETECT_BOXES}). */
function entrySized(r: CardRect, pageWidth: number): boolean {
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  return (
    w >= DETECT_BOXES.ENTRY_MIN_W &&
    w <= DETECT_BOXES.ENTRY_MAX_SPAN * pageWidth &&
    h >= DETECT_BOXES.ENTRY_MIN_H &&
    h <= DETECT_BOXES.ENTRY_MAX_H
  );
}

/**
 * What is drawn on a page, for the questions an outlined box asks of it:
 * `holds`, what it holds inside besides its own edges, and `framed`,
 * whether it is the inner line of a double frame. See {@link DETECT_BOXES}
 * for each threshold. What is drawn is looked up in cells PAINT_CELL
 * square, filed only in the cells over the page (a line 4,000,000 pt long
 * once filed itself in 80,000), so each question costs the cells its box
 * covers, not the page.
 */
interface Paint {
  /**
   * "something": a stroke reaching its inside (the box less BORDER_EPS
   * each side, so a neighbour's edge drawn up against it is not inside),
   * other than a writing line; a fill lying within it (within BORDER_EPS:
   * its own fill counts); a picture reaching its inside, up to IMAGE_BLEED
   * x its width and height (clipped to the box, or bleeding past it); or
   * a curve reaching its inside no larger than it and its border. A fill
   * larger than the box, or a picture larger than that (a tinted panel, a
   * page-sized picture behind a form), is behind it, not in it.
   * "lines": only writing lines, level strokes across LINED_SPAN of its
   * width or more (a lined comment box). "nothing": neither.
   */
  holds(r: CardRect): "nothing" | "lines" | "something";
  /**
   * What paint a TABLE CELL holds (slice S5). "mark": a stroke, picture or
   * curve, as {@link holds} reads them (a tick, an X, a stamp), or a fill
   * reaching its inside (the cell less BORDER_EPS each side) that does not
   * cover the whole cell (within BORDER_EPS: a chart's bar, a redacted
   * word): the cell holds something, as text would. "dark": none of those,
   * but a fill over the whole cell darker than DETECT_TABLES.TINT_MIN_LUM
   * (a grey "office use" column, a redaction over whole rows): the cell is
   * shut, neither a blank nor an entry. Null: nothing, or only a light tint
   * over the whole cell (a zebra row, a shaded header), which is behind
   * it. Every fill counts, whatever its size.
   */
  painted(r: Edges): "mark" | "dark" | null;
  /**
   * Whether level and plumb strokes enclose it on all four sides, each
   * more than BORDER_EPS and at most DOUBLE_GAP outside its edge: the inner
   * box of a double frame (a certificate's border), decoration.
   */
  framed(r: CardRect): boolean;
}

function paintedIndex(p: CardPage): Paint {
  const STEP = DETECT_BOXES.PAINT_CELL;
  const e = DETECT_BOXES.BORDER_EPS;
  const bleed = DETECT_BOXES.IMAGE_BLEED;
  type Mark = Edges & { kind: "stroke" | "fill" | "image" | "curve" };
  const cells = new Map<string, Mark[]>();
  // Every fill, any size, with its colour, for `painted` (S5).
  const fills = new Map<string, (Edges & { lum: number })[]>();
  const cell = (v: number) => Math.floor(v / STEP);
  // The page's cells, one more each side: nothing past them is asked about.
  const I = [cell(0) - 1, cell(p.width) + 1];
  const J = [cell(0) - 1, cell(p.height) + 1];
  const span = (lo: number, hi: number, [a, b]: number[]) => [
    Math.max(a!, cell(lo)),
    Math.min(b!, cell(hi)),
  ];
  const each = (m: Edges, f: (k: string) => boolean | void) => {
    const [i0, i1] = span(m.x0, m.x1, I);
    const [j0, j1] = span(m.y0, m.y1, J);
    for (let i = i0!; i <= i1!; i++)
      for (let j = j0!; j <= j1!; j++) if (f(`${i}|${j}`)) return true;
    return false;
  };
  const put = (m: Mark) => {
    if ([m.x0, m.y0, m.x1, m.y1].some(Number.isNaN)) return;
    each(m, (k) => {
      const list = cells.get(k);
      if (list) list.push(m);
      else cells.set(k, [m]);
    });
  };
  const maxW = DETECT_BOXES.ENTRY_MAX_SPAN * p.width;
  const maxH = DETECT_BOXES.ENTRY_MAX_H;
  const box = (b: Box, kind: Mark["kind"]) =>
    put({ x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height, kind });
  const line = (x0: number, y0: number, x1: number, y1: number) =>
    put({
      x0: Math.min(x0, x1),
      y0: Math.min(y0, y1),
      x1: Math.max(x0, x1),
      y1: Math.max(y0, y1),
      kind: "stroke",
    });
  for (const s of p.segs) line(s.x0, s.y0, s.x1, s.y1);
  for (const r of p.rects) {
    if (r.stroked) {
      line(r.x0, r.y0, r.x1, r.y0);
      line(r.x1, r.y0, r.x1, r.y1);
      line(r.x1, r.y1, r.x0, r.y1);
      line(r.x0, r.y1, r.x0, r.y0);
    }
    if (r.filled && r.x1 - r.x0 <= maxW && r.y1 - r.y0 <= maxH)
      put({ x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, kind: "fill" });
    if (r.filled && ![r.x0, r.y0, r.x1, r.y1].some(Number.isNaN)) {
      const f = { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, lum: r.lum };
      each(f, (k) => {
        const list = fills.get(k);
        if (list) list.push(f);
        else fills.set(k, [f]);
      });
    }
  }
  // Only what some entry box could count is filed.
  for (const b of p.images ?? [])
    if (b.width <= bleed * maxW && b.height <= bleed * maxH) box(b, "image");
  for (const b of p.curves ?? [])
    if (b.width <= maxW + 2 * e && b.height <= maxH + 2 * e) box(b, "curve");
  const level = (m: Edges) => m.y1 - m.y0 <= DETECT.RULE_MAX_DY;
  const plumb = (m: Edges) => m.x1 - m.x0 <= DETECT.RULE_MAX_DY;
  return {
    holds(r) {
      const w = r.x1 - r.x0;
      const h = r.y1 - r.y0;
      const inner = { x0: r.x0 + e, y0: r.y0 + e, x1: r.x1 - e, y1: r.y1 - e };
      const reaches = (m: Mark) =>
        m.x0 <= inner.x1 &&
        m.x1 >= inner.x0 &&
        m.y0 <= inner.y1 &&
        m.y1 >= inner.y0;
      let lines = false;
      const something = (m: Mark): boolean => {
        if (m.kind === "fill")
          return (
            m.x0 >= r.x0 - e &&
            m.x1 <= r.x1 + e &&
            m.y0 >= r.y0 - e &&
            m.y1 <= r.y1 + e
          );
        if (!reaches(m)) return false;
        const mw = m.x1 - m.x0;
        const mh = m.y1 - m.y0;
        if (m.kind === "image") return mw <= bleed * w && mh <= bleed * h;
        if (m.kind === "curve") return mw <= w + 2 * e && mh <= h + 2 * e;
        if (level(m) && mw >= DETECT_BOXES.LINED_SPAN * w) {
          lines = true;
          return false;
        }
        return true;
      };
      if (each(inner, (k) => (cells.get(k) ?? []).some(something)))
        return "something";
      return lines ? "lines" : "nothing";
    },
    painted(r) {
      const inner = { x0: r.x0 + e, y0: r.y0 + e, x1: r.x1 - e, y1: r.y1 - e };
      const reaches = (m: Edges) =>
        m.x0 <= inner.x1 &&
        m.x1 >= inner.x0 &&
        m.y0 <= inner.y1 &&
        m.y1 >= inner.y0;
      const part = (f: Edges) =>
        f.x0 > r.x0 + e ||
        f.x1 < r.x1 - e ||
        f.y0 > r.y0 + e ||
        f.y1 < r.y1 - e;
      let dark = false;
      const fill = (f: Edges & { lum: number }) => {
        if (!reaches(f)) return false;
        if (part(f)) return true;
        if (f.lum < DETECT_TABLES.TINT_MIN_LUM) dark = true;
        return false;
      };
      if (each(inner, (k) => (fills.get(k) ?? []).some(fill))) return "mark";
      // Strokes, pictures and curves as `holds` reads them (its fills are
      // read above instead: a light tint drawn cell by cell is behind).
      const w = r.x1 - r.x0;
      const h = r.y1 - r.y0;
      const mark = (m: Mark): boolean => {
        if (m.kind === "fill" || !reaches(m)) return false;
        const mw = m.x1 - m.x0;
        const mh = m.y1 - m.y0;
        if (m.kind === "image") return mw <= bleed * w && mh <= bleed * h;
        if (m.kind === "curve") return mw <= w + 2 * e && mh <= h + 2 * e;
        return !(level(m) && mw >= DETECT_BOXES.LINED_SPAN * w);
      };
      if (each(inner, (k) => (cells.get(k) ?? []).some(mark))) return "mark";
      return dark ? "dark" : null;
    },
    framed(r) {
      const g = DETECT_BOXES.DOUBLE_GAP;
      const out = { x0: r.x0 - g, y0: r.y0 - g, x1: r.x1 + g, y1: r.y1 + g };
      const near = (d: number) => d > e && d <= g;
      const side = [false, false, false, false];
      each(out, (k) => {
        for (const m of cells.get(k) ?? []) {
          if (m.kind !== "stroke") continue;
          if (level(m) && m.x0 <= r.x0 && m.x1 >= r.x1) {
            if (near(r.y0 - m.y1)) side[0] = true;
            if (near(m.y0 - r.y1)) side[1] = true;
          } else if (plumb(m) && m.y0 <= r.y0 && m.y1 >= r.y1) {
            if (near(r.x0 - m.x1)) side[2] = true;
            if (near(m.x0 - r.x1)) side[3] = true;
          }
        }
        return side.every(Boolean);
      });
      return side.every(Boolean);
    },
  };
}

/**
 * Whether any text stands inside a box: a non-blank item whose baseline is
 * between its edges and which reaches past its left or right edge's inset
 * (a label ending at the box's edge is beside it, not in it).
 */
function textInside(ix: TextIndex, r: Edges): boolean {
  const e = DETECT.FIELD_INSET;
  return textBand(ix, r.y0, r.y1).some(
    (t) =>
      t.str.trim() !== "" &&
      t.y > r.y0 &&
      t.y < r.y1 &&
      overlap(t.x, t.x + Math.max(0, t.width), r.x0 + e, r.x1 - e) > 0,
  );
}

/**
 * Entry boxes ({@link DETECT_BOXES}), run after the label passes so each
 * label is settled. Each outlined box of an entry box's size, by its
 * bottom edge's row:
 *
 *  - gives up a caption UNDER it that is nearer the top of another box
 *    below (that box's caption: in captioned boxes stacked down a page,
 *    every box took the next one's), or any caption under it when it
 *    holds text (a boxed paragraph took the next heading): it is then
 *    labelled by its own caption ({@link boxCaption}), or by nothing;
 *  - holding text, stays the line along its bottom it was before S4;
 *  - otherwise becomes an `entry-box` whose field fills it (inset
 *    DETECT.FIELD_INSET; an excluded one's box is that inner box too),
 *    multiline when it is tall for its label, `boxPainted` (for
 *    `filled-box`) when it holds something, or only writing lines while it
 *    is too low for several lines, or is a double frame's inner box. Its
 *    field stands for its top edge (a field in the gap over the box, under
 *    the label of the box above it, was proposed too) and for the writing
 *    lines of a lined box, so their own candidates are dropped.
 */
function entryBoxes(
  p: CardPage,
  ix: TextIndex,
  rows: Map<Line, RuleRow>,
  out: Candidate[],
): void {
  const boxes: [Line, RuleRow, CardRect][] = [];
  for (const [r, row] of rows) {
    const rect = r.boxBottom?.rect;
    if (rect && entrySized(rect, p.width)) boxes.push([r, row, rect]);
  }
  if (boxes.length === 0) return;
  const paint = paintedIndex(p);
  const overGap = new Map<CardText, number>();
  for (const [r, , rect] of boxes) {
    const t = overTop(ix, r, rect.y1);
    if (!t) continue;
    const g = t.y - DETECT.TEXT_DESCENT_EMS * t.size - rect.y1;
    overGap.set(t, Math.min(g, overGap.get(t) ?? Infinity));
  }
  const e = DETECT.FIELD_INSET;
  const tops = new Set<CardRect>();
  const lined: CardRect[] = [];
  for (const [r, row, rect] of boxes) {
    const inside = textInside(ix, rect);
    const t = row.under;
    // (`under` is set only with `captioned`. A check that it was still the
    // row's label, which `stripCaptions` can move, survived its deletion
    // over the whole corpus, as did one of `captioned`: review round 1,
    // guards LOW; both removed.)
    if (
      t &&
      (inside ||
        (overGap.get(t) ?? Infinity) <
          r.y - (t.y + DETECT.TEXT_ASCENT_EMS * t.size))
    ) {
      const cap = boxCaption(ix, r, rect.y1);
      row.c.label = cap?.str ?? null;
      row.c.labelState = cap ? "found" : "none";
      row.size = cap?.text.size;
      row.c.box.y1 =
        row.c.box.y0 +
        textHeight(row.size ?? DETECT.DEFAULT_SIZE, DETECT.TEXT_H_RULE);
    }
    if (inside) continue;
    const h = rect.y1 - rect.y0;
    const tall =
      h >=
      Math.max(
        DETECT_BOXES.MULTILINE_MIN_H,
        DETECT_BOXES.MULTILINE_EMS * (row.size ?? DETECT.DEFAULT_SIZE),
      );
    const held = paint.holds(rect);
    row.c.boxPainted =
      held === "something" || (held === "lines" && !tall) || paint.framed(rect);
    if (held === "lines" && !row.c.boxPainted) lined.push(rect);
    tops.add(rect);
    row.c.rule = "entry-box";
    row.c.box = {
      x0: rect.x0 + e,
      y0: rect.y0 + e,
      x1: rect.x1 - e,
      y1: rect.y1 - e,
    };
    row.c.multiline = tall;
  }
  const drop = new Set<Line>();
  for (const r of rows.keys()) if (r.topOf && tops.has(r.topOf)) drop.add(r);
  if (lined.length > 0) {
    const ys = [...rows.keys()]
      .filter((r) => Number.isFinite(r.y))
      .sort((a, b) => a.y - b.y);
    for (const b of lined)
      for (
        let i = from(ys, (r) => r.y, b.y0 + e);
        i < ys.length && ys[i]!.y < b.y1 - e;
        i++
      ) {
        const r = ys[i]!;
        if (r.x0 >= b.x0 - e && r.x1 <= b.x1 + e) drop.add(r);
      }
  }
  if (drop.size === 0) return;
  for (const r of drop) rows.delete(r);
  const kept = out.filter((c) => !(c.line && drop.has(c.line)));
  out.length = 0;
  out.push(...kept);
}

/**
 * Stacked lines under one label ({@link DETECT_BOXES.STACK_PITCH_MIN}): each
 * stack becomes ONE multiline `labelled-rule` field, labelled by the caption
 * over its highest rule (up to a pitch over it, a blank line between them,
 * when it is small enough for lines that far apart), and its rules' own
 * candidates (all unlabelled) are dropped from `out`. A stack with any
 * line labelled, or with no candidate of its own (an entry box's dropped
 * top edge or writing line), is left alone, so labelled lines stay one
 * field each, as is one whose caption has other text beside it past its
 * own span over the lines: column headings over a ledger's rules, not one
 * caption. (A box's edge or a rows table's rule needs no test of its own:
 * a captioned box's bottom is labelled, an entry box's top edge is
 * dropped with it, and a table's rules are labelled by its row text or
 * passed over as `table-grid`. Tests for them, for text between the
 * lines, which labels a line first, and for a rule an earlier stack took
 * (two runs share a rule only where the pitch changes, and a caption over
 * the lower run's top labels a line of the upper one), survived their own
 * deletion over the whole corpus: review round 1, guards LOW; removed.)
 */
function stackedLines(
  lines: PageLines,
  rows: Map<Line, RuleRow>,
  ix: TextIndex,
  out: Candidate[],
): void {
  const used = new Set<Line>();
  const made: Candidate[] = [];
  for (const { run } of evenRuns(lines.rules)) {
    const pitch = run[1]!.y - run[0]!.y;
    if (
      pitch < DETECT_BOXES.STACK_PITCH_MIN ||
      pitch >= DETECT_BOXES.STACK_PITCH_MAX
    )
      continue;
    if (run.some((r) => rows.get(r)?.c.labelState !== "none")) continue;
    const low = run[0]!;
    const top = run[run.length - 1]!;
    const x0 = Math.min(...run.map((r) => r.x0));
    const x1 = Math.max(...run.map((r) => r.x1));
    const cap = boxCaption(
      ix,
      { x0, x1, y: low.y },
      top.y,
      Math.max(DETECT.CAPTION_MAX, pitch),
    );
    if (!cap) continue;
    // Past a caption's usual reach, only text small enough to be a label
    // for lines this far apart: a 24 pt title 17 pt over 22 pt lines is no
    // caption of theirs.
    const t = cap.text;
    if (
      t.y - DETECT.TEXT_DESCENT_EMS * t.size - top.y > DETECT.CAPTION_MAX &&
      DETECT.TITLE_LARGER * t.size > pitch
    )
      continue;
    const span = x0 + DETECT.CAPTION_SPAN * (x1 - x0);
    const eps = DETECT.GRID_ROW_EPS;
    if (
      textBand(ix, t.y - eps, t.y + eps).some(
        (t) => t.str.trim() !== "" && t.x >= span && t.x < x1,
      )
    )
      continue;
    run.forEach((r) => used.add(r));
    const bottom = low.y + DETECT.RULE_BOTTOM_GAP;
    made.push({
      rule: "labelled-rule",
      type: "text",
      box: {
        x0: x0 + DETECT.FIELD_INSET,
        x1: x1 - DETECT.FIELD_INSET,
        y0: bottom,
        y1:
          top.y +
          DETECT.RULE_BOTTOM_GAP +
          textHeight(t.size, DETECT.TEXT_H_RULE),
      },
      line: top,
      square: null,
      label: cap.str,
      labelState: "found",
      leftLabel: false,
      ownPiece: null,
      order: 0,
      multiline: true,
    });
  }
  if (used.size === 0) return;
  for (const r of used) rows.delete(r);
  const kept = out.filter((c) => !(c.line && used.has(c.line)));
  out.length = 0;
  out.push(...kept, ...made);
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
    let under: CardText | undefined;
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
        under = captions.find((h) => h.str === cap.label)?.text;
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
    rows.set(r, { c, captioned, size, under });
  }
  stripCaptions(lines, rows, rowTable);
  continuationLines(p, rows);
  // Slice S4, once every label is settled.
  entryBoxes(p, ix, rows, out);
  stackedLines(lines, rows, ix, out);
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

/** Each item's pieces, in order, in one pass over the page's pieces. */
function piecesByItem(all: readonly Piece[]): Map<number, Piece[]> {
  const byItem = new Map<number, Piece[]>();
  for (const pc of all) {
    const list = byItem.get(pc.item);
    if (list) list.push(pc);
    else byItem.set(pc.item, [pc]);
  }
  return byItem;
}

/**
 * Rows of dots typed after a label ("Name ............"): a text field over
 * the dots, as for a run of underscores. The label is the text before the
 * dots in the same item (back to the previous run or row of dots), else the
 * nearest upright item ending within {@link DETECT.LABEL_LEFT_GAP} to their
 * left on their baseline. A row with nothing before it is `unlabelled`.
 *
 * What follows the dots decides whether they are a blank at all. Text
 * after them in their item, or the nearest upright item or drawn square to
 * their right on their baseline, AT ANY DISTANCE, is what they LEAD TO
 * ("Chapter 3 ........ 47", "Coffee ........ $3.00", a page number
 * right-aligned at the margin, "Helpful ...... []"), and they are
 * `toc-leader`, unless that text is the next blank's label: followed by
 * dots or a run in its own item, or by an item that starts with dots or a
 * run, a drawn square or a drawn line within {@link DETECT.LABEL_LEFT_GAP}
 * of its end ("Name ........ Date ........", two blanks); or is itself
 * fields with labels, box symbols and words ("Date ........  [] Yes [] No"). Review round 1
 * of slice S3 (finding 1): a reach of 24 pt let every line of a table of
 * contents whose page numbers sat further off through as a blank.
 */
function leaderCandidates(
  p: CardPage,
  byItem: ReadonlyMap<number, Piece[]>,
  ix: TextIndex,
  squares: YIndex<CardRect>,
  rules: YIndex<Line>,
): { cands: Candidate[]; short: Edges[] } {
  const cands: Candidate[] = [];
  const short: Edges[] = [];
  const itemOf = new Map(p.text.map((t, i) => [t, i]));
  const piecesOf = (t: CardText) => byItem.get(itemOf.get(t)!) ?? [];
  const blank = (q: Piece) => q.kind === "run" || q.tag === "leader";
  /** An item holding a box symbol and words: fields with labels ("[] Yes"). */
  const labelledBox = (t: CardText) => {
    const own = piecesOf(t);
    return (
      own.some((q) => q.tag === "box") &&
      own.some((q) => q.kind === "text" && q.tag === undefined)
    );
  };
  /**
   * Something a label is followed by, starting within LABEL_LEFT_GAP after
   * `end` on the band [lo, hi]: an upright item that starts with dots or a
   * run, a drawn square, or a drawn line under the band.
   */
  const blankAfter = (
    band: readonly CardText[],
    self: CardText,
    end: number,
    lo: number,
    hi: number,
    size: number,
  ) => {
    const near = (x: number) =>
      x >= end - 1 && x - end <= DETECT.LABEL_LEFT_GAP;
    for (const o of band) {
      if (o === self || !o.upright || !near(o.x)) continue;
      const first = piecesOf(o)[0];
      if (first && blank(first)) return true;
    }
    for (const sq of ySlice(squares, lo - DETECT.SQUARE_MAX, hi))
      if (near(sq.x0) && sq.y1 >= lo) return true;
    for (const r of ySlice(
      rules,
      lo - DETECT.LABEL_ABOVE_RULE_EMS * size,
      hi + DETECT.LABEL_BELOW_RULE,
    ))
      if (near(r.x0)) return true;
    return false;
  };
  p.text.forEach((t, item) => {
    if (!t.upright) return;
    const mine = byItem.get(item) ?? [];
    if (!mine.some((q) => q.tag === "leader")) return;
    const chars = Array.from(t.str);
    mine.forEach((pc, k) => {
      if (pc.tag !== "leader") return;
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
      const lo = t.y - DETECT.RUN_BASELINE_EMS * t.size;
      const hi = t.y + DETECT.RUN_BASELINE_EMS * t.size;
      const band = textBand(ix, lo, hi);
      // The label: back to the previous run or row of dots in the item.
      const prev = mine.slice(0, k).reverse().find(blank);
      let label = cleanLabel(chars.slice(prev ? prev.to : 0, pc.from).join(""));
      let state: Candidate["labelState"] = label ? "found" : "none";
      if (!label && !prev) {
        // An item to the left holding dots or a run is labelled by its
        // words after the last of them ("Name ........ Date" read as one
        // item by pdf.js): the dots are never part of a label.
        const pick = pickLabel(
          leftOf(
            band.filter((o) => o !== t),
            pc.x0,
            DETECT.LABEL_LEFT_GAP,
            lo,
            () => hi,
          ).flatMap((h) => {
            const own = piecesOf(h.text);
            const last = [...own].reverse().find(blank);
            if (!last) return [h];
            const str = cleanLabel(
              Array.from(h.text.str).slice(last.to).join(""),
            );
            return str ? [{ ...h, str }] : [];
          }),
        );
        label = pick.label;
        state = pick.state;
      }
      // What the dots lead to.
      const next = mine.slice(k + 1).find(blank);
      const after = chars
        .slice(pc.to, next ? next.from : chars.length)
        .join("");
      let leadsTo: boolean;
      if (after.trim())
        // Words after the dots in their item: an entry, unless dots or a
        // run follow them, in the item or just after it.
        leadsTo =
          next === undefined &&
          !blankAfter(band, t, t.x + Math.max(0, t.width), lo, hi, t.size);
      else if (next) leadsTo = false;
      else {
        let nearest: CardText | null = null;
        for (const o of band) {
          if (o === t || !o.upright || o.x < pc.x1 - 1) continue;
          if (!nearest || o.x < nearest.x) nearest = o;
        }
        // Squares standing across the baseline band, by their bottoms.
        let square = false;
        for (const sq of ySlice(squares, lo - DETECT.SQUARE_MAX, hi)) {
          if (sq.x0 < pc.x1 - 1 || sq.y1 < lo) continue;
          if (!nearest || sq.x0 < nearest.x) square = true;
        }
        leadsTo =
          square ||
          (nearest !== null &&
            !piecesOf(nearest).some(blank) &&
            !labelledBox(nearest) &&
            !blankAfter(
              band,
              nearest,
              nearest.x + Math.max(0, nearest.width),
              lo,
              hi,
              t.size,
            ));
      }
      cands.push({
        rule: "dot-leader",
        type: "text",
        box,
        line: { x0: pc.x0, x1: pc.x1, y: t.y },
        square: null,
        label,
        labelState: state,
        leftLabel: state === "found",
        ownPiece: pc,
        order: 0,
        leadsTo,
      });
    });
  });
  return { cands, short };
}

/**
 * Box symbols typed in the text ("[] Yes", "Male [] Female []"): a
 * checkbox over the square a reader sees, which stands on the baseline,
 * centred in the symbol's advance, its side the smaller of the advance and
 * {@link DETECT_TEXT_SHAPES.BOX_SIDE_EMS} x the size, inset as a drawn
 * square's is.
 *
 * Its label is the text beside it, in its item (up to the next box, row of
 * dots or run) or the nearest upright item within
 * {@link DETECT.LABEL_LEFT_GAP} on its baseline. The boxes of one line read
 * one side together: the LEFT when every box has its own text to its left
 * and the last box none to its right ("Yes [] No []"), else the right
 * ("[] Yes [] No", "Sex: [] Male [] Female"), a box with nothing on the
 * side read taking the other.
 *
 * Passed over: a box already ticked or crossed (`ticked-box`); boxes typed
 * next to each other, one character each (`comb`); and a BULLETED LIST
 * drawn with them (`bullet`, see {@link DETECT_TEXT_SHAPES}). A box's
 * sentence is every word of its line after it (its item, then the items
 * chained on within LABEL_LEFT_GAP, a bold "Note:" and its sentence
 * together) and of the lines wrapped under it, down to the next box of its
 * column. It opens its line when no text ends within LABEL_LEFT_GAP to its
 * left, other than a line number or a list marker ("12", "a)", "3."):
 * text further off is another column. A column with BULLET_COLUMN_MIN
 * such boxes is a list, and so is every box in it before a sentence, a
 * margin note beside it or not. Review round 1 of slice S3 (finding 2):
 * each of wrapped sentences, a second column, a numbered margin and a bold
 * lead-in let a list through, one checkbox per bullet.
 *
 * Not boxes for a field at all: text after the box that starts with "="
 * (a legend, "[] = not applicable") is no label, and a symbol whose square
 * is larger than {@link DETECT.SQUARE_MAX} is decoration, as a drawn
 * square that size is.
 */
function boxCandidates(
  p: CardPage,
  byItem: ReadonlyMap<number, Piece[]>,
  ix: TextIndex,
): Candidate[] {
  type Side = { label: string | null; state: Candidate["labelState"] };
  type Found = {
    c: Candidate;
    t: CardText;
    left: Side;
    right: Side;
    opensLine: boolean;
    /** Words of the box's line after it; then of the lines wrapped under. */
    words: number;
    /** Where the words after it start (null: none), and its line ends. */
    textStart: number | null;
    lineEnd: number;
  };
  const found: Found[] = [];
  const stop = (q: Piece) => q.kind === "run" || q.tag !== undefined;
  const itemOf = new Map(p.text.map((t, i) => [t, i]));
  const piecesOf = (t: CardText) => byItem.get(itemOf.get(t)!) ?? [];
  const wordsIn = (s: string) => (s.match(WORD) ?? []).length;
  p.text.forEach((t, item) => {
    if (!t.upright) return;
    const mine = byItem.get(item) ?? [];
    if (!mine.some((q) => q.tag === "box")) return;
    const chars = Array.from(t.str);
    const lo = t.y - DETECT.RUN_BASELINE_EMS * t.size;
    const hi = t.y + DETECT.RUN_BASELINE_EMS * t.size;
    const band = textBand(ix, lo, hi).filter((o) => o !== t && o.upright);
    mine.forEach((pc, k) => {
      if (pc.tag !== "box") return;
      const ch = chars[pc.from]!;
      const prev = mine.slice(0, k).reverse().find(stop);
      const next = mine.slice(k + 1).find(stop);
      const before = chars.slice(prev ? prev.to : 0, pc.from).join("");
      const after = chars
        .slice(pc.to, next ? next.from : chars.length)
        .join("");
      let left: Side = { label: cleanLabel(before), state: "none" };
      if (left.label) left.state = "found";
      else if (!prev && !before.trim())
        left = pickLabel(
          leftOf(band, pc.x0, DETECT.LABEL_LEFT_GAP, lo, () => hi),
        );
      const legend = LEGEND.test(after);
      let right: Side = {
        label: legend ? null : cleanLabel(after),
        state: "none",
      };
      if (right.label) right.state = "found";
      else if (!next && !after.trim()) {
        const hits: LabelHit[] = [];
        for (const o of band) {
          const gap = o.x - pc.x1;
          if (gap < -1 || gap > DETECT.LABEL_LEFT_GAP) continue;
          if (LEGEND.test(o.str)) continue;
          const str = cleanLabel(o.str);
          if (str) hits.push({ text: o, str });
        }
        hits.sort((a, b) => a.text.x - b.text.x);
        right = pickLabel(hits);
      }
      // Opens its line: nothing before it in its item, and no upright text
      // (but a line number or a list marker) ending within LABEL_LEFT_GAP
      // to its left on its baseline.
      const opensLine =
        !before.trim() &&
        !prev &&
        !band.some((o) => {
          const end = o.x + Math.max(0, o.width);
          return (
            end <= pc.x0 + 1 &&
            pc.x0 - end <= DETECT.LABEL_LEFT_GAP &&
            !MARGIN_MARK.test(o.str.trim())
          );
        });
      // The words of its line after it, and where they start and end.
      const nextText = mine
        .slice(k + 1)
        .find((q) => q.kind === "text" && q.tag === undefined);
      let words = wordsIn(after);
      let textStart: number | null =
        nextText && (!next || nextText.from < next.from) ? nextText.x0 : null;
      let lineEnd = next ? next.x0 : t.x + Math.max(0, t.width);
      if (!next) {
        // Chained on: each item starting within LABEL_LEFT_GAP of the last's
        // end, up to one holding a box, dots or a run. Once per item (only
        // its last box has no next stop).
        const on = band
          .filter((o) => o.x >= lineEnd - 1)
          .sort((a, b) => a.x - b.x);
        for (const o of on) {
          if (o.x - lineEnd > DETECT.LABEL_LEFT_GAP) break;
          if (piecesOf(o).some(stop)) break;
          if (textStart === null) textStart = o.x;
          words += wordsIn(o.str);
          lineEnd = Math.max(lineEnd, o.x + Math.max(0, o.width));
        }
      }
      const side = Math.min(
        pc.x1 - pc.x0,
        DETECT_TEXT_SHAPES.BOX_SIDE_EMS * t.size,
      );
      if (side > DETECT.SQUARE_MAX) return;
      const inner = side - 2 * DETECT.SQUARE_INSET;
      const x0 = (pc.x0 + pc.x1) / 2 - inner / 2;
      const y0 = t.y + DETECT.SQUARE_INSET;
      const isBoxAt = (i: number) =>
        i >= 0 && i < chars.length && isBox(chars[i]!);
      found.push({
        c: {
          rule: "box-glyph",
          type: "checkbox",
          box: { x0, y0, x1: x0 + inner, y1: y0 + inner },
          line: null,
          square: null,
          label: null,
          labelState: "none",
          leftLabel: false,
          ownPiece: pc,
          order: 0,
          glyph: {
            ticked: TICKED_BOXES.includes(ch),
            comb: isBoxAt(pc.from - 1) || isBoxAt(pc.to),
            bullet: false,
          },
        },
        t,
        left,
        right,
        opensLine,
        words,
        textStart,
        lineEnd,
      });
    });
  });
  // One side per line: boxes whose baselines are within GRID_ROW_EPS of
  // the line's first.
  const byLine = [...found].sort(
    (a, b) => a.t.y - b.t.y || a.c.box.x0 - b.c.box.x0,
  );
  for (let i = 0; i < byLine.length;) {
    let j = i + 1;
    while (
      j < byLine.length &&
      byLine[j]!.t.y - byLine[i]!.t.y <= DETECT.GRID_ROW_EPS
    )
      j++;
    const row = byLine.slice(i, j).sort((a, b) => a.c.box.x0 - b.c.box.x0);
    const lefts = row.map((f) => f.left.label);
    const readLeft =
      row.every((f) => f.left.state === "found") &&
      new Set(lefts).size === lefts.length &&
      row[row.length - 1]!.right.state !== "found";
    for (const f of row) {
      const [a, b] = readLeft ? [f.left, f.right] : [f.right, f.left];
      const pick =
        a.state === "found"
          ? a
          : b.state === "found"
            ? b
            : a.state === "rotated"
              ? a
              : b;
      f.c.label = pick.label;
      f.c.labelState = pick.state;
    }
    i = j;
  }
  // A bulleted list. Columns: boxes whose x0 is within GRID_ROW_EPS of the
  // column's first. Each box's sentence takes the words of the lines
  // wrapped under it (items starting between the box and one em past where
  // its words start, up to its line's end), down to the next box of its
  // column, or one line pitch for the last.
  const cols = [...found].sort((a, b) => a.c.box.x0 - b.c.box.x0);
  const eps = DETECT.GRID_ROW_EPS;
  for (let i = 0; i < cols.length;) {
    let j = i + 1;
    while (j < cols.length && cols[j]!.c.box.x0 - cols[i]!.c.box.x0 <= eps) j++;
    const col = cols.slice(i, j).sort((a, b) => b.t.y - a.t.y);
    col.forEach((f, k) => {
      if (f.textStart === null) return;
      const below = col[k + 1];
      const above = col[k - 1];
      const floor = below
        ? below.t.y
        : f.t.y - (above ? above.t.y - f.t.y : 2 * f.t.size);
      for (const o of textBand(ix, floor + eps, f.t.y - eps)) {
        if (!o.upright) continue;
        if (o.x < f.c.box.x0 - 1 || o.x > f.textStart + f.t.size) continue;
        if (o.x > f.lineEnd) continue;
        if (piecesOf(o).some(stop)) continue;
        f.words += wordsIn(o.str);
      }
    });
    const sentence = (f: Found) =>
      f.words >= DETECT_TEXT_SHAPES.BULLET_MIN_WORDS;
    if (
      col.filter((f) => f.opensLine && sentence(f)).length >=
      DETECT_TEXT_SHAPES.BULLET_COLUMN_MIN
    )
      for (const f of col) if (sentence(f)) f.c.glyph!.bullet = true;
    i = j;
  }
  return found.map((f) => f.c);
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
  // Each square's side text read from its baseline band, in page order, so
  // every test and tie-break is unchanged: scanning every text item for
  // every square was quadratic on a page of labelled squares (S6 review
  // round 1; form-detect-combs-cost.test.ts read 70x at 16x the page).
  const tix = textIndex(p.text);
  for (const sq of lines.squares) {
    const right: LabelHit[] = [];
    const band = ySlice(
      tix,
      sq.y0 -
        Math.max(
          DETECT.RUN_BASELINE_EMS * tix.maxSize,
          12 * DETECT.RUN_BASELINE_EMS,
        ),
      sq.y1,
    );
    for (const t of band) {
      const gap = t.x - sq.x1;
      if (gap < -1 || gap > DETECT.LABEL_LEFT_GAP) continue;
      if (t.y < sq.y0 - DETECT.RUN_BASELINE_EMS * t.size || t.y > sq.y1)
        continue;
      const str = cleanLabel(t.str);
      if (str) right.push({ text: t, str });
    }
    right.sort((a, b) => a.text.x - b.text.x);
    const left = leftOf(
      band,
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
 * The page's plumb lines by band of height, for the questions that need
 * only those beside some stretch of height: `bands(y0, y1)` returns every
 * plumb line reaching [y0 - GRID_TOUCH_EPS, y1 + GRID_TOUCH_EPS] (and a few
 * more near it), each once, for the caller's exact test. A line taller
 * than TALL bands, or with an end that is not finite, is in every answer.
 * Slice S5: the grid finder asked of every vertical on the page per stack
 * part, and `gridTouches` per rule reaching table-grid (S4's cost note
 * reported that one), so a page of tables was quadratic in its tables.
 */
function plumbBands(
  verticals: PageLines["verticals"],
): (y0: number, y1: number) => PageLines["verticals"] {
  const STEP = 50;
  const TALL = 64;
  const eps = DETECT.GRID_TOUCH_EPS;
  const band = (y: number) => Math.floor(y / STEP);
  const bands = new Map<number, PageLines["verticals"]>();
  const tall: PageLines["verticals"] = [];
  for (const v of verticals) {
    const b0 = band(v.y0 - eps);
    const b1 = band(v.y1 + eps);
    if (!(b1 - b0 <= TALL)) {
      tall.push(v);
      continue;
    }
    for (let b = b0; b <= b1; b++) {
      const list = bands.get(b);
      if (list) list.push(v);
      else bands.set(b, [v]);
    }
  }
  return (y0, y1) => {
    const b0 = band(y0 - eps);
    const b1 = band(y1 + eps);
    if (!(b1 - b0 <= TALL)) return verticals;
    const out = new Set(tall);
    for (let b = b0; b <= b1; b++)
      for (const v of bands.get(b) ?? []) out.add(v);
    return [...out];
  };
}

/**
 * A RULED GRID: a stack of rules whose ends line up (within
 * {@link DETECT.GRID_ROW_EPS}), split wherever the outer plumb lines break
 * (two tables at one margin), with plumb lines at both ends and at every
 * column line between, each running the stack's whole height (within
 * {@link DETECT.GRID_TOUCH_EPS}, as one line or as pieces), and no other
 * line inside. `xs` are its column lines, `ys` its rules, both ascending;
 * lines within GRID_TOUCH_EPS of each other are one line drawn twice, read
 * at their middle ({@link gridLines}).
 * One finder for every kind of table the finder reads: the label table
 * ({@link tableCells}), the headed table and the single row of captioned
 * boxes ({@link headedCells}). A stack of one rule, or a grid of one
 * column, is none.
 */
interface Grid {
  xs: number[];
  ys: number[];
  /**
   * How far a cell's ink reaches in from its `xs`/`ys`: half the heaviest
   * rule's stroke, and half the spread of a line drawn twice (two boxes
   * touching within GRID_TOUCH_EPS draw each border twice; S5 review round
   * 1, a 1 pt gap between boxes left the whole grid to `table-grid`).
   * {@link cellField} insets past it, so a field clears the printed line.
   */
  ink: number;
}

/**
 * Values within GRID_TOUCH_EPS of the one before as one line, at the middle
 * of its run, with the largest half-spread of any run.
 */
function gridLines(values: number[]): { at: number[]; spread: number } {
  const runs: [number, number][] = [];
  for (const v of [...values].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && v - last[1] <= DETECT.GRID_TOUCH_EPS) last[1] = v;
    else runs.push([v, v]);
  }
  return {
    at: runs.map(([a, b]) => (a + b) / 2),
    spread: Math.max(0, ...runs.map(([a, b]) => (b - a) / 2)),
  };
}

function ruledGrids(
  lines: PageLines,
  plumbs: ReturnType<typeof plumbBands>,
): Grid[] {
  const eps = DETECT.GRID_ROW_EPS;
  const tEps = DETECT.GRID_TOUCH_EPS;
  // Every rule by height, for the stray-rule question of each part.
  const byY = lines.rules
    .filter((r) => Number.isFinite(r.y))
    .sort((a, b) => a.y - b.y);
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
  const out: Grid[] = [];
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
        plumbCoverage(plumbs(stack[0]!.y, stack[stack.length - 1]!.y), x),
      );
      const joined = outer[0]!(a.y, b.y) && outer[1]!(a.y, b.y);
      if (joined) parts[parts.length - 1]!.push(b);
      else parts.push([b]);
    }
    for (const part of parts) {
      if (part.length < 2) continue;
      const lo = part[0]!.y;
      const hi = part[part.length - 1]!.y;
      const inside = plumbs(lo, hi).filter(
        (v) =>
          v.x >= seed.x0 - tEps &&
          v.x <= seed.x1 + tEps &&
          v.y1 > lo + tEps &&
          v.y0 < hi - tEps,
      );
      const cols = gridLines(inside.map((v) => v.x));
      const xs = cols.at;
      // The part's outer plumb lines are among them (it was split where
      // they break); every column line between must run its whole height.
      if (xs.length < 3) continue;
      if (xs.slice(1, -1).some((x) => !plumbCovers(inside, x, lo, hi)))
        continue;
      const own = new Set(part);
      // (A rule with a y that is not finite was never inside a part.)
      let stray = false;
      for (
        let i = from(byY, (r) => r.y, lo + tEps);
        !stray && i < byY.length && byY[i]!.y < hi - tEps;
        i++
      ) {
        const r = byY[i]!;
        stray =
          !own.has(r) &&
          r.y > lo + tEps &&
          overlap(r.x0, r.x1, seed.x0, seed.x1) > tEps;
      }
      if (stray) continue;
      const rows = gridLines(part.map((r) => r.y));
      if (rows.at.length < 2) continue;
      const w = Math.max(0, ...part.map((r) => r.w ?? 0));
      out.push({
        xs,
        ys: rows.at,
        ink: w / 2 + Math.max(cols.spread, rows.spread),
      });
    }
  }
  return out;
}

/**
 * Whether a cell holds anything: text (an underscore run too), a square, or
 * a mark ({@link Paint.painted}: a tick, a bar; S5 review round 1: a cell
 * read by text alone took a field over a tick, where S4 refused the same
 * mark in a lone box). A cell shut by a dark fill is "empty" here (its row
 * is not filled by it) and asked about by {@link cellShut}.
 */
function cellEmpty(
  ix: TextIndex,
  lines: PageLines,
  paint: () => Paint,
  c: Edges,
): boolean {
  return (
    textIn(ix, c).length === 0 &&
    paint().painted(c) !== "mark" &&
    !lines.squares.some(
      (s) => overlap(s.x0, s.x1, c.x0, c.x1) > 0 && s.y1 > c.y0 && s.y0 < c.y1,
    )
  );
}

/** A cell under a dark fill over all of it: no field ({@link Paint.painted}). */
const cellShut = (paint: () => Paint, c: Edges) =>
  paint().painted(c) === "dark";

/**
 * A cell's field: inset DETECT.FIELD_INSET. With a grid's `ink` (the
 * headed table's cells, S5), inset at least ink + 0.5 and rounded INWARD
 * to whole points, so the saved widget (which pdf-lib draws half its 1 pt
 * border wider each side) clears a heavy or fractional rule: rounded
 * outward, it lay 0.65 pt over a 1.5 pt rule (S5 review round 1,
 * geometry). The label table's cells (S1) keep the plain inset.
 */
const cellField = (c: Edges, ink?: number): Edges => {
  const e = DETECT.FIELD_INSET;
  if (ink === undefined)
    return { x0: c.x0 + e, y0: c.y0 + e, x1: c.x1 - e, y1: c.y1 - e };
  // The widget's edge lands half a point outside the field's: it clears the
  // ink when the field's edge is at least ink + 0.5 in from the line.
  const i = Math.max(e, ink + 0.5);
  return {
    x0: Math.ceil(c.x0 + i),
    y0: Math.ceil(c.y0 + i),
    x1: Math.floor(c.x1 - i),
    y1: Math.floor(c.y1 - i),
  };
};

const textCell = (box: Edges, label: string): Candidate => ({
  rule: "table-cell",
  type: "text",
  box,
  line: null,
  square: null,
  label,
  labelState: "found",
  leftLabel: true,
  ownPiece: null,
  order: 0,
});

/**
 * The fields of a LABEL TABLE ({@link DETECT.CELL_ROWS_MIN}): a ruled grid
 * of exactly two columns. Every row's left cell must hold one label line
 * ({@link cellLabel}) and every right cell nothing at all: no text (an
 * underscore run included), no square. Null for anything else (a header
 * row, a value column, a left cell of two lines or none), which
 * {@link headedCells} may read instead or leave to `table-grid` (corpus
 * N4; N39 has a header row).
 */
function labelTable(
  ix: TextIndex,
  lines: PageLines,
  paint: () => Paint,
  g: Grid,
): Candidate[] | null {
  if (g.xs.length !== 3 || g.ys.length - 1 < DETECT.CELL_ROWS_MIN) return null;
  const [x0, mid, x1] = g.xs as [number, number, number];
  const rows: Candidate[] = [];
  for (let i = 1; i < g.ys.length; i++) {
    const y0 = g.ys[i - 1]!;
    const y1 = g.ys[i]!;
    const label = cellLabel(ix, { x0, x1: mid, y0, y1 });
    const cell = { x0: mid, x1, y0, y1 };
    if (!label || !cellEmpty(ix, lines, paint, cell) || cellShut(paint, cell))
      return null;
    rows.push(textCell(cellField(cell), label));
  }
  return rows;
}

/**
 * The words a cell holds, in reading order (top line first, each line left
 * to right), read with `cleanLabel`: null when it holds none, any that is
 * not upright or reaches past its borders (within 1 pt: text across two
 * cells is neither one's heading), or more than
 * {@link DETECT.CELL_LABEL_MAX} characters.
 */
function cellWords(ix: TextIndex, c: Edges): string | null {
  const items = textIn(ix, c);
  const inside = (t: CardText) =>
    t.upright && t.x >= c.x0 - 1 && t.x + Math.max(0, t.width) <= c.x1 + 1;
  if (items.length === 0 || !items.every(inside)) return null;
  items.sort((a, b) =>
    Math.abs(a.y - b.y) > DETECT.GRID_ROW_EPS ? b.y - a.y : a.x - b.x,
  );
  const s = cleanLabel(items.map((t) => t.str).join(" "));
  return s && Array.from(s).length <= DETECT.CELL_LABEL_MAX ? s : null;
}

/**
 * The column heads printed just OVER a grid's top rule, one a column: each
 * column's upright text whose descent is 0 to {@link DETECT.CAPTION_MAX}
 * over the rule and which lies inside the column (within 1 pt of its
 * lines). Null when a column but the first has none, or when any upright
 * text in that band crosses a column line (a title over the whole grid).
 */
function headsOver(ix: TextIndex, g: Grid): (string | null)[] | null {
  const top = g.ys[g.ys.length - 1]!;
  const n = g.xs.length - 1;
  const words: CardText[][] = Array.from({ length: n }, () => []);
  for (const t of textBand(
    ix,
    top + DETECT.TEXT_DESCENT_EMS * ix.minSize,
    top + DETECT.CAPTION_MAX + DETECT.TEXT_DESCENT_EMS * ix.maxSize,
  )) {
    const gap = t.y - DETECT.TEXT_DESCENT_EMS * t.size - top;
    if (!t.upright || t.str.trim() === "" || gap < 0) continue;
    if (gap > DETECT.CAPTION_MAX) continue;
    const x1 = t.x + Math.max(0, t.width);
    if (x1 <= g.xs[0]! || t.x >= g.xs[n]!) continue;
    const k = g.xs.findIndex(
      (x, i) => i < n && t.x >= x - 1 && x1 <= g.xs[i + 1]! + 1,
    );
    if (k < 0) return null;
    words[k]!.push(t);
  }
  const heads = words.map((ts) => {
    const s = cleanLabel(ts.map((t) => t.str).join(" "));
    return s && Array.from(s).length <= DETECT.CELL_LABEL_MAX ? s : null;
  });
  return heads.slice(1).every((h) => h !== null) ? heads : null;
}

/** What the headed-table read leaves for `classifyPage` to record. */
interface TableRead {
  cells: Candidate[];
  /** Empty cells of rows that hold other text (`filled-cells`). */
  filled: Edges[];
  /** Tables of more than TABLE_MAX_CELLS empty cells (`large-table`). */
  large: Edges[];
}

/**
 * The tables a page's ruled grids make ({@link DETECT_TABLES}), each grid
 * read by the first that takes it:
 *
 *  1. a LABEL TABLE ({@link labelTable}): `table-cell`, as before S5;
 *  2. a SINGLE ROW of STRIP_MIN_CELLS to STRIP_MAX_CELLS touching boxes
 *     (an address's City | State | ZIP), each holding one caption in its
 *     top-left with room under it (the test an outlined box's caption
 *     has, {@link boxCaption}): a field along each box's foot under its
 *     caption, `labelled-rule`, as one such box alone has;
 *  3. a HEADED TABLE: the top row's every cell holds a heading
 *     ({@link cellWords}), a blank top-left corner allowed (over a column
 *     of row labels), or, when the top row is no header, every column but
 *     the first has a head printed just over the grid ({@link headsOver}).
 *     A grid of one body row is read only as a strip, 2 to 4 cells. Then
 *     each body row is EMPTY (every cell), LABELLED (only its first cell
 *     holds text, words with a letter in them: "Monday", not a day number)
 *     or FILLED (anything else). A cell holding a mark (a tick, a bar, a
 *     picture: {@link Paint.painted}) is not empty, as text would not be;
 *     one under a dark fill is SHUT (no field, its row not filled by it).
 *     A top row is no header when a filled row under it reads just like it
 *     (words, no digit, the same size and family): a headerless list. A
 *     filled row is passed over whole, and so is every row before the
 *     LAST filled row (a spacer, a section heading): their empty cells are
 *     `filled-cells`, since a gap in a data table is no blank to fill in.
 *     Each other empty, unshut cell under a head is a `header-cell` field
 *     filling it (inset past the grid's ink, {@link cellField}, multiline
 *     when the row is as tall as an entry box's for its head's size),
 *     labelled "<head> row <n>" (n its printed
 *     row under the header), "<row label> <head>" in a labelled row, the
 *     row label alone in a table of two columns, and the head alone in a
 *     table of one body row. Over TABLE_MAX_CELLS such cells, none is
 *     proposed: the table is one `large-table` entry for the summary.
 *
 * Every row must be DETECT_BOXES.ENTRY_MIN_H to ENTRY_MAX_H tall (a field's
 * room, not a page layout's boxes). Any other grid is left to `table-grid`,
 * which passes over the rules of every grid, read or not.
 */
function tables(
  ix: TextIndex,
  lines: PageLines,
  paint: () => Paint,
  plumbs: ReturnType<typeof plumbBands>,
  on: (id: ExclusionRuleId) => boolean,
): TableRead {
  const read: TableRead = { cells: [], filled: [], large: [] };
  for (const g of ruledGrids(lines, plumbs)) {
    const label = labelTable(ix, lines, paint, g);
    if (label) {
      read.cells.push(...label);
      continue;
    }
    headedCells(ix, lines, paint, g, on, read);
  }
  return read;
}

function headedCells(
  ix: TextIndex,
  lines: PageLines,
  paint: () => Paint,
  g: Grid,
  on: (id: ExclusionRuleId) => boolean,
  read: TableRead,
): void {
  const { xs, ys } = g;
  const cols = xs.length - 1;
  const rows = ys.length - 1;
  for (let i = 1; i <= rows; i++) {
    const h = ys[i]! - ys[i - 1]!;
    if (h < DETECT_BOXES.ENTRY_MIN_H || h > DETECT_BOXES.ENTRY_MAX_H) return;
  }
  const cell = (r: number, k: number): Edges => ({
    x0: xs[k]!,
    x1: xs[k + 1]!,
    y0: ys[rows - r - 1]!,
    y1: ys[rows - r]!,
  });
  const strip =
    cols >= DETECT_TABLES.STRIP_MIN_CELLS &&
    cols <= DETECT_TABLES.STRIP_MAX_CELLS;
  // 2. One row of captioned boxes.
  if (rows === 1 && strip) {
    const caps = Array.from({ length: cols }, (_, k) => {
      const c = cell(0, k);
      const hit = boxCaption(ix, { x0: c.x0, x1: c.x1, y: c.y0 }, c.y1);
      return hit && hit.text.y < c.y1 ? hit : null;
    });
    if (caps.every((c) => c !== null)) {
      caps.forEach((cap, k) => {
        const c = cell(0, k);
        const e = DETECT.FIELD_INSET;
        read.cells.push({
          ...textCell(
            {
              x0: c.x0 + e,
              x1: c.x1 - e,
              y0: c.y0 + DETECT.RULE_BOTTOM_GAP,
              y1:
                c.y0 +
                DETECT.RULE_BOTTOM_GAP +
                textHeight(cap!.text.size, DETECT.TEXT_H_RULE),
            },
            cap!.str,
          ),
          rule: "labelled-rule",
          leftLabel: false,
        });
      });
      return;
    }
  }
  // 3. A headed table.
  const sizes: number[] = [];
  const families: CardText["family"][] = [];
  let heads: (string | null)[] | null = Array.from({ length: cols }, (_, k) => {
    const s = cellWords(ix, cell(0, k));
    const t = textIn(ix, cell(0, k))[0];
    sizes[k] = t?.size ?? DETECT.DEFAULT_SIZE;
    families[k] = t?.family;
    return s;
  });
  let first = 1;
  if (!heads.slice(1).every((s) => s !== null)) {
    heads = headsOver(ix, g);
    first = 0;
  }
  // A heading has a letter in it: a top row of numbers is data.
  if (!heads || heads.some((h) => h !== null && !LETTER.test(h))) return;
  const body = rows - first;
  if (body < 1 || (first === 0 && body === 1 && !strip)) return;
  // Each body row: EMPTY (every cell), LABELLED (only its first cell
  // holds text, words with a letter) or FILLED (anything else).
  const bodyRows = Array.from({ length: body }, (_, i) => {
    const r = first + i;
    const own = Array.from({ length: cols }, (_, k) => cell(r, k));
    const empty = own.map((c) => cellEmpty(ix, lines, paint, c));
    const rowLabel = empty[0] ? null : cellWords(ix, own[0]!);
    const labelled =
      rowLabel !== null &&
      LETTER.test(rowLabel) &&
      empty.slice(1).every(Boolean);
    const filled = !labelled && !empty.every(Boolean);
    return { r, own, empty, rowLabel, labelled, filled };
  });
  // A top row is no header when a filled row under it reads just like it:
  // words in every headed cell, no digit, in the same size and family (a
  // headerless list of names and towns, whose first entry would name the
  // fields and copy the page's data into them). S5 review round 1, H30.
  const hs = heads;
  if (
    first === 1 &&
    bodyRows.some(
      (row) =>
        row.filled &&
        hs.every((h, k) => {
          if (h === null) return true;
          const w = row.empty[k] ? null : cellWords(ix, row.own[k]!);
          const t = textIn(ix, row.own[k]!)[0];
          return (
            w !== null &&
            LETTER.test(w) &&
            !DIGIT.test(w) &&
            t !== undefined &&
            Math.abs(t.size - sizes[k]!) < 0.5 &&
            t.family === families[k]
          );
        }),
    )
  )
    return;
  // In a table with a filled row, only the rows AFTER its last filled row
  // are blanks to fill in (an invoice's unused line items, a "Total" row):
  // an empty row between filled ones is a spacer, and a labelled row
  // between them a section heading ("Current assets", "Hot drinks",
  // "Lunch"). S5 review round 1. (A labelled row after the last filled row
  // is read: a mutant passing every labelled row over in a filled table
  // differed only there, and there it is a total to fill in.)
  let lastFilled = -1;
  bodyRows.forEach((row, i) => {
    if (row.filled) lastFilled = i;
  });
  const want: { box: Edges; label: string; tall: boolean }[] = [];
  const gaps: Edges[] = [];
  bodyRows.forEach(({ r, own, empty, rowLabel, labelled, filled }, i) => {
    const n = r - first + 1;
    const passed = filled || i < lastFilled;
    for (let k = 0; k < cols; k++) {
      const head = hs[k];
      if (!empty[k] || !head) continue;
      // A shut cell is passed over as a filled row's gaps are (`filled-cells`
      // decides it, and turned off lets it through: the corpus seam test).
      if ((passed || cellShut(paint, own[k]!)) && on("filled-cells")) {
        gaps.push(cellField(own[k]!, g.ink));
        continue;
      }
      const label = labelled
        ? cols === 2
          ? rowLabel!
          : rowLabel + " " + head
        : body === 1
          ? head
          : head + " row " + n;
      const c = own[k]!;
      const tall =
        c.y1 - c.y0 >=
        Math.max(
          DETECT_BOXES.MULTILINE_MIN_H,
          DETECT_BOXES.MULTILINE_EMS * (sizes[k] ?? DETECT.DEFAULT_SIZE),
        );
      want.push({ box: cellField(c, g.ink), label, tall });
    }
  });
  if (want.length > DETECT_TABLES.TABLE_MAX_CELLS && on("large-table")) {
    read.large.push({ x0: xs[0]!, y0: ys[0]!, x1: xs[cols]!, y1: ys[rows]! });
    return;
  }
  read.filled.push(...gaps);
  for (const w of want)
    read.cells.push({
      ...textCell(w.box, w.label),
      rule: "header-cell",
      leftLabel: false,
      ...(w.tall ? { multiline: true } : {}),
    });
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
 * Every square's ROW of equal, adjoining squares, left to right (a square
 * alone is a row of one); {@link DETECT.COMB_MIN} or more is a comb. The
 * next square in a row is looked up by its lower-left corner (cells
 * COMB_EPS wide, so it is in a neighbour of the last one's lower-right):
 * scanning the whole list for it made a page of graph-paper cells quadratic.
 */
function combRuns(squares: CardRect[]): CardRect[][] {
  const eps = DETECT.COMB_EPS;
  const runs: CardRect[][] = [];
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
    runs.push(row);
  }
  return runs;
}

/**
 * Squares with an equal square edge to edge above or below them (within
 * {@link DETECT.COMB_EPS}): graph paper, or a grid of boxes, whose rows are
 * no combs. Looked up by lower-left corner, so linear.
 */
function stackedSquares(squares: readonly CardRect[]): Set<CardRect> {
  const eps = DETECT.COMB_EPS;
  const key = (x: number, y: number) =>
    `${Math.round(x / eps)}|${Math.round(y / eps)}`;
  const byCorner = new Map<string, CardRect[]>();
  for (const s of squares) {
    const k = key(s.x0, s.y0);
    const list = byCorner.get(k);
    if (list) list.push(s);
    else byCorner.set(k, [s]);
  }
  const side = (s: CardRect) => s.x1 - s.x0;
  const near = (x: number, y: number, test: (o: CardRect) => boolean) => {
    const cx = Math.round(x / eps);
    const cy = Math.round(y / eps);
    for (const dx of [-1, 0, 1])
      for (const dy of [-1, 0, 1])
        for (const o of byCorner.get(`${cx + dx}|${cy + dy}`) ?? [])
          if (test(o)) return true;
    return false;
  };
  const out = new Set<CardRect>();
  for (const s of squares) {
    const like = (o: CardRect) =>
      o !== s &&
      Math.abs(o.x0 - s.x0) <= eps &&
      Math.abs(side(o) - side(s)) <= eps;
    const above = near(
      s.x0,
      s.y1,
      (o) => like(o) && Math.abs(o.y0 - s.y1) <= eps,
    );
    const below =
      above ||
      near(
        s.x0,
        s.y0 - (s.y1 - s.y0),
        (o) => like(o) && Math.abs(o.y1 - s.y0) <= eps,
      );
    if (above || below) out.add(s);
  }
  return out;
}

/** The nearest upright label on a square's RIGHT, as `squareCandidates` reads it. */
function rightLabel(tix: TextIndex, sq: CardRect): LabelHit | undefined {
  const hits: LabelHit[] = [];
  const lo = sq.y0 - DETECT.RUN_BASELINE_EMS * tix.maxSize;
  for (const t of ySlice(tix, lo, sq.y1)) {
    const gap = t.x - sq.x1;
    if (gap < -1 || gap > DETECT.LABEL_LEFT_GAP) continue;
    if (t.y < sq.y0 - DETECT.RUN_BASELINE_EMS * t.size || t.y > sq.y1) continue;
    const str = cleanLabel(t.str);
    if (str) hits.push({ text: t, str });
  }
  hits.sort((a, b) => a.text.x - b.text.x);
  return hits.find((h) => h.text.upright);
}

/** A date's position heads ("DD", "MM", "YYYY"), which differ yet are no scale. */
const DATE_HEAD = /^(?:d+|m+|y+)$/i;

/**
 * Comb runs that are a SCALE's ({@link DETECT_COMBS}.COMB_SCALE_ABOVE): a
 * rating row of touching boxes under distinct heads, and every run in its
 * STACK (same first x, cell count and cell size, each at most
 * COMB_STACK_GAP_CELLS cells under the one above), which shares the top
 * run's heads. The heads are the upright text items centred over the top
 * run, on the lowest baseline over it (within `DETECT.GRID_ROW_EPS`), up
 * to COMB_SCALE_ABOVE over it: two or more, all different, not all a
 * date's. Review round 1 of S6: three "Strongly disagree ... Strongly
 * agree" rows of five touching boxes became 5-character text fields.
 */
function scaleRuns(
  tix: TextIndex,
  runs: readonly CardRect[][],
): Set<CardRect[]> {
  const eps = DETECT.COMB_EPS;
  const side = (r: CardRect[]) => r[0]!.x1 - r[0]!.x0;
  const top = (r: CardRect[]) => Math.max(...r.map((s) => s.y1));
  const bottom = (r: CardRect[]) => Math.min(...r.map((s) => s.y0));
  const out = new Set<CardRect[]>();
  // Columns by first x (within COMB_EPS of the group's first), then by
  // cell count and size; each column's runs top down, chained.
  const byX: CardRect[][][] = [];
  for (const r of [...runs].sort((a, b) => a[0]!.x0 - b[0]!.x0)) {
    const g = byX[byX.length - 1];
    if (g && r[0]!.x0 - g[0]![0]!.x0 <= eps) g.push(r);
    else byX.push([r]);
  }
  const heads = (r: CardRect[]): boolean => {
    const y1 = top(r);
    const x0 = r[0]!.x0;
    const x1 = r[r.length - 1]!.x1;
    const over = ySlice(tix, y1, y1 + DETECT_COMBS.COMB_SCALE_ABOVE).filter(
      (t) => {
        const c = t.x + Math.max(0, t.width) / 2;
        return t.upright && t.y > y1 && c >= x0 && c <= x1 && cleanLabel(t.str);
      },
    );
    if (over.length < 2) return false;
    const base = Math.min(...over.map((t) => t.y));
    const strs = over
      .filter((t) => t.y - base <= DETECT.GRID_ROW_EPS)
      .map((t) => cleanLabel(t.str)!);
    return (
      strs.length >= 2 &&
      new Set(strs).size === strs.length &&
      !strs.every((s) => DATE_HEAD.test(s))
    );
  };
  for (const g of byX) {
    const kinds = new Map<number, CardRect[][]>();
    for (const r of g) {
      const k = kinds.get(r.length);
      if (k) k.push(r);
      else kinds.set(r.length, [r]);
    }
    for (const same of kinds.values()) {
      same.sort((a, b) => side(a) - side(b) || top(b) - top(a));
      let stack: CardRect[][] = [];
      const close = () => {
        if (stack.length > 0 && heads(stack[0]!))
          for (const r of stack) out.add(r);
        stack = [];
      };
      for (const r of same) {
        const prev = stack[stack.length - 1];
        if (
          prev &&
          Math.abs(side(r) - side(prev)) <= eps &&
          bottom(prev) - top(r) <=
            DETECT_COMBS.COMB_STACK_GAP_CELLS * side(prev) + 1e-9
        )
          stack.push(r);
        else {
          close();
          stack = [r];
        }
      }
      close();
    }
  }
  return out;
}

/**
 * Slice S6, combs: ROWS of comb runs ({@link combRuns} of COMB_MIN or
 * more, every cell outlined and unfilled, none a headed grid's cell, none
 * on graph paper), runs on one row joined when they stand up to
 * COMB_GROUP_GAP_CELLS cell widths apart with nothing lettered between
 * them (a date's "DD / MM / YYYY"); runs under a scale's heads are no
 * comb ({@link scaleRuns}). A row of COMB_FIELD_MIN or more cells with a
 * label gives one text field per run, over the run edge to edge, limited
 * to its cell count, named from that label: the nearest upright lettered
 * text to its left on its row, when it ends within LABEL_LEFT_GAP; else a
 * caption over the row, wider than one cell; else that left text if it
 * ends within COMB_LABEL_GAP with no printed line or square between (see
 * {@link DETECT_COMBS}). Its cells are `used`: no checkbox and no `comb`
 * for them. Any other row is left to the square rules, which exclude its
 * cells as `comb`.
 */
function combFields(
  tix: TextIndex,
  runs: readonly CardRect[][],
  lines: PageLines,
  gridCell: ReadonlySet<CardRect>,
): { cands: Candidate[]; used: Set<CardRect> } {
  const eps = DETECT.COMB_EPS;
  const side = (s: CardRect) => s.x1 - s.x0;
  const stacked = stackedSquares(lines.squares);
  const shaped = runs.filter(
    (r) =>
      r.length >= DETECT.COMB_MIN &&
      r.every((s) => s.stroked && !s.filled && !gridCell.has(s)) &&
      !r.some((s) => stacked.has(s)),
  );
  const scale = scaleRuns(tix, shaped);
  const ok = shaped.filter((r) => !scale.has(r));
  // Rows: runs by bottom (within COMB_EPS of the band's first), then by x.
  ok.sort((a, b) => a[0]!.y0 - b[0]!.y0);
  const rows: CardRect[][][] = [];
  for (let i = 0; i < ok.length;) {
    let j = i + 1;
    while (j < ok.length && ok[j]![0]!.y0 - ok[i]![0]!.y0 <= eps) j++;
    const band = ok.slice(i, j).sort((a, b) => a[0]!.x0 - b[0]!.x0);
    let row: CardRect[][] = [];
    for (const r of band) {
      const prev = row[row.length - 1];
      const last = prev?.[prev.length - 1];
      const first = r[0]!;
      const gap = last ? first.x0 - last.x1 : Infinity;
      const joins =
        last !== undefined &&
        Math.abs(side(first) - side(last)) <= eps &&
        Math.abs(first.y1 - last.y1) <= eps &&
        gap > eps &&
        gap <= DETECT_COMBS.COMB_GROUP_GAP_CELLS * side(last) + 1e-9 &&
        !ySlice(
          tix,
          last.y0 - DETECT.RUN_BASELINE_EMS * tix.maxSize,
          last.y1,
        ).some(
          (t) =>
            overlap(t.x, t.x + Math.max(0, t.width), last.x1, first.x0) > 0 &&
            t.y >= last.y0 - DETECT.RUN_BASELINE_EMS * t.size &&
            LETTER_OR_DIGIT.test(t.str),
        );
      if (joins) row.push(r);
      else {
        if (row.length > 0) rows.push(row);
        row = [r];
      }
    }
    if (row.length > 0) rows.push(row);
    i = j;
  }
  const cands: Candidate[] = [];
  const used = new Set<CardRect>();
  // Rules and squares by height, built on first need (most pages have no
  // comb row), so asking what stands between a label and its row is a
  // band lookup, never a scan of the page per row.
  let byY: { rules: YIndex<Line>; squares: YIndex<CardRect> } | undefined;
  const between = (x: number, first: CardRect): boolean => {
    byY ??= {
      rules: yIndex(
        lines.rules,
        (r) => r.y,
        () => 0,
      ),
      squares: yIndex(
        lines.squares,
        (s) => s.y0,
        () => 0,
      ),
    };
    if (
      ySlice(byY.rules, first.y0 - 3, first.y1 + 1).some(
        (r) => overlap(r.x0, r.x1, x, first.x0) > 1,
      )
    )
      return true;
    return ySlice(byY.squares, first.y0 - DETECT.SQUARE_MAX, first.y1).some(
      (s) =>
        overlap(s.y0, s.y1, first.y0, first.y1) > 0 &&
        overlap(s.x0, s.x1, x, first.x0 - eps) > 0,
    );
  };
  for (const row of rows) {
    const cells = row.flat();
    if (cells.length < DETECT_COMBS.COMB_FIELD_MIN) continue;
    const first = row[0]![0]!;
    const lastRun = row[row.length - 1]!;
    const right = lastRun[lastRun.length - 1]!.x1;
    const top = Math.max(...cells.map((s) => s.y1));
    const lo = first.y0 - DETECT.RUN_BASELINE_EMS * 12;
    let left = leftOf(
      ySlice(tix, lo, first.y1),
      first.x0,
      DETECT_COMBS.COMB_LABEL_GAP,
      lo,
      () => first.y1,
    ).find((h) => h.text.upright && LETTER.test(h.str));
    // A printed line or square between it and the row: it labels that.
    if (left && between(left.text.x + Math.max(0, left.text.width), first))
      left = undefined;
    const near =
      left !== undefined &&
      first.x0 - (left.text.x + Math.max(0, left.text.width)) <=
        DETECT.LABEL_LEFT_GAP;
    const span = first.x0 + DETECT.CAPTION_SPAN * (right - first.x0);
    let caption: CardText | undefined;
    if (!near)
      for (const t of ySlice(tix, top, top + DETECT_COMBS.COMB_CAPTION_ABOVE)) {
        if (!t.upright || t.y <= top || !cleanLabel(t.str)) continue;
        if (t.width <= side(first)) continue;
        if (overlap(t.x, t.x + t.width, first.x0, span) <= 0) continue;
        if (!caption || t.y < caption.y) caption = t;
      }
    if (caption) left = undefined;
    const label = caption ? cleanLabel(caption.str) : (left?.str ?? null);
    if (!label) continue;
    for (const r of row) {
      const a = r[0]!;
      const b = r[r.length - 1]!;
      cands.push({
        rule: "comb-boxes",
        type: "text",
        box: {
          x0: a.x0,
          y0: Math.min(...r.map((s) => s.y0)),
          x1: b.x1,
          y1: Math.max(...r.map((s) => s.y1)),
        },
        line: null,
        square: null,
        label,
        labelState: "found",
        leftLabel: left !== undefined,
        ownPiece: null,
        order: 0,
        maxLength: r.length,
        fixed: true,
      });
    }
    for (const s of cells) used.add(s);
  }
  return { cands, used };
}

/** Upright text on one baseline, left to right, read as one string. */
interface TextLine {
  y: number;
  /** The largest item's size. */
  size: number;
  items: CardText[];
  str: string;
}

/** Items left to right as one string: a space wherever they do not touch. */
function joinItems(items: readonly CardText[]): string {
  let s = "";
  let end = -Infinity;
  for (const t of items) {
    if (s && t.x - end > DETECT_COMBS.WORD_GAP_EMS * t.size) s += " ";
    s += t.str;
    end = t.x + Math.max(0, t.width);
  }
  return s;
}

/**
 * The upright items as lines: an item joins the line whose baseline is
 * within half the smaller size of its own (pdf.js gives a line drawn one
 * word per call, or with wide word spacing, as an item a word).
 */
function textLines(items: readonly CardText[]): TextLine[] {
  const lines: TextLine[] = [];
  for (const t of items) {
    if (!t.upright || !Number.isFinite(t.y) || !Number.isFinite(t.x)) continue;
    const l = lines.find(
      (l) => Math.abs(l.y - t.y) <= Math.min(l.size, t.size) / 2,
    );
    if (l) {
      l.items.push(t);
      l.size = Math.max(l.size, t.size);
    } else lines.push({ y: t.y, size: t.size, items: [t], str: "" });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.str = joinItems(l.items);
  }
  return lines;
}

/**
 * Lines nearest first, kept while each is `first` (within the first
 * reach) or follows the one kept before it at RADIO_VETO_LEADING of their
 * size: one passage, read on past the first reach.
 */
function passage(
  lines: readonly TextLine[],
  first: (l: TextLine) => boolean,
): TextLine[] {
  const out: TextLine[] = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    const follows =
      prev !== undefined &&
      Math.abs(l.y - prev.y) <=
        DETECT_COMBS.RADIO_VETO_LEADING * Math.max(l.size, prev.size);
    if (first(l) || follows) out.push(l);
    else break;
  }
  return out;
}

/**
 * Slice S6, radio clusters: a COLUMN of RADIO_MIN or more equal squares
 * (x and side within COMB_EPS), each the next one's gap
 * RADIO_STACK_GAP +- RADIO_GAP_EPS under the one above, each labelled on
 * its right (and that label the one the square rules chose for it), the
 * labels distinct: ONE radio group, its choices those labels top to
 * bottom, named from a caption over the top square if there is one (never
 * another square's own label). Its buttons are the printed pitch less the
 * builder's gap, at whole points, centred on the printed squares, so the
 * builder's own stack (`fieldBoxes`, at RADIO_STACK_GAP) lands where the
 * stack is printed; where that would put a button farther than
 * RADIO_CENTRE_EPS from its square (a fractional pitch), it is no group.
 * Nor is a stack under words asking for more than one answer
 * ({@link MULTI_ANSWER}), one whose options are the person's own
 * statements ({@link OWN_CHOICE}), or one of two or more side by side on
 * the same rows without a caption each (review round 1 of S6). Any other
 * cluster is left to the square rules: checkboxes. Held by
 * form-detect-combs.test.ts and form-detect-combs-review.test.ts.
 */
function radioStacks(
  tix: TextIndex,
  squares: readonly Candidate[],
  skip: ReadonlySet<CardRect>,
): { cands: Candidate[]; used: Set<CardRect> } {
  const eps = DETECT.COMB_EPS;
  const label = new Map<CardRect, string>();
  const ends = new Map<CardRect, number>();
  for (const c of squares) {
    const sq = c.square;
    if (!sq || skip.has(sq) || sq.filled || c.gridCell) continue;
    if (c.labelState !== "found" || !c.label) continue;
    const r = rightLabel(tix, sq);
    if (!r || r.str !== c.label) continue;
    label.set(sq, r.str);
    ends.set(sq, r.text.x + Math.max(0, r.text.width));
  }
  const cands: Candidate[] = [];
  const used = new Set<CardRect>();
  const found: {
    chain: CardRect[];
    caption: string | null;
    cand: Candidate;
  }[] = [];
  // The text items that are some square's own label (on its right or its
  // left, as the square rules chose), read once and only when a stack is
  // there to ask: a checkbox's "Big" over a stack named the group.
  let owned: Set<CardText> | undefined;
  const ownLabels = (): Set<CardText> => {
    if (owned) return owned;
    owned = new Set();
    for (const c of squares) {
      const sq = c.square;
      if (!sq || c.labelState !== "found" || !c.label) continue;
      const r = rightLabel(tix, sq);
      if (r && r.str === c.label) owned.add(r.text);
      const lo = sq.y0 - DETECT.RUN_BASELINE_EMS * 12;
      const l = leftOf(
        ySlice(tix, lo, sq.y1),
        sq.x0,
        DETECT.LABEL_LEFT_GAP,
        lo,
        () => sq.y1,
      ).find((h) => h.text.upright);
      if (l && l.str === c.label) owned.add(l.text);
    }
    return owned;
  };
  const height = (s: CardRect) => s.y1 - s.y0;
  for (const col of squareGroups([...label.keys()], (s) => s.x0)) {
    col.sort((a, b) => b.y1 - a.y1);
    const chains: CardRect[][] = [];
    for (const s of col) {
      const chain = chains[chains.length - 1];
      const prev = chain?.[chain.length - 1];
      const gap = prev ? prev.y0 - s.y1 : NaN;
      if (
        prev &&
        Math.abs(height(s) - height(prev)) <= eps &&
        Math.abs(gap - DETECT_COMBS.RADIO_STACK_GAP) <=
          DETECT_COMBS.RADIO_GAP_EPS + 1e-9
      )
        chain!.push(s);
      else chains.push([s]);
    }
    for (const chain of chains) {
      if (chain.length < DETECT_COMBS.RADIO_MIN) continue;
      const options = chain.map((s) => label.get(s)!);
      if (new Set(options).size !== options.length) continue;
      if (options.some((o) => OWN_CHOICE.some((re) => re.test(o)))) continue;
      const top = chain[0]!;
      const bottom = chain[chain.length - 1]!;
      const x0 = Math.min(...chain.map((s) => s.x0));
      const x1 = Math.max(...chain.map((s) => s.x1));
      // The text over the stack and under it, as LINES (each baseline's
      // items joined left to right), each line touching the stack or its
      // labels and read whole. Over it: the lines up to RADIO_VETO_ABOVE,
      // and the lines that follow on up from them at RADIO_VETO_LEADING
      // (the passage the caption ends). Under it: the line within
      // RADIO_VETO_BELOW, and the lines that follow it down. Either passage
      // asking for more than one answer, joined across its lines, leaves
      // checkboxes (verify round of S6: item by item, a line drawn a word
      // per call, a wrap or the end of the caption's line went unread).
      const reach = Math.max(...chain.map((s) => ends.get(s)!));
      const near = (t: CardText) =>
        t.upright &&
        cleanLabel(t.str) !== null &&
        overlap(
          t.x,
          t.x + Math.max(0, t.width),
          x0 - DETECT.LABEL_LEFT_GAP,
          reach,
        ) > 0;
      const far = DETECT_COMBS.RADIO_VETO_REACH;
      const descent = DETECT.TEXT_DESCENT_EMS * tix.maxSize;
      const rise = (l: TextLine) =>
        l.y - DETECT.TEXT_DESCENT_EMS * l.size - top.y1;
      const above = passage(
        textLines(ySlice(tix, top.y1, top.y1 + far + descent))
          .filter((l) => rise(l) >= 0 && l.items.some(near))
          .sort((a, b) => a.y - b.y),
        (l) => rise(l) <= DETECT_COMBS.RADIO_VETO_ABOVE,
      );
      const drop = (l: TextLine) => bottom.y0 - l.y;
      const below = passage(
        textLines(ySlice(tix, bottom.y0 - far, bottom.y0))
          .filter((l) => drop(l) >= l.size / 2 && l.items.some(near))
          .sort((a, b) => b.y - a.y),
        (l) => drop(l) <= DETECT_COMBS.RADIO_VETO_BELOW,
      );
      const asks = (ls: readonly TextLine[]) => {
        const s = ls.map((l) => l.str).join(" ");
        return MULTI_ANSWER.some((re) => re.test(s));
      };
      if (asks([...above].reverse()) || asks(below)) continue;
      // The caption: the lowest line of that passage with a descent 0 to
      // RADIO_CAPTION_ABOVE over the top square, its phrase that touches
      // the stack (never another square's own label), with the line over
      // it when it reads on from it (a wrap: it starts in lower case).
      const phraseOf = (l: TextLine | undefined): string | null => {
        if (!l) return null;
        const own = ownLabels();
        const words = l.items.filter((t) => !own.has(t));
        const at = words.findIndex(near);
        if (at < 0) return null;
        const gap = DETECT_COMBS.RADIO_PHRASE_GAP_EMS * l.size;
        const end = (t: CardText) => t.x + Math.max(0, t.width);
        let i = at;
        let j = at;
        while (i > 0 && words[i]!.x - end(words[i - 1]!) <= gap) i--;
        while (j + 1 < words.length && words[j + 1]!.x - end(words[j]!) <= gap)
          j++;
        return cleanLabel(joinItems(words.slice(i, j + 1)));
      };
      let low = 0;
      let caption: string | null = null;
      while (
        !caption &&
        low < above.length &&
        rise(above[low]!) <= DETECT_COMBS.RADIO_CAPTION_ABOVE
      )
        caption = phraseOf(above[low++]);
      low--;
      if (caption && /^\p{Ll}/u.test(caption)) {
        const over = phraseOf(above[low + 1]);
        if (over) caption = cleanLabel(`${over} ${caption}`);
      }
      // Buttons the printed pitch less the builder's gap, at whole points,
      // the stack's drift split above and below (anchored on the mean of
      // where each square puts the top one): any centre farther than
      // RADIO_CENTRE_EPS from its square's leaves checkboxes.
      const pitch = (top.y0 - bottom.y0) / (chain.length - 1);
      const step = Math.round(pitch);
      const side = step - DETECT_COMBS.RADIO_STACK_GAP;
      const mid = (a: number, b: number) => (a + b) / 2;
      const anchor =
        chain.reduce((sum, s, k) => sum + mid(s.y0, s.y1) + k * step, 0) /
        chain.length;
      const bx = Math.round(mid(top.x0, top.x1) - side / 2);
      const by = Math.round(anchor - side / 2);
      const drift = Math.max(
        ...chain.map((s, k) =>
          Math.max(
            Math.abs(bx + side / 2 - mid(s.x0, s.x1)),
            Math.abs(by + side / 2 - k * step - mid(s.y0, s.y1)),
          ),
        ),
      );
      if (drift > DETECT_COMBS.RADIO_CENTRE_EPS + 1e-9) continue;
      found.push({
        chain,
        caption,
        cand: {
          rule: "radio-stack",
          type: "radio",
          box: { x0, y0: bottom.y0, x1, y1: top.y1 },
          line: null,
          square: null,
          label: caption,
          labelState: "found",
          leftLabel: false,
          ownPiece: null,
          order: 0,
          radio: {
            options,
            top: { x0: bx, y0: by, x1: bx + side, y1: by + side },
          },
          fixed: true,
        },
      });
    }
  }
  // Stacks side by side on the same rows (tops and pitch within COMB_EPS,
  // as many squares): a list in columns, unless each has a caption of its
  // own. Sorted by top, so each group is a run of neighbours.
  found.sort((a, b) => a.chain[0]!.y1 - b.chain[0]!.y1);
  const pitchOf = (c: CardRect[]) =>
    (c[0]!.y0 - c[c.length - 1]!.y0) / (c.length - 1);
  for (let i = 0; i < found.length;) {
    let j = i + 1;
    const a = found[i]!.chain;
    while (
      j < found.length &&
      found[j]!.chain[0]!.y1 - a[0]!.y1 <= eps &&
      found[j]!.chain.length === a.length &&
      Math.abs(pitchOf(found[j]!.chain) - pitchOf(a)) <= eps
    )
      j++;
    const group = found.slice(i, j);
    const captions = group.map((g) => g.caption);
    const columns =
      group.length > 1 &&
      (captions.some((c) => c === null) ||
        new Set(captions).size !== captions.length);
    if (!columns)
      for (const g of group) {
        cands.push(g.cand);
        for (const s of g.chain) used.add(s);
      }
    i = j;
  }
  return { cands, used };
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
        if (c.type === "checkbox" || c.fixed) overlapsText = true;
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
 *  0. what the table read passed over (`large-table`, `filled-cells`:
 *     see {@link tables}), recorded before any candidate
 *  4. `toc-leader` (rows of dots), `ticked-box`, `comb` and `bullet` (box
 *     symbols), then `underline`, `full-width-divider`, `page-band`,
 *     `table-grid`, `comb`, `bullet`, then `unlabelled` / `rotated-label`
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
  // Tables (slice S5): their cells are read before the loop, and what the
  // read passes over is recorded first, so the cell it was about is
  // decided by it, not by the strip of a rule drawn under that cell.
  const plumbs = plumbBands(lines.verticals);
  let paint: Paint | undefined;
  const tableRead = tables(
    tix,
    lines,
    () => (paint ??= paintedIndex(p)),
    plumbs,
    on,
  );
  for (const box of tableRead.large) {
    exclude("large-table", box);
    counts.largeTables++;
  }
  for (const box of tableRead.filled) exclude("filled-cells", box);
  // The shapes typed in the text (slice S3), after the others, so the
  // others keep their order (`duplicate` keeps the first).
  const byItem = piecesByItem(all);
  const leaders = leaderCandidates(
    p,
    byItem,
    tix,
    yIndex(
      lines.squares,
      (s) => s.y0,
      (s) => s.y1 - s.y0,
    ),
    yIndex(
      lines.rules,
      (r) => r.y,
      () => 0,
    ),
  );
  // Slice S6: a labelled row of comb boxes becomes text fields, and a
  // stack of option squares at the builder's radio gap a radio group; the
  // squares either takes are not also checkboxes.
  const squares = squareCandidates(p, lines);
  const squareRuns = combRuns(lines.squares);
  const combs = combFields(
    tix,
    squareRuns,
    lines,
    new Set(squares.filter((c) => c.gridCell).map((c) => c.square!)),
  );
  const comb = new Set(
    squareRuns.filter((r) => r.length >= DETECT.COMB_MIN).flat(),
  );
  const radios = radioStacks(tix, squares, new Set([...comb, ...combs.used]));
  const cands = [
    ...ruleCandidates(p, lines, rowTable),
    ...runs.cands,
    ...squares.filter(
      (c) => !combs.used.has(c.square!) && !radios.used.has(c.square!),
    ),
    ...combs.cands,
    ...radios.cands,
    ...tableRead.cells,
    ...leaders.cands,
    ...boxCandidates(p, byItem, tix),
  ];
  cands.forEach((c, i) => (c.order = i));
  counts.candidates = cands.length + runs.short.length + leaders.short.length;

  // 1. The shape: runs and rows of dots too short to hold a field.
  const shorts = [
    ...runs.short.map((box) => ({ box, rule: "underscore-run" as const })),
    ...leaders.short.map((box) => ({ box, rule: "dot-leader" as const })),
  ];
  for (const { box, rule } of shorts)
    if (on("short-run")) exclude("short-run", box);
    else
      cands.push({
        rule,
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
    // 4. Shapes that are not fields: dots that lead to an entry, a box
    // already answered, character boxes, a bulleted list.
    if (c.leadsTo && on("toc-leader")) {
      exclude("toc-leader", c.box);
      continue;
    }
    if (c.glyph) {
      if (c.glyph.ticked && on("ticked-box")) {
        exclude("ticked-box", c.box);
        continue;
      }
      if (c.glyph.comb && on("comb")) {
        exclude("comb", c.box);
        continue;
      }
      if (c.glyph.bullet && on("bullet")) {
        exclude("bullet", c.box);
        continue;
      }
    }
    // Lines only. An entry box (slice S4) is neither: text on its bottom
    // edge is inside it, so it is no entry box, and one 0.85 to 0.9 of the
    // page wide is a full-width comment box (DETECT_BOXES; corpus P71).
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
    // An entry box is in the band only when all of it is (its bottom edge
    // can sit in the band under a box that reaches well above it).
    if (
      c.line &&
      on("page-band") &&
      inBand(c.line.y, p.height) &&
      (c.rule !== "entry-box" ||
        inBand(c.line.boxBottom?.top ?? c.box.y1, p.height))
    ) {
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
      (c.rule === "labelled-rule" || c.rule === "entry-box") &&
      on("table-grid") &&
      (gridTouches(c.line, plumbs(c.line.y, c.line.y)) ||
        (rowTable.has(c.line) && !c.leftLabel))
    ) {
      exclude("table-grid", c.box);
      continue;
    }
    // A box that holds a picture, a fill or other lines or boxes is no
    // empty box to write in (slice S4).
    if (c.boxPainted && on("filled-box")) {
      exclude("filled-box", c.box);
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
    // 9-10. Whole points, inside the page as the engine checks it. A radio
    // group's whole printed stack must fit; its proposal is its top button.
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
    const at = s.c.radio?.top ?? r;
    proposals.push({
      key: `${p.page}:${s.c.rule}:${at.x0}:${at.y0}`,
      page: p.page,
      x: at.x0,
      y: at.y0,
      width: at.x1 - at.x0,
      height: at.y1 - at.y0,
      type: s.c.type,
      label: s.c.label,
      rule: s.c.rule,
      ...(s.c.multiline && s.c.type === "text"
        ? { multiline: true as const }
        : {}),
      ...(s.c.maxLength !== undefined ? { maxLength: s.c.maxLength } : {}),
      ...(s.c.radio ? { options: [...s.c.radio.options] } : {}),
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
 * taking "a". A label with nothing left falls back to text_N / checkbox_N
 * / radio_N.
 * Held by the nameFor tests in form-detect.test.ts and the composed chain in
 * form-detect.pdfjs.test.ts.
 */
export function nameFor(
  label: string | null,
  type: FieldProposal["type"],
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
 * value, unchecked), multiline only where the proposal says so.
 */
export function proposalToDraftFields(
  proposals: readonly FieldProposal[],
  taken: Iterable<string> = [],
): (NewTextField | NewCheckBoxField | NewRadioField)[] {
  const names = new Set(taken);
  const perType = { text: 0, checkbox: 0, radio: 0 };
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
    if (p.type === "radio")
      return { type: "radio" as const, ...at, options: [...(p.options ?? [])] };
    return p.type === "text"
      ? {
          type: "text" as const,
          ...at,
          multiline: p.multiline === true,
          ...(p.maxLength !== undefined ? { maxLength: p.maxLength } : {}),
        }
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
