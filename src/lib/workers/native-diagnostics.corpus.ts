/**
 * Real captured output from the native binaries — the corpus every change to
 * `native-diagnostics.ts` is executed against.
 *
 * WHY THIS FILE EXISTS. Two consecutive path-rule defects shipped, and both were
 * found only by RUNNING the function against real output rather than reading it:
 *
 *  1. `#90`'s rule was "contains a slash", which deleted the Ghostscript notice
 *     it existed to surface, because `PDF/A1` has a slash in it.
 *  2. `363f6ab`'s replacement added `(^|\s)\/\S` — start-of-line-or-space, slash,
 *     non-space. That is precisely the shape of a PDF NAME OBJECT, so it deleted
 *     all nine structural qpdf diagnostics below: `/Encrypt`, ` /Root`, `/Type`.
 *     It fixed the case it was written for and deleted the case that dominates.
 *
 * Reading a regex is how both of those happened. So the corpus lives here rather
 * than in someone's terminal scrollback, and the test beside it prints a verdict
 * per line. A rule is not "reviewed"; it is run.
 *
 * PROVENANCE is recorded per entry because a fixture whose origin is unstated
 * becomes indistinguishable from one somebody invented.
 */

/** One captured line and what must happen to it. */
export interface CorpusLine {
  readonly text: string;
  /** `show` — a real diagnostic a user needs. `drop` — carries a filesystem path. */
  readonly verdict: "show" | "drop";
  readonly source: string;
}

/**
 * Structural diagnostics from **libqpdf 29.3.0**, extracted from the binary on
 * the production worker (2026-08-11).
 *
 * These are the entire point of `repair-pdf`: they say what was wrong with the
 * document and what was reconstructed. 17 of libqpdf's 186 diagnostic sentences
 * contain a slash, and the structural ones are over-represented among them —
 * because PDF names all begin with one.
 */
export const QPDF_STRUCTURAL: readonly CorpusLine[] = [
  "/Encrypt in trailer dictionary is not a dictionary",
  "/Fields key of /AcroForm dictionary is not an array; ignoring",
  "Cross-reference stream's /Index has an invalid number of values",
  "unable to find /Root dictionary",
  "Unable to parse /DA:",
  "/Type key should be /Pages but is not; overriding",
  "incorrect length for /O and/or /U in encryption dictionary",
  "invalid /ID in trailer dictionary",
  "object 3 0: /Length key in stream dictionary is incorrect",
].map((text) => ({
  text,
  verdict: "show" as const,
  source: "libqpdf 29.3.0, extracted on the production worker 2026-08-11",
}));

/** qpdf's recovery messages for a PDF with its `startxref` removed. */
export const QPDF_RECOVERY: readonly CorpusLine[] = [
  "WARNING: file is damaged",
  "WARNING: can't find startxref",
  "WARNING: Attempting to reconstruct cross-reference table",
  "operation succeeded with warnings; resulting file may have some problems",
  "WARNING: (offset 9999999): xref not found",
].map((text) => ({
  text,
  verdict: "show" as const,
  source: "qpdf 11.3.0 on the production worker, damaged-PDF probe 2026-08-11",
}));

/** Ghostscript 10.00.0, production PDF/A argv, transparency-bearing document. */
export const GHOSTSCRIPT_NOTICES: readonly CorpusLine[] = [
  "Text string detected in DOCINFO cannot be represented in XMP for PDF/A1, discarding DOCINFO",
].map((text) => ({
  text,
  verdict: "show" as const,
  source: "gs 10.00.0 stderr, production argv 2026-08-11",
}));

/**
 * Lines that carry a filesystem path and must never reach a user.
 *
 * The temp paths are removed by exact string match before the rule is reached;
 * this net is the second line of defence, for paths we did not create.
 */
export const PATH_BEARING: readonly CorpusLine[] = [
  {
    text: "Loading font Helvetica (or substitute) from /usr/share/ghostscript/10.00.0/Resource/Font/NimbusSans-Regular",
    verdict: "drop",
    source: "gs 10.00.0 stdout, production run 2026-08-11",
  },
  {
    text: "WARNING: /tmp/pdfxyz-structure-ab12/input.pdf: file is damaged",
    verdict: "drop",
    source: "qpdf 11.3.0 on the production worker, before path stripping",
  },
  {
    text: "output written to /tmp/pdfxyz-pdfa-99/output.pdf",
    verdict: "drop",
    source: "shape of a gs output message naming a temp path",
  },
  {
    // Separators BUILT, never typed: `"C:\Users"` is `C:<tab>sers`, and a
    // fixture that stops containing a separator tests nothing.
    text: `error reading C:${String.fromCharCode(92)}Users${String.fromCharCode(92)}me${String.fromCharCode(92)}doc.pdf`,
    verdict: "drop",
    source: "Windows path shape (this repo's dev platform)",
  },
  {
    text: `${String.fromCharCode(92)}${String.fromCharCode(92)}server${String.fromCharCode(92)}share${String.fromCharCode(92)}x.pdf not found`,
    verdict: "drop",
    source: "UNC path shape",
  },
];

/** Everything, for a single run that prints a verdict per line. */
export const DIAGNOSTIC_CORPUS: readonly CorpusLine[] = [
  ...QPDF_STRUCTURAL,
  ...QPDF_RECOVERY,
  ...GHOSTSCRIPT_NOTICES,
  ...PATH_BEARING,
];
