import { describe, expect, it, vi } from "vitest";
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

describe("pdf-office-export processor", () => {
  it("owns PDF to Word/Excel/PowerPoint and reports readiness", () => {
    const processor = createPdfOfficeExportProcessor({ extract });
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
    const processor = createPdfOfficeExportProcessor({ extract, limits: {} });
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
});
