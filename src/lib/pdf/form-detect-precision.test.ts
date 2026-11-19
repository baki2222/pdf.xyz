// @native-canvas
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import {
  createFormFields,
  readFormContext,
  validateFormFields,
} from "./create-forms";
import {
  DETECTION_RULES,
  DETECT_TEXT_SHAPES,
  EMPTY_BOXES,
  EXCLUSION_RULES,
  TICKED_BOXES,
  charSpans,
  classifyPage,
  proposalToDraftFields,
  type CardPage,
  type CardText,
  type FieldProposal,
} from "./form-detect";
import {
  ADVANCES,
  glyphTable,
  itemAdvances,
  type GlyphOps,
} from "./form-detect-glyphs";
import { detectFormFields, textItemToCard } from "./form-detect-read";
import { fontPack } from "./font-packs";
import { openNotoFont, readNotoTtf } from "./noto-source";
import { embedDrawingFont } from "./unicode-font";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";
import {
  DETECT_CASES,
  legacyPdfjs,
  runCase,
  unexplained,
} from "@/tests/form-detect-fixtures";
import {
  PRECISION_CASES,
  T3_BOX,
  WHITE_SQUARE,
  boxFont,
  drawBoxes,
  t3Advance,
} from "@/tests/form-detect-precision-fixtures";

/**
 * Slice S3 of the Create Forms field finder: rows of dots, box symbols and
 * where a run of underscores sits inside its text item.
 *
 * The corpus cases (P53-P59, N52-N57, in
 * src/tests/form-detect-precision-fixtures.ts) are run both ways by
 * form-detect.corpus.test.ts like every other case; this file holds what
 * the corpus cannot: each new threshold at and just past its boundary, the
 * MEASUREMENT that decided the glyph-accurate split, the box symbol's
 * placement against the ink a reader sees, the ZapfDingbats known miss, the
 * composed chain for each new rule, and the cost as a same-run ratio.
 */

/* ------------------------------------------------------------------ *
 *  Helpers
 * ------------------------------------------------------------------ */

async function openPdfjs(bytes: Uint8Array) {
  const pdfjs =
    (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as typeof import("pdfjs-dist");
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
  });
  return { pdfjs, doc: await task.promise, task };
}

/**
 * Page 1's text items as the reader makes them, twice: with the page's
 * glyph table (what the finder uses) and without it (the per-family
 * estimate it used before slice S3).
 */
async function readItems(bytes: Uint8Array) {
  const { pdfjs, doc, task } = await openPdfjs(bytes);
  try {
    const page = await doc.getPage(1);
    const content = await page.getTextContent({ includeMarkedContent: false });
    const ops = await page.getOperatorList({
      annotationMode: pdfjs.AnnotationMode.DISABLE,
    });
    const table = glyphTable(
      ops.fnArray,
      ops.argsArray,
      pdfjs.OPS as unknown as GlyphOps,
    );
    const styles = content.styles as never;
    const items = content.items as never[];
    const card = (glyphs?: typeof table) =>
      items
        .map((it) => textItemToCard(it, [0, 0], styles, glyphs))
        .filter((t): t is CardText => t !== null);
    return { glyphs: card(table), estimate: card(), table };
  } finally {
    await task.destroy();
  }
}

const proposalsOf = async (bytes: Uint8Array) => {
  const report = await detectFormFields(bytes, { loadReader: legacyPdfjs });
  return report.pages.flatMap((p) =>
    p.outcome === "found" ? p.proposals : [],
  );
};

const W = 612;
const H = 792;
const pg = (parts: Partial<CardPage> = {}): CardPage => ({
  page: 1,
  width: W,
  height: H,
  segs: [],
  rects: [],
  text: [],
  widgets: [],
  imageCover: 0,
  ...parts,
});

/** Helvetica's advances, from pdf-lib's metrics, for the hand-built items. */
const HELV_FONT = await (
  await PDFDocument.create()
).embedFont(StandardFonts.Helvetica);
/** A box symbol's advance: 850 / 1000 em (the corpus's Type 3 face). */
const BOX_UNITS = 850;
const units = (ch: string) =>
  [...EMPTY_BOXES, ...TICKED_BOXES].includes(ch)
    ? BOX_UNITS
    : HELV_FONT.widthOfTextAtSize(ch, 1000);

/** An upright item at (x, y) with Helvetica's advances, as the reader gives. */
function item(str: string, x: number, y: number, size = 12): CardText {
  const advances = Array.from(str).map((ch) => (units(ch) * size) / 1000);
  return {
    str,
    x,
    y,
    width: advances.reduce((s, a) => s + a, 0),
    size,
    upright: true,
    family: "sans-serif",
    advances,
  };
}
const right = (t: CardText) => t.x + t.width;
const props = (p: CardPage) => classifyPage(p).proposals;
const firstRule = (p: CardPage) => classifyPage(p).excluded[0]?.rule;
const BOX = EMPTY_BOXES[0]!;

/* ------------------------------------------------------------------ *
 *  The tables
 * ------------------------------------------------------------------ */

