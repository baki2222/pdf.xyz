import { createHash } from "node:crypto";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type {
  TranslateLanguage,
  TranslateOptions,
} from "@/lib/jobs/translate-pdf";
import type {
  AiCompletionRequest,
  AiCompletionResult,
  AiProvider,
} from "../ai/provider";
import {
  runTranslate,
  TRANSLATE_ENGINE,
  type PdfTextExtractor,
  type TranslateDeps,
} from "./engine";
import type { TranslatePdfResult } from "./pdf-render";
import type { TypesetInput } from "./typeset";
import {
  TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS,
  TRANSLATE_MAX_INPUT_CHARS,
  translateEveryPageTooLongMessage,
} from "@/lib/jobs/translate-limits";

const OPTIONS: TranslateOptions = {
  targetLanguage: "fr",
  sourceLanguage: "auto",
};
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
    const run = await runTranslate(INPUT, OPTIONS, {
      provider: providerReturning(SUCCESS("x")),
    });
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
    const run = await runTranslate(INPUT, OPTIONS, {
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
    const run = await runTranslate(INPUT, OPTIONS, {
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
    const provider = providerReturning(
      SUCCESS("Ceci est la vraie traduction du modèle."),
    );
    const run = await runTranslate(
      INPUT,
      {
        targetLanguage: "fr",
        sourceLanguage: "en",
        instructions: "keep product names in English",
      },
      {
        extract: extractorFor(
          "This is a genuine document about quarterly results.",
          5,
        ),
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
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
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
    expect(provider.calls[0]!.system).toContain(
      "keep product names in English",
    );
    expect(provider.calls[0]!.messages[0]!.content).toContain(
      "quarterly results",
    );

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
    await runTranslate(
      INPUT,
      { targetLanguage: "es", sourceLanguage: "auto" },
      {
        extract: extractorFor("hello world"),
        provider,
      },
    );
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
    await runTranslate(INPUT, OPTIONS, {
      extract: extractorFor("real text"),
      provider,
      limits: { maxOutputTokens: 512 },
    });
    expect(provider.calls[0]!.maxOutputTokens).toBe(512);
  });
});

// ---------------------------------------------------------------------------
// Truncation disclosure (TASK-45, folding in the #12 header defect)
// ---------------------------------------------------------------------------

/**
 * Six pages of 200 characters each, joined by a blank line: offsets 0, 202, 404,
 * 606, 808, 1010, total 1,210. A 500-character cap lands 96 characters INTO
 * page 3 — page 2 is the last complete page and the cut is mid-page.
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
  it("names the last COMPLETE page in the model's system prompt", async () => {
    const provider = providerReturning(SUCCESS("Une traduction."));
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: longExtractor(),
      provider,
      limits: { maxInputChars: 500 },
    });
    expect(run.ok).toBe(true);

    // Before this change the ONLY hint was a parenthetical in the user turn:
    // "(Only the first part of a long document is included.)" — vague where it
    // needed to be specific, and nowhere near the instructions it has to override.
    const system = provider.calls[0]?.system ?? "";
    expect(system).toMatch(/pages 1-2 of 6/);
    expect(system).toMatch(/mid-page/);
  });

  it("forbids presenting a partial translation as the document's translation", async () => {
    const provider = providerReturning(SUCCESS("Une traduction."));
    await runTranslate(INPUT, OPTIONS, {
      extract: longExtractor(),
      provider,
      limits: { maxInputChars: 500 },
    });
    const system = provider.calls[0]?.system ?? "";
    // Translate's failure mode is not a false denial — it is a partial
    // translation that looks complete, so the instruction it must revoke is
    // "Output ONLY the translation, with no preamble or commentary."
    expect(system).toMatch(/only the pages you were given/i);
  });

  it("reports the window on meta so the panel can state it without the model", async () => {
    const provider = providerReturning(SUCCESS("Une traduction."));
    const run = await runTranslate(INPUT, OPTIONS, {
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

  it("stops the package header claiming the whole source PDF (#12)", async () => {
    const provider = providerReturning(SUCCESS("Une traduction."));
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: longExtractor(),
      provider,
      limits: { maxInputChars: 500 },
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;

    const zip = await JSZip.loadAsync(run.output);
    const md = await zip.file("translation.md")!.async("string");
    // The header says "from the selectable text of the source PDF" directly
    // above a translation of its first fifth. The page-named line is what makes
    // that header readable rather than misleading.
    expect(md).toMatch(/pages 1–2 of 6/);
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    expect(manifest.source.truncationNotice).toMatch(/pages 1–2 of 6/);
  });

  it("says nothing at all when the whole document fits", async () => {
    const provider = providerReturning(SUCCESS("Une traduction."));
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: longExtractor(),
      provider,
      limits: { maxInputChars: 100_000 },
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.meta.truncated).toBe(false);
    expect(run.meta.truncationNotice).toBeNull();
    expect(provider.calls[0]?.system ?? "").not.toMatch(/ONLY PART/);
  });
});

// ---------------------------------------------------------------------------
// The output ceiling (TASK-52)
// ---------------------------------------------------------------------------

describe("translate refuses more text than the model may write back", () => {
  /** The document text one call carried: between the prompt's `---` lines. */
  function delimitedSegment(call: AiCompletionRequest): string {
    const content = call.messages[0]!.content;
    const open = "\n---\n";
    const from = content.indexOf(open);
    const to = content.lastIndexOf("\n---");
    expect(from, "the request has no delimited segment").toBeGreaterThan(0);
    return content.slice(from + open.length, to);
  }

  /** Text just over the ceiling, spread across pages so the extractor is realistic. */
  async function oversizedExtractor(): Promise<PdfTextExtractor> {
    const perPage = "a".repeat(2000);
    const pages = Array.from({ length: 20 }, (_, i) => ({
      pageNumber: i + 1,
      text: perPage,
      characterCount: perPage.length,
    }));
    const joined = pages.map((p) => p.text).join("\n\n");
    const extracted: ExtractedPdfText = {
      pageCount: pages.length,
      pages,
      text: joined,
      characterCount: joined.length,
      hasText: true,
    };
    return vi.fn(async () => extracted);
  }

  /*
   * INVERTED, NOT DELETED — and the history is the point.
   *
   * These two cases used to assert that a 40,038-character document was refused
   * OUTRIGHT and the provider was never called. That was right when one call was
   * all the engine could make: the alternative then was the production incident
   * it was written for, where the document was accepted, extracted, sent,
   * billed, and refused after 49 seconds with the user's daily AI run spent.
   *
   * They were pinning the MECHANISM (refuse the job) rather than the property
   * (never make a call that cannot be answered). Chunking satisfies the property
   * without the mechanism: twenty 2,000-character pages are four calls, each
   * inside the ceiling, and all twenty pages come back. The old assertions
   * would now hold the engine to delivering nothing for work it can do.
   */
  it("makes ONLY calls it can answer, and delivers the whole document", async () => {
    const provider = providerReturning(SUCCESS("Une traduction."));
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: await oversizedExtractor(),
      provider,
    });

    expect(
      run.ok,
      run.ok ? "" : `refused deliverable work: ${run.kind} — ${run.message}`,
    ).toBe(true);
    // The property the old `calls).toHaveLength(0)` was reaching for: nothing is
    // billed for a call that must fail. Every call is inside the ceiling.
    expect(provider.calls.length).toBeGreaterThan(1);
    for (const call of provider.calls) {
      // INVERTED, NOT DELETED (translatePageMap, 2026-11). This measured the
      // WHOLE user message, prompt furniture included:
      //   const sent = call.messages.map((m) => m.content).join("\n").length;
      //   expect(sent).toBeLessThanOrEqual(TRANSLATE_MAX_INPUT_CHARS);
      // (true before translatePageMap (2026-11)). It held only because the
      // furniture fitted in the last chunk's slack; the page-marker clause
      // (~190 characters) does not. The ceiling is the model's OUTPUT, and the
      // model writes back the document segment, not the instruction — so the
      // property is the delimited segment, markers included, within it.
      const sent = delimitedSegment(call).length;
      expect(sent).toBeLessThanOrEqual(TRANSLATE_MAX_INPUT_CHARS);
    }
  });

  it("names the page and its size when NOTHING is deliverable — and does not say to split the file", async () => {
    // The refusal survives for the case that is genuinely undeliverable: a
    // single page larger than one call cannot be chunked, so there is no
    // partial delivery to offer and "too long" still has to be actionable.
    //
    // INVERTED 2026-09-27. This test used to assert the message matched
    // /Split it into smaller files/ — it pinned the defect. Pages are already
    // the unit this engine splits at, so a smaller file holds the same page at
    // the same length: the advice could not work, and the test held the engine
    // to giving it. The browser gave it too, to scanned PDFs, as "0 characters
    // of text" (see `preflight.test.ts`). Now both name the page instead.
    const huge = "a".repeat(TRANSLATE_MAX_INPUT_CHARS + 5_000);
    const pages = [{ pageNumber: 1, text: huge, characterCount: huge.length }];
    const provider = providerReturning(SUCCESS("Une traduction."));
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: vi.fn(async () => ({
        pageCount: 1,
        pages,
        text: huge,
        characterCount: huge.length,
        hasText: true,
      })),
      provider,
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.kind).toBe("too_much_text");
    expect(run.ceilingCharacters).toBe(TRANSLATE_MAX_INPUT_CHARS);
    expect(run.message).not.toMatch(/Split it into smaller files/);
    expect(run.message).toBe(
      translateEveryPageTooLongMessage(
        [{ pageNumber: 1, characters: huge.length }],
        TRANSLATE_MAX_INPUT_CHARS,
        "document",
      ),
    );
    expect(run.message).toContain(
      `Page 1 alone holds ${huge.length.toLocaleString("en-US")} characters`,
    );
    // Still nothing billed: there was never a call that could have succeeded.
    expect(provider.calls).toHaveLength(0);
  });

  it("does not claim EVERY page is too long when the delivery cap withheld one that was not", async () => {
    // The page-naming sentence says "every page with text" is oversize. With a
    // delivery cap, page 1 can be oversize while page 2 — perfectly
    // translatable — is withheld because the reservation ran out. Saying the
    // document's pages are all too long would then be false about page 2.
    const huge = "a".repeat(TRANSLATE_MAX_INPUT_CHARS + 5_000);
    const small = "Bonjour, voici une page ordinaire.";
    const pages = [
      { pageNumber: 1, text: huge, characterCount: huge.length },
      { pageNumber: 2, text: small, characterCount: small.length },
    ];
    const text = `${huge}\n\n${small}`;
    const provider = providerReturning(SUCCESS("Une traduction."));
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: vi.fn(async () => ({
        pageCount: 2,
        pages,
        text,
        characterCount: text.length,
        hasText: true,
      })),
      provider,
      limits: { delivery: { characters: 4 } },
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.kind).toBe("too_much_text");
    expect(run.message).not.toMatch(/alone holds|Every page with text/);
    expect(provider.calls).toHaveLength(0);
  });

  it("still translates a document within the ceiling", async () => {
    const provider = providerReturning(SUCCESS("Une traduction."));
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: extractorFor("Bonjour, voici un petit document."),
      provider,
    });
    expect(run.ok).toBe(true);
    expect(provider.calls).toHaveLength(1);
  });

  /*
   * INVERTED, NOT DELETED (2026-11-16). This case was "scales the ceiling with
   * the output budget it is given": an override of 4x the default was SENT, the
   * per-call input ceiling grew with it, and the whole document went in ONE
   * call. It pinned the defect — `outputTokensPerFullRun` is "the most output
   * tokens a single run can produce", the daily ceiling is derived from it, and
   * the engine's own docblock said the override "can only lower, never raise".
   * Now the raise is ignored: the default is sent and the document is chunked
   * exactly as it is with no override at all.
   */
  it("does NOT raise the per-call ceiling for a raised output budget", async () => {
    const provider = providerReturning(SUCCESS("Une traduction."));
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: await oversizedExtractor(),
      provider,
      limits: { maxOutputTokens: TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS * 4 },
    });
    expect(run.ok).toBe(true);
    expect(provider.calls.length).toBeGreaterThan(1);
    for (const call of provider.calls) {
      expect(call.maxOutputTokens).toBe(TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS);
      // INVERTED like the case above (translatePageMap, 2026-11): the whole
      // message's length was measured; the delimited segment is the property.
      const sent = delimitedSegment(call).length;
      expect(sent).toBeLessThanOrEqual(TRANSLATE_MAX_INPUT_CHARS);
    }
  });
});

