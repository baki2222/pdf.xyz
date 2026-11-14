// @vitest-environment node
// @native-canvas
/**
 * `./docx-run-style`: poppler's words labelled with the page reader's runs.
 *
 *  - CONTROLS on hand-built pages, one per rule in the module's docblock;
 *  - REAL POPPLER: every captured poppler 25.07 page whose generator is
 *    named in its docblock (`poppler-samples.ts`, discovered), paired with
 *    the page reader's scan of the same generated PDF — the frames of the
 *    two readers must agree for the match to land, and the stand-in used on
 *    this Windows host cannot show that;
 *  - THE CORPUS: every generated Word fixture (`@/tests/docx-word-corpus`),
 *    for the fallback rate and for text conservation against a styling-off
 *    writer.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as officeFixtures from "@/tests/pdf-office-fixtures";
import * as pictureFixtures from "@/tests/docx-picture-fixtures";
import * as tableFixtures from "@/tests/table-extract-fixtures";
import * as popplerSamples from "@/tests/poppler-samples";
import { flowStandIn } from "@/tests/poppler-flow-standin";
import { corpusDeps, wordCorpusGenerators } from "@/tests/docx-word-corpus";
import {
  flowText,
  type FlowPiece,
  type PdfFlowTextPage,
} from "../pdf-text/flow";
import { parseBboxFlow } from "../pdf-text/parse";
import type { DocxDocument } from "./docx-layout";
import { docxPackage } from "./docx-package";
import {
  MAX_STYLED_PIECES_PER_PAGE,
  runStylesOf,
  styleOfRun,
  type DocxRunStyle,
} from "./docx-run-style";
import { docxPageTexts, readDocxStructure } from "./docx-structure";
import { PDF_TO_WORD_TOOL, runPdfOfficeExport } from "./engine";
import {
  scanPdfPages,
  type ScannedPage,
  type ScannedRun,
  type ScannedTextLine,
} from "./page-scan";

/* ------------------------------------------------------------------ *
 *  Hand-built pages
 * ------------------------------------------------------------------ */

const RUN: ScannedRun = {
  text: "",
  family: "Helvetica",
  fontClass: "sans",
  bold: false,
  italic: false,
  size: 12,
  color: "000000",
  alpha: 1,
  invisible: false,
  spacing: 0,
};

/** A line at (x, y), 12 pt high, of runs laid end to end with their widths. */
function line(
  x: number,
  y: number,
  runs: [string, number, Partial<ScannedRun>?][],
  extra: Partial<ScannedTextLine> = {},
): ScannedTextLine {
  let at = 0;
  const built = runs.map(([text, width, props]) => {
    const run = { ...RUN, ...props, text, offset: at, extent: width };
    at += width;
    return run;
  });
  return {
    kind: "text",
    x,
    y,
    width: at,
    height: 12,
    rotation: 0,
    flipH: false,
    flipV: false,
    baseline: 10,
    runs: built,
    ...extra,
  };
}

function scanned(
  items: ScannedTextLine[],
  extra: Partial<ScannedPage> = {},
): ScannedPage {
  return {
    pageNumber: 1,
    width: 612,
    height: 792,
    items,
    picturesTooLarge: 0,
    picturesUndecoded: 0,
    picturesUnverified: false,
    flattened: false,
    ...extra,
  };
}

/** One paragraph of one cell, its words at the given x ranges on one line. */
function page(
  words: [string, number, number][],
  y = 100,
  h = 12,
): PdfFlowTextPage {
  const pieces: FlowPiece[] = words.map(([text, x0, x1], k) => ({
    text: k === 0 ? text : ` ${text}`,
    box: [x0, y, x1, y + h] as const,
  }));
  return {
    pageNumber: 1,
    paragraphs: [[pieces.map((p) => p.text).join("")]],
    pieces: [[pieces]],
  };
}

const flat = (styles: (DocxRunStyle | null)[][][]) => styles.flat(2);

