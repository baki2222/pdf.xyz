// @vitest-environment node
// @native-canvas
/**
 * #28 slice 4 (2026-11-15): each word's typeface, through the WHOLE PDF to
 * Word engine on production's deps (poppler stood in for), read back by
 * `./docx-structure` — never by matching the writer's own strings.
 *
 * What a word is written in: an Office family (`./typeface`), as
 * `w:rFonts` ascii = hAnsi = cs, never eastAsia, nothing embedded; none for
 * a word with a letter outside Latin, a dingbat, or an OCR layer.
 */
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import { boldItalicPdf } from "@/tests/docx-picture-fixtures";
import { corpusDeps, wordCorpus } from "@/tests/docx-word-corpus";
import {
  INLINE_CODE,
  inlineCodePdf,
  invoicePdf,
} from "@/tests/pdf-office-fixtures";
import { flowStandIn } from "@/tests/poppler-flow-standin";
import { writeWithoutTypefaces } from "@/tests/docx-without-typefaces";
import { flowPageText } from "../pdf-text/flow";
import { DOCX_TYPEFACES_PROBE, docxTypefacesProbePdf } from "./capability";
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
import { OFFICE_FAMILIES } from "./typeface";

async function word(
  pdf: Uint8Array,
): Promise<Extract<PdfOfficeExportRun, { ok: true }>> {
  const run = await runPdfOfficeExport(PDF_TO_WORD_TOOL, pdf, corpusDeps());
  if (!run.ok) throw new Error(`${run.kind}: ${run.message}`);
  return run;
}

/** Every run of the body (tables included), and each word's runs. */
async function runsOf(docx: Uint8Array) {
  const body = await readDocxStructure(docx);
  const runs: DocxReadRun[] = [];
  const walk = (blocks: typeof body.blocks) => {
    for (const b of blocks)
      if (b.kind === "p") runs.push(...b.runs);
      else for (const r of b.rows) for (const c of r.cells) walk(c.blocks);
  };
  walk(body.blocks);
  const byWord = new Map<string, DocxReadRun[]>();
  for (const run of runs)
    for (const w of run.text.split(/\s+/).filter(Boolean))
      byWord.set(w, [...(byWord.get(w) ?? []), run]);
  return { body, runs, byWord };
}

/** The one run holding `word`; fails naming what is there. */
function one(byWord: Map<string, DocxReadRun[]>, word: string): DocxReadRun {
  const found = byWord.get(word) ?? [];
  expect(found, word).toHaveLength(1);
  return found[0]!;
}

/** The three `w:rFonts` attributes of a run, as read. */
const faces = (r: DocxReadRun) => [r.fonts, r.fontsHAnsi, r.fontsCs];

async function popplerText(pdf: Uint8Array): Promise<string[]> {
  return (await flowStandIn(pdf)).pages.map(flowPageText);
}

