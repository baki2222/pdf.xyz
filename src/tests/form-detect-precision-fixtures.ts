import { PDFDocument, PDFName, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Box } from "@/lib/pdf/form-detect";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import type { DetectCase, Expect } from "./form-detect-fixtures";

/**
 * TEST ONLY. Slice S3's corpus cases (rows of dots, box symbols), joined
 * onto DETECT_CASES by src/tests/form-detect-fixtures.ts so the corpus run
 * both ways (form-detect.corpus.test.ts) and the real reader
 * (form-detect.pdfjs.test.ts) discover them like every other case.
 *
 * Self-contained on purpose: the main fixtures file imports this one, so
 * this one imports only types from it. Expected boxes are computed from
 * pdf-lib's widths of what each case draws and from numbers typed here
 * (0.15 em under the baseline, 1.2 em tall clamped to 12..22, a 1 pt inset,
 * a box side of 0.75 em), never read back from DETECT.
 *
 * THE BOX FONT. No font in this repository has U+2610, U+2611 or U+2612
 * (fontkit over every .ttf under node_modules, 2026-11-19: Noto Sans and
 * its Bengali, JP, KR and SC faces, Geist, Geist Mono, Liberation Sans and
 * the four script faces; public/ ships no font file in git; only Noto Sans
 * JP/KR/SC and Liberation Sans have U+25A1), and
 * nothing may be downloaded. So those cases draw with a Type 3 font written
 * here: three glyphs, each a stroked square (ink box [75 0 775 700] in
 * 1/1000 em, advance 850) with a tick or a cross in the answered two, and a
 * /ToUnicode CMap that makes pdf.js read them as U+2610, U+2611, U+2612.
 * U+25A1 is drawn with Noto Sans JP, a face pdf.xyz ships, through the
 * product's own font chooser.
 */

const LETTER: [number, number] = [612, 792];

/** The Type 3 box glyphs, in 1/1000 em. */
export const T3_BOX = {
  advance: 850,
  /** [x0, y0, x1, y1] of the ink: the stroke's outer edge. */
  ink: [75, 0, 775, 700] as const,
};
const T3_CODES = { empty: "a", tick: "b", cross: "c" } as const;

/** Register the Type 3 box font on `page` as /Bx. */
export function boxFont(page: PDFPage): void {
  const ctx = page.doc.context;
  const square = "60 w 105 30 640 640 re S";
  const proc = (body: string) =>
    ctx.register(
      ctx.stream(
        `${T3_BOX.advance} 0 ${T3_BOX.ink.join(" ")} d1 ${square} ${body}`,
      ),
    );
  const cmap = [
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def /CMapType 2 def",
    "1 begincodespacerange <00> <FF> endcodespacerange",
    "3 beginbfchar <61> <2610> <62> <2611> <63> <2612> endbfchar",
    "endcmap CMapName currentdict /CMap defineresource pop end end",
  ].join("\n");
  const font = ctx.register(
    ctx.obj({
      Type: "Font",
      Subtype: "Type3",
      FontBBox: [0, 0, 1000, 1000],
      FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
      CharProcs: {
        box: proc(""),
        tick: proc("200 350 m 350 150 l 650 600 l S"),
        cross: proc("200 150 m 650 600 l 200 600 m 650 150 l S"),
      },
      Encoding: {
        Type: "Encoding",
        Differences: [
          97,
          PDFName.of("box"),
          PDFName.of("tick"),
          PDFName.of("cross"),
        ],
      },
      FirstChar: 97,
      LastChar: 99,
      Widths: [T3_BOX.advance, T3_BOX.advance, T3_BOX.advance],
      Resources: {},
      ToUnicode: ctx.register(ctx.stream(cmap)),
    }),
  );
  page.node.setFontDictionary(PDFName.of("Bx"), font);
}

/** Draw Type 3 boxes (`kinds` in order) from (x, y) at `size`. */
export function drawBoxes(
  page: PDFPage,
  kinds: (keyof typeof T3_CODES)[],
  x: number,
  y: number,
  size: number,
): void {
  const codes = kinds.map((k) => T3_CODES[k]).join("");
  const ctx = page.doc.context;
  page.node.addContentStream(
    ctx.register(ctx.stream(`BT /Bx ${size} Tf ${x} ${y} Td (${codes}) Tj ET`)),
  );
}

