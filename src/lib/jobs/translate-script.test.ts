/**
 * Auto-detect into the document's own language (audit #38, second half).
 *
 * An explicit "Bengali into Bengali" is refused by the parser. The common way to hit
 * the same waste is the DEFAULT: Auto-detect as the source. Some scripts are used by
 * exactly one of the languages we translate into, so a document written in one of
 * them can only be translated into that language as a copy of itself — and the panel
 * can see that from the text it already extracts, before anything is uploaded.
 *
 * Latin script cannot be told apart this way: English, Spanish, French, German, …
 * Vietnamese and Indonesian all write in it, so a Latin-script document returns null
 * and is never warned about. That is a stated bound, pinned below, not a gap.
 */
import { describe, expect, it } from "vitest";
import { TRANSLATE_LANGUAGES } from "./translate-pdf";
import {
  SCRIPT_ONLY_LANGUAGES,
  scriptOnlyLanguage,
  translateAutoSameLanguageWarning,
} from "./translate-script";

describe("scriptOnlyLanguage — the one target a document's script allows", () => {
  it.each([
    ["Bengali", "এটি একটি বাংলা নথি। চুক্তির শর্তাবলী নিচে দেওয়া হল।", "bn"],
    [
      "Devanagari",
      "यह एक हिंदी दस्तावेज़ है। अनुबंध की शर्तें नीचे दी गई हैं।",
      "hi",
    ],
    ["Arabic", "هذه وثيقة باللغة العربية. شروط العقد مذكورة أدناه.", "ar"],
    ["Thai", "นี่คือเอกสารภาษาไทย เงื่อนไขของสัญญามีดังต่อไปนี้", "th"],
    ["Hangul", "이것은 한국어 문서입니다. 계약 조건은 아래와 같습니다.", "ko"],
    [
      "kana with kanji",
      "これは日本語の文書です。契約条件は以下の通りです。",
      "ja",
    ],
    ["Han alone", "这是一份中文文件。合同条款如下所示，请仔细阅读。", "zh"],
    [
      "Russian Cyrillic",
      "Это документ на русском языке. Условия договора ниже.",
      "ru",
    ],
    [
      "Ukrainian Cyrillic",
      "Це документ українською мовою. Умови договору наведені їх.",
      "uk",
    ],
  ])("%s text → %s", (_label, text, expected) => {
    expect(scriptOnlyLanguage(text)).toBe(expected);
  });

  it.each([
    ["English", "This is an English document. The contract terms are below."],
    ["Spanish", "Este es un documento en español. Los términos están abajo."],
    ["Vietnamese", "Đây là một tài liệu tiếng Việt. Các điều khoản ở dưới."],
  ])("a Latin-script document (%s) cannot be decided: null", (_l, text) => {
    expect(scriptOnlyLanguage(text)).toBeNull();
  });

  it("a mixed document with no dominant script is not decided", () => {
    const text =
      "Invoice terms and conditions apply to every order placed. " +
      "চুক্তির শর্তাবলী নিচে দেওয়া হল।";
    expect(scriptOnlyLanguage(text)).toBeNull();
  });

  it("a Cyrillic document with neither language's own letters is not decided", () => {
    // No letter here is one only Russian or only Ukrainian has (no ы э ъ, no і ї є ґ).
    const text = "Договор на один год, срок до конца месяца";
    expect(scriptOnlyLanguage(text)).toBeNull();
    // Health check: the same text plus one Russian-only letter does decide.
    expect(scriptOnlyLanguage(`${text}, ы`)).toBe("ru");
  });

  it("too few letters to judge is not decided", () => {
    expect(scriptOnlyLanguage("বাংলা 2026")).toBeNull();
    expect(scriptOnlyLanguage("")).toBeNull();
  });

  it("a Bengali document with English names and numbers is still Bengali", () => {
    const text =
      "চুক্তির শর্তাবলী নিচে দেওয়া হল। প্রতিটি পক্ষ এই শর্তাবলী মেনে চলবে। " +
      "Invoice 2026-0412, PDF.";
    expect(scriptOnlyLanguage(text)).toBe("bn");
  });

  it("covers every non-Latin target, and only targets", () => {
    // Derived, not typed: every language this table can name is one we translate into,
    // and every non-Latin target is reachable from some script.
    const named = new Set(Object.values(SCRIPT_ONLY_LANGUAGES).flat());
    for (const language of named)
      expect(TRANSLATE_LANGUAGES).toContain(language);
    const latin = [
      "en",
      "es",
      "fr",
      "de",
      "it",
      "pt",
      "nl",
      "pl",
      "sv",
      "tr",
      "vi",
      "id",
    ];
    // Health check on the Latin list itself: all real targets.
    for (const language of latin)
      expect(TRANSLATE_LANGUAGES).toContain(language);
    const nonLatin = TRANSLATE_LANGUAGES.filter((l) => !latin.includes(l));
    expect(nonLatin.length).toBeGreaterThan(5);
    for (const language of nonLatin) expect(named.has(language)).toBe(true);
  });
});

describe("translateAutoSameLanguageWarning", () => {
  it("names the language and says what it would cost", () => {
    const text = translateAutoSameLanguageWarning("bn");
    expect(text).toMatch(/Bengali/);
    expect(text).toMatch(/same text/);
    expect(text).toMatch(/allowance/);
  });
});
