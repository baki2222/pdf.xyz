import { describe, expect, it, vi } from "vitest";
import { sanitizeJobResults } from "@/lib/jobs/results";
import { OFFICE_EXPORT_ERROR_CODES } from "@/lib/jobs/office-export-results";
import { rc4EncryptedPdf } from "@/tests/pdf-office-fixtures";
import { PdfTextExecError } from "../pdf-text/errors";
import type { PdfFlowExtractor } from "../pdf-office-export/engine";
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
    const processor = createPdfOfficeExportProcessor({ extract, extractFlow });
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
      expect(result.meta).toMatchObject({
        engine: "pdftotext-office-openxml",
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

  it("is ready only when BOTH extractors are wired — it claims all three tools", () => {
    // Excel and PowerPoint read `extract`; Word reads `extractFlow`. One
    // without the other would advertise a tool that answers `unsupported`.
    expect(createPdfOfficeExportProcessor({ extract }).capability().ready).toBe(
      false,
    );
    expect(
      createPdfOfficeExportProcessor({ extractFlow }).capability().ready,
    ).toBe(false);
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
      limits: { maxOutputBytes: 1 },
    }).process(oneInput());
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({
        code: "payload_too_large",
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
    }).process(oneInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The persistence boundary is a whitelist: a block it does not know is
    // dropped without a sound, so assert on what survives it.
    expect(sanitizeJobResults(result.results)?.officeExport).toEqual({
      pageCount: 3,
      textPageCount: 1,
      pagesWithoutText: [2, 3],
      littleTextPageCount: 0,
      pagesWithLittleText: [],
    });
  });
});