describe("runStylesOf — the controls", () => {
  it("a bold word in the middle of a line is bold, and only it", () => {
    const p = page([
      ["Regular", 72, 115],
      ["bold", 122, 147],
      ["end", 150, 167],
    ]);
    const s = scanned([
      line(72, 100, [
        ["Regular ", 50],
        ["bold", 26, { bold: true }],
        [" end", 22],
      ]),
    ]);
    const got = runStylesOf(p, s);
    expect(flat(got.styles).map((x) => x?.bold === true)).toEqual([
      false,
      true,
      false,
    ]);
    expect(got).toMatchObject({ matched: 3, total: 3, capped: false });
  });

  it("a size and a colour are picked up; black and a faint colour are not a colour", () => {
    const p = page([
      ["BIG", 72, 110],
      ["RED", 115, 140],
      ["faint", 145, 170],
      ["black", 175, 200],
    ]);
    const s = scanned([
      line(72, 100, [
        ["BIG ", 42, { size: 18 }],
        ["RED ", 28, { color: "ff0000" }],
        ["faint ", 30, { color: "00FF00", alpha: 0.3 }],
        ["black", 26],
      ]),
    ]);
    const [big, red, faint, black] = flat(runStylesOf(p, s).styles);
    expect(big).toEqual({ halfPoints: 36 });
    expect(red).toEqual({ halfPoints: 24, color: "FF0000" });
    expect(faint).toEqual({ halfPoints: 24 });
    expect(black).toEqual({ halfPoints: 24 });
  });

  it("a size is rounded to half-points and held to Word's range", () => {
    expect(styleOfRun({ ...RUN, size: 10.26 }).halfPoints).toBe(21);
    expect(styleOfRun({ ...RUN, size: 0.2 }).halfPoints).toBe(2);
    expect(styleOfRun({ ...RUN, size: 5000 }).halfPoints).toBe(3276);
  });

  it("a turned line is matched as a whole: its one style, or nothing when its runs differ", () => {
    // A 100 × 12 line turned 90° about its centre (122, 106) stands from
    // y = 56 to 156, x = 116 to 128.
    const p = page([["turned", 118, 126]], 90, 20);
    const uniform = scanned([
      line(72, 100, [["turned", 100, { bold: true }]], { rotation: 90 }),
    ]);
    expect(flat(runStylesOf(p, uniform).styles)).toEqual([
      { bold: true, halfPoints: 24 },
    ]);
    const mixed = scanned([
      line(
        72,
        100,
        [
          ["half ", 50, { bold: true }],
          ["half", 50],
        ],
        { rotation: 90 },
      ),
    ]);
    expect(flat(runStylesOf(p, mixed).styles)).toEqual([null]);
  });

  it("a right-to-left line with mixed runs is not split word by word", () => {
    const p = page([
      ["مرحبا", 72, 110],
      ["بالعالم", 115, 160],
    ]);
    const s = scanned([
      line(72, 100, [
        ["مرحبا ", 43, { bold: true }],
        ["بالعالم", 45],
      ]),
    ]);
    expect(flat(runStylesOf(p, s).styles)).toEqual([null, null]);
    // The same line, one style: the line's style for every word.
    const uniform = scanned([
      line(72, 100, [
        ["مرحبا ", 43, { bold: true }],
        ["بالعالم", 45, { bold: true }],
      ]),
    ]);
    expect(
      flat(runStylesOf(p, uniform).styles).every((x) => x?.bold === true),
    ).toBe(true);
  });

  it("an invisible run (an OCR layer) labels nothing", () => {
    const p = page([["hidden", 72, 110]]);
    const s = scanned([
      line(72, 100, [["hidden", 40, { invisible: true, bold: true }]]),
    ]);
    expect(runStylesOf(p, s)).toMatchObject({ matched: 0, total: 1 });
    expect(flat(runStylesOf(p, s).styles)).toEqual([null]);
  });

  it("a word no run covers by half its width is plain, never a neighbour's style", () => {
    const p = page([["edge", 72, 112]]);
    const s = scanned([line(100, 100, [["e", 30, { bold: true }]])]);
    expect(flat(runStylesOf(p, s).styles)).toEqual([null]);
    // And a run on the line above, in a bucket beside, does not reach down.
    const above = scanned([line(72, 88, [["edge", 40, { bold: true }]])]);
    expect(flat(runStylesOf(p, above).styles)).toEqual([null]);
  });

  it("a page whose text the reader did not read is all plain, and counted", () => {
    const p = page([["word", 72, 110]]);
    const s = scanned([line(72, 100, [["word", 40, { bold: true }]])], {
      textUnread: true,
    });
    expect(runStylesOf(p, s)).toEqual({
      styles: [[[null]]],
      matched: 0,
      total: 1,
      capped: false,
    });
    expect(runStylesOf(p, undefined)).toMatchObject({ matched: 0, total: 1 });
  });

  it("a page over the cap is all plain, and says so", () => {
    const n = MAX_STYLED_PIECES_PER_PAGE + 1;
    const pieces: FlowPiece[] = Array.from({ length: n }, (_, k) => ({
      text: k === 0 ? "w" : " w",
      box: [72, 100, 80, 112] as const,
    }));
    const p: PdfFlowTextPage = {
      pageNumber: 1,
      paragraphs: [[pieces.map((x) => x.text).join("")]],
      pieces: [[pieces]],
    };
    const got = runStylesOf(p, scanned([line(72, 100, [["w", 8]])]));
    expect(got.capped).toBe(true);
    expect(got.matched).toBe(0);
    expect(got.total).toBe(n);
    expect(got.styles[0]![0]!.every((x) => x === null)).toBe(true);
  });

  it("the page's mediaFrame maps the reader's runs into poppler's frame", () => {
    // poppler's frame sits 20 pt lower than the reader's (a crop box inset).
    const p = page([["moved", 72, 110]], 120);
    const s = scanned([line(72, 100, [["moved", 40, { italic: true }]])], {
      mediaFrame: [1, 0, 0, 1, 0, 20],
    });
    expect(flat(runStylesOf(p, s).styles)).toEqual([
      { italic: true, halfPoints: 24 },
    ]);
    // Control: without the frame the same run is 20 pt off and matches nothing.
    expect(
      flat(runStylesOf(p, { ...s, mediaFrame: undefined }).styles),
    ).toEqual([null]);
  });
});

