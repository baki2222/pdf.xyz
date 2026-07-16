import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { ExtractedPdfText, ExtractedTextPage } from "@/lib/pdf/text";
import type { AiCompletionResult, AiProvider } from "../ai/provider";
import type { PdfTextExtractor } from "../chat-with-pdf/engine";
import type { ProcessorInput } from "./types";
import { createChatWithPdfProcessor } from "./chat-with-pdf";

function extractorFor(text: string, withPages = true): PdfTextExtractor {
  const pages: ExtractedTextPage[] =
    withPages && text.trim().length > 0
      ? [{ pageNumber: 1, text, characterCount: text.length }]
      : [];
  const extracted: ExtractedPdfText = {
    pageCount: 1,
    pages,
    text,
    characterCount: text.length,
    hasText: text.trim().length > 0,
  };
  return async () => extracted;
}

function provider(result: AiCompletionResult): AiProvider {
  return { id: "anthropic", model: "claude-sonnet-5", async complete() { return result; } };
}

const input = (options: Record<string, unknown> = { question: "What is the total?" }): ProcessorInput => ({
  tool: "chat-with-pdf",
  options,
  inputs: [{ fileId: "f1", filename: "invoice.pdf", contentType: "application/pdf", bytes: new Uint8Array([1]) }],
});

describe("createChatWithPdfProcessor", () => {
  it("owns only the chat-with-pdf tool", () => {
    const p = createChatWithPdfProcessor({ extract: extractorFor("x") });
    expect(p.tools).toEqual(["chat-with-pdf"]);
    expect(p.supports("chat-with-pdf")).toBe(true);
    expect(p.supports("summarize-pdf")).toBe(false);
  });

  it("reports not-ready + not_implemented when no AI provider is configured", async () => {
    const p = createChatWithPdfProcessor({ extract: extractorFor("real text") });
    expect(p.capability().ready).toBe(false);
    expect(p.capability().detail).toContain("AI provider");

    const result = await p.process(input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_implemented");
      expect(result.error.message).toContain("PDFXYZ_AI_PROVIDER");
    }
  });

  it("reports ready and produces a real answer ZIP with an injected provider", async () => {
    const p = createChatWithPdfProcessor({
      extract: extractorFor("A genuine invoice INV-9 total 500."),
      provider: provider({ ok: true, text: "The total is 500 [p.1].", model: "claude-sonnet-5" }),
    });
    expect(p.capability().ready).toBe(true);

    const result = await p.process(input());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0]!.filename).toBe("invoice-answer.zip");
      expect(result.artifacts[0]!.contentType).toBe("application/zip");
      const zip = await JSZip.loadAsync(result.artifacts[0]!.bytes);
      expect(await zip.file("answer.txt")!.async("string")).toContain("The total is 500");
      expect(result.meta).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5" });
    }
  });

  it("maps a scanned PDF (no text) to unprocessable_entity pointing at OCR", async () => {
    const p = createChatWithPdfProcessor({
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

  it("rejects a missing question before any model call", async () => {
    const p = createChatWithPdfProcessor({
      extract: extractorFor("text"),
      provider: provider({ ok: true, text: "x", model: "claude-sonnet-5" }),
    });
    const result = await p.process(input({}));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_request");
  });

  it("maps a provider rate limit to a retryable service_unavailable", async () => {
    const p = createChatWithPdfProcessor({
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
