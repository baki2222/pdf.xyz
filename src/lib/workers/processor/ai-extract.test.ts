import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { AiCompletionResult, AiProvider } from "../ai/provider";
import type { PdfTextExtractor } from "../ai-extract/engine";
import type { ProcessorInput } from "./types";
import { createAiExtractProcessor } from "./ai-extract";

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
  return { id: "anthropic", model: "claude-sonnet-5", async complete() { return result; } };
}

const input = (options: Record<string, unknown> = { mode: "prompt", prompt: "Extract totals" }): ProcessorInput => ({
  tool: "ai-extract",
  options,
  inputs: [{ fileId: "f1", filename: "invoice.pdf", contentType: "application/pdf", bytes: new Uint8Array([1]) }],
});

describe("createAiExtractProcessor", () => {
  it("owns only the ai-extract tool", () => {
    const p = createAiExtractProcessor({ extract: extractorFor("x") });
    expect(p.tools).toEqual(["ai-extract"]);
    expect(p.supports("ai-extract")).toBe(true);
    expect(p.supports("summarize-pdf")).toBe(false);
  });

  it("reports not-ready + not_implemented when no AI provider is configured", async () => {
    const p = createAiExtractProcessor({ extract: extractorFor("real text") });
    expect(p.capability().ready).toBe(false);
    expect(p.capability().detail).toContain("AI provider");

    const result = await p.process(input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_implemented");
      expect(result.error.message).toContain("PDFXYZ_AI_PROVIDER");
    }
  });

  it("reports ready and produces a real extraction ZIP with an injected provider", async () => {
    const p = createAiExtractProcessor({
      extract: extractorFor("A genuine invoice INV-9 total 500."),
      provider: provider({ ok: true, text: '{"invoice_number":"INV-9","total":500}', model: "claude-sonnet-5" }),
    });
    expect(p.capability().ready).toBe(true);

    const result = await p.process(input({ mode: "schema", schema: [{ name: "invoice_number", type: "string" }] }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0]!.filename).toBe("invoice-extraction.zip");
      expect(result.artifacts[0]!.contentType).toBe("application/zip");
      const zip = await JSZip.loadAsync(result.artifacts[0]!.bytes);
      expect(JSON.parse(await zip.file("extraction.json")!.async("string"))).toEqual({
        invoice_number: "INV-9",
        total: 500,
      });
      expect(result.meta).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5", mode: "schema" });
    }
  });

  it("maps a scanned PDF (no text) to unprocessable_entity pointing at OCR", async () => {
    const p = createAiExtractProcessor({
      extract: extractorFor("   "),
      provider: provider({ ok: true, text: "{}", model: "claude-sonnet-5" }),
    });
    const result = await p.process(input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unprocessable_entity");
      expect(result.error.message).toMatch(/OCR/i);
    }
  });

  it("maps a non-JSON model reply to unprocessable_entity (never a fabricated result)", async () => {
    const p = createAiExtractProcessor({
      extract: extractorFor("real text"),
      provider: provider({ ok: true, text: "Sorry, here is a prose answer.", model: "claude-sonnet-5" }),
    });
    const result = await p.process(input());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/json/i);
  });

  it("rejects a missing mode before any model call", async () => {
    const p = createAiExtractProcessor({
      extract: extractorFor("text"),
      provider: provider({ ok: true, text: "{}", model: "claude-sonnet-5" }),
    });
    const result = await p.process(input({}));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_request");
  });

  it("rejects an empty schema", async () => {
    const p = createAiExtractProcessor({
      extract: extractorFor("text"),
      provider: provider({ ok: true, text: "{}", model: "claude-sonnet-5" }),
    });
    const result = await p.process(input({ mode: "schema", schema: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_request");
  });

  it("maps a provider rate limit to a retryable service_unavailable", async () => {
    const p = createAiExtractProcessor({
      extract: extractorFor("text"),
      provider: provider({ ok: false, kind: "rate_limited", message: "slow", retryable: true }),
    });
    const result = await p.process(input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("service_unavailable");
      expect(result.error.retryable).toBe(true);
    }
  });
});
