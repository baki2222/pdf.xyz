// @vitest-environment node
// @native-canvas
/**
 * Every style the .docx claims for a word is that word's style in the PDF —
 * checked against the GROUND TRUTH the test drew, character by character,
 * through the whole engine on production's deps (poppler stood in for), read
 * back by `./docx-structure`.
 *
 * Added 2026-11-15 from the branch's own review (round 1), which found four
 * shapes where the matcher claimed a style the word is not drawn in, and
 * counted nothing:
 *  - a word whose colour changes partway through (`print` blue, `(x)` black
 *    → `print(x)` all blue): the run covering more of it won;
 *  - a word drawn OVER another line (`OVER`, bold green, on `under words
 *    here`): the wider underlying run won the tie;
 *  - invisible OCR words under a turned one-style watermark: the line's
 *    axis-aligned box covered most of the page, and every word inside it
 *    took the watermark's bold red 60 pt;
 *  - a page mixing OCR text with a visible Bates stamp was never named.
 *
 * The rule each case holds: a word carries a style only when every one of
 * its characters is drawn in it; a word that cannot be placed so is written
 * plain, COUNTED (`unmatchedWords`), and its page NAMED
 * (`pagesWithoutFormatting`).
 */
import {
  beginText,
  degrees,
  endText,
  moveText,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFontAndSize,
  setTextRenderingMode,
  showText,
  StandardFonts,
  TextRenderingMode,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import { corpusDeps } from "@/tests/docx-word-corpus";
import { flowStandIn } from "@/tests/poppler-flow-standin";
import { flowPageText } from "../pdf-text/flow";
import {
  docxPageTexts,
  docxStructureProblems,
  readDocxStructure,
} from "./docx-structure";
import { PDF_TO_WORD_TOOL, runPdfOfficeExport } from "./engine";

interface Truth {
  b: boolean;
  i: boolean;
  sz: number;
  color: string;
}
type Seg = [text: string, font: "R" | "B" | "I", size: number, color?: string];
interface Line {
  y: number;
  x?: number;
  segs: Seg[];
}

const hex = (c: string) =>
  rgb(
    parseInt(c.slice(0, 2), 16) / 255,
    parseInt(c.slice(2, 4), 16) / 255,
    parseInt(c.slice(4, 6), 16) / 255,
  );

/** Draws the lines; returns each drawn word's per-character truth. */
function draw(
  page: PDFPage,
  fonts: Record<"R" | "B" | "I", PDFFont>,
  lines: Line[],
  truth: Map<string, Truth[]>,
) {
  for (const line of lines) {
    let x = line.x ?? 72;
    const chars: { ch: string; s: Truth }[] = [];
    const segParts = new Map<string, Truth[]>();
    for (const [text, f, size, color = "000000"] of line.segs) {
      page.drawText(text, {
        x,
        y: line.y,
        size,
        font: fonts[f],
        color: hex(color),
      });
      x += fonts[f].widthOfTextAtSize(text, size);
      const s = { b: f === "B", i: f === "I", sz: Math.round(size * 2), color };
      for (const ch of text) chars.push({ ch, s });
      // poppler starts a new word where the font changes, so a word drawn in
      // two fonts ("Note" + "s") reaches the .docx as two: each part's truth
      // is its own segment's.
      for (const part of text.split(" ").filter(Boolean))
        segParts.set(
          part,
          [...part].map(() => s),
        );
    }
    let word: typeof chars = [];
    const flush = () => {
      if (word.length)
        truth.set(
          word.map((w) => w.ch).join(""),
          word.map((w) => w.s),
        );
      word = [];
    };
    for (const c of chars) {
      if (c.ch === " ") flush();
      else word.push(c);
    }
    flush();
    for (const [part, s] of segParts) if (!truth.has(part)) truth.set(part, s);
  }
}

async function fontsOf(doc: PDFDocument) {
  return {
    R: await doc.embedFont(StandardFonts.Helvetica),
    B: await doc.embedFont(StandardFonts.HelveticaBold),
    I: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
}

/** Invisible (render mode 3) text: an OCR layer. Truth: no style. */
function invisible(
  page: PDFPage,
  font: PDFFont,
  x: number,
  y: number,
  text: string,
  truth: Map<string, Truth[]>,
) {
  const key = page.node.newFontDictionary(font.name, font.ref);
  // In its own graphics state: the text render mode is graphics state, and
  // would otherwise make everything drawn after it invisible too.
  page.pushOperators(
    pushGraphicsState(),
    beginText(),
    setFontAndSize(key, 11),
    setTextRenderingMode(TextRenderingMode.Invisible),
    moveText(x, y),
    showText(font.encodeText(text)),
    endText(),
    popGraphicsState(),
  );
  for (const w of text.split(" ")) truth.set(w, []);
}

interface Verdict {
  /** Characters whose claimed style is not their drawn one. */
  wrong: string[];
  /** Words written with no formatting at all. */
  plain: string[];
  /** Words written with formatting. */
  styled: string[];
  unmatched: number;
  named: number[];
}

/**
 * The engine's .docx, read back and compared with the truth one character
 * at a time. A word written plain (no rPr) claims nothing and is not wrong —
 * but it must be counted.
 */
async function judge(
  pdf: Uint8Array,
  truth: Map<string, Truth[]>,
): Promise<Verdict> {
  const run = await runPdfOfficeExport(PDF_TO_WORD_TOOL, pdf, corpusDeps());
  if (!run.ok) throw new Error(`${run.kind}: ${run.message}`);
  const body = await readDocxStructure(run.output);
  // Text conservation and structure, on every case.
  expect(docxPageTexts(body)).toEqual(
    (await flowStandIn(pdf)).pages.map(flowPageText),
  );
  expect(await docxStructureProblems(run.output)).toEqual([]);
  const wrong: string[] = [];
  const plain: string[] = [];
  const styled: string[] = [];
  for (const b of body.blocks) {
    if (b.kind !== "p") continue;
    const chars: { ch: string; r: (typeof b.runs)[number] }[] = [];
    for (const r of b.runs) for (const ch of r.text) chars.push({ ch, r });
    let w: typeof chars = [];
    const flush = () => {
      if (!w.length) return;
      const text = w.map((c) => c.ch).join("");
      const t = truth.get(text);
      const bare = (r: (typeof w)[number]["r"]) =>
        !r.b && !r.i && r.sz === undefined && !r.color;
      if (w.every((c) => bare(c.r))) plain.push(text);
      else styled.push(text);
      if (!t) wrong.push(`unknown word ${text}`);
      else
        w.forEach((c, k) => {
          if (bare(c.r)) return;
          const s = t[k];
          const claim = {
            b: c.r.b === true,
            i: c.r.i === true,
            sz: c.r.sz,
            color: c.r.color ?? "000000",
          };
          if (
            !s ||
            claim.b !== s.b ||
            claim.i !== s.i ||
            claim.sz !== s.sz ||
            claim.color !== s.color
          )
            wrong.push(
              `${text}[${k}] '${c.ch}' claims ${JSON.stringify(claim)}, drawn ${JSON.stringify(s ?? "invisibly")}`,
            );
        });
      w = [];
    };
    for (const c of chars) {
      if (/\s/.test(c.ch)) flush();
      else w.push(c);
    }
    flush();
  }
  return {
    wrong,
    plain,
    styled,
    unmatched: run.coverage.unmatchedWords ?? -1,
    named: run.coverage.pagesWithoutFormatting ?? [],
  };
}

async function onePage(lines: Line[]) {
  const doc = await PDFDocument.create();
  const fonts = await fontsOf(doc);
  const truth = new Map<string, Truth[]>();
  draw(doc.addPage([612, 792]), fonts, lines, truth);
  return { pdf: await doc.save(), truth };
}

/** Each case: the lines drawn, and the words that MUST come out styled. */
const CASES: Record<string, { lines: Line[]; styled: string[] }> = {
  codeListing: {
    lines: [
      {
        y: 700,
        segs: [
          ["print", "R", 10, "0000FF"],
          ["(x)", "R", 10],
          [" return", "R", 10, "AA00AA"],
          [" val", "R", 10],
        ],
      },
    ],
    styled: ["return", "val"],
  },
  midWordColour: {
    lines: [
      {
        y: 700,
        segs: [
          ["eps ", "R", 12],
          ["REDPA", "R", 12, "FF0000"],
          ["rt zeta", "R", 12],
        ],
      },
    ],
    styled: ["eps", "zeta"],
  },
  overlapDraw: {
    lines: [
      { y: 700, segs: [["under words here", "R", 12]] },
      { y: 700, x: 80, segs: [["OVER", "B", 12, "00AA00"]] },
    ],
    styled: [],
  },
  midWordBoldPrefix: {
    lines: [
      {
        y: 700,
        segs: [
          ["alpha ", "R", 12],
          ["Note", "B", 12],
          ["s beta", "R", 12],
        ],
      },
    ],
    styled: ["alpha", "beta"],
  },
  tightLeading: {
    lines: [
      { y: 700, segs: [["AAone BBone CCone", "B", 12]] },
      { y: 692, segs: [["ddtwo eetwo fftwo", "R", 12]] },
      { y: 684, segs: [["ggthree hhthree", "I", 12, "0000FF"]] },
    ],
    styled: ["AAone", "BBone", "CCone", "ddtwo", "ggthree", "hhthree"],
  },
  closeColumns: {
    lines: [
      { y: 700, segs: [["leftcol lwords", "B", 10]] },
      { y: 700, x: 72 + 75, segs: [["rightcol rwords", "R", 10]] },
    ],
    styled: ["leftcol", "lwords", "rightcol", "rwords"],
  },
  scrambled: {
    lines: [
      { y: 700, x: 200, segs: [["wthree", "I", 12]] },
      { y: 700, x: 72, segs: [["wone", "B", 12]] },
      { y: 700, x: 130, segs: [["wtwo", "R", 12, "FF0000"]] },
      { y: 700, x: 260, segs: [["wfour", "R", 12]] },
    ],
    styled: ["wone", "wtwo", "wthree", "wfour"],
  },
  bigHeadingSameBaseline: {
    lines: [
      {
        y: 700,
        segs: [
          ["HEAD ", "B", 48],
          ["tiny small words", "R", 8],
        ],
      },
    ],
    styled: ["HEAD", "tiny", "small", "words"],
  },
};

describe("no word claims a style it is not drawn in, through the engine", () => {
  for (const [name, { lines, styled }] of Object.entries(CASES))
    it(
      name,
      async () => {
        const { pdf, truth } = await onePage(lines);
        const v = await judge(pdf, truth);
        expect(v.wrong, name).toEqual([]);
        // Positive control: the words that can be placed ARE placed.
        for (const w of styled) expect(v.styled, `${name}: ${w}`).toContain(w);
        // Every word written plain is counted, and its page named.
        expect(v.unmatched, name).toBe(v.plain.length);
        expect(v.named, name).toEqual(v.plain.length > 0 ? [1] : []);
      },
      60_000,
    );

  it("invisible OCR words under a turned one-style watermark are plain, counted, and the page named", async () => {
    const doc = await PDFDocument.create();
    const fonts = await fontsOf(doc);
    const page = doc.addPage([612, 792]);
    const truth = new Map<string, Truth[]>();
    draw(
      page,
      fonts,
      [{ y: 740, segs: [["visible plain heading", "R", 12]] }],
      truth,
    );
    page.drawText("CONFIDENTIAL", {
      x: 120,
      y: 200,
      size: 60,
      font: fonts.B,
      color: rgb(1, 0, 0),
      rotate: degrees(45),
    });
    truth.set(
      "CONFIDENTIAL",
      [..."CONFIDENTIAL"].map(() => ({
        b: true,
        i: false,
        sz: 120,
        color: "FF0000",
      })),
    );
    invisible(
      page,
      fonts.R,
      200,
      400,
      "hiddenone hiddentwo hiddenthree",
      truth,
    );
    const v = await judge(await doc.save(), truth);
    expect(v.wrong).toEqual([]);
    for (const w of ["hiddenone", "hiddentwo", "hiddenthree"])
      expect(v.plain).toContain(w);
    expect(v.styled).toEqual(
      expect.arrayContaining(["visible", "plain", "heading"]),
    );
    expect(v.unmatched).toBe(v.plain.length);
    expect(v.named).toEqual([1]);
  }, 60_000);

  it("a page mixing OCR text with a visible stamp is named; a visible-only page is not", async () => {
    const doc = await PDFDocument.create();
    const fonts = await fontsOf(doc);
    const truth = new Map<string, Truth[]>();
    const p1 = doc.addPage([612, 792]);
    draw(p1, fonts, [{ y: 700, segs: [["Typed only page", "R", 12]] }], truth);
    const p2 = doc.addPage([612, 792]);
    invisible(p2, fonts.R, 72, 700, "Recognised first line", truth);
    draw(p2, fonts, [{ y: 60, segs: [["BATES 000123", "B", 10]] }], truth);
    const v = await judge(await doc.save(), truth);
    expect(v.wrong).toEqual([]);
    expect(v.styled).toEqual(expect.arrayContaining(["BATES", "Typed"]));
    expect(v.plain).toEqual(["Recognised", "first", "line"]);
    expect(v.unmatched).toBe(3);
    expect(v.named).toEqual([2]);
  }, 60_000);
});
