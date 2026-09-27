/**
 * Client-facing result metadata for `pdf-to-pdfa`: **what the conversion removed.**
 *
 * PDF/A cannot represent everything a PDF can, and Ghostscript's answer is to
 * delete the offending content and carry on. Measured on the production worker
 * (gs 10.00.0, the exact production argv, a one-page PDF with three transparent
 * objects): **exit 0**, a valid output file, and two
 * `"…cannot be represented in XMP for PDF/A1, discarding DOCINFO"` lines on a
 * stream nobody read. The user was handed a document with its metadata silently
 * removed and told the conversion succeeded.
 *
 * This is a harder case than the two before it. repair-pdf had exit 3 to signal
 * on; compression had a page count to compare. Here the process announces the
 * deletion only in prose, and reports success — so the prose IS the signal, and
 * discarding it discards the only evidence that exists.
 *
 * A conversion that discarded something is NOT a failure: the user asked for
 * PDF/A, and PDF/A cannot hold what was removed. The file is correct and the
 * removal is inherent to the format. Ship it, and say what went.
 */
import { boundToolNotes } from "./tool-notes";

/**
 * The PDF/A part and level the worker asks Ghostscript for. Defined here, in a
 * client-safe module, so the tool page can name the standard without importing
 * the engine; the engine re-exports it, and `worker-tool-answers.test.ts` holds
 * its part number to the `-dPDFA=` flag Ghostscript is actually given.
 */
export const PDF_A_STANDARD = "PDF/A-2b" as const;

export interface PdfAResultMeta {
  /**
   * True when Ghostscript reported anything at all while converting. A separate
   * field from `notes.length` so a run whose every line was dropped by
   * sanitizing still reads as "something happened" rather than as a clean
   * conversion — "nothing was removed" and "we cannot tell you what was
   * removed" are different answers.
   */
  hadNotes: boolean;
  /** Sanitized Ghostscript output, verbatim prose. Empty on a silent run. */
  notes: string[];
}

/** True when a value plausibly came from the real PDF/A contract. */
export function isPdfAResultMeta(value: unknown): value is PdfAResultMeta {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as PdfAResultMeta).hadNotes === "boolean"
  );
}

/**
 * Re-bound an untrusted PDF/A block for persistence.
 *
 * The notes are NOT parsed or classified. They are prose from a third-party
 * binary that changes between versions — the worker's Ghostscript is 10.00.0
 * today — and a classifier that silently stopped matching after an upgrade
 * would report "nothing happened" while meaning "I no longer understand". Text
 * goes through as text.
 */
export function buildPdfAResultMeta(raw: PdfAResultMeta): PdfAResultMeta {
  return {
    hadNotes: raw.hadNotes === true,
    notes: boundToolNotes(raw.notes),
  };
}
