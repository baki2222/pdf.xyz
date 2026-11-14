import type { ViewerOpenOptions, ViewerPdf } from "@/lib/pdf/viewer";
import { KEPT_IMAGE_PIXELS } from "@/lib/pdf/kept-pages";

/**
 * The two documents Compare PDF's page view holds open: one pdf.js open per
 * file, shared by every holder, destroyed after the last one lets go.
 *
 * The same refcount rule as PDF Viewer's `acquireViewerPdf`
 * (`viewer-runner.tsx`), written again rather than imported: that module is
 * on PDF Viewer's first load, where a new export or a second importer costs
 * every visit to that page. The rule, held by `compare-docs.test.ts`:
 *
 * - one open per `Uint8Array`, however often a holder mounts (React mounts
 *   an effect twice in development; the remount must not reopen, and must
 *   not get a document the first unmount destroyed);
 * - the last release destroys it on the next task (`setTimeout(0)`), so a
 *   release followed at once by an acquire keeps the same document;
 * - the same bytes on both sides are one document with two holders.
 *
 * Each open is its own pdf.js document, so its own Web Worker: two while the
 * view is open (pdfjs-dist 6 shares a worker only by port).
 */

/**
 * What each of the two documents keeps of what pdf.js decoded: half of one
 * PDF Viewer's, so the two together keep what one viewer keeps. The pixel
 * figure comes from `kept-pages` (a module of constants), never from
 * `@/lib/pdf/viewer`: a value import of that module would put pdf.js's open
 * in the comparison's chunk.
 */
export const COMPARE_DOC_OPTIONS = {
  keptPages: 3,
  keptImagePixels: KEPT_IMAGE_PIXELS / 2,
} as const satisfies ViewerOpenOptions;

/** pdf.js's open for the page view, in the viewer's own chunk. */
async function open(bytes: Uint8Array): Promise<ViewerPdf> {
  const { openViewerPdf } = await import("@/lib/pdf/viewer");
  return openViewerPdf(bytes, COMPARE_DOC_OPTIONS);
}

/**
 * Where the open is found: an object, so a test can count and hold the
 * opens without `vi.mock` (under `isolate: false` a module evaluated under a
 * mock stays bound to the stub for the next file). Nothing else writes it.
 */
export const compareDocsOpen = { open };

const held = new WeakMap<
  Uint8Array,
  {
    doc: Promise<ViewerPdf>;
    holders: number;
    timer: ReturnType<typeof setTimeout> | null;
  }
>();

/** The open document for `bytes`, opened once however often a holder mounts. */
export function acquireComparePdf(bytes: Uint8Array): Promise<ViewerPdf> {
  let entry = held.get(bytes);
  if (!entry) {
    entry = { doc: compareDocsOpen.open(bytes), holders: 0, timer: null };
    held.set(bytes, entry);
  }
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  entry.holders += 1;
  return entry.doc;
}

/** Let go of `bytes`' document; the last holder's release destroys it. */
export function releaseComparePdf(bytes: Uint8Array): void {
  const entry = held.get(bytes);
  if (!entry || entry.holders <= 0) return;
  entry.holders -= 1;
  if (entry.holders > 0) return;
  entry.timer = setTimeout(() => {
    held.delete(bytes);
    entry.doc.then(
      (d) => d.destroy(),
      () => {},
    );
  }, 0);
}
