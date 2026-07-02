import { describe, expect, it } from "vitest";
import { buildOcrResultMeta, type OcrResultMeta } from "@/lib/jobs/ocr";
import { createOcrProcessor, ocrProcessorMeta, type OcrRunner } from "./ocr";
import type { ProcessorInputFile } from "./types";

const scan: ProcessorInputFile = {
  fileId: "f_1234567890",
  filename: "scan.pdf",
  contentType: "application/pdf",
  bytes: new Uint8Array([1, 2, 3]),
};

/** A representative, valid OCR result-meta for a runner fake. */
function fakeMeta(over: Partial<OcrResultMeta> = {}): OcrResultMeta {
  return buildOcrResultMeta({
    engine: "ocrmypdf",
    languages: ["eng"],
    outputMode: "searchable-pdf",
    producedSearchablePdf: true,
    producedTextSidecar: false,
    pageCount: 3,
    ...over,
  });
}

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
  it("becomes ready, delegates to the runner, and attaches safe metadata", async () => {
    const runner: OcrRunner = async ({ options, inputs }) => {
      expect(inputs).toHaveLength(1);
      expect(options.languages).toEqual(["eng"]);
      return {
        artifacts: [
          {
            filename: "scan-ocr.pdf",
            contentType: "application/pdf",
            bytes: new Uint8Array([9, 9, 9]),
          },
        ],
        meta: fakeMeta({ languages: ["eng"], pageCount: 4 }),
      };
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
    if (!result.ok) return;
    expect(result.artifacts[0]?.filename).toBe("scan-ocr.pdf");
    // The processor surfaces the runner's bounded metadata on the success result,
    // flattened to the content-free ProcessorMeta seam.
    expect(result.meta).toMatchObject({
      engine: "ocrmypdf",
      outputMode: "searchable-pdf",
      languages: "eng",
      languageCount: 1,
      producedSearchablePdf: true,
      producedTextSidecar: false,
      pageCount: 4,
    });
    // A confidence the native backend never provides must not appear (never invented).
    expect(result.meta && "meanConfidence" in result.meta).toBe(false);

    // It ALSO surfaces the STRUCTURED result block the executor threads onto the
    // completed job record and the status API (`Job.results.ocr`) — the same facts,
    // unflattened, with the validated language array intact.
    expect(result.results?.ocr).toEqual({
      engine: "ocrmypdf",
      languages: ["eng"],
      outputMode: "searchable-pdf",
      producedSearchablePdf: true,
      producedTextSidecar: false,
      pageCount: 4,
      textCharacters: null,
      meanConfidence: null,
    });
  });

  it("stays not-ready when a runner is wired but no engine is present", () => {
    const proc = createOcrProcessor({
      engines: { ocrmypdf: false, tesseract: false },
      runner: async () => ({ artifacts: [], meta: fakeMeta() }),
    });
    expect(proc.capability().ready).toBe(false);
  });
});

describe("ocrProcessorMeta — flat, bounded, null-free flattening", () => {
  it("joins languages, drops nulls, and keeps a real confidence", () => {
    const flat = ocrProcessorMeta(
      buildOcrResultMeta({
        engine: "tesseract",
        languages: ["eng", "spa"],
        outputMode: "both",
        producedSearchablePdf: true,
        producedTextSidecar: true,
        pageCount: 2,
        textCharacters: 128,
        meanConfidence: 0.87,
      }),
    );
    expect(flat).toEqual({
      engine: "tesseract",
      outputMode: "both",
      languages: "eng+spa",
      languageCount: 2,
      producedSearchablePdf: true,
      producedTextSidecar: true,
      pageCount: 2,
      textCharacters: 128,
      meanConfidence: 0.87,
    });
    // Flat and content-free: only primitive scalars, no nested object/array.
    for (const value of Object.values(flat)) {
      expect(["string", "number", "boolean"]).toContain(typeof value);
    }
  });

  it("omits page/character counts and confidence that are null (never as null keys)", () => {
    const flat = ocrProcessorMeta(
      buildOcrResultMeta({
        engine: "ocrmypdf",
        languages: ["eng"],
        outputMode: "searchable-pdf",
        producedSearchablePdf: true,
        producedTextSidecar: false,
        pageCount: null,
        textCharacters: null,
        meanConfidence: null,
      }),
    );
    expect("pageCount" in flat).toBe(false);
    expect("textCharacters" in flat).toBe(false);
    expect("meanConfidence" in flat).toBe(false);
    expect(Object.values(flat)).not.toContain(null);
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
    const proc = createOcrProcessor(
      readyDeps(async () => ({ artifacts: [], meta: fakeMeta() })),
    );
    const result = await proc.process({
      tool: "ocr-pdf",
      options: { languages: ["eng"] },
      inputs: [scan],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("internal_error");
  });
});
