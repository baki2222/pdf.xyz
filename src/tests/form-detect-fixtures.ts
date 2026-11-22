import {
  PDFDocument,
  PDFName,
  concatTransformationMatrix,
  degrees,
  drawObject,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  setLineWidth,
  setTextRenderingMode,
  stroke,
  TextRenderingMode,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { readFormContext, validateFormFields } from "@/lib/pdf/create-forms";
import {
  filterValid,
  proposalToDraftFields,
  type Box,
  type DetectionRuleId,
  type Excluded,
  type ExclusionRuleId,
  type FieldProposal,
  type Placement,
} from "@/lib/pdf/form-detect";
import {
  detectFormFields,
  type DetectReport,
  type PageOutcome,
  type PdfjsLike,
} from "@/lib/pdf/form-detect-read";
import { drawRasterImage, embedRasterImage } from "@/lib/pdf/pdf-lib";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import { PRECISION_CASES } from "./form-detect-precision-fixtures";
import { BOX_CASES } from "./form-detect-boxes-fixtures";

/**
 * TEST ONLY. The Create Forms field finder's corpus: every case is a small
 * PDF generated here with pdf-lib (no binary fixtures), with what the finder
 * must propose, or which rule must decide that nothing is proposed.
 *
 * Expected boxes are computed from the geometry each case draws (pdf-lib's
 * own font widths, the page's crop and turn), in the card frame: points from
 * the bottom-left of the page as displayed, whole numbers. Read by
 * form-detect.pdfjs.test.ts (every case through the real reader) and
 * form-detect.corpus.test.ts (the corpus run both ways: every rule caught by
 * some case, every case explained).
 */

export interface Expect {
  rule: DetectionRuleId;
  type: "text" | "checkbox";
  label: string | null;
  page: number;
  /** Card frame, +-1 pt. */
  box: Box;
  /** The name `nameFor` must give it, when the case is about naming. */
  name?: string;
  /**
   * A field for several lines (slice S4). Compared both ways by
   * {@link matches}: a proposal is multiline exactly when this is true.
   */
  multiline?: boolean;
}

export interface DetectCase {
  id: string;
  kind: "positive" | "negative" | "outcome";
  /** What the page shows, in plain words. */
  note: string;
  build: () => Promise<Uint8Array>;
  /** Exactly what must be proposed, or "none". */
  expect: Expect[] | "none";
  /** The first rule that must decide the case's shape. */
  decidedBy?: ExclusionRuleId;
  /** A card-frame point inside the deciding exclusion's box. */
  at?: { page: number; x: number; y: number };
  /** Rules the run itself disables (the `invalid` case). */
  disable?: ExclusionRuleId[];
  /**
   * Rules that must ALSO be disabled for the seam test to see a proposal,
   * because the shape would otherwise be decided by the next rule in order
   * (a divider has no label by definition, so it would then be unlabelled).
   */
  seamAlsoDisable?: ExclusionRuleId[];
  /** Page 1's outcome. */
  outcome?: PageOutcome["outcome"];
  /** Outcomes by page, each one of a set. */
  outcomes?: { pages: number[]; oneOf: PageOutcome["outcome"][] }[];
  /** Names already taken (the PDF's fields), for the naming cases. */
  existingNames?: string[];
  /** Cards already in the builder. */
  drafts?: Placement[];
}

/* ------------------------------------------------------------------ *
 *  Geometry the expectations are computed from
 * ------------------------------------------------------------------ */

/** The three faces the corpus draws in: Helvetica, Times and Courier. */
export type Face = "sans" | "serif" | "mono";
type FontKey = Face;

/**
 * Measuring fonts, from the same chooser `text()` draws through. Every string
 * this corpus draws is WinAnsi, for which the chooser returns the standard
 * face itself; `text()` passes each string it draws, so a non-WinAnsi one
 * would be refused there rather than mismeasured here.
 */
const metricsDoc = await PDFDocument.create();
const METRICS: Record<Face, PDFFont> = {
  sans: await embedDrawingFont(metricsDoc, ["Name: _"], "sans"),
  serif: await embedDrawingFont(metricsDoc, ["Name: _"], "serif"),
  mono: await embedDrawingFont(metricsDoc, ["Name: _"], "mono"),
};

/** pdf-lib's own width of `text` (independent of the finder's estimate). */
export function textWidth(font: FontKey, text: string, size: number): number {
  return METRICS[font].widthOfTextAtSize(text, size);
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** Edges rounded the way the finder rounds a box. */
function rounded(x0: number, y0: number, x1: number, y1: number): Box {
  const x = Math.round(x0);
  const y = Math.round(y0);
  return { x, y, width: Math.round(x1) - x, height: Math.round(y1) - y };
}

/** The field over an underscore run drawn at (x, baseline) after `prefix`. */
export function runBox(
  font: FontKey,
  x: number,
  baseline: number,
  size: number,
  prefix: string,
  run: string,
): Box {
  const start = x + textWidth(font, prefix, size);
  const end = start + textWidth(font, run, size);
  const bottom = baseline - 0.15 * size;
  return rounded(
    start + 1,
    bottom,
    end - 1,
    bottom + clamp(1.2 * size, 12, 22),
  );
}

/** The field over a rule from x0 to x1 at y, labelled in `size` text. */
export function ruleBox(x0: number, x1: number, y: number, size: number): Box {
  const bottom = y + 1;
  return rounded(x0 + 1, bottom, x1 - 1, bottom + clamp(1.4 * size, 14, 22));
}

/** The field filling a table cell from (x0, y0) to (x1, y1), inset 1 pt. */
export function cellBox(x0: number, x1: number, y0: number, y1: number): Box {
  return rounded(x0 + 1, y0 + 1, x1 - 1, y1 - 1);
}

/** N38's Word-style table: its rules, and the labels in its left cells. */
const N38_YS = [600, 576, 552, 528, 504];
const N38_LABELS = ["Name", "Address", "Telephone", "Email"];

/** The checkbox inside a square drawn at (x, y) with side s. */
export function squareBox(x: number, y: number, s: number): Box {
  return rounded(x + 1, y + 1, x + s - 1, y + s - 1);
}

/**
 * A content-space box on a /Rotate 90 page whose visible box is `crop`, in
 * the card frame: a clockwise quarter turn, so the content's left edge
 * becomes the displayed top: card x = y - crop.y and
 * card y = crop.x + crop.width - x. Written out here rather than read from
 * pdf.js or page-frame.ts, so it cannot agree with the code under test by
 * sharing it.
 */
export function turned90(b: Box, crop: Box): Box {
  return {
    x: b.y - crop.y,
    y: crop.x + crop.width - (b.x + b.width),
    width: b.height,
    height: b.width,
  };
}

/** The inverse of {@link turned90}: a card-frame box back in content space. */
export function unturned90(b: Box, crop: Box): Box {
  return {
    x: crop.x + crop.width - (b.y + b.height),
    y: b.x + crop.y,
    width: b.height,
    height: b.width,
  };
}

/**
 * The `cm` that counter-turns a /Rotate 90 page whose visible box is `crop`,
 * so what is drawn after it at (x, y) shows upright at card (x, y): a
 * landscape page made the common way.
 */
function counterTurn90(page: PDFPage, crop: Box) {
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(0, 1, -1, 0, crop.x + crop.width, crop.y),
  );
}

/** Where P10 draws on its turned page 2, in its own (= card) frame. */
export const P10_LOCAL = { nameY: 380 };

/* ------------------------------------------------------------------ *
 *  Drawing
 * ------------------------------------------------------------------ */

const LETTER: [number, number] = [612, 792];
const A5_LANDSCAPE: [number, number] = [595.28, 419.53];
const A4: [number, number] = [595.28, 841.89];
const UNDERSCORES = "____________";

async function doc(): Promise<PDFDocument> {
  return PDFDocument.create();
}

/** Draw `s` in a face the font chooser picks for exactly that string. */
async function text(
  page: PDFPage,
  face: Face,
  s: string,
  x: number,
  y: number,
  size = 12,
  rotate = 0,
) {
  page.drawText(s, {
    x,
    y,
    size,
    font: await embedDrawingFont(page.doc, [s], face),
    color: rgb(0, 0, 0),
    ...(rotate ? { rotate: degrees(rotate) } : {}),
  });
}

function rule(
  page: PDFPage,
  x0: number,
  x1: number,
  y: number,
  thickness = 1,
  color = rgb(0, 0, 0),
) {
  page.drawLine({
    start: { x: x0, y },
    end: { x: x1, y },
    thickness,
    color,
  });
}

function vline(page: PDFPage, x: number, y0: number, y1: number) {
  page.drawLine({
    start: { x, y: y0 },
    end: { x, y: y1 },
    thickness: 1,
    color: rgb(0, 0, 0),
  });
}

function square(
  page: PDFPage,
  x: number,
  y: number,
  s: number,
  filled = false,
) {
  page.drawRectangle({
    x,
    y,
    width: s,
    height: s,
    ...(filled
      ? { color: rgb(0, 0, 0) }
      : { borderColor: rgb(0, 0, 0), borderWidth: 1 }),
  });
}

/**
 * Append a content stream written as PDF operators, for the shapes pdf-lib's
 * drawing calls cannot make (a stretched `cm`, a clip, a bare `m l l l f`).
 */
function raw(page: PDFPage, content: string) {
  const ctx = page.doc.context;
  page.node.addContentStream(ctx.register(ctx.stream(content)));
}

/**
 * A form XObject drawing `content`, clipped to `bbox` (its /BBox, in form
 * space), painted on the page with `Do`.
 */
function formXObject(page: PDFPage, content: string, bbox: number[]) {
  const ctx = page.doc.context;
  const ref = ctx.register(
    ctx.stream(content, { Type: "XObject", Subtype: "Form", BBox: bbox }),
  );
  raw(page, `q ${page.node.newXObject("Fc", ref).asString()} Do Q`);
}

/**
 * "Address:" where P4 draws it, and a transparency-group form XObject with
 * /Matrix [1 0 0 1 120 590] and /BBox [0 0 300 20] (so [120 590 420 610] on
 * the page) drawing `content`. pdf.js 6 hands such a form's /BBox to
 * beginGroup only, under the group's matrix.
 */
async function addressInGroup(content: string): Promise<Uint8Array> {
  const d = await doc();
  const page = d.addPage(LETTER);
  await text(page, H, "Address:", P4.labelX, P4.y);
  const ctx = d.context;
  const ref = ctx.register(
    ctx.stream(content, {
      Type: "XObject",
      Subtype: "Form",
      BBox: [0, 0, 300, 20],
      Matrix: [1, 0, 0, 1, 120, 590],
      Group: { S: "Transparency" },
    }),
  );
  raw(page, `q ${page.node.newXObject("Gx", ref).asString()} Do Q`);
  return save(d);
}

/** "Address:" where P4 draws it, with `content` as the page's only lines. */
async function addressWith(content: string): Promise<Uint8Array> {
  const d = await doc();
  const page = d.addPage(LETTER);
  await text(page, H, "Address:", P4.labelX, P4.y);
  raw(page, content);
  return save(d);
}

async function save(d: PDFDocument): Promise<Uint8Array> {
  return d.save({ useObjectStreams: false });
}

/** Three lines of body text across the page at `size`, from 72 at 600. */
async function proseBody(page: PDFPage, size: number) {
  const lines = [
    "Body text runs across the whole width of the text column, line after line,",
    "as an annual report or a letter would set it, in one size from margin to",
    "margin, so that the size most of the page is set in is easy to read off.",
  ];
  for (const [i, s] of lines.entries())
    await text(page, H, s, 72, 600 - 1.3 * size * i, size);
}

/** "Name: ____________" at (x, y). */
async function nameRun(
  page: PDFPage,
  f: Face,
  x: number,
  y: number,
  size = 12,
) {
  await text(page, f, `Name: ${UNDERSCORES}`, x, y, size);
}

/** "Address:" and a stroked two-point rule to its right. */
const P4 = { labelX: 72, x0: 130, x1: 330, y: 600 };
async function addressRule(page: PDFPage, f: Face, y = P4.y) {
  await text(page, f, "Address:", P4.labelX, y);
  rule(page, P4.x0, P4.x1, y);
}

/** A column of four 12 pt squares, each labelled to its right. */
const P7 = { x: 72, ys: [500, 480, 460, 440], labels: ["A", "B", "C", "D"] };
async function optionSquares(page: PDFPage, f: Face) {
  for (const [i, y] of P7.ys.entries()) {
    square(page, P7.x, y, 12);
    await text(page, f, `Option ${P7.labels[i]}`, P7.x + 18, y + 2, 10);
  }
}
function optionExpect(page: number, map: (b: Box) => Box = (b) => b): Expect[] {
  return P7.ys.map((y, i) => ({
    rule: "square-checkbox" as const,
    type: "checkbox" as const,
    label: `Option ${P7.labels[i]}`,
    page,
    box: map(squareBox(P7.x, y, 12)),
  }));
}

const H: Face = "sans";
const T: Face = "serif";
const C: Face = "mono";

/** P27's label column, top to bottom. */
const P27_LABELS = ["Name:", "Email:", "Date of birth:", "City:", "Telephone:"];
/**
 * P28's two inline answer rows (Helvetica 10): "Yes" ends 4.8 pt left of its
 * box and "No" starts 18 pt right of it; in the label-right row each label
 * starts 4 pt right of its box and "Yes" ends 18.8 pt left of the next box.
 */
const P28 = {
  left: [
    ["Yes", 380],
    ["No", 430],
  ] as const,
  leftBoxes: [402, 447],
  rightBoxes: [380, 430],
  right: [
    ["Yes", 394],
    ["No", 444],
  ] as const,
};
/**
 * P35's rows (Helvetica 10). Smoke: each box 5 pt left of its label, the
 * second box 4 pt after "Yes". History: column 2's box 4 pt after the end
 * of "High blood pressure", its own label 6 pt right of it. Male / Female:
 * each label 4 pt left of its box, "Female" starting 1 pt after the first.
 */
const P35_SMOKE = 72 + textWidth(H, "Do you smoke?", 10) + 12;
const P35_MALE = 72 + textWidth(H, "Male", 10) + 4;
const P35 = {
  smoke: [
    ["Yes", P35_SMOKE],
    ["No", P35_SMOKE + 15 + textWidth(H, "Yes", 10) + 4],
  ] as const,
  history: [
    ["Asthma", "Diabetes"],
    ["High blood pressure", "Heart disease"],
  ] as const,
  col2: 72 + 16 + textWidth(H, "High blood pressure", 10) + 4,
  male: P35_MALE,
  female: P35_MALE + 11 + textWidth(H, "Female", 10) + 4,
};
/** P36's two headed option lists, at x 72 and 300 (Helvetica 10). */
const P36 = [
  { head: "Symptoms", options: ["Fever", "Cough", "Headache"] },
  { head: "Medication", options: ["Insulin", "Inhaler", "Aspirin"] },
];
/** P37's captioned lines (10 pt captions 10 pt under, 7 pt hints 20). */
const P37 = [
  {
    x0: 72,
    x1: 300,
    y: 660,
    label: "Full name",
    hint: "(as shown on your passport)",
  },
  { x0: 320, x1: 540, y: 660, label: "Date of birth", hint: "(DD/MM/YYYY)" },
  { x0: 72, x1: 300, y: 610, label: "Email address", hint: null },
];
/** P38's bottom-band row: caption, line start, line end (y 58). */
const P38 = [
  ["Print name", 72, 260],
  ["Date", 320, 460],
] as const;
/** P39's labelled lines: label, line start, y (lines end at 540). */
const P39 = [
  ["Name", 120, 660],
  ["Phone", 120, 636],
  ["Employer", 130, 572],
] as const;
/** P40's grid: 12 pt boxes 1 pt apart, heads 6 pt over the top row. */
const P40 = {
  rows: ["Married", "Employed"],
  heads: ["Y", "N"],
  xs: [400, 413],
};
/** N43's statements, their baselines, and where each initials box starts. */
const N43 = {
  statements: [
    "I have read and understood the information sheet.",
    "I understand that my taking part is voluntary.",
    "I agree that my anonymised data may be used.",
  ],
  ys: [660, 620, 580],
  boxX: 400 + textWidth(H, "Initial here:", 10) + 6,
};
/** P41's fee table: column edges, row edges (top first), its text. */
const P41 = {
  xs: [72, 280, 370, 460, 540],
  ys: [556, 536, 516, 496, 476, 456],
  head: ["Category", "Early bird", "Standard", "Select"],
  rows: [
    ["Full delegate", "$450", "$550"],
    ["Student", "$200", "$260"],
    ["One day only", "$180", "$220"],
    ["Conference dinner", "$75", "$75"],
  ],
  boxX: 494,
};
/** P42's three 150 x 50 boxes at y 130, 9 pt apart, 8 pt captions inside. */
const P42 = {
  captions: ["Received by", "Signature", "Date"],
  x: (i: number) => 72 + i * 159,
};
/**
 * P50's row of separate captioned boxes (a W-2's): 150 pt wide, 10 pt
 * apart, `h` tall from y 650, an 8 pt caption 2 pt under each top-left.
 */
const P50 = {
  captions: [
    "1 Wages, tips, other compensation",
    "2 Federal income tax withheld",
    "3 Social security wages",
  ],
  x: (i: number) => 72 + i * 160,
  h: 24,
};
/**
 * P51's compact captioned boxes: P50's row, 20 pt tall, with 7 pt captions
 * whose ascent is 2 pt under the top. A field fills the box under the
 * caption's descent.
 */
const P51 = { h: 20, size: 7, base: 650 + 20 - 2 - 0.7 * 7 };
/** P52's checklist rows (code, item) and their baselines. */
const P52 = {
  rows: [
    ["A1", "Laptop"],
    ["A2", "Charger"],
    ["B7", "Badge"],
    ["C3", "Headset"],
    ["D4", "Monitor"],
  ] as const,
  y: (i: number) => 668 - 18 * i,
};
/** N49's article: its body (set twice, at y 700 and 550) and sidebar lines. */
const N49 = {
  body: [
    "Heating and cooling account for nearly half of a typical",
    "household's energy bill. Small changes in how a home is",
    "insulated, ventilated and heated add up over a winter, and",
    "most of them cost little or nothing to make. Sealing the",
    "gaps around doors and windows is the cheapest place to",
    "start, followed by insulating the loft and hot water pipes.",
    "A programmable thermostat lets the heating run only when",
    "the house is occupied, and lowering it by one degree can",
    "cut a bill by as much as ten percent over a season.",
    "Curtains drawn at dusk keep the warmth of the day indoors.",
  ],
  sidebar: [
    "A dripping hot tap can waste enough",
    "energy in a week to fill a bath.",
    "Fixing a washer costs a few pence.",
  ],
};
/** N50's statement: its rows (right-aligned at 540) and the total. */
const N50 = {
  rows: [
    ["Wages", "64,250.00"],
    ["Interest", "412.18"],
    ["Dividends", "1,036.40"],
  ] as const,
  total: "65,698.58",
};
/** P43's empty boxes, each captioned with its baseline 4 pt over the top. */
const P43 = [
  { caption: "Dietary requirements", y: 340, h: 70 },
  { caption: "Comments:", y: 230, h: 60 },
];
/** N44's boxed notices: box bottom, height, notice baseline. */
const N44 = [
  {
    y: 660,
    h: 24,
    base: 668,
    notice: "Note: the office closes at 5 pm on Fridays.",
  },
  {
    y: 590,
    h: 40,
    base: 614,
    notice: "Important: bring photo ID to every appointment.",
  },
];
/** P44's boxes at x 140, each label (10 pt) centred on its box's height. */
const P44 = [
  { label: "Total hours", y: 650, w: 130, h: 22 },
  { label: "Received by:", y: 600, w: 200, h: 18 },
  { label: "Reference:", y: 540, w: 200, h: 30 },
];
/** N45's timesheet grid: column edges, row edges (top first), its text. */
const N45 = {
  xs: [72, 170, 250, 330, 410, 540],
  ys: [630, 610, 588, 566, 544, 522, 500, 478, 456],
  head: ["Day", "Start", "Finish", "Break", "Hours"],
  days: [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ],
};
/** P45's tiled customs boxes: x, y, width, height, caption (7 pt). */
const P45: [number, number, number, number, string][] = [
  [72, 640, 234, 80, "1 Exporter (name and address)"],
  [306, 640, 234, 80, "2 Consignee (name and address)"],
  [72, 600, 156, 40, "3 Country of dispatch"],
  [228, 600, 156, 40, "4 Country of origin"],
  [384, 600, 156, 40, "5 Country of destination"],
  [72, 560, 234, 40, "6 Commodity code"],
  [306, 560, 117, 40, "7 Gross mass (kg)"],
  [423, 560, 117, 40, "8 Net mass (kg)"],
  [72, 500, 468, 60, "9 Description of goods"],
];
/** N46's filled data table (a delivery note's items). */
const N46 = {
  xs: [72, 140, 420, 540],
  ys: [670, 650, 630, 610, 590],
  rows: [
    ["Qty", "Description", "Item code"],
    ["4", "Pallet of copier paper A4", "CP-A4-80"],
    ["12", "Toner cartridge, black", "TN-2410"],
    ["2", "Archive boxes (pack of 10)", "AB-10"],
  ],
};
/** P46's packing list: items, row baselines, the Packed column's boxes. */
const P46 = {
  items: ["Passport", "Tickets", "Charger", "Medication", "Keys"],
  y: (i: number) => 620 - 20 * i,
  boxX: 405,
};
/**
 * P48's two-row header: per column, the labels' x, the tab stop, the line's
 * end, and its two labels (Helvetica 10); rows at y 660 and 636.
 */
export const P48 = {
  columns: [
    { x: 72, tab: 140, end: 300, labels: ["Vehicle reg:", "Driver:"] },
    { x: 320, tab: 382, end: 540, labels: ["Odometer:", "Date:"] },
  ],
  ys: [660, 636],
};
/** P49's two-level grid: groups over pairs of Yes / No columns. */
const P49 = {
  groups: ["Left eye", "Right eye"],
  heads: ["Yes", "No"],
  xs: [300, 330, 380, 410],
  rows: ["Redness", "Itching", "Blurred vision"],
  y: (i: number) => 600 - 20 * i,
};
/** N47's two 8-box date combs (14 pt, edge to edge), one head per box. */
const N47 = {
  rows: ["Date of birth", "Date of arrival"],
  heads: ["D", "D", "M", "M", "Y", "Y", "Y", "Y"],
  x: (k: number) => 200 + 14 * k,
  ys: [600, 570],
};
/** N32's line starts 40 pt right of where "Address:" (12 pt) ends. */
const N32_X0 = 72 + textWidth(H, "Address:", 12) + 40;
/**
 * N33's digit boxes (16 pt, Helvetica 10 labels 6 pt to their left): a
 * date's DD and MM pairs and YYYY four, with "/" between the groups; a
 * two-box "Age"; a three-box "House no.".
 */
const N33 = {
  date: 72 + textWidth(H, "Date of birth", 10) + 6,
  age: 72 + textWidth(H, "Age", 10) + 6,
  house: 72 + textWidth(H, "House no.", 10) + 6,
};
/**
 * P29's W-9-style strips: five rules (72..540, an even 26 pt apart), each
 * strip's 7 pt caption at its top-left, 7 pt under the rule above it.
 */
const P29 = {
  ys: [710, 684, 658, 632, 606],
  captions: [
    "1 Name (as shown on your income tax return)",
    "2 Business name, if different from above",
    "3 Address (number, street, and apt. or suite no.)",
    "4 City, state, and ZIP code",
  ],
};
/**
 * P30's medical history grid: four conditions down the left, a 10 pt Yes
 * and No box in each row, "Yes" and "No" (9 pt) centred over the columns.
 */
const P30 = {
  rows: ["Asthma", "Diabetes", "Epilepsy", "Heart condition"],
  heads: ["Yes", "No"],
  xs: [400, 452],
};
/**
 * P31's rating grid: three statements with dot leaders up to the first of
 * five 10 pt boxes 30 pt apart, "1" to "5" (9 pt) centred over them.
 */
const P31 = {
  rows: ["The staff were helpful", "The room was clean", "I would stay again"],
  heads: ["1", "2", "3", "4", "5"],
  xs: [350, 380, 410, 440, 470],
};
/** A row's text with dot leaders up to `gap` pt before x (Helvetica 10). */
function leadered(s: string, x: number, gap = 4): string {
  let out = `${s} `;
  while (72 + textWidth(H, `${out}.`, 10) <= x - gap) out += ".";
  return out;
}
/** A grid's 10 pt boxes, row text at 72 from y 600 down, heads at 620. */
async function headedGrid(
  page: PDFPage,
  g: { rows: string[]; heads: string[]; xs: number[] },
  row: (s: string) => string,
) {
  for (const [k, h] of g.heads.entries())
    await text(page, H, h, g.xs[k]! + 5 - textWidth(H, h, 9) / 2, 620, 9);
  for (const [i, s] of g.rows.entries()) {
    await text(page, H, row(s), 72, 600 - 20 * i, 10);
    for (const x of g.xs) square(page, x, 598 - 20 * i, 10);
  }
}
function headedExpect(g: {
  rows: string[];
  heads: string[];
  xs: number[];
}): Expect[] {
  return g.rows.flatMap((s, i) =>
    g.heads.map((h, k) => ({
      rule: "square-checkbox" as const,
      type: "checkbox" as const,
      label: `${s} ${h}`,
      page: 1,
      box: squareBox(g.xs[k]!, 598 - 20 * i, 10),
    })),
  );
}
/**
 * P32's address block (Helvetica 10, lines 24 pt apart, each line 4 pt
 * right of its label): Name, Address and two lines from the margin under
 * it, Postcode; then a Print name line, and a Date line at Print name's tab
 * stop whose label ends 36.5 pt to its left.
 */
const P32 = {
  rows: [
    ["Name:", 600],
    ["Address:", 576],
    [null, 552],
    [null, 528],
    ["Postcode:", 504],
    ["Print name:", 460],
  ] as const,
  printName: 72 + textWidth(H, "Print name:", 10) + 4,
  dateY: 436,
};
const p32Start = (s: string | null) =>
  s === null ? 72 : 72 + textWidth(H, s, 10) + 4;
/** N34's 16 pt box, 6 pt right of its label (Helvetica 10). */
const N34_X = 72 + textWidth(H, "Number of dependants", 10) + 6;
/**
 * N35's four separate outlined boxes (72..540, 28 pt tall, 16 pt apart),
 * each with a 7 pt caption inside its top-left, 7 pt under its top edge.
 */
const N35 = {
  tops: [688, 644, 600, 556],
  captions: [
    "1 Name (as shown on your income tax return)",
    "2 Business name, if different from above",
    "3 Address (number, street, and apt. or suite no.)",
    "4 City, state, and ZIP code",
  ],
};

function p1(key: FontKey, id: string): DetectCase {
  return {
    id,
    kind: "positive",
    note: `"Name: ____________" in ${key}`,
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await nameRun(page, key, 72, 700);
      return save(d);
    },
    expect: [
      {
        rule: "underscore-run",
        type: "text",
        label: "Name",
        page: 1,
        box: runBox(key, 72, 700, 12, "Name: ", UNDERSCORES),
      },
    ],
  };
}

