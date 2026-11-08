import { awaitPdfjsDocument, loadPdfjs, type PdfjsModule } from "./pdfjs";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";

/**
 * A PDF's page count as pdf.js reads it, and nothing else: no page is opened.
 *
 * Compare PDF's file cards need only the count, and pdf.js's — it opens a PDF
 * that needs no password but carries its author's restrictions, which pdf-lib
 * refuses (audit compare-pdf#5). `readPagesWithPdfjs` would also walk every
 * page for rotations Compare discards. A file that needs a password is refused
 * through `awaitPdfjsDocument`, as `PdfEncryptedError`.
 *
 * Its own module so only Compare PDF's page loads it (`pdfjs.ts` is shared).
 */
export async function countPagesWithPdfjs(
  bytes: Uint8Array,
  load: () => Promise<PdfjsModule> = loadPdfjs,
): Promise<number> {
  const pdfjs = await load();
  // pdfjs may detach the buffer it is handed; the caller's bytes stay intact.
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
  });
  const doc = await awaitPdfjsDocument(task);
  try {
    return doc.numPages;
  } finally {
    await task.destroy().catch(() => {});
  }
}
