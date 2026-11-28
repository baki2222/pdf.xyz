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
  LATIN_DECIDING_WORDS,
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

  /**
   * INVERTED (review of 7b498d92, finding 10). This test used to read "no
   * common word is counted for two languages" and held that each word sat in
   * exactly ONE list. That was true of the table and false of the languages:
   * to keep the lists apart, words frequent in two languages were filed under
   * one of them (Spanish "no" and "o" under Portuguese, Italian "da" under
   * Portuguese, French "il" under Italian, Dutch "is" under English), so a
   * Spanish letter full of "no" came out Portuguese and was stopped.
   *
   * Now each list holds its language's real common words, shared ones
   * included, and the detector DERIVES the deciding words: only a word in
   * exactly one list counts (`LATIN_DECIDING_WORDS`). The checks below are on
   * that derivation, not on the hand-made table.
   */
  it("only words in exactly one list decide, and every language keeps enough of them", () => {
    const lists = Object.entries(LATIN_STOPWORDS);
    const owners = new Map<string, string[]>();
    for (const [language, words] of lists)
      for (const word of words)
        owners.set(word, [...(owners.get(word) ?? []), language]);
    // Health: some words really are shared, or the derivation is untested.
    const shared = [...owners].filter(([, by]) => by.length > 1);
    expect(shared.length).toBeGreaterThan(10);
    for (const [word, by] of owners) {
      expect(LATIN_DECIDING_WORDS.get(word), word).toBe(
        by.length === 1 ? by[0] : undefined,
      );
    }
    for (const [language] of lists) {
      const deciding = [...LATIN_DECIDING_WORDS].filter(
        ([, l]) => l === language,
      );
      expect(deciding.length, language).toBeGreaterThanOrEqual(8);
    }
  });

  it("words frequent in two languages are listed under both (the misfilings found in review)", () => {
    const has = (language: string, word: string) =>
      (LATIN_STOPWORDS as Record<string, readonly string[]>)[
        language
      ]!.includes(word);
    for (const [word, languages] of [
      ["no", ["es", "pt", "it"]],
      ["o", ["es", "pt", "it"]],
      ["da", ["pt", "it"]],
      ["il", ["fr", "it"]],
      ["is", ["en", "nl"]],
      ["die", ["de", "nl"]],
      ["ze", ["pl", "nl"]],
    ] as const)
      for (const language of languages)
        expect(has(language, word), `${word} in ${language}`).toBe(true);
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
    // It is drawn as soon as the file is chosen, before any press (review of
    // 7b498d92, finding 4): true at that moment, and no "again".
    expect(text).toMatch(/nothing has been uploaded/i);
    expect(text).not.toMatch(/again/i);
  });
});

/**
 * THE HELD-OUT CORPUS (review of 7b498d92, finding 10). The corpus above was
 * written alongside the word lists, one paragraph per language, so it passed
 * by construction. These texts were written by the two reviewers of that
 * commit, independently, to break the detector (their probes in the review
 * evidence), and are kept here word for word. They are not to be edited to
 * make the detector pass: a text that fails is a finding.
 *
 * THE PROPERTY that matters is the false stop: Auto-detect into language T is
 * stopped only when `latinLanguage` says T, so a text in language L must come
 * back as L or as null, never as another target. That is checked for every
 * text against every Latin target. Recall (coming back as L) is checked
 * separately, for running prose only, and the texts it does NOT reach are
 * named, so the limit is stated rather than hidden.
 */