/** Four labelled lines stacked at an even pitch, a date hint under one. */
const P19 = {
  ys: [600, 570, 540, 510],
  labels: ["Surname:", "Forenames:", "Date of birth:", "Nationality:"],
};

/** Three captioned lines at an even pitch: an address block. */
const P20 = { ys: [600, 568, 536] };

/** An instruction at y 640 over lines 32 pt apart, each with an 8 pt caption. */
async function captionedLines(
  instruction: string,
  size: number,
  captions: string[],
): Promise<Uint8Array> {
  const d = await doc();
  const page = d.addPage(LETTER);
  await text(page, H, instruction, 72, 640, size);
  for (const [i, s] of captions.entries()) {
    rule(page, 72, 400, 600 - 32 * i, 0.5);
    await text(page, H, s, 74, 590 - 32 * i, 8);
  }
  return save(d);
}
function captionedExpect(captions: string[]): Expect[] {
  return captions.map((label, i) => ({
    rule: "labelled-rule" as const,
    type: "text" as const,
    label,
    page: 1,
    box: ruleBox(72, 400, 600 - 32 * i, 8),
  }));
}

const P10_CROP: Box = { x: 36, y: 48, width: 540, height: 696 };
/** O7's labels and where they sit, in its own (= card) frame: [label, x, y]. */
const O7_LINES: [string, number, number][] = [
  "Name",
  "Address",
  "City",
  "Phone",
].flatMap((s, i) =>
  [72, 420].map((x) => [s, x, 500 - 40 * i] as [string, number, number]),
);
/** O9's invisible labelled runs: [label, baseline]. */
const O9_LINES: [string, number][] = [
  ["Name", 600],
  ["Date of birth", 560],
];
const N19_CROP = { x: 0, y: 0, width: 400, height: 792 };
const N10 = { x: 100, y: 300, w: 400, h: 120 };
const PRENOM = `Pr${String.fromCodePoint(0xe9)}nom`;

