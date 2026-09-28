import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  columnsReadInOrder,
  INVOICE_SHEET,
  invoiceSheetMismatches,
  LEFT_COLUMN,
  rc4EncryptedPdf,
  RIGHT_COLUMN,
  TABLE_ROWS,
} from "@/tests/pdf-office-fixtures";
import * as popplerSamples from "@/tests/poppler-samples";
import {
  INVOICE_LAYOUT,
  INVOICE_SPACED_LAYOUT,
  TABLE_BBOX,
  TWO_COLUMN_BBOX,
  TWO_COLUMN_LAYOUT,
} from "@/tests/poppler-samples";
import {
  readXlsxSheet,
  sheetGridProblems,
  type SheetRead,
} from "../ooxml/sheet-read";
import { PdfTextExecError } from "../pdf-text/errors";
import { flowText, type PdfFlowText } from "../pdf-text/flow";
import { parseBboxFlow, parseLayoutText } from "../pdf-text/parse";
import { DOCX_PAGE_BREAK, readDocxParagraphs } from "./docx-text";
import { readPptx, xmlProblems } from "./validate-ooxml";
import {
  PDF_OFFICE_EXPORT_TOOLS,
  runPdfOfficeExport,
  type PdfFlowExtractor,
  type PdfOfficeExportDeps,
  type PdfTextExtractor,
} from "./engine";

const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);
const extract: PdfTextExtractor = vi.fn(async () => ({
  pageCount: 2,
  pages: [
    { pageNumber: 1, text: "Name Amount\nAlice 10", characterCount: 20 },
    { pageNumber: 2, text: "Bob 20", characterCount: 6 },
  ],
  text: "Name Amount\nAlice 10\n\nBob 20",
  characterCount: 28,
  hasText: true,
}));

/** A flow extractor that serves a parsed poppler sample. */
function flowOf(xhtml: string): PdfFlowExtractor {
  return async () => flowText(parseBboxFlow(xhtml));
}
/** Pages of plain prose paragraphs, for tests about pages rather than layout. */
function flowPages(...pages: string[][]): PdfFlowExtractor {
  return async (): Promise<PdfFlowText> => ({
    pageCount: pages.length,
    pages: pages.map((paragraphs, i) => ({
      pageNumber: i + 1,
      paragraphs: paragraphs.map((p) => [p]),
    })),
  });
}
const extractFlow = flowPages(["Name Amount", "Alice 10"], ["Bob 20"]);

async function zipEntries(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  return new Set(Object.keys(zip.files));
}

async function wordParagraphs(deps: PdfOfficeExportDeps): Promise<string[]> {
  const run = await runPdfOfficeExport("pdf-to-word", PDF, deps);
  if (!run.ok) throw new Error(`pdf-to-word failed: ${run.kind}`);
  return readDocxParagraphs(run.output);
}