describe("each word is set in an Office family of its kind, through the engine", () => {
  it("the probe's three lines: Times New Roman, Courier New, Arial — in all three attributes, never eastAsia", async () => {
    const pdf = await docxTypefacesProbePdf();
    const run = await word(pdf);
    const { body, runs, byWord } = await runsOf(run.output);
    const p = DOCX_TYPEFACES_PROBE;
    const want: [string, string][] = [
      [p.serif, "Times New Roman"],
      [p.mono, "Courier New"],
      [p.sans, "Arial"],
    ];
    for (const [line, family] of want)
      for (const w of line.split(" "))
        expect(faces(one(byWord, w)), w).toEqual([family, family, family]);
    expect(runs.filter((r) => r.fontsEastAsia !== undefined)).toEqual([]);
    expect(runs.filter((r) => r.fontsOther !== undefined)).toEqual([]);
    expect(docxPageTexts(body)).toEqual(await popplerText(pdf));
    expect(await docxStructureProblems(run.output)).toEqual([]);
  }, 60_000);

  it("inline code: `printf` alone is Courier New, in a run of its own; `Call` and `now` are Times New Roman", async () => {
    const pdf = await inlineCodePdf();
    const run = await word(pdf);
    const { body, byWord } = await runsOf(run.output);
    const code = one(byWord, INLINE_CODE.code);
    expect(faces(code)).toEqual(["Courier New", "Courier New", "Courier New"]);
    // Its own run: nothing else is written in Courier New.
    expect(code.text.trim()).toBe(INLINE_CODE.code);
    for (const w of ["Call", "now", ...INLINE_CODE.second.split(" ")])
      expect(faces(one(byWord, w)), w).toEqual([
        "Times New Roman",
        "Times New Roman",
        "Times New Roman",
      ]);
    // One style in two faces: the size is the same on all three.
    expect(
      ["Call", INLINE_CODE.code, "now"].map((w) => one(byWord, w).sz),
    ).toEqual([24, 24, 24]);
    expect(docxPageTexts(body)).toEqual(await popplerText(pdf));
  }, 60_000);

  it("Bengali words carry no w:rFonts and keep their size in szCs; the text is poppler's", async () => {
    const text = "বাংলা লেখা এখানে";
    const doc = await PDFDocument.create();
    const font = await embedDrawingFont(doc, [text], "sans");
    doc.addPage([612, 792]).drawText(text, { x: 72, y: 700, size: 14, font });
    const pdf = await doc.save();
    const run = await word(pdf);
    const { body, runs } = await runsOf(run.output);
    const texted = runs.filter((r) => r.text.trim());
    // Health: the Bengali words are in the file, and styled.
    expect(texted.length).toBeGreaterThan(0);
    expect(texted.every((r) => r.sz === 28 && r.szCs === 28)).toBe(true);
    expect(texted.filter((r) => r.fonts !== undefined)).toEqual([]);
    expect(docxPageTexts(body)).toEqual(await popplerText(pdf));
  }, 60_000);

  it("a mixed line 'Total মোট 42': Total and 42 take the face, মোট none — and all three keep their size", async () => {
    const text = "Total মোট 42";
    const doc = await PDFDocument.create();
    const font = await embedDrawingFont(doc, [text], "sans");
    doc.addPage([612, 792]).drawText(text, { x: 72, y: 700, size: 14, font });
    const pdf = await doc.save();
    const run = await word(pdf);
    const { body, byWord } = await runsOf(run.output);
    const total = one(byWord, "Total");
    const bengali = one(byWord, "মোট");
    const n = one(byWord, "42");
    // The shipped Bengali face is not an Office family: its kind's default.
    expect(faces(total)).toEqual(["Arial", "Arial", "Arial"]);
    expect(faces(n)).toEqual(["Arial", "Arial", "Arial"]);
    expect(faces(bengali)).toEqual([undefined, undefined, undefined]);
    expect([total.szCs, bengali.szCs, n.szCs]).toEqual([28, 28, 28]);
    expect(docxPageTexts(body)).toEqual(await popplerText(pdf));
  }, 60_000);

  it("the slice-1 fixture: its sans words are Arial, its Times-Italic line Times New Roman, with bold, italics and size unchanged", async () => {
    const { pdf, paragraph } = await boldItalicPdf();
    const run = await word(pdf);
    const { byWord } = await runsOf(run.output);
    const check = (
      line: string,
      family: string,
      b: boolean,
      i: boolean,
      sz: number,
    ) => {
      // Each word of the line in a run of the line's bold, italics and
      // size ("A", "set", "in" and "bold" are in two lines).
      for (const w of line.split(" ")) {
        const found = byWord.get(w) ?? [];
        expect(found.length, w).toBeGreaterThan(0);
        const matching = found.filter(
          (r) =>
            r.b === (b || undefined) && r.i === (i || undefined) && r.sz === sz,
        );
        expect(matching.length, w).toBeGreaterThan(0);
        for (const r of matching)
          expect(faces(r), w).toEqual([family, family, family]);
      }
    };
    check(paragraph.bold, "Arial", true, false, 40);
    check(paragraph.italic, "Times New Roman", false, true, 24);
    check("Regular words with", "Arial", false, false, 24);
    check("a bold ending", "Arial", true, false, 24);
    check(paragraph.regular, "Arial", false, false, 24);
  }, 60_000);

  it("a dingbat on a line takes no typeface; the word beside it does", async () => {
    const doc = await PDFDocument.create();
    const helvetica = await doc.embedFont(StandardFonts.Helvetica);
    const dingbats = await doc.embedFont(StandardFonts.ZapfDingbats);
    const page = doc.addPage([612, 792]);
    page.drawText("Done ", { x: 72, y: 700, size: 12, font: helvetica });
    page.drawText("✓", {
      x: 72 + helvetica.widthOfTextAtSize("Done ", 12),
      y: 700,
      size: 12,
      font: dingbats,
    });
    const pdf = await doc.save();
    const run = await word(pdf);
    const { runs, byWord } = await runsOf(run.output);
    expect(faces(one(byWord, "Done"))).toEqual(["Arial", "Arial", "Arial"]);
    // Health: something besides "Done" was written.
    const rest = runs.filter((r) => r.text.trim() && !r.text.includes("Done"));
    expect(rest.length).toBeGreaterThan(0);
    for (const r of rest)
      expect(r.fonts, JSON.stringify(r.text)).toBeUndefined();
  }, 60_000);
});

/**
 * HEALTH CHECK over every .docx the engine delivers for the generated Word
 * corpus: every `w:rFonts` names ONE family three times (ascii = hAnsi =
 * cs), a family Windows or Office ships (`OFFICE_FAMILIES` less the symbol
 * faces), never eastAsia or a theme font; and nothing is embedded.
 */