/** The bytes N19 and N20 share: a labelled rule running past the crop. */
async function offPageBytes(): Promise<Uint8Array> {
  const d = await doc();
  const page = d.addPage(LETTER);
  page.setCropBox(N19_CROP.x, N19_CROP.y, N19_CROP.width, N19_CROP.height);
  await text(page, H, "Name:", 250, 600);
  rule(page, 290, 450, 600);
  return save(d);
}

/** A 1 x 1 grey PNG. */
const PNG_1PX = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

/** O2's content before it is cut, and where it is cut (mid-operator). */
export const O2_CONTENT = "q 0 G 1 w 150 700 m 300 700 l S Q\n";
export const O2_CUT = O2_CONTENT.indexOf("300 700 l") + 5;

/**
 * A page whose content stream is cut part-way through an operator, the
 * stream's /Length fixed to match. Built uncompressed with object streams
 * off (otherwise the stream cannot be found and cut in the bytes).
 */
export async function damagedBytes(): Promise<{
  bytes: Uint8Array;
  before: number;
  after: number;
}> {
  const d = await doc();
  const page = d.addPage(LETTER);
  const stream = d.context.stream(O2_CONTENT);
  page.node.set(PDFName.of("Contents"), d.context.register(stream));
  const whole = await save(d);
  const s = Buffer.from(whole).toString("latin1");
  const at = s.indexOf(O2_CONTENT);
  if (at < 0) throw new Error("O2: content stream not found in the bytes");
  const head = s.slice(0, at);
  const lengthAt = head.lastIndexOf(`/Length ${O2_CONTENT.length}`);
  if (lengthAt < 0) throw new Error("O2: /Length not found");
  const cut = O2_CONTENT.slice(0, O2_CUT);
  const out =
    head.slice(0, lengthAt) +
    `/Length ${cut.length}` +
    head.slice(lengthAt + `/Length ${O2_CONTENT.length}`.length) +
    cut +
    s.slice(at + O2_CONTENT.length);
  return {
    bytes: Uint8Array.from(Buffer.from(out, "latin1")),
    before: O2_CONTENT.length,
    after: cut.length,
  };
}

/* ------------------------------------------------------------------ *
 *  The corpus
 * ------------------------------------------------------------------ */