describe("a failed translate run reports what it spent", () => {
  it("carries usage AND the window on incomplete_output", async () => {
    // The case the whole ceiling rests on: non-retryable BECAUSE the model hit
    // its output ceiling, so it burned the maximum budget. A spend hook reading
    // only successes would miss exactly the most expensive calls.
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: extractorFor("Some document text to translate."),
      provider: {
        id: "anthropic",
        model: "claude-sonnet-5",
        async complete() {
          return {
            ok: false as const,
            kind: "incomplete_output" as const,
            retryable: false,
            message: "cut off",
            usage: { inputTokens: 20, outputTokens: 8_000 },
          };
        },
      },
    });

    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.usage, "a failed run that spent tokens reported none").toEqual({
      inputTokens: 20,
      outputTokens: 8_000,
      calls: 1,
      model: "claude-sonnet-5",
    });
    expect(
      run.window,
      "the window is gone, so the ai block cannot be built",
    ).toBeDefined();
  });

  it("carries NEITHER field when no provider call happened", async () => {
    // The co-occurrence invariant, pinned in its other direction: `usage`
    // present ⟺ a call happened. A pre-extraction failure spent nothing, so
    // reporting either field would be inventing a call that never ran.
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: extractorFor("   "),
      provider: {
        id: "anthropic",
        model: "claude-sonnet-5",
        async complete() {
          throw new Error("must not be called");
        },
      },
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect("usage" in run).toBe(false);
    expect("window" in run).toBe(false);
  });
});

