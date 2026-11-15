// @vitest-environment node
// @native-canvas
/**
 * Formatting on each word, through the WHOLE PDF to Word engine on
 * production's deps (poppler stood in for), read back by
 * `./docx-structure` — never by matching the writer's own strings.
 */
import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import { captionedPicturesPdf } from "@/tests/docx-picture-fixtures";
import { corpusDeps } from "@/tests/docx-word-corpus";
import { flowStandIn } from "@/tests/poppler-flow-standin";
import { writeWithoutTypefaces } from "@/tests/docx-without-typefaces";
import { flowPageText } from "../pdf-text/flow";
import { DOCX_RUN_STYLES_PROBE, docxRunStylesProbePdf } from "./capability";
import type { DocxDocument } from "./docx-layout";
import { docxPackage } from "./docx-package";
import { MAX_STYLED_PIECES_PER_PAGE } from "./docx-run-style";
import {
  docxPageTexts,
  docxStructureProblems,
  readDocxStructure,
  type DocxReadRun,
} from "./docx-structure";
import {
  PDF_TO_WORD_TOOL,
  runPdfOfficeExport,
  type PdfOfficeExportDeps,
  type PdfOfficeExportRun,
} from "./engine";

async function word(
  pdf: Uint8Array,
  extra: Partial<PdfOfficeExportDeps> = {},
): Promise<Extract<PdfOfficeExportRun, { ok: true }>> {
  const run = await runPdfOfficeExport(
    PDF_TO_WORD_TOOL,
    pdf,
    corpusDeps(extra),
  );
  if (!run.ok) throw new Error(`${run.kind}: ${run.message}`);
  return run;
}

/** Every run of the body, and each word with the runs it appears in. */
async function runsOf(docx: Uint8Array) {
  const body = await readDocxStructure(docx);
  const runs = body.blocks.flatMap((b) => (b.kind === "p" ? b.runs : []));
  const byWord = new Map<string, DocxReadRun[]>();
  for (const run of runs)
    for (const w of run.text.split(/\s+/).filter(Boolean))
      byWord.set(w, [...(byWord.get(w) ?? []), run]);
  return { body, runs, byWord };
}

/** The text poppler (stood in for) reads, page by page. */
async function popplerText(pdf: Uint8Array): Promise<string[]> {
  return (await flowStandIn(pdf)).pages.map(flowPageText);
}

const unstyled = (doc: DocxDocument) =>
  docxPackage({
    ...doc,
    pages: doc.pages.map((blocks) =>
      blocks.map((b) => (b.kind === "text" ? { ...b, runs: undefined } : b)),
    ),
  });