export const DETECT_CASES: readonly DetectCase[] = [
  // ---------------------------------------------------------- positives
  p1(H, "P1a"),
  p1(T, "P1b"),
  p1(C, "P1c"),
  {
    id: "P2",
    kind: "positive",
    note: '"Date ________ Place ________": two runs in one text item',
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await text(page, H, "Date ________ Place ________", 72, 650);
      return save(d);
    },
    expect: [
      {
        rule: "underscore-run",
        type: "text",
        label: "Date",
        page: 1,
        box: runBox(H, 72, 650, 12, "Date ", "________"),
      },
      {
        rule: "underscore-run",
        type: "text",
        label: "Place",
        page: 1,
        box: runBox(H, 72, 650, 12, "Date ________ Place ", "________"),
      },
    ],
  },
  {
    id: "P3",
    kind: "positive",
    note: "the run drawn as its own text item after the label",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      const f = H;
      await text(page, f, "Name:", 72, 700);
      await text(page, f, UNDERSCORES, 72 + textWidth(H, "Name: ", 12), 700);
      return save(d);
    },
    expect: [
      {
        rule: "underscore-run",
        type: "text",
        label: "Name",
        page: 1,
        box: runBox(H, 72, 700, 12, "Name: ", UNDERSCORES),
      },
    ],
  },
  {
    id: "P4",
    kind: "positive",
    note: '"Address:" and a stroked two-point line to its right',
    build: async () => {
      const d = await doc();
      await addressRule(d.addPage(LETTER), H);
      return save(d);
    },
    expect: [
      {
        rule: "labelled-rule",
        type: "text",
        label: "Address",
        page: 1,
        box: ruleBox(P4.x0, P4.x1, P4.y, 12),
      },
    ],
  },
  {
    id: "P5",
    kind: "positive",
    note: "a label and a thin filled bar (0.75 pt) as the line",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await text(page, H, "Phone:", 72, 650);
      page.drawRectangle({
        x: 120,
        y: 649.625,
        width: 180,
        height: 0.75,
        color: rgb(0, 0, 0),
      });
      return save(d);
    },
    expect: [
      {
        rule: "labelled-rule",
        type: "text",
        label: "Phone",
        page: 1,
        box: ruleBox(120, 300, 650, 12),
      },
    ],
  },
  {
    id: "P6",
    kind: "positive",
    note: 'a line with its caption "Date" printed under it',
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      rule(page, 150, 300, 550);
      await text(page, H, "Date", 150, 540, 9);
      return save(d);
    },
    expect: [
      {
        rule: "labelled-rule",
        type: "text",
        label: "Date",
        page: 1,
        box: ruleBox(150, 300, 550, 9),
      },
    ],
  },
  {
    id: "P7",
    kind: "positive",
    note: "a column of four 12 pt squares, each labelled to the right",
    build: async () => {
      const d = await doc();
      await optionSquares(d.addPage(LETTER), H);
      return save(d);
    },
    expect: optionExpect(1),
  },
  {
    id: "P8",
    kind: "positive",
    note: "three `re` squares painted by ONE stroke operator",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      page.pushOperators(
        pushGraphicsState(),
        setLineWidth(1),
        rectangle(72, 300, 12, 12),
        rectangle(72, 280, 12, 12),
        rectangle(72, 260, 12, 12),
        stroke(),
        popGraphicsState(),
      );
      const f = H;
      await text(page, f, "Yes", 90, 302, 10);
      await text(page, f, "No", 90, 282, 10);
      await text(page, f, "Maybe", 90, 262, 10);
      return save(d);
    },
    expect: [
      ["Yes", 300],
      ["No", 280],
      ["Maybe", 260],
    ].map(([label, y]) => ({
      rule: "square-checkbox" as const,
      type: "checkbox" as const,
      label: label as string,
      page: 1,
      box: squareBox(72, y as number, 12),
    })),
  },
  {
    id: "P9",
    kind: "positive",
    note: "the P4 line inside a form XObject drawn under a 2x `cm`",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await text(page, H, "Address:", P4.labelX, 400);
      const xobj = d.context.formXObject(
        [
          setLineWidth(0.5),
          moveTo(P4.x0 / 2, 200),
          lineTo(P4.x1 / 2, 200),
          stroke(),
        ],
        { BBox: [0, 0, 306, 396] },
      );
      const name = page.node.newXObject("Fm", d.context.register(xobj));
      page.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(2, 0, 0, 2, 0, 0),
        drawObject(name),
        popGraphicsState(),
      );
      return save(d);
    },
    expect: [
      {
        rule: "labelled-rule",
        type: "text",
        label: "Address",
        page: 1,
        box: ruleBox(P4.x0, P4.x1, 400, 12),
      },
    ],
  },
  {
    id: "P10",
    kind: "positive",
    // Until review round 7 (2026-11-19) page 2 was drawn upright in
    // CONTENT space, so the reader saw it sideways, and this case required
    // it to be searched: its fields' typed text then ran across the printed
    // line. Page 2 is now a landscape page made the common way (counter-
    // turned, upright on screen); the sideways page is O8.
    note: "P1a on page 1; P1a and P7 on a /Rotate 90 page 2 with an inset crop, drawn counter-turned so it shows upright",
    build: async () => {
      const d = await doc();
      const f = H;
      await nameRun(d.addPage(LETTER), f, 72, 700);
      const second = d.addPage(LETTER);
      second.setCropBox(
        P10_CROP.x,
        P10_CROP.y,
        P10_CROP.width,
        P10_CROP.height,
      );
      second.setRotation(degrees(90));
      counterTurn90(second, P10_CROP);
      await nameRun(second, f, 72, P10_LOCAL.nameY);
      await optionSquares(second, f);
      second.pushOperators(popGraphicsState());
      return save(d);
    },
    expect: [
      {
        rule: "underscore-run",
        type: "text",
        label: "Name",
        page: 1,
        box: runBox(H, 72, 700, 12, "Name: ", UNDERSCORES),
      },
      {
        rule: "underscore-run",
        type: "text",
        label: "Name",
        page: 2,
        box: runBox(H, 72, P10_LOCAL.nameY, 12, "Name: ", UNDERSCORES),
      },
      ...optionExpect(2),
    ],
  },
  {
    id: "P11",
    kind: "positive",
    note: "P4 on a page whose CropBox is larger than its MediaBox",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      page.setCropBox(-50, -50, 712, 892);
      await addressRule(page, H);
      return save(d);
    },
    expect: [
      {
        rule: "labelled-rule",
        type: "text",
        label: "Address",
        page: 1,
        box: ruleBox(P4.x0, P4.x1, P4.y, 12),
      },
    ],
  },
  {
    id: "P12",
    kind: "positive",
    note: "P1a on a landscape A5 page",
    build: async () => {
      const d = await doc();
      await nameRun(d.addPage(A5_LANDSCAPE), H, 40, 300);
      return save(d);
    },
    expect: [
      {
        rule: "underscore-run",
        type: "text",
        label: "Name",
        page: 1,
        box: runBox(H, 40, 300, 12, "Name: ", UNDERSCORES),
      },
    ],
  },
  {
    id: "P13",
    kind: "positive",
    note: "P1a at the same place mid-page on two pages: a repeat outside the bands",
    build: async () => {
      const d = await doc();
      const f = H;
      await nameRun(d.addPage(LETTER), f, 72, 400);
      await nameRun(d.addPage(LETTER), f, 72, 400);
      return save(d);
    },
    expect: [1, 2].map((page) => ({
      rule: "underscore-run" as const,
      type: "text" as const,
      label: "Name",
      page,
      box: runBox(H, 72, 400, 12, "Name: ", UNDERSCORES),
    })),
  },
  {
    id: "P14",
    kind: "positive",
    note: "an accented WinAnsi label before a run",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await text(page, H, `${PRENOM}: ${UNDERSCORES}`, 72, 700);
      return save(d);
    },
    expect: [
      {
        rule: "underscore-run",
        type: "text",
        label: PRENOM,
        page: 1,
        box: runBox(H, 72, 700, 12, `${PRENOM}: `, UNDERSCORES),
        name: "prenom",
      },
    ],
  },
  {
    id: "N17",
    kind: "positive",
    note: 'P1a in a PDF that already has "name" and "name.first": found, named name_2',
    existingNames: ["name", "name.first"],
    build: async () => {
      const d = await doc();
      await nameRun(d.addPage(LETTER), H, 72, 700);
      return save(d);
    },
    expect: [
      {
        rule: "underscore-run",
        type: "text",
        label: "Name",
        page: 1,
        box: runBox(H, 72, 700, 12, "Name: ", UNDERSCORES),
        name: "name_2",
      },
    ],
  },

  {
    id: "P15",
    kind: "positive",
    note: "P4's line drawn 4 w under cm [8 0 0 0.125]: 0.5 pt thick as displayed",
    // The stroke is thin ACROSS the line (4 x 0.125), though sqrt(|det|) is 1
    // and would read it as 4 pt thick.
    build: () =>
      addressWith("q 0 G 8 0 0 0.125 0 0 cm 4 w 16.25 4800 m 41.25 4800 l S Q"),
    expect: [
      {
        rule: "labelled-rule",
        type: "text",
        label: "Address",
        page: 1,
        box: ruleBox(P4.x0, P4.x1, P4.y, 12),
      },
    ],
  },

  {
    id: "P17",
    kind: "positive",
    note: "P5's thin filled bar drawn as `m l l l f`, no `h`: the fill closes it",
    build: () =>
      addressWith("130 599.6 m 330 599.6 l 330 600.4 l 130 600.4 l f"),
    expect: [
      {
        rule: "labelled-rule",
        type: "text",
        label: "Address",
        page: 1,
        box: ruleBox(P4.x0, P4.x1, P4.y, 12),
      },
    ],
  },
  {
    id: "P18",
    kind: "positive",
    note: "a 12 pt square drawn as four separate stroked lines, labelled to its right",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await text(page, H, "Yes", 90, 482, 10);
      raw(
        page,
        "72 480 m 84 480 l S 84 480 m 84 492 l S 84 492 m 72 492 l S 72 492 m 72 480 l S",
      );
      return save(d);
    },
    expect: [
      {
        rule: "square-checkbox",
        type: "checkbox",
        label: "Yes",
        page: 1,
        box: squareBox(72, 480, 12),
      },
    ],
  },
  {
    id: "P16",
    kind: "positive",
    note: "P4's line inside a form XObject whose /BBox holds all of it: clipping keeps it",
    // The positive control for N22: a clip that drops everything would pass N22.
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await text(page, H, "Address:", P4.labelX, P4.y);
      formXObject(page, "0.5 w 130 600 m 330 600 l S", [120, 590, 340, 610]);
      return save(d);
    },
    expect: [
      {
        rule: "labelled-rule",
        type: "text",
        label: "Address",
        page: 1,
        box: ruleBox(P4.x0, P4.x1, P4.y, 12),
      },
    ],
  },
  {
    id: "P19",
    kind: "positive",
    note: "four labelled lines at an even pitch, a DD MM YYYY hint under the date line: a form, not a table ruled in rows",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      for (const [i, y] of P19.ys.entries()) {
        const s = P19.labels[i]!;
        await text(page, H, s, 140 - textWidth(H, s, 11), y, 11);
        rule(page, 146, 420, y, 0.5);
      }
      for (const [i, s] of ["DD", "MM", "YYYY"].entries())
        await text(page, H, s, 150 + 60 * i, 531, 6);
      return save(d);
    },
    expect: P19.ys.map((y, i) => ({
      rule: "labelled-rule" as const,
      type: "text" as const,
      label: P19.labels[i]!.slice(0, -1),
      page: 1,
      box: ruleBox(146, 420, y, 11),
    })),
  },
  {
    id: "P20",
    kind: "positive",
    note: "an address block of three captioned lines whose middle row has City, State and ZIP code: a form, not a table",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      for (const y of P20.ys) rule(page, 72, 400, y, 0.5);
      await text(page, H, "Street address", 74, 590, 8);
      await text(page, H, "City", 74, 558, 8);
      await text(page, H, "State", 200, 558, 8);
      await text(page, H, "ZIP code", 300, 558, 8);
      await text(page, H, "Country", 74, 526, 8);
      return save(d);
    },
    expect: ["Street address", "City", "Country"].map((label, i) => ({
      rule: "labelled-rule" as const,
      type: "text" as const,
      label,
      page: 1,
      box: ruleBox(72, 400, P20.ys[i]!, 8),
    })),
  },
  {
    id: "P21",
    kind: "positive",
    note: 'a medical form: "If you are completing this form on behalf of the patient, ..." over three captioned lines',
    build: () =>
      captionedLines(
        "If you are completing this form on behalf of the patient, please give your details:",
        9,
        ["Full name", "Relationship to patient", "Telephone"],
      ),
    expect: captionedExpect([
      "Full name",
      "Relationship to patient",
      "Telephone",
    ]),
  },
  {
    id: "P22",
    kind: "positive",
    note: 'an RSVP card: "You are cordially invited to the Annual Dinner." over two captioned lines',
    build: () =>
      captionedLines("You are cordially invited to the Annual Dinner.", 12, [
        "Guest name",
        "Number attending",
      ]),
    expect: captionedExpect(["Guest name", "Number attending"]),
  },
  {
    id: "P23",
    kind: "positive",
    note: 'a sign-off block: "Yours faithfully,", the signature line, a "Name in capitals" line and a labelled Date line',
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await text(page, H, "Yours faithfully,", 72, 600, 11);
      rule(page, 72, 300, 560, 0.5);
      rule(page, 72, 300, 530, 0.5);
      await text(page, H, "Name in capitals", 74, 520, 8);
      await text(page, H, "Date:", 72, 495, 11);
      rule(page, 110, 300, 495, 0.5);
      return save(d);
    },
    expect: [
      {
        rule: "labelled-rule",
        type: "text",
        label: "Name in capitals",
        page: 1,
        box: ruleBox(72, 300, 530, 8),
      },
      {
        rule: "labelled-rule",
        type: "text",
        label: "Date",
        page: 1,
        box: ruleBox(110, 300, 495, 11),
      },
    ],
    // Only the first line under the close is its signature line.
    decidedBy: "signature",
    at: { page: 1, x: 150, y: 563 },
  },
  {
    id: "P25",
    kind: "positive",
    note: "three captioned lines (Full name / Street / City) with a two-column header above and footer below: a form, not a table",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      for (const [i, s] of ["Full name", "Street", "City"].entries()) {
        rule(page, 130, 450, 600 - 30 * i, 0.5);
        await text(page, H, s, 132, 588 - 30 * i, 10);
      }
      await text(page, H, "Part 2", 135, 700, 10);
      await text(page, H, "Ref 123", 300, 700, 10);
      await text(page, H, "Page 1 of 2", 135, 480, 10);
      await text(page, H, "Form A-12", 300, 480, 10);
      return save(d);
    },
    expect: ["Full name", "Street", "City"].map((label, i) => ({
      rule: "labelled-rule" as const,
      type: "text" as const,
      label,
      page: 1,
      box: ruleBox(130, 450, 600 - 30 * i, 10),
    })),
  },
  {
    id: "P26",
    kind: "positive",
    note: "P4's line drawn inside a transparency-group form whose /Matrix moves its /BBox onto the line: kept",
    // Read without the group's matrix, the bbox sits at [0 0 300 20] and
    // hides the line. N30 is the other half.
    build: () => addressInGroup("0.5 w 10 10 m 210 10 l S"),
    expect: [
      {
        rule: "labelled-rule",
        type: "text",
        label: "Address",
        page: 1,
        box: ruleBox(P4.x0, P4.x1, P4.y, 12),
      },
    ],
  },
  {
    id: "P24",
    kind: "positive",
    note: "P4's line under a `W n` clip set under a translating `cm` that moves the clip onto the line: kept",
    // pdf.js hands the clip path's bbox BEFORE the CTM; read without the
    // CTM, this clip sits at [0 0 300 20] and hides the line. N28 is the
    // other half.
    build: () =>
      addressWith(
        "q 1 0 0 1 120 590 cm 0 0 300 20 re W n 1 0 0 1 -120 -590 cm 0.5 w 130 600 m 330 600 l S Q",
      ),
    expect: [
      {
        rule: "labelled-rule",
        type: "text",
        label: "Address",
        page: 1,
        box: ruleBox(P4.x0, P4.x1, P4.y, 12),
      },
    ],
  },
  {
    id: "P27",
    kind: "positive",
    note: "a label column: Name / Email / Date of birth / City / Telephone flush left at 72, every line from one tab stop at 140; Email and City end over 36 pt from their lines",
    // Review round 2, finding 6 (decided by the owner in round 3). Helvetica
    // 11: Name ends 35.6 pt from its line, Email 37.4, Date of birth 5.0,
    // City 46.0, Telephone 13.0, so the 36 pt gap alone loses two of five.
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      for (const [i, s] of P27_LABELS.entries()) {
        await text(page, H, s, 72, 600 - 30 * i, 11);
        rule(page, 140, 300, 600 - 30 * i, 0.5);
      }
      return save(d);
    },
    expect: P27_LABELS.map((s, i) => ({
      rule: "labelled-rule" as const,
      type: "text" as const,
      label: s.slice(0, -1),
      page: 1,
      box: ruleBox(140, 300, 600 - 30 * i, 11),
    })),
  },
  {
    id: "P28",
    kind: "positive",
    note: 'answers inline: "Yes [box]  No [box]" (each label LEFT of its box), and "[box] Yes  [box] No" (each label right)',
    // Review round 3, finding 1: the right side was searched first, so the
    // next answer word beat the box's own label and both boxes of the first
    // row read "No". The second row is the label-right control.
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await text(
        page,
        H,
        "Photographs may be used on our website:",
        72,
        600,
        10,
      );
      for (const [s, x] of P28.left) await text(page, H, s, x, 600, 10);
      for (const x of P28.leftBoxes) square(page, x, 598, 10);
      await text(page, H, "May we contact you by email?", 72, 570, 10);
      for (const x of P28.rightBoxes) square(page, x, 568, 10);
      for (const [s, x] of P28.right) await text(page, H, s, x, 570, 10);
      return save(d);
    },
    expect: [
      ...P28.leftBoxes.map((x, i) => [P28.left[i]![0], x, 598] as const),
      ...P28.rightBoxes.map((x, i) => [P28.right[i]![0], x, 568] as const),
    ].map(([label, x, y]) => ({
      rule: "square-checkbox" as const,
      type: "checkbox" as const,
      label,
      page: 1,
      box: squareBox(x, y, 10),
    })),
  },
  {
    id: "P29",
    kind: "positive",
    note: "W-9-style strips: five rules at an even pitch, each strip captioned at its top-left under the rule above; the fields sit in the strips",
    // Review round 3, finding 5: each caption labelled the rule ABOVE it, so
    // every field sat one strip too high and the first above the form. P20
    // (its lowest line captioned too) is the control: nothing moves there.
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      for (const y of P29.ys) rule(page, 72, 540, y, 0.5);
      for (const [i, s] of P29.captions.entries())
        await text(page, H, s, 74, P29.ys[i]! - 7, 7);
      return save(d);
    },
    expect: P29.captions.map((label, i) => ({
      rule: "labelled-rule" as const,
      type: "text" as const,
      label,
      page: 1,
      box: ruleBox(72, 540, P29.ys[i + 1]!, 7),
    })),
    // The top rule takes no caption: nothing is proposed above the form.
    decidedBy: "unlabelled",
    at: { page: 1, x: 300, y: P29.ys[0]! + 5 },
  },
  {
    id: "P30",
    kind: "positive",
    note: 'a medical history grid: four conditions down the left, a Yes and a No box in each row under the heads "Yes" and "No"',
    // Review round 3, finding 7: every box was unlabelled (each row's text
    // far to the left, each head above), so the grid proposed nothing.
    build: async () => {
      const d = await doc();
      await headedGrid(d.addPage(LETTER), P30, (s) => s);
      return save(d);
    },
    expect: headedExpect(P30),
  },
  {
    id: "P31",
    kind: "positive",
    note: 'a rating grid: three statements with dot leaders up to five boxes under the heads "1" to "5"',
    // Review round 3, finding 7: the leader gave the first box a left label
    // (the statement alone) and the other four none.
    build: async () => {
      const d = await doc();
      await headedGrid(d.addPage(LETTER), P31, (s) => leadered(s, P31.xs[0]!));
      return save(d);
    },
    expect: headedExpect(P31),
  },
  {
    id: "P32",
    kind: "positive",
    note: 'an address block: "Address:" and its line, then two lines from the margin under it; and a Date line whose label ends 36.5 pt off, under Print name',
    // Review round 3, finding 8: the two lines under Address were
    // unlabelled. The Date line is the guard: text on its own row keeps it
    // from inheriting "Print name".
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      for (const [s, y] of P32.rows) {
        if (s) await text(page, H, s, 72, y, 10);
        rule(page, p32Start(s), 400, y, 0.5);
      }
      const date = P32.printName - 36.5 - textWidth(H, "Date:", 10);
      await text(page, H, "Date:", date, P32.dateY, 10);
      rule(page, P32.printName, 400, P32.dateY, 0.5);
      return save(d);
    },
    expect: P32.rows.map(([s, y], i) => ({
      rule: "labelled-rule" as const,
      type: "text" as const,
      label: (s ?? "Address:").slice(0, -1),
      page: 1,
      box: ruleBox(p32Start(s), 400, y, 10),
      // The block's three Address lines, named apart.
      ...(i >= 1 && i <= 3
        ? { name: ["address", "address_2", "address_3"][i - 1] }
        : {}),
    })),
    decidedBy: "unlabelled",
    at: { page: 1, x: 300, y: P32.dateY + 5 },
  },

  // ---------------------------------------------------------- negatives
  {
    id: "N1",
    kind: "negative",
    note: "an underlined heading: a line 1.5 pt under the text's baseline",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      const s = "Terms and conditions";
      await text(page, H, s, 72, 650);
      rule(page, 72, 72 + textWidth(H, s, 12), 648.5);
      return save(d);
    },
    expect: "none",
    decidedBy: "underline",
    at: { page: 1, x: 100, y: 655 },
    seamAlsoDisable: ["unlabelled", "overlaps-text"],
  },
  {
    id: "N2",
    kind: "negative",
    note: "a full-width section divider with no label, mid page",
    build: async () => {
      const d = await doc();
      rule(d.addPage(LETTER), 36, 576, 400);
      return save(d);
    },
    expect: "none",
    decidedBy: "full-width-divider",
    at: { page: 1, x: 300, y: 405 },
    seamAlsoDisable: ["unlabelled"],
  },
  {
    id: "N3",
    kind: "negative",
    note: "a letterhead line in the top band, repeated on three pages",
    build: async () => {
      const d = await doc();
      const f = H;
      for (let i = 0; i < 3; i++) {
        const page = d.addPage(LETTER);
        await text(page, f, "Company Ltd", 120, 760);
        rule(page, 200, 500, 760);
      }
      return save(d);
    },
    expect: "none",
    decidedBy: "page-band",
    at: { page: 2, x: 300, y: 765 },
  },
  {
    id: "N4",
    kind: "negative",
    note: "a ruled 3 x 3 table, cells empty, rows labelled",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      const f = H;
      const xs = [200, 280, 360, 440];
      const ys = [500, 520, 540, 560];
      for (const y of ys) rule(page, 200, 440, y);
      for (const x of xs) vline(page, x, 500, 560);
      for (const [i, y] of ys.entries())
        await text(page, f, `Row ${i + 1}`, 165, y + 2, 10);
      return save(d);
    },
    expect: "none",
    decidedBy: "table-grid",
    at: { page: 1, x: 300, y: 525 },
  },
  {
    id: "N5",
    kind: "negative",
    note: "eight equal squares edge to edge: a comb for single characters",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await text(page, H, "Account", 150, 403, 10);
      for (let k = 0; k < 8; k++) square(page, 200 + 14 * k, 400, 14);
      return save(d);
    },
    expect: "none",
    decidedBy: "comb",
    at: { page: 1, x: 207, y: 407 },
    seamAlsoDisable: ["unlabelled"],
  },
  {
    id: "N6",
    kind: "negative",
    note: "solid black 8 pt squares used as bullets",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      const f = H;
      for (const [i, y] of [600, 580, 560].entries()) {
        square(page, 72, y, 8, true);
        await text(page, f, `Point ${i + 1}`, 88, y + 1, 10);
      }
      return save(d);
    },
    expect: "none",
    decidedBy: "bullet",
    at: { page: 1, x: 76, y: 604 },
  },
  {
    id: "N7",
    kind: "negative",
    note: '"Signature: __________": left to the signature tool',
    build: async () => {
      const d = await doc();
      await text(d.addPage(LETTER), H, `Signature: ${UNDERSCORES}`, 72, 300);
      return save(d);
    },
    expect: "none",
    decidedBy: "signature",
    at: { page: 1, x: 72 + textWidth(H, "Signature: ", 12) + 20, y: 304 },
  },
  {
    id: "N8",
    kind: "negative",
    note: "P4 with a form field already over the line",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await addressRule(page, H);
      d.getForm()
        .createTextField("address")
        .addToPage(page, {
          x: P4.x0,
          y: P4.y,
          width: P4.x1 - P4.x0,
          height: 18,
        });
      return save(d);
    },
    expect: "none",
    decidedBy: "existing-field",
    at: { page: 1, x: 200, y: 606 },
  },
  {
    id: "N9",
    kind: "negative",
    note: "P4 with a card already in the builder at the same place",
    drafts: [{ page: 1, x: 140, y: 601, width: 150, height: 17 }],
    build: async () => {
      const d = await doc();
      await addressRule(d.addPage(LETTER), H);
      return save(d);
    },
    expect: "none",
    decidedBy: "existing-draft",
    at: { page: 1, x: 200, y: 606 },
  },
  {
    id: "N10",
    kind: "negative",
    note: "a frame drawn tight round a paragraph; its last line rests on the bottom edge",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      const f = H;
      page.drawRectangle({
        x: N10.x,
        y: N10.y,
        width: N10.w,
        height: N10.h,
        borderColor: rgb(0, 0, 0),
        borderWidth: 1,
      });
      await text(page, f, "Notes:", 66, N10.y, 10);
      await text(
        page,
        f,
        "The first line of the note runs across the frame here.",
        104,
        N10.y + 38,
        10,
      );
      await text(
        page,
        f,
        "A second line of the note follows under the first one.",
        104,
        N10.y + 26,
        10,
      );
      await text(
        page,
        f,
        "A third line of the note follows the second one too.",
        104,
        N10.y + 14,
        10,
      );
      await text(page, f, "End of note.", 104, N10.y + 2, 10);
      return save(d);
    },
    expect: "none",
    decidedBy: "overlaps-text",
    at: { page: 1, x: 300, y: N10.y + 5 },
  },
  {
    id: "N11",
    kind: "negative",
    note: "a labelled line 6 pt under a line of text: no room to type",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      const f = H;
      await text(
        page,
        f,
        "Please print clearly in the space below.",
        150,
        506,
        10,
      );
      await text(page, f, "Phone:", 110, 500, 10);
      rule(page, 150, 350, 500);
      return save(d);
    },
    expect: "none",
    decidedBy: "no-clearance",
    at: { page: 1, x: 250, y: 503 },
  },
  {
    id: "N12",
    kind: "negative",
    note: "file_name, a__b and ___: fewer than four underscores, no candidate at all",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      const f = H;
      await text(page, f, "Save it as file_name or a__b", 72, 700);
      await text(page, f, "Blank: ___", 72, 680);
      return save(d);
    },
    expect: "none",
  },
  {
    id: "N13",
    kind: "negative",
    note: '"Name:" printed turned 90 degrees beside a line',
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await text(page, H, "Name:", 140, 450, 12, 90);
      rule(page, 150, 350, 450);
      return save(d);
    },
    expect: "none",
    decidedBy: "rotated-label",
    at: { page: 1, x: 250, y: 455 },
  },
  {
    id: "N14",
    kind: "negative",
    note: "a chart axis: a line with no label",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      rule(page, 150, 400, 300);
      vline(page, 150, 300, 450);
      return save(d);
    },
    expect: "none",
    decidedBy: "unlabelled",
    at: { page: 1, x: 250, y: 305 },
  },
  {
    id: "N15",
    kind: "negative",
    note: "a white line on the white page",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await text(page, H, "Address:", P4.labelX, P4.y);
      rule(page, P4.x0, P4.x1, P4.y, 1, rgb(1, 1, 1));
      return save(d);
    },
    expect: "none",
  },
  {
    id: "N16",
    kind: "negative",
    note: "a 20 pt run of underscores: too short to type in",
    build: async () => {
      const d = await doc();
      await text(d.addPage(LETTER), H, "Ref: ____", 72, 700, 9);
      return save(d);
    },
    expect: "none",
    decidedBy: "short-run",
    at: { page: 1, x: 72 + textWidth(H, "Ref: __", 9), y: 702 },
  },
  {
    id: "N18",
    kind: "negative",
    note: "an underscore run with a line drawn under it: one field, not two",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      const f = H;
      const x = 72 + textWidth(H, "Name: ", 12);
      // The label in another font, so pdf.js keeps it a text item of its
      // own (it joins neighbouring chunks drawn in one font into one item).
      await text(page, T, "Name:", 72, 400);
      await text(page, f, UNDERSCORES, x, 400);
      rule(page, x, x + textWidth(H, UNDERSCORES, 12), 399);
      return save(d);
    },
    expect: [
      {
        rule: "labelled-rule",
        type: "text",
        label: "Name",
        page: 1,
        box: ruleBox(
          72 + textWidth(H, "Name: ", 12),
          72 + textWidth(H, `Name: ${UNDERSCORES}`, 12),
          399,
          12,
        ),
      },
    ],
    decidedBy: "duplicate",
    at: { page: 1, x: 150, y: 402 },
  },
  {
    id: "N19",
    kind: "negative",
    note: "a labelled line that runs past the edge of the visible page",
    build: offPageBytes,
    expect: "none",
    decidedBy: "off-page",
    seamAlsoDisable: ["invalid"],
    at: { page: 1, x: 350, y: 605 },
  },
  {
    id: "N20",
    kind: "negative",
    note: "N19 with the off-page rule disabled: the builder's own validation refuses it",
    build: offPageBytes,
    disable: ["off-page"],
    expect: "none",
    decidedBy: "invalid",
    at: { page: 1, x: 350, y: 605 },
  },
  {
    id: "N21",
    kind: "negative",
    note: "an 8 pt black bar beside a label, drawn 1 w under cm [0.125 0 0 8]: a bar, not a rule",
    // sqrt(|det|) is 1 here, so a width read that way calls the bar 1 pt.
    build: () =>
      addressWith("q 0 G 0.125 0 0 8 0 0 cm 1 w 1040 75 m 2640 75 l S Q"),
    expect: "none",
  },
  {
    id: "N24",
    kind: "negative",
    note: "an invoice table ruled with rows only (no vertical lines), a header row under its top rule",
    build: async () => {
      const d = await doc();
      const page = d.addPage(A4);
      for (let k = 0; k < 7; k++) rule(page, 56, 539, 700 - 20 * k, 0.5);
      const cols = [60, 330, 400, 480];
      for (const [i, s] of ["Description", "Qty", "Unit", "Amount"].entries())
        await text(page, H, s, cols[i]!, 686, 10);
      for (let r = 1; r < 6; r++)
        for (const [i, s] of [`Item ${r}`, "1", "10.00", "10.00"].entries())
          await text(page, H, s, cols[i]!, 686 - 20 * r, 10);
      return save(d);
    },
    expect: "none",
    decidedBy: "table-grid",
    at: { page: 1, x: 300, y: 705 },
  },
  {
    id: "N25",
    kind: "negative",
    note: 'a business letter\'s sign-off: "Yours sincerely,", a line, the printed name and role under it',
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await text(page, H, "Acme Widgets Ltd", 72, 740, 16);
      await text(
        page,
        H,
        "Thank you for your order. We will ship it next week.",
        72,
        600,
        11,
      );
      await text(page, H, "Yours sincerely,", 72, 520, 11);
      rule(page, 72, 252, 470, 0.5);
      await text(page, H, "John Smith", 72, 456, 11);
      await text(page, H, "Director", 72, 442, 11);
      return save(d);
    },
    expect: "none",
    decidedBy: "signature",
    at: { page: 1, x: 150, y: 475 },
  },
  {
    id: "N26",
    kind: "negative",
    note: 'N25\'s sign-off with the signature line typed as underscores: "Yours sincerely,", a run, the printed name',
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await text(page, H, "Yours sincerely,", 72, 520, 11);
      await text(page, H, "______________________________", 72, 470, 11);
      await text(page, H, "John Smith", 72, 456, 11);
      return save(d);
    },
    expect: "none",
    decidedBy: "signature",
    at: { page: 1, x: 150, y: 475 },
  },
  {
    id: "N22",
    kind: "negative",
    note: "P4's line inside a form XObject whose /BBox [0 0 10 10] clips all of it away",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await text(page, H, "Address:", P4.labelX, P4.y);
      formXObject(page, "0.5 w 130 600 m 330 600 l S", [0, 0, 10, 10]);
      return save(d);
    },
    expect: "none",
  },
  {
    id: "N23",
    kind: "negative",
    note: "P4's line drawn under a `W n` clip to [0 0 10 10]: clipped away",
    build: () =>
      addressWith("q 0 0 10 10 re W n 0.5 w 130 600 m 330 600 l S Q"),
    expect: "none",
  },
  {
    id: "N28",
    kind: "negative",
    note: "P4's line under a `W n` clip set under a translating `cm` that moves the clip off the line: clipped away",
    build: () =>
      addressWith(
        "q 1 0 0 1 120 0 cm 0 0 300 20 re W n 1 0 0 1 -120 0 cm 0.5 w 130 600 m 330 600 l S Q",
      ),
    expect: "none",
  },
  {
    id: "N31",
    kind: "negative",
    note: "an item table ruled in rows only, a header and one item row, above a wider gap to a totals rule",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      for (const y of [630, 610, 590, 560]) rule(page, 130, 450, y, 0.5);
      await text(page, H, "Item", 135, 616, 10);
      await text(page, H, "Price", 300, 616, 10);
      await text(page, H, "Widget", 135, 596, 10);
      await text(page, H, "10.00", 300, 596, 10);
      return save(d);
    },
    expect: "none",
    // The even run is the three rules above the gap; the top one, read as
    // a field, would be captioned "Item".
    decidedBy: "table-grid",
    at: { page: 1, x: 300, y: 633 },
  },
  {
    id: "N30",
    kind: "negative",
    note: "the same transparency-group form drawing its line 20 pt above its moved /BBox: clipped away",
    build: () => addressInGroup("0.5 w 10 30 m 210 30 l S"),
    expect: "none",
  },
  {
    id: "N29",
    kind: "negative",
    note: "P4's line under a `W n` clip to [0 0 10 10] with a page-sized `W n` clip nested inside it: still clipped away",
    build: () =>
      addressWith(
        "q 0 0 10 10 re W n q 0 0 612 792 re W n 0.5 w 130 600 m 330 600 l S Q Q",
      ),
    expect: "none",
  },
  {
    id: "N27",
    kind: "negative",
    note: "a box beside a label stroked 3 w under cm [1 0 0 0 0 600] (det 0): pdf.js paints nothing",
    build: () =>
      addressWith("q 1 0 0 0 0 600 cm 0 G 3 w 130 300 200 50 re S Q"),
    expect: "none",
  },
  {
    id: "N32",
    kind: "negative",
    note: "a lone line whose nearest text ends 40 pt to its left: no label (the 36 pt gap holds for a line in no label column)",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await text(page, H, "Address:", 72, 600);
      rule(page, N32_X0, N32_X0 + 200, 600);
      return save(d);
    },
    expect: "none",
    decidedBy: "unlabelled",
    at: { page: 1, x: N32_X0 + 50, y: 605 },
  },
  {
    id: "N33",
    kind: "negative",
    note: 'digit boxes: "Date of birth" and DD / MM / YYYY boxes with "/" between the groups, a two-box "Age", a three-box "House no."',
    // Review round 3, finding 2: a comb needed four adjoining squares, so
    // every group here but the year was proposed as checkboxes, the date's
    // labelled "/".
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await text(page, H, "Date of birth", 72, 620, 10);
      for (const dx of [0, 16, 44, 60, 88, 104, 120, 136])
        square(page, N33.date + dx, 616, 16);
      for (const dx of [35, 79])
        await text(page, H, "/", N33.date + dx, 620, 10);
      await text(page, H, "Age", 72, 580, 10);
      for (const dx of [0, 16]) square(page, N33.age + dx, 576, 16);
      await text(page, H, "House no.", 72, 540, 10);
      for (const dx of [0, 16, 32]) square(page, N33.house + dx, 536, 16);
      return save(d);
    },
    expect: "none",
    decidedBy: "comb",
    at: { page: 1, x: N33.date + 8, y: 624 },
  },
  {
    id: "N34",
    kind: "negative",
    note: '"Number of dependants" and one 16 pt box with a hint digit "0" printed inside it',
    // Review round 3, finding 3: the text inside lowered the checkbox's top
    // as it would a text field's, and a 14 x 2 checkbox was proposed.
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await text(page, H, "Number of dependants", 72, 620, 10);
      square(page, N34_X, 616, 16);
      await text(page, H, "0", N34_X + 5, 620, 10);
      return save(d);
    },
    expect: "none",
    decidedBy: "overlaps-text",
    at: { page: 1, x: N34_X + 8, y: 624 },
  },
  {
    id: "N35",
    // INVERTED in review round 4 fixes (finding 22): kind "negative",
    // expect "none", decided by unlabelled at (300, top + 5), with the note
    // "no field above any box". Review round 3, finding 4: each caption was
    // read as the caption under its box's TOP edge, so every field was
    // placed above its box, outside it, the first above the form; fields
    // inside such boxes were deferred. A box's bottom edge now takes the
    // caption inside its top-left, so each field sits inside its box. The
    // id is kept (as N17's and N38's are), and the top edges still take
    // nothing: unlabelled at (300, top + 5) decides them.
    kind: "positive",
    note: "four separate outlined boxes, each with its caption printed inside its top-left: a field inside each box, none above",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      for (const [i, top] of N35.tops.entries()) {
        page.drawRectangle({
          x: 72,
          y: top - 28,
          width: 468,
          height: 28,
          borderColor: rgb(0, 0, 0),
          borderWidth: 0.5,
        });
        await text(page, H, N35.captions[i]!, 74, top - 7, 7);
      }
      return save(d);
    },
    expect: N35.tops.map((top, i) => ({
      rule: "labelled-rule" as const,
      type: "text" as const,
      label: N35.captions[i]!,
      page: 1,
      box: ruleBox(72, 540, top - 28, 7),
    })),
    decidedBy: "unlabelled",
    at: { page: 1, x: 300, y: N35.tops[0]! + 5 },
  },
  {
    id: "N36",
    kind: "negative",
    note: 'a report page: a column rule over the heading "2. Results" (12 pt) and the body text (10 pt) under it',
    // Review round 3, finding 6: the heading was read as the rule's caption.
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      rule(page, 72, 538, 606, 0.5);
      await text(page, H, "2. Results", 72, 592, 12);
      await text(
        page,
        H,
        "The results section starts under its heading here.",
        72,
        578,
        10,
      );
      await text(
        page,
        H,
        "More body text follows on the next line of it.",
        72,
        566,
        10,
      );
      return save(d);
    },
    expect: "none",
    decidedBy: "unlabelled",
    at: { page: 1, x: 300, y: 610 },
  },
  {
    id: "N37",
    kind: "negative",
    note: "a one-page document's footer: a 400 pt rule in the bottom band with the footer text centred under it",
    // Review round 3, finding 6: not wide enough for the band rule, and on
    // one page it repeats nowhere, so the footer text labelled a field.
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      rule(page, 106, 506, 56, 0.5);
      const s = "Example Ltd - Annual report - Page 1 of 1";
      await text(page, H, s, 306 - textWidth(H, s, 8) / 2, 46, 8);
      return save(d);
    },
    expect: "none",
    decidedBy: "page-band",
    at: { page: 1, x: 300, y: 60 },
  },
  {
    id: "N38",
    // INVERTED in review round 4: the owner ruled that the right cells of
    // such a table are fields. Round 3 (finding 9) left it a documented
    // MISS: kind "negative", expect "none", decided by table-grid at
    // (300, 605), its seam also disabling unlabelled. The id is kept (as
    // N17's is), so the history reads in one place.
    kind: "positive",
    note: 'a Word-style two-column table: "Name", "Address", "Telephone", "Email" in the left cells, the right cells empty',
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      for (const y of N38_YS) rule(page, 72, 400, y, 0.5);
      for (const x of [72, 180, 400]) vline(page, x, 504, 600);
      for (const [i, s] of N38_LABELS.entries())
        await text(page, H, s, 76, N38_YS[i]! - 16, 10);
      return save(d);
    },
    expect: N38_LABELS.map((label, i) => ({
      rule: "table-cell" as const,
      type: "text" as const,
      label,
      page: 1,
      box: cellBox(180, 400, N38_YS[i + 1]!, N38_YS[i]!),
    })),
  },
  {
    id: "N39",
    kind: "negative",
    note: 'N38 with a header row ("Question" | "Answer"): text in a right cell, so the grid stays a table',
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      const ys = [624, ...N38_YS];
      for (const y of ys) rule(page, 72, 400, y, 0.5);
      for (const x of [72, 180, 400]) vline(page, x, 504, 624);
      await text(page, H, "Question", 76, 608, 10);
      await text(page, H, "Answer", 184, 608, 10);
      for (const [i, s] of N38_LABELS.entries())
        await text(page, H, s, 76, N38_YS[i]! - 16, 10);
      return save(d);
    },
    expect: "none",
    decidedBy: "table-grid",
    at: { page: 1, x: 300, y: 581 },
    // Read without the grid as strips, each rule takes the caption of the
    // row above it, and that row's own label leaves it no room to type:
    // no-clearance would decide it next.
    seamAlsoDisable: ["no-clearance"],
  },
  {
    id: "P33",
    kind: "positive",
    note: "a Word-style two-column table with an underscore run typed alone in each right cell: each run labelled from its left cell",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      const ys = N38_YS.slice(0, 3);
      for (const y of ys) rule(page, 72, 400, y, 0.5);
      for (const x of [72, 180, 400]) vline(page, x, 552, 600);
      for (const [i, s] of ["Name", "Email"].entries()) {
        await text(page, H, s, 76, ys[i]! - 16, 10);
        await text(page, H, UNDERSCORES, 190, ys[i]! - 16, 10);
      }
      return save(d);
    },
    expect: ["Name", "Email"].map((label, i) => ({
      rule: "underscore-run" as const,
      type: "text" as const,
      label,
      page: 1,
      box: runBox("sans", 190, N38_YS[i]! - 16, 10, "", UNDERSCORES),
    })),
  },
  {
    id: "N40",
    kind: "negative",
    note: "a footnote separator: a short rule at the left margin over an 8 pt note opening with its marker, under 11 pt body text",
    // Review round 3, finding 6 (a KNOWN MISS until round 4).
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await proseBody(page, 11);
      rule(page, 72, 180, 140, 0.5);
      await text(
        page,
        H,
        "1 Figures are unaudited and may change.",
        72,
        130,
        8,
      );
      return save(d);
    },
    expect: "none",
    decidedBy: "unlabelled",
    at: { page: 1, x: 100, y: 146 },
  },
  {
    id: "P34",
    kind: "positive",
    note: "N40's control: the same short margin line over 8 pt text with no footnote marker is a field",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await proseBody(page, 11);
      rule(page, 72, 180, 140, 0.5);
      await text(page, H, "Date of signing", 72, 130, 8);
      return save(d);
    },
    expect: [
      {
        rule: "labelled-rule",
        type: "text",
        label: "Date of signing",
        page: 1,
        box: ruleBox(72, 180, 140, 8),
      },
    ],
  },
  {
    id: "N41",
    kind: "negative",
    note: "a short rule centred under an 18 pt title, over its 10 pt byline",
    // Review round 3, finding 6 (a KNOWN MISS until round 4).
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      const title = "A Report on Things";
      const byline = "by A. Writer";
      await text(
        page,
        H,
        title,
        306 - textWidth("sans", title, 18) / 2,
        712,
        18,
      );
      rule(page, 270, 342, 690, 0.5);
      await text(
        page,
        H,
        byline,
        306 - textWidth("sans", byline, 10) / 2,
        678,
        10,
      );
      return save(d);
    },
    expect: "none",
    decidedBy: "unlabelled",
    at: { page: 1, x: 306, y: 696 },
  },
  {
    id: "N42",
    kind: "negative",
    note: "a pull quote: one 11 pt sentence between two equal rules, the 10 pt article running on wider under them",
    // Review round 3, finding 6 (a KNOWN MISS until round 4).
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await text(
        page,
        H,
        "An article set in ten point type runs on above the quote.",
        72,
        570,
        10,
      );
      rule(page, 150, 462, 540, 0.5);
      rule(page, 150, 462, 500, 0.5);
      await text(page, H, "Quality is never an accident.", 150, 525, 11);
      await text(
        page,
        H,
        "The article goes on under the quote, as wide as before.",
        72,
        485,
        10,
      );
      return save(d);
    },
    expect: "none",
    decidedBy: "unlabelled",
    at: { page: 1, x: 300, y: 546 },
  },
  {
    id: "P35",
    kind: "positive",
    note: 'rows of boxes whose options sit closer to the next box than to their own: "Do you smoke? [box] Yes [box] No", a two-column label-right list, "Male [box] Female [box]"',
    // Review round 4 fixes, finding 1: the nearer side was decided per
    // square, so each of these rows gave one box its neighbour's label
    // (Yes, Yes; High blood pressure twice; Female, Female). P28 is the
    // control: both its rows read the same way still.
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await text(page, H, "Do you smoke?", 72, 600, 10);
      for (const [s, x] of P35.smoke) {
        square(page, x, 598, 10);
        await text(page, H, s, x + 15, 600, 10);
      }
      await text(
        page,
        H,
        "Medical history (tick any that apply):",
        72,
        580,
        10,
      );
      for (const [k, [a, b]] of P35.history.entries()) {
        const y = 558 - 18 * k;
        square(page, 72, y, 10);
        await text(page, H, a, 88, y + 2, 10);
        square(page, P35.col2, y, 10);
        await text(page, H, b, P35.col2 + 16, y + 2, 10);
      }
      await text(page, H, "Male", 72, 500, 10);
      square(page, P35.male, 498, 10);
      await text(page, H, "Female", P35.male + 11, 500, 10);
      square(page, P35.female, 498, 10);
      return save(d);
    },
    expect: [
      ...P35.smoke.map(([label, x]) => [label, x, 598] as const),
      ...P35.history.flatMap(([a, b], k) => [
        [a, 72, 558 - 18 * k] as const,
        [b, P35.col2, 558 - 18 * k] as const,
      ]),
      ["Male", P35.male, 498] as const,
      ["Female", P35.female, 498] as const,
    ].map(([label, x, y]) => ({
      rule: "square-checkbox" as const,
      type: "checkbox" as const,
      label,
      page: 1,
      box: squareBox(x, y, 10),
    })),
  },
  {
    id: "P36",
    kind: "positive",
    note: 'two option lists side by side, "Symptoms" over "[box] Fever / Cough / Headache" and "Medication" over "[box] Insulin / Inhaler / Aspirin": each box takes its own option',
    // Review round 4 fixes, finding 2: the two lists passed for a headed
    // checkbox grid, and every box was labelled "Symptoms" or "Medication".
    // P30 and P31 are the controls: real grids keep their grid labels.
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      for (const [k, list] of P36.entries()) {
        const x = 72 + 228 * k;
        await text(page, H, list.head, x, 612, 10);
        for (const [i, s] of list.options.entries()) {
          square(page, x, 594 - 18 * i, 10);
          await text(page, H, s, x + 16, 596 - 18 * i, 10);
        }
      }
      return save(d);
    },
    expect: [0, 1, 2].flatMap((i) =>
      P36.map((list, k) => ({
        rule: "square-checkbox" as const,
        type: "checkbox" as const,
        label: list.options[i]!,
        page: 1,
        box: squareBox(72 + 228 * k, 594 - 18 * i, 10),
      })),
    ),
  },
  {
    id: "P37",
    kind: "positive",
    note: 'captions under lines, two with a 7 pt hint under the caption ("(as shown on your passport)", "(DD/MM/YYYY)"): every line keeps its caption',
    // Review round 4 fixes, finding 3: a caption with one smaller line
    // under it was read as a heading, so both hinted lines were dropped as
    // unlabelled. A heading needs a body of two lines (N36 is the control).
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await text(page, H, "Applicant details", 72, 700, 14);
      for (const f of P37) {
        rule(page, f.x0, f.x1, f.y, 0.5);
        await text(page, H, f.label, f.x0, f.y - 10, 10);
        if (f.hint) await text(page, H, f.hint, f.x0, f.y - 20, 7);
      }
      return save(d);
    },
    expect: P37.map((f) => ({
      rule: "labelled-rule" as const,
      type: "text" as const,
      label: f.label,
      page: 1,
      box: ruleBox(f.x0, f.x1, f.y, 10),
    })),
  },
  {
    id: "P38",
    kind: "positive",
    note: 'a declaration\'s last row in the bottom band: "Print name" and "Date" lines side by side at y 58, each captioned under it',
    // Review round 4 fixes, finding 4: in the outer 8% of the page a line
    // labelled only by a caption was dropped as a footer rule, so a dense
    // form lost its last row. A line with a labelled row-mate beside it is
    // a form's row. N37 (one footer rule, alone) is the control.
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await text(page, H, "Declaration", 72, 140, 12);
      await text(
        page,
        H,
        "I confirm that the information I have given is correct.",
        72,
        120,
        10,
      );
      for (const [s, x0, x1] of P38) {
        rule(page, x0, x1, 58, 0.5);
        await text(page, H, s, x0, 48, 9);
      }
      return save(d);
    },
    expect: P38.map(([label, x0, x1]) => ({
      rule: "labelled-rule" as const,
      type: "text" as const,
      label,
      page: 1,
      box: ruleBox(x0, x1, 58, 9),
    })),
  },
  {
    id: "P39",
    kind: "positive",
    note: '"Name:" and "Phone:" lines, a heavier section separator from the margin to where they end, then "Employer:": no field on the separator',
    // Review round 4 fixes, finding 6: the separator took "Phone" as a
    // continuation line. A continuation is drawn at its line's weight.
    // P32 is the control: its continuation lines still take "Address".
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      for (const [s, x0, y] of P39) {
        await text(page, H, `${s}:`, 72, y, 10);
        rule(page, x0, 540, y, 0.5);
      }
      rule(page, 72, 540, 614, 0.75);
      return save(d);
    },
    expect: P39.map(([label, x0, y]) => ({
      rule: "labelled-rule" as const,
      type: "text" as const,
      label,
      page: 1,
      box: ruleBox(x0, 540, y, 10),
    })),
    decidedBy: "unlabelled",
    at: { page: 1, x: 300, y: 620 },
  },
  {
    id: "P40",
    kind: "positive",
    note: 'a Yes / No grid whose two 12 pt boxes in a row are 1 pt apart, "Y" and "N" centred over the columns: checkboxes, not digit boxes',
    // Review round 4 fixes, finding 7: the adjoining boxes were read as a
    // comb. N33 is the control: unheaded digit boxes stay combs.
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      for (const [k, h] of P40.heads.entries())
        await text(page, H, h, P40.xs[k]! + 6 - textWidth(H, h, 9) / 2, 640, 9);
      for (const [i, s] of P40.rows.entries()) {
        await text(page, H, s, 72, 624 - 18 * i, 10);
        for (const x of P40.xs) square(page, x, 622 - 18 * i, 12);
      }
      return save(d);
    },
    expect: P40.rows.flatMap((s, i) =>
      P40.heads.map((h, k) => ({
        rule: "square-checkbox" as const,
        type: "checkbox" as const,
        label: `${s} ${h}`,
        page: 1,
        box: squareBox(P40.xs[k]!, 622 - 18 * i, 12),
      })),
    ),
  },
  {
    id: "N43",
    kind: "negative",
    note: 'a consent form: three statements, each with "Initial here:" and a box (two wide, one square) at its right: initials, not fields',
    // Review round 4 fixes, finding 25: "Initials" was a signature but
    // "Initial here" and "Initial" were proposed, the square box as a
    // checkbox named "Initial here".
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      for (const [i, s] of N43.statements.entries()) {
        const y = N43.ys[i]!;
        await text(page, H, s, 72, y, 10);
        await text(page, H, "Initial here:", 400, y, 10);
        const wide = i < 2;
        page.drawRectangle({
          x: N43.boxX,
          y: y - (wide ? 4 : 3),
          width: wide ? 40 : 16,
          height: wide ? 18 : 16,
          borderColor: rgb(0, 0, 0),
          borderWidth: 0.75,
        });
      }
      return save(d);
    },
    expect: "none",
    decidedBy: "signature",
    at: { page: 1, x: N43.boxX + 20, y: N43.ys[0]! - 2 },
  },
  {
    id: "P41",
    kind: "positive",
    note: "a ruled fee table (Category | Early bird | Standard | Select) with a box in each row's Select cell: each box named by its row, not by a price",
    // Review round 4 fixes, finding 23: every box was unlabelled (the row's
    // name sits in the first cell, far beyond LABEL_LEFT_GAP).
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      const { xs, ys, head, rows } = P41;
      for (const y of ys) rule(page, xs[0]!, xs[xs.length - 1]!, y, 0.75);
      for (const x of xs) vline(page, x, ys[ys.length - 1]!, ys[0]!);
      for (const [i, h] of head.entries())
        await text(page, H, h, xs[i]! + 3, ys[1]! + 5, 9);
      for (const [r, row] of rows.entries()) {
        for (const [i, s] of row.entries())
          await text(page, H, s, xs[i]! + 3, ys[r + 2]! + 5, 9);
        square(page, P41.boxX, ys[r + 2]! + 4, 12);
      }
      return save(d);
    },
    expect: P41.rows.map((row, r) => ({
      rule: "square-checkbox" as const,
      type: "checkbox" as const,
      label: row[0]!,
      page: 1,
      box: squareBox(P41.boxX, P41.ys[r + 2]! + 4, 12),
    })),
  },
  {
    id: "P42",
    kind: "positive",
    note: 'a delivery note\'s sign-off row: "Received by", "Signature" and "Date" boxes, each caption inside its top-left: fields inside the first and last, the signature counted',
    // Review round 4 fixes, finding 22: no box got a field (the page's
    // outcome was no-candidates). N44 is the negative twin: one-line
    // notices in boxes stay no fields.
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await text(page, H, "Goods received in good condition.", 72, 200, 10);
      for (const [i, s] of P42.captions.entries()) {
        const x = P42.x(i);
        page.drawRectangle({
          x,
          y: 130,
          width: 150,
          height: 50,
          borderColor: rgb(0, 0, 0),
          borderWidth: 0.75,
        });
        await text(page, H, s, x + 4, 170, 8);
      }
      return save(d);
    },
    expect: [0, 2].map((i) => ({
      rule: "labelled-rule" as const,
      type: "text" as const,
      label: P42.captions[i]!,
      page: 1,
      box: ruleBox(P42.x(i), P42.x(i) + 150, 130, 8),
    })),
    decidedBy: "signature",
    at: { page: 1, x: P42.x(1) + 75, y: 135 },
  },
  {
    id: "P43",
    kind: "positive",
    note: 'empty outlined boxes captioned just above their tops ("Dietary requirements", "Comments:"): a field filling each box, multiline (70 and 60 pt tall)',
    // Review round 4 fixes, finding 22: both boxes got nothing. Then (until
    // slice S4, 2026-11-21) one line along each box's bottom edge
    // (labelled-rule, 14 pt tall, ruleBox(72, 540, y, 10)): a box drawn to
    // write in was offered one line at its foot. INVERTED by S4: an empty
    // labelled box of an entry box's size is an entry box, its field fills
    // it inset 1 pt, and at 36 pt or more it is multiline.
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      for (const b of P43) {
        await text(page, H, b.caption, 72, b.y + b.h + 4, 10);
        page.drawRectangle({
          x: 72,
          y: b.y,
          width: 468,
          height: b.h,
          borderColor: rgb(0, 0, 0),
          borderWidth: 0.75,
        });
      }
      return save(d);
    },
    expect: P43.map((b) => ({
      rule: "entry-box" as const,
      type: "text" as const,
      label: b.caption.replace(/:$/, ""),
      page: 1,
      box: cellBox(72, 540, b.y, b.y + b.h),
      multiline: true,
    })),
  },
  {
    id: "N44",
    kind: "negative",
    note: "one-line notices set in outlined boxes (a 24 pt and a 40 pt box), each a sentence: no fields",
    // Review round 4 fixes, finding 22: the negative twin of P42 and P43.
    // Without the notice rule the 40 pt box was proposed, named after its
    // notice.
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      for (const b of N44) {
        page.drawRectangle({
          x: 72,
          y: b.y,
          width: 468,
          height: b.h,
          borderColor: rgb(0, 0, 0),
          borderWidth: 0.75,
        });
        await text(page, H, b.notice, 78, b.base, 10);
      }
      return save(d);
    },
    expect: "none",
    decidedBy: "unlabelled",
    at: { page: 1, x: 300, y: N44[0]!.y + 5 },
    // With no caption the bottom edge's field reaches the notice's text,
    // which lowers its top under 10 pt: no-clearance would decide it next.
    seamAlsoDisable: ["no-clearance"],
  },
  {
    id: "P44",
    kind: "positive",
    note: 'labels set vertically centred beside boxes: "Total hours" on a 22 pt box, "Received by:" on an 18 pt one, "Reference:" on a 30 pt one',
    // Review round 4 fixes, finding 24: only the 18 pt box (the control)
    // was labelled; a taller box's centred label sat above its bottom
    // edge's label band. Until slice S4 (2026-11-21) each field was one
    // 14 pt line along the box's bottom edge (labelled-rule,
    // ruleBox(140, 140 + w, y, 10)). INVERTED by S4: each box is an entry
    // box, its field fills it inset 1 pt; all three are under 36 pt, so one
    // line each.
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      for (const b of P44) {
        await text(page, H, b.label, 72, b.y + b.h / 2 - 3.5, 10);
        page.drawRectangle({
          x: 140,
          y: b.y,
          width: b.w,
          height: b.h,
          borderColor: rgb(0, 0, 0),
          borderWidth: 0.75,
        });
      }
      return save(d);
    },
    expect: P44.map((b) => ({
      rule: "entry-box" as const,
      type: "text" as const,
      label: b.label.replace(/:$/, ""),
      page: 1,
      box: cellBox(140, 140 + b.w, b.y, b.y + b.h),
    })),
  },
  {
    id: "N45",
    kind: "negative",
    note: "KNOWN MISS: a timesheet's empty ruled grid (Day | Start | Finish | Break | Hours, Monday to Sunday): no fields yet",
    // Review round 4 fixes, finding 26, recorded as a KNOWN MISS: the
    // product wants a field per empty body cell ("Monday Start"); that
    // needs cell detection beyond the two-column label table. Invert this
    // case (keeping its id) when it lands.
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      const { xs, ys, head, days } = N45;
      for (const y of ys) rule(page, xs[0]!, xs[xs.length - 1]!, y, 0.75);
      for (const x of xs) vline(page, x, ys[ys.length - 1]!, ys[0]!);
      for (const [i, h] of head.entries())
        await text(page, H, h, xs[i]! + 3, ys[1]! + 5, 9);
      for (const [r, s] of days.entries())
        await text(page, H, s, xs[0]! + 3, ys[r + 2]! + 5, 9);
      return save(d);
    },
    expect: "none",
    decidedBy: "table-grid",
    at: { page: 1, x: 300, y: N45.ys[4]! + 2 },
    // Read without the grid, each rule takes the caption of a row, whose
    // own text leaves its field no room to type.
    seamAlsoDisable: ["no-clearance"],
  },
  {
    id: "P45",
    kind: "positive",
    note: "KNOWN MISS (partly): tiled numbered customs boxes sharing their edges; only the lowest box, whose bottom edge is its own, gets a field",
    // Review round 4 fixes, finding 26: shared edges merge into grid lines
    // (table-grid), so boxes 1 to 8 get nothing; the product wants one
    // field per box, labelled with its number and caption. Box 9's bottom
    // edge is no other box's, so its caption labels it (finding 22).
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      for (const [x, y, w, h, s] of P45) {
        page.drawRectangle({
          x,
          y,
          width: w,
          height: h,
          borderColor: rgb(0, 0, 0),
          borderWidth: 0.75,
        });
        await text(page, H, s, x + 3, y + h - 9, 7);
      }
      return save(d);
    },
    expect: [
      {
        rule: "labelled-rule",
        type: "text",
        label: "9 Description of goods",
        page: 1,
        box: ruleBox(72, 540, 500, 7),
      },
    ],
    decidedBy: "table-grid",
    at: { page: 1, x: 300, y: 605 },
  },
  {
    id: "N46",
    kind: "negative",
    note: "a filled ruled data table (Qty | Description | Item code, three rows of goods): no fields, now or once empty tables are read",
    // Review round 4 fixes, finding 26: the negative twin of N45 and P45.
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      const { xs, ys, rows } = N46;
      for (const y of ys) rule(page, xs[0]!, xs[xs.length - 1]!, y, 0.75);
      for (const x of xs) vline(page, x, ys[ys.length - 1]!, ys[0]!);
      for (const [r, row] of rows.entries())
        for (const [i, s] of row.entries())
          await text(page, H, s, xs[i]! + 3, ys[r + 1]! + 5, 9);
      return save(d);
    },
    expect: "none",
    decidedBy: "table-grid",
    at: { page: 1, x: 300, y: N46.ys[2]! + 2 },
    seamAlsoDisable: ["no-clearance"],
  },
  {
    id: "N47",
    kind: "negative",
    note: "headed date combs: D D M M Y Y Y Y over two aligned 8-box combs, no checkboxes",
    // Review round 5 fixes, finding 1: P40's grid exemption made these 16
    // checkboxes ("Date of birth D", ...). A comb's heads repeat; a grid's
    // do not. P40 and N33 are its neighbours.
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      for (const [k, h] of N47.heads.entries())
        await text(page, H, h, N47.x(k) + 7 - textWidth(H, h, 8) / 2, 618, 8);
      for (const [i, s] of N47.rows.entries()) {
        await text(page, H, s, 72, N47.ys[i]! + 3, 10);
        for (const k of N47.heads.keys())
          square(page, N47.x(k), N47.ys[i]!, 14);
      }
      return save(d);
    },
    expect: "none",
    decidedBy: "comb",
    at: { page: 1, x: N47.x(3) + 7, y: N47.ys[0]! + 7 },
  },
  {
    id: "N48",
    kind: "negative",
    note: "a stop-less instruction framed in a 30 pt box (Please use block capitals and black ink throughout): no field",
    // Review round 5 fixes, finding 2: the negative twin of N44 without a
    // full stop. It became a field labelled with the instruction, squeezed
    // under it; a captioned box needs room to write under its caption.
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      page.drawRectangle({
        x: 72,
        y: 690,
        width: 468,
        height: 30,
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.75,
      });
      await text(
        page,
        H,
        "Please use block capitals and black ink throughout",
        80,
        702,
        10,
      );
      return save(d);
    },
    expect: "none",
    decidedBy: "unlabelled",
    at: { page: 1, x: 300, y: 695 },
    seamAlsoDisable: ["no-clearance"],
  },
  {
    id: "N49",
    kind: "negative",
    note: 'a prose article in 10 pt with a boxed-out sidebar: a rule over a 10.5 pt "Did you know" over three 8 pt lines: no field',
    // Review round 6 fixes, finding 3: the sidebar's text is smaller than
    // the page's body, so after round 5's finding 4 it stopped counting as
    // the heading's body, and the heading labelled the rule.
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await text(page, "serif", "Saving on Energy at Home", 72, 730, 18);
      for (const [i, s] of N49.body.entries()) {
        await text(page, "serif", s, 72, 700 - 13 * i, 10);
        await text(page, "serif", s, 72, 550 - 13 * i, 10);
      }
      rule(page, 340, 540, 704);
      await text(page, H, "Did you know", 340, 688, 10.5);
      for (const [i, s] of N49.sidebar.entries())
        await text(page, H, s, 340, 676 - 10 * i, 8);
      return save(d);
    },
    expect: "none",
    decidedBy: "unlabelled",
    at: { page: 1, x: 440, y: 710 },
  },
  {
    id: "N50",
    kind: "negative",
    note: "a completed statement: three figures at a 24 pt pitch, a sum rule halfway under the last, the total 14 pt under the rule: no field",
    // Review round 6 fixes, finding 4 (since before round 4): the printed
    // total under the sum rule was read as the rule's caption, and a field
    // labelled "65,698.58" was proposed on a page with nothing to fill in.
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await text(page, H, "Statement", 72, 730, 12);
      for (const [i, [s, n]] of N50.rows.entries()) {
        await text(page, H, s, 72, 700 - 24 * i, 10);
        await text(page, H, n, 540 - textWidth(H, n, 10), 700 - 24 * i, 10);
      }
      rule(page, 470, 540, 640, 0.75);
      await text(
        page,
        H,
        N50.total,
        540 - textWidth(H, N50.total, 10),
        626,
        10,
      );
      return save(d);
    },
    expect: "none",
    decidedBy: "unlabelled",
    at: { page: 1, x: 505, y: 645 },
  },
  {
    id: "N51",
    kind: "negative",
    note: "N48's stop-less framed instruction in a 32 pt box, 2 pt taller, the text 2 pt higher: no field",
    // Regression verify after review round 6: the room rule of round 6's
    // finding 2 ("more room under the caption than over it") let this
    // through as a field named after the instruction, which round 5
    // (78964d41) proposed nothing for. 12 pt under the text, 11 over it.
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      page.drawRectangle({
        x: 72,
        y: 690,
        width: 468,
        height: 32,
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.75,
      });
      await text(
        page,
        H,
        "Please use block capitals and black ink throughout",
        80,
        704,
        10,
      );
      return save(d);
    },
    expect: "none",
    decidedBy: "unlabelled",
    at: { page: 1, x: 300, y: 695 },
    seamAlsoDisable: ["no-clearance"],
  },
  {
    id: "P46",
    kind: "positive",
    note: "a numbered checklist (No. | Item | Packed) with a 9 pt box on each row: each box named after its item, not its number",
    // Review round 5 fixes, finding 3: P41's checklist rule named these
    // boxes "1" to "5", each row's first text.
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await text(page, H, "No.", 72, 640, 10);
      await text(page, H, "Item", 110, 640, 10);
      await text(page, H, "Packed", 395, 640, 10);
      for (const [i, s] of P46.items.entries()) {
        await text(page, H, `${i + 1}`, 72, P46.y(i), 10);
        await text(page, H, s, 110, P46.y(i), 10);
        square(page, P46.boxX, P46.y(i) - 1, 9);
      }
      return save(d);
    },
    expect: P46.items.map((s, i) => ({
      rule: "square-checkbox" as const,
      type: "checkbox" as const,
      label: s,
      page: 1,
      box: squareBox(P46.boxX, P46.y(i) - 1, 9),
    })),
  },
  {
    id: "P47",
    kind: "positive",
    note: 'a declaration in 10 pt: "Signature of applicant" under its line with two 7 pt hints under it, a "Date:" line beside: the date proposed, the signature counted',
    // Review round 5 fixes, finding 4: the caption over two hint lines
    // was read as a heading, and the signature line went uncounted.
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await text(
        page,
        H,
        "I declare that the information I have given on this form is true and complete",
        72,
        700,
        10,
      );
      await text(
        page,
        H,
        "to the best of my knowledge, and that a false statement may be refused.",
        72,
        687,
        10,
      );
      rule(page, 72, 300, 612, 0.75);
      await text(page, H, "Signature of applicant", 72, 600, 10);
      await text(page, H, "(must match your photo ID)", 72, 590, 7);
      await text(page, H, "(sign in black ink only)", 72, 581, 7);
      await text(page, H, "Date:", 340, 612, 10);
      rule(page, 372, 540, 612, 0.75);
      return save(d);
    },
    expect: [
      {
        rule: "labelled-rule",
        type: "text",
        label: "Date",
        page: 1,
        box: ruleBox(372, 540, 612, 10),
      },
    ],
    decidedBy: "signature",
    at: { page: 1, x: 180, y: 618 },
  },
  {
    id: "P48",
    kind: "positive",
    note: 'a two-row header: "Vehicle reg:" / "Driver:" and "Odometer:" / "Date:", labels flush left, each pair\'s lines at one tab stop, the short labels ending over 36 pt from their lines: four fields',
    // Review round 5 fixes, finding 5: with LABEL_COLUMN_MIN 3, a column of
    // two was none, and Driver and Date were unlabelled.
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      for (const c of P48.columns)
        for (const [i, s] of c.labels.entries()) {
          await text(page, H, s, c.x, P48.ys[i]!, 10);
          rule(page, c.tab, c.end, P48.ys[i]!, 0.75);
        }
      return save(d);
    },
    expect: P48.ys.flatMap((y, i) =>
      P48.columns.map((c) => ({
        rule: "labelled-rule" as const,
        type: "text" as const,
        label: c.labels[i]!.replace(/:$/, ""),
        page: 1,
        box: ruleBox(c.tab, c.end, y, 10),
      })),
    ),
  },
  {
    id: "P49",
    kind: "positive",
    note: 'a two-level checkbox grid: "Left eye" / "Right eye" over "Yes No | Yes No", rows Redness, Itching, Blurred vision: each box named by row, group and head',
    // Review round 5 fixes, finding 6a: every name appeared twice
    // ("Redness Yes" for both eyes).
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      for (const [g, s] of P49.groups.entries()) {
        const mid = (P49.xs[2 * g]! + P49.xs[2 * g + 1]! + 12) / 2;
        await text(page, H, s, mid - textWidth(H, s, 9) / 2, 640, 9);
      }
      for (const [k, x] of P49.xs.entries()) {
        const h = P49.heads[k % 2]!;
        await text(page, H, h, x + 6 - textWidth(H, h, 9) / 2, 616, 9);
      }
      for (const [i, s] of P49.rows.entries()) {
        await text(page, H, s, 72, P49.y(i) + 2, 10);
        for (const x of P49.xs) square(page, x, P49.y(i), 12);
      }
      return save(d);
    },
    expect: P49.rows.flatMap((s, i) =>
      P49.xs.map((x, k) => ({
        rule: "square-checkbox" as const,
        type: "checkbox" as const,
        label: `${s} ${P49.groups[k >> 1]} ${P49.heads[k % 2]}`,
        page: 1,
        box: squareBox(x, P49.y(i), 12),
      })),
    ),
  },
  {
    id: "P50",
    kind: "positive",
    note: 'a row of three separate 24 pt boxes 10 pt apart, each with an 8 pt caption in its top-left ("1 Wages, tips, other compensation", "2 Federal income tax withheld", "3 Social security wages"): each box labelled with its own caption',
    // Review round 6 fixes, finding 1: box 2 took box 1's caption, which
    // ends 26 pt to its left, as its left label (a regression from round
    // 4's finding 24, a left label anywhere up a box's side).
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      for (const [i, s] of P50.captions.entries()) {
        page.drawRectangle({
          x: P50.x(i),
          y: 650,
          width: 150,
          height: P50.h,
          borderColor: rgb(0, 0, 0),
          borderWidth: 0.75,
        });
        await text(page, H, s, P50.x(i) + 2, 650 + P50.h - 7.6, 8);
      }
      return save(d);
    },
    expect: P50.captions.map((s, i) => ({
      rule: "labelled-rule" as const,
      type: "text" as const,
      label: s,
      page: 1,
      box: ruleBox(P50.x(i), P50.x(i) + 150, 650, 8),
    })),
  },
  {
    id: "P51",
    kind: "positive",
    note: "P50's row of captioned boxes made compact, as on tax forms: 20 pt tall, 7 pt captions in the top-left: a field in each box under its caption",
    // Review round 6 fixes, finding 2: no field at all (a regression from
    // round 5's room rule, which asked 14 pt under a caption where a
    // field needs 10).
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      for (const [i, s] of P50.captions.entries()) {
        page.drawRectangle({
          x: P50.x(i),
          y: 650,
          width: 150,
          height: P51.h,
          borderColor: rgb(0, 0, 0),
          borderWidth: 0.75,
        });
        await text(page, H, s, P50.x(i) + 2, P51.base, P51.size);
      }
      return save(d);
    },
    expect: P50.captions.map((s, i) => ({
      rule: "labelled-rule" as const,
      type: "text" as const,
      label: s,
      page: 1,
      box: rounded(
        P50.x(i) + 1,
        651,
        P50.x(i) + 149,
        P51.base - 0.2 * P51.size,
      ),
    })),
  },
  {
    id: "P52",
    kind: "positive",
    note: 'an equipment return checklist with a code column (Code | Item | Returned: "A1 Laptop", "A2 Charger", "B7 Badge", "C3 Headset", "D4 Monitor"): each box named by its item, not its code',
    // Review round 6 fixes, finding 5: the boxes were named "A1" to "D4",
    // the row's first text holding a letter.
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      await text(page, H, "Equipment return checklist", 72, 720, 12);
      await text(page, H, "Code", 72, 690, 10);
      await text(page, H, "Item", 120, 690, 10);
      await text(page, H, "Returned", 400, 690, 10);
      for (const [i, [code, item]] of P52.rows.entries()) {
        await text(page, H, code, 72, P52.y(i), 10);
        await text(page, H, item, 120, P52.y(i), 10);
        square(page, 415, P52.y(i) - 1, 9);
      }
      return save(d);
    },
    expect: P52.rows.map(([, item], i) => ({
      rule: "square-checkbox" as const,
      type: "checkbox" as const,
      label: item,
      page: 1,
      box: squareBox(415, P52.y(i) - 1, 9),
    })),
  },

  // ---------------------------------------------------------- outcomes
  {
    id: "O1",
    kind: "outcome",
    note: "an image-only page: a picture scaled over the whole page",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      // Through the raster boundary (pdf-lib.ts), as every embedder must.
      const img = await embedRasterImage(d, PNG_1PX, "png");
      await drawRasterImage(page, img, {
        x: 0,
        y: 0,
        width: LETTER[0],
        height: LETTER[1],
      });
      return save(d);
    },
    expect: "none",
    outcome: "no-text-layer",
  },
  {
    id: "O2",
    kind: "outcome",
    note: "a content stream cut part-way through an operator",
    build: async () => (await damagedBytes()).bytes,
    expect: "none",
    outcome: "nothing-drawn",
    outcomes: [{ pages: [1], oneOf: ["unread", "nothing-drawn"] }],
  },
  {
    id: "O3",
    kind: "outcome",
    note: "a blank page",
    build: async () => {
      const d = await doc();
      d.addPage(LETTER);
      return save(d);
    },
    expect: "none",
    outcome: "nothing-drawn",
  },
  {
    id: "O4",
    kind: "outcome",
    note: "a page drawing 25,000 short segments",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      const ops = [pushGraphicsState(), setLineWidth(0.1)];
      for (let k = 0; k < 25_000; k++) {
        const x = 20 + (k % 250) * 2.2;
        const y = 20 + Math.floor(k / 250) * 7;
        ops.push(moveTo(x, y), lineTo(x + 1, y + 1));
      }
      ops.push(stroke(), popGraphicsState());
      // In slices: one spread of 50,000 arguments overflows the call stack.
      for (let k = 0; k < ops.length; k += 5000)
        page.pushOperators(...ops.slice(k, k + 5000));
      return save(d);
    },
    expect: "none",
    outcome: "skipped",
  },
  {
    id: "O5",
    kind: "outcome",
    note: "55 pages with P1a on each: the last five are past the page cap",
    build: async () => {
      const d = await doc();
      const f = H;
      for (let i = 0; i < 55; i++) await nameRun(d.addPage(LETTER), f, 72, 400);
      return save(d);
    },
    expect: "none",
    outcome: "found",
    outcomes: [
      { pages: Array.from({ length: 50 }, (_, i) => i + 1), oneOf: ["found"] },
      { pages: [51, 52, 53, 54, 55], oneOf: ["skipped"] },
    ],
  },
  {
    id: "O6",
    kind: "outcome",
    note: "a page of text with no lines, runs or boxes",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      const f = H;
      await text(
        page,
        f,
        "This page is a letter with nothing to fill in.",
        72,
        700,
      );
      await text(page, f, "It has two lines of text.", 72, 680);
      return save(d);
    },
    expect: "none",
    outcome: "no-candidates",
  },
  {
    id: "O7",
    kind: "outcome",
    note: "a landscape form made the common way: a portrait page, /Rotate 90, the content counter-turned with `cm` (upright on screen, turned in the content): searched",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      page.setRotation(degrees(90));
      page.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(0, 1, -1, 0, 612, 0),
      );
      for (const [s, x, y] of O7_LINES) {
        await text(page, H, `${s}:`, x, y, 11);
        rule(page, x + 60, x + 300, y, 0.5);
      }
      page.pushOperators(popGraphicsState());
      return save(d);
    },
    // Inverted in review round 7 (2026-11-19). This case required
    // "turned-content", and the summary then told the person "Page 1 is
    // drawn on its side" about a page their preview showed upright: the
    // reader classified content space. It classifies what the reader sees
    // now, where these labels are upright beside plumb lines.
    expect: O7_LINES.map(([label, x, y]) => ({
      rule: "labelled-rule" as const,
      type: "text" as const,
      label,
      page: 1,
      box: ruleBox(x + 60, x + 300, y, 11),
    })),
    outcome: "found",
  },
  {
    id: "O8",
    kind: "outcome",
    note: "a /Rotate 90 page drawn upright in CONTENT space, so the reader sees its labels sideways (P10's page 2 until review round 7)",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      page.setCropBox(P10_CROP.x, P10_CROP.y, P10_CROP.width, P10_CROP.height);
      page.setRotation(degrees(90));
      await nameRun(page, H, 72, 700);
      await optionSquares(page, H);
      return save(d);
    },
    // Never "found": a field there takes its typed text upright on screen,
    // across a line the reader sees running up the page. Never
    // "no-candidates" either: that reads as "this page has no fields".
    expect: "none",
    outcome: "turned-content",
  },
  {
    id: "O9",
    kind: "outcome",
    note: "a scan with a text layer, as OCR writes one: O1's full-page picture with invisible labels and underscores over it",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      const img = await embedRasterImage(d, PNG_1PX, "png");
      await drawRasterImage(page, img, {
        x: 0,
        y: 0,
        width: LETTER[0],
        height: LETTER[1],
      });
      page.pushOperators(
        pushGraphicsState(),
        setTextRenderingMode(TextRenderingMode.Invisible),
      );
      for (const [label, y] of O9_LINES)
        await text(page, H, `${label}: ${UNDERSCORES}`, 72, y);
      page.pushOperators(popGraphicsState());
      return save(d);
    },
    // Searched: "a scanned page is not searched" was false of exactly this
    // page (review round 7); the copy guard binds its sentence to O1 AND
    // here.
    expect: O9_LINES.map(([label, y]) => ({
      rule: "underscore-run" as const,
      type: "text" as const,
      label,
      page: 1,
      box: runBox(H, 72, y, 12, `${label}: `, UNDERSCORES),
    })),
    outcome: "found",
  },
  // Slice S3 (rows of dots, box symbols): src/tests/form-detect-precision-fixtures.ts.
  ...PRECISION_CASES,
  // Slice S4 (entry boxes, stacked lines): src/tests/form-detect-boxes-fixtures.ts.
  ...BOX_CASES,
];

