/**
 * The input of the `requestSignatureLabels` start-up proof
 * (`./labels-capability.ts`): a blank one-page Letter PDF built in this
 * process. Its own module because the proof READS a form (prepared.pdf) and
 * never saves one, and `src/deploy/text-drawing-call-sites.test.ts` reads
 * any module that both touches a form and calls `save()` as a form writer;
 * the document saved here has no form at all.
 */
import { PDFDocument } from "pdf-lib";

export async function labelsProbePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return await doc.save();
}
