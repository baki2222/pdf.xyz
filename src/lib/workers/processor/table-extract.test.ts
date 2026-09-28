import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import {
  createTableExtractProcessor,
  tableExtractOutputName,
} from "./table-extract";
import type { PdfLayout } from "../table-extract/engine";
import { PDFDocument } from "pdf-lib";
import { PdfTextExecError } from "../pdf-text/errors";
import { OFFICE_EXPORT_ERROR_CODES } from "@/lib/jobs/office-export-results";
import { rc4EncryptedPdf } from "@/tests/pdf-office-fixtures";

const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);

function tableLayout(): PdfLayout {
  return {
    pageCount: 1,
    pages: [
      {
        pageNumber: 1,
        width: 400,
        height: 300,
        items: [
          { text: "Name", x: 50, y: 100, width: 20, height: 10 },
          { text: "Age", x: 200, y: 100, width: 15, height: 10 },
          { text: "Alice", x: 50, y: 80, width: 25, height: 10 },
          { text: "30", x: 200, y: 80, width: 10, height: 10 },
        ],
      },
    ],
  };
}

const extractLayout = vi.fn(async () => tableLayout());

describe("table-extract processor", () => {
  it("owns extract-tables and reports readiness", () => {
    const processor = createTableExtractProcessor({ extractLayout });
    expect(processor.tools).toEqual(["extract-tables"]);
    expect(processor.supports("extract-tables")).toBe(true);
    expect(processor.capability()).toMatchObject({
      id: "table-extract",
      ready: true,
    });
  });

  it("fails honestly without a layout extractor", async () => {
    const result = await createTableExtractProcessor({}).process({
      tool: "extract-tables",
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

  it("extracts one PDF input to a ZIP artifact of real tables", async () => {
    const processor = createTableExtractProcessor({
      extractLayout,
      limits: {},
    });
    const result = await processor.process({
      tool: "extract-tables",
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
        filename: "annual.report-tables.zip",
        contentType: "application/zip",
      });
      expect(result.meta).toMatchObject({
        engine: "pdftotext-layout-tables",
        tool: "extract-tables",
        tableCount: 1,
      });
      const zip = await JSZip.loadAsync(result.artifacts[0]!.bytes);
      expect(await zip.file("table-1.csv")!.async("string")).toBe(
        "Name,Age\r\nAlice,30",
      );
    }
  });

  it("fails as unprocessable when no tables are present", async () => {
    const prose = vi.fn(async () => ({
      pageCount: 1,
      pages: [
        {
          pageNumber: 1,
          width: 400,
          height: 300,
          items: [
            {
              text: "Just running prose here.",
              x: 50,
              y: 100,
              width: 120,
              height: 10,
            },
          ],
        },
      ],
    }));
    const result = await createTableExtractProcessor({
      extractLayout: prose,
    }).process({
      tool: "extract-tables",
      options: {},
      inputs: [
        {
          fileId: "f",
          filename: "essay.pdf",
          contentType: "application/pdf",
          bytes: PDF,
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unprocessable_entity");
  });

  it("rejects malformed input count", async () => {
    const result = await createTableExtractProcessor({ extractLayout }).process(
      { tool: "extract-tables", options: {}, inputs: [] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unprocessable_entity");
  });

  it("builds deterministic output names", () => {
    expect(tableExtractOutputName("annual.report.pdf", "zip")).toBe(
      "annual.report-tables.zip",
    );
  });
});

/**
 * What the EXECUTOR sees. `retryable: true` requeues the job with backoff, so a
 * document-level failure marked retryable costs the user every attempt and
 * then says nothing new. The codes are the shared document-failure codes the
 * panel links its next step from (OCR, Unlock, Repair).
 */
describe("table-extract processor — document failures are final and name their next step", () => {
  const job = (bytes: Uint8Array) => ({
    tool: "extract-tables",
    options: {},
    inputs: [
      {
        fileId: "f",
        filename: "statement.pdf",
        contentType: "application/pdf",
        bytes,
      },
    ],
  });
  const refused = async (): Promise<PdfLayout> => {
    throw new PdfTextExecError({
      exitCode: 1,
      killed: false,
      outputTooLarge: false,
    });
  };

  it("a password-protected PDF is not retried and carries the unlock code", async () => {
    const locked = rc4EncryptedPdf({ userPassword: "pw", ownerPassword: "o" });
    const result = await createTableExtractProcessor({
      extractLayout: refused,
    }).process(job(locked));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      code: OFFICE_EXPORT_ERROR_CODES.passwordProtected,
      retryable: false,
    });
    expect(result.error.message).toMatch(/Unlock PDF/);
  });

  it("a damaged PDF is not retried and carries the repair code", async () => {
    const plain = await (await PDFDocument.create()).save();
    const result = await createTableExtractProcessor({
      extractLayout: refused,
    }).process(job(plain));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({
        code: OFFICE_EXPORT_ERROR_CODES.unreadable,
        retryable: false,
      });
  });

  it("a scanned PDF carries the OCR code", async () => {
    const result = await createTableExtractProcessor({
      extractLayout: async () => ({
        pageCount: 1,
        pages: [{ pageNumber: 1, width: 400, height: 300, items: [] }],
      }),
    }).process(job(PDF));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({
        code: OFFICE_EXPORT_ERROR_CODES.noText,
        retryable: false,
      });
  });

  it("an output ceiling is final: payload_too_large, not retried", async () => {
    const result = await createTableExtractProcessor({
      extractLayout,
      limits: { maxOutputBytes: 1 },
    }).process(job(PDF));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({
        code: "payload_too_large",
        retryable: false,
      });
  });

  it("POSITIVE CONTROL: a run that did not finish stays retryable", async () => {
    const result = await createTableExtractProcessor({
      extractLayout: async () => {
        throw new PdfTextExecError({
          exitCode: null,
          killed: true,
          outputTooLarge: false,
        });
      },
    }).process(job(PDF));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({
        code: "internal_error",
        retryable: true,
      });
  });
});