/* ------------------------------------------------------------------ *
 *  The harness both test files run a case through
 * ------------------------------------------------------------------ */

/** pdf.js's legacy build: the same parser, with the polyfills Node needs. */
export const legacyPdfjs = async (): Promise<PdfjsLike> =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsLike;

export interface CaseRun {
  report: DetectReport;
  /** Proposals that also passed the builder's validation. */
  proposals: FieldProposal[];
  /** The reader's exclusions, then those `filterValid` added as "invalid". */
  excluded: Excluded[];
}

/**
 * A case as the builder will run it: the reader, then the builder's own
 * validation (`validateFormFields` against the PDF's page sizes and names)
 * as the second bound. `disable` adds to the case's own.
 */
export async function runCase(
  c: DetectCase,
  disable: readonly ExclusionRuleId[] = [],
): Promise<CaseRun> {
  const bytes = await c.build();
  const off = new Set([...(c.disable ?? []), ...disable]);
  const report = await detectFormFields(bytes, {
    loadReader: legacyPdfjs,
    drafts: c.drafts,
    disable: off,
  });
  const found = report.pages.flatMap((p) =>
    p.outcome === "found" ? p.proposals : [],
  );
  const excluded = [...report.excluded];
  if (found.length === 0 || off.has("invalid"))
    return { report, proposals: found, excluded };
  const context = await readFormContext(bytes);
  const reserved = [...context.existingNames, ...(c.existingNames ?? [])];
  const { kept } = filterValid(found, (all) =>
    validateFormFields(
      proposalToDraftFields(all, reserved),
      context.pageSizes,
      reserved,
    ),
  );
  for (const p of found)
    if (!kept.includes(p))
      excluded.push({
        rule: "invalid",
        page: p.page,
        box: { x: p.x, y: p.y, width: p.width, height: p.height },
      });
  return { report, proposals: kept, excluded };
}

