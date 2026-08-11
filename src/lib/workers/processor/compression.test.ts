// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { CompressionDeps } from "../compression/engine";
import { createCompressionProcessor } from "./compression";
import type { ProcessorInputFile } from "./types";

async function makePdf(
  pages = 4,
  opts: { withText?: boolean } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = opts.withText
    ? await doc.embedFont(StandardFonts.Helvetica)
    : undefined;
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([300, 300]);
    if (font) {
      for (let line = 0; line < 8; line += 1) {
        page.drawText(`content line ${line}`, {
          x: 10,
          y: 280 - line * 20,
          size: 9,
          font,
        });
      }
    }
  }
  return doc.save();
}

/** Minimal, structurally-valid PDF bytes for mocking a native engine's output. */
/** Bytes SHAPED like a PDF: header, trailer, rubble between. See engine.test.ts. */
function pdfShapedBytes(pad = 32): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n${"0".repeat(pad)}\n%%EOF\n`);
}

const noEngines: CompressionDeps = {
  tools: { ghostscript: false, qpdf: false, mutool: false },
};

async function file(name = "report.pdf"): Promise<ProcessorInputFile> {
  return {
    fileId: "f_1234567890",
    filename: name,
    contentType: "application/pdf",
    bytes: await makePdf(6, { withText: true }),
  };
}

describe("compression processor", () => {
  it("owns compress-pdf and is always ready (lossless)", () => {
    const proc = createCompressionProcessor(noEngines);
    expect(proc.tools).toEqual(["compress-pdf"]);
    expect(proc.supports("compress-pdf")).toBe(true);
    expect(proc.supports("ocr-pdf")).toBe(false);
    const cap = proc.capability();
    expect(cap.ready).toBe(true);
    expect(cap.detail).toMatch(/lossless/i);
    expect(cap.detail).toMatch(/native engine/i); // deep unavailable note
  });

  it("reports deep-capable when a native engine is present", () => {
    const proc = createCompressionProcessor({
      tools: { ghostscript: true, qpdf: false, mutool: false },
    });
    expect(proc.capability().detail).toMatch(/ghostscript/i);
  });

  it("runs a real lossless repack and returns bytes + content-free meta", async () => {
    const proc = createCompressionProcessor(noEngines);
    const result = await proc.process({
      tool: "compress-pdf",
      options: { profile: "lossless" },
      inputs: [await file()],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const artifact = result.artifacts[0];
    expect(artifact?.filename).toBe("report-compressed.pdf");
    expect(artifact?.contentType).toBe("application/pdf");
    // Output is a real, valid PDF preserving the page count.
    const reloaded = await PDFDocument.load(artifact!.bytes);
    expect(reloaded.getPageCount()).toBe(6);
    expect(result.meta?.engine).toBe("lossless-js");
    expect(typeof result.meta?.savedBytes).toBe("number");
  });

  it("fails honestly for deep with no native engine — not_implemented, no output", async () => {
    const proc = createCompressionProcessor(noEngines);
    const result = await proc.process({
      tool: "compress-pdf",
      options: { profile: "deep" },
      inputs: [await file()],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_implemented");
    expect(result.error.retryable).toBe(false);
    expect(result.error.message).toMatch(/ghostscript|qpdf|mutool/i);
    expect(result.error.message).toContain("WORKER_ARCHITECTURE.md");
  });

  it("completes a real deep job through a wired native engine (validated, smaller output)", async () => {
    // A REAL smaller PDF with the same page count. This test's name has always
    // said "validated, smaller output"; until 2026-08-11 its fixture was rubble
    // with a PDF header, and nothing in the pipeline could tell.
    const native = await makePdf(6);
    const proc = createCompressionProcessor({
      tools: { ghostscript: true, qpdf: false, mutool: false },
      native: async () => native,
    });
    const result = await proc.process({
      tool: "compress-pdf",
      options: { profile: "deep", targetDpi: 150 },
      inputs: [await file("scan.pdf")],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifacts[0]?.filename).toBe("scan-compressed.pdf");
    expect(result.artifacts[0]?.bytes).toBe(native);
    expect(result.meta?.engine).toBe("ghostscript");
    expect(result.meta?.profile).toBe("deep");
    expect(Number(result.meta?.savedBytes)).toBeGreaterThan(0);
  });

  it("maps an oversized deep input to a non-retryable payload_too_large", async () => {
    const proc = createCompressionProcessor({
      tools: { ghostscript: true, qpdf: false, mutool: false },
      limits: { maxInputBytes: 8 },
      native: async () => pdfShapedBytes(),
    });
    const result = await proc.process({
      tool: "compress-pdf",
      options: { profile: "deep" },
      inputs: [await file()],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("payload_too_large");
    expect(result.error.retryable).toBe(false);
  });

  it("maps unreadable engine output to a retryable internal_error (no artifact)", async () => {
    const proc = createCompressionProcessor({
      tools: { ghostscript: true, qpdf: false, mutool: false },
      native: async () => new Uint8Array([9, 9, 9, 9]),
    });
    const result = await proc.process({
      tool: "compress-pdf",
      options: { profile: "deep" },
      inputs: [await file()],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("internal_error");
    expect(result.error.retryable).toBe(true);
  });

  it("classifies a wired-engine crash as a retryable internal_error", async () => {
    const proc = createCompressionProcessor({
      tools: { ghostscript: true, qpdf: false, mutool: false },
      native: async () => {
        throw new Error("engine exploded");
      },
    });
    const result = await proc.process({
      tool: "compress-pdf",
      options: { profile: "deep" },
      inputs: [await file()],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("internal_error");
    expect(result.error.retryable).toBe(true);
    // The raw error text is never leaked.
    expect(result.error.message).not.toContain("exploded");
  });

  it("records invalid PDF bytes as unprocessable_entity", async () => {
    const proc = createCompressionProcessor(noEngines);
    const result = await proc.process({
      tool: "compress-pdf",
      options: { profile: "lossless" },
      inputs: [
        {
          fileId: "f_1234567890",
          filename: "junk.pdf",
          contentType: "application/pdf",
          bytes: new Uint8Array([1, 2, 3, 4]),
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unprocessable_entity");
  });

  it("rejects an invalid options bag defensively", async () => {
    const proc = createCompressionProcessor(noEngines);
    const result = await proc.process({
      tool: "compress-pdf",
      options: { profile: "ultra" },
      inputs: [await file()],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_request");
  });

  it("requires exactly one input file", async () => {
    const proc = createCompressionProcessor(noEngines);
    const result = await proc.process({
      tool: "compress-pdf",
      options: { profile: "lossless" },
      inputs: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unprocessable_entity");
  });

  it("refuses a tool it does not own", async () => {
    const proc = createCompressionProcessor(noEngines);
    const result = await proc.process({
      tool: "ocr-pdf",
      options: {},
      inputs: [await file()],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_implemented");
  });
});
