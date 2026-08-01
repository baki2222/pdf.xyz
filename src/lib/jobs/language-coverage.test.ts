// @vitest-environment node
/**
 * Drift guard between the two language menus the product shows.
 *
 * `translate-pdf` accepts its language list as a *source* as well as a target
 * (`SOURCE_SET` in `./translate-pdf`), so "translate this Vietnamese contract to
 * English" is an advertised workflow. When the contract arrives as a scan — which
 * is the common case for anything worth translating — that workflow runs through
 * `ocr-pdf` first. A language translation offers but OCR cannot read is therefore a
 * dead end the UI never warns about.
 *
 * The two lists were written independently and drifted to exactly that: translation
 * offered twenty languages, OCR thirteen, and the seven-language gap (Ukrainian,
 * Polish, Swedish, Turkish, Vietnamese, Indonesian, Thai) was invisible because each
 * file looked complete on its own. Neither offered Bengali at all.
 *
 * The failure mode is worse than a rejection: Tesseract asked for the wrong language
 * does not error. It matches glyphs against the model it was handed and returns
 * fluent-looking nonsense, so a Bengali page read as English comes back as Latin
 * gibberish with no signal that anything went wrong.
 *
 * Direction matters. Every translation language must be OCR-able; the reverse is not
 * required, because OCR is useful on its own for languages we do not translate.
 */
import { describe, expect, it } from "vitest";
import { OCR_LANGUAGES } from "@/lib/jobs/ocr";
import { TRANSLATE_LANGUAGES, type TranslateLanguage } from "@/lib/jobs/translate-pdf";

/**
 * ISO 639-1 (translation) to Tesseract traineddata name (OCR). The two tools use
 * different vocabularies because their engines do; this is the only place they meet.
 *
 * Typed as a total `Record<TranslateLanguage, …>`, so adding a translation language
 * without deciding its OCR counterpart is a typecheck error rather than a silent gap.
 *
 * The value type is `string`, deliberately, not `OcrLanguage`. `OcrLanguage` is derived
 * from `OCR_LANGUAGES`, so typing it that way would make a missing language impossible
 * to even write down — and the assertion below would pass by construction, testing
 * nothing. Keeping it `string` lets the gap exist and be reported by name.
 */
const OCR_CODE_FOR_TRANSLATE_LANGUAGE: Record<TranslateLanguage, string> = {
  en: "eng",
  es: "spa",
  fr: "fra",
  de: "deu",
  it: "ita",
  pt: "por",
  nl: "nld",
  ru: "rus",
  uk: "ukr",
  pl: "pol",
  sv: "swe",
  tr: "tur",
  ar: "ara",
  hi: "hin",
  zh: "chi_sim",
  ja: "jpn",
  ko: "kor",
  vi: "vie",
  id: "ind",
  th: "tha",
  bn: "ben",
};

const ocrCodes: ReadonlySet<string> = new Set<string>(
  OCR_LANGUAGES.map((language) => language.code),
);

describe("every translatable language can also be recognized", () => {
  it("offers OCR for each translation language, so scan → OCR → translate never dead-ends", () => {
    const unreadable = TRANSLATE_LANGUAGES.filter(
      (code) => !ocrCodes.has(OCR_CODE_FOR_TRANSLATE_LANGUAGE[code]),
    ).map((code) => `${code} (needs OCR language ${OCR_CODE_FOR_TRANSLATE_LANGUAGE[code]})`);
    // Add the language to OCR_LANGUAGES *and* its pack to the Dockerfile — see
    // `src/deploy/ocr-languages.test.ts`, which enforces that second half.
    expect(unreadable).toEqual([]);
  });

  it("maps every translation language to a distinct OCR language", () => {
    // A duplicate would mean two languages silently share one recognition model,
    // which reads as support the engine does not actually have.
    const mapped = Object.values(OCR_CODE_FOR_TRANSLATE_LANGUAGE);
    expect(new Set(mapped).size).toBe(mapped.length);
  });

  it("covers Bengali, which both lists omitted while the product was built in it", () => {
    expect(ocrCodes.has("ben")).toBe(true);
    expect(TRANSLATE_LANGUAGES).toContain("bn");
  });
});