const near = (a: number, b: number) => Math.abs(a - b) <= 1;

/** Whether a proposal is the expected one (box +-1 pt). */
export function matches(p: FieldProposal, e: Expect): boolean {
  return (
    p.rule === e.rule &&
    p.type === e.type &&
    p.label === e.label &&
    p.page === e.page &&
    (p.multiline === true) === (e.multiline === true) &&
    near(p.x, e.box.x) &&
    near(p.y, e.box.y) &&
    near(p.width, e.box.width) &&
    near(p.height, e.box.height)
  );
}

/** The exclusion deciding the shape under a case's `at` point, if any. */
export function decidingAt(
  run: CaseRun,
  at: NonNullable<DetectCase["at"]>,
): Excluded | undefined {
  return run.excluded.find(
    (e) =>
      e.page === at.page &&
      at.x >= e.box.x - 1 &&
      at.x <= e.box.x + e.box.width + 1 &&
      at.y >= e.box.y - 1 &&
      at.y <= e.box.y + e.box.height + 1,
  );
}

/**
 * Everything about a run that the case does not explain; empty when the case
 * is explained. Proposals must be exactly the expected ones; a deciding rule
 * must be the first exclusion under `at`; outcomes must match.
 */
export function unexplained(c: DetectCase, run: CaseRun): string[] {
  const out: string[] = [];
  const want = c.expect === "none" ? [] : c.expect;
  const left = [...run.proposals];
  for (const e of want) {
    const i = left.findIndex((p) => matches(p, e));
    if (i < 0) out.push(`${c.id}: missing ${JSON.stringify(e)}`);
    else left.splice(i, 1);
  }
  if (c.kind !== "outcome")
    for (const p of left) out.push(`${c.id}: extra ${JSON.stringify(p)}`);
  if (c.decidedBy) {
    if (!c.at) out.push(`${c.id}: decidedBy without a point`);
    else {
      const hit = decidingAt(run, c.at);
      if (hit?.rule !== c.decidedBy)
        out.push(
          `${c.id}: decided by ${hit?.rule ?? "nothing"}, expected ${c.decidedBy}`,
        );
    }
  } else if (c.kind === "negative" && run.excluded.length > 0) {
    out.push(
      `${c.id}: expected no candidate at all, got ${run.excluded.map((e) => e.rule).join(", ")}`,
    );
  }
  const outcomes =
    c.outcomes ?? (c.outcome ? [{ pages: [1], oneOf: [c.outcome] }] : []);
  for (const { pages, oneOf } of outcomes)
    for (const n of pages) {
      const got = run.report.pages.find((p) => p.page === n)?.outcome;
      if (!got || !oneOf.includes(got))
        out.push(
          `${c.id}: page ${n} read as ${got}, expected ${oneOf.join("|")}`,
        );
    }
  return out;
}
