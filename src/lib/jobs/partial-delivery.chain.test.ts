// @vitest-environment node
/**
 * A partial delivery reaches the SCREEN, not only the artifact.
 *
 * The withheld pages have been marked inside `translation.md` since the cap
 * landed — positioned where those pages were, so a reader who opens the package
 * meets them. The panel still said *"Your AI translation package is ready"*:
 * true in the narrow sense that the job finished, while the thing the user
 * asked for was not delivered and their daily allowance was spent on it.
 *
 * **A surface may not assert something the system contradicts**, and the record
 * is what contradicts it — so this drives the whole path the fact has to cross
 * rather than the two ends of it. The engine computes it, the processor puts it
 * on the result, `sanitizeJobResults` is the persistence boundary that could
 * silently drop it, and the panel reads it back. Each of those is a place a
 * field goes missing without anything erroring.
 */
import { describe, expect, it, vi } from "vitest";
import { runTranslate } from "@/lib/workers/translate/engine";
import { createTranslateProcessor } from "@/lib/workers/processor/translate";
import { sanitizeJobResults } from "@/lib/jobs/results";
import { buildAiResultMeta } from "@/lib/jobs/ai-results";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { AiCompletionResult, AiProvider } from "@/lib/workers/ai/provider";
import type { TranslateOptions } from "@/lib/jobs/translate-pdf";

const OPTIONS: TranslateOptions = {
  targetLanguage: "fr",
  sourceLanguage: "auto",
};

function extraction(pages: number, perPage: number): ExtractedPdfText {
  const list = Array.from({ length: pages }, (_, i) => ({
    pageNumber: i + 1,
    text: "x".repeat(perPage),
    characterCount: perPage,
  }));
  const text = list.map((p) => p.text).join("\n\n");
  return {
    pageCount: pages,
    pages: list,
    text,
    characterCount: text.length,
    hasText: true,
  };
}

function provider(): AiProvider {
  return {
    id: "anthropic",
    model: "test-model",
    async complete(): Promise<AiCompletionResult> {
      return {
        ok: true,
        text: "translated",
        model: "test-model",
        usage: { inputTokens: 10, outputTokens: 10 },
      };
    },
  };
}

const deps = (delivery?: { characters: number; pages?: number }) => ({
  extract: vi.fn(async () => extraction(6, 4_000)),
  provider: provider(),
  now: () => "1970-01-01T00:00:00.000Z",
  ...(delivery ? { limits: { delivery } } : {}),
});

describe("a capped job reports a partial delivery, end to end", () => {
  it("the ENGINE records what it withheld, and which bound stopped it", async () => {
    const run = await runTranslate(
      new Uint8Array([1, 2, 3, 4]),
      OPTIONS,
      deps({ characters: Number.POSITIVE_INFINITY, pages: 2 }),
    );
    expect(run.ok, run.ok ? "" : run.message).toBe(true);
    if (!run.ok) return;

    expect(run.meta.delivery).toEqual({
      deliveredPages: 2,
      withheldPages: 4,
      boundBy: "pages",
    });
  });

  it("the PROCESSOR puts it on the job results", async () => {
    const processor = createTranslateProcessor(
      deps({ characters: Number.POSITIVE_INFINITY, pages: 2 }),
    );
    const result = await processor.process({
      tool: "translate-pdf",
      options: { targetLanguage: "fr", sourceLanguage: "auto" },
      inputs: [
        {
          fileId: "f_abc123def456",
          filename: "doc.pdf",
          contentType: "application/pdf",
          bytes: new Uint8Array([1, 2, 3, 4]),
        },
      ],
    });
    expect(result.ok, result.ok ? "" : result.error.message).toBe(true);
    if (!result.ok) return;
    expect(result.results?.ai?.delivery?.withheldPages).toBe(4);
    expect(result.results?.ai?.delivery?.boundBy).toBe("pages");
  });

  it("the PERSISTENCE BOUNDARY keeps it", async () => {
    // `sanitizeJobResults` whitelists; a field it does not know about is
    // dropped silently and the panel would then render a complete delivery for
    // a partial one, with nothing erroring anywhere.
    const processor = createTranslateProcessor(
      deps({ characters: Number.POSITIVE_INFINITY, pages: 2 }),
    );
    const result = await processor.process({
      tool: "translate-pdf",
      options: { targetLanguage: "fr", sourceLanguage: "auto" },
      inputs: [
        {
          fileId: "f_abc123def456",
          filename: "doc.pdf",
          contentType: "application/pdf",
          bytes: new Uint8Array([1, 2, 3, 4]),
        },
      ],
    });
    if (!result.ok) throw new Error("processor failed");

    const persisted = sanitizeJobResults(result.results);
    expect(
      persisted?.ai?.delivery,
      "the sanitizer dropped the delivery block, so a partial delivery reaches " +
        "the browser as a complete one and nothing errors",
    ).toEqual({ deliveredPages: 2, withheldPages: 4, boundBy: "pages" });
  });

  it("CONTROL: an uncapped job carries NO delivery block", async () => {
    // Absent is the discriminant for "delivered in full". If a complete job
    // grew a block, every translation would announce itself as partial.
    const run = await runTranslate(
      new Uint8Array([1, 2, 3, 4]),
      OPTIONS,
      deps(),
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.meta.delivery).toBeUndefined();
  });

  it("CONTROL: a cap that does not bind carries no block either", async () => {
    const run = await runTranslate(
      new Uint8Array([1, 2, 3, 4]),
      OPTIONS,
      deps({ characters: Number.POSITIVE_INFINITY, pages: 99 }),
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.meta.delivery).toBeUndefined();
  });
});

describe("the persistence boundary refuses a block that says nothing", () => {
  it("drops withheldPages: 0 rather than reporting a partial delivery of nothing", () => {
    // The same discipline the truncation window already has: a payload saying
    // "delivered in part" over a complete delivery is a confident sentence
    // about nothing, and it would render as one.
    const built = buildAiResultMeta({
      truncation: {
        truncated: false,
        charactersSent: 10,
        charactersTotal: 10,
        totalPages: 3,
        lastCompletePage: 3,
        cutMidPage: false,
      },
      delivery: { deliveredPages: 3, withheldPages: 0, boundBy: "pages" },
    });
    expect(built.delivery).toBeUndefined();
  });

  it("drops a bound it does not recognise", () => {
    // `boundBy` is what the UI switches on to choose an action sentence. A
    // corrupted or newer record must not widen that vocabulary.
    const built = buildAiResultMeta({
      truncation: {
        truncated: false,
        charactersSent: 10,
        charactersTotal: 10,
        totalPages: 3,
        lastCompletePage: 3,
        cutMidPage: false,
      },
      delivery: {
        deliveredPages: 1,
        withheldPages: 2,
        boundBy: "vibes" as unknown as "pages",
      },
    });
    expect(built.delivery).toBeUndefined();
  });

  it("clamps a hostile count rather than trusting it", () => {
    const built = buildAiResultMeta({
      truncation: {
        truncated: false,
        charactersSent: 10,
        charactersTotal: 10,
        totalPages: 3,
        lastCompletePage: 3,
        cutMidPage: false,
      },
      delivery: {
        deliveredPages: -5,
        withheldPages: 2.7,
        boundBy: "characters",
      },
    });
    expect(built.delivery).toEqual({
      deliveredPages: 0,
      withheldPages: 2,
      boundBy: "characters",
    });
  });
});
