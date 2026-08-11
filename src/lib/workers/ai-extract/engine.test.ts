import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { ExtractOptions } from "@/lib/jobs/ai-extract";
import type {
  AiCompletionRequest,
  AiCompletionResult,
  AiProvider,
} from "../ai/provider";
import {
  runAiExtract,
  AI_EXTRACT_ENGINE,
  type PdfTextExtractor,
} from "./engine";

const PROMPT_OPTIONS: ExtractOptions = {
  mode: "prompt",
  prompt: "Extract the invoice number and total.",
};
const SCHEMA_OPTIONS: ExtractOptions = {
  mode: "schema",
  schema: [
    { name: "invoice_number", type: "string" },
    { name: "total", type: "number", description: "grand total incl. tax" },
  ],
};
const INPUT = new Uint8Array([1, 2, 3, 4]);

function extractorFor(text: string, pageCount = 3): PdfTextExtractor {
  const trimmed = text.trim();
  const extracted: ExtractedPdfText = {
    pageCount,
    pages: [],
    text,
    characterCount: text.length,
    hasText: trimmed.length > 0,
  };
  return vi.fn(async () => extracted);
}

/** A deterministic provider that returns a fixed completion and records the request. */
function providerReturning(
  result: AiCompletionResult,
): AiProvider & { calls: AiCompletionRequest[] } {
  const calls: AiCompletionRequest[] = [];
  return {
    id: "anthropic",
    model: "claude-sonnet-5",
    calls,
    async complete(request) {
      calls.push(request);
      return result;
    },
  };
}

const SUCCESS = (text: string): AiCompletionResult => ({
  ok: true,
  text,
  model: "claude-sonnet-5",
  usage: { inputTokens: 100, outputTokens: 20 },
});