/**
 * EVERY POST-SPEND FAILURE CARRIES THE SPEND (2026-11-15, rule 3).
 *
 * Until this change four returns inside `runTranslate` came AFTER
 * `provider.complete` and carried neither `usage` nor `window`: the package
 * size arm, a single empty translation, the all-empty fallback, and an
 * interruption whose earlier calls had already been tallied. With no window,
 * `aiResultsFromFailure` returns undefined and the executor's spend hook records
 * zero — the convenient direction, toward free.
 */
describe("every failure after a provider call reports what the calls spent", () => {
  /** Twenty 2,000-character pages: four chunks under the default ceiling. */
  function chunkedExtractor(): PdfTextExtractor {
    const perPage = "a".repeat(2000);
    const pages = Array.from({ length: 20 }, (_, i) => ({
      pageNumber: i + 1,
      text: perPage,
      characterCount: perPage.length,
    }));
    const joined = pages.map((p) => p.text).join("\n\n");
    return vi.fn(async () => ({
      pageCount: pages.length,
      pages,
      text: joined,
      characterCount: joined.length,
      hasText: true,
    }));
  }

  /** Answers each call with the next scripted result, recording the request. */
  function scripted(results: AiCompletionResult[]): AiProvider & {
    calls: AiCompletionRequest[];
  } {
    const calls: AiCompletionRequest[] = [];
    return {
      id: "anthropic",
      model: "claude-sonnet-5",
      calls,
      async complete(request) {
        calls.push(request);
        const next = results[calls.length - 1];
        if (!next) throw new Error("no scripted result left");
        return next;
      },
    };
  }

  it("a package over the size bound still reports what the calls spent", async () => {
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: extractorFor("Some document text to translate."),
      provider: providerReturning(SUCCESS("Un texte traduit.")),
      limits: { maxOutputBytes: 1 },
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.message).toMatch(/size limit/);
    expect(run.usage?.calls).toBe(1);
    expect(run.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      calls: 1,
      model: "claude-sonnet-5",
    });
    expect(run.window).toBeDefined();
  });

  it("an empty single translation reports its spend", async () => {
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: extractorFor("real text"),
      provider: providerReturning(SUCCESS("   ")),
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.kind).toBe("failed");
    expect(run.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      calls: 1,
      model: "claude-sonnet-5",
    });
    expect(run.window).toBeDefined();
  });

  it("an all-empty chunked translation reports every call", async () => {
    const provider = providerReturning(SUCCESS("   "));
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: chunkedExtractor(),
      provider,
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(provider.calls.length).toBeGreaterThan(1);
    expect(run.usage?.calls).toBe(provider.calls.length);
    expect(run.usage?.inputTokens).toBe(100 * provider.calls.length);
    expect(run.window).toBeDefined();
  });

  it("an interruption after empty parts reports every call", async () => {
    const provider = scripted([
      SUCCESS("   "),
      {
        ok: false,
        kind: "provider_error",
        retryable: true,
        message: "upstream 500",
        usage: { inputTokens: 7, outputTokens: 3 },
      },
    ]);
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: chunkedExtractor(),
      provider,
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(provider.calls).toHaveLength(2);
    expect(run.message).toBe("upstream 500");
    expect(run.usage).toEqual({
      inputTokens: 107,
      outputTokens: 23,
      calls: 2,
      model: "claude-sonnet-5",
    });
    expect(run.window).toBeDefined();
  });

  it("an interruption whose failing call reported nothing still counts it, and keeps the earlier tokens", async () => {
    const provider = scripted([
      SUCCESS("   "),
      {
        ok: false,
        kind: "timeout",
        retryable: true,
        message: "timed out",
      },
    ]);
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: chunkedExtractor(),
      provider,
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      calls: 2,
      model: "claude-sonnet-5",
    });
  });
});

