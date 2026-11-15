import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { AI_SPEND_CEILING } from "@/lib/jobs/ai-spend-ceiling";
import { sanitizeJobResults } from "@/lib/jobs/results";
import { createAnthropicProvider } from "../ai/anthropic";
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

/**
 * Audit summarize-pdf#2, through the composed chain: the REAL Anthropic
 * adapter (only `fetch` faked) → the engine → this processor → the value a
 * job record persists. A unit test of the engine could pass while the
 * processor's `jobError` or `aiResultsFromFailure` dropped what matters here.
 */
describe("a Detailed run that hits its output limit (incomplete_output)", () => {
  it("sends the per-run figure on the wire, and the job record gets honest words and the spend", async () => {
    const limit = AI_SPEND_CEILING.outputTokensPerFullRun;
    const sent: Array<{ max_tokens?: unknown }> = [];
    const fake = (async (_url: unknown, init?: { body?: unknown }) => {
      sent.push(JSON.parse(String(init?.body)) as { max_tokens?: unknown });
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "Section 1 says... Section 2 sa" }],
          stop_reason: "max_tokens",
          usage: { input_tokens: 90_000, output_tokens: limit },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const p = createSummarizeProcessor({
      extract: extractorFor("A long report with many sections."),
      provider: createAnthropicProvider(
        { model: "claude-sonnet-5", apiKey: "test-key", timeoutMs: 1_000 },
        { fetch: fake },
      ),
    });
    const result = await p.process(input({ length: "detailed" }));

    // The wire: the request carried the per-run figure, not the old 4,000.
    expect(sent).toHaveLength(1);
    expect(sent[0]!.max_tokens).toBe(limit);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.retryable).toBe(false);
    expect(result.error.message).toContain(
      `${limit.toLocaleString("en-US")}-token output limit`,
    );
    expect(result.error.message).toContain("Standard");
    expect(result.error.message).not.toMatch(/briefer output/i);
    expect(result.error.message).not.toMatch(/shorter document/i);

    const persisted = sanitizeJobResults(result.results);
    expect(
      persisted?.ai?.usage,
      "incomplete_output burned the full output budget and the job record has no usage",
    ).toEqual({
      inputTokens: 90_000,
      outputTokens: limit,
      calls: 1,
      model: "claude-sonnet-5",
    });
    expect(persisted?.ai?.truncation).toBeDefined();
  });
});
