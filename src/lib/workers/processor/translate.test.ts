import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { AiCompletionResult, AiProvider } from "../ai/provider";
import type { PdfTextExtractor, TranslateDeps } from "../translate/engine";
import type { TranslatePdfResult } from "../translate/pdf-render";
import type { ProcessorInput } from "./types";
import { createTranslateProcessor } from "./translate";
import {
  ATTEMPT_ABORTED_CODE,
  AttemptAbortedError,
  settleAttempt,
} from "../attempt-abort";

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

/**
 * A post-spend failure owes the job record its spend (2026-11-15). Through the
 * processor, because `aiResultsFromFailure` drops the block when the engine
 * forgets the window — the engine can be fixed while this seam is not.
 */
describe("a translate failure after a provider call carries its usage", () => {
  const spent: AiCompletionResult = {
    ok: true,
    text: "Traduction réelle.",
    model: "claude-sonnet-5",
    usage: { inputTokens: 100, outputTokens: 20 },
  };

  it("the package size arm reaches results.ai.usage", async () => {
    const p = createTranslateProcessor({
      extract: extractorFor("A genuine document with content."),
      provider: provider(spent),
      limits: { maxOutputBytes: 1 },
    });
    const result = await p.process(input());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.results?.ai?.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      calls: 1,
      model: "claude-sonnet-5",
    });
    expect(result.results?.ai?.truncation).toBeDefined();
  });

  it("an empty single translation reaches results.ai.usage", async () => {
    const p = createTranslateProcessor({
      extract: extractorFor("A genuine document with content."),
      provider: provider({ ...spent, text: "  " }),
    });
    const result = await p.process(input());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.results?.ai?.usage?.calls).toBe(1);
  });

  it("an interruption after empty parts reaches results.ai.usage with every call", async () => {
    const perPage = "a".repeat(2000);
    const pages = Array.from({ length: 20 }, (_, i) => ({
      pageNumber: i + 1,
      text: perPage,
      characterCount: perPage.length,
    }));
    const joined = pages.map((pg) => pg.text).join("\n\n");
    let n = 0;
    const p = createTranslateProcessor({
      extract: async () => ({
        pageCount: pages.length,
        pages,
        text: joined,
        characterCount: joined.length,
        hasText: true,
      }),
      provider: {
        id: "anthropic",
        model: "claude-sonnet-5",
        async complete() {
          n += 1;
          return n === 1
            ? { ...spent, text: " " }
            : {
                ok: false,
                kind: "provider_error",
                retryable: true,
                message: "upstream 500",
                usage: { inputTokens: 7, outputTokens: 3 },
              };
        },
      },
    });
    const result = await p.process(input());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.results?.ai?.usage).toMatchObject({
      inputTokens: 107,
      outputTokens: 23,
      calls: 2,
    });
  });
});

