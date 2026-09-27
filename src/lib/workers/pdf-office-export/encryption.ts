import { isPdfOpenRefusal, PdfTextExecError } from "../pdf-text/errors";

/**
 * Does this PDF carry an encryption dictionary?
 *
 * Asked ONLY after pdftotext has refused to open the document, never as a
 * gate before it. An owner-password PDF — encrypted, but openable without a
 * password — converts fine, and a pre-check on `/Encrypt` would start refusing
 * it. Once poppler has already said "this will not open", an encryption
 * dictionary is the difference between "it needs a password" and "it is
 * damaged", and that difference decides both the message and the link.
 *
 * pdf-lib first: it resolves the trailer through xref streams as well as
 * classic tables. It can also fail on a document it cannot fully parse, and an
 * encrypted file is often one of those, so a byte scan for the trailer's
 * `/Encrypt` entry is the fallback. Total: never throws, and "unknown" reads as
 * not encrypted, which only costs the more specific message.
 */
const ENCRYPT_ENTRY = /\/Encrypt\s*(?:\d+\s+\d+\s+R|<<)/;

export async function pdfHasEncryptionDictionary(
  bytes: Uint8Array,
): Promise<boolean> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    if (doc.isEncrypted) return true;
  } catch {
    // Fall through to the scan.
  }
  return ENCRYPT_ENTRY.test(new TextDecoder("latin1").decode(bytes));
}

/**
 * What a thrown `pdftotext` failure says about the DOCUMENT, when it says
 * anything: `too_large` for the output ceiling, `password_protected` or
 * `unreadable` when poppler refused to open it, and `null` for a run that
 * merely did not finish (timeout, spawn error, an unknown throw) — the only
 * class a retry can change.
 *
 * Shared by every engine that reads PDF text through the native runner, so the
 * answer to "is this the document's fault" is written once. Each engine keeps
 * its own sentence, because each names its own next step.
 */
export type PdfDocumentFailure =
  "too_large" | "password_protected" | "unreadable";

export async function classifyPdfTextFailure(
  error: unknown,
  input: Uint8Array,
  isEncrypted: (
    bytes: Uint8Array,
  ) => Promise<boolean> = pdfHasEncryptionDictionary,
): Promise<PdfDocumentFailure | null> {
  if (error instanceof PdfTextExecError && error.outputTooLarge)
    return "too_large";
  if (!isPdfOpenRefusal(error)) return null;
  const encrypted = await isEncrypted(input).catch(() => false);
  return encrypted ? "password_protected" : "unreadable";
}
