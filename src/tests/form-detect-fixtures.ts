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
