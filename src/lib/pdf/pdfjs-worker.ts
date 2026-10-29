/**
 * ONE pdf.js worker per page, shared by every document the browser opens.
 *
 * Without this, each `getDocument` builds its own `PDFWorker`, and each
 * `PDFWorker` starts its own Web Worker from `pdf.worker.min.mjs` (1.18 MB
 * raw, 361 KB gz). Measured on production 2026-10-29: Compare PDF opens two
 * documents, so the worker script was requested TWICE IN PARALLEL after the
 * click, and the run waited ~1.6 s for it (9–14 s on a cold slow link). Every
 * other tool paid one fetch-and-start per document it opened — the page
 * board, then the run, then each thumbnail renderer.
 *
 * Shared by passing it as the `worker` option of each open, NOT by setting
 * `GlobalWorkerOptions.workerPort`. Read in pdfjs 6.2.108's `getDocument`: a
 * worker taken from the global port is stored on the loading task
 * (`task._worker`), and `task.destroy()` destroys it — so the first document
 * a tool released would take the worker out from under a second one still
 * open (Compare holds two), and opening a document while another is being
 * destroyed throws "the worker is being destroyed". A worker handed in as
 * `worker:` is never stored on the task, so no document's `destroy()` reaches
 * it; the worker outlives every document, which is the point.
 *
 * Lifecycle: created when `loadPdfjs` first loads the browser build — on a
 * file's arrival when the runner kit's `warmPdfjs` runs, else at the first
 * open. Recreated lazily when the one we hold cannot serve another document: it was destroyed (`destroyed` is pdfjs's own
 * flag, set by `PDFWorker.destroy()` and checked by `getDocument`, which
 * would otherwise reject with "Worker was destroyed"), or it failed to start
 * (its `promise` rejected). pdfjs exposes no other death signal, so nothing
 * else is claimed here.
 *
 * Browser only. Node and jsdom load pdfjs's legacy build, which runs with its
 * own in-process fake worker, and `./pdfjs` never routes them through this.
 */

/** The part of pdfjs's `PDFWorker` this relies on. */
export interface PdfWorkerLike {
  readonly destroyed: boolean;
  readonly promise: Promise<unknown>;
  destroy(): void;
}

/** pdfjs's `PDFWorker` constructor, as this calls it. */
export type PdfWorkerClass<W extends PdfWorkerLike = PdfWorkerLike> =
  new () => W;

let current: PdfWorkerLike | null = null;

/** The worker every document on this page opens in; made on first use. */
export function sharedPdfWorker<W extends PdfWorkerLike>(
  PDFWorker: PdfWorkerClass<W>,
): W {
  if (current && !current.destroyed && current instanceof PDFWorker) {
    return current as W;
  }
  const worker = new PDFWorker();
  current = worker;
  // A worker that never started cannot serve the next document: forget it,
  // so the next open builds a fresh one. The open that was waiting on it
  // sees the rejection through its own loading task.
  worker.promise.catch(() => {
    if (current === worker) current = null;
  });
  return worker;
}

/**
 * pdfjs's document opener, as this forwards to it. Declared through a method
 * signature so its parameter stays bivariant: pdfjs's own parameter is a
 * union (bytes, a URL, or an options object), and this passes only objects.
 */
type DocumentOpener = { open(src: object): unknown }["open"];

/** The slice of the pdfjs module this wraps. */
export interface PdfjsWorkerHost {
  PDFWorker: PdfWorkerClass;
  getDocument: DocumentOpener;
}

/** True for the `getDocument` parameter object (not bytes, a URL or a string). */
function isParams(src: unknown): src is Record<string, unknown> {
  return (
    typeof src === "object" &&
    src !== null &&
    !ArrayBuffer.isView(src) &&
    !(src instanceof ArrayBuffer) &&
    !(typeof URL !== "undefined" && src instanceof URL)
  );
}

/**
 * The pdfjs module with `getDocument` opening every document in the shared
 * worker. A caller that names its own `worker` keeps it. Everything else on
 * the module is the module's own (classes, constants), so `instanceof`
 * checks against them still hold.
 *
 * This is a FORWARDER, not an open: it adds `worker` and passes every option
 * the caller wrote through unchanged. The two source guards over `getDocument`
 * calls — `pdfjs-open.test.ts` (each task reaches `awaitPdfjsDocument`) and
 * `wasm-assets.test.ts` (each call spreads `PDFJS_DOCUMENT_DEFAULTS`) — judge
 * the CALLERS, where the options are written and the task is awaited, so the
 * forward goes through a reference they do not read as a call site. What they
 * therefore cannot see — that nothing a caller passes is dropped on the way
 * through — is asserted in `pdfjs-worker.test.ts` with the real
 * `PDFJS_DOCUMENT_DEFAULTS`.
 */
export function withSharedWorker<M extends PdfjsWorkerHost>(pdfjs: M): M {
  const open = pdfjs.getDocument.bind(pdfjs);
  const forward = (src: object) =>
    open(
      isParams(src) && !src.worker
        ? { ...src, worker: sharedPdfWorker(pdfjs.PDFWorker) }
        : src,
    );
  return { ...pdfjs, getDocument: forward } as M;
}
