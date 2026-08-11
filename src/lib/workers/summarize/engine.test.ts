import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { SummarizeOptions } from "@/lib/jobs/summarize-pdf";
import type {
  AiCompletionRequest,
  AiCompletionResult,
  AiProvider,
} from "../ai/provider";
import {
  runSummarize,
  SUMMARIZE_ENGINE,
  type PdfTextExtractor,
} from "./engine";

const OPTIONS: SummarizeOptions = { length: "standard", format: "paragraphs" };
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

/** A deterministic provider that returns a fixed summary and records the request. */
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

describe("runSummarize — honest failures", () => {
  it("fails `unsupported` when no text extractor is wired", async () => {
    const run = await runSummarize(INPUT, OPTIONS, {
      provider: providerReturning(SUCCESS("x")),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("unsupported");
  });

  it("fails `ai_unconfigured` with operator requirements when NO provider is configured", async () => {
    const extract = extractorFor("Plenty of real document text here.");
    const run = await runSummarize(INPUT, OPTIONS, { extract });
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
    const run = await runSummarize(INPUT, OPTIONS, {
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
    const run = await runSummarize(new Uint8Array(1000), OPTIONS, {
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
    const run = await runSummarize(INPUT, OPTIONS, {
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
    const run = await runSummarize(INPUT, OPTIONS, {
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
    const run = await runSummarize(INPUT, OPTIONS, {
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
});

describe("runSummarize — provider-injected deterministic success", () => {
  it("packages the model's REAL summary and never fabricates one", async () => {
    const provider = providerReturning(
      SUCCESS("This is the real model summary."),
    );
    const run = await runSummarize(
      INPUT,
      { length: "brief", format: "bullets", focus: "risks" },
      {
        extract: extractorFor(
          "A genuine document about quarterly results and risks.",
          5,
        ),
        provider,
        now: () => "2026-07-15T00:00:00.000Z",
      },
    );

    expect(run.ok).toBe(true);
    if (!run.ok) return;

    // The summary that ships is EXACTLY the provider's text — nothing invented.
    const zip = await JSZip.loadAsync(run.output);
    expect(await zip.file("summary.txt")!.async("string")).toBe(
      "This is the real model summary.",
    );
    expect(await zip.file("summary.md")!.async("string")).toContain(
      "This is the real model summary.",
    );
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    expect(manifest.provider).toBe("anthropic");
    expect(manifest.model).toBe("claude-sonnet-5");
    expect(manifest.options).toEqual({
      length: "brief",
      format: "bullets",
      focus: "risks",
    });

    // The system prompt constrains the model to the provided text (anti-hallucination).
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.system).toContain(
      "ONLY the content of the document",
    );
    expect(provider.calls[0]!.messages[0]!.content).toContain(
      "quarterly results and risks",
    );

    // Content-free meta carries counts, provider/model — never the document text.
    expect(run.meta).toMatchObject({
      engine: SUMMARIZE_ENGINE,
      provider: "anthropic",
      model: "claude-sonnet-5",
      length: "brief",
      pageCount: 5,
      truncated: false,
      summaryCharacters: "This is the real model summary.".length,
    });
  });

  it("truncates over-long input (never silently) and flags it in meta + manifest", async () => {
    const provider = providerReturning(SUCCESS("summary"));
    const longText = "word ".repeat(50);
    const run = await runSummarize(INPUT, OPTIONS, {
      extract: extractorFor(longText),
      provider,
      limits: { maxInputChars: 20 },
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.meta.truncated).toBe(true);
    // The prompt only carried the first 20 characters.
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
    const provider = providerReturning(SUCCESS("s"));
    await runSummarize(
      INPUT,
      { length: "detailed", format: "paragraphs" },
      {
        extract: extractorFor("real text"),
        provider,
        limits: { maxOutputTokens: 512 },
      },
    );
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
  it("tells the model it is seeing only part, and names the last COMPLETE page", async () => {
    const provider = providerReturning(SUCCESS("A summary."));
    const run = await runSummarize(INPUT, OPTIONS, {
      extract: longExtractor(),
      provider,
      limits: { maxInputChars: 500 },
    });
    expect(run.ok).toBe(true);

    const system = provider.calls[0]?.system ?? "";
    // Not merely "some of the document was cut": the instruction that PRODUCED
    // the defect has to be revoked, or a model told only "answer from the
    // document" still reports absence as absence from the whole document.
    expect(system).toMatch(/do NOT say the document does not contain it/);
    expect(system).toMatch(/pages 1-2 of 6/);
    expect(system).toMatch(/mid-page/);
  });

  it("reports the window on meta so the panel can state it without the model", async () => {
    const provider = providerReturning(SUCCESS("A summary."));
    const run = await runSummarize(INPUT, OPTIONS, {
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
    const provider = providerReturning(SUCCESS("A summary."));
    const run = await runSummarize(INPUT, OPTIONS, {
      extract: longExtractor(),
      provider,
      limits: { maxInputChars: 100_000 },
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.meta.truncated).toBe(false);
    expect(run.meta.truncationNotice).toBeNull();
    // A notice on an untruncated document would be its own false claim.
    expect(provider.calls[0]?.system ?? "").not.toMatch(/ONLY PART/);
  });
});
