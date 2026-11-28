/**
 * Which target language a document's SCRIPT alone already implies — the Auto-detect
 * half of audit #38.
 *
 * An explicit "Bengali into Bengali" is refused by `parseTranslateOptions`. The common
 * way to hit the same waste is the default: Auto-detect as the source, with a target
 * the document is already written in. The job then runs, returns a copy of the text,
 * and spends up to a third of the daily AI allowance on it.
 *
 * Some scripts are written by exactly ONE of the languages we translate into: a
 * Bengali-script document can only be Bengali among `TRANSLATE_LANGUAGES`, a Hangul
 * one only Korean. The Translate panel already extracts the text before it uploads,
 * so it can see this and warn before anything is spent.
 *
 * THE BOUND, stated rather than implied:
 *   - Latin script decides nothing. English, Spanish, French, German, Italian,
 *     Portuguese, Dutch, Polish, Swedish, Turkish, Vietnamese and Indonesian all write
 *     in it, so `scriptOnlyLanguage` returns null for a Latin-script document. Its
 *     common words decide it instead: see `latinLanguage` below (translate-pdf#1).
 *   - Cyrillic is shared by Russian and Ukrainian, so it decides only when the text
 *     uses letters one of them has and the other lacks (ы э ъ vs і ї є ґ).
 *   - Han without kana is read as Chinese; any kana makes it Japanese.
 *   - "Only one of OUR languages" is not "only one language": Marathi is written in
 *     Devanagari, Urdu and Persian in Arabic script, Assamese in Bengali script. A
 *     Marathi document into Hindi is a real translation. That is why this is a
 *     WARNING the user can read past, never a refusal.
 */
import { LANGUAGE_NAMES, type TranslateLanguage } from "./translate-pdf";

type Script =
  | "bengali"
  | "devanagari"
  | "arabic"
  | "thai"
  | "hangul"
  | "cjk"
  | "cyrillic"
  | "latin";

/** How each script is recognised, one character at a time. */
const SCRIPT_PATTERNS: Record<Script, RegExp> = {
  bengali: /\p{Script=Bengali}/u,
  devanagari: /\p{Script=Devanagari}/u,
  arabic: /\p{Script=Arabic}/u,
  thai: /\p{Script=Thai}/u,
  hangul: /\p{Script=Hangul}/u,
  // Han plus both kana, one group: a Japanese page mixes all three.
  cjk: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u,
  cyrillic: /\p{Script=Cyrillic}/u,
  latin: /\p{Script=Latin}/u,
};

/**
 * The targets each non-Latin script can be among `TRANSLATE_LANGUAGES`. Exported so its
 * test can check, by derivation, that every non-Latin target is reachable and that
 * nothing here is a language we do not translate into.
 */
export const SCRIPT_ONLY_LANGUAGES: Readonly<
  Record<Exclude<Script, "latin">, readonly TranslateLanguage[]>
> = {
  bengali: ["bn"],
  devanagari: ["hi"],
  arabic: ["ar"],
  thai: ["th"],
  hangul: ["ko"],
  cjk: ["zh", "ja"],
  cyrillic: ["ru", "uk"],
};

/** Fewer letters than this is too little text to judge. */
const MIN_LETTERS = 20;
/** The share of letters one script must hold to be the document's script. */
const DOMINANT_SHARE = 0.8;
/** Enough text to judge; a long document is not scanned to the end. */
const SAMPLE_CHARS = 20_000;

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const RUSSIAN_ONLY = /[ыэъЫЭЪ]/u;
const UKRAINIAN_ONLY = /[іїєґІЇЄҐ]/u;

/**
 * The one target language the text's dominant script allows, or null when the script
 * does not decide it (Latin, an ambiguous Cyrillic or mixed text, or too little text).
 */
export function scriptOnlyLanguage(text: string): TranslateLanguage | null {
  const sample = text.slice(0, SAMPLE_CHARS);
  const counts = new Map<Script, number>();
  let letters = 0;
  for (const char of sample) {
    for (const [script, pattern] of Object.entries(SCRIPT_PATTERNS) as [
      Script,
      RegExp,
    ][]) {
      if (pattern.test(char)) {
        counts.set(script, (counts.get(script) ?? 0) + 1);
        letters += 1;
        break;
      }
    }
  }
  if (letters < MIN_LETTERS) return null;
  let dominant: Script | null = null;
  for (const [script, count] of counts) {
    if (count / letters >= DOMINANT_SHARE) dominant = script;
  }
  if (dominant === null || dominant === "latin") return null;
  if (dominant === "cjk") return KANA.test(sample) ? "ja" : "zh";
  if (dominant === "cyrillic") {
    const russian = RUSSIAN_ONLY.test(sample);
    const ukrainian = UKRAINIAN_ONLY.test(sample);
    if (russian === ukrainian) return null;
    return russian ? "ru" : "uk";
  }
  return SCRIPT_ONLY_LANGUAGES[dominant][0] ?? null;
}

/** The panel's warning when Auto-detect meets a document already in the target. */
export function translateAutoSameLanguageWarning(
  language: TranslateLanguage,
): string {
  const name = LANGUAGE_NAMES[language];
  return `This PDF looks like it is already in ${name}. Translating it into ${name} would return the same text and still use the daily AI allowance.`;
}