describe("pdf-office-export engine", () => {
  it("declares the owned tools", () => {
    expect(PDF_OFFICE_EXPORT_TOOLS).toEqual([
      "pdf-to-word",
      "pdf-to-excel",
      "pdf-to-powerpoint",
    ]);
  });

  it("fails honestly without an extractor", async () => {
    await expect(
      runPdfOfficeExport("pdf-to-word", PDF, {}),
    ).resolves.toMatchObject({ ok: false, kind: "unsupported" });
  });

  it("exports selectable PDF text to a valid DOCX package", async () => {
    // Needs `extractFlow` since PDF to Word stopped reading `-layout` lines;
    // this case used to pass `extract` alone, which is the wiring that
    // scrambled every two-column page.
    const result = await runPdfOfficeExport("pdf-to-word", PDF, {
      extract,
      extractFlow,
    });
    expect(result).toMatchObject({
      ok: true,
      meta: {
        tool: "pdf-to-word",
        engine: "pdftotext-office-openxml",
        pageCount: 2,
      },
    });
    if (result.ok) {
      expect(result.contentType).toBe(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      const entries = await zipEntries(result.output);
      expect(entries).toContain("word/document.xml");
    }
  });

  it("exports selectable PDF text to XLSX and PPTX packages", async () => {
    const xlsx = await runPdfOfficeExport("pdf-to-excel", PDF, { extract });
    const pptx = await runPdfOfficeExport("pdf-to-powerpoint", PDF, {
      extract,
    });
    expect(xlsx.ok).toBe(true);
    expect(pptx.ok).toBe(true);
    if (xlsx.ok)
      expect(await zipEntries(xlsx.output)).toContain(
        "xl/worksheets/sheet1.xml",
      );
    // INVERTED 2026-09-27. This asserted that `ppt/slides/slide1.xml` was IN
    // the ZIP — true of every deck this tool shipped, and PowerPoint refused
    // every one of them as "corrupted and unreadable" (no master, layout or
    // theme, no slide size, empty shape properties). It now asks PowerPoint's
    // question; the deck-level cases are in the pdf-to-powerpoint block below.
    if (pptx.ok) expect((await readPptx(pptx.output)).problems).toEqual([]);
  });

  it("rejects image-only PDFs and oversized inputs", async () => {
    const emptyExtractor: PdfTextExtractor = async () => ({
      pageCount: 1,
      pages: [{ pageNumber: 1, text: "", characterCount: 0 }],
      text: "",
      characterCount: 0,
      hasText: false,
    });
    await expect(
      runPdfOfficeExport("pdf-to-excel", PDF, { extract: emptyExtractor }),
    ).resolves.toMatchObject({ ok: false, kind: "no_text" });
    await expect(
      runPdfOfficeExport("pdf-to-word", PDF, { extractFlow: flowPages([]) }),
    ).resolves.toMatchObject({ ok: false, kind: "no_text" });
    await expect(
      runPdfOfficeExport("pdf-to-word", PDF, {
        extractFlow,
        limits: { maxInputBytes: 4 },
      }),
    ).resolves.toMatchObject({ ok: false, kind: "too_large", limitBytes: 4 });
  });
});

describe("pdf-to-word reads poppler's reading order, not the page's layout", () => {
  // Both extractors are wired in every case below, exactly as production
  // wires them. PDF to Word used to read `extract` (the `-layout` text); the
  // assertions are on the DOCX a user downloads, read back paragraph by
  // paragraph.
  const layoutExtract: PdfTextExtractor = async () =>
    parseLayoutText(TWO_COLUMN_LAYOUT);

  it("writes a two-column page column by column, one paragraph per column", async () => {
    const paragraphs = await wordParagraphs({
      extract: layoutExtract,
      extractFlow: flowOf(TWO_COLUMN_BBOX),
    });
    expect(columnsReadInOrder(paragraphs)).toBe(true);
    expect(paragraphs).toEqual([
      "Quarterly Report",
      LEFT_COLUMN.join(" "),
      RIGHT_COLUMN.join(" "),
    ]);
  });

  it("keeps a table's rows as rows, cells separated by tabs", async () => {
    const paragraphs = await wordParagraphs({
      extract: layoutExtract,
      extractFlow: flowOf(TABLE_BBOX),
    });
    expect(paragraphs).toEqual(TABLE_ROWS.map((row) => row.join("\t")));
  });

  it("never falls back to the layout extractor when the flow one is missing", async () => {
    await expect(
      runPdfOfficeExport("pdf-to-word", PDF, { extract: layoutExtract }),
    ).resolves.toMatchObject({ ok: false, kind: "unsupported" });
  });

  it("puts a page break between pages and keeps spaces verbatim", async () => {
    const run = await runPdfOfficeExport("pdf-to-word", PDF, {
      extractFlow: flowPages(["  indented"], [], ["third"]),
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    // An empty page adds no second break: breaks separate pages with text.
    expect(await readDocxParagraphs(run.output)).toEqual([
      "  indented",
      DOCX_PAGE_BREAK,
      "third",
    ]);
    const xml = await (
      await JSZip.loadAsync(run.output)
    )
      .file("word/document.xml")!
      .async("string");
    expect(xml).toContain('<w:t xml:space="preserve">  indented</w:t>');
  });
});

describe("a PDF that will not open is classified, not retried", () => {
  const refused: PdfFlowExtractor = async () => {
    throw new PdfTextExecError({
      exitCode: 1,
      killed: false,
      outputTooLarge: false,
    });
  };

  it("names a user-password PDF as password-protected (real RC4 fixture, real pdf-lib check)", async () => {
    const locked = rc4EncryptedPdf({
      userPassword: "s3cret",
      ownerPassword: "owner",
    });
    const run = await runPdfOfficeExport("pdf-to-word", locked, {
      extractFlow: refused,
    });
    expect(run).toMatchObject({ ok: false, kind: "password_protected" });
    if (!run.ok) expect(run.message).toMatch(/Unlock PDF/);
  });

  it("names an unencrypted PDF that will not open as unreadable", async () => {
    const plain = await (await PDFDocument.create()).save();
    await expect(
      runPdfOfficeExport("pdf-to-word", plain, { extractFlow: refused }),
    ).resolves.toMatchObject({ ok: false, kind: "unreadable" });
  });

  it("classifies the same way for Excel and PowerPoint, which share the path", async () => {
    const locked = rc4EncryptedPdf({ userPassword: "x", ownerPassword: "y" });
    const refusedLayout: PdfTextExtractor = async () => {
      throw new PdfTextExecError({
        exitCode: 1,
        killed: false,
        outputTooLarge: false,
      });
    };
    for (const tool of ["pdf-to-excel", "pdf-to-powerpoint"] as const)
      await expect(
        runPdfOfficeExport(tool, locked, { extract: refusedLayout }),
      ).resolves.toMatchObject({ ok: false, kind: "password_protected" });
  });

  it("keeps a timeout, a spawn failure and an unknown throw retryable (`failed`)", async () => {
    const locked = rc4EncryptedPdf({ userPassword: "x", ownerPassword: "y" });
    const throwing =
      (error: unknown): PdfFlowExtractor =>
      async () => {
        throw error;
      };
    for (const error of [
      new PdfTextExecError({
        exitCode: null,
        killed: true,
        outputTooLarge: false,
      }),
      new PdfTextExecError({
        exitCode: null,
        killed: false,
        outputTooLarge: false,
      }),
      new Error("anything else"),
    ])
      // Encrypted input on purpose: only a REFUSAL may ask about encryption.
      await expect(
        runPdfOfficeExport("pdf-to-word", locked, {
          extractFlow: throwing(error),
        }),
      ).resolves.toMatchObject({ ok: false, kind: "failed" });
  });

  it("reports an extractor output ceiling as too large, not as a retryable failure", async () => {
    await expect(
      runPdfOfficeExport("pdf-to-word", PDF, {
        extractFlow: async () => {
          throw new PdfTextExecError({
            exitCode: null,
            killed: false,
            outputTooLarge: true,
          });
        },
      }),
    ).resolves.toMatchObject({ ok: false, kind: "too_large" });
  });
});

describe("coverage — which pages had text to export", () => {
  it("names the scanned pages of a partly scanned document (Word)", async () => {
    const run = await runPdfOfficeExport("pdf-to-word", PDF, {
      extractFlow: flowPages(
        ["A typed first page with more than enough text on it to count."],
        [],
        [],
        [],
      ),
    });
    expect(run).toMatchObject({
      ok: true,
      coverage: {
        pageCount: 4,
        textPageCount: 1,
        pagesWithoutText: [2, 3, 4],
      },
    });
  });

  it("flags a stamp on EVERY page, which counting empty pages alone cannot see", async () => {
    const stamp = "BATES 000123";
    const run = await runPdfOfficeExport("pdf-to-word", PDF, {
      extractFlow: flowPages([stamp], [stamp], [stamp]),
    });
    expect(run).toMatchObject({
      ok: true,
      coverage: {
        pageCount: 3,
        textPageCount: 3,
        pagesWithoutText: [],
        littleTextPageCount: 3,
        pagesWithLittleText: [1, 2, 3],
      },
    });
  });

  it("measures Excel and PowerPoint from the same per-page text they write", async () => {
    const mixed: PdfTextExtractor = async () => ({
      pageCount: 3,
      pages: [
        { pageNumber: 1, text: "", characterCount: 0 },
        {
          pageNumber: 2,
          text: "Region   Q1   Q2   Q3\nNorth   1200   1350   1410",
          characterCount: 46,
        },
        { pageNumber: 3, text: "   \n  ", characterCount: 0 },
      ],
      text: "Region   Q1   Q2   Q3\nNorth   1200   1350   1410",
      characterCount: 46,
      hasText: true,
    });
    for (const tool of ["pdf-to-excel", "pdf-to-powerpoint"] as const)
      await expect(
        runPdfOfficeExport(tool, PDF, { extract: mixed }),
      ).resolves.toMatchObject({
        ok: true,
        coverage: { pageCount: 3, textPageCount: 1, pagesWithoutText: [1, 3] },
      });
  });

  it("POSITIVE CONTROL: reports nothing missing when every page has real text", async () => {
    const run = await runPdfOfficeExport("pdf-to-word", PDF, {
      extractFlow: flowPages(
        ["The first page carries a full sentence of selectable text."],
        ["The second page does as well, so nothing is missing here."],
      ),
    });
    expect(run).toMatchObject({
      ok: true,
      coverage: {
        pageCount: 2,
        textPageCount: 2,
        pagesWithoutText: [],
        littleTextPageCount: 0,
      },
    });
  });
});

describe("pdf-to-excel puts every value in its own column", () => {
  // Read back from the .xlsx a user downloads, cell by cell. What shipped split
  // `-layout` lines on `	| {2,}|,` and dropped the empty pieces: `1,250.00`
  // became two cells, and a row with an empty cell moved every later value
  // under the wrong header. The only test checked that sheet1.xml EXISTED.
  const layoutOf =
    (stdout: string): PdfTextExtractor =>
    async () =>
      parseLayoutText(stdout);

  async function excelSheet(extract: PdfTextExtractor): Promise<SheetRead> {
    const run = await runPdfOfficeExport("pdf-to-excel", PDF, { extract });
    if (!run.ok) throw new Error(`pdf-to-excel failed: ${run.kind}`);
    return readXlsxSheet(run.output);
  }

  it.each([
    ["rows 16pt apart", INVOICE_LAYOUT],
    ["rows 24pt apart, a blank line between each", INVOICE_SPACED_LAYOUT],
  ])("writes a real poppler invoice cell for cell (%s)", async (_, stdout) => {
    const sheet = await excelSheet(layoutOf(stdout));
    // Health check: the comparison below walks INVOICE_SHEET, so a sheet
    // with no rows must not be able to look like a clean one.
    expect(sheet.rows).toHaveLength(INVOICE_SHEET.length);
    expect(invoiceSheetMismatches(sheet)).toEqual([]);
    expect(sheetGridProblems(sheet)).toEqual([]);
  });

  it("POSITIVE CONTROL: the invoice checker sees a value moved one column left", async () => {
    const sheet = await excelSheet(layoutOf(INVOICE_LAYOUT));
    const row = sheet.rows[4]!; // 1002, with the empty Description
    const moved: SheetRead = {
      rows: sheet.rows.map((r) =>
        r !== row
          ? r
          : {
              ...r,
              cells: r.cells.map((c) =>
                c.column === 3 ? { ...c, ref: "C5", column: 2 } : c,
              ),
            },
      ),
    };
    expect(invoiceSheetMismatches(moved)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^R5C3: want absent/)]),
    );
  });

  it("gives a row wider than 26 columns AA, AB… — every reference once, left to right", async () => {
    const labels = Array.from({ length: 30 }, (_, i) => `c${i + 1}`);
    const sheet = await excelSheet(layoutOf(labels.join("   ")));
    expect(sheetGridProblems(sheet)).toEqual([]);
    const cells = sheet.rows[0]!.cells;
    expect(cells.map((c) => c.value)).toEqual(labels);
    // Decoded by the reader, which shares nothing with the writer.
    expect(cells.map((c) => c.column)).toEqual(labels.map((_, i) => i));
    expect(cells.slice(25).map((c) => c.ref)).toEqual([
      "Z1",
      "AA1",
      "AB1",
      "AC1",
      "AD1",
    ]);
  });

  it("writes a well-formed grid for EVERY captured poppler -layout sample", async () => {
    // Discovered, not named: every `*_LAYOUT` capture in the samples module.
    const samples = Object.entries(popplerSamples as Record<string, unknown>)
      .filter(([name]) => name.endsWith("_LAYOUT"))
      .map(([name, stdout]) => [name, String(stdout)] as const);
    expect(samples.length).toBeGreaterThanOrEqual(3);
    for (const [name, stdout] of samples) {
      const sheet = await excelSheet(layoutOf(stdout));
      const cellCount = sheet.rows.reduce((n, r) => n + r.cells.length, 0);
      expect(cellCount, name).toBeGreaterThan(0);
      expect(sheetGridProblems(sheet), name).toEqual([]);
    }
  });

  it("POSITIVE CONTROL: the grid checker sees duplicate and backwards references", () => {
    const cell = (ref: string, column: number) => ({
      ref,
      column,
      row: 1,
      type: "text" as const,
      value: "x",
      format: "General",
    });
    expect(
      sheetGridProblems({
        rows: [{ r: 1, cells: [cell("Z1", 25), cell("Z1", 25)] }],
      }),
    ).toHaveLength(1);
    expect(
      sheetGridProblems({
        rows: [{ r: 1, cells: [cell("B1", 1), cell("A1", 0)] }],
      }),
    ).toHaveLength(1);
  });
});

