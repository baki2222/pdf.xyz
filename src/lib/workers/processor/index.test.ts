import { describe, expect, it } from "vitest";
import { createProcessorRegistry } from "./index";
import type { QpdfStructureRunner } from "../pdf-structure/engine";
import type { GhostscriptPdfARunner } from "../pdf-archive/engine";
import type { ChromiumPdfRunner } from "../html-render/engine";
import type { LibreOfficePdfRunner } from "../office-conversion/engine";
import type { PdfTextExtractor } from "../pdf-office-export/engine";

const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);

function fakeStructureRunner(): QpdfStructureRunner {
  return {
    repair: async () => ({ bytes: PDF, warnings: [] }),
    linearize: async () => ({ bytes: PDF, warnings: [] }),
  };
}
function fakePdfARunner(): GhostscriptPdfARunner {
  return { convertToPdfA: async () => PDF };
}
function fakeChromiumRunner(): ChromiumPdfRunner {
  return { renderHtml: async () => PDF, renderUrl: async () => PDF };
}
function fakeLibreOfficeRunner(): LibreOfficePdfRunner {
  return { convertToPdf: async () => PDF };
}
function fakePdfTextExtractor(): PdfTextExtractor {
  return async () => ({
    pageCount: 1,
    pages: [{ pageNumber: 1, text: "Hello", characterCount: 5 }],
    text: "Hello",
    characterCount: 5,
    hasText: true,
  });
}

describe("createProcessorRegistry", () => {
  it("registers the qpdf structure processor for repair-pdf and optimize-web", () => {
    const registry = createProcessorRegistry({
      pdfStructure: { qpdf: fakeStructureRunner() },
    });
    expect(registry.supports("repair-pdf")).toBe(true);
    expect(registry.supports("optimize-web")).toBe(true);
    expect(registry.resolve("repair-pdf")?.id).toBe("pdf-structure");
    expect(registry.resolve("optimize-web")?.id).toBe("pdf-structure");
    expect(registry.capabilities()).toContainEqual(
      expect.objectContaining({
        id: "pdf-structure",
        ready: true,
        tools: ["repair-pdf", "optimize-web"],
      }),
    );
  });

  it("registers the Ghostscript archive processor for pdf-to-pdfa", () => {
    const registry = createProcessorRegistry({
      pdfArchive: { ghostscript: fakePdfARunner() },
    });
    expect(registry.supports("pdf-to-pdfa")).toBe(true);
    expect(registry.resolve("pdf-to-pdfa")?.id).toBe("pdf-archive");
    expect(registry.capabilities()).toContainEqual(
      expect.objectContaining({
        id: "pdf-archive",
        ready: true,
        tools: ["pdf-to-pdfa"],
      }),
    );
  });

  it("registers the Chromium HTML renderer for html-to-pdf and webpage-to-pdf", () => {
    const registry = createProcessorRegistry({
      htmlRender: { chromium: fakeChromiumRunner() },
    });
    expect(registry.supports("html-to-pdf")).toBe(true);
    expect(registry.supports("webpage-to-pdf")).toBe(true);
    expect(registry.resolve("html-to-pdf")?.id).toBe("html-render");
    expect(registry.resolve("webpage-to-pdf")?.id).toBe("html-render");
    expect(registry.capabilities()).toContainEqual(
      expect.objectContaining({
        id: "html-render",
        ready: true,
        tools: ["html-to-pdf", "webpage-to-pdf"],
      }),
    );
  });

  it("registers the LibreOffice converter for Office to PDF tools", () => {
    const registry = createProcessorRegistry({
      officeConversion: { libreoffice: fakeLibreOfficeRunner() },
    });
    expect(registry.supports("word-to-pdf")).toBe(true);
    expect(registry.supports("excel-to-pdf")).toBe(true);
    expect(registry.supports("powerpoint-to-pdf")).toBe(true);
    expect(registry.resolve("word-to-pdf")?.id).toBe("office-conversion");
    expect(registry.capabilities()).toContainEqual(
      expect.objectContaining({
        id: "office-conversion",
        ready: true,
        tools: ["word-to-pdf", "excel-to-pdf", "powerpoint-to-pdf"],
      }),
    );
  });

  it("registers the PDF to Office exporter for PDF to Word/Excel/PowerPoint tools", () => {
    const registry = createProcessorRegistry({
      pdfOfficeExport: { extract: fakePdfTextExtractor() },
    });
    expect(registry.supports("pdf-to-word")).toBe(true);
    expect(registry.supports("pdf-to-excel")).toBe(true);
    expect(registry.supports("pdf-to-powerpoint")).toBe(true);
    expect(registry.resolve("pdf-to-word")?.id).toBe("pdf-office-export");
    expect(registry.capabilities()).toContainEqual(
      expect.objectContaining({
        id: "pdf-office-export",
        ready: true,
        tools: ["pdf-to-word", "pdf-to-excel", "pdf-to-powerpoint"],
      }),
    );
  });

  it("registers the table extractor for extract-tables", () => {
    const registry = createProcessorRegistry({
      tableExtract: {
        extractLayout: async () => ({ pageCount: 0, pages: [] }),
      },
    });
    expect(registry.supports("extract-tables")).toBe(true);
    expect(registry.resolve("extract-tables")?.id).toBe("table-extract");
    expect(registry.capabilities()).toContainEqual(
      expect.objectContaining({
        id: "table-extract",
        ready: true,
        tools: ["extract-tables"],
      }),
    );
  });

  it("registers the signature-request preparer for request-signatures", () => {
    const registry = createProcessorRegistry({
      requestSignatures: {
        inspect: async () => ({
          pageCount: 1,
          pageSizes: [{ width: 612, height: 792 }],
        }),
        place: async () => PDF,
      },
    });
    expect(registry.supports("request-signatures")).toBe(true);
    expect(registry.resolve("request-signatures")?.id).toBe(
      "request-signatures",
    );
    expect(registry.capabilities()).toContainEqual(
      expect.objectContaining({
        id: "request-signatures",
        ready: true,
        tools: ["request-signatures"],
      }),
    );
  });

  it("registers the AI Data Extraction processor for ai-extract, honestly not-ready without a provider", () => {
    const registry = createProcessorRegistry({
      aiExtract: { extract: fakePdfTextExtractor() },
    });
    expect(registry.supports("ai-extract")).toBe(true);
    expect(registry.resolve("ai-extract")?.id).toBe("ai-extract");
    // Wired but not ready: the extractor is present, but no AI provider is configured.
    expect(registry.capabilities()).toContainEqual(
      expect.objectContaining({
        id: "ai-extract",
        ready: false,
        tools: ["ai-extract"],
      }),
    );
  });
});