describe("every w:rFonts the engine writes, over the whole generated corpus", () => {
  it("is one Office family, three times, and nothing is embedded", async () => {
    const corpus = await wordCorpus();
    const delivered = corpus.filter((e) => e.docx !== null);
    // The members, named in the assertion: a corpus that quietly shrank
    // would pass, and one that lost these would not be this corpus.
    const names = delivered.map((e) => e.name);
    expect(names.length, names.join(", ")).toBeGreaterThanOrEqual(10);
    expect(names).toEqual(
      expect.arrayContaining([
        "boldItalicPdf",
        "inlineCodePdf",
        "invoicePdf",
        "letterPdf",
        "twoColumnReportPdf",
      ]),
    );
    const kept = new Set<string>(
      OFFICE_FAMILIES.filter(
        (f) => !/^(?:Symbol|Wingdings(?: [23])?|Webdings)$/.test(f),
      ),
    );
    let named = 0;
    for (const e of delivered) {
      const { runs } = await runsOf(e.docx!);
      for (const r of runs) {
        if (r.fonts === undefined) continue;
        named += 1;
        expect(faces(r), e.name).toEqual([r.fonts, r.fonts, r.fonts]);
        expect(kept.has(r.fonts), `${e.name}: ${r.fonts}`).toBe(true);
        expect(r.fontsEastAsia, e.name).toBeUndefined();
        expect(r.fontsOther, e.name).toBeUndefined();
      }
      const zip = await JSZip.loadAsync(e.docx!);
      expect(
        Object.keys(zip.files).filter((n) =>
          /fontTable|^word\/fonts\//i.test(n),
        ),
        e.name,
      ).toEqual([]);
    }
    // Positive control: the corpus does carry typefaces to check.
    expect(named).toBeGreaterThan(100);
  }, 300_000);
});

/**
 * Over the output limit the typefaces go FIRST (#28 slice 4): they are what
 * this slice added, so a file whose tables and formatting fitted before it
 * keeps them, as the tables did for the formatting (engine.ts). The limit
 * is measured, never typed: between the file with typefaces and the same
 * file without them.
 */
describe("over the output limit the typefaces go first", () => {
  /** The engine with every word's typeface stripped before writing. */
  const noFaces: Partial<PdfOfficeExportDeps> = {
    writeDocx: writeWithoutTypefaces,
  };

  it("the invoice keeps its Word table and its bold, loses its typefaces, and the result says so", async () => {
    const pdf = await invoicePdf();
    const deps = corpusDeps();
    const run = async (extra: Partial<PdfOfficeExportDeps>) => {
      const out = await runPdfOfficeExport(PDF_TO_WORD_TOOL, pdf, {
        ...deps,
        ...extra,
      });
      if (!out.ok) throw new Error(`${out.kind}: ${out.message}`);
      return out;
    };
    const free = await run({});
    const bare = await run(noFaces);
    const freeRead = await runsOf(free.output);
    // Health: the free file has typefaces, a Word table and bold, and the
    // typefaces cost bytes.
    expect(freeRead.runs.some((r) => r.fonts !== undefined)).toBe(true);
    expect(freeRead.body.blocks.some((b) => b.kind === "tbl")).toBe(true);
    expect(freeRead.runs.some((r) => r.b)).toBe(true);
    expect(free.output.byteLength).toBeGreaterThan(bare.output.byteLength);
    expect(free.coverage.typefacesDroppedForSize).toBeUndefined();
    const limit =
      bare.output.byteLength +
      Math.floor((free.output.byteLength - bare.output.byteLength) / 2);
    const limited = await run({ limits: { maxOutputBytes: limit } });
    expect(limited.output.byteLength).toBeLessThanOrEqual(limit);
    const read = await runsOf(limited.output);
    expect(read.runs.filter((r) => r.fonts !== undefined)).toEqual([]);
    expect(read.body.blocks.filter((b) => b.kind === "tbl")).toHaveLength(1);
    expect(read.runs.filter((r) => r.b).length).toBe(
      freeRead.runs.filter((r) => r.b).length,
    );
    expect(limited.coverage.typefacesDroppedForSize).toBe(true);
    expect(limited.coverage.tablesAsTextForSize).toBe(0);
    expect(limited.coverage.formattingMissingPageCount).toBe(0);
    expect(docxPageTexts(read.body)).toEqual(await popplerText(pdf));
    // Control: with room for them, the typefaces stay.
    const roomy = await run({
      limits: { maxOutputBytes: free.output.byteLength },
    });
    expect(
      (await runsOf(roomy.output)).runs.some((r) => r.fonts !== undefined),
    ).toBe(true);
    expect(roomy.coverage.typefacesDroppedForSize).toBeUndefined();
  }, 120_000);
});
