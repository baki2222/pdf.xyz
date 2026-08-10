import { describe, expect, it, vi } from "vitest";
import { createPdfArchiveProcessor, pdfaOutputName } from "./pdf-archive";

const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);

function input(tool = "pdf-to-pdfa") {
  return {
    tool,
    options: {},
    inputs: [
      {
        fileId: "file_1",
        filename: "report.final.pdf",
        contentType: "application/pdf",
        bytes: PDF,
      },
    ],
  };
}

describe("pdf-archive processor", () => {
  it("registers pdf-to-pdfa and reports readiness from Ghostscript", () => {
    const processor = createPdfArchiveProcessor({
      ghostscript: { convertToPdfA: vi.fn() },
    });
    expect(processor.tools).toEqual(["pdf-to-pdfa"]);
    expect(processor.supports("pdf-to-pdfa")).toBe(true);
    expect(processor.capability()).toMatchObject({
      id: "pdf-archive",
      ready: true,
    });
  });

  it("fails honestly without Ghostscript", async () => {
    const result = await createPdfArchiveProcessor({}).process(input());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_implemented");
  });

  it("converts one PDF and names output safely", async () => {
    const processor = createPdfArchiveProcessor({
      ghostscript: { convertToPdfA: vi.fn(async () => PDF) },
    });
    const result = await processor.process(input());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifacts[0]?.filename).toBe("report.final-pdfa.pdf");
      expect(result.meta).toMatchObject({
        engine: "ghostscript",
        standard: "PDF/A-2b",
      });
    }
  });

  it("requires exactly one PDF input", async () => {
    const result = await createPdfArchiveProcessor({
      ghostscript: { convertToPdfA: vi.fn() },
    }).process({
      tool: "pdf-to-pdfa",
      options: {},
      inputs: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unprocessable_entity");
  });

  it("builds deterministic output names", () => {
    expect(pdfaOutputName("very.long.name.pdf")).toBe(
      "very.long.name-pdfa.pdf",
    );
  });
});