describe("runAiExtract — honest failures", () => {
  it("fails `unsupported` when no text extractor is wired", async () => {
    const run = await runAiExtract(INPUT, PROMPT_OPTIONS, {
      provider: providerReturning(SUCCESS("{}")),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("unsupported");
  });

  it("fails `ai_unconfigured` with operator requirements when NO provider is configured", async () => {
    const extract = extractorFor("Plenty of real document text here.");
    const run = await runAiExtract(INPUT, PROMPT_OPTIONS, { extract });
    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.kind).toBe("ai_unconfigured");
      expect(run.retryable).toBe(false);
      expect(run.message).toContain("PDFXYZ_AI_PROVIDER");
      expect(run.message).toContain("PDFXYZ_AI_API_KEY");
    }
    // Honesty: with no provider we never even read the PDF, and never fabricate output.
    expect(extract).not.toHaveBeenCalled();
  });

  it("fails `no_text` (pointing at OCR) when the PDF has no selectable text", async () => {
    const run = await runAiExtract(INPUT, PROMPT_OPTIONS, {
      extract: extractorFor("   "),
      provider: providerReturning(SUCCESS("{}")),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.kind).toBe("no_text");
      expect(run.message).toMatch(/OCR/i);
    }
  });

  it("fails `too_large` when input exceeds the byte limit", async () => {
    const run = await runAiExtract(new Uint8Array(1000), PROMPT_OPTIONS, {
      extract: extractorFor("text"),
      provider: providerReturning(SUCCESS("{}")),
      limits: { maxInputBytes: 10 },
    });
    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.kind).toBe("too_large");
      expect(run.limitBytes).toBe(10);
    }
  });

  it("maps a provider rate_limit to a retryable `rate_limited`", async () => {
    const run = await runAiExtract(INPUT, PROMPT_OPTIONS, {
      extract: extractorFor("real text"),
      provider: providerReturning({
        ok: false,
        kind: "rate_limited",
        message: "slow",
        retryable: true,
      }),
    });
    expect(run.ok).toBe(false);
    if (!run.ok)
      expect(run).toMatchObject({ kind: "rate_limited", retryable: true });
  });

  it("maps a provider refusal to `content_filtered`", async () => {
    const run = await runAiExtract(INPUT, PROMPT_OPTIONS, {
      extract: extractorFor("real text"),
      provider: providerReturning({
        ok: false,
        kind: "content_filtered",
        message: "no",
        retryable: false,
      }),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("content_filtered");
  });

  it("maps a provider too_long to `too_large`", async () => {
    const run = await runAiExtract(INPUT, PROMPT_OPTIONS, {
      extract: extractorFor("real text"),
      provider: providerReturning({
        ok: false,
        kind: "too_long",
        message: "big",
        retryable: false,
      }),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("too_large");
  });

  it("fails `failed` (never fabricates) when the model returns non-JSON", async () => {
    const run = await runAiExtract(INPUT, PROMPT_OPTIONS, {
      extract: extractorFor("real text"),
      provider: providerReturning(
        SUCCESS("Here is the data you asked for, roughly."),
      ),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.kind).toBe("failed");
      expect(run.message).toMatch(/json/i);
    }
  });

  it("fails `failed` when the model returns an empty completion", async () => {
    const run = await runAiExtract(INPUT, PROMPT_OPTIONS, {
      extract: extractorFor("real text"),
      provider: providerReturning(SUCCESS("   ")),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("failed");
  });
});

describe("runAiExtract — provider-injected deterministic success", () => {
  it("packages the model's REAL extraction JSON and never fabricates it", async () => {
    const modelJson = '{"invoice_number":"INV-42","total":1200,"paid":true}';
    const provider = providerReturning(SUCCESS(modelJson));
    const run = await runAiExtract(INPUT, SCHEMA_OPTIONS, {
      extract: extractorFor(
        "Invoice INV-42, grand total 1200, paid in full.",
        5,
      ),
      provider,
      now: () => "2026-07-16T00:00:00.000Z",
    });

    expect(run.ok).toBe(true);
    if (!run.ok) return;

    // The extraction that ships is EXACTLY the provider's parsed JSON — nothing invented.
    const zip = await JSZip.loadAsync(run.output);
    const extractionJson = JSON.parse(
      await zip.file("extraction.json")!.async("string"),
    );
    expect(extractionJson).toEqual({
      invoice_number: "INV-42",
      total: 1200,
      paid: true,
    });
    // A human-readable rendering ships alongside the JSON.
    expect(await zip.file("extraction.md")!.async("string")).toContain(
      "INV-42",
    );
    expect(await zip.file("README.txt")).not.toBeNull();

    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    expect(manifest.schema).toBe("pdfxyz.extraction/v1");
    expect(manifest.provider).toBe("anthropic");
    expect(manifest.model).toBe("claude-sonnet-5");
    expect(manifest.options.mode).toBe("schema");
    expect(manifest.options.schema).toEqual([
      { name: "invoice_number", type: "string" },
      { name: "total", type: "number", description: "grand total incl. tax" },
    ]);

    // The system prompt constrains the model to the provided text (anti-hallucination),
    // demands JSON only, forbids fabrication, and names the requested fields.
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.system).toMatch(/ONLY/);
    expect(provider.calls[0]!.system).toMatch(/JSON/i);
    expect(provider.calls[0]!.system).toMatch(/null/i);
    expect(provider.calls[0]!.system).toContain("invoice_number");
    expect(provider.calls[0]!.system).toContain("total");
    expect(provider.calls[0]!.messages[0]!.content).toContain("INV-42");
    // Deterministic extraction: temperature pinned to 0.
    expect(provider.calls[0]!.temperature).toBe(0);

    // Content-free meta carries counts, provider/model, mode — never document text.
    expect(run.meta).toMatchObject({
      engine: AI_EXTRACT_ENGINE,
      provider: "anthropic",
      model: "claude-sonnet-5",
      mode: "schema",
      fieldCount: 2,
      extractedKeys: 3,
      pageCount: 5,
      truncated: false,
    });
  });

  it("puts the user extraction prompt into the system directive in prompt mode", async () => {
    const provider = providerReturning(SUCCESS('{"answer":"x"}'));
    await runAiExtract(INPUT, PROMPT_OPTIONS, {
      extract: extractorFor("hello world"),
      provider,
    });
    expect(provider.calls[0]!.system).toContain(
      "Extract the invoice number and total.",
    );
  });

  it("strips a ```json code fence the model may wrap the JSON in", async () => {
    const provider = providerReturning(SUCCESS('```json\n{"a":1,"b":2}\n```'));
    const run = await runAiExtract(INPUT, PROMPT_OPTIONS, {
      extract: extractorFor("real text"),
      provider,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const zip = await JSZip.loadAsync(run.output);
    expect(
      JSON.parse(await zip.file("extraction.json")!.async("string")),
    ).toEqual({ a: 1, b: 2 });
  });

  it("truncates over-long input (never silently) and flags it in meta + manifest", async () => {
    const provider = providerReturning(SUCCESS('{"ok":true}'));
    const longText = "word ".repeat(50);
    const run = await runAiExtract(INPUT, PROMPT_OPTIONS, {
      extract: extractorFor(longText),
      provider,
      limits: { maxInputChars: 20 },
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.meta.truncated).toBe(true);
    expect(provider.calls[0]!.messages[0]!.content).toContain(
      longText.slice(0, 20),
    );
    const zip = await JSZip.loadAsync(run.output);
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    expect(manifest.source.truncatedToCharacters).toBe(20);
  });

  it("clamps the generation budget to the configured max output tokens", async () => {
    const provider = providerReturning(SUCCESS('{"a":1}'));
    await runAiExtract(INPUT, PROMPT_OPTIONS, {
      extract: extractorFor("real text"),
      provider,
      limits: { maxOutputTokens: 512 },
    });
    expect(provider.calls[0]!.maxOutputTokens).toBe(512);
  });
});

// ---------------------------------------------------------------------------
// Truncation disclosure (TASK-43)
// ---------------------------------------------------------------------------

/**
 * Six pages of 200 characters each, joined by a blank line: offsets 0, 202, 404,
 * 606, 808, 1010, total 1,210. A 500-character cap therefore lands 96 characters
 * INTO page 3 — so page 2 is the last complete page and the cut is mid-page.
 */
const LONG_PAGES = Array.from({ length: 6 }, (_, i) =>
  String.fromCharCode(97 + i).repeat(200),
);

function longExtractor(): PdfTextExtractor {
  const pages = LONG_PAGES.map((text, i) => ({
    pageNumber: i + 1,
    text,
    characterCount: text.length,
  }));
  const joined = LONG_PAGES.join("\n\n");
  const extracted: ExtractedPdfText = {
    pageCount: LONG_PAGES.length,
    pages,
    text: joined,
    characterCount: joined.length,
    hasText: true,
  };
  return vi.fn(async () => extracted);
}

describe("a short window is disclosed — to the model and to the job record", () => {
  it("forbids reporting a field as absent when it was merely past the cut", async () => {
    const provider = providerReturning(SUCCESS('{"invoice_number":null}'));
    const run = await runAiExtract(INPUT, SCHEMA_OPTIONS, {
      extract: longExtractor(),
      provider,
      limits: { maxInputChars: 500 },
    });
    expect(run.ok).toBe(true);

    const system = provider.calls[0]?.system ?? "";
    expect(system).toMatch(/do NOT say the document does not contain it/);
    expect(system).toMatch(/not found IN THE PAGES EXAMINED/);
    expect(system).toMatch(/pages 1-2 of 6/);
  });

  it("reports the window on meta so the panel can state it without the model", async () => {
    const provider = providerReturning(SUCCESS('{"invoice_number":null}'));
    const run = await runAiExtract(INPUT, SCHEMA_OPTIONS, {
      extract: longExtractor(),
      provider,
      limits: { maxInputChars: 500 },
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.meta.window).toEqual({
      truncated: true,
      charactersSent: 500,
      charactersTotal: 1210,
      totalPages: 6,
      lastCompletePage: 2,
      cutMidPage: true,
    });
    expect(run.meta.truncationNotice).toMatch(/pages 1–2 of 6/);
  });

  it("says nothing at all when the whole document fits", async () => {
    const provider = providerReturning(SUCCESS('{"invoice_number":"A-1"}'));
    const run = await runAiExtract(INPUT, SCHEMA_OPTIONS, {
      extract: longExtractor(),
      provider,
      limits: { maxInputChars: 100_000 },
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.meta.truncated).toBe(false);
    expect(run.meta.truncationNotice).toBeNull();
    expect(provider.calls[0]?.system ?? "").not.toMatch(/ONLY PART/);
  });
});
