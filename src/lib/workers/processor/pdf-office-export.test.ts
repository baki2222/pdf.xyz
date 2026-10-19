// @native-canvas
import { describe, expect, it, vi } from "vitest";
import { sanitizeJobResults } from "@/lib/jobs/results";
import { OFFICE_EXPORT_ERROR_CODES } from "@/lib/jobs/office-export-results";
import { rc4EncryptedPdf } from "@/tests/pdf-office-fixtures";
import { pptxBefore20260927 } from "@/tests/pptx-before-2026-09-27";
import { PdfTextExecError } from "../pdf-text/errors";
import type { PdfFlowExtractor } from "../pdf-office-export/engine";
import { scanPdfPages } from "../pdf-office-export/page-scan";
import {
  scannedPdf,
  undecodablePicturePdf,
} from "@/tests/pptx-fidelity-fixtures";
import {
  blankPages,
  noPictures,
  scanning,
  textScan,
} from "@/tests/page-scan-stubs";
import { scanBetweenPagesPdf } from "@/tests/docx-picture-fixtures";
import { flowStandIn } from "@/tests/poppler-flow-standin";
import {
  createPdfOfficeExportProcessor,
  pdfOfficeExportOutputName,
} from "./pdf-office-export";

const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);
const extract = vi.fn(async () => ({
  pageCount: 1,
  pages: [{ pageNumber: 1, text: "Hello", characterCount: 5 }],
  text: "Hello",
  characterCount: 5,
  hasText: true,
}));
const extractFlow = vi.fn<PdfFlowExtractor>(async () => ({
  pageCount: 1,
  pages: [{ pageNumber: 1, paragraphs: [["Hello"]] }],
}));

function oneInput(bytes: Uint8Array = PDF) {
  return {
    tool: "pdf-to-word",
    options: {},
    inputs: [
      {
        fileId: "f",
        filename: "report.pdf",
        contentType: "application/pdf",
        bytes,
      },
    ],
  };
}

