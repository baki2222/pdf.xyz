/**
 * qpdf's documented process exit statuses, defined ONCE for every runner that
 * shells out to it.
 *
 * History, kept because the previous shape was the defect: the repair runner
 * (`pdf-structure/native`) learned that exit 3 means "warnings issued, output
 * was created" and kept that knowledge in a private `const QPDF_EXIT_WARNINGS
 * = 3`. The protect/unlock runner (`pdf-security/native`) never saw it and
 * threw on any non-zero exit, so every PDF qpdf had to repair on the way in —
 * a wrong `startxref`, a shifted xref table, the files scanners and old
 * exporters write every day — failed Protect with "could not process this
 * file" after qpdf had written a correctly encrypted result. One fact, two
 * owners, and only one of them had been told.
 *
 * Plain values only: this module has no imports, so any runner (or a test)
 * can depend on it without pulling a Node built-in anywhere new.
 */

/**
 * qpdf ran with warnings and DID write its output. For a damaged input this is
 * what a successful recovery looks like. It also means "encrypted, but opens
 * without a password" under `--requires-password` — the same number, a
 * different question; callers of that option interpret it themselves.
 */
export const QPDF_EXIT_WARNINGS = 3;

/**
 * qpdf's error status. Also the answer "not encrypted" to `--is-encrypted` and
 * `--requires-password`, and "invalid password" from a `--decrypt` — and, for
 * every one of those options, "qpdf could not open the file at all". The number
 * cannot tell "not encrypted" from "unreadable"; a caller that acts on
 * "not encrypted" must let a later step fail on an unreadable file.
 */
export const QPDF_EXIT_ERROR = 2;

/**
 * Did a qpdf run that writes an output file finish in a state where that output
 * exists? 0 (clean) or {@link QPDF_EXIT_WARNINGS}. This says nothing about the
 * output's contents — every caller still reads and validates the bytes.
 */
export function qpdfWroteOutput(result: {
  code: number;
  timedOut: boolean;
}): boolean {
  return (
    !result.timedOut &&
    (result.code === 0 || result.code === QPDF_EXIT_WARNINGS)
  );
}