/** The Type 3 box's advance at `size`, in points. */
export const t3Advance = (size: number) => (T3_BOX.advance / 1000) * size;

/** Draw `s` at (x, y) in `font`, black. */
function draw(
  page: PDFPage,
  font: PDFFont,
  s: string,
  x: number,
  y: number,
  size: number,
) {
  page.drawText(s, { x, y, size, font, color: rgb(0, 0, 0) });
}

const save = (d: PDFDocument) => d.save({ useObjectStreams: false });

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** Edges rounded the way the finder rounds a box. */
function rounded(x0: number, y0: number, x1: number, y1: number): Box {
  const x = Math.round(x0);
  const y = Math.round(y0);
  return { x, y, width: Math.round(x1) - x, height: Math.round(y1) - y };
}

/** The field over a row of dots from x0 to x1 on `baseline`. */
export function leaderBox(
  x0: number,
  x1: number,
  baseline: number,
  size: number,
): Box {
  const bottom = baseline - 0.15 * size;
  return rounded(x0 + 1, bottom, x1 - 1, bottom + clamp(1.2 * size, 12, 22));
}

/** The checkbox over a box symbol drawn at x with advance `adv`. */
export function glyphBox(
  x: number,
  adv: number,
  baseline: number,
  size: number,
): Box {
  const inner = Math.min(adv, 0.75 * size) - 2;
  const x0 = x + adv / 2 - inner / 2;
  return rounded(x0, baseline + 1, x0 + inner, baseline + 1 + inner);
}

/** `n` full stops. */
export const dots = (n: number) => ".".repeat(n);
/** A white square (U+25A1), drawn with Noto Sans JP. */
export const WHITE_SQUARE = String.fromCodePoint(0x25a1);
/** An ellipsis (U+2026). */
export const ELLIPSIS = String.fromCodePoint(0x2026);

/**
 * Fonts for one document: Helvetica and Times, from the product's font
 * chooser (WinAnsi text gets the standard face itself), measured as drawn.
 */
async function faces(d: PDFDocument) {
  return {
    sans: await embedDrawingFont(d, ["Name"], "sans"),
    serif: await embedDrawingFont(d, ["Name"], "serif"),
  };
}

/** `s` followed by full stops up to `gap` pt before `end` (font at size). */
function leadered(
  font: PDFFont,
  s: string,
  x: number,
  end: number,
  size: number,
  gap = 4,
): string {
  let out = `${s} `;
  while (x + font.widthOfTextAtSize(`${out}.`, size) <= end - gap) out += ".";
  return out;
}

/* ------------------------------------------------------------------ *
 *  Geometry the expectations are computed from, measured once
 * ------------------------------------------------------------------ */

const metrics = await (async () => {
  const d = await PDFDocument.create();
  const f = await faces(d);
  const jp = await embedDrawingFont(d, [`${WHITE_SQUARE} Male`]);
  return { ...f, jp };
})();
const w = (font: PDFFont, s: string, size: number) =>
  font.widthOfTextAtSize(s, size);

const P53 = {
  name: `Name ${dots(30)}`,
  emailLabel: "Email:",
  emailDots: dots(30),
  emailX: 72 + w(metrics.sans, "Email:", 12) + 6,
};
const P54 = `Name ${dots(16)} Date ${dots(16)}`;
const P55 = {
  address: `Address ${". ".repeat(15)}.`,
  phone: `Phone ${ELLIPSIS.repeat(8)}`,
};
const P56 = {
  yesX: 72 + w(metrics.sans, "Yes", 12) + 4,
  noLabelX: 0,
};
P56.noLabelX = P56.yesX + t3Advance(12) + 12;
const P56_NO_BOX = P56.noLabelX + w(metrics.sans, "No", 12) + 4;
const P57 = `${WHITE_SQUARE} Male ${WHITE_SQUARE} Female`;
const P58 = ["Passport", "Birth certificate", "Utility bill", "Bank statement"];
const P59 = [
  "I confirm that the information I have given on this form is true and complete.",
  "I agree that my details may be shared with my employer for this purpose only.",
];
const N52 = [
  ["Introduction", "1"],
  ["Getting started", "12"],
  ["Appendix", "147"],
] as const;
const N53 = [
  ["Coffee", "$3.00"],
  ["Tea", "$2.50"],
] as const;
const N55 = [
  "The applicant must provide proof of address dated within the last three months.",
  "Each page of the form must be signed in black ink by the person it describes.",
  "Copies are accepted only when a solicitor or a notary has certified each one.",
  "Forms that arrive incomplete are returned to the sender without being read.",
].map((s) => `${WHITE_SQUARE} ${s}`);
const N57_X = 72 + w(metrics.sans, "Account no.", 12) + 6;

