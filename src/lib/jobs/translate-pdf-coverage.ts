/**
 * Which target languages Translate PDF's static copy may say get a reflowed
 * PDF (competitor audit #29, slice 2, 2026-11-15).
 *
 * DERIVED, never typed: the languages with a PDF are exactly
 * {@link TRANSLATE_PDF_CI_REQUIRED} — the set CI makes the built worker image
 * prove before a merge — and the languages without one are
 * `TRANSLATE_LANGUAGES` minus that set. When the Arabic or CJK slice adds a
 * language to the gate, every sentence built here stops naming it, with no
 * copy edit (CLAUDE.md rule 4: derive the set from something that must
 * already be true).
 *
 * WHAT THESE SENTENCES MAY NOT CLAIM: that a particular job will get a PDF.
 * The panel's "You get" row decides that from the running worker's heartbeat
 * (`translatePdfLanguages`) and the job's actual artifact, so the copy states
 * a count, names the languages without a PDF, and points at the panel. That
 * stays true through deploy skew (the web tier auto-deploys; the worker image
 * can lag), because the panel is the runtime authority.
 *
 * Pure data: no Node built-in, safe for the web bundle.
 */
import {
  LANGUAGE_NAMES,
  TRANSLATE_LANGUAGES,
  TRANSLATE_PDF_CI_REQUIRED,
  type TranslateLanguage,
} from "./translate-pdf";

export interface TranslatePdfCoverage {
  /** How many of the target languages get a reflowed PDF. */
  readonly withPdf: number;
  /** All target languages. */
  readonly total: number;
  /** Target languages without one, in `TRANSLATE_LANGUAGES` order. */
  readonly without: readonly TranslateLanguage[];
  /** "17 of the 21 languages" or "all 21 languages". */
  readonly scope: string;
  /** "17 of them" or "all of them" — for a sentence that already named the 21. */
  readonly scopeOfThem: string;
  /** "Arabic, Chinese (Simplified), Japanese, and Korean", or "" when none. */
  readonly withoutNames: string;
}

const conjunction = (codes: readonly TranslateLanguage[]): string =>
  // The same formatter the tool page's own `list` helper uses.
  new Intl.ListFormat("en", { type: "conjunction" }).format(
    codes.map((code) => LANGUAGE_NAMES[code]),
  );

/**
 * The coverage for a required set — the shipped one by default. The
 * parameter exists for the guards' positive controls, which recompute the
 * copy with a language removed or with every language present.
 */
export function translatePdfCoverage(
  required: readonly TranslateLanguage[] = TRANSLATE_PDF_CI_REQUIRED,
): TranslatePdfCoverage {
  const proven = new Set(required);
  const without = TRANSLATE_LANGUAGES.filter((code) => !proven.has(code));
  const total = TRANSLATE_LANGUAGES.length;
  const withPdf = total - without.length;
  const all = without.length === 0;
  return {
    withPdf,
    total,
    without,
    scope: all
      ? `all ${total} languages`
      : `${withPdf} of the ${total} languages`,
    scopeOfThem: all ? "all of them" : `${withPdf} of them`,
    withoutNames: all ? "" : conjunction(without),
  };
}

/**
 * The sentence the tool page and the guide both say: which languages get the
 * reflowed PDF, which do not, and where a reader sees it for their target.
 * `example` is a download name (`lease-translated.pdf`) or omitted.
 */
export function translatePdfCoverageSentence(
  coverage: TranslatePdfCoverage = translatePdfCoverage(),
  example?: string,
): string {
  const pdf = example
    ? `a reflowed PDF of the same text, such as ${example},`
    : "a reflowed PDF of the same text";
  const which =
    coverage.without.length === 0
      ? `For ${coverage.scope}, ${pdf} comes with it`
      : `For ${coverage.scope}, every one but ${coverage.withoutNames}, ${pdf} comes with it`;
  return `${which}; the tool's "You get" line shows whether your target gets one before you start.`;
}
