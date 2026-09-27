// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ProcessorInputFile } from "./types";
import type {
  PdfStructureDeps,
  QpdfStructureRunner,
} from "../pdf-structure/engine";
import { createPdfStructureProcessor } from "./pdf-structure";
import { OFFICE_EXPORT_ERROR_CODES } from "@/lib/jobs/office-export-results";
import { linearizedPdf } from "@/tests/linearized-pdf-fixture";

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
    repair: async () => ({ bytes: pdf(64), warnings: [] }),
    linearize: async () => ({ bytes: linearizedPdf(), warnings: [] }),
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
      wired({ repair: async () => ({ bytes: repaired, warnings: [] }) }),
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
    const optimized = linearizedPdf("catalog");
    const proc = createPdfStructureProcessor(
      wired({ linearize: async () => ({ bytes: optimized, warnings: [] }) }),
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

  it("a TRUNCATED PDF is refused finally, by the code that links Repair PDF", async () => {
    // A header and no `%%EOF`: damage, not "not a PDF". The panel links the
    // next step by CODE, so the code is the pointer, not only the sentence.
    const truncated = new TextEncoder().encode(
      `%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n${"0".repeat(64)}`,
    );
    const result = await createPdfStructureProcessor(wired()).process({
      tool: "optimize-web",
      options: {},
      inputs: [file("cut.pdf", truncated)],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(OFFICE_EXPORT_ERROR_CODES.unreadable);
    expect(result.error.retryable).toBe(false);
    expect(result.error.message).toMatch(/Repair PDF/);
  });
});

/**
 * qpdf exits 3 on `--linearize` exactly as on a rewrite — "warnings issued,
 * output created" — and the output is then qpdf's RECONSTRUCTION of a file it
 * found damaged. Until 2026-09-27 the processor sent that report only for
 * repair-pdf ("optimize-web makes no claim about recovering anything"), so a
 * user whose file was silently rebuilt read "Your web-optimized PDF is ready."
 * and nothing else. The tool made no recovery claim; qpdf still performed one.
 */
describe("pdf-structure processor — what qpdf reported reaches the job", () => {
  for (const tool of ["repair-pdf", "optimize-web"] as const) {
    it(`${tool}: a run qpdf reconstructed carries its warnings`, async () => {
      const bytes = tool === "repair-pdf" ? pdf(64) : linearizedPdf();
      const proc = createPdfStructureProcessor(
        wired({
          repair: async () => ({ bytes, warnings: ["xref reconstructed"] }),
          linearize: async () => ({ bytes, warnings: ["xref reconstructed"] }),
        }),
      );
      const result = await proc.process({
        tool,
        options: {},
        inputs: [file()],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.results?.repair).toEqual({
        recoveredWithWarnings: true,
        warnings: ["xref reconstructed"],
      });
    });

    it(`${tool}: a clean run reports clean, so "no report" still means an older worker`, async () => {
      const result = await createPdfStructureProcessor(wired()).process({
        tool,
        options: {},
        inputs: [file()],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.results?.repair).toEqual({
        recoveredWithWarnings: false,
        warnings: [],
      });
    });
  }
});