const leader = (label: string, x0: number, x1: number, y: number): Expect => ({
  rule: "dot-leader",
  type: "text",
  label,
  page: 1,
  box: leaderBox(x0, x1, y, 12),
});
const boxAt = (
  label: string,
  x: number,
  adv: number,
  y: number,
  size = 12,
): Expect => ({
  rule: "box-glyph",
  type: "checkbox",
  label,
  page: 1,
  box: glyphBox(x, adv, y, size),
});

/**
 * Where P53-P55 print their rows of dots (the first dot's left edge to the
 * last's advance end, on the baseline), from pdf-lib's per-character
 * widths of what each case draws: never from the reader, so the composed
 * chain test in form-detect-precision.test.ts can see a wrong advance
 * (review round 1 of slice S3, finding 10: its truth was once the reader's
 * own glyph advances, which a wrong advance moved with it).
 */
export const PRINTED_DOTS: Record<
  "P53" | "P54" | "P55",
  { x0: number; x1: number; y: number }[]
> = (() => {
  // Each character's own width: drawText applies no kerning.
  const at = (font: PDFFont, s: string) =>
    Array.from(s).reduce((sum, ch) => sum + w(font, ch, 12), 0);
  const row = (
    font: PDFFont,
    x: number,
    before: string,
    s: string,
    y: number,
  ) => ({
    x0: x + at(font, before),
    x1: x + at(font, s),
    y,
  });
  const first = `Name ${dots(16)}`;
  return {
    P53: [
      row(metrics.sans, 72, "Name ", P53.name, 700),
      row(metrics.sans, P53.emailX, "", P53.emailDots, 670),
    ],
    P54: [
      row(metrics.sans, 72, "Name ", first, 700),
      row(metrics.sans, 72, `${first} Date `, P54, 700),
    ],
    P55: [
      row(metrics.serif, 72, "Address ", P55.address, 700),
      row(metrics.serif, 72, "Phone ", P55.phone, 670),
    ],
  };
})();

