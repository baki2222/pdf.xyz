import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import {
  PDF_OFFICE_EXPORT_TOOLS,
  runPdfOfficeExport,
  type PdfTextExtractor,
} from "./engine";

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const extract: PdfTextExtractor = vi.fn(async () => ({ pageCount: 2, pages: [{ pageNumber: 1, text: "Name Amount\nAlice 10", characterCount: 20 }, { pageNumber: 2, text: "Bob 20", characterCount: 6 }], text: "Name Amount\nAlice 10\n\nBob 20", characterCount: 28, hasText: true }));

async function zipEntries(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  return new Set(Object.keys(zip.files));
}

describe("pdf-office-export engine", () => {
  it("declares the owned tools", () => {
    expect(PDF_OFFICE_EXPORT_TOOLS).toEqual(["pdf-to-word", "pdf-to-excel", "pdf-to-powerpoint"]);
  });

  it("fails honestly without an extractor", async () => {
    await expect(runPdfOfficeExport("pdf-to-word", PDF, {})).resolves.toMatchObject({ ok: false, kind: "unsupported" });
  });

  it("exports selectable PDF text to a valid DOCX package", async () => {
    const result = await runPdfOfficeExport("pdf-to-word", PDF, { extract });
    expect(result).toMatchObject({ ok: true, meta: { tool: "pdf-to-word", engine: "pdfjs-office-openxml", pageCount: 2 } });
    if (result.ok) {
      expect(result.contentType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      const entries = await zipEntries(result.output);
      expect(entries).toContain("word/document.xml");
    }
  });

  it("exports selectable PDF text to XLSX and PPTX packages", async () => {
    const xlsx = await runPdfOfficeExport("pdf-to-excel", PDF, { extract });
    const pptx = await runPdfOfficeExport("pdf-to-powerpoint", PDF, { extract });
    expect(xlsx.ok).toBe(true);
    expect(pptx.ok).toBe(true);
    if (xlsx.ok) expect(await zipEntries(xlsx.output)).toContain("xl/worksheets/sheet1.xml");
    if (pptx.ok) expect(await zipEntries(pptx.output)).toContain("ppt/slides/slide1.xml");
  });

  it("rejects image-only PDFs and oversized inputs", async () => {
    const emptyExtractor: PdfTextExtractor = async () => ({ pageCount: 1, pages: [{ pageNumber: 1, text: "", characterCount: 0 }], text: "", characterCount: 0, hasText: false });
    await expect(runPdfOfficeExport("pdf-to-word", PDF, { extract: emptyExtractor })).resolves.toMatchObject({ ok: false, kind: "no_text" });
    await expect(runPdfOfficeExport("pdf-to-word", PDF, { extract, limits: { maxInputBytes: 4 } })).resolves.toMatchObject({ ok: false, kind: "too_large", limitBytes: 4 });
  });
});
