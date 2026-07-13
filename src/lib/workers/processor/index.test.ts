import { describe, expect, it } from "vitest";
import { createProcessorRegistry } from "./index";
import type { QpdfStructureRunner } from "../pdf-structure/engine";

function fakeStructureRunner(): QpdfStructureRunner {
  const pdf = new TextEncoder().encode("%PDF-1.7\n0\n%%EOF\n");
  return {
    repair: async () => pdf,
    linearize: async () => pdf,
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
});