export const PRECISION_CASES: readonly DetectCase[] = [
  {
    id: "P53",
    kind: "positive",
    note: 'rows of dots after a label: "Name ..." in one text item, and "Email:" with its dots drawn separately: a text field over each row of dots',
    build: async () => {
      const d = await PDFDocument.create();
      const f = await faces(d);
      const page = d.addPage(LETTER);
      draw(page, f.sans, P53.name, 72, 700, 12);
      draw(page, f.sans, P53.emailLabel, 72, 670, 12);
      draw(page, f.sans, P53.emailDots, P53.emailX, 670, 12);
      return save(d);
    },
    expect: [
      leader(
        "Name",
        72 + w(metrics.sans, "Name ", 12),
        72 + w(metrics.sans, P53.name, 12),
        700,
      ),
      leader(
        "Email",
        P53.emailX,
        P53.emailX + w(metrics.sans, P53.emailDots, 12),
        670,
      ),
    ],
  },
  {
    id: "P54",
    kind: "positive",
    note: '"Name ........ Date ........" on one line: two blanks, the second labelled by the word between them (it is followed by dots, so it is no entry the first leads to)',
    build: async () => {
      const d = await PDFDocument.create();
      const f = await faces(d);
      draw(d.addPage(LETTER), f.sans, P54, 72, 700, 12);
      return save(d);
    },
    expect: (() => {
      const first = `Name ${dots(16)}`;
      const second = `${first} Date `;
      return [
        leader(
          "Name",
          72 + w(metrics.sans, "Name ", 12),
          72 + w(metrics.sans, first, 12),
          700,
        ),
        leader(
          "Date",
          72 + w(metrics.sans, second, 12),
          72 + w(metrics.sans, P54, 12),
          700,
        ),
      ];
    })(),
  },
  {
    id: "P55",
    kind: "positive",
    note: 'spaced dots ("Address . . . . .") and ellipses ("Phone ........"), in Times: each a row of dots after a label',
    build: async () => {
      const d = await PDFDocument.create();
      const f = await faces(d);
      const page = d.addPage(LETTER);
      draw(page, f.serif, P55.address, 72, 700, 12);
      draw(page, f.serif, P55.phone, 72, 670, 12);
      return save(d);
    },
    expect: [
      leader(
        "Address",
        72 + w(metrics.serif, "Address ", 12),
        72 + w(metrics.serif, P55.address, 12),
        700,
      ),
      leader(
        "Phone",
        72 + w(metrics.serif, "Phone ", 12),
        72 + w(metrics.serif, P55.phone, 12),
        670,
      ),
    ],
  },
  {
    id: "P56",
    kind: "positive",
    note: 'box symbols (U+2610, a Type 3 font) with their labels drawn beside them: two stacked with the label to the right, and an inline "Yes [] No []" with the labels to the left',
    build: async () => {
      const d = await PDFDocument.create();
      const f = await faces(d);
      const page = d.addPage(LETTER);
      boxFont(page);
      drawBoxes(page, ["empty"], 72, 700, 12);
      draw(page, f.sans, "Yes", 72 + t3Advance(12) + 4, 700, 12);
      drawBoxes(page, ["empty"], 72, 680, 12);
      draw(page, f.sans, "No", 72 + t3Advance(12) + 4, 680, 12);
      draw(page, f.sans, "Yes", 72, 650, 12);
      drawBoxes(page, ["empty"], P56.yesX, 650, 12);
      draw(page, f.sans, "No", P56.noLabelX, 650, 12);
      drawBoxes(page, ["empty"], P56_NO_BOX, 650, 12);
      return save(d);
    },
    expect: [
      boxAt("Yes", 72, t3Advance(12), 700),
      boxAt("No", 72, t3Advance(12), 680),
      boxAt("Yes", P56.yesX, t3Advance(12), 650),
      boxAt("No", P56_NO_BOX, t3Advance(12), 650),
    ],
  },
  {
    id: "P57",
    kind: "positive",
    note: "\"[] Male [] Female\" (U+25A1) in ONE text item, in Noto Sans JP through the product's font chooser: each box placed from the glyphs' own advances, labelled by the word after it",
    build: async () => {
      const d = await PDFDocument.create();
      const page = d.addPage(LETTER);
      draw(page, await embedDrawingFont(d, [P57]), P57, 72, 700, 12);
      return save(d);
    },
    expect: [
      boxAt("Male", 72, w(metrics.jp, WHITE_SQUARE, 12), 700),
      boxAt(
        "Female",
        72 + w(metrics.jp, `${WHITE_SQUARE} Male `, 12),
        w(metrics.jp, WHITE_SQUARE, 12),
        700,
      ),
    ],
  },
  {
    id: "P58",
    kind: "positive",
    note: "a checklist of box symbols each opening its line before a short item (Passport, Birth certificate, ...): a checkbox each, not a bulleted list",
    build: async () => {
      const d = await PDFDocument.create();
      const f = await faces(d);
      const page = d.addPage(LETTER);
      boxFont(page);
      for (const [i, s] of P58.entries()) {
        drawBoxes(page, ["empty"], 72, 700 - 20 * i, 12);
        draw(page, f.sans, s, 72 + t3Advance(12) + 4, 700 - 20 * i, 12);
      }
      return save(d);
    },
    expect: P58.map((s, i) => boxAt(s, 72, t3Advance(12), 700 - 20 * i)),
  },
  {
    id: "P59",
    kind: "positive",
    note: "two consent sentences, each after a box symbol opening its line: fewer than a bulleted list's three, so a checkbox each",
    build: async () => {
      const d = await PDFDocument.create();
      const f = await faces(d);
      const page = d.addPage(LETTER);
      boxFont(page);
      for (const [i, s] of P59.entries()) {
        drawBoxes(page, ["empty"], 72, 700 - 24 * i, 11);
        draw(page, f.sans, s, 72 + t3Advance(11) + 4, 700 - 24 * i, 11);
      }
      return save(d);
    },
    expect: P59.map((s, i) =>
      boxAt(s.slice(0, -1), 72, t3Advance(11), 700 - 24 * i, 11),
    ),
  },

  // ---------------------------------------------------------- negatives
  {
    id: "N52",
    kind: "negative",
    note: 'a table of contents ("Introduction ........ 1", page numbers set right-aligned as their own text): the dots lead to an entry, no field',
    build: async () => {
      const d = await PDFDocument.create();
      const f = await faces(d);
      const page = d.addPage(LETTER);
      for (const [i, [title, n]] of N52.entries()) {
        const y = 700 - 20 * i;
        draw(page, f.sans, leadered(f.sans, title, 72, 520, 11), 72, y, 11);
        draw(page, f.sans, n, 540 - w(f.sans, n, 11), y, 11);
      }
      return save(d);
    },
    expect: "none",
    decidedBy: "toc-leader",
    at: { page: 1, x: 300, y: 703 },
  },
  {
    id: "N53",
    kind: "negative",
    note: 'a price list ("Coffee ........ $3.00", one text item a line): the dots lead to a price, no field',
    build: async () => {
      const d = await PDFDocument.create();
      const f = await faces(d);
      const page = d.addPage(LETTER);
      for (const [i, [item, price]] of N53.entries()) {
        const s = `${leadered(f.sans, item, 72, 400, 12)} ${price}`;
        draw(page, f.sans, s, 72, 700 - 20 * i, 12);
      }
      return save(d);
    },
    expect: "none",
    decidedBy: "toc-leader",
    at: { page: 1, x: 250, y: 703 },
  },
  {
    id: "N54",
    kind: "negative",
    note: "a row of dots with no label on its line: no field",
    build: async () => {
      const d = await PDFDocument.create();
      const f = await faces(d);
      draw(d.addPage(LETTER), f.sans, dots(40), 72, 700, 12);
      return save(d);
    },
    expect: "none",
    decidedBy: "unlabelled",
    at: { page: 1, x: 120, y: 703 },
  },
  {
    id: "N55",
    kind: "negative",
    note: "a bulleted list drawn with box symbols (U+25A1, Noto Sans JP): four boxes opening their lines, each before a long sentence: no checkboxes",
    build: async () => {
      const d = await PDFDocument.create();
      const page = d.addPage(LETTER);
      for (const [i, s] of N55.entries())
        draw(page, await embedDrawingFont(d, [s]), s, 72, 700 - 18 * i, 11);
      return save(d);
    },
    expect: "none",
    decidedBy: "bullet",
    at: { page: 1, x: 76, y: 704 },
  },
  {
    id: "N56",
    kind: "negative",
    note: "boxes already answered: a ticked box (U+2611) before Yes and a crossed one (U+2612) before No: no checkboxes",
    build: async () => {
      const d = await PDFDocument.create();
      const f = await faces(d);
      const page = d.addPage(LETTER);
      boxFont(page);
      drawBoxes(page, ["tick"], 72, 700, 12);
      draw(page, f.sans, "Yes", 72 + t3Advance(12) + 4, 700, 12);
      drawBoxes(page, ["cross"], 72, 680, 12);
      draw(page, f.sans, "No", 72 + t3Advance(12) + 4, 680, 12);
      return save(d);
    },
    expect: "none",
    decidedBy: "ticked-box",
    at: { page: 1, x: 77, y: 704 },
  },
  {
    id: "N57",
    kind: "negative",
    note: '"Account no." and eight box symbols typed next to each other, one character each: a comb, never eight checkboxes',
    build: async () => {
      const d = await PDFDocument.create();
      const f = await faces(d);
      const page = d.addPage(LETTER);
      boxFont(page);
      draw(page, f.sans, "Account no.", 72, 700, 12);
      drawBoxes(page, Array(8).fill("empty"), N57_X, 700, 12);
      return save(d);
    },
    expect: "none",
    decidedBy: "comb",
    at: { page: 1, x: N57_X + t3Advance(12) / 2, y: 704 },
  },
];
