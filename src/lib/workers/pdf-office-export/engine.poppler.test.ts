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
  partlyScannedPdf,
  quarterlyTablePdf,
  rc4EncryptedPdf,
  TABLE_ROWS,
  twoColumnReportPdf,
} from "@/tests/pdf-office-fixtures";
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
});