describe("the reflowed PDF is the SECOND artifact, never the first", () => {
  const spent: AiCompletionResult = {
    ok: true,
    text: "Traduction réelle.",
    model: "claude-sonnet-5",
    usage: { inputTokens: 100, outputTokens: 20 },
  };
  const PDF = new Uint8Array([37, 80, 68, 70, 45]);
  const pdfDep = (
    result: TranslatePdfResult,
  ): NonNullable<TranslateDeps["pdf"]> => ({
    languages: () => new Set(["fr"]),
    render: async () => result,
  });

  it("[zip, pdf] in that order, with usage and the pdf outcome on the record", async () => {
    const p = createTranslateProcessor({
      extract: extractorFor("A genuine document with content."),
      provider: provider(spent),
      pdf: pdfDep({ ok: true, bytes: PDF, pages: 1 }),
    });
    const result = await p.process(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifacts.map((a) => [a.filename, a.contentType])).toEqual([
      ["report-translation.zip", "application/zip"],
      ["report-translated.pdf", "application/pdf"],
    ]);
    expect(result.artifacts[1]!.bytes).toEqual(PDF);
    expect(result.results?.ai?.usage?.calls).toBe(1);
    expect(result.results?.ai?.pdf).toEqual({
      rendered: true,
      pages: 1,
      bytes: PDF.byteLength,
    });
  });

  it("[zip] alone when the PDF could not be drawn, and the record says why", async () => {
    const p = createTranslateProcessor({
      extract: extractorFor("A genuine document with content."),
      provider: provider(spent),
      pdf: pdfDep({ ok: false, reason: "render_failed" }),
    });
    const result = await p.process(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifacts.map((a) => a.contentType)).toEqual([
      "application/zip",
    ]);
    expect(result.results?.ai?.usage?.calls).toBe(1);
    expect(result.results?.ai?.pdf).toEqual({
      rendered: false,
      reason: "render_failed",
    });
  });

  // 2026-11-15, review r1 (CLAUDE.md rule 3). The render runs AFTER every paid
  // call and takes the attempt's signal; `renderTranslationPdf` rethrows an
  // attempt abort. That throw used to escape `runTranslate`, so
  // `settleAttempt` mapped it to a failure with NO results — and the executor
  // recorded the paid calls as 0 tokens. Red on that code with `usage:
  // undefined`; the engine now catches around the render and returns the
  // success it already had, and `settleAttempt` keeps its results.
  it("an attempt abort DURING the render keeps the paid usage on the aborted result", async () => {
    const attempt = new AbortController();
    const p = createTranslateProcessor({
      extract: extractorFor("A genuine document with content."),
      provider: provider(spent),
      pdf: {
        languages: () => new Set(["fr"]),
        render: async () => {
          attempt.abort();
          // What renderTranslationPdf throws on a real abort.
          throw new AttemptAbortedError();
        },
      },
    });
    const result = await settleAttempt(attempt.signal, () =>
      p.process({ ...input(), signal: attempt.signal }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(ATTEMPT_ABORTED_CODE);
    expect(result.results?.ai?.usage).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
      calls: 1,
    });
  });

  it("a renderer that THROWS anything else still returns the ZIP (the PDF never fails the job)", async () => {
    const p = createTranslateProcessor({
      extract: extractorFor("A genuine document with content."),
      provider: provider(spent),
      pdf: {
        languages: () => new Set(["fr"]),
        render: async () => {
          throw new Error("renderer wiring crashed");
        },
      },
    });
    const result = await p.process(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifacts.map((a) => a.contentType)).toEqual([
      "application/zip",
    ]);
    expect(result.results?.ai?.usage?.calls).toBe(1);
    expect(result.results?.ai?.pdf).toEqual({
      rendered: false,
      reason: "render_failed",
    });
  });

  it("the capability detail names the PDF only when the renderer is wired", () => {
    const base = {
      extract: extractorFor("x"),
      provider: provider(spent),
    };
    expect(createTranslateProcessor(base).capability().detail).not.toMatch(
      /reflowed PDF/,
    );
    expect(
      createTranslateProcessor({
        ...base,
        pdf: pdfDep({ ok: false, reason: "timeout" }),
      }).capability().detail,
    ).toMatch(/reflowed PDF/);
  });
});

/**
 * Translate's chosen pages (audit #29 slice 6) through the processor: the
 * options parser keeps `pages`, a page past the end is a fact about the
 * request (its own `jobError` case, never the `default:` arm's
 * `internal_error`), and the meta carries the chosen COUNT only on a job
 * that chose pages.
 */
describe("translate chosen pages through the processor", () => {
  const paged: PdfTextExtractor = async () => {
    const pages = [
      { pageNumber: 1, text: "First page words." },
      { pageNumber: 2, text: "Second page words." },
    ].map((p) => ({ ...p, characterCount: p.text.length }));
    const text = pages.map((p) => p.text).join("\n\n");
    return {
      pageCount: 2,
      pages,
      text,
      characterCount: text.length,
      hasText: true,
    };
  };
  const ok = provider({
    ok: true,
    text: "Mots.",
    model: "claude-sonnet-5",
    usage: { inputTokens: 1, outputTokens: 1 },
  });

  it("a page past the end is unprocessable_entity, not an internal error", async () => {
    const p = createTranslateProcessor({ extract: paged, provider: ok });
    const result = await p.process(
      input({ targetLanguage: "fr", pages: [[3, 3]] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unprocessable_entity");
    expect(result.error.retryable).toBe(false);
    expect(result.error.message).toBe(
      "This PDF has 2 pages, so page 3 cannot be translated. Nothing was sent to the AI model.",
    );
  });

  it("selectedPages rides the meta of a selection job only", async () => {
    const p = createTranslateProcessor({ extract: paged, provider: ok });
    const chosen = await p.process(
      input({ targetLanguage: "fr", pages: [[2, 2]] }),
    );
    const whole = await p.process(input({ targetLanguage: "fr" }));
    if (!chosen.ok || !whole.ok) throw new Error("expected delivery");
    expect(chosen.meta).toMatchObject({ selectedPages: 1 });
    expect(Object.keys(whole.meta ?? {})).not.toContain("selectedPages");
  });
});
