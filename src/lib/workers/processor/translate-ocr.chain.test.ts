/**
 * Translate PDF with OCR first (audit translate-pdf#3): ONE job that runs the
 * OCR processor on a scan and translates the text it recognised. Driven
 * through the real registry (`createProcessorRegistry`), so the chain is the
 * one the worker builds — the OCR processor (its option, language and refusal
 * handling) and the translate processor, joined where the daemon joins them.
 * Only the native pieces are played: OCRmyPDF (a runner that returns marked
 * bytes), the text extractor (text only for the bytes OCR produced) and the AI
 * provider (which COUNTS its calls, so "refused before the provider" is a
 * number, not a reading of the code).
 *
 * The money arms (CLAUDE.md rule 3) each assert what the job record carries:
 * a failure before any provider call carries no usage and makes no call; a
 * provider failure after OCR carries the tokens it burned.
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildOcrResultMeta, PDF_TO_WORD_RTL_REFUSAL } from "@/lib/jobs/ocr";
import { TRANSLATE_NO_TEXT_MESSAGE } from "@/lib/jobs/translate-limits";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { AiCompletionRequest, AiCompletionResult } from "../ai/provider";
import { OCR_REFUSAL_MESSAGES, OcrEngineRefusal } from "../ocr-engine-errors";
import type { PdfTextExtractor } from "../translate/engine";
import { createProcessorRegistry, type OcrRunner } from "./index";
import { TRANSLATE_OCR_MESSAGES } from "./translate";
import type { ProcessorInput } from "./types";

const enc = (s: string) => new TextEncoder().encode(s);
const SCAN = enc("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n% scan\n%%EOF\n");
const SEARCHABLE = enc(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n% ocr layer\n%%EOF\n",
);
const TYPED = enc("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n% typed\n%%EOF\n");
const RECOGNISED = "Rechnung 2026-118 aus dem Scan erkannt";
const TYPED_TEXT = "A typed sentence that was always selectable.";

const same = (a: Uint8Array, b: Uint8Array) =>
  Buffer.from(a).equals(Buffer.from(b));

function extraction(pages: string[]): ExtractedPdfText {
  const list = pages.map((text, i) => ({
    pageNumber: i + 1,
    text,
    characterCount: text.length,
  }));
  const text = pages.filter((p) => p.trim()).join("\n\n");
  return {
    pageCount: pages.length,
    pages: list,
    text,
    characterCount: text.length,
    hasText: text.trim().length > 0,
  };
}

/** The worker's extractor, played: a scan has no text, OCR's output does. */
function extractorFor(
  recognised: string[] = [RECOGNISED],
  scanReads: ExtractedPdfText = extraction([""]),
) {
  const seen: string[] = [];
  const extract: PdfTextExtractor = async (bytes) => {
    if (same(bytes, SEARCHABLE)) {
      seen.push("searchable");
      return extraction(recognised);
    }
    if (same(bytes, TYPED)) {
      seen.push("typed");
      return extraction([TYPED_TEXT]);
    }
    seen.push("scan");
    return scanReads;
  };
  return { extract, seen };
}

/** A provider that counts calls and records what it was sent. */
function countingProvider(
  answer: (request: AiCompletionRequest) => AiCompletionResult = () => ({
    ok: true,
    text: "Invoice 2026-118 recognised from the scan",
    model: "fake-model",
    usage: { inputTokens: 40, outputTokens: 12 },
  }),
) {
  const sent: string[] = [];
  return {
    sent,
    provider: {
      id: "anthropic",
      model: "fake-model",
      async complete(request: AiCompletionRequest) {
        sent.push(request.messages.map((m) => m.content).join("\n"));
        return answer(request);
      },
    },
  };
}

const ocrmypdf: OcrRunner = async ({ options }) => ({
  artifacts: [
    {
      filename: "scan-ocr.pdf",
      contentType: "application/pdf",
      bytes: SEARCHABLE,
    },
  ],
  meta: buildOcrResultMeta({
    engine: "ocrmypdf",
    languages: options.languages,
    outputMode: options.outputMode,
    producedSearchablePdf: true,
    producedTextSidecar: false,
    pageCount: 1,
  }),
});

