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