describe("pdf-to-powerpoint writes a deck PowerPoint opens", () => {
  // Read back through `readPptx`, the walk PowerPoint makes, which the
  // deployment proof runs on production's bytes too. What shipped until
  // 2026-09-27 was refused by PowerPoint on 100% of inputs (reproduced through
  // its COM API: "The file or directory is corrupted and unreadable") while
  // the only assertion here checked a part NAME was in the ZIP.
  type Page = { pageNumber: number; text: string };
  const layoutPages =
    (pages: readonly Page[]): PdfTextExtractor =>
    async () => ({
      pageCount: pages.length,
      pages: pages.map((p) => ({ ...p, characterCount: p.text.length })),
      text: pages.map((p) => p.text).join("\n\n"),
      characterCount: pages.reduce((n, p) => n + p.text.length, 0),
      hasText: pages.some((p) => p.text.trim().length > 0),
    });
  async function deck(extract: PdfTextExtractor): Promise<Uint8Array> {
    const run = await runPdfOfficeExport("pdf-to-powerpoint", PDF, {
      extract,
    });
    if (!run.ok) throw new Error(`pdf-to-powerpoint failed: ${run.kind}`);
    return run.output;
  }
  const nonBlankLines = (text: string) =>
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

  it("writes one slide per page, textless pages included, through the whole chain", async () => {
    const pages = [
      { pageNumber: 1, text: "Name Amount\nAlice 10" },
      { pageNumber: 2, text: "" },
      { pageNumber: 3, text: "Bob 20" },
    ];
    const read = await readPptx(await deck(layoutPages(pages)));
    expect(read.problems).toEqual([]);
    // Health check on the walk: every slide, plus presentation, master,
    // layout and theme. A walk that reached nothing would find nothing wrong.
    expect(read.reached).toHaveLength(pages.length + 4);
    // A textless page is still a slide — slide N is page N — and its text
    // body keeps the one empty paragraph the schema requires.
    expect(read.slides).toEqual([
      ["Name Amount", "Alice 10"],
      [""],
      ["Bob 20"],
    ]);
  });

  it("names every slide part by its position, not by the page number it came from", async () => {
    // Parts, content types, relationships and slide ids all key on the same
    // index. They used to disagree: the part was named after `pageNumber`,
    // everything pointing at it after the loop index.
    const read = await readPptx(
      await deck(
        layoutPages([
          { pageNumber: 4, text: "fourth" },
          { pageNumber: 9, text: "ninth" },
        ]),
      ),
    );
    expect(read.problems).toEqual([]);
    expect(read.slides).toEqual([["fourth"], ["ninth"]]);
  });

  it("strips XML-illegal control characters from every Office output, keeping markup as text", async () => {
    // One stray control character from pdftotext made the whole part
    // malformed XML — for Word and PowerPoint alike, which escaped `<` and
    // `&` but not these. Excel's writer already stripped them.
    const text = "A\u0001 <b>&amp;</b> \u001Fz\u000Bend";
    const outputs = await Promise.all([
      runPdfOfficeExport("pdf-to-word", PDF, {
        extractFlow: flowPages([text]),
      }),
      runPdfOfficeExport("pdf-to-excel", PDF, {
        extract: layoutPages([{ pageNumber: 1, text }]),
      }),
      runPdfOfficeExport("pdf-to-powerpoint", PDF, {
        extract: layoutPages([{ pageNumber: 1, text }]),
      }),
    ]);
    let partsChecked = 0;
    for (const run of outputs) {
      if (!run.ok) throw new Error(`export failed: ${run.kind}`);
      const zip = await JSZip.loadAsync(run.output);
      // Discovered: every XML part the package carries.
      for (const name of Object.keys(zip.files).filter((n) =>
        /\.(xml|rels)$/.test(n),
      )) {
        partsChecked++;
        expect(
          xmlProblems(await zip.file(name)!.async("string")),
          `${run.filenameExt} ${name}`,
        ).toEqual([]);
      }
    }
    expect(partsChecked).toBeGreaterThanOrEqual(15);
    const pptx = outputs[2]!;
    if (!pptx.ok) return;
    expect((await readPptx(pptx.output)).slides).toEqual([
      ["A <b>&amp;</b> zend"],
    ]);
  });

  it("writes a deck PowerPoint opens for EVERY captured poppler -layout sample", async () => {
    // Discovered, not named: every `*_LAYOUT` capture in the samples module.
    const samples = Object.entries(popplerSamples as Record<string, unknown>)
      .filter(([name]) => name.endsWith("_LAYOUT"))
      .map(([name, stdout]) => [name, String(stdout)] as const);
    expect(samples.length).toBeGreaterThanOrEqual(3);
    for (const [name, stdout] of samples) {
      const extracted = parseLayoutText(stdout);
      const read = await readPptx(await deck(async () => extracted));
      expect(read.problems, name).toEqual([]);
      expect(read.slides, name).toHaveLength(extracted.pages.length);
      expect(read.slides.flat().filter(Boolean), name).toEqual(
        extracted.pages.flatMap((p) => nonBlankLines(p.text)),
      );
    }
  });

  it("NEGATIVE CONTROL: the engine's own deck goes red without its master list", async () => {
    // Run through the detector, on the writer's real output — the shape of
    // the defect that shipped.
    const zip = await JSZip.loadAsync(await deck(extract));
    const xml = await zip.file("ppt/presentation.xml")!.async("string");
    const broken = xml.replace(
      /<p:sldMasterIdLst>[\s\S]*?<\/p:sldMasterIdLst>/,
      "",
    );
    expect(broken).not.toBe(xml);
    zip.file("ppt/presentation.xml", broken);
    zip.remove("ppt/slides/_rels/slide1.xml.rels");
    const { problems } = await readPptx(
      await zip.generateAsync({ type: "uint8array" }),
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/no p:sldMasterIdLst/),
        expect.stringMatching(/slide1\.xml: 0 slideLayout relationships/),
      ]),
    );
  });
});