function chain(opts: {
  runner?: OcrRunner;
  installed?: string[];
  recognised?: string[];
  answer?: (request: AiCompletionRequest) => AiCompletionResult;
  limits?: { maxInputBytes?: number };
  scanReads?: ExtractedPdfText;
}) {
  const ocrCalls: unknown[] = [];
  const runner: OcrRunner | undefined = opts.runner
    ? async (input) => {
        ocrCalls.push(input.options);
        return opts.runner!(input);
      }
    : undefined;
  const { extract, seen } = extractorFor(opts.recognised, opts.scanReads);
  const counting = countingProvider(opts.answer);
  const registry = createProcessorRegistry({
    ocr: runner
      ? {
          runner,
          engines: { ocrmypdf: true, tesseract: true },
          ...(opts.installed ? { installedLanguages: opts.installed } : {}),
        }
      : {},
    translate: {
      extract,
      provider: counting.provider,
      now: () => "2026-11-09T00:00:00.000Z",
      ...(opts.limits ? { limits: opts.limits } : {}),
    },
  });
  return {
    processor: registry.resolve("translate-pdf")!,
    ocrCalls,
    seen,
    sent: counting.sent,
  };
}

function job(
  options: Record<string, unknown>,
  bytes: Uint8Array = SCAN,
  delivery?: { characters: number; pages?: number },
): ProcessorInput {
  return {
    tool: "translate-pdf",
    options: { targetLanguage: "en", ...options },
    inputs: [
      {
        fileId: "f",
        filename: "scan.pdf",
        contentType: "application/pdf",
        bytes,
      },
    ],
    ...(delivery ? { delivery } : {}),
  };
}

async function translationText(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  return zip.file("translation.txt")!.async("string");
}

