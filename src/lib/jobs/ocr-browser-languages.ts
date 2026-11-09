/**
 * The OCR languages a reader most likely needs, read from what their browser
 * says they read (`navigator.languages`). OCR against the wrong language does
 * not fail — it returns plausible gibberish from a completed job — so the
 * panel preselects these, says why, and leaves every chip editable.
 *
 * Pure and dependency-free apart from the catalogue, so it runs on the
 * server (where there is no `navigator`) as a no-op and is tested in Node.
 */
import {
  DEFAULT_OCR_LANGUAGE,
  MAX_OCR_LANGUAGES,
  type OcrLanguage,
} from "./ocr";

/**
 * BCP-47 primary language subtag → recognition pack. Every OCR language is
 * reached by this map or by {@link TRADITIONAL_CHINESE_PACK}
 * (`ocr-browser-languages.test.ts` holds it both ways). Chinese is
 * special-cased below by script: until 2026-10-25 only the Simplified pack
 * existed, so `zh-TW` and `zh-Hant` mapped to nothing rather than to the
 * wrong one; they now map to the Traditional pack.
 */
export const OCR_LANGUAGE_BY_BCP47: Readonly<Record<string, OcrLanguage>> = {
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
  zh: "chi_sim",
  ja: "jpn",
  ko: "kor",
  vi: "vie",
  id: "ind",
  th: "tha",
  ar: "ara",
  hi: "hin",
  bn: "ben",
  el: "ell",
  he: "heb",
  // The deprecated tag for Hebrew, which older browsers still send.
  iw: "heb",
  fa: "fas",
  ur: "urd",
  mr: "mar",
  ne: "nep",
  gu: "guj",
  ta: "tam",
  te: "tel",
  ms: "msa",
  fil: "fil",
  // Tagalog is the language Filipino is standardised from; Tesseract's
  // Filipino model is the one that reads it.
  tl: "fil",
  sw: "swa",
};

/** The pack for a Traditional-script Chinese tag. */
export const TRADITIONAL_CHINESE_PACK: OcrLanguage = "chi_tra";

/** Traditional-script Chinese tags: a script or a region that writes it. */
const TRADITIONAL_ZH = /^zh-(?:hant|tw|hk|mo)\b/i;

function packFor(tag: string): OcrLanguage | null {
  const primary = tag.split("-")[0]?.toLowerCase() ?? "";
  if (primary === "zh" && TRADITIONAL_ZH.test(tag))
    return TRADITIONAL_CHINESE_PACK;
  return OCR_LANGUAGE_BY_BCP47[primary] ?? null;
}

/**
 * `languages` ∩ the OCR catalogue, in the reader's order, English always
 * kept, at most {@link MAX_OCR_LANGUAGES} — English inside the cap.
 */
export function ocrLanguagesFromBrowser(
  languages: readonly string[],
): OcrLanguage[] {
  const picked: OcrLanguage[] = [];
  for (const tag of languages) {
    const pack = packFor(tag);
    if (pack && !picked.includes(pack)) picked.push(pack);
  }
  if (picked.includes(DEFAULT_OCR_LANGUAGE))
    return picked.slice(0, MAX_OCR_LANGUAGES).includes(DEFAULT_OCR_LANGUAGE)
      ? picked.slice(0, MAX_OCR_LANGUAGES)
      : [
          ...picked
            .filter((p) => p !== DEFAULT_OCR_LANGUAGE)
            .slice(0, MAX_OCR_LANGUAGES - 1),
          DEFAULT_OCR_LANGUAGE,
        ];
  return [...picked.slice(0, MAX_OCR_LANGUAGES - 1), DEFAULT_OCR_LANGUAGE];
}