describe("pdf-office-export processor", () => {
  it("owns PDF to Word/Excel/PowerPoint and reports readiness", () => {
    const processor = createPdfOfficeExportProcessor({
      extract,
      extractFlow,
      scanPages: scanPdfPages,
    });
    expect(processor.tools).toEqual([
      "pdf-to-word",
      "pdf-to-excel",
      "pdf-to-powerpoint",
    ]);
    expect(processor.supports("pdf-to-word")).toBe(true);
    expect(processor.capability()).toMatchObject({
      id: "pdf-office-export",
      ready: true,
    });
  });

  it("fails honestly without extractor", async () => {
    const result = await createPdfOfficeExportProcessor({}).process({
      tool: "pdf-to-word",
      options: {},
      inputs: [
        {
          fileId: "f",
          filename: "report.pdf",
          contentType: "application/pdf",
          bytes: PDF,
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_implemented");
  });

  it("exports one PDF input to an Office artifact", async () => {
    const processor = createPdfOfficeExportProcessor({
      extract,
      extractFlow,
      scanPages: noPictures,
      limits: {},
    });
    const result = await processor.process({
      tool: "pdf-to-word",
      options: {},
      inputs: [
        {
          fileId: "f",
          filename: "annual.report.pdf",
          contentType: "application/pdf",
          bytes: PDF,
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifacts[0]).toMatchObject({
        filename: "annual.report.docx",
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      // "pdftotext-office-openxml" until 2026-10-17, when Word began
      // carrying pictures through the page reader.
      expect(result.meta).toMatchObject({
        engine: "pdftotext-pdfjs-docx-pictures",
        tool: "pdf-to-word",
      });
    }
  });

  it("rejects malformed input count", async () => {
    const result = await createPdfOfficeExportProcessor({ extract }).process({
      tool: "pdf-to-word",
      options: {},
      inputs: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unprocessable_entity");
  });

  it("builds deterministic output names", () => {
    expect(pdfOfficeExportOutputName("annual.report.pdf", "docx")).toBe(
      "annual.report.docx",
    );
  });

  it("is ready only when ALL THREE readers are wired — it claims all three tools", () => {
    // Excel reads `extract`; Word reads `extractFlow`; PowerPoint reads
    // `scanPages` (since 2026-10-10; before, `extract`). Any one missing
    // would advertise a tool that answers `unsupported`.
    expect(createPdfOfficeExportProcessor({ extract }).capability().ready).toBe(
      false,
    );
    expect(
      createPdfOfficeExportProcessor({ extractFlow }).capability().ready,
    ).toBe(false);
    const noReader = createPdfOfficeExportProcessor({ extract, extractFlow });
    expect(noReader.capability().ready).toBe(false);
    expect(noReader.capability().detail).toMatch(/page reader/);
  });

  it("does not retry what a retry cannot fix, and says which tool fixes it", async () => {
    const refused = async () => {
      throw new PdfTextExecError({
        exitCode: 1,
        killed: false,
        outputTooLarge: false,
      });
    };
    const locked = await createPdfOfficeExportProcessor({
      extract,
      extractFlow: refused,
      scanPages: noPictures,
    }).process(
      oneInput(rc4EncryptedPdf({ userPassword: "pw", ownerPassword: "own" })),
    );
    expect(locked.ok).toBe(false);
    if (!locked.ok)
      expect(locked.error).toEqual({
        code: OFFICE_EXPORT_ERROR_CODES.passwordProtected,
        message:
          "This PDF is password-protected. Unlock it with Unlock PDF, then convert it.",
        retryable: false,
      });

    const damaged = await createPdfOfficeExportProcessor({
      extract,
      extractFlow: refused,
      scanPages: noPictures,
    }).process(oneInput());
    expect(damaged.ok).toBe(false);
    if (!damaged.ok)
      expect(damaged.error).toMatchObject({
        code: OFFICE_EXPORT_ERROR_CODES.unreadable,
        retryable: false,
      });

    const scanned = await createPdfOfficeExportProcessor({
      extract,
      extractFlow: async () => ({
        pageCount: 1,
        pages: [{ pageNumber: 1, paragraphs: [] }],
      }),
      scanPages: noPictures,
    }).process(oneInput());
    expect(scanned.ok).toBe(false);
    if (!scanned.ok)
      expect(scanned.error).toMatchObject({
        code: OFFICE_EXPORT_ERROR_CODES.noText,
        retryable: false,
      });
  });

  it("an exported file over the output ceiling is final — the same PDF renders the same file every attempt", async () => {
    const result = await createPdfOfficeExportProcessor({
      extract,
      extractFlow,
      scanPages: noPictures,
      limits: { maxOutputBytes: 1 },
    }).process(oneInput());
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({
        code: "payload_too_large",
        retryable: false,
      });
  });

  it("a .pptx that failed its own inspection is final, and is not a download", async () => {
    // The writer is deterministic: the same text writes the same broken file
    // on every attempt, so a retry would only spend the worker twice more.
    const result = await createPdfOfficeExportProcessor({
      extract,
      extractFlow,
      scanPages: scanning(textScan([["Hello"]])),
      writePptx: () =>
        pptxBefore20260927([
          { pageNumber: 1, text: "Hello", characterCount: 5 },
        ]),
    }).process({ ...oneInput(), tool: "pdf-to-powerpoint" });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({
        code: "internal_error",
        retryable: false,
      });
  });

  it("POSITIVE CONTROL: a run that did not finish stays retryable", async () => {
    const result = await createPdfOfficeExportProcessor({
      extract,
      extractFlow: async () => {
        throw new PdfTextExecError({
          exitCode: null,
          killed: true,
          outputTooLarge: false,
        });
      },
      scanPages: noPictures,
    }).process(oneInput());
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({
        code: "internal_error",
        retryable: true,
      });
  });

  it("carries which pages had text onto the job record (processor → sanitizeJobResults)", async () => {
    const result = await createPdfOfficeExportProcessor({
      extract,
      extractFlow: async () => ({
        pageCount: 3,
        pages: [
          {
            pageNumber: 1,
            paragraphs: [["A first page with a full sentence of real text."]],
          },
          { pageNumber: 2, paragraphs: [] },
          { pageNumber: 3, paragraphs: [] },
        ],
      }),
      scanPages: blankPages(3),
    }).process(oneInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The persistence boundary is a whitelist: a block it does not know is
    // dropped without a sound, so assert on what survives it. Since
    // 2026-10-17 Word reports what PowerPoint does about pictures (here,
    // none: the stub reader found none), and those fields cross it too.
    expect(sanitizeJobResults(result.results)?.officeExport).toEqual({
      pageCount: 3,
      textPageCount: 1,
      pagesWithoutText: [2, 3],
      littleTextPageCount: 0,
      pagesWithLittleText: [],
      picturePageCount: 0,
      pagesAsPictures: [],
      picturesNotCarried: 0,
      picturesTooLarge: 0,
      // Since the review of 2026-10-17: pictures left out over budget, and
      // the pages the reader SAW empty.
      picturesOverBudget: 0,
      pagesMissingPictures: [],
      emptyPageCount: 2,
      pagesEmpty: [2, 3],
    });
  });

  it("carries a Word document's picture-only pages onto the job record (processor → sanitizeJobResults)", async () => {
    // The composed chain for Word: a scan between two text pages through the
    // REAL page reader (poppler's reading order stood in for), then across
    // the boundary the panel reads its notice from.
    const fixture = await scanBetweenPagesPdf();
    const result = await createPdfOfficeExportProcessor({
      extract,
      extractFlow: flowStandIn,
      scanPages: scanPdfPages,
    }).process(oneInput(fixture.pdf));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sanitizeJobResults(result.results)?.officeExport).toEqual({
      pageCount: 3,
      textPageCount: 2,
      pagesWithoutText: [2],
      littleTextPageCount: 2,
      pagesWithLittleText: [1, 3],
      picturePageCount: 1,
      pagesAsPictures: [2],
      picturesNotCarried: 0,
      picturesTooLarge: 0,
      picturesOverBudget: 0,
      pagesMissingPictures: [],
      emptyPageCount: 0,
      pagesEmpty: [],
    });
  });
  it("carries the picture-only pages of a deck onto the job record (processor → sanitizeJobResults)", async () => {
    // The composed chain, not the unit: a field the engine reports and the
    // persistence whitelist drops reaches nobody. A scanned page through the
    // REAL page reader, then across the boundary the panel reads from.
    const fixture = await scannedPdf();
    const result = await createPdfOfficeExportProcessor({
      extract,
      extractFlow,
      scanPages: scanPdfPages,
    }).process({ ...oneInput(fixture.pdf), tool: "pdf-to-powerpoint" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Since 2026-10-11 the block also says what the slides do NOT carry and
    // which slides are empty, and those must cross the boundary too: the
    // panel's "nothing on it" now reads `emptySlideCount`, not a difference.
    expect(sanitizeJobResults(result.results)?.officeExport).toEqual({
      pageCount: 1,
      textPageCount: 0,
      pagesWithoutText: [1],
      littleTextPageCount: 0,
      pagesWithLittleText: [],
      picturePageCount: 1,
      pagesAsPictures: [1],
      picturesNotCarried: 0,
      picturesTooLarge: 0,
      pagesMissingPictures: [],
      emptySlideCount: 0,
      flattenedPageCount: 0,
      pagesFlattened: [],
    });
  });

  it("carries a picture the deck could not take onto the job record, page by page", async () => {
    const fixture = await undecodablePicturePdf();
    const result = await createPdfOfficeExportProcessor({
      extract,
      extractFlow,
      scanPages: scanPdfPages,
    }).process({ ...oneInput(fixture.pdf), tool: "pdf-to-powerpoint" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sanitizeJobResults(result.results)?.officeExport).toMatchObject({
      pageCount: 3,
      picturesNotCarried: 1,
      picturesTooLarge: 0,
      pagesMissingPictures: [2],
      emptySlideCount: 1,
    });
  });
});