describe("each word keeps its formatting, through the engine", () => {
  it("a red word is red, an 18-point word is 36 half-points in both scripts' sizes, and nothing beside them is", async () => {
    const pdf = await docxRunStylesProbePdf();
    const run = await word(pdf);
    const { body, byWord } = await runsOf(run.output);
    const w = DOCX_RUN_STYLES_PROBE;
    const one = (t: string) => {
      const found = byWord.get(t) ?? [];
      expect(found, t).toHaveLength(1);
      return found[0]!;
    };
    expect(one(w.red).color).toBe("FF0000");
    expect(one(w.big)).toMatchObject({ sz: 36, szCs: 36 });
    expect(one(w.big).color).toBeUndefined();
    for (const t of [w.plain, w.bold, w.italic, ...w.second.split(" ")]) {
      expect(one(t).color, t).toBeUndefined();
      expect(one(t).sz, t).toBe(24);
    }
    expect(docxPageTexts(body)).toEqual(await popplerText(pdf));
    expect(await docxStructureProblems(run.output)).toEqual([]);
    expect(run.coverage.formattingMissingPageCount).toBe(0);
    expect(run.coverage.unmatchedWords).toBe(0);
  }, 60_000);

  it("Bengali text keeps its size in the complex-script property, and its text is poppler's", async () => {
    const text = "বাংলা লেখা এখানে";
    const doc = await PDFDocument.create();
    const font = await embedDrawingFont(doc, [text], "sans");
    doc.addPage([612, 792]).drawText(text, { x: 72, y: 700, size: 14, font });
    const pdf = await doc.save();
    const run = await word(pdf);
    const { body, runs } = await runsOf(run.output);
    const texted = runs.filter((r) => r.text.trim());
    // Health: the Bengali words are in the file.
    expect(texted.length).toBeGreaterThan(0);
    expect(texted.every((r) => r.sz === 28 && r.szCs === 28)).toBe(true);
    expect(docxPageTexts(body)).toEqual(await popplerText(pdf));
    expect(await docxStructureProblems(run.output)).toEqual([]);
  }, 60_000);

  it("on a page with /Rotate 90 the bold lands on the bold word, through the page's mediaFrame", async () => {
    const doc = await PDFDocument.create();
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.addPage([612, 792]);
    page.setRotation(degrees(90));
    // Drawn turned a quarter anticlockwise, so it reads upright on the
    // page as displayed (turned a quarter clockwise).
    let y = 100;
    for (const [t, font] of [
      ["before", regular],
      ["middle", bold],
      ["after", regular],
    ] as const) {
      page.drawText(t, { x: 300, y, size: 12, font, rotate: degrees(90) });
      y += font.widthOfTextAtSize(`${t} `, 12);
    }
    const pdf = await doc.save();
    const run = await word(pdf);
    const { body, byWord } = await runsOf(run.output);
    const isBold = (t: string) => byWord.get(t)?.map((r) => r.b === true);
    expect(isBold("before")).toEqual([false]);
    expect(isBold("middle")).toEqual([true]);
    expect(isBold("after")).toEqual([false]);
    expect(docxPageTexts(body)).toEqual(await popplerText(pdf));
  }, 60_000);

  it("a scan out of time: every page with text is named, and the text is exactly the unformatted writer's", async () => {
    const pdf = await docxRunStylesProbePdf();
    const late = { limits: { scanTimeoutMs: -1 } };
    const styled = await word(pdf, late);
    const plain = await word(pdf, { ...late, writeDocx: unstyled });
    expect(styled.coverage.pagesWithoutFormatting).toEqual([1]);
    expect(styled.coverage.formattingMissingPageCount).toBe(1);
    const texts = async (b: Uint8Array) =>
      docxPageTexts(await readDocxStructure(b));
    expect(await texts(styled.output)).toEqual(await texts(plain.output));
    expect(await docxStructureProblems(styled.output)).toEqual([]);
    // Nothing in it carries formatting: the page was never read.
    const { runs } = await runsOf(styled.output);
    expect(runs.some((r) => r.b || r.sz !== undefined)).toBe(false);
  }, 60_000);

  it("over the output limit, the formatting goes before any picture: the plain text and pictures that fit on main still go out", async () => {
    // The pictures fixture, and a page of words alternating regular and
    // bold: formatting that costs more than the pictures' budget slack.
    const doc = await PDFDocument.load((await captionedPicturesPdf()).pdf);
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const extra = doc.addPage([612, 792]);
    for (let l = 0; l < 40; l++) {
      let x = 72;
      for (let w = 0; w < 10; w++) {
        const font = w % 2 ? bold : regular;
        extra.drawText(`word${w}`, { x, y: 740 - l * 16, size: 10, font });
        x += font.widthOfTextAtSize(`word${w} `, 10);
      }
    }
    const pdf = await doc.save();
    const plain = await word(pdf, { writeDocx: unstyled });
    const styled = await word(pdf);
    const pictures = (await readDocxStructure(plain.output)).blocks.filter(
      (b) => b.kind === "p" && b.drawing,
    ).length;
    // Health: the formatting costs bytes, and the PDF has pictures to lose.
    expect(pictures).toBeGreaterThan(0);
    expect(styled.output.byteLength).toBeGreaterThan(plain.output.byteLength);
    expect(plain.coverage.picturesNotCarried ?? 0).toBe(0);
    // One byte under the formatted file: the formatted file cannot go
    // out whole, while the plain writer (main's file) carries every picture
    // at this limit — checked, not assumed.
    // INVERTED 2026-11-15 (#28 slice 4). HISTORY: "the formatted file" was
    // the free export; since the typefaces go first over the limit, one
    // byte under it only dropped them and the formatting stayed. It is now
    // the formatted file without its typefaces, the first step's result.
    const faceless = await word(pdf, { writeDocx: writeWithoutTypefaces });
    expect(styled.output.byteLength).toBeGreaterThan(
      faceless.output.byteLength,
    );
    const limit = faceless.output.byteLength - 1;
    const onMain = await word(pdf, {
      writeDocx: unstyled,
      limits: { maxOutputBytes: limit },
    });
    expect(onMain.coverage.picturesNotCarried ?? 0).toBe(0);
    const run = await word(pdf, { limits: { maxOutputBytes: limit } });
    expect(run.output.byteLength).toBeLessThanOrEqual(limit);
    expect(run.coverage.picturesNotCarried ?? 0).toBe(0);
    expect(
      (await readDocxStructure(run.output)).blocks.filter(
        (b) => b.kind === "p" && b.drawing,
      ).length,
    ).toBe(pictures);
    const { body, runs } = await runsOf(run.output);
    expect(runs.some((r) => r.b || r.sz !== undefined)).toBe(false);
    expect(docxPageTexts(body)).toEqual(await popplerText(pdf));
    expect(run.coverage.formattingMissingPageCount).toBeGreaterThan(0);
  }, 120_000);

  it(`a page of ${MAX_STYLED_PIECES_PER_PAGE + 1} words is written whole and plain, and named`, async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([612, 792]);
    const perLine = 101;
    const lines = Math.ceil((MAX_STYLED_PIECES_PER_PAGE + 1) / perLine);
    let left = MAX_STYLED_PIECES_PER_PAGE + 1;
    for (let l = 0; l < lines; l++) {
      const n = Math.min(perLine, left);
      left -= n;
      page.drawText(Array.from({ length: n }, () => "w").join(" "), {
        x: 10,
        y: 780 - l * 3.8,
        size: 3,
        font,
        color: rgb(0, 0, 0),
      });
    }
    const pdf = await doc.save();
    const run = await word(pdf);
    expect(run.coverage.pagesWithoutFormatting).toEqual([1]);
    const { body, runs } = await runsOf(run.output);
    expect(runs.some((r) => r.b || r.sz !== undefined)).toBe(false);
    const text = docxPageTexts(body);
    expect(text).toEqual(await popplerText(pdf));
    expect(text.join(" ").split(/\s+/).filter(Boolean)).toHaveLength(
      MAX_STYLED_PIECES_PER_PAGE + 1,
    );
  }, 300_000);
});
