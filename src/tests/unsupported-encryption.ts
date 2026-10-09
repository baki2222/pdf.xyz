import { PDFDocument, PDFName } from "pdf-lib";

/**
 * An encrypted PDF that qpdf cannot open: its `/Encrypt` dictionary names a
 * public-key security handler (`/Adobe.PubSec`, the certificate-encryption
 * shape) instead of the Standard password handler. qpdf refuses it with its
 * error status 2 — the same number `--is-encrypted` uses for "not encrypted"
 * and `--decrypt` used for "wrong password", which is how such a file was told
 * both "This PDF isn't password-protected" and "The password is incorrect".
 *
 * ONE builder, used by the real-qpdf integration suite
 * (`pdf-security/native.integration.test.ts`) and the production proof
 * (`scripts/worker-prove-tools.ts`); its shape is checked without qpdf in
 * `./unsupported-encryption.test.ts`.
 *
 * No content stream is encrypted — nothing needs to be; the handler name alone
 * is what every reader refuses on. Saved with a classic xref table so the
 * trailer carrying `/Encrypt` is plain text a test can read.
 */
export async function unsupportedEncryptionPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([320, 240]);
  const encrypt = doc.context.obj({
    Filter: PDFName.of("Adobe.PubSec"),
    SubFilter: PDFName.of("adbe.pkcs7.s5"),
    V: 4,
    Length: 128,
  });
  doc.context.trailerInfo.Encrypt = doc.context.register(encrypt);
  return doc.save({ useObjectStreams: false });
}
