// @native-canvas
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
import { inspectPptxPackage } from "./pptx-inspect";
import { pptxPackage } from "./pptx-package";
import { scanPdfPages } from "./page-scan";
import { pptxBefore20260927 } from "@/tests/pptx-before-2026-09-27";
import { parseXml, xmlWellFormedness } from "@/tests/xml-well-formed";
import { noPictures, scanning, textScan } from "@/tests/page-scan-stubs";
import {
  imageCaptionPdf,
  linesPdf,
  pdftotextStandIn,
  PPTX_FIDELITY_FIXTURES,
  scannedPdf,
  type PptxFixture,
} from "@/tests/pptx-fidelity-fixtures";

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

/**
 * PDF to PowerPoint's deps for a fixture: the REAL page reader, and pdftotext
 * stood in for (it only classifies a refusal before the reader runs).
 */
function pptxDeps(fixture: PptxFixture): PdfOfficeExportDeps {
  return {
    extract: async () => pdftotextStandIn(fixture),
    scanPages: scanPdfPages,
  };
}

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
    // scrambled every two-column page. And `scanPages` since 2026-10-17, when
    // Word began carrying pictures; the engine it reports changed with it
    // (it was "pdftotext-office-openxml", which wrote no picture).
    const result = await runPdfOfficeExport("pdf-to-word", PDF, {
      scanPages: noPictures,
      extract,
      extractFlow,
    });
    expect(result).toMatchObject({
      ok: true,
      meta: {
        tool: "pdf-to-word",
        engine: "pdftotext-pdfjs-docx-pictures",
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
    const fixture = await imageCaptionPdf();
    const pptx = await runPdfOfficeExport(
      "pdf-to-powerpoint",
      fixture.pdf,
      pptxDeps(fixture),
    );
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
    if (pptx.ok)
      expect((await inspectPptxPackage(pptx.output)).problems).toEqual([]);
  });

  it("writes well-formed XML in every Office export, even from text XML cannot carry", async () => {
    // pdftotext passes through whatever a font's ToUnicode map says, including
    // C0 controls and non-characters. XML 1.0 forbids them, and one such
    // character makes the whole part unparseable, and the file with it.
    const hostile = "Total\u0001 due\u000B now\uFFFF ok \uD800x";
    const hostileExtract: PdfTextExtractor = async () => ({
      pageCount: 1,
      pages: [{ pageNumber: 1, text: hostile, characterCount: hostile.length }],
      text: hostile,
      characterCount: hostile.length,
      hasText: true,
    });
    for (const tool of PDF_OFFICE_EXPORT_TOOLS) {
      // Both extractors, as production wires them: PDF to Word reads only the
      // flow one, and without it answers `unsupported` without writing a file.
      // PowerPoint's text comes from its page reader, so that reader hands
      // the writer the same hostile line.
      const run = await runPdfOfficeExport(tool, PDF, {
        extract: hostileExtract,
        extractFlow: flowPages([hostile]),
        scanPages: scanning(textScan([[hostile]])),
      });
      expect(run.ok, tool).toBe(true);
      if (!run.ok) continue;
      const zip = await JSZip.loadAsync(run.output);
      const parts = Object.keys(zip.files).filter((n) =>
        /\.(xml|rels)$/.test(n),
      );
      // Health check: the loop below must have something to assert over.
      expect(parts.length, tool).toBeGreaterThanOrEqual(3);
      for (const part of parts)
        expect(
          xmlWellFormedness(await zip.file(part)!.async("string")),
          `${tool}: ${part}`,
        ).toBeNull();
    }
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
      runPdfOfficeExport("pdf-to-word", PDF, {
        scanPages: noPictures,
        extractFlow: flowPages([]),
      }),
    ).resolves.toMatchObject({ ok: false, kind: "no_text" });
    await expect(
      runPdfOfficeExport("pdf-to-word", PDF, {
        scanPages: noPictures,
        extractFlow,
        limits: { maxInputBytes: 4 },
      }),
    ).resolves.toMatchObject({ ok: false, kind: "too_large", limitBytes: 4 });
  });

  it("does NOT refuse an image-only PDF for PowerPoint: its page becomes a picture slide", async () => {
    // Beside the refusals above, which stay: a Word or Excel file of a scan
    // is empty, but a slide can carry the page as it looks. Until 2026-10-10
    // PowerPoint refused the scan exactly like the other two.
    const fixture = await scannedPdf();
    const run = await runPdfOfficeExport(
      "pdf-to-powerpoint",
      fixture.pdf,
      pptxDeps(fixture),
    );
    expect(run).toMatchObject({
      ok: true,
      coverage: { textPageCount: 0, picturePageCount: 1, pagesAsPictures: [1] },
    });
  });

  it("answers `unsupported` for PowerPoint without the page reader: no text-only fallback", async () => {
    // A deck with no pictures is the defect the reader replaced, not a
    // lesser success, so a worker that cannot read pages does not write one.
    await expect(
      runPdfOfficeExport("pdf-to-powerpoint", PDF, { extract }),
    ).resolves.toMatchObject({ ok: false, kind: "unsupported" });
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
      scanPages: noPictures,
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
      scanPages: noPictures,
      extract: layoutExtract,
      extractFlow: flowOf(TABLE_BBOX),
    });
    expect(paragraphs).toEqual(TABLE_ROWS.map((row) => row.join("\t")));
  });

  it("never falls back to the layout extractor when the flow one is missing", async () => {
    await expect(
      runPdfOfficeExport("pdf-to-word", PDF, {
        scanPages: noPictures,
        extract: layoutExtract,
      }),
    ).resolves.toMatchObject({ ok: false, kind: "unsupported" });
  });

  it("puts a page break between pages and keeps spaces verbatim", async () => {
    const run = await runPdfOfficeExport("pdf-to-word", PDF, {
      scanPages: noPictures,
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
      scanPages: noPictures,
      extractFlow: refused,
    });
    expect(run).toMatchObject({ ok: false, kind: "password_protected" });
    if (!run.ok) expect(run.message).toMatch(/Unlock PDF/);
  });

  it("names an unencrypted PDF that will not open as unreadable", async () => {
    const plain = await (await PDFDocument.create()).save();
    await expect(
      runPdfOfficeExport("pdf-to-word", plain, {
        scanPages: noPictures,
        extractFlow: refused,
      }),
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
    // PowerPoint's page reader is wired and never reached: pdftotext refuses
    // the file first, and the refusal is classified as Excel's is.
    let scanned = 0;
    for (const tool of ["pdf-to-excel", "pdf-to-powerpoint"] as const)
      await expect(
        runPdfOfficeExport(tool, locked, {
          extract: refusedLayout,
          scanPages: async (bytes) => {
            scanned++;
            return scanPdfPages(bytes);
          },
        }),
      ).resolves.toMatchObject({ ok: false, kind: "password_protected" });
    expect(scanned).toBe(0);
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
          scanPages: noPictures,
          extractFlow: throwing(error),
        }),
      ).resolves.toMatchObject({ ok: false, kind: "failed" });
  });

  it("reports an extractor output ceiling as too large, not as a retryable failure", async () => {
    await expect(
      runPdfOfficeExport("pdf-to-word", PDF, {
        scanPages: noPictures,
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
      scanPages: noPictures,
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
      scanPages: noPictures,
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
    await expect(
      runPdfOfficeExport("pdf-to-excel", PDF, { extract: mixed }),
    ).resolves.toMatchObject({
      ok: true,
      coverage: { pageCount: 3, textPageCount: 1, pagesWithoutText: [1, 3] },
    });
    // PowerPoint measures from the text its page reader found, which is what
    // went into its slides, not from pdftotext's, which it does not write.
    // (Until 2026-10-10 both read pdftotext's, in the loop this replaced.)
    await expect(
      runPdfOfficeExport("pdf-to-powerpoint", PDF, {
        extract: mixed,
        scanPages: scanning(
          textScan([
            [],
            ["Region   Q1   Q2   Q3", "North   1200   1350   1410"],
            [],
          ]),
        ),
      }),
    ).resolves.toMatchObject({
      ok: true,
      coverage: { pageCount: 3, textPageCount: 1, pagesWithoutText: [1, 3] },
    });
  });

  it("names the pages PowerPoint keeps only as pictures, measured from the slides it wrote", async () => {
    // Page 1 has text and a picture; page 2 is a scan; page 3 is blank.
    const scan = await scannedPdf();
    const doc = await PDFDocument.create();
    const [lines, scanPage] = await Promise.all([
      PDFDocument.load(
        (await linesPdf([["A typed page"]], { picture: true })).pdf,
      ),
      PDFDocument.load(scan.pdf),
    ]);
    const [p1] = await doc.copyPages(lines, [0]);
    const [p2] = await doc.copyPages(scanPage, [0]);
    doc.addPage(p1!);
    doc.addPage(p2!);
    doc.addPage([720, 540]);
    const run = await runPdfOfficeExport(
      "pdf-to-powerpoint",
      await doc.save(),
      { extract, scanPages: scanPdfPages },
    );
    expect(run).toMatchObject({
      ok: true,
      coverage: {
        pageCount: 3,
        textPageCount: 1,
        pagesWithoutText: [2, 3],
        picturePageCount: 1,
        pagesAsPictures: [2],
      },
    });
  });

  it("POSITIVE CONTROL: reports nothing missing when every page has real text", async () => {
    const run = await runPdfOfficeExport("pdf-to-word", PDF, {
      scanPages: noPictures,
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
  //
  // Since 2026-10-10 the slides are written from the page reader's scan, not
  // from pdftotext's `-layout` lines: each line of text is its own box at its
  // place. The cases about the WRITER hand it a scan built by hand
  // (`@/tests/page-scan-stubs`); the cases about what a PDF KEEPS read a real
  // one (`faithful.test.ts`).
  async function deck(scan: ReturnType<typeof textScan>): Promise<Uint8Array> {
    const run = await runPdfOfficeExport("pdf-to-powerpoint", PDF, {
      extract,
      scanPages: scanning(scan),
    });
    if (!run.ok) throw new Error(`pdf-to-powerpoint failed: ${run.kind}`);
    return run.output;
  }

  it("writes one slide per page, textless pages included, through the whole chain", async () => {
    const read = await readPptx(
      await deck(textScan([["Name Amount", "Alice 10"], [], ["Bob 20"]])),
    );
    expect(read.problems).toEqual([]);
    // Health check on the walk: every slide, plus presentation, master,
    // layout and theme. A walk that reached nothing would find nothing wrong.
    expect(read.reached).toHaveLength(3 + 4);
    // A textless page is still a slide — slide N is page N. INVERTED
    // 2026-10-10: it used to hold one text box with the one empty paragraph
    // the schema requires (read back as [""]); a page with nothing on it now
    // gets a slide with nothing on it, and so no text body to need one.
    expect(read.slides).toEqual([["Name Amount", "Alice 10"], [], ["Bob 20"]]);
  });

  it("names every slide part by its position, not by the page number it came from", async () => {
    // Parts, content types, relationships and slide ids all key on the same
    // index. They used to disagree: the part was named after `pageNumber`,
    // everything pointing at it after the loop index.
    const read = await readPptx(
      await deck(textScan([["fourth"], ["ninth"]], [4, 9])),
    );
    expect(read.problems).toEqual([]);
    expect(read.slides).toEqual([["fourth"], ["ninth"]]);
  });

  it("strips XML-illegal control characters from every Office output, keeping markup as text", async () => {
    // One stray control character from pdftotext made the whole part
    // malformed XML — for Word and PowerPoint alike, which escaped `<` and
    // `&` but not these. Excel's writer already stripped them. PowerPoint's
    // text now comes from the page reader, which can hand the writer the
    // same characters (a font's ToUnicode map says what it says).
    const text = "A\u0001 <b>&amp;</b> \u001Fz\u000Bend";
    const outputs = await Promise.all([
      runPdfOfficeExport("pdf-to-word", PDF, {
        scanPages: noPictures,
        extractFlow: flowPages([text]),
      }),
      runPdfOfficeExport("pdf-to-excel", PDF, {
        extract: async () => ({
          pageCount: 1,
          pages: [{ pageNumber: 1, text, characterCount: text.length }],
          text,
          characterCount: text.length,
          hasText: true,
        }),
      }),
      runPdfOfficeExport("pdf-to-powerpoint", PDF, {
        extract,
        scanPages: scanning(textScan([[text]])),
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

  it("writes a deck PowerPoint opens for EVERY committed fidelity fixture, through the real page reader", async () => {
    // Discovered, not named: every fixture the fidelity proof runs. Until
    // 2026-10-10 this swept the captured poppler `-layout` samples, which
    // PowerPoint no longer reads (Excel still does; its sweep is above).
    expect(PPTX_FIDELITY_FIXTURES.length).toBeGreaterThanOrEqual(4);
    for (const build of PPTX_FIDELITY_FIXTURES) {
      const fixture = await build();
      const run = await runPdfOfficeExport(
        "pdf-to-powerpoint",
        fixture.pdf,
        pptxDeps(fixture),
      );
      if (!run.ok) throw new Error(`${fixture.name}: ${run.kind}`);
      const read = await readPptx(run.output);
      expect(read.problems, fixture.name).toEqual([]);
      expect(read.slides, fixture.name).toHaveLength(fixture.pages.length);
    }
    // Budget, not assertion (2026-10-30): up to 5.0 s on CI's slower 4-vCPU
    // runners in the full unit run (26 logs, 10-24..10-30), against vitest's
    // 5-second default, and it timed out there on 2026-10-30 (run 41059569399).
    // The work is the same; the runner is not. `src/tests/timeout-headroom.ts`
    // names the next test past half its budget on every CI run.
  }, 30_000);

  it("NEGATIVE CONTROL: the engine's own deck goes red without its master list", async () => {
    // Run through the detector, on the writer's real output — the shape of
    // the defect that shipped.
    const zip = await JSZip.loadAsync(
      await deck(textScan([["Name Amount", "Alice 10"], ["Bob 20"]])),
    );
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

/**
 * ── PDF TO POWERPOINT MUST WRITE A FILE POWERPOINT OPENS ─────────────────────
 *
 * Until 2026-09-27 pptx() wrote presentation.xml and one slide per page, and no
 * slide master, slide layout or theme. PowerPoint 16.0 for Windows refused
 * every such file through COM `Presentations.Open` with "The file or directory
 * is corrupted and unreadable" (0x80070570), while a deck PowerPoint saved
 * itself reopened in the same run. The test above stayed green throughout.
 *
 * These read the file the way a consumer does: from the package root, through
 * the relationship chain, with a real XML parser, never by guessing a filename.
 * `scripts/prove-pptx-opens.ts` is the check against PowerPoint itself; this is
 * the part of it CI can run.
 */
describe("pdf-to-powerpoint package", () => {
  const PAGES = [
    ["Quarterly review", "Revenue & costs <draft>"],
    [],
    ['Next steps "quoted"', "Thanks"],
  ];

  async function exportDeck(): Promise<Uint8Array> {
    const run = await runPdfOfficeExport("pdf-to-powerpoint", PDF, {
      extract,
      scanPages: scanning(textScan(PAGES)),
    });
    if (!run.ok) throw new Error(`export failed: ${run.message}`);
    return run.output;
  }

  it("carries the slide master → layout → theme chain, every relationship resolving", async () => {
    const inspection = await inspectPptxPackage(await exportDeck(), {
      wellFormed: xmlWellFormedness,
    });
    expect(inspection.problems).toEqual([]);
    // `problems: []` is only a pass next to counts that could not be zero: a
    // walk that reached nothing has nothing to complain about.
    expect(inspection.counts).toMatchObject({
      masters: 1,
      themes: 1,
      slides: PAGES.length,
    });
    expect(inspection.counts.layouts).toBeGreaterThanOrEqual(1);
    expect(inspection.counts.reached).toBe(inspection.counts.parts);
  });

  it("puts each page's lines on its own slide, in presentation order", async () => {
    const zip = await JSZip.loadAsync(await exportDeck());
    const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
    const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
    const R =
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const xml = async (name: string) =>
      parseXml(await zip.file(name)!.async("string"));

    // Follow the chain a reader follows: sldIdLst order → rels → part.
    const presentation = await xml("ppt/presentation.xml");
    const rels = await xml("ppt/_rels/presentation.xml.rels");
    const targetOf = new Map(
      [...rels.getElementsByTagName("Relationship")].map((r) => [
        r.getAttribute("Id"),
        r.getAttribute("Target"),
      ]),
    );
    const slideParts = [...presentation.getElementsByTagNameNS(P, "sldId")].map(
      (s) => `ppt/${targetOf.get(s.getAttributeNS(R, "id"))}`,
    );
    expect(slideParts).toHaveLength(PAGES.length);

    const slideTexts: string[][] = [];
    for (const part of slideParts) {
      const slide = await xml(part);
      slideTexts.push(
        [...slide.getElementsByTagNameNS(A, "p")]
          .map((p) =>
            [...p.getElementsByTagNameNS(A, "t")]
              .map((t) => t.textContent)
              .join(""),
          )
          .filter((line) => line.length > 0),
      );
    }
    expect(slideTexts).toEqual([
      ["Quarterly review", "Revenue & costs <draft>"],
      [],
      ['Next steps "quoted"', "Thanks"],
    ]);
  });
});

/**
 * ── THE DECK IS INSPECTED BEFORE IT IS DELIVERED ────────────────────────────
 *
 * Both checks that certified the refused deck ran somewhere else: a unit test
 * on `main`, a deployment proof after the fact. The engine handed every user
 * whatever the writer returned. It now runs `./pptx-inspect` — the inspector
 * the worker's start-up probe also runs, which needs nothing the image lacks —
 * over its own output, and a deck that fails is a failure, not a download.
 * Since 2026-10-10 that includes every picture the deck was planned with.
 */
describe("pdf-to-powerpoint is inspected before it is delivered", () => {
  const pages = [
    { pageNumber: 1, text: "First page", characterCount: 10 },
    { pageNumber: 2, text: "Second page", characterCount: 11 },
  ];
  const twoPages = {
    extract,
    scanPages: scanning(textScan([["First page"], ["Second page"]])),
  };

  it("refuses to deliver the deck PowerPoint refused, from a writer that regressed to it", async () => {
    const run = await runPdfOfficeExport("pdf-to-powerpoint", PDF, {
      ...twoPages,
      writePptx: () => pptxBefore20260927(pages),
    });
    expect(run).toMatchObject({ ok: false, kind: "incomplete_output" });
    if (!run.ok) expect(run.message).toMatch(/not delivered/);
  });

  it("refuses a complete deck that is a slide short of the PDF", async () => {
    // Structurally whole, so only the count can see it: one slide per page is
    // the promise, and a writer that dropped a page keeps every other check.
    const run = await runPdfOfficeExport("pdf-to-powerpoint", PDF, {
      ...twoPages,
      writePptx: (deck) =>
        pptxPackage({ ...deck, slides: deck.slides.slice(1) }),
    });
    expect(run).toMatchObject({ ok: false, kind: "incomplete_output" });
  });

  it("refuses a complete deck that dropped a picture the page has", async () => {
    // Structurally whole again: a writer that skipped a picture still writes
    // a valid package, and only the planned count can see it.
    const fixture = await imageCaptionPdf();
    const run = await runPdfOfficeExport("pdf-to-powerpoint", fixture.pdf, {
      ...pptxDeps(fixture),
      writePptx: (deck) =>
        pptxPackage({
          ...deck,
          slides: deck.slides.map((s) => ({
            ...s,
            shapes: s.shapes.filter(
              (sh, i) => sh.kind !== "picture" || i !== 0,
            ),
          })),
        }),
    });
    expect(run).toMatchObject({ ok: false, kind: "incomplete_output" });
    if (!run.ok) expect(run.message).toMatch(/pictures/);
  });

  it("POSITIVE CONTROL: delivers what the real writer writes", async () => {
    const run = await runPdfOfficeExport("pdf-to-powerpoint", PDF, twoPages);
    expect(run).toMatchObject({ ok: true, filenameExt: "pptx" });
    const fixture = await imageCaptionPdf();
    await expect(
      runPdfOfficeExport("pdf-to-powerpoint", fixture.pdf, pptxDeps(fixture)),
    ).resolves.toMatchObject({ ok: true, filenameExt: "pptx" });
  });
});
