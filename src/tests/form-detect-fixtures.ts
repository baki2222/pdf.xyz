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
  stroke,
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
    note: "P1a on page 1; P1a and P7 on a /Rotate 90 page 2 with an inset crop",
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
      await nameRun(second, f, 72, 700);
      await optionSquares(second, f);
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
        box: turned90(runBox(H, 72, 700, 12, "Name: ", UNDERSCORES), P10_CROP),
      },
      ...optionExpect(2, (b) => turned90(b, P10_CROP)),
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
    note: "a landscape form made the common way: a portrait page, /Rotate 90, the content counter-turned with `cm` (upright on screen, turned in the content)",
    build: async () => {
      const d = await doc();
      const page = d.addPage(LETTER);
      page.setRotation(degrees(90));
      page.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(0, 1, -1, 0, 612, 0),
      );
      for (const [i, s] of ["Name:", "Address:", "City:", "Phone:"].entries())
        for (const x of [72, 420]) {
          await text(page, H, s, x, 500 - 40 * i, 11);
          rule(page, x + 60, x + 300, 500 - 40 * i, 0.5);
        }
      page.pushOperators(popGraphicsState());
      return save(d);
    },
    expect: "none",
    // Never "no-candidates": that reads as "this page has no fields".
    outcome: "turned-content",
  },
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
