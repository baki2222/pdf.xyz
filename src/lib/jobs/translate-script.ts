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
 *     in it, so a Latin-script document returns null and is never warned about.
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
  return `This PDF looks like it is already in ${name}. Translating it into ${name} would return the same text and still use your daily allowance.`;
}