describe("Translate PDF, OCR first — one job", () => {
  it("control: without an OCR request a scan is refused as having no text (today's behaviour), and nothing is spent", async () => {
    const c = chain({ runner: ocrmypdf });
    const result = await c.processor.process(job({}));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.message).toBe(TRANSLATE_NO_TEXT_MESSAGE);
    expect(c.ocrCalls).toEqual([]);
    expect(c.sent).toEqual([]);
  });

  it("a scan with an OCR request is recognised in the chosen languages, and the RECOGNISED text is what reaches the provider", async () => {
    const c = chain({ runner: ocrmypdf });
    const result = await c.processor.process(
      job({ ocr: true, languages: ["deu", "eng"] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(c.ocrCalls).toEqual([
      {
        languages: ["deu", "eng"],
        outputMode: "searchable-pdf",
        rotatePages: false,
        deskew: false,
        redoOcr: false,
      },
    ]);
    // The scan, then OCR's searchable PDF — read through the one extractor.
    expect(c.seen).toEqual(["scan", "searchable"]);
    expect(c.sent).toHaveLength(1);
    expect(c.sent[0]).toContain(RECOGNISED);
    expect(await translationText(result.artifacts[0]!.bytes)).toContain(
      "Invoice 2026-118 recognised from the scan",
    );
    // Both stories travel to the job record: what OCR did, and what it cost.
    expect(result.results?.ocr?.languages).toEqual(["deu", "eng"]);
    expect(result.results?.ai?.usage).toMatchObject({
      inputTokens: 40,
      outputTokens: 12,
      calls: 1,
    });
    expect(result.meta?.ocrFirst).toBe(true);
  });

  it("control: a PDF WITH a text layer runs no OCR even when the job asks for it — no new step, no new cost", async () => {
    const c = chain({ runner: ocrmypdf });
    const result = await c.processor.process(
      job({ ocr: true, languages: ["eng"] }, TYPED),
    );
    expect(result.ok).toBe(true);
    expect(c.ocrCalls).toEqual([]);
    expect(c.seen).toEqual(["typed"]);
    expect(c.sent[0]).toContain(TYPED_TEXT);
    if (result.ok) {
      expect(result.results?.ocr).toBeUndefined();
      expect(result.meta?.ocrFirst).toBe(false);
    }
  });

  it("a scan whose extractor says hasText over whitespace alone still runs OCR — the engine's own predicate decides", async () => {
    const c = chain({
      runner: ocrmypdf,
      scanReads: {
        pageCount: 1,
        pages: [{ pageNumber: 1, text: "   ", characterCount: 3 }],
        text: "   ",
        characterCount: 3,
        hasText: true,
      },
    });
    const result = await c.processor.process(job({ ocr: true }));
    expect(result.ok).toBe(true);
    expect(c.ocrCalls).toHaveLength(1);
    expect(c.sent[0]).toContain(RECOGNISED);
  });

  it("a right-to-left language is refused with PDF to Word's typed refusal, before OCR or the provider", async () => {
    const c = chain({ runner: ocrmypdf });
    const result = await c.processor.process(
      job({ ocr: true, languages: ["ara"] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unprocessable_entity");
      expect(result.error.message).toBe(PDF_TO_WORD_RTL_REFUSAL);
      expect(result.error.retryable).toBe(false);
    }
    expect(c.ocrCalls).toEqual([]);
    expect(c.sent).toEqual([]);
  });

  it("languages without `ocr: true` are refused, as PDF to Word refuses them", async () => {
    const c = chain({ runner: ocrmypdf });
    const result = await c.processor.process(job({ languages: ["eng"] }));
    expect(result.ok).toBe(false);
    expect(c.sent).toEqual([]);
  });
});

describe("Translate PDF, OCR first — every failure arm carries exactly what it cost", () => {
  it("OCR unavailable on this worker: Translate's own sentence, no provider call, no usage", async () => {
    const c = chain({});
    const result = await c.processor.process(job({ ocr: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_implemented");
      expect(result.error.message).toBe(TRANSLATE_OCR_MESSAGES.unavailable);
    }
    expect(c.sent).toEqual([]);
    expect(result.results?.ai).toBeUndefined();
  });

  it("a pack this worker lacks is refused by OCR's own check, before any work", async () => {
    const c = chain({ runner: ocrmypdf, installed: ["eng"] });
    const result = await c.processor.process(
      job({ ocr: true, languages: ["deu"] }),
    );
    expect(result.ok).toBe(false);
    expect(c.ocrCalls).toEqual([]);
    expect(c.sent).toEqual([]);
    expect(result.results?.ai).toBeUndefined();
  });

  it("OCR failed: its refusal, no provider call, no usage", async () => {
    const c = chain({
      runner: async () => {
        throw new OcrEngineRefusal("prior-text");
      },
    });
    const result = await c.processor.process(job({ ocr: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe(TRANSLATE_OCR_MESSAGES.priorText);
      expect(result.error.message).not.toBe(OCR_REFUSAL_MESSAGES["prior-text"]);
    }
    expect(c.sent).toEqual([]);
    expect(result.results?.ai).toBeUndefined();
  });

  it("OCR produced nothing: says OCR ran (never 'run OCR PDF first'), no provider call, no usage", async () => {
    const c = chain({ runner: ocrmypdf, recognised: [""] });
    const result = await c.processor.process(job({ ocr: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe(TRANSLATE_OCR_MESSAGES.noText);
      expect(result.error.message).not.toBe(TRANSLATE_NO_TEXT_MESSAGE);
      expect(result.error.retryable).toBe(false);
    }
    expect(c.ocrCalls).toHaveLength(1);
    expect(c.sent).toEqual([]);
    expect(result.results?.ai).toBeUndefined();
  });

  it("OCR text exceeds the allowance: refused BEFORE the provider is called (the delivery cap reads OCR's output)", async () => {
    // One recognised page of 900 characters against a job that reserved 400.
    const c = chain({ runner: ocrmypdf, recognised: ["W".repeat(900)] });
    const result = await c.processor.process(
      job({ ocr: true }, SCAN, { characters: 400 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unprocessable_entity");
      expect(result.error.message).toMatch(/nothing was sent to the AI model/);
    }
    expect(c.ocrCalls).toHaveLength(1);
    expect(c.sent).toHaveLength(0);
    expect(result.results?.ai?.usage).toBeUndefined();
  });

  it("OCR text past the allowance on later pages: those pages are withheld, never sent, and the record says so", async () => {
    const c = chain({
      runner: ocrmypdf,
      recognised: ["A".repeat(300), "B".repeat(300), "C".repeat(300)],
    });
    const result = await c.processor.process(
      job({ ocr: true }, SCAN, { characters: 400 }),
    );
    expect(result.ok).toBe(true);
    expect(c.sent).toHaveLength(1);
    expect(c.sent[0]).toContain("A".repeat(300));
    expect(c.sent[0]).not.toContain("B".repeat(300));
    expect(c.sent[0]).not.toContain("C".repeat(300));
    if (result.ok)
      expect(result.results?.ai?.delivery).toMatchObject({
        deliveredPages: 1,
        withheldPages: 2,
        boundBy: "characters",
      });
  });

  it("a scan past the file ceiling is refused before OCR runs", async () => {
    const c = chain({ runner: ocrmypdf, limits: { maxInputBytes: 10 } });
    const result = await c.processor.process(job({ ocr: true }));
    expect(result.ok).toBe(false);
    expect(c.ocrCalls).toEqual([]);
    expect(c.sent).toEqual([]);
  });

  it("provider failure after OCR: the failure carries the tokens the call burned", async () => {
    const c = chain({
      runner: ocrmypdf,
      answer: () => ({
        ok: false,
        kind: "provider_error",
        retryable: false,
        message: "The AI provider reached its output limit.",
        usage: { inputTokens: 55, outputTokens: 8_000 },
      }),
    });
    const result = await c.processor.process(job({ ocr: true }));
    expect(result.ok).toBe(false);
    expect(c.sent).toHaveLength(1);
    expect(result.results?.ai?.usage).toMatchObject({
      inputTokens: 55,
      outputTokens: 8_000,
      calls: 1,
    });
  });
});
