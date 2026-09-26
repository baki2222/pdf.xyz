// @vitest-environment node
/**
 * PDF to Office export through a REAL poppler `pdftotext`, with the production
 * deps builder, read back from the file a user downloads.
 *
 * The unit tests beside this one run the same rules over captured poppler
 * output. This one exists because a capture is a point in time: it runs the
 * generated fixtures through whatever poppler is installed, so a poppler whose
 * reading order or error behaviour differs shows up here and not in a user's
 * document. The production worker runs a different poppler from a dev laptop;
 * run `pnpm worker:prove-tools pdf-to-word` against a deployment for that one.
 *
 * Skips VISIBLY when no poppler is installed (the suite name says so): Git for
 * Windows puts Xpdf's `pdftotext` first on PATH, and a run against that would
 * fail, or pass, for reasons that say nothing about the worker.
 */
import { describe, expect, it } from "vitest";
import {
  columnsReadInOrder,
  findPopplerPdfToText,
  highlightsPdf,
  HIGHLIGHTS_LEFT,
  HIGHLIGHTS_RIGHT,
  incomeStatementPdf,
  INVOICE_SHEET,
  invoicePdf,
  invoiceSheetMismatches,
  newsletterPdf,
  NEWSLETTER_LEFT,
  NEWSLETTER_RIGHT,
  paragraphsReadWhole,
  partlyScannedPdf,
  quarterlyTablePdf,
  rc4EncryptedPdf,
  rowsHeldTogether,
  sidebarPdf,
  SIDEBAR_LIST,
  SIDEBAR_MAIN,
  skuTablePdf,
  SKU_ROWS,
  STATEMENT_ROWS,
  TABLE_ROWS,
  twoColumnReportPdf,
  WIDE_ROW,
  wideRowPdf,
} from "@/tests/pdf-office-fixtures";
import { readXlsxSheet, sheetGridProblems } from "../ooxml/sheet-read";
import { nativePdfOfficeExportDeps } from "../pdf-text/native";
import { readDocxParagraphs } from "./docx-text";
import {
  runPdfOfficeExport,
  type PdfFlowExtractor,
  type PdfOfficeExportDeps,
} from "./engine";

const POPPLER = findPopplerPdfToText();
const suite = describe.skipIf(!POPPLER);
const label = POPPLER
  ? "PDF to Office export on real poppler"
  : "PDF to Office export on real poppler (SKIPPED: no poppler pdftotext found on PATH)";

/** The production deps builder, pointed at the poppler we found. */
function deps(): PdfOfficeExportDeps {
  return nativePdfOfficeExportDeps(
    { PDFXYZ_PDF_TEXT_BIN: POPPLER! },
    { resolveOnPath: () => true },
  );
}

async function docxParagraphs(
  input: Uint8Array,
  over: Partial<PdfOfficeExportDeps> = {},
): Promise<string[]> {
  const run = await runPdfOfficeExport("pdf-to-word", input, {
    ...deps(),
    ...over,
  });
  if (!run.ok) throw new Error(`pdf-to-word failed: ${run.kind}`);
  return readDocxParagraphs(run.output);
}