/**
 * The reflowed PDF (2026-11-15): an ADDITION to the ZIP, decided after every
 * paid call. The ZIP's bytes and the provider's requests must not move with it.
 */
describe("the reflowed PDF rides beside the ZIP, never instead of it", () => {
  const FIXED_NOW = () => "2026-11-15T00:00:00.000Z";

  async function runWith(pdf?: TranslateDeps["pdf"]) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T00:00:00.000Z"));
    try {
      const provider = providerReturning(SUCCESS("## Titre\n\nUn texte."));
      const run = await runTranslate(INPUT, OPTIONS, {
        extract: extractorFor("A document to translate."),
        provider,
        now: FIXED_NOW,
        document: { name: "report.pdf" },
        ...(pdf ? { pdf } : {}),
      });
      return { run, provider };
    } finally {
      vi.useRealTimers();
    }
  }

  const sha = (bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");

  const printing = (
    languages: ReadonlySet<TranslateLanguage> | null,
    result: TranslatePdfResult = {
      ok: true,
      bytes: new Uint8Array([37, 80, 68, 70]),
      pages: 2,
    },
  ) => {
    const seen: unknown[] = [];
    const deps: NonNullable<TranslateDeps["pdf"]> = {
      languages: () => languages,
      async render(args) {
        seen.push(args.input);
        return result;
      },
    };
    return { deps, seen };
  };

  it("a proven target gets a PDF, and meta says so explicitly", async () => {
    const { deps, seen } = printing(new Set(["fr"]));
    const { run } = await runWith(deps);
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.pdf).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(run.meta.pdf).toEqual({ rendered: true, pages: 2, bytes: 4 });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      target: "fr",
      sourceName: "report.pdf",
      parts: [{ kind: "body", text: "## Titre\n\nUn texte." }],
    });
    // Usage and window ride on success untouched.
    expect(run.meta.usage?.calls).toBe(1);
    expect(run.meta.window).toBeDefined();
  });

  it("no renderer: no PDF, reason no_renderer", async () => {
    const { run } = await runWith(undefined);
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.pdf).toBeUndefined();
    expect(run.meta.pdf).toEqual({ rendered: false, reason: "no_renderer" });
  });

  it("an unproven target is never handed to the renderer", async () => {
    for (const languages of [null, new Set<TranslateLanguage>(["de"])]) {
      const { deps, seen } = printing(languages);
      const { run } = await runWith(deps);
      expect(run.ok).toBe(true);
      if (!run.ok) return;
      expect(run.pdf).toBeUndefined();
      expect(run.meta.pdf).toEqual({
        rendered: false,
        reason: "unproven_language",
      });
      expect(seen).toHaveLength(0);
    }
  });

  it("a render that fails is a reason, and the run still succeeds with its usage", async () => {
    const { deps } = printing(new Set(["fr"]), {
      ok: false,
      reason: "not_conserved",
    });
    const { run } = await runWith(deps);
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.pdf).toBeUndefined();
    expect(run.meta.pdf).toEqual({ rendered: false, reason: "not_conserved" });
    expect(run.meta.usage?.calls).toBe(1);
  });

  it("the ZIP's bytes are identical in every case", async () => {
    const hashes = new Set<string>();
    for (const pdf of [
      undefined,
      printing(new Set(["fr"])).deps,
      printing(null).deps,
      printing(new Set(["fr"]), { ok: false, reason: "timeout" }).deps,
    ]) {
      const { run } = await runWith(pdf);
      expect(run.ok).toBe(true);
      if (run.ok) hashes.add(sha(run.output));
    }
    expect(hashes.size).toBe(1);
  });

  it("an empty early chunk: the PDF places bodies by their own pages, the ZIP keeps main's order", async () => {
    // Review r1, 2026-11-15. The one shape where the corrected assembly and
    // main's disagree. The ZIP must stay main's byte for byte (pinned by hash
    // in `package-bytes.characterisation.test.ts`, "empty early chunk"); the
    // PDF prints page-range headings, which main's placement would make false.
    const pages = Array.from({ length: 12 }, (_, i) => ({
      pageNumber: i + 1,
      text: "abcdefghijkl"[i]!.repeat(2000),
      characterCount: 2000,
    }));
    const joined = pages.map((p) => p.text).join("\n\n");
    let n = 0;
    const provider: AiProvider = {
      id: "anthropic",
      model: "claude-sonnet-5",
      async complete() {
        n += 1;
        return SUCCESS(n === 1 ? "  " : `Partie ${n}`);
      },
    };
    const { deps, seen } = printing(new Set(["fr"]));
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: async () => ({
        pageCount: 12,
        pages,
        text: joined,
        characterCount: joined.length,
        hasText: true,
      }),
      provider,
      pdf: deps,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(n).toBe(3);
    const pdfParts = (seen[0] as TypesetInput).parts;
    // The PDF: the gap for the empty chunk first, then each body at its pages.
    expect(pdfParts.map((p) => p.kind)).toEqual(["gap", "body", "body"]);
    expect(pdfParts[0]!.pages[0]).toBe(1);
    // Each body sits after the pages the empty chunk left as a gap.
    const gapEnd = pdfParts[0]!.pages[pdfParts[0]!.pages.length - 1]!;
    expect(pdfParts[1]!.pages[0]).toBe(gapEnd + 1);
    // The ZIP: main's order, the second part ahead of the gap notice.
    const md = await (
      await JSZip.loadAsync(run.output)
    )
      .file("translation.txt")!
      .async("string");
    expect(md.indexOf("Partie 2")).toBeLessThan(
      md.indexOf("could not be translated"),
    );
  });

  it("the provider receives byte-identical requests with and without the PDF dependency (zero model tokens)", async () => {
    const without = await runWith(undefined);
    const withPdf = await runWith(printing(new Set(["fr"])).deps);
    expect(JSON.stringify(withPdf.provider.calls)).toBe(
      JSON.stringify(without.provider.calls),
    );
    expect(withPdf.provider.calls).toHaveLength(1);
  });
});
