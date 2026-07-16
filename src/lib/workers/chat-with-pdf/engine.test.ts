import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import type { ExtractedPdfText, ExtractedTextPage } from "@/lib/pdf/text";
import type { ChatOptions } from "@/lib/jobs/chat-with-pdf";
import type { AiCompletionRequest, AiCompletionResult, AiProvider } from "../ai/provider";
import { runChatWithPdf, CHAT_ENGINE, type PdfTextExtractor } from "./engine";

const QUESTION: ChatOptions = { question: "What is the invoice total?" };
const INPUT = new Uint8Array([1, 2, 3, 4]);

/** Build an extractor whose pages carry per-page text (so citations are possible). */
function extractorForPages(pageTexts: string[]): PdfTextExtractor {
  const pages: ExtractedTextPage[] = pageTexts.map((text, i) => ({
    pageNumber: i + 1,
    text,
    characterCount: text.length,
  }));
  const joined = pageTexts.filter((t) => t.trim().length > 0).join("\n\n");
  const extracted: ExtractedPdfText = {
    pageCount: pageTexts.length,
    pages,
    text: joined,
    characterCount: joined.length,
    hasText: joined.trim().length > 0,
  };
  return vi.fn(async () => extracted);
}

/** Build an extractor with joined text but NO per-page metadata (grounded === false). */
function extractorForText(text: string, pageCount = 2): PdfTextExtractor {
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

describe("runChatWithPdf — honest failures", () => {
  it("fails `unsupported` when no text extractor is wired", async () => {
    const run = await runChatWithPdf(INPUT, QUESTION, { provider: providerReturning(SUCCESS("x")) });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("unsupported");
  });

  it("fails `ai_unconfigured` with operator requirements when NO provider is configured", async () => {
    const extract = extractorForPages(["Real document text."]);
    const run = await runChatWithPdf(INPUT, QUESTION, { extract });
    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.kind).toBe("ai_unconfigured");
      expect(run.retryable).toBe(false);
      expect(run.message).toContain("PDFXYZ_AI_PROVIDER");
      expect(run.message).toContain("PDFXYZ_AI_API_KEY");
    }
    // Honesty: with no provider we never read the PDF and never fabricate an answer.
    expect(extract).not.toHaveBeenCalled();
  });

  it("fails `no_text` (pointing at OCR) when the PDF has no selectable text", async () => {
    const run = await runChatWithPdf(INPUT, QUESTION, {
      extract: extractorForText("   "),
      provider: providerReturning(SUCCESS("x")),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.kind).toBe("no_text");
      expect(run.message).toMatch(/OCR/i);
    }
  });

  it("fails `too_large` when input exceeds the byte limit", async () => {
    const run = await runChatWithPdf(new Uint8Array(1000), QUESTION, {
      extract: extractorForText("text"),
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
    const run = await runChatWithPdf(INPUT, QUESTION, {
      extract: extractorForText("real text"),
      provider: providerReturning({ ok: false, kind: "rate_limited", message: "slow", retryable: true }),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run).toMatchObject({ kind: "rate_limited", retryable: true });
  });

  it("maps a provider refusal to `content_filtered`", async () => {
    const run = await runChatWithPdf(INPUT, QUESTION, {
      extract: extractorForText("real text"),
      provider: providerReturning({ ok: false, kind: "content_filtered", message: "no", retryable: false }),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("content_filtered");
  });

  it("maps a provider too_long to `too_large`", async () => {
    const run = await runChatWithPdf(INPUT, QUESTION, {
      extract: extractorForText("real text"),
      provider: providerReturning({ ok: false, kind: "too_long", message: "big", retryable: false }),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("too_large");
  });

  it("fails `failed` (never fabricates) when the model returns an empty answer", async () => {
    const run = await runChatWithPdf(INPUT, QUESTION, {
      extract: extractorForText("real text"),
      provider: providerReturning(SUCCESS("   ")),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("failed");
  });
});

describe("runChatWithPdf — provider-injected deterministic success", () => {
  it("answers from ONLY the document text, grounds the prompt in page markers, and packages the real answer", async () => {
    const provider = providerReturning(SUCCESS("The invoice total is $1,200 [p.2]."));
    const run = await runChatWithPdf(INPUT, QUESTION, {
      extract: extractorForPages(["Cover page.", "Invoice INV-42, grand total $1,200."]),
      provider,
      now: () => "2026-07-16T00:00:00.000Z",
    });

    expect(run.ok).toBe(true);
    if (!run.ok) return;

    const zip = await JSZip.loadAsync(run.output);
    // The shipped answer is EXACTLY the model's text — nothing invented.
    const answerTxt = await zip.file("answer.txt")!.async("string");
    expect(answerTxt).toContain("The invoice total is $1,200");
    const answerMd = await zip.file("answer.md")!.async("string");
    expect(answerMd).toContain("What is the invoice total?");
    expect(answerMd).toContain("The invoice total is $1,200");
    expect(await zip.file("README.txt")).not.toBeNull();

    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest.schema).toBe("pdfxyz.chat/v1");
    expect(manifest.provider).toBe("anthropic");
    expect(manifest.model).toBe("claude-sonnet-5");
    expect(manifest.question).toBe("What is the invoice total?");
    expect(manifest.grounded).toBe(true);
    expect(manifest.answer.citedPages).toEqual([2]);
    // No secret leaks into the package.
    expect(JSON.stringify(manifest)).not.toContain("PDFXYZ_AI_API_KEY");

    // The system prompt constrains the model to the provided text and enables page citation.
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.system).toMatch(/ONLY/);
    expect(provider.calls[0]!.system).toContain("[Page 2]");
    expect(provider.calls[0]!.system).toContain("$1,200");
    // The question is the final user turn.
    const msgs = provider.calls[0]!.messages;
    expect(msgs[msgs.length - 1]).toEqual({ role: "user", content: "What is the invoice total?" });
    // Deterministic QA: temperature pinned to 0.
    expect(provider.calls[0]!.temperature).toBe(0);

    expect(run.meta).toMatchObject({
      engine: CHAT_ENGINE,
      provider: "anthropic",
      model: "claude-sonnet-5",
      pageCount: 2,
      contextTurns: 0,
      citedPages: 1,
      grounded: true,
      truncated: false,
    });
  });

  it("prepends the conversation context turns before the final question", async () => {
    const provider = providerReturning(SUCCESS("It is due on March 1 [p.1]."));
    const run = await runChatWithPdf(
      INPUT,
      {
        question: "And the due date?",
        context: [
          { role: "user", content: "What is the invoice number?" },
          { role: "assistant", content: "It is INV-42 [p.1]." },
        ],
      },
      { extract: extractorForPages(["Invoice INV-42 due March 1."]), provider },
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(provider.calls[0]!.messages).toEqual([
      { role: "user", content: "What is the invoice number?" },
      { role: "assistant", content: "It is INV-42 [p.1]." },
      { role: "user", content: "And the due date?" },
    ]);
    expect(run.meta.contextTurns).toBe(2);
  });

  it("is explicit that answers are ungrounded when the extractor has no page metadata", async () => {
    const provider = providerReturning(SUCCESS("The answer is 42."));
    const run = await runChatWithPdf(INPUT, QUESTION, {
      extract: extractorForText("The answer is 42 somewhere in this flat text."),
      provider,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.meta.grounded).toBe(false);
    const zip = await JSZip.loadAsync(run.output);
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest.grounded).toBe(false);
    expect(manifest.notice).toMatch(/without page-level citations/i);
    // No page markers when there is no page metadata to cite.
    expect(provider.calls[0]!.system).not.toContain("[Page 1]");
  });

  it("truncates over-long source text (never silently) and flags it in meta + manifest", async () => {
    const provider = providerReturning(SUCCESS("Answer."));
    const longText = "word ".repeat(50);
    const run = await runChatWithPdf(INPUT, QUESTION, {
      extract: extractorForText(longText),
      provider,
      limits: { maxInputChars: 20 },
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.meta.truncated).toBe(true);
    const zip = await JSZip.loadAsync(run.output);
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest.source.truncatedToCharacters).toBe(20);
  });

  it("clamps the generation budget to the configured max output tokens", async () => {
    const provider = providerReturning(SUCCESS("Answer."));
    await runChatWithPdf(INPUT, QUESTION, {
      extract: extractorForText("real text"),
      provider,
      limits: { maxOutputTokens: 512 },
    });
    expect(provider.calls[0]!.maxOutputTokens).toBe(512);
  });
});
