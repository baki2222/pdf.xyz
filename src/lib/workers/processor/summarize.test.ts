import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { AiCompletionResult, AiProvider } from "../ai/provider";
import type { PdfTextExtractor } from "../summarize/engine";
import type { ProcessorInput } from "./types";
import { createSummarizeProcessor } from "./summarize";

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

const input = (options: Record<string, unknown> = {}): ProcessorInput => ({
  tool: "summarize-pdf",
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

describe("createSummarizeProcessor", () => {
  it("owns only the summarize-pdf tool", () => {
    const p = createSummarizeProcessor({ extract: extractorFor("x") });
    expect(p.tools).toEqual(["summarize-pdf"]);
    expect(p.supports("summarize-pdf")).toBe(true);
    expect(p.supports("compress-pdf")).toBe(false);
  });

  it("reports not-ready + not_implemented when no AI provider is configured", async () => {
    const p = createSummarizeProcessor({ extract: extractorFor("real text") });
    expect(p.capability().ready).toBe(false);
    expect(p.capability().detail).toContain("AI provider");

    const result = await p.process(input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_implemented");
      expect(result.error.message).toContain("PDFXYZ_AI_PROVIDER");
    }
  });

  it("reports ready and produces a real summary ZIP with an injected provider", async () => {
    const p = createSummarizeProcessor({
      extract: extractorFor("A genuine document with content."),
      provider: provider({
        ok: true,
        text: "Real summary.",
        model: "claude-sonnet-5",
      }),
    });
    expect(p.capability().ready).toBe(true);

    const result = await p.process(input({ length: "brief" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0]!.filename).toBe("report-summary.zip");
      expect(result.artifacts[0]!.contentType).toBe("application/zip");
      const zip = await JSZip.loadAsync(result.artifacts[0]!.bytes);
      expect(await zip.file("summary.txt")!.async("string")).toBe(
        "Real summary.",
      );
      expect(result.meta).toMatchObject({
        provider: "anthropic",
        model: "claude-sonnet-5",
      });
    }
  });

  it("maps a scanned PDF (no text) to unprocessable_entity pointing at OCR", async () => {
    const p = createSummarizeProcessor({
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

  it("rejects invalid options before any model call", async () => {
    const p = createSummarizeProcessor({
      extract: extractorFor("text"),
      provider: provider({ ok: true, text: "x", model: "claude-sonnet-5" }),
    });
    const result = await p.process(input({ length: "invalid-length" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_request");
  });

  it("maps a provider rate limit to a retryable service_unavailable", async () => {
    const p = createSummarizeProcessor({
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
