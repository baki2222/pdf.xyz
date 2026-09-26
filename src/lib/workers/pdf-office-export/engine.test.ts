import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  columnsReadInOrder,
  LEFT_COLUMN,
  rc4EncryptedPdf,
  RIGHT_COLUMN,
  TABLE_ROWS,
} from "@/tests/pdf-office-fixtures";
import {
  TABLE_BBOX,
  TWO_COLUMN_BBOX,
  TWO_COLUMN_LAYOUT,
} from "@/tests/poppler-samples";
import { PdfTextExecError } from "../pdf-text/errors";
import { flowText, type PdfFlowText } from "../pdf-text/flow";
import { parseBboxFlow, parseLayoutText } from "../pdf-text/parse";
import { DOCX_PAGE_BREAK, readDocxParagraphs } from "./docx-text";
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
    if (pptx.ok)
      expect(await zipEntries(pptx.output)).toContain("ppt/slides/slide1.xml");
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
