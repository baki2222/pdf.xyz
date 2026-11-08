import { PDFDocument, PDFName, PDFNumber, type PDFPage } from "pdf-lib";

/** Append `source` to the page as a content stream of its own. */
function rawContent(doc: PDFDocument, page: PDFPage, source: string): void {
  page.node.addContentStream(doc.context.register(doc.context.stream(source)));
}

/**
 * PDFs pdf-lib LOADS but cannot walk, each carrying invisible text so a
 * Redo pre-pass has a reason to look past the load (review 2026-11-08,
 * `src/lib/workers/strip-invisible-text.ts`):
 *  - a catalog whose /Pages is a number, not a dictionary;
 *  - a page whose /Resources /XObject is a number, while its content draws
 *    a form by name.
 * Each is loaded once here as a health check, so a test that passes them
 * through is about the walk, not about the load.
 */
export async function malformedPdfs(): Promise<Uint8Array[]> {
  const pagesNotDict = await PDFDocument.create();
  rawContent(
    pagesNotDict,
    pagesNotDict.addPage([100, 100]),
    "BT 3 Tr (x) Tj ET",
  );
  pagesNotDict.catalog.set(PDFName.of("Pages"), PDFNumber.of(7));

  const xobjectNotDict = await PDFDocument.create();
  const page = xobjectNotDict.addPage([100, 100]);
  rawContent(xobjectNotDict, page, "BT 3 Tr (x) Tj ET /X Do");
  page.node.set(
    PDFName.of("Resources"),
    xobjectNotDict.context.obj({ XObject: 5 }),
  );

  const out: Uint8Array[] = [];
  for (const doc of [pagesNotDict, xobjectNotDict]) {
    const bytes = await doc.save({ useObjectStreams: false });
    await PDFDocument.load(bytes, { updateMetadata: false });
    out.push(bytes);
  }
  return out;
}
