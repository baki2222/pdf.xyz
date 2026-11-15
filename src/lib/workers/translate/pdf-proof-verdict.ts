/**
 * The verdict of `pnpm worker:translate-pdf-proof`, the gate CI runs in the
 * built worker image before a merge (competitor audit #29 slice 2, review r1,
 * 2026-11-16).
 *
 * WHY THIS IS ITS OWN FUNCTION: Translate PDF's static copy names the
 * languages that get a reflowed PDF from {@link TRANSLATE_PDF_CI_REQUIRED},
 * and this verdict is what keeps that copy true. While the check sat inline
 * in the script, a guard could only read the script's source — and a review
 * kept the source shape it looked for while narrowing the check inline
 * (`.filter((l) => ["en", "es", "bn"].includes(l))`), dropping Thai inside
 * the predicate, or returning 0 after "not proven": all green. A pure
 * function can be RUN, so `translate-pdf-coverage.test.ts` proves the
 * property (every required language missing from `passing` fails the gate)
 * instead of a spelling of it.
 *
 * The required set is not a parameter on purpose: a caller that could pass
 * its own list could pass a shorter one.
 *
 * Pure: no Node built-in, no I/O.
 */
import {
  TRANSLATE_PDF_CI_REQUIRED,
  type TranslateLanguage,
} from "@/lib/jobs/translate-pdf";

export interface TranslatePdfProofVerdict {
  /** 0 = proven; 1 = a required language not proven, a false drop, or a named other failure. */
  readonly exitCode: 0 | 1;
  /** Required languages the image did not prove, in gate order. */
  readonly notProven: readonly TranslateLanguage[];
  /** What the script prints after the per-language lines. */
  readonly lines: readonly string[];
}

/**
 * `otherFailures` are the script's own non-language checks, each one line
 * (2026-11-16, CJK slice: the ToUnicode rewrite cases and the vendored
 * radical-glyph facts). Any entry fails the gate. They come in here, rather
 * than as a separate `return 1` in the script, so the script keeps exactly
 * one way to pass and the guard can still read that from its source.
 */
export function translatePdfProofVerdict(
  passing: readonly string[],
  falseDrops: number,
  otherFailures: readonly string[] = [],
): TranslatePdfProofVerdict {
  const notProven = TRANSLATE_PDF_CI_REQUIRED.filter(
    (language) => !passing.includes(language),
  );
  const lines: string[] = [];
  if (notProven.length > 0)
    lines.push(`FAIL — not proven: ${notProven.join(", ")}`);
  if (falseDrops > 0)
    lines.push(`FAIL — ${falseDrops} false drop(s) at delivery size`);
  for (const failure of otherFailures) lines.push(`FAIL — ${failure}`);
  const exitCode = lines.length > 0 ? 1 : 0;
  if (exitCode === 0) lines.push("PASS");
  return { exitCode, notProven, lines };
}