describe("slice S3's tables (literal, not read back)", () => {
  it("every DETECT_TEXT_SHAPES and ADVANCES value is the slice's", () => {
    expect(DETECT_TEXT_SHAPES).toStrictEqual({
      LEADER_MIN_DOTS: 8,
      LEADER_ELLIPSIS_DOTS: 3,
      LEADER_ENTRY_GAP: 24,
      BOX_SIDE_EMS: 0.75,
      BULLET_MIN_WORDS: 8,
      BULLET_COLUMN_MIN: 3,
    });
    expect(ADVANCES).toStrictEqual({
      UNITS_PER_EM: 1000,
      SPACE_EXTRA_MIN_EMS: 0.1,
      GLYPH_SHARE_MIN: 0.5,
    });
    expect(EMPTY_BOXES.map((c) => c.codePointAt(0))).toEqual([0x2610, 0x25a1]);
    expect(TICKED_BOXES.map((c) => c.codePointAt(0))).toEqual([0x2611, 0x2612]);
  });

  it("the new rules carry plain words, and the new exclusions exist", () => {
    const plain = Object.fromEntries(
      DETECTION_RULES.map((r) => [r.id, r.plain]),
    );
    expect(plain["dot-leader"]).toBe("dotted lines after a label");
    expect(plain["box-glyph"]).toBe("box symbols in the text");
    const ids = EXCLUSION_RULES.map((r) => r.id);
    expect(ids).toContain("toc-leader");
    expect(ids).toContain("ticked-box");
  });
});

describe("slice S3's corpus cases (health, both ways)", () => {
  it("are in DETECT_CASES, each explained, and each new rule fires on a positive and each new exclusion decides a negative", async () => {
    // Health: the cases are joined onto the corpus the both-ways guard reads.
    expect(PRECISION_CASES.length).toBe(13);
    for (const c of PRECISION_CASES) expect(DETECT_CASES).toContain(c);
    const runs = new Map<string, Awaited<ReturnType<typeof runCase>>>();
    for (const c of PRECISION_CASES) runs.set(c.id, await runCase(c));
    for (const c of PRECISION_CASES)
      expect(unexplained(c, runs.get(c.id)!), c.id).toEqual([]);
    const positives = PRECISION_CASES.filter((c) => c.kind === "positive");
    for (const rule of ["dot-leader", "box-glyph"] as const)
      expect(
        positives.filter((c) =>
          runs.get(c.id)!.proposals.some((p) => p.rule === rule),
        ).length,
        rule,
      ).toBeGreaterThanOrEqual(2);
    const negatives = PRECISION_CASES.filter((c) => c.kind === "negative");
    for (const rule of ["toc-leader", "ticked-box"] as const)
      expect(
        negatives.filter((c) => c.decidedBy === rule).length,
        rule,
      ).toBeGreaterThanOrEqual(1);
  }, 120_000);
});

/* ------------------------------------------------------------------ *
 *  Rows of dots: thresholds and shapes
 * ------------------------------------------------------------------ */