/* ------------------------------------------------------------------ *
 *  Real poppler 25.07 output, paired with the reader's scan
 * ------------------------------------------------------------------ */

/**
 * Every captured page whose docblock names a no-argument generator in the
 * fixture modules — DISCOVERED from the docblocks, so a new sample with its
 * generator joins with nothing typed here.
 */
function popplerPairs(): {
  name: string;
  xhtml: string;
  make: () => Promise<unknown>;
}[] {
  const source = readFileSync(
    path.join(process.cwd(), "src/tests/poppler-samples.ts"),
    "utf8",
  );
  const generators: Record<string, unknown> = {
    ...officeFixtures,
    ...pictureFixtures,
    ...tableFixtures,
  };
  const samples = popplerSamples as unknown as Record<string, unknown>;
  const out: { name: string; xhtml: string; make: () => Promise<unknown> }[] =
    [];
  for (const m of source.matchAll(
    /\/\*\* `(\w+)\(\)` through `pdftotext -bbox-layout`[^*]*\*\/\s*export const (\w+_BBOX) =/g,
  )) {
    const make = generators[m[1]!];
    const xhtml = samples[m[2]!];
    if (typeof make === "function" && typeof xhtml === "string")
      out.push({ name: m[2]!, xhtml, make: make as () => Promise<unknown> });
  }
  return out;
}

const pdfOf = (made: unknown) =>
  made instanceof Uint8Array ? made : (made as { pdf: Uint8Array }).pdf;

