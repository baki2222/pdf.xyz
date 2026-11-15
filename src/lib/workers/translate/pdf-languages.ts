/**
 * The ONE memo of which target languages this worker has proven it can print
 * as a reflowed PDF (`./pdf-capability`), and its two readers: the heartbeat
 * (`translatePdfLanguages(env)`, awaited by the daemon) and the engine
 * (`translateDeps(env).pdf.languages`, read before every render).
 *
 * A leaf on purpose: `./native` reads the settled value and `./pdf-capability`
 * builds its proof from `./native`, so the state cannot live in either
 * without an import cycle. One definition, two readers — a second memo would
 * let the heartbeat advertise a language the engine refuses, or the reverse.
 */
import type { TranslateLanguage } from "@/lib/jobs/translate-pdf";

let memo: Promise<TranslateLanguage[]> | null = null;
let settled: ReadonlySet<TranslateLanguage> | null = null;

/** The settled set, or null while the proof is still running (or never ran). */
export function settledTranslatePdfLanguages(): ReadonlySet<TranslateLanguage> | null {
  return settled;
}

/**
 * Run `prove` once per process and remember its answer. A throw is an
 * answer too: no language is proven, and the job gets the ZIP alone.
 */
export function memoTranslatePdfLanguages(
  prove: () => Promise<TranslateLanguage[]>,
): Promise<TranslateLanguage[]> {
  memo ??= prove().then(
    (languages) => {
      settled = new Set(languages);
      return languages;
    },
    () => {
      settled = new Set();
      return [];
    },
  );
  return memo;
}

/** Tests only: forget the memo. */
export function resetTranslatePdfLanguagesForTests(): void {
  memo = null;
  settled = null;
}
