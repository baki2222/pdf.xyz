import { describe, expect, it } from "vitest";
import { createOcrProcessor, type OcrRunner } from "./ocr";
import type { ProcessorInputFile } from "./types";

const scan: ProcessorInputFile = {
  fileId: "f_1234567890",
  filename: "scan.pdf",
  contentType: "application/pdf",
  bytes: new Uint8Array([1, 2, 3]),
};

describe("ocr processor — shipped state (no runner)", () => {
  const proc = createOcrProcessor();

  it("owns ocr-pdf but is honestly not ready", () => {
    expect(proc.tools).toEqual(["ocr-pdf"]);
    expect(proc.supports("ocr-pdf")).toBe(true);
    const cap = proc.capability();
    expect(cap.ready).toBe(false);
    expect(cap.detail).toMatch(/no OCR runner|OCRmyPDF|Tesseract/i);
  });

  it("validates the request, then fails honestly as not_implemented", async () => {
    const result = await proc.process({
      tool: "ocr-pdf",
      options: { languages: ["eng"], outputMode: "searchable-pdf" },
      inputs: [scan],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_implemented");
    expect(result.error.retryable).toBe(false);
    expect(result.error.message).toContain("OCR_BACKEND.md");
  });

  it("rejects a malformed request before the capability check", async () => {
    const result = await proc.process({
      tool: "ocr-pdf",
      options: { languages: ["klingon"] },
      inputs: [scan],
    });
    expect(result.ok).toBe(false);
    // An unknown language is a client error, surfaced even though OCR can't run.
    if (!result.ok) expect(result.error.code).toBe("unprocessable_entity");
  });

  it("refuses a tool it does not own", async () => {
    const result = await proc.process({
      tool: "compress-pdf",
      options: {},
      inputs: [scan],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_implemented");
  });
});

describe("ocr processor — flips on when a real runner is wired", () => {
  it("becomes ready and delegates to the runner (never fabricates text)", async () => {
    const runner: OcrRunner = async ({ options, inputs }) => {
      expect(inputs).toHaveLength(1);
      expect(options.languages).toEqual(["eng"]);
      return [
        {
          filename: "scan-ocr.pdf",
          contentType: "application/pdf",
          bytes: new Uint8Array([9, 9, 9]),
        },
      ];
    };
    const proc = createOcrProcessor({
      engines: { ocrmypdf: true, tesseract: false },
      runner,
    });
    expect(proc.capability().ready).toBe(true);
    expect(proc.capability().detail).toMatch(/ocrmypdf/i);

    const result = await proc.process({
      tool: "ocr-pdf",
      options: { languages: ["eng"] },
      inputs: [scan],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifacts[0]?.filename).toBe("scan-ocr.pdf");
  });

  it("stays not-ready when a runner is wired but no engine is present", () => {
    const proc = createOcrProcessor({
      engines: { ocrmypdf: false, tesseract: false },
      runner: async () => [],
    });
    expect(proc.capability().ready).toBe(false);
  });
});

describe("ocr processor — maps a runner failure to a typed, content-free error", () => {
  const readyDeps = (runner: OcrRunner) => ({
    engines: { ocrmypdf: true, tesseract: false },
    runner,
  });

  it("catches a runner throw and never lets process() throw or leak the message", async () => {
    const runner: OcrRunner = async () => {
      throw new Error("ocrmypdf exited 2 on /tmp/pdfxyz-ocr-xyz/input.pdf: EICAR");
    };
    const proc = createOcrProcessor(readyDeps(runner));
    const result = await proc.process({
      tool: "ocr-pdf",
      options: { languages: ["eng"] },
      inputs: [scan],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // A crashed/timed-out engine is a retryable internal error (the executor bounds
    // retries) — never a fabricated success, and never the raw error text.
    expect(result.error.code).toBe("internal_error");
    expect(result.error.retryable).toBe(true);
    const serialized = JSON.stringify(result.error);
    expect(serialized).not.toContain("/tmp/");
    expect(serialized).not.toContain("EICAR");
  });

  it("treats an empty artifact list as a failure, not a completed job", async () => {
    const proc = createOcrProcessor(readyDeps(async () => []));
    const result = await proc.process({
      tool: "ocr-pdf",
      options: { languages: ["eng"] },
      inputs: [scan],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("internal_error");
  });
});