describe("runStylesOf on poppler's REAL words and the reader's scan of the same PDF", () => {
  it("labels (almost) every word, on every captured page", async () => {
    const pairs = popplerPairs();
    // Health: the discovery found the captured pages, each paired with the
    // generator its docblock names.
    expect(pairs.length).toBeGreaterThanOrEqual(POPPLER_PAIRS);
    let matched = 0;
    let total = 0;
    const rates: string[] = [];
    for (const pair of pairs) {
      const flow = flowText(parseBboxFlow(pair.xhtml));
      const scan = await scanPdfPages(pdfOf(await pair.make()), {
        picturesOnly: true,
      });
      let m = 0;
      let t = 0;
      for (const fp of flow.pages) {
        const got = runStylesOf(
          fp,
          scan.pages.find((sp) => sp.pageNumber === fp.pageNumber),
        );
        m += got.matched;
        t += got.total;
      }
      rates.push(`${pair.name} ${m}/${t}`);
      matched += m;
      total += t;
    }
    expect(total).toBeGreaterThan(500);
    // Measured 2026-11-15: see POPPLER_MATCHED below.
    expect(matched, rates.join(", ")).toBeGreaterThanOrEqual(
      Math.floor(total * POPPLER_MATCHED_RATE),
    );
  }, 300_000);
});

/** Discovered pairs on 2026-11-15: all 17 captured `-bbox-layout` pages. */
const POPPLER_PAIRS = 17;
/**
 * The share of real poppler words the matcher labels. Measured 2026-11-15:
 * 677 of 677 words over the 17 pages (fallback rate 0) — the two readers'
 * frames agree on every generated page. A page that lowers it is a frame
 * disagreement to explain, not a tolerance to widen.
 */
const POPPLER_MATCHED_RATE = 1;

/* ------------------------------------------------------------------ *
 *  The generated corpus
 * ------------------------------------------------------------------ */

/** The writer with every word's formatting taken away: the styling-off seam. */
const unstyled = (doc: DocxDocument) =>
  docxPackage({
    ...doc,
    pages: doc.pages.map((blocks) =>
      blocks.map((b) => (b.kind === "text" ? { ...b, runs: undefined } : b)),
    ),
  });

describe("formatting over every generated Word fixture", () => {
  it("styling on and off give the same text, page by page, for every fixture", async () => {
    const generators = wordCorpusGenerators();
    expect(generators.length).toBeGreaterThanOrEqual(26);
    let compared = 0;
    for (const { name, make } of generators) {
      const pdf = pdfOf(await make());
      const on = await runPdfOfficeExport(PDF_TO_WORD_TOOL, pdf, corpusDeps());
      const off = await runPdfOfficeExport(
        PDF_TO_WORD_TOOL,
        pdf,
        corpusDeps({ writeDocx: unstyled }),
      );
      expect(on.ok && off.ok, name).toBe(true);
      if (!on.ok || !off.ok) continue;
      expect(docxPageTexts(await readDocxStructure(on.output)), name).toEqual(
        docxPageTexts(await readDocxStructure(off.output)),
      );
      compared += 1;
    }
    expect(compared).toBeGreaterThanOrEqual(26);
  }, 600_000);

  it("the matcher's fallback rate over the corpus (stand-in poppler, real reader)", async () => {
    let matched = 0;
    let total = 0;
    const rates: string[] = [];
    for (const { name, make } of wordCorpusGenerators()) {
      const pdf = pdfOf(await make());
      const flow = await flowStandIn(pdf);
      const scan = await scanPdfPages(pdf, { picturesOnly: true });
      let m = 0;
      let t = 0;
      for (const fp of flow.pages) {
        const got = runStylesOf(
          fp,
          scan.pages.find((sp) => sp.pageNumber === fp.pageNumber),
        );
        m += got.matched;
        t += got.total;
      }
      rates.push(`${name} ${m}/${t}`);
      matched += m;
      total += t;
    }
    expect(total).toBeGreaterThan(500);
    expect(matched, rates.join(", ")).toBeGreaterThanOrEqual(
      Math.floor(total * CORPUS_MATCHED_RATE),
    );
  }, 600_000);
});

/**
 * The share of corpus words the matcher labels. Measured 2026-11-15: 660 of
 * 666 words over the 26 fixtures (fallback rate 0.9%); all six unmatched
 * words are `ocrdScanPdf`'s, whose text is an INVISIBLE OCR layer — written
 * in Word's default style by design, and named in the note.
 */
const CORPUS_MATCHED_RATE = 0.99;
