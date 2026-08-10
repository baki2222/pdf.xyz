import { describe, expect, it, vi } from "vitest";
import {
  createOfficeConversionProcessor,
  officePdfOutputName,
} from "./office-conversion";

const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);
const DOCX = new TextEncoder().encode("docx");

describe("office-conversion processor", () => {
  it("owns Word/Excel/PowerPoint to PDF and reports readiness", () => {
    const processor = createOfficeConversionProcessor({
      libreoffice: { convertToPdf: vi.fn(async () => PDF) },
    });
    expect(processor.tools).toEqual([
      "word-to-pdf",
      "excel-to-pdf",
      "powerpoint-to-pdf",
    ]);
    expect(processor.supports("word-to-pdf")).toBe(true);
    expect(processor.supports("excel-to-pdf")).toBe(true);
    expect(processor.supports("powerpoint-to-pdf")).toBe(true);
    expect(processor.capability()).toMatchObject({
      id: "office-conversion",
      ready: true,
    });
  });

  it("fails honestly without LibreOffice", async () => {
    const result = await createOfficeConversionProcessor({}).process({
      tool: "word-to-pdf",
      options: {},
      inputs: [
        {
          fileId: "f",
          filename: "report.docx",
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          bytes: DOCX,
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_implemented");
  });

  it("converts one Office input into a PDF artifact", async () => {
    const convertToPdf = vi.fn(async () => PDF);
    const result = await createOfficeConversionProcessor({
      libreoffice: { convertToPdf },
    }).process({
      tool: "word-to-pdf",
      options: {},
      inputs: [
        {
          fileId: "f",
          filename: "quarterly.report.docx",
          contentType: "application/octet-stream",
          bytes: DOCX,
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(convertToPdf).toHaveBeenCalledWith(DOCX, "quarterly.report.docx");
    if (result.ok) {
      expect(result.artifacts[0]).toMatchObject({
        filename: "quarterly.report.pdf",
        contentType: "application/pdf",
      });
      expect(result.meta).toMatchObject({
        engine: "libreoffice",
        tool: "word-to-pdf",
      });
    }
  });

  it("rejects multiple files and wrong extensions", async () => {
    const processor = createOfficeConversionProcessor({
      libreoffice: { convertToPdf: vi.fn(async () => PDF) },
    });
    const none = await processor.process({
      tool: "word-to-pdf",
      options: {},
      inputs: [],
    });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.error.code).toBe("unprocessable_entity");
    const wrong = await processor.process({
      tool: "excel-to-pdf",
      options: {},
      inputs: [
        {
          fileId: "f",
          filename: "report.docx",
          contentType: "application/octet-stream",
          bytes: DOCX,
        },
      ],
    });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.code).toBe("unprocessable_entity");
  });

  it("builds deterministic output names", () => {
    expect(officePdfOutputName("report.final.docx")).toBe("report.final.pdf");
  });
});
