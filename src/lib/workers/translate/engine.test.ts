import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { TranslateOptions } from "@/lib/jobs/translate-pdf";
import type { AiCompletionRequest, AiCompletionResult, AiProvider } from "../ai/provider";
import { runTranslate, TRANSLATE_ENGINE, type PdfTextExtractor } from "./engine";

const OPTIONS: TranslateOptions = { targetLanguage: "fr", sourceLanguage: "auto" };
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

/** A deterministic provider that returns a fixed translation and records the request. */
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

describe("runTranslate — honest failures", () => {
  it("fails `unsupported` when no text extractor is wired", async () => {
    const run = await runTranslate(INPUT, OPTIONS, { provider: providerReturning(SUCCESS("x")) });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("unsupported");
  });

  it("fails `ai_unconfigured` with operator requirements when NO provider is configured", async () => {
    const extract = extractorFor("Plenty of real document text here.");
    const run = await runTranslate(INPUT, OPTIONS, { extract });
    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.kind).toBe("ai_unconfigured");
      expect(run.retryable).toBe(false);
      expect(run.message).toContain("PDFXYZ_AI_PROVIDER");
      expect(run.message).toContain("PDFXYZ_AI_API_KEY");
    }
    // Honesty: with no provider we never even call a model, and never fabricate output.
    expect(extract).not.toHaveBeenCalled();
  });

  it("fails `no_text` (pointing at OCR) when the PDF has no selectable text", async () => {
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: extractorFor("   "),
      provider: providerReturning(SUCCESS("x")),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.kind).toBe("no_text");
      expect(run.message).toMatch(/OCR/i);
    }
  });

  it("fails `too_large` when input exceeds the byte limit", async () => {
    const run = await runTranslate(new Uint8Array(1000), OPTIONS, {
      extract: extractorFor("text"),
      provider: providerReturning(SUCCESS("x")),
      limits: { maxInputBytes: 10 },
    });
    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.kind).toBe("too_large");
      expect(run.limitBytes).toBe(10);
    }
  });

  it("maps a provider rate_limit to a retryable `rate_limited`", async () => {
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: extractorFor("real text"),
      provider: providerReturning({ ok: false, kind: "rate_limited", message: "slow", retryable: true }),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run).toMatchObject({ kind: "rate_limited", retryable: true });
  });

  it("maps a provider refusal to `content_filtered`", async () => {
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: extractorFor("real text"),
      provider: providerReturning({ ok: false, kind: "content_filtered", message: "no", retryable: false }),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("content_filtered");
  });

  it("maps a provider too_long to `too_large`", async () => {
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: extractorFor("real text"),
      provider: providerReturning({ ok: false, kind: "too_long", message: "big", retryable: false }),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("too_large");
  });

  it("fails `failed` when the provider returns an empty translation", async () => {
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: extractorFor("real text"),
      provider: providerReturning(SUCCESS("   ")),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("failed");
  });
});

describe("runTranslate — provider-injected deterministic success", () => {
  it("packages the model's REAL translation and never fabricates one", async () => {
    const provider = providerReturning(SUCCESS("Ceci est la vraie traduction du modèle."));
    const run = await runTranslate(
      INPUT,
      { targetLanguage: "fr", sourceLanguage: "en", instructions: "keep product names in English" },
      {
        extract: extractorFor("This is a genuine document about quarterly results.", 5),
        provider,
        now: () => "2026-07-16T00:00:00.000Z",
      },
    );

    expect(run.ok).toBe(true);
    if (!run.ok) return;

    // The translation that ships is EXACTLY the provider's text — nothing invented.
    const zip = await JSZip.loadAsync(run.output);
    expect(await zip.file("translation.txt")!.async("string")).toBe(
      "Ceci est la vraie traduction du modèle.",
    );
    expect(await zip.file("translation.md")!.async("string")).toContain(
      "Ceci est la vraie traduction du modèle.",
    );
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest.provider).toBe("anthropic");
    expect(manifest.model).toBe("claude-sonnet-5");
    expect(manifest.options).toEqual({
      targetLanguage: "fr",
      targetLanguageName: "French",
      sourceLanguage: "en",
      instructions: "keep product names in English",
    });

    // The system prompt constrains the model to the provided text (anti-hallucination),
    // names the real target language, and carries the caller directive.
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.system).toContain("ONLY the document text");
    expect(provider.calls[0]!.system).toContain("French");
    expect(provider.calls[0]!.system).toContain("keep product names in English");
    expect(provider.calls[0]!.messages[0]!.content).toContain("quarterly results");

    // Content-free meta carries counts, provider/model, languages — never document text.
    expect(run.meta).toMatchObject({
      engine: TRANSLATE_ENGINE,
      provider: "anthropic",
      model: "claude-sonnet-5",
      targetLanguage: "fr",
      sourceLanguage: "en",
      pageCount: 5,
      truncated: false,
      translationCharacters: "Ceci est la vraie traduction du modèle.".length,
    });
  });

  it("instructs auto-detection when the source language is auto", async () => {
    const provider = providerReturning(SUCCESS("hola"));
    await runTranslate(INPUT, { targetLanguage: "es", sourceLanguage: "auto" }, {
      extract: extractorFor("hello world"),
      provider,
    });
    expect(provider.calls[0]!.system).toMatch(/detect/i);
  });

  it("truncates over-long input (never silently) and flags it in meta + manifest", async () => {
    const provider = providerReturning(SUCCESS("traduction"));
    const longText = "word ".repeat(50);
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: extractorFor(longText),
      provider,
      limits: { maxInputChars: 20 },
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.meta.truncated).toBe(true);
    // The prompt only carried the first 20 characters.
    expect(provider.calls[0]!.messages[0]!.content).toContain(longText.slice(0, 20));
    const zip = await JSZip.loadAsync(run.output);
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest.source.truncatedToCharacters).toBe(20);
  });

  it("clamps the generation budget to the configured max output tokens", async () => {
    const provider = providerReturning(SUCCESS("s"));
    await runTranslate(INPUT, OPTIONS, {
      extract: extractorFor("real text"),
      provider,
      limits: { maxOutputTokens: 512 },
    });
    expect(provider.calls[0]!.maxOutputTokens).toBe(512);
  });
});
