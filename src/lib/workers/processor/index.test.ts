import { describe, expect, it } from "vitest";
import { createProcessorRegistry } from "./index";
import type { QpdfStructureRunner } from "../pdf-structure/engine";
import type { GhostscriptPdfARunner } from "../pdf-archive/engine";
import type { ChromiumPdfRunner } from "../html-render/engine";

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

function fakeStructureRunner(): QpdfStructureRunner {
  return {
    repair: async () => PDF,
    linearize: async () => PDF,
  };
}

function fakePdfARunner(): GhostscriptPdfARunner {
  return {
    convertToPdfA: async () => PDF,
  };
}

function fakeChromiumRunner(): ChromiumPdfRunner {
  return {
    renderHtml: async () => PDF,
    renderUrl: async () => PDF,
  };
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
});
