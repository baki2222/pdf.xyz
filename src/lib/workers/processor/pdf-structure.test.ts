// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ProcessorInputFile } from "./types";
import type {
  PdfStructureDeps,
  QpdfStructureRunner,
} from "../pdf-structure/engine";
import { createPdfStructureProcessor } from "./pdf-structure";

/** Minimal, structurally-valid PDF bytes (passes `looksLikePdf`). */
function pdf(pad = 40): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n${"0".repeat(pad)}\n%%EOF\n`);
}

function file(name = "report.pdf", bytes = pdf()): ProcessorInputFile {
  return {
    fileId: "f_1234567890",
    filename: name,
    contentType: "application/pdf",
    bytes,
  };
}

function fakeRunner(
  over: Partial<QpdfStructureRunner> = {},
): QpdfStructureRunner {
  return {
    repair: async () => pdf(64),
    linearize: async () => pdf(80),
    ...over,
  };
}

const wired = (over: Partial<QpdfStructureRunner> = {}): PdfStructureDeps => ({
  qpdf: fakeRunner(over),
});

describe("pdf-structure processor — routing & capability", () => {
  it("owns repair-pdf and optimize-web", () => {
    const proc = createPdfStructureProcessor(wired());
    expect(proc.tools).toEqual(["repair-pdf", "optimize-web"]);
    expect(proc.supports("repair-pdf")).toBe(true);
    expect(proc.supports("optimize-web")).toBe(true);
    expect(proc.supports("protect-pdf")).toBe(false);
  });

  it("is ready only when a qpdf structure runner is wired", () => {
    expect(createPdfStructureProcessor(wired()).capability().ready).toBe(true);
    const notReady = createPdfStructureProcessor({}).capability();
    expect(notReady.ready).toBe(false);
    expect(notReady.detail).toMatch(/qpdf/i);
  });
});

describe("pdf-structure processor — repair", () => {
  it("repairs a PDF and returns a named artifact + content-free meta", async () => {
    const repaired = pdf(96);
    const proc = createPdfStructureProcessor(
      wired({ repair: async () => repaired }),
    );

    const result = await proc.process({
      tool: "repair-pdf",
      options: {},
      inputs: [file("damaged.pdf")],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifacts[0]?.filename).toBe("damaged-repaired.pdf");
    expect(result.artifacts[0]?.contentType).toBe("application/pdf");
    expect(result.artifacts[0]?.bytes).toBe(repaired);
    expect(result.meta).toMatchObject({
      engine: "qpdf",
      operation: "repair",
      inputBytes: file().bytes.byteLength,
      outputBytes: repaired.byteLength,
    });
  });

  it("fails as not_implemented when qpdf is not wired", async () => {
    const result = await createPdfStructureProcessor({}).process({
      tool: "repair-pdf",
      options: {},
      inputs: [file()],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_implemented");
      expect(result.error.retryable).toBe(false);
    }
  });
});

describe("pdf-structure processor — optimize-web", () => {
  it("linearizes a PDF and returns a named artifact + content-free meta", async () => {
    const optimized = pdf(120);
    const proc = createPdfStructureProcessor(
      wired({ linearize: async () => optimized }),
    );

    const result = await proc.process({
      tool: "optimize-web",
      options: {},
      inputs: [file("catalog.pdf")],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifacts[0]?.filename).toBe("catalog-web-optimized.pdf");
    expect(result.artifacts[0]?.contentType).toBe("application/pdf");
    expect(result.artifacts[0]?.bytes).toBe(optimized);
    expect(result.meta).toMatchObject({
      engine: "qpdf",
      operation: "linearize",
      inputBytes: file().bytes.byteLength,
      outputBytes: optimized.byteLength,
    });
  });

  it("requires exactly one PDF input", async () => {
    const proc = createPdfStructureProcessor(wired());
    const zero = await proc.process({
      tool: "optimize-web",
      options: {},
      inputs: [],
    });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.error.code).toBe("unprocessable_entity");

    const two = await proc.process({
      tool: "optimize-web",
      options: {},
      inputs: [file(), file("b.pdf")],
    });
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.error.code).toBe("unprocessable_entity");
  });

  it("rejects invalid PDF input as unprocessable_entity", async () => {
    const result = await createPdfStructureProcessor(wired()).process({
      tool: "optimize-web",
      options: {},
      inputs: [file("junk.pdf", new Uint8Array([1, 2, 3, 4]))],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unprocessable_entity");
  });
});
