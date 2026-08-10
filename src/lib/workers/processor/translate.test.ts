import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { AiCompletionResult, AiProvider } from "../ai/provider";
import type { PdfTextExtractor } from "../translate/engine";
import type { ProcessorInput } from "./types";
import { createTranslateProcessor } from "./translate";

function extractorFor(text: string): PdfTextExtractor {
  const extracted: ExtractedPdfText = {
    pageCount: 2,
    pages: [],
    text,
    characterCount: text.length,
    hasText: text.trim().length > 0,
  };
  return async () => extracted;
}

function provider(result: AiCompletionResult): AiProvider {
  return {
    id: "anthropic",
    model: "claude-sonnet-5",
    async complete() {
      return result;
    },
  };
}

const input = (
  options: Record<string, unknown> = { targetLanguage: "fr" },
): ProcessorInput => ({
  tool: "translate-pdf",
  options,
  inputs: [
    {
      fileId: "f1",
      filename: "report.pdf",
      contentType: "application/pdf",
      bytes: new Uint8Array([1]),
    },
  ],
});

describe("createTranslateProcessor", () => {
  it("owns only the translate-pdf tool", () => {
    const p = createTranslateProcessor({ extract: extractorFor("x") });
    expect(p.tools).toEqual(["translate-pdf"]);
    expect(p.supports("translate-pdf")).toBe(true);
    expect(p.supports("summarize-pdf")).toBe(false);
  });

  it("reports not-ready + not_implemented when no AI provider is configured", async () => {
    const p = createTranslateProcessor({ extract: extractorFor("real text") });
    expect(p.capability().ready).toBe(false);
    expect(p.capability().detail).toContain("AI provider");

    const result = await p.process(input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_implemented");
      expect(result.error.message).toContain("PDFXYZ_AI_PROVIDER");
    }
  });

  it("reports ready and produces a real translation ZIP with an injected provider", async () => {
    const p = createTranslateProcessor({
      extract: extractorFor("A genuine document with content."),
      provider: provider({
        ok: true,
        text: "Traduction réelle.",
        model: "claude-sonnet-5",
      }),
    });
    expect(p.capability().ready).toBe(true);

    const result = await p.process(input({ targetLanguage: "fr" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0]!.filename).toBe("report-translation.zip");
      expect(result.artifacts[0]!.contentType).toBe("application/zip");
      const zip = await JSZip.loadAsync(result.artifacts[0]!.bytes);
      expect(await zip.file("translation.txt")!.async("string")).toBe(
        "Traduction réelle.",
      );
      expect(result.meta).toMatchObject({
        provider: "anthropic",
        model: "claude-sonnet-5",
        targetLanguage: "fr",
      });
    }
  });

  it("maps a scanned PDF (no text) to unprocessable_entity pointing at OCR", async () => {
    const p = createTranslateProcessor({
      extract: extractorFor("   "),
      provider: provider({ ok: true, text: "x", model: "claude-sonnet-5" }),
    });
    const result = await p.process(input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unprocessable_entity");
      expect(result.error.message).toMatch(/OCR/i);
    }
  });

  it("rejects a missing target language before any model call", async () => {
    const p = createTranslateProcessor({
      extract: extractorFor("text"),
      provider: provider({ ok: true, text: "x", model: "claude-sonnet-5" }),
    });
    const result = await p.process(input({}));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_request");
  });

  it("rejects an unknown target language", async () => {
    const p = createTranslateProcessor({
      extract: extractorFor("text"),
      provider: provider({ ok: true, text: "x", model: "claude-sonnet-5" }),
    });
    const result = await p.process(input({ targetLanguage: "elvish" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_request");
  });

  it("maps a provider rate limit to a retryable service_unavailable", async () => {
    const p = createTranslateProcessor({
      extract: extractorFor("text"),
      provider: provider({
        ok: false,
        kind: "rate_limited",
        message: "slow",
        retryable: true,
      }),
    });
    const result = await p.process(input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("service_unavailable");
      expect(result.error.retryable).toBe(true);
    }
  });
});
