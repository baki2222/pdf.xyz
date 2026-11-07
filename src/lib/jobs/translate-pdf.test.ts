import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRANSLATE_SOURCE,
  LANGUAGE_NAMES,
  MAX_TRANSLATE_INSTRUCTIONS_CHARS,
  TRANSLATE_LANGUAGES,
  describeTranslateRequest,
  parseTranslateOptions,
  translateSameLanguageMessage,
  translationOutputName,
} from "./translate-pdf";
import { parseAiToolOptions } from "./ai-tool-options";

describe("parseTranslateOptions", () => {
  it("accepts a target language and defaults the source to auto-detect", () => {
    const r = parseTranslateOptions({ targetLanguage: "fr" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.targetLanguage).toBe("fr");
      expect(r.value.sourceLanguage).toBe(DEFAULT_TRANSLATE_SOURCE);
      expect(r.value.instructions).toBeUndefined();
    }
  });

  it("requires a target language (never guesses one)", () => {
    const r = parseTranslateOptions({});
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.error.body.error.details?.[0]?.field).toBe("targetLanguage");
  });

  it("rejects an unknown target language (never coerces)", () => {
    const r = parseTranslateOptions({ targetLanguage: "elvish" });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.error.body.error.details?.[0]?.field).toBe("targetLanguage");
  });

  it("accepts a valid explicit source language", () => {
    const r = parseTranslateOptions({
      targetLanguage: "de",
      sourceLanguage: "en",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.sourceLanguage).toBe("en");
  });

  it("accepts the explicit auto source", () => {
    const r = parseTranslateOptions({
      targetLanguage: "de",
      sourceLanguage: "auto",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.sourceLanguage).toBe("auto");
  });

  it("rejects an unknown source language", () => {
    const r = parseTranslateOptions({
      targetLanguage: "de",
      sourceLanguage: "klingon",
    });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.error.body.error.details?.[0]?.field).toBe("sourceLanguage");
  });

  it("accepts a bounded instructions directive", () => {
    const r = parseTranslateOptions({
      targetLanguage: "es",
      instructions: "keep product names in English",
    });
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.value.instructions).toBe("keep product names in English");
  });

  it("drops an all-whitespace instructions rather than storing it", () => {
    const r = parseTranslateOptions({
      targetLanguage: "es",
      instructions: "   ",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.instructions).toBeUndefined();
  });

  it("rejects a control character in instructions", () => {
    const r = parseTranslateOptions({
      targetLanguage: "es",
      instructions: `a${String.fromCharCode(7)}b`,
    });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.error.body.error.details?.[0]?.field).toBe("instructions");
  });

  it("rejects over-long instructions", () => {
    const r = parseTranslateOptions({
      targetLanguage: "es",
      instructions: "x".repeat(MAX_TRANSLATE_INSTRUCTIONS_CHARS + 1),
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a non-object options bag", () => {
    // @ts-expect-error deliberately wrong type
    expect(parseTranslateOptions([]).ok).toBe(false);
  });

  it("names every supported language for the prompt/UI", () => {
    const r = parseTranslateOptions({ targetLanguage: "ja" });
    expect(r.ok).toBe(true);
    expect(LANGUAGE_NAMES.ja).toBe("Japanese");
  });
});

describe("describeTranslateRequest", () => {
  it("renders human copy for the UI", () => {
    expect(
      describeTranslateRequest({
        targetLanguage: "fr",
        sourceLanguage: "auto",
      }),
    ).toBe("Translate to French (auto-detect source)");
    expect(
      describeTranslateRequest({ targetLanguage: "de", sourceLanguage: "en" }),
    ).toBe("Translate to German (from English)");
  });
});

describe("translationOutputName", () => {
  it("derives a -translation.zip name from the source PDF", () => {
    expect(translationOutputName("Q3 Report.pdf")).toBe(
      "Q3 Report-translation.zip",
    );
  });

  it("falls back to a neutral stem for unusable names", () => {
    expect(translationOutputName(null)).toBe("document-translation.zip");
  });
});

/**
 * Until 2026-11-06 (audit #38) each language was validated on its own and the pair
 * never compared, so "Spanish into Spanish" was accepted, charged up to a third of the
 * daily AI allowance, and came back as a copy of the text it was given.
 */
describe("parseTranslateOptions — the source and target must differ", () => {
  it.each(TRANSLATE_LANGUAGES.map((code) => [code]))(
    "refuses %s into itself, naming the language",
    (code) => {
      const r = parseTranslateOptions({
        targetLanguage: code,
        sourceLanguage: code,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.body.error.details?.[0]?.field).toBe("sourceLanguage");
        expect(r.error.body.error.message).toBe(
          translateSameLanguageMessage(code),
        );
        expect(r.error.body.error.message).toContain(LANGUAGE_NAMES[code]);
      }
    },
  );

  it("the route refuses it before anything is charged (the route's own table)", () => {
    const r = parseAiToolOptions("translate-pdf", {
      targetLanguage: "es",
      sourceLanguage: "es",
    });
    expect(r?.ok).toBe(false);
  });

  it("POSITIVE CONTROL: a different pair, and auto-detect, are still accepted", () => {
    expect(
      parseTranslateOptions({ targetLanguage: "es", sourceLanguage: "en" }).ok,
    ).toBe(true);
    expect(
      parseTranslateOptions({ targetLanguage: "es", sourceLanguage: "auto" })
        .ok,
    ).toBe(true);
  });
});