/**
 * THE LATIN HALF (audit translate-pdf#1). Script cannot tell English from Spanish,
 * but each language's short common words can: "the", "and", "of" are English; "el",
 * "los", "y" are Spanish. Each list holds that language's REAL common words, and a
 * word common in two languages is listed under both ("no" is Spanish, Portuguese
 * and Italian; "die" is German and Dutch). Only a word in exactly one list decides
 * anything (`LATIN_DECIDING_WORDS`, derived below), so a shared word never votes.
 *
 * Until the review of 7b498d92 the lists were kept apart by hand instead, and to do
 * it words frequent in two languages were filed under one of them: a Spanish letter
 * full of "no" came out Portuguese, and Auto-detect into Portuguese was stopped.
 * `translate-script.test.ts` derives the table's keys from `TRANSLATE_LANGUAGES`
 * minus the script-only languages above, and runs a held-out corpus written by the
 * reviewers against every Latin target for that false stop.
 *
 * Unlike a script, these words name a LANGUAGE, so an Auto-detect run into the
 * language they show is stopped before upload; the reader can still go on by
 * choosing the source language themselves.
 */
export const LATIN_STOPWORDS: Readonly<
  Partial<Record<TranslateLanguage, readonly string[]>>
> = {
  en: [
    "the",
    "and",
    "of",
    "to",
    "in",
    "is",
    "it",
    "that",
    "for",
    "you",
    "was",
    "with",
    "on",
    "have",
    "be",
    "at",
    "by",
    "this",
    "are",
    "from",
    "an",
    "will",
    "your",
    "we",
    "our",
    "not",
    "but",
    "which",
    "has",
    "if",
    "they",
    "should",
    "when",
    "each",
    "would",
    "can",
    "been",
    "their",
    "her",
    "i",
    "my",
    "he",
    "she",
    "thank",
    "please",
  ],
  es: [
    "el",
    "la",
    "los",
    "las",
    "de",
    "del",
    "y",
    "en",
    "que",
    "a",
    "un",
    "una",
    "es",
    "por",
    "con",
    "no",
    "se",
    "su",
    "al",
    "lo",
    "para",
    "como",
    "más",
    "pero",
    "o",
    "este",
    "esta",
    "ha",
    "muy",
    "hay",
    "cuando",
    "sea",
    "debe",
    "también",
    "está",
    "mi",
    "te",
    "si",
    "yo",
    "nos",
    "le",
    "usted",
    "ya",
    "porque",
  ],
  fr: [
    "le",
    "la",
    "les",
    "de",
    "des",
    "du",
    "et",
    "est",
    "un",
    "une",
    "en",
    "que",
    "qui",
    "il",
    "elle",
    "pour",
    "dans",
    "ce",
    "pas",
    "sur",
    "au",
    "avec",
    "se",
    "ne",
    "sont",
    "nous",
    "vous",
    "par",
    "quand",
    "cela",
    "chaque",
    "mais",
    "je",
    "ou",
    "si",
    "te",
    "ma",
    "été",
    "aux",
    "cette",
  ],
  de: [
    "der",
    "die",
    "das",
    "und",
    "in",
    "ist",
    "den",
    "dem",
    "zu",
    "von",
    "mit",
    "sich",
    "des",
    "auf",
    "für",
    "nicht",
    "es",
    "ein",
    "eine",
    "auch",
    "an",
    "als",
    "wird",
    "wenn",
    "muss",
    "sie",
    "dies",
    "zwischen",
    "ich",
    "im",
    "bei",
    "nach",
    "ja",
    "her",
    "werden",
    "vom",
    "oder",
  ],
  it: [
    "il",
    "la",
    "le",
    "di",
    "che",
    "e",
    "è",
    "un",
    "una",
    "per",
    "in",
    "non",
    "del",
    "della",
    "delle",
    "gli",
    "i",
    "da",
    "a",
    "con",
    "si",
    "al",
    "su",
    "lo",
    "ma",
    "come",
    "sono",
    "nel",
    "alla",
    "degli",
    "perché",
    "molto",
    "questo",
    "questa",
    "ogni",
    "sarà",
    "tra",
    "anche",
    "o",
    "no",
    "se",
    "mi",
    "ti",
    "ci",
    "ha",
    "te",
    "qui",
    "ne",
    "dei",
  ],
  pt: [
    "o",
    "a",
    "os",
    "as",
    "de",
    "do",
    "da",
    "dos",
    "das",
    "e",
    "é",
    "um",
    "uma",
    "que",
    "em",
    "no",
    "na",
    "não",
    "com",
    "por",
    "para",
    "se",
    "mais",
    "mas",
    "como",
    "ao",
    "pelo",
    "pela",
    "são",
    "também",
    "você",
    "isso",
    "muito",
    "quando",
    "deve",
    "vai",
    "este",
    "esta",
    "seu",
    "sua",
    "ele",
    "ela",
    "já",
    "nos",
    "ou",
    "foi",
    "há",
  ],
  nl: [
    "de",
    "het",
    "een",
    "en",
    "van",
    "in",
    "is",
    "op",
    "te",
    "dat",
    "die",
    "niet",
    "met",
    "voor",
    "zijn",
    "er",
    "ook",
    "maar",
    "aan",
    "om",
    "als",
    "bij",
    "of",
    "wordt",
    "tussen",
    "moet",
    "wanneer",
    "elke",
    "deze",
    "zij",
    "ze",
    "den",
    "men",
    "naar",
    "dan",
    "door",
    "per",
  ],
  pl: [
    "jest",
    "się",
    "nie",
    "i",
    "w",
    "z",
    "na",
    "do",
    "to",
    "że",
    "o",
    "co",
    "jak",
    "ale",
    "po",
    "od",
    "przez",
    "dla",
    "jako",
    "oraz",
    "który",
    "czy",
    "ta",
    "ten",
    "tak",
    "będzie",
    "między",
    "każdego",
    "kiedy",
    "jeśli",
    "we",
    "on",
    "ze",
    "za",
    "a",
  ],
  sv: [
    "är",
    "och",
    "att",
    "det",
    "ska",
    "för",
    "med",
    "när",
    "varje",
    "detta",
    "mellan",
    "inte",
    "som",
    "en",
    "ett",
    "i",
    "på",
    "av",
    "till",
    "den",
    "de",
    "har",
    "om",
    "men",
    "jag",
    "ja",
  ],
  tr: [
    "bu",
    "ve",
    "ile",
    "bir",
    "için",
    "olarak",
    "her",
    "çok",
    "daha",
    "gibi",
    "isterse",
    "arasında",
    "olan",
    "ama",
    "değil",
    "var",
    "da",
    "de",
    "en",
    "ne",
  ],
  vi: [
    "của",
    "và",
    "là",
    "các",
    "những",
    "được",
    "này",
    "một",
    "cho",
    "có",
    "không",
    "khi",
    "sẽ",
    "người",
    "đã",
    "với",
    "trong",
    "để",
    "theo",
  ],
  id: [
    "dan",
    "yang",
    "ini",
    "itu",
    "akan",
    "dengan",
    "untuk",
    "pada",
    "jika",
    "tidak",
    "adalah",
    "dari",
    "setiap",
    "harus",
    "di",
    "ke",
    "dalam",
    "saya",
    "kami",
    "anda",
  ],
};

