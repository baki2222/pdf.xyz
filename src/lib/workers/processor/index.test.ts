import { describe, expect, it } from "vitest";
import { createProcessorRegistry } from "./index";
import type { QpdfStructureRunner } from "../pdf-structure/engine";
import type { GhostscriptPdfARunner } from "../pdf-archive/engine";

function fakeStructureRunner(): QpdfStructureRunner {
  const pdf = new TextEncoder().encode("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  return {
    repair: async () => pdf,
    linearize: async () => pdf,
  };
}

function fakePdfARunner(): GhostscriptPdfARunner {
  const pdf = new TextEncoder().encode("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  return {
    convertToPdfA: async () => pdf,
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
});
