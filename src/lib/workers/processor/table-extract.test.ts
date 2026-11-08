import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import {
  createTableExtractProcessor,
  tableExtractOutputName,
} from "./table-extract";
import { CSV_BOM, type PdfLayout } from "../table-extract/engine";
import { PDFDocument } from "pdf-lib";
import { PdfTextExecError } from "../pdf-text/errors";
import { OFFICE_EXPORT_ERROR_CODES } from "@/lib/jobs/office-export-results";
import { rc4EncryptedPdf } from "@/tests/pdf-office-fixtures";
import {
  COMBINED_CSV_NAME,
  EXTRACT_TABLES_NO_TABLES_CODE,
} from "@/lib/jobs/extract-tables-options";
import { sanitizeJobResults } from "@/lib/jobs/results";

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
      // Until 2026-11-06 this expected no byte-order mark (audit #31).
      expect(await zip.file("table-1.csv")!.async("string")).toBe(
        CSV_BOM + "Name,Age\r\nAlice,30",
      );
    }
  });

  /*
   * INVERTED 2026-11-08 (audit extract-tables#5). This expected the generic
   * `unprocessable_entity`, a code no panel links a next step from, so a
   * prose PDF ended on the error sentence alone. The failure now carries its
   * own code, and the panel offers PDF to Excel and OCR PDF from it.
   */
  it("fails with its own no-tables code when no tables are present", async () => {
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
    if (!result.ok)
      expect(result.error).toMatchObject({
        code: EXTRACT_TABLES_NO_TABLES_CODE,
        retryable: false,
      });
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

describe("table-extract processor — “Combine tables into one sheet” (audit extract-tables#2)", () => {
  function job(options: Record<string, unknown>) {
    return createTableExtractProcessor({ extractLayout, limits: {} }).process({
      tool: "extract-tables",
      options,
      inputs: [
        {
          fileId: "f",
          filename: "report.pdf",
          contentType: "application/pdf",
          bytes: PDF,
        },
      ],
    });
  }

  it("`combine: true` writes the one combined CSV, read back from the artifact", async () => {
    const result = await job({ combine: true });
    if (!result.ok) throw new Error(result.error.message);
    const zip = await JSZip.loadAsync(result.artifacts[0]!.bytes);
    expect(Object.keys(zip.files).sort()).toEqual([
      COMBINED_CSV_NAME,
      "tables.xlsx",
    ]);
    expect(result.meta).toMatchObject({ combined: true });
  });

  it("an empty bag is the old request: one CSV per table", async () => {
    const result = await job({});
    if (!result.ok) throw new Error(result.error.message);
    const zip = await JSZip.loadAsync(result.artifacts[0]!.bytes);
    expect(zip.file("table-1.csv")).not.toBeNull();
    expect(result.meta).toMatchObject({ combined: false });
  });

  it("a non-boolean `combine` is refused, not guessed", async () => {
    const result = await job({ combine: "yes" });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({
        code: "invalid_request",
        retryable: false,
      });
  });
});

describe("table-extract processor — what was found, on the job record (audit extract-tables#4)", () => {
  it("reports the table count and the pages tables came from, through the persistence boundary", async () => {
    const twoOfThree = vi.fn(async () => {
      const page = tableLayout().pages[0]!;
      return {
        pageCount: 3,
        pages: [
          { ...page, pageNumber: 1 },
          { ...page, pageNumber: 2, items: [] },
          { ...page, pageNumber: 3 },
        ],
      };
    });
    const result = await createTableExtractProcessor({
      extractLayout: twoOfThree,
    }).process({
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
    if (!result.ok) throw new Error(result.error.message);
    expect(sanitizeJobResults(result.results)?.tables).toEqual({
      tableCount: 2,
      pageCount: 3,
      tablePages: [1, 3],
      tablePagesTruncated: false,
      combined: false,
    });
  });
});
