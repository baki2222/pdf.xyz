import { encryptedPdfMessage, type EncryptionVerdict } from "./encryption";

/**
 * The engine's error types and copy, on their own. Every runner and the
 * remedy builder test `instanceof PdfEngineError`, and while these lived in
 * `./engine` that test put the whole page-assembly engine in the first load
 * of every tool page — worker tools included, which never run it. `./engine`
 * re-exports everything here, so importing from either is the same class.
 */

/**
 * Why the loader refused a file, for callers that must tell the reasons apart.
 * `encrypted` means the file has an /Encrypt dictionary — which is NOT the same
 * as "needs a password": most encrypted PDFs open with no password at all and
 * only restrict editing. A caller that needs to know which asks a reader
 * (`classifyPdfAccess` in `./encryption`); the message alone cannot say.
 */
export const PDF_ENGINE_ERROR_KINDS = ["encrypted", "unreadable"] as const;
export type PdfEngineErrorKind = (typeof PDF_ENGINE_ERROR_KINDS)[number];

/**
 * What a {@link PdfEngineError} may carry beside its message: the standard
 * `cause` (so a wrapped failure keeps its diagnostic) and the refusal `kind`.
 */
export interface PdfEngineErrorOptions extends ErrorOptions {
  readonly kind?: PdfEngineErrorKind;
}

/** Thrown for problems reading or writing PDF bytes, with user-facing copy. */
export class PdfEngineError extends Error {
  readonly kind: PdfEngineErrorKind | undefined;
  constructor(message: string, options?: PdfEngineErrorOptions) {
    super(message, options);
    this.name = "PdfEngineError";
    this.kind = options?.kind;
  }
}

/**
 * pdf-lib refused the file because it is encrypted. `verdict` says whether it
 * needs a password to OPEN (`needs-password`), only carries its author's
 * editing restrictions (`opens-without-password`), or could not be told
 * (`null`) — and the message is the one true of that verdict. See
 * `./encryption` for why the difference is the whole point.
 */
export class PdfEncryptedError extends PdfEngineError {
  readonly verdict: EncryptionVerdict | null;
  constructor(verdict: EncryptionVerdict | null, message?: string) {
    super(message ?? encryptedPdfMessage(verdict), { kind: "encrypted" });
    this.name = "PdfEncryptedError";
    this.verdict = verdict;
  }
}

/**
 * The loader's copy for bytes that are not a readable PDF. Exported so a caller
 * that finds the damage AFTER a successful load (a trailer with no catalog loads
 * fine and throws on the first page walk) reports it in the same words.
 */
export const UNREADABLE_PDF_MESSAGE =
  "This file couldn't be read as a PDF — it may be corrupted or not a PDF.";

/** pdf.js's names for "this is not a readable PDF". */
const PDFJS_UNREADABLE = new Set([
  "InvalidPDFException",
  "MissingPDFException",
  "FormatError",
]);

/**
 * The same translation for a pdf.js load failure (text extraction, layout).
 * pdf.js already knows whether a password is needed, so no probe runs. A
 * failure that is NOT about the file — a worker that failed to start, a chunk
 * that did not load — is returned unchanged: calling it "not a PDF" would send
 * the user to fix a file that is fine.
 */
export function pdfjsLoadError(err: unknown): unknown {
  const name = (err as { name?: unknown } | null)?.name;
  if (name === "PasswordException")
    return new PdfEncryptedError("needs-password");
  if (typeof name === "string" && PDFJS_UNREADABLE.has(name)) {
    return new PdfEngineError(UNREADABLE_PDF_MESSAGE, { kind: "unreadable" });
  }
  return err;
}
