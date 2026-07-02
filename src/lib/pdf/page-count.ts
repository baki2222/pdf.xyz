/**
 * Best-effort, *local* PDF page counter for the workspace file cards.
 *
 * This is a progressive enhancement, not a guarantee: it parses the PDF entirely
 * in the browser (pdf-lib, pure JS — no upload, no worker) purely to read the
 * page count for display. `pdf-lib` is loaded via dynamic import so it never
 * weighs down the initial workspace bundle — the chunk is fetched only once a
 * PDF is actually staged. Any failure (corrupt, encrypted-and-unreadable, or an
 * unexpected shape) resolves to `null` so callers can simply skip the hint.
 */

/**
 * Count the pages in a PDF given its raw bytes, or return `null` when the file
 * can't be read as a PDF. Never throws.
 */
export async function countPdfPages(bytes: Uint8Array): Promise<number | null> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes, {
      updateMetadata: false,
      // Encrypted PDFs still expose their page tree; count what we can.
      ignoreEncryption: true,
    });
    const count = doc.getPageCount();
    return Number.isInteger(count) && count > 0 ? count : null;
  } catch {
    return null;
  }
}