describe("rows of dots (dot-leader)", () => {
  // At 24 pt one full stop is 6.7 pt, so 7 is wider than MIN_FIELD_W: only
  // the count decides.
  const at24 = (dotsStr: string) =>
    pg({ text: [item(`Name ${dotsStr}`, 72, 600, 24)] });

  it("LEADER_MIN_DOTS: 8 full stops are a blank, 7 are not", () => {
    expect(props(at24(".".repeat(8))).map((p) => p.rule)).toEqual([
      "dot-leader",
    ]);
    expect(props(at24(".".repeat(7)))).toEqual([]);
    expect(classifyPage(at24(".".repeat(7))).excluded).toEqual([]);
  });

  it("spaced dots: 8 one space apart are a blank, 7 are not, and two spaces apart are not a row", () => {
    expect(props(at24(Array(8).fill(".").join(" "))).length).toBe(1);
    expect(props(at24(Array(7).fill(".").join(" ")))).toEqual([]);
    expect(props(at24(Array(12).fill(".").join("  ")))).toEqual([]);
  });

  it("LEADER_ELLIPSIS_DOTS: three ellipses (9 dots) are a blank, two (6) are not", () => {
    const e = String.fromCodePoint(0x2026);
    expect(props(at24(e.repeat(3))).length).toBe(1);
    expect(props(at24(e.repeat(2)))).toEqual([]);
    // 2 ellipses and 2 full stops make 8.
    expect(props(at24(e.repeat(2) + ".."))).toHaveLength(1);
  });

  it("the field covers the dots exactly (from the glyphs' own advances)", () => {
    const t = item(`Name ${".".repeat(30)}`, 72, 600);
    const [p] = props(pg({ text: [t] }));
    const start = 72 + ((722 + 556 + 833 + 556 + 278) * 12) / 1000;
    expect(p!.x).toBe(Math.round(start + 1));
    expect(p!.x + p!.width).toBe(Math.round(right(t) - 1));
    expect(p!.label).toBe("Name");
    expect(p!.type).toBe("text");
  });

  it("a short row is short-run, as a run of underscores is", () => {
    // 8 dots at 10 pt: 22.2 pt, 20.2 after the inset, under 24.
    const p = pg({ text: [item(`Name ${".".repeat(8)}`, 72, 600, 10)] });
    expect(props(p)).toEqual([]);
    expect(firstRule(p)).toBe("short-run");
  });

  it("TOC shape: dots that lead to a number, a price or text on the line are toc-leader, in the same item or set apart", () => {
    const same = pg({ text: [item(`Chapter ${".".repeat(20)} 47`, 72, 600)] });
    expect(props(same)).toEqual([]);
    expect(firstRule(same)).toBe("toc-leader");
    const lead = item(`Coffee ${".".repeat(20)}`, 72, 600);
    const apart = pg({ text: [lead, item("$3.00", right(lead) + 6, 600)] });
    expect(props(apart)).toEqual([]);
    expect(firstRule(apart)).toBe("toc-leader");
    // Positive control: the same row with nothing after it is a blank.
    expect(props(pg({ text: [lead] }))).toHaveLength(1);
    // And text on ANOTHER line is not what it leads to.
    expect(
      props(pg({ text: [lead, item("47", right(lead) + 6, 560)] })),
    ).toHaveLength(1);
  });

  it("LEADER_ENTRY_GAP: an entry starting 24 pt after the last dot is led to; 25 pt after, it is another column", () => {
    const lead = item(`Coffee ${".".repeat(20)}`, 72, 600);
    const at = (gap: number) =>
      pg({ text: [lead, item("$3.00", right(lead) + gap, 600)] });
    expect(props(at(24))).toEqual([]);
    expect(firstRule(at(24))).toBe("toc-leader");
    expect(props(at(25)).map((p) => p.rule)).toEqual(["dot-leader"]);
  });

  it("dots that lead to a drawn box are toc-leader (corpus P31's checkbox grid)", () => {
    const lead = item(`Helpful ${".".repeat(20)}`, 72, 600);
    const sq = {
      x0: right(lead) + 4,
      y0: 598,
      x1: right(lead) + 14,
      y1: 608,
      width: 1,
      stroked: true,
      filled: false,
      lum: 0,
    };
    const p = pg({ text: [lead], rects: [sq] });
    // Health: the square alone is read as a square (proposed unlabelled is
    // fine; it must exist for the rule to have something to lead to).
    expect(
      classifyPage(p).excluded.find((e) => e.rule === "toc-leader"),
    ).toBeDefined();
    expect(props(p).filter((x) => x.rule === "dot-leader")).toEqual([]);
  });

  it("a label followed by dots after a leader is the next blank's label: two blanks, set apart or in one item", () => {
    const one = pg({
      text: [item(`Name ${".".repeat(16)} Date ${".".repeat(16)}`, 72, 600)],
    });
    expect(props(one).map((p) => p.label)).toEqual(["Name", "Date"]);
    const a = item(`Name ${".".repeat(16)}`, 72, 600);
    const b = item(`Date ${".".repeat(16)}`, right(a) + 20, 600);
    expect(props(pg({ text: [a, b] })).map((p) => p.label)).toEqual([
      "Name",
      "Date",
    ]);
    // ...but a word followed by NO dots is what the second row leads to.
    const toc = pg({
      text: [item(`Name ${".".repeat(16)} Date ${".".repeat(16)} 4`, 72, 600)],
    });
    expect(props(toc).map((p) => p.label)).toEqual(["Name"]);
    expect(classifyPage(toc).excluded.map((e) => e.rule)).toEqual([
      "toc-leader",
    ]);
  });

  it("a row with no label before it on its line is unlabelled; one labelled from the left within 24 pt is not", () => {
    const bare = pg({ text: [item(".".repeat(30), 72, 600)] });
    expect(props(bare)).toEqual([]);
    expect(firstRule(bare)).toBe("unlabelled");
    const label = item("Email:", 72, 600);
    const near = item(".".repeat(30), right(label) + 24, 600);
    expect(props(pg({ text: [label, near] })).map((p) => p.label)).toEqual([
      "Email",
    ]);
    const far = item(".".repeat(30), right(label) + 25, 600);
    expect(props(pg({ text: [label, far] }))).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 *  Box symbols: thresholds and shapes
 * ------------------------------------------------------------------ */

describe("box symbols (box-glyph)", () => {
  it("both empty boxes are proposed as checkboxes; the ticked and crossed ones are ticked-box", () => {
    for (const ch of EMPTY_BOXES) {
      const [p] = props(pg({ text: [item(`${ch} Yes`, 72, 600)] }));
      expect(p, `U+${ch.codePointAt(0)!.toString(16)}`).toMatchObject({
        rule: "box-glyph",
        type: "checkbox",
        label: "Yes",
      });
    }
    for (const ch of TICKED_BOXES) {
      const p = pg({ text: [item(`${ch} Yes`, 72, 600)] });
      expect(props(p)).toEqual([]);
      expect(firstRule(p)).toBe("ticked-box");
    }
  });

  it("BOX_SIDE_EMS: the side is the advance when that is smaller, else 0.75 em, centred, standing on the baseline, inset 1 pt", () => {
    // 850/1000 em > 0.75 em: side 0.75 x 12 = 9, inner 7.
    const t = item(`${BOX} Yes`, 72, 600);
    const [p] = props(pg({ text: [t] }));
    const adv = 0.85 * 12;
    expect(p!.width).toBe(7);
    expect(p!.x).toBe(Math.round(72 + adv / 2 - 3.5));
    expect(p!.y).toBe(601);
    // An advance of 0.6 em (< 0.75): side 7.2, inner 5.2.
    const narrow: CardText = {
      ...t,
      advances: [7.2, ...t.advances!.slice(1)],
      width: t.width - 10.2 + 7.2,
    };
    const [q] = props(pg({ text: [narrow] }));
    expect(q!.x + q!.width - q!.x).toBeLessThanOrEqual(6);
    expect(q!.x).toBe(Math.round(72 + 3.6 - 2.6));
  });

  it("labels: one side for a line; left for 'Yes [] No []', right for '[] Yes [] No' and 'Sex: [] Male [] Female'", () => {
    const labels = (s: string) =>
      props(pg({ text: [item(s, 72, 600)] }))
        .sort((a, b) => a.x - b.x)
        .map((p) => p.label);
    expect(labels(`Yes ${BOX} No ${BOX}`)).toEqual(["Yes", "No"]);
    expect(labels(`${BOX} Yes ${BOX} No`)).toEqual(["Yes", "No"]);
    expect(labels(`Sex: ${BOX} Male ${BOX} Female`)).toEqual([
      "Male",
      "Female",
    ]);
  });

  it("a box with no text beside it is unlabelled", () => {
    const p = pg({ text: [item(BOX, 72, 600)] });
    expect(props(p)).toEqual([]);
    expect(firstRule(p)).toBe("unlabelled");
  });

  it("boxes typed next to each other are a comb; one space apart they are not", () => {
    const comb = pg({ text: [item(`Code ${BOX}${BOX}${BOX}${BOX}`, 72, 600)] });
    expect(props(comb)).toEqual([]);
    expect(firstRule(comb)).toBe("comb");
    const spaced = pg({ text: [item(`${BOX} A ${BOX} B ${BOX} C`, 72, 600)] });
    expect(props(spaced)).toHaveLength(3);
  });

  describe("a bulleted list (the existing bullet exclusion)", () => {
    const long8 = "Every applicant must send proof of their current address";
    const rows = (s: string, n: number, x = 72) =>
      Array.from({ length: n }, (_, i) => item(`${BOX} ${s}`, x, 600 - 18 * i));

    it("BULLET_COLUMN_MIN: three boxes opening their lines before long sentences are bullets, two are checkboxes", () => {
      const three = pg({ text: rows(long8, 3) });
      expect(props(three)).toEqual([]);
      expect(classifyPage(three).excluded.map((e) => e.rule)).toEqual([
        "bullet",
        "bullet",
        "bullet",
      ]);
      expect(props(pg({ text: rows(long8, 2) }))).toHaveLength(2);
    });

    it("BULLET_MIN_WORDS: eight words make a sentence, seven do not", () => {
      const eight = "one two three four five six seven eight";
      const seven = "one two three four five six seven";
      expect(props(pg({ text: rows(eight, 3) }))).toEqual([]);
      expect(props(pg({ text: rows(seven, 3) }))).toHaveLength(3);
      expect(long8.split(" ")).toHaveLength(9);
    });

    it("boxes that do not open their line, or are not in one column, are not a list", () => {
      const inline = rows(long8, 3).map((t, i) => [
        item("Q:", 30, 600 - 18 * i),
        t,
      ]);
      expect(props(pg({ text: inline.flat() }))).toHaveLength(3);
      const staggered = [0, 1, 2].map((i) =>
        item(`${BOX} ${long8}`, 72 + 3 * i, 600 - 18 * i),
      );
      expect(props(pg({ text: staggered }))).toHaveLength(3);
    });

    it("the sentence may be its own text item, drawn beside the box", () => {
      const text = [0, 1, 2].flatMap((i) => {
        const b = item(BOX, 72, 600 - 18 * i);
        return [b, item(long8, right(b) + 4, 600 - 18 * i)];
      });
      expect(props(pg({ text }))).toEqual([]);
    });
  });
});

/* ------------------------------------------------------------------ *
 *  The glyph table
 * ------------------------------------------------------------------ */

describe("glyphTable and itemAdvances (pure)", () => {
  const OPS = { setFont: 1, showText: 2 };
  const g = (unicode: string, width: number) => ({ unicode, width });

  it("reads each font's advances from setFont / showText, skipping TJ numbers and odd glyphs", () => {
    const table = glyphTable(
      [1, 2, 1, 2, 9],
      [
        ["f1", 12],
        [[g("A", 667), -120, g("_", 556), null, { unicode: 3 }, g("fi", 500)]],
        ["f2", 10],
        [[g("A", 600)]],
        [],
      ],
      OPS,
    );
    expect([...table.get("f1")!]).toEqual([
      ["A", 667],
      ["_", 556],
    ]);
    expect([...table.get("f2")!]).toEqual([["A", 600]]);
  });

  it("a character shown with two advances in one font is dropped for good", () => {
    const table = glyphTable(
      [1, 2, 2, 2],
      [["f", 12], [[g("a", 500)]], [[g("a", 600)]], [[g("a", 500)]]],
      OPS,
    );
    expect(table.get("f")!.has("a")).toBe(false);
  });

  it("without setFont and showText codes it reads nothing (the fake OPS of the walker tests)", () => {
    expect(glyphTable([1, 2], [["f"], [[g("a", 1)]]], {}).size).toBe(0);
  });

  const widths = new Map([
    ["N", 722],
    ["a", 556],
    [" ", 278],
    ["_", 556],
  ]);

  it("an item exactly as wide as its glyphs keeps their advances", () => {
    const adv = itemAdvances("Na_", (722 + 556 + 556) * 0.012, 12, widths)!;
    expect(adv.map((a) => +a.toFixed(3))).toEqual([8.664, 6.672, 6.672]);
  });

  it("SPACE_EXTRA_MIN_EMS: a gap wider or narrower than the space goes to the spaces, past 0.1 em only", () => {
    const glyphs = (722 + 278 + 556) * 0.012;
    const wide = itemAdvances("N _", glyphs + 2.7, 12, widths)!;
    expect(wide[1]!).toBeCloseTo(3.336 + 2.7, 6);
    expect(wide[2]!).toBeCloseTo(6.672, 6);
    const narrow = itemAdvances("N _", glyphs - 1.5, 12, widths)!;
    expect(narrow[1]!).toBeCloseTo(3.336 - 1.5, 6);
    // 0.1 em at 12 pt is 1.2 pt: under it, every advance is scaled.
    const tiny = itemAdvances("N _", glyphs + 1.19, 12, widths)!;
    expect(tiny[2]!).toBeCloseTo(6.672 * ((glyphs + 1.19) / glyphs), 6);
    const over = itemAdvances("N _", glyphs + 1.21, 12, widths)!;
    expect(over[2]!).toBeCloseTo(6.672, 6);
    // A gap narrower than the space by more than the space: scaled.
    const crushed = itemAdvances("N _", glyphs - 3.4, 12, widths)!;
    expect(crushed[1]!).toBeGreaterThan(0);
  });

  it("GLYPH_SHARE_MIN: glyphs under half the width are scaled, not padded (a Type 3 matrix)", () => {
    const glyphs = (722 + 278 + 556) * 0.012;
    const scaled = itemAdvances("N _", glyphs * 2.1, 12, widths)!;
    expect(scaled[0]! / scaled[2]!).toBeCloseTo(722 / 556, 6);
    const padded = itemAdvances("N _", glyphs * 1.9, 12, widths)!;
    expect(padded[2]!).toBeCloseTo(6.672, 6);
  });

  it("a character not in the table gives no advances, except a space pdf.js wrote, which takes the gap", () => {
    expect(itemAdvances("Nb", 20, 12, widths)).toBeUndefined();
    const noSpace = new Map([...widths].filter(([c]) => c !== " "));
    const adv = itemAdvances("N _", 8.664 + 5 + 6.672, 12, noSpace)!;
    expect(adv[1]!).toBeCloseTo(5, 6);
    // ...and with no gap to take, it cannot be placed.
    expect(itemAdvances("N _", 8.664 + 6.672, 12, noSpace)).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ *
 *  The measurement that decided the glyph-accurate split
 * ------------------------------------------------------------------ */

const LABELS = [
  "",
  "A:",
  "Name:",
  "iiil:",
  "WWW MMM:",
  "Date of birth:",
  "Full name of the applicant:",
];
const RUN = "____________";

/** One PDF per face: each label, a space, and a run of 12 underscores. */
async function runSheet(
  face: (d: PDFDocument, s: string) => Promise<PDFFont>,
): Promise<{ bytes: Uint8Array; truth: number[] }> {
  const d = await PDFDocument.create();
  const page = d.addPage([W, H]);
  const truth: number[] = [];
  for (const [i, label] of LABELS.entries()) {
    const s = label ? `${label} ${RUN}` : RUN;
    const font = await face(d, s);
    page.drawText(s, { x: 72, y: 700 - 24 * i, size: 12, font });
    // Each character's own width, summed: pdf-lib's width of a string
    // includes kerning ("colon space" is -50 in Helvetica's AFM) that its
    // drawText never applies, so it is not where the run is drawn.
    truth.push(
      72 +
        Array.from(label ? `${label} ` : "").reduce(
          (sum, ch) => sum + font.widthOfTextAtSize(ch, 12),
          0,
        ),
    );
  }
  return { bytes: await d.save(), truth };
}

const FACES: Record<string, (d: PDFDocument, s: string) => Promise<PDFFont>> = {
  Helvetica: (d) => d.embedFont(StandardFonts.Helvetica),
  "Times-Roman": (d) => d.embedFont(StandardFonts.TimesRoman),
  Courier: (d) => d.embedFont(StandardFonts.Courier),
  // Embedded TrueType, the faces pdf.xyz itself ships, subset by the
  // product's own font engine.
  "Noto Sans (embedded TTF)": async (d, s) =>
    (await embedDrawingFont(d, [s], "sans", fontPack("latin")))!,
  "Geist Mono (embedded TTF)": async (d, s) =>
    (await embedDrawingFont(d, [s], "mono", fontPack("mono")))!,
};

/** Where the finder starts each run, from its items. */
function runStarts(items: CardText[]): number[] {
  return items
    .filter((t) => t.str.includes("____"))
    .sort((a, b) => b.y - a.y)
    .map((t) => charSpans(t)[Array.from(t.str).indexOf("_")]![0]);
}

describe("MEASURED: where a run of underscores starts in its item (the decision record)", () => {
  // Slice S3's decision: keep the per-family estimate if its error is at
  // most 4 pt on these faces, else place by the glyphs' own advances. The
  // estimate measured 16.1 pt off on Noto Sans (an underscore is 0.444 em
  // there, 0.556 in the estimate's sans-serif row), so the reader now reads
  // each character's advance from the operator list. Both errors are
  // printed and pinned: the split to within 0.5 pt on every face, and the
  // estimate's error over 4 pt, the premise the split rests on (if the
  // estimate ever became good enough, this says so).
  it("the glyph-accurate split is within 0.5 pt on every face; the estimate it replaced was over 4 pt off", async () => {
    const rows: string[] = [];
    let worstBefore = 0;
    for (const [name, face] of Object.entries(FACES)) {
      const { bytes, truth } = await runSheet(face);
      const { glyphs, estimate } = await readItems(bytes);
      const after = runStarts(glyphs);
      const before = runStarts(estimate);
      // Health: every row read, every row placed by its glyphs.
      expect(after, name).toHaveLength(LABELS.length);
      expect(before, name).toHaveLength(LABELS.length);
      for (const t of glyphs.filter((x) => x.str.includes("____")))
        expect(t.advances, `${name}: ${t.str}`).toBeDefined();
      const errAfter = Math.max(
        ...after.map((x, i) => Math.abs(x - truth[i]!)),
      );
      const errBefore = Math.max(
        ...before.map((x, i) => Math.abs(x - truth[i]!)),
      );
      worstBefore = Math.max(worstBefore, errBefore);
      rows.push(
        `${name}: estimate ${errBefore.toFixed(2)} pt, glyphs ${errAfter.toFixed(2)} pt`,
      );
      expect(errAfter, name).toBeLessThanOrEqual(0.5);
    }
    console.log(`[underscore split] ${rows.join(" | ")}`);
    expect(worstBefore).toBeGreaterThan(4);
  }, 60_000);

  it("composed: on Noto Sans the proposal's left edge is the run's, within 1 pt", async () => {
    const { bytes, truth } = await runSheet(FACES["Noto Sans (embedded TTF)"]!);
    const found = (await proposalsOf(bytes))
      .filter((p) => p.rule === "underscore-run")
      .sort((a, b) => b.y - a.y);
    expect(found).toHaveLength(LABELS.length);
    found.forEach((p, i) =>
      expect(Math.abs(p.x - (truth[i]! + 1)), p.key).toBeLessThanOrEqual(1),
    );
  }, 60_000);
});

/* ------------------------------------------------------------------ *
 *  Box symbols against the ink a reader sees
 * ------------------------------------------------------------------ */

type Ink = { x0: number; y0: number; x1: number; y1: number };

/**
 * Whether `p` lies inside `ink` (+-0.5 pt for whole-point rounding), its
 * centre within 1 pt of the ink's, its side at least 0.6 of the ink's (a
 * 1 pt inset each side on a 9 pt box, rounded, is 0.69).
 */
function onInk(p: FieldProposal, ink: Ink): boolean {
  const inside =
    p.x >= ink.x0 - 0.5 &&
    p.y >= ink.y0 - 0.5 &&
    p.x + p.width <= ink.x1 + 0.5 &&
    p.y + p.height <= ink.y1 + 0.5;
  const centred =
    Math.abs(p.x + p.width / 2 - (ink.x0 + ink.x1) / 2) <= 1 &&
    Math.abs(p.y + p.height / 2 - (ink.y0 + ink.y1) / 2) <= 1;
  const side = Math.min(ink.x1 - ink.x0, ink.y1 - ink.y0);
  return inside && centred && Math.min(p.width, p.height) >= 0.6 * side;
}

describe("a box symbol's checkbox sits on the drawn square, not the character's em box", () => {
  const SIZES = [9, 12, 16, 20];

  it("positive control: the em box (advance x 1 em from the descent) is NOT on the ink, so the predicate can fail", () => {
    const size = 12;
    const adv = t3Advance(size);
    const em: FieldProposal = {
      key: "em",
      page: 1,
      x: 72,
      y: Math.round(700 - 0.2 * size),
      width: Math.round(adv),
      height: size,
      type: "checkbox",
      label: null,
      rule: "box-glyph",
    };
    const ink = {
      x0: 72 + (T3_BOX.ink[0] * size) / 1000,
      y0: 700,
      x1: 72 + (T3_BOX.ink[2] * size) / 1000,
      y1: 700 + (T3_BOX.ink[3] * size) / 1000,
    };
    expect(onInk(em, ink)).toBe(false);
  });

  it("the Type 3 ballot box (U+2610) at 9, 12, 16 and 20 pt", async () => {
    const d = await PDFDocument.create();
    const helv = await d.embedFont(StandardFonts.Helvetica);
    const page = d.addPage([W, H]);
    boxFont(page);
    const inks: Ink[] = [];
    for (const [i, size] of SIZES.entries()) {
      const y = 700 - 40 * i;
      drawBoxes(page, ["empty"], 72, y, size);
      page.drawText("Agree", {
        x: 72 + t3Advance(size) + 4,
        y,
        size,
        font: helv,
        color: rgb(0, 0, 0),
      });
      inks.push({
        x0: 72 + (T3_BOX.ink[0] * size) / 1000,
        y0: y + (T3_BOX.ink[1] * size) / 1000,
        x1: 72 + (T3_BOX.ink[2] * size) / 1000,
        y1: y + (T3_BOX.ink[3] * size) / 1000,
      });
    }
    const found = (await proposalsOf(await d.save())).sort((a, b) => b.y - a.y);
    expect(found).toHaveLength(SIZES.length);
    found.forEach((p, i) =>
      expect(onInk(p, inks[i]!), `${SIZES[i]} pt: ${JSON.stringify(p)}`).toBe(
        true,
      ),
    );
  }, 60_000);

  it("Noto Sans JP's white square (U+25A1) at 9, 12, 16 and 20 pt, its ink read from the font file by fontkit", async () => {
    const font = await openNotoFont(readNotoTtf(fontPack("japanese")));
    const glyph = font.glyphForCodePoint(0x25a1);
    const em = font.unitsPerEm;
    const bb = (
      glyph as unknown as {
        bbox: { minX: number; minY: number; maxX: number; maxY: number };
      }
    ).bbox;
    // Health: a real square, not .notdef or an empty glyph.
    expect(glyph.id).toBeGreaterThan(0);
    expect(bb.maxX - bb.minX).toBeGreaterThan(0.5 * em);
    const d = await PDFDocument.create();
    const page = d.addPage([W, H]);
    const inks: Ink[] = [];
    for (const [i, size] of SIZES.entries()) {
      const y = 700 - 40 * i;
      const s = `${WHITE_SQUARE} Agree`;
      page.drawText(s, {
        x: 72,
        y,
        size,
        font: await embedDrawingFont(d, [s]),
        color: rgb(0, 0, 0),
      });
      inks.push({
        x0: 72 + (bb.minX * size) / em,
        y0: y + (bb.minY * size) / em,
        x1: 72 + (bb.maxX * size) / em,
        y1: y + (bb.maxY * size) / em,
      });
    }
    const found = (await proposalsOf(await d.save())).sort((a, b) => b.y - a.y);
    expect(found).toHaveLength(SIZES.length);
    found.forEach((p, i) =>
      expect(onInk(p, inks[i]!), `${SIZES[i]} pt: ${JSON.stringify(p)}`).toBe(
        true,
      ),
    );
  }, 60_000);
});

/* ------------------------------------------------------------------ *
 *  KNOWN MISS: ZapfDingbats
 * ------------------------------------------------------------------ */

describe("KNOWN MISS: ZapfDingbats box glyphs", () => {
  // Measured 2026-11-19 on pdfjs-dist 6: ZapfDingbats' squares (codes n, o,
  // p, q, r: a black square and four shadowed white ones) come back from
  // getTextContent as the letters "n" to "r", not as box code points. So a
  // form whose boxes are ZapfDingbats characters proposes nothing for them;
  // the brief allows them only when pdf.js's text is a box code point. If a
  // pdf.js upgrade maps them, this turns red and they can be decided.
  it("pdf.js reads ZapfDingbats' squares as plain letters, and nothing is proposed", async () => {
    const d = await PDFDocument.create();
    const zapf = await d.embedFont(StandardFonts.ZapfDingbats);
    const helv = await d.embedFont(StandardFonts.Helvetica);
    const page = d.addPage([W, H]);
    // pdf-lib encodes by Unicode: these are ZapfDingbats codes n, o, p, q, r.
    const squares = [0x25a0, 0x274f, 0x2750, 0x2751, 0x2752];
    for (const [i, cp] of squares.entries()) {
      page.drawText(String.fromCodePoint(cp), {
        x: 72,
        y: 700 - 20 * i,
        size: 12,
        font: zapf,
      });
      page.drawText("Agree", { x: 90, y: 700 - 20 * i, size: 12, font: helv });
    }
    const bytes = await d.save();
    const { glyphs } = await readItems(bytes);
    const read = glyphs
      .filter((t) => t.x < 80)
      .sort((a, b) => b.y - a.y)
      .map((t) => t.str);
    expect(read).toEqual(["n", "o", "p", "q", "r"]);
    expect(await proposalsOf(bytes)).toEqual([]);
  }, 60_000);
});

/* ------------------------------------------------------------------ *
 *  The composed chain for each new rule
 * ------------------------------------------------------------------ */

/** Each widget pdf.js reads back, by name (unturned pages: rect = card). */
async function readWidgets(bytes: Uint8Array) {
  const { doc, task } = await openPdfjs(bytes);
  try {
    const out = new Map<string, number[]>();
    const page = await doc.getPage(1);
    for (const raw of await page.getAnnotations())
      if (raw.subtype === "Widget")
        out.set(String(raw.fieldName), raw.rect as number[]);
    return out;
  } finally {
    await task.destroy();
  }
}

describe("composed chain: detect -> proposal -> card -> Create form -> pdf.js, for each new rule", () => {
  const byId = (id: string) => DETECT_CASES.find((c) => c.id === id)!;

  for (const id of ["P53", "P54", "P55"]) {
    it(`${id}: every text widget lies along the printed dots it was found on`, async () => {
      const c = byId(id);
      const bytes = await c.build();
      const { glyphs } = await readItems(bytes);
      // The printed dots, from the reader's own glyph advances.
      const rows = glyphs.flatMap((t) => {
        const chars = Array.from(t.str);
        const spans = charSpans(t);
        const out: { x0: number; x1: number; y: number }[] = [];
        let i = 0;
        while (i < chars.length) {
          if (chars[i] === "." || chars[i]!.codePointAt(0) === 0x2026) {
            let j = i;
            let last = i;
            while (
              j < chars.length &&
              (chars[j] === "." ||
                chars[j]!.codePointAt(0) === 0x2026 ||
                chars[j] === " ")
            ) {
              if (chars[j] !== " ") last = j;
              j++;
            }
            if (last - i >= 6)
              out.push({ x0: spans[i]![0], x1: spans[last]![1], y: t.y });
            i = j;
          } else i++;
        }
        return out;
      });
      const report = await detectFormFields(bytes, {
        loadReader: legacyPdfjs,
      });
      const proposals = report.pages.flatMap((p) =>
        p.outcome === "found" ? p.proposals : [],
      );
      expect(proposals.length).toBe((c.expect as unknown[]).length);
      const context = await readFormContext(bytes);
      const specs = proposalToDraftFields(proposals, context.existingNames);
      expect(
        validateFormFields(specs, context.pageSizes, context.existingNames),
      ).toEqual([]);
      const widgets = await readWidgets(
        (await createFormFields(bytes, specs)).bytes,
      );
      expect([...widgets.keys()].sort()).toEqual(
        specs.map((s) => s.name).sort(),
      );
      for (const s of specs) {
        expect(s.type).toBe("text");
        const [x0, y0, x1] = widgets.get(s.name)!;
        const row = rows.find(
          (r) => Math.abs(r.y - y0!) <= 3 && x0! < r.x1 && x1! > r.x0,
        );
        expect(row, `no printed dots under ${s.name}`).toBeDefined();
        const cover =
          (Math.min(x1!, row!.x1) - Math.max(x0!, row!.x0)) /
          (row!.x1 - row!.x0);
        expect(cover, s.name).toBeGreaterThanOrEqual(0.9);
        // ...and starts no earlier than the dots (not over the label).
        expect(x0!, s.name).toBeGreaterThanOrEqual(row!.x0 - 0.5);
      }
    }, 60_000);
  }

  for (const id of ["P56", "P57", "P58"]) {
    it(`${id}: every checkbox widget lies inside a printed box symbol's square`, async () => {
      const c = byId(id);
      const bytes = await c.build();
      const report = await detectFormFields(bytes, {
        loadReader: legacyPdfjs,
      });
      const proposals = report.pages.flatMap((p) =>
        p.outcome === "found" ? p.proposals : [],
      );
      const want = c.expect as { box: { x: number; y: number } }[];
      expect(proposals.length).toBe(want.length);
      const context = await readFormContext(bytes);
      const specs = proposalToDraftFields(proposals, context.existingNames);
      expect(
        validateFormFields(specs, context.pageSizes, context.existingNames),
      ).toEqual([]);
      const widgets = await readWidgets(
        (await createFormFields(bytes, specs)).bytes,
      );
      expect(widgets.size).toBe(specs.length);
      // The printed squares: each box symbol's item and advance, as read.
      const { glyphs } = await readItems(bytes);
      const squares = glyphs.flatMap((t) => {
        const spans = charSpans(t);
        return Array.from(t.str).flatMap((ch, i) =>
          EMPTY_BOXES.includes(ch)
            ? [{ x0: spans[i]![0], x1: spans[i]![1], y: t.y, size: t.size }]
            : [],
        );
      });
      expect(squares.length).toBe(want.length);
      for (const s of specs) {
        expect(s.type).toBe("checkbox");
        const [x0, y0, x1, y1] = widgets.get(s.name)!;
        // Inside the advance, standing within the em over the baseline.
        const sq = squares.find(
          (q) =>
            x0! >= q.x0 - 0.5 &&
            x1! <= q.x1 + 0.5 &&
            y0! >= q.y - 0.5 &&
            y1! <= q.y + 0.8 * q.size + 0.5,
        );
        expect(sq, `${s.name} is not on a printed box`).toBeDefined();
      }
    }, 60_000);
  }
});

/* ------------------------------------------------------------------ *
 *  Cost: a same-run ratio, never a wall-clock bound
 * ------------------------------------------------------------------ */

/**
 * The convention of the fix/form-detect-ratios work (PR #384's follow-up):
 * the same work at two sizes k-fold apart, run INTERLEAVED best of 3 after
 * a warm-up, the ratio held under a multiplicative bound, the small side
 * health-checked to take over 1 ms and both sides to classify as expected.
 */
function interleavedBest<T>(
  fns: readonly (() => T)[],
  reps = 3,
): { ms: number; got: T }[] {
  fns[0]!();
  const out = fns.map(() => ({ ms: Infinity, got: undefined as T }));
  for (let k = 0; k < reps; k++)
    fns.forEach((fn, i) => {
      const t0 = performance.now();
      const got = fn();
      const ms = performance.now() - t0;
      out[i] = { ms: Math.min(out[i]!.ms, ms), got };
    });
  return out;
}

function expectRatioUnder(
  name: string,
  num: number,
  den: number,
  bound: number,
): void {
  const said = `${name}: ratio ${(num / den).toFixed(2)} (bound ${bound})`;
  if (process.env.GITHUB_ACTIONS === "true")
    console.log(
      `[time-bound] ${said} ${num.toFixed(1)} ms / ${den.toFixed(1)} ms`,
    );
  expect(den, `${said}: too short to time`).toBeGreaterThan(1);
  expect(num / den, said).toBeLessThan(bound);
}

describe("cost of the new shapes stays linear in the page's rows", () => {
  // `rows` lines, each "Name ...... Date ......" and "[] Yes [] No", 16 pt
  // apart on a tall page. 4x the rows must cost under 8x the time: linear
  // reads ~4. Mutant (2026-11-19): the row-of-dots and box label searches
  // scanning every item on the page instead of their baseline's band read
  // ratios of 13 to 16 (quadratic), red 3 runs of 3.
  const page = (rows: number): CardPage => {
    const text: CardText[] = [];
    for (let i = 0; i < rows; i++) {
      const y = 100 + 16 * i;
      text.push(item(`Name ${".".repeat(16)} Date ${".".repeat(16)}`, 72, y));
      text.push(item(`${BOX} Yes ${BOX} No`, 400, y));
    }
    return pg({ height: 200 + 16 * rows, text });
  };
  const K = 8;
  const SMALL = 1500;

  it("8x the rows cost under 18x the time (same run, interleaved best of 3)", () => {
    const small = page(SMALL);
    const large = page(SMALL * K);
    const [a, b] = interleavedBest([
      () => classifyPage(small),
      () => classifyPage(large),
    ]);
    // Health: both sizes classify as the shapes they are (4 a row, the
    // per-page cap counted, nothing excluded).
    for (const [r, rows] of [
      [a!.got, SMALL],
      [b!.got, SMALL * K],
    ] as const) {
      expect(r.proposals.length + r.counts.capped).toBe(4 * rows);
      expect(r.excluded).toEqual([]);
    }
    expectRatioUnder("S3 shapes", b!.ms, a!.ms, 18);
  });
});
