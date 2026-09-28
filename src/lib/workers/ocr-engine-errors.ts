/**
 * Which OCR engine failures belong to the DOCUMENT, and what the user can do
 * about each.
 *
 * Until 2026-09-27 the OCR processor caught every runner throw with a bare
 * `catch {}` and returned one retryable `internal_error`: "The OCR engine could
 * not process this file." A password-protected PDF fails identically on every
 * attempt, so it was retried twice more and then reported with nothing saying
 * it was locked or where to unlock it. The same was true of a PDF that already
 * carried text, a digitally signed one, and a damaged one.
 *
 * OCRmyPDF says which by its exit status (`ocrmypdf.ExitCode`), and those are
 * stable across releases: 2 `input_file`, 6 `already_done_ocr`, 8
 * `encrypted_pdf`. Exit 2 is shared, though — argparse also exits 2 on a bad
 * command line, which would be OUR defect, never the user's file — so for 2 the
 * engine's own stderr decides between "our argv" and "this document", and
 * refines the document case (signed, tagged, unreadable). Stderr is read ONLY to
 * classify: it never reaches a message, a log, or the job record.
 *
 * Everything else — a timeout, a signal kill, a crashed Tesseract or
 * Ghostscript (7), "other error" (15), a spawn failure — stays on the retryable
 * path: those are the run, and a retry may succeed.
 *
 * Node-free, so the processor can import it without pulling `child_process`.
 */

/** OCRmyPDF exit statuses that describe the input document. */
export const OCRMYPDF_EXIT_CODES = {
  /** `ExitCode.input_file` — not a readable PDF, or refused as input (signed, tagged). */
  inputFile: 2,
  /** `ExitCode.already_done_ocr` — `PriorOcrFoundError`: a page already has text. */
  alreadyDoneOcr: 6,
  /** `ExitCode.encrypted_pdf` — `EncryptedPdfError`: password-protected input. */
  encryptedPdf: 8,
} as const;

/** The document-level refusals, each with its own next step. */
export const OCR_REFUSAL_KINDS = [
  "encrypted",
  "prior-text",
  "signed",
  "unreadable",
] as const;
export type OcrRefusalKind = (typeof OCR_REFUSAL_KINDS)[number];

/**
 * The fixed, content-free copy for each refusal. Typed as a total record over
 * the kinds, so a new kind without a message does not compile.
 */
export const OCR_REFUSAL_MESSAGES: Record<OcrRefusalKind, string> = {
  encrypted:
    "This PDF is password-protected, so OCR can't read it. Remove the password with Unlock PDF, then run OCR again. Nothing was processed.",
  "prior-text":
    "This PDF already has a text layer, and the OCR engine would not add a second one. Turn on “Redo existing OCR” to replace a poor text layer. Nothing was processed.",
  signed:
    "This PDF is digitally signed. Adding a text layer would invalidate the signature, so OCR was not run. Nothing was processed.",
  unreadable:
    "This file could not be read as a PDF — it may be damaged. Try Repair PDF, then run OCR again. Nothing was processed.",
};

/**
 * A runner failure that belongs to the document. Thrown by the native runner,
 * mapped by the processor to a NON-retryable `unprocessable_entity` — the same
 * input returns the same answer, so retrying only makes the user wait.
 */
export class OcrEngineRefusal extends Error {
  readonly kind: OcrRefusalKind;

  constructor(kind: OcrRefusalKind) {
    super(OCR_REFUSAL_MESSAGES[kind]);
    this.name = "OcrEngineRefusal";
    this.kind = kind;
  }
}

/** argparse's own usage error: exit 2 about the command line, not the file. */
const ARGPARSE_ERROR = /^usage:|: error: (unrecognized arguments|argument )/m;
const SIGNED = /digital signature/i;
const TAGGED = /tagged pdf/i;

/**
 * Classify a rejected OCRmyPDF `execFile` call. Returns the refusal kind when
 * the failure belongs to the document, or `null` when it belongs to the run
 * (and so stays retryable).
 */
export function classifyOcrmypdfFailure(error: unknown): OcrRefusalKind | null {
  if (typeof error !== "object" || error === null) return null;
  const { code, killed, signal, stderr } = error as {
    code?: unknown;
    killed?: unknown;
    signal?: unknown;
    stderr?: unknown;
  };
  // A timeout or any signal kill is the run, whatever the code says.
  if (killed === true || (typeof signal === "string" && signal.length > 0)) {
    return null;
  }
  if (typeof code !== "number") return null;
  const text = typeof stderr === "string" ? stderr : "";
  switch (code) {
    case OCRMYPDF_EXIT_CODES.encryptedPdf:
      return "encrypted";
    case OCRMYPDF_EXIT_CODES.alreadyDoneOcr:
      return "prior-text";
    case OCRMYPDF_EXIT_CODES.inputFile:
      if (ARGPARSE_ERROR.test(text)) return null;
      if (SIGNED.test(text)) return "signed";
      if (TAGGED.test(text)) return "prior-text";
      return "unreadable";
    default:
      return null;
  }
}
