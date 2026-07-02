// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { CompressionDeps } from "../compression/engine";
import { createCompressionProcessor } from "./compression";
import type { ProcessorInputFile } from "./types";

async function makePdf(pages = 4): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([300, 300]);
  return doc.save();
}

const noEngines: CompressionDeps = {
  tools: { ghostscript: false, qpdf: false, mutool: false },
};

async function file(name = "report.pdf"): Promise<ProcessorInputFile> {
  return {
    fileId: "f_1234567890",
    filename: name,
    contentType: "application/pdf",
    bytes: await makePdf(6),
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