describe("latinLanguage on texts it was not written against", () => {
  /** [true language, or null for none of our targets; text]. */
  const HELD_OUT: Record<string, [string | null, string]> = {
    es_letter_no_heavy: [
      "es",
      "No sé si podré ir mañana. Mi madre no está bien y tengo que cuidarla o buscar a alguien que lo haga. Si no puedo, te llamo antes de las ocho. Ya hablamos con el médico, pero no nos dijo nada nuevo. Quizás vaya a casa de mi hermana o a la de mi tía, no lo sé todavía. Te aviso cuando sepa algo.",
    ],
    es_no_heavy_2: [
      "es",
      "No sé si podrás venir mañana. Yo no puedo ir a la oficina porque no tengo coche y no hay autobús por la mañana. Si no puedes venir, no pasa nada, nos vemos otro día. No olvides traer los papeles que te pedí, porque sin ellos no podemos firmar nada en la notaría.",
    ],
    es_customer: [
      "es",
      "Estimado cliente: le informamos que su pedido ha sido enviado. Puede seguir el envío en nuestra página web. Si tiene alguna pregunta, no dude en contactarnos por teléfono o por correo electrónico. Gracias por confiar en nosotros. Atentamente, el equipo de atención al cliente.",
    ],
    es_news: [
      "es",
      "La reunión no fue fácil para nadie. El gobierno dijo que no habrá cambios en la ley este año, pero la oposición no está de acuerdo y pide una nueva votación en la que participen todos los grupos. Según los datos, la inflación no bajó en octubre.",
    ],
    it_letter: [
      "it",
      "Non so se domani potrò venire. Mia madre non sta bene e devo occuparmi di lei o trovare qualcuno che lo faccia. Se non posso, ti chiamo prima delle otto. Abbiamo parlato con il medico, ma non ci ha detto niente di nuovo. Forse vado da mia sorella o da mia zia, non lo so ancora.",
    ],
    it_news: [
      "it",
      "La riunione di ieri non è stata facile. Il governo ha detto che non ci saranno cambiamenti alla legge, ma l'opposizione chiede un nuovo voto da parte di tutti i gruppi. Secondo i dati, l'inflazione non è scesa a ottobre e la crescita resta debole da mesi.",
    ],
    pt_letter: [
      "pt",
      "Não sei se poderei ir amanhã. Minha mãe não está bem e tenho que cuidar dela ou encontrar alguém que o faça. Se não puder, ligo antes das oito. Já falamos com o médico, mas ele não nos disse nada de novo.",
    ],
    pt_news: [
      "pt",
      "A reunião de ontem não foi fácil. O governo disse que não haverá mudanças na lei este ano, mas a oposição pede uma nova votação de todos os grupos. Segundo os dados, a inflação não caiu em outubro e o crescimento continua fraco há meses.",
    ],
    fr_letter: [
      "fr",
      "Je ne sais pas si je pourrai venir demain. Ma mère ne va pas bien et je dois m'occuper d'elle ou trouver quelqu'un pour le faire. Si je ne peux pas, je t'appelle avant huit heures. Nous avons parlé au médecin.",
    ],
    fr_news: [
      "fr",
      "La réunion d'hier n'a pas été facile. Le gouvernement a dit qu'il n'y aura pas de changement de la loi cette année, mais l'opposition demande un nouveau vote de tous les groupes. Selon les chiffres, l'inflation n'a pas baissé en octobre et il faut attendre.",
    ],
    en_letter_plain: [
      "en",
      "I don't know if I can come tomorrow. My mother isn't well and I have to look after her or find someone to do it. If I can't, I'll call you before eight. We talked to the doctor, but he told us nothing new. Maybe I'll go to my sister's or my aunt's, I don't know yet.",
    ],
    en_business_letter: [
      "en",
      "Dear Mr Patel, thank you for your letter of 3 May. I am writing to confirm that your order has been dispatched today. You should receive it within five working days. Please contact our customer service team on the number below if you have any questions. Kind regards, Sarah Jones, Customer Services Manager.",
    ],
    en_minutes: [
      "en",
      "Minutes of the meeting held on 4 June. Present: A. Smith (chair), B. Lee, C. Novak. Apologies: D. Khan. 1. Minutes of the last meeting were approved. 2. Budget: the treasurer reported a surplus of 2,400 pounds. 3. Summer fair: volunteers needed for the cake stall and the raffle. 4. Any other business: none. Next meeting 2 July.",
    ],
    en_invoice: [
      "en",
      "Invoice 2024-118 Date 12/03/2024 Bill to: Acme Ltd, 12 High Street, Leeds. Description Qty Unit price Total. Website design 1 1,200.00 1,200.00. Hosting (12 months) 12 15.00 180.00. Subtotal 1,380.00 VAT 20% 276.00 Total due 1,656.00. Payment terms: 30 days. Bank: Barclays. Sort code 20-00-00. Account 12345678. Thank you for your business.",
    ],
    en_invoice_list: [
      "en",
      "Invoice number 4411. Date 12 March. Item one: printer paper, 10 boxes. Item two: toner cartridge, black. Total due within thirty days of receipt. Thank you for your business. Payment by bank transfer to the account shown below on the invoice.",
    ],
    en_cv: [
      "en",
      "Curriculum Vitae. John Smith. Senior Software Engineer. Experience: 2018-2024 Lead developer at Contoso, building payment APIs in Go and TypeScript. 2014-2018 Developer at Fabrikam, responsible for data pipelines. Education: BSc Computer Science, University of Manchester. Skills: Kubernetes, PostgreSQL, React, AWS. Languages: English (native), French (fluent).",
    ],
    en_resume: [
      "en",
      "Senior software engineer with ten years of experience building web applications. Led a team of five developers. Designed and shipped a payments platform used by two million customers. Skills: TypeScript, React, Node, PostgreSQL, AWS. Education: BSc Computer Science, University of Leeds.",
    ],
    nl_tech: [
      "nl",
      "De gebruiker is verantwoordelijk voor het beheer van zijn account. Het systeem is beschikbaar op werkdagen en de helpdesk is bereikbaar per e-mail. Een factuur is geldig als die is ondertekend door de directeur en de afdeling financien. Die regel is in 2024 ingevoerd en is sindsdien niet gewijzigd.",
    ],
    de_tech: [
      "de",
      "Der Benutzer ist für die Verwaltung seines Kontos verantwortlich. Das System ist an Werktagen verfügbar und der Support ist per E-Mail erreichbar. Eine Rechnung ist gültig, wenn sie vom Direktor unterschrieben ist.",
    ],
    // Catalan is not one of our targets: it must decide nothing.
    ca_letter: [
      null,
      "No sé si podré venir demà. La meva mare no està bé i he de cuidar-la o trobar algú que ho faci. Si no puc, et truco abans de les vuit. Ja hem parlat amb el metge, però no ens ha dit res de nou.",
    ],
    mixed_en_es_notice: [
      null,
      "The meeting is on Monday. La reunión es el lunes. The office is closed on Friday. La oficina está cerrada el viernes. Please bring the documents and the signed forms. Por favor traiga los documentos y los formularios firmados.",
    ],
    mixed_en_es_contract: [
      null,
      "The contract is signed by both parties. El contrato es firmado por ambas partes. The tenant shall pay the rent on the first day of each month. El inquilino pagará el alquiler el primer día de cada mes. The landlord is responsible for repairs. El propietario es responsable de las reparaciones.",
    ],
  };

  /** What the detector is expected to REACH: running prose, minutes, an itemised invoice. */
  const PROSE = [
    "en_minutes",
    "en_invoice_list",
    "es_letter_no_heavy",
    "es_no_heavy_2",
    "es_news",
    "it_letter",
    "it_news",
    "pt_letter",
    "pt_news",
    "fr_letter",
    "fr_news",
    "en_letter_plain",
    "en_business_letter",
    "nl_tech",
    "de_tech",
  ];
  /**
   * NOT reached, stated: lists, invoices and CVs are mostly names, numbers
   * and nouns, with too few common words to decide; and a short formal Spanish
   * letter whose common words ("le", "su", "por", "en") are shared with
   * Italian, Portuguese or French, so they do not vote. They fail OPEN (no stop,
   * the run goes ahead and is charged), which is why translate-pdf#1 is only
   * partly closed for them.
   */
  const NOT_REACHED = ["es_customer", "en_invoice", "en_cv", "en_resume"];

  const latinTargets = Object.keys(LATIN_STOPWORDS);

  it("health: the held-out corpus is all accounted for, in both directions", () => {
    const named = [...PROSE, ...NOT_REACHED].sort();
    const undecided = Object.entries(HELD_OUT)
      .filter(([, [language]]) => language === null)
      .map(([k]) => k);
    expect([...named, ...undecided].sort()).toEqual(
      Object.keys(HELD_OUT).sort(),
    );
    expect(Object.keys(HELD_OUT).length).toBeGreaterThanOrEqual(20);
  });

  it("NO FALSE STOP: no text is ever read as a language it is not in, for any target", () => {
    for (const [name, [truth, text]] of Object.entries(HELD_OUT)) {
      const said = latinLanguage(text);
      for (const target of latinTargets) {
        if (target === truth) continue;
        // Auto-detect into `target` is stopped exactly when said === target.
        expect(said === target, `${name} would stop a run into ${target}`).toBe(
          false,
        );
      }
    }
  });

  it.each(PROSE)("prose is recognised: %s", (name) => {
    const [truth, text] = HELD_OUT[name]!;
    expect(latinLanguage(text)).toBe(truth);
  });

  it("the stated limit: invoices, CVs and a short formal letter are not decided (they fail open)", () => {
    for (const name of NOT_REACHED)
      expect(latinLanguage(HELD_OUT[name]![1]), name).toBeNull();
  });
});
