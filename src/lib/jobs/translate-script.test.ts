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
 * Vietnamese and Indonesian all write in it, so `scriptOnlyLanguage` returns null for
 * a Latin-script document (pinned below); `latinLanguage`, at the end of this file,
 * decides those from their common words.
 */
import { describe, expect, it } from "vitest";
import { TRANSLATE_LANGUAGES } from "./translate-pdf";
import {
  LATIN_STOPWORDS,
  SCRIPT_ONLY_LANGUAGES,
  documentLanguage,
  latinLanguage,
  scriptOnlyLanguage,
  translateAlreadyInLanguageMessage,
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

/**
 * translate-pdf#1: the Latin half. Script cannot tell English from Spanish, but
 * the short common words can. `latinLanguage` counts each Latin target's own
 * function words and decides only when one language clearly leads; the panel
 * then stops an Auto-detect run into the language the PDF is already in,
 * before anything is uploaded or charged.
 */
describe("latinLanguage: the Latin target a document's common words show", () => {
  const CORPUS: Record<string, string> = {
    en: "This agreement is made between the company and the tenant. The tenant will pay the rent on the first day of each month, and the company will repair the roof when it is needed. If either party wants to end this agreement, they should give notice in writing.",
    es: "Este contrato se firma entre la empresa y el inquilino. El inquilino pagará el alquiler el primer día de cada mes, y la empresa reparará el techo cuando sea necesario. Si una de las partes quiere terminar el contrato, debe avisar por escrito con un mes de antelación.",
    fr: "Ce contrat est conclu entre la société et le locataire. Le locataire paiera le loyer le premier jour de chaque mois, et la société réparera le toit quand cela sera nécessaire. Si une des parties veut mettre fin au contrat, elle doit prévenir par écrit avec un mois de préavis.",
    de: "Dieser Vertrag wird zwischen der Firma und dem Mieter geschlossen. Der Mieter zahlt die Miete am ersten Tag jedes Monats, und die Firma repariert das Dach, wenn es nötig ist. Wenn eine der Parteien den Vertrag beenden will, muss sie dies schriftlich mitteilen.",
    it: "Questo contratto è stipulato tra la società e il locatario. Il locatario pagherà l'affitto il primo giorno di ogni mese, e la società riparerà il tetto quando sarà necessario. Se una delle parti vuole terminare il contratto, deve darne avviso per iscritto con un mese di anticipo.",
    pt: "Este contrato é celebrado entre a empresa e o inquilino. O inquilino pagará o aluguel no primeiro dia de cada mês, e a empresa vai consertar o telhado quando for necessário. Se uma das partes quiser terminar o contrato, deve avisar por escrito com um mês de antecedência.",
    nl: "Deze overeenkomst wordt gesloten tussen het bedrijf en de huurder. De huurder betaalt de huur op de eerste dag van elke maand, en het bedrijf repareert het dak wanneer dat nodig is. Als een van de partijen de overeenkomst wil beëindigen, moet zij dit schriftelijk melden.",
    pl: "Ta umowa jest zawarta między firmą a najemcą. Najemca będzie płacić czynsz pierwszego dnia każdego miesiąca, a firma naprawi dach, kiedy będzie to potrzebne. Jeśli jedna ze stron chce zakończyć umowę, powinna to zgłosić na piśmie z miesięcznym wyprzedzeniem.",
    sv: "Detta avtal är ingått mellan företaget och hyresgästen. Hyresgästen ska betala hyran den första dagen i varje månad, och företaget ska laga taket när det behövs. Om någon av parterna vill avsluta avtalet ska det meddelas skriftligt med en månads varsel.",
    tr: "Bu sözleşme şirket ile kiracı arasında yapılmıştır. Kiracı kirayı her ayın ilk günü ödeyecek ve şirket gerektiğinde çatıyı onaracaktır. Taraflardan biri bu sözleşmeyi bitirmek isterse, bunu bir ay önceden yazılı olarak bildirmelidir ve bu da kabul edilir.",
    vi: "Hợp đồng này được ký giữa công ty và người thuê nhà. Người thuê sẽ trả tiền thuê vào ngày đầu tiên của mỗi tháng, và công ty sẽ sửa mái nhà khi cần thiết. Nếu một trong các bên muốn chấm dứt hợp đồng, họ phải thông báo bằng văn bản trước một tháng.",
    id: "Perjanjian ini dibuat antara perusahaan dan penyewa. Penyewa akan membayar sewa pada hari pertama setiap bulan, dan perusahaan akan memperbaiki atap jika diperlukan. Jika salah satu pihak ingin mengakhiri perjanjian ini, mereka harus memberi tahu secara tertulis.",
  };

  it("the stopword table covers exactly the Latin targets (derived from the script table)", () => {
    const scriptOnly = new Set(Object.values(SCRIPT_ONLY_LANGUAGES).flat());
    const latinTargets = TRANSLATE_LANGUAGES.filter((l) => !scriptOnly.has(l));
    expect(latinTargets.length).toBeGreaterThanOrEqual(6);
    expect(Object.keys(LATIN_STOPWORDS).sort()).toEqual(
      [...latinTargets].sort(),
    );
    // Corpus in both directions: every language in the table has a document
    // here, and every document here is a language in the table.
    expect(Object.keys(CORPUS).sort()).toEqual([...latinTargets].sort());
  });

  it("no common word is counted for two languages", () => {
    const seen = new Map<string, string>();
    for (const [language, words] of Object.entries(LATIN_STOPWORDS)) {
      expect(words.length, language).toBeGreaterThanOrEqual(8);
      for (const word of words) {
        expect(seen.get(word), `${word}: ${language}`).toBeUndefined();
        seen.set(word, language);
      }
    }
  });

  it.each(Object.keys(CORPUS))("a %s document is recognised", (language) => {
    expect(latinLanguage(CORPUS[language]!)).toBe(language);
    expect(documentLanguage(CORPUS[language]!)).toBe(language);
  });

  it("every stopword list is exercised by its own document (no decoration)", () => {
    for (const [language, words] of Object.entries(LATIN_STOPWORDS)) {
      const tokens = new Set(
        CORPUS[language]!.toLowerCase().split(/[^\p{L}']+/u),
      );
      expect(
        words.filter((w) => tokens.has(w)).length,
        language,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("a document half English, half Spanish is not decided (negative control)", () => {
    const mixed = `${CORPUS.en} ${CORPUS.es}`;
    expect(latinLanguage(mixed)).toBeNull();
    // Health check: each half alone is decided.
    expect(latinLanguage(CORPUS.en!)).toBe("en");
    expect(latinLanguage(CORPUS.es!)).toBe("es");
  });

  it("too little text, numbers or another script are not decided", () => {
    expect(latinLanguage("The rent")).toBeNull();
    expect(latinLanguage("Invoice 2026-0412 PDF 12 34 56 78 90")).toBeNull();
    expect(
      latinLanguage("এটি একটি বাংলা নথি। চুক্তির শর্তাবলী নিচে দেওয়া হল।"),
    ).toBeNull();
    expect(latinLanguage("")).toBeNull();
  });

  it("documentLanguage prefers the script, then the common words", () => {
    expect(
      documentLanguage("এটি একটি বাংলা নথি। চুক্তির শর্তাবলী নিচে দেওয়া হল।"),
    ).toBe("bn");
    expect(documentLanguage(CORPUS.fr!)).toBe("fr");
  });

  it("the stop message names the language and says how to go on", () => {
    const text = translateAlreadyInLanguageMessage("en");
    expect(text).toMatch(/already in English/);
    expect(text).toMatch(/Source language/);
    expect(text).toMatch(/nothing was uploaded/i);
  });
});