/** Fewer words than this is too little text to judge. */
const MIN_WORDS = 20;
/** The leading language needs at least this many of its common words... */
const MIN_HITS = 5;
/** ...at least this share of all the words... */
const MIN_HIT_SHARE = 0.08;
/** ...and this many times the runner-up's count, or the text is mixed. */
const LEAD_FACTOR = 2;

/**
 * The words that decide: those in exactly ONE list. A word common in two
 * languages is in both lists and so in neither of these; derived, never typed.
 */
export const LATIN_DECIDING_WORDS: ReadonlyMap<string, TranslateLanguage> =
  (() => {
    const owners = new Map<string, TranslateLanguage[]>();
    for (const [language, words] of Object.entries(LATIN_STOPWORDS) as [
      TranslateLanguage,
      readonly string[],
    ][])
      for (const word of words)
        owners.set(word, [...(owners.get(word) ?? []), language]);
    return new Map(
      [...owners]
        .filter(([, by]) => by.length === 1)
        .map(([word, by]) => [word, by[0]!] as const),
    );
  })();

/**
 * The Latin-script target language the text's common words show, or null when they
 * do not clearly show one (too few words, mixed languages, or not Latin text).
 */
export function latinLanguage(text: string): TranslateLanguage | null {
  const words = text
    .slice(0, SAMPLE_CHARS)
    .normalize("NFC")
    .toLowerCase()
    .split(/[^\p{L}\p{M}']+/u)
    .filter((w) => w !== "");
  if (words.length < MIN_WORDS) return null;
  const hits = new Map<TranslateLanguage, number>();
  for (const word of words) {
    const language = LATIN_DECIDING_WORDS.get(word);
    if (language) hits.set(language, (hits.get(language) ?? 0) + 1);
  }
  const ranked = [...hits].sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  if (!best) return null;
  if (best[1] < MIN_HITS || best[1] / words.length < MIN_HIT_SHARE) return null;
  if (second && best[1] < second[1] * LEAD_FACTOR) return null;
  return best[0];
}

/** The language a document is in, from its script first, then its common words. */
export function documentLanguage(text: string): TranslateLanguage | null {
  return scriptOnlyLanguage(text) ?? latinLanguage(text);
}

/**
 * The panel's stop when Auto-detect meets a Latin-script document already in the
 * target language: said before anything is uploaded, with the way to go on.
 */
export function translateAlreadyInLanguageMessage(
  language: TranslateLanguage,
): string {
  const name = LANGUAGE_NAMES[language];
  return `This PDF looks like it is already in ${name}, so Translate is held: it would give back the same text and still use the daily AI allowance. Nothing has been uploaded. Choose another language to translate into, or, if we guessed wrong, pick the language it is written in under Source language.`;
}