suite(label, () => {
  it("writes a two-column report column by column", async () => {
    const paragraphs = await docxParagraphs(await twoColumnReportPdf());
    expect(columnsReadInOrder(paragraphs)).toBe(true);
  });

  it("POSITIVE CONTROL: the same PDF through the -layout lines PDF to Word used to write fails", async () => {
    // What shipped: every `-layout` line its own paragraph. Built from the
    // real layout extractor, so the control is this poppler's output too.
    const { extract } = deps();
    const oldWord: PdfFlowExtractor = async (bytes) => {
      const text = await extract!(bytes);
      return {
        pageCount: text.pageCount,
        pages: text.pages.map((page) => ({
          pageNumber: page.pageNumber,
          paragraphs: page.text
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => [l]),
        })),
      };
    };
    const paragraphs = await docxParagraphs(await twoColumnReportPdf(), {
      extractFlow: oldWord,
    });
    expect(columnsReadInOrder(paragraphs)).toBe(false);
  });

  it("keeps a table's rows as rows", async () => {
    const paragraphs = await docxParagraphs(await quarterlyTablePdf());
    expect(paragraphs).toEqual(TABLE_ROWS.map((row) => row.join("\t")));
  });

  it("keeps a label / amount statement's rows as rows, long labels included", async () => {
    const paragraphs = await docxParagraphs(await incomeStatementPdf());
    expect(rowsHeldTogether(paragraphs, STATEMENT_ROWS)).toBe(true);
    expect(paragraphs).toEqual(STATEMENT_ROWS.map((row) => row.join("	")));
  });

  it("keeps a table with a text column as rows", async () => {
    const paragraphs = await docxParagraphs(await skuTablePdf());
    expect(rowsHeldTogether(paragraphs, SKU_ROWS)).toBe(true);
    expect(paragraphs).toEqual(SKU_ROWS.map((row) => row.join("	")));
  });

  it("writes aligned prose one whole paragraph at a time", async () => {
    // Short aligned last lines above aligned headings; a paragraph beside a
    // list of names; two columns of one-line sentences.
    expect(
      paragraphsReadWhole(await docxParagraphs(await newsletterPdf()), [
        NEWSLETTER_LEFT,
        NEWSLETTER_RIGHT,
      ]),
    ).toBe(true);
    expect(
      paragraphsReadWhole(await docxParagraphs(await sidebarPdf()), [
        [SIDEBAR_MAIN],
        [SIDEBAR_LIST],
      ]),
    ).toBe(true);
    expect(
      paragraphsReadWhole(await docxParagraphs(await highlightsPdf()), [
        [HIGHLIGHTS_LEFT],
        [HIGHLIGHTS_RIGHT],
      ]),
    ).toBe(true);
  });

  it("names a user-password PDF as password-protected, for all three tools", async () => {
    const locked = rc4EncryptedPdf({
      userPassword: "s3cret",
      ownerPassword: "owner",
    });
    for (const tool of [
      "pdf-to-word",
      "pdf-to-excel",
      "pdf-to-powerpoint",
    ] as const)
      await expect(
        runPdfOfficeExport(tool, locked, deps()),
      ).resolves.toMatchObject({ ok: false, kind: "password_protected" });
  });

  it("POSITIVE CONTROL: an owner-password-only PDF is encrypted AND still converts", async () => {
    // The reason encryption is never checked up front: this file carries an
    // /Encrypt dictionary and opens without a password.
    const ownerOnly = rc4EncryptedPdf({
      userPassword: "",
      ownerPassword: "owner",
      text: "Owner locked but readable",
    });
    expect(await docxParagraphs(ownerOnly)).toEqual([
      "Owner locked but readable",
    ]);
  });

  it("reports the scanned pages of a partly scanned PDF, for all three tools", async () => {
    const scan = await partlyScannedPdf(5, [1]);
    for (const tool of [
      "pdf-to-word",
      "pdf-to-excel",
      "pdf-to-powerpoint",
    ] as const)
      await expect(
        runPdfOfficeExport(tool, scan, deps()),
      ).resolves.toMatchObject({
        ok: true,
        coverage: {
          pageCount: 5,
          textPageCount: 1,
          pagesWithoutText: [2, 3, 4, 5],
          // The 32-character stamp is the only text on page 1.
          littleTextPageCount: 1,
          pagesWithLittleText: [1],
        },
      });
  });

  it.each([16, 24])(
    "PDF to Excel writes an invoice cell for cell — rows %ipt apart",
    async (rowGap) => {
      const run = await runPdfOfficeExport(
        "pdf-to-excel",
        await invoicePdf(rowGap),
        deps(),
      );
      if (!run.ok) throw new Error(`pdf-to-excel failed: ${run.kind}`);
      const sheet = await readXlsxSheet(run.output);
      expect(sheet.rows).toHaveLength(INVOICE_SHEET.length);
      expect(invoiceSheetMismatches(sheet)).toEqual([]);
      expect(sheetGridProblems(sheet)).toEqual([]);
    },
  );

  it("PDF to Excel gives a 30-column row AA… references, each once, in order", async () => {
    const run = await runPdfOfficeExport(
      "pdf-to-excel",
      await wideRowPdf(),
      deps(),
    );
    if (!run.ok) throw new Error(`pdf-to-excel failed: ${run.kind}`);
    const sheet = await readXlsxSheet(run.output);
    expect(sheetGridProblems(sheet)).toEqual([]);
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0]!.cells.map((c) => c.value)).toEqual(WIDE_ROW);
    expect(sheet.rows[0]!.cells.at(-1)!.ref).toBe("AD1");
  });
});
