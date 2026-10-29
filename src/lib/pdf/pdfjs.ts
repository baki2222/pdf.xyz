import { pdfjsLoadError } from "./engine-errors";
import { normalizeAngle } from "./rotation";
import type { Rotation } from "./types";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";

/**
 * The one loader for pdfjs, and the read-only questions only pdfjs can answer.
 *
 * pdf-lib and pdfjs disagree about exactly one population of files, and it is
 * a large one: PDFs with OWNER-ONLY ("permissions") encryption — an /Encrypt
 * dictionary with an empty user password. Every viewer opens them with no
 * prompt; bank statements, e-invoices, e-books and government forms ship this
 * way. pdf-lib cannot decrypt, so it refuses any /Encrypt at all; pdfjs
 * decrypts with the empty password and reads them like any other file.
 *
 * That split decides two things:
 *
 *  - Tools that only READ a PDF through pdfjs (to image, to text, to Markdown)
 *    read its page count and rotations here too, so an owner-only file is not
 *    refused by a pdf-lib preflight for a library the tool never uses.
 *  - Tools that WRITE through pdf-lib still cannot take the file — pdf-lib
 *    would copy ciphertext streams without their key — but the refusal is
 *    true now: `pdfLoadError` in `./engine` asks `./encryption`'s probe to
 *    tell "restricted" apart from "needs a password to open", which pdf-lib
 *    reports identically.
 */

export type PdfjsModule = typeof import("pdfjs-dist");

let workerConfigured = false;

/**
 * Load pdfjs once. In a browser that is the main build with our locally
 * bundled worker. Where the DOM geometry pdfjs's main build needs at import
 * time is absent — Node (tests, scripts) and jsdom have no `DOMMatrix` — it is
 * the legacy build, which runs there with its own fake worker. The legacy
 * import is hidden from the bundlers: the browser never takes that branch, and
 * it must not become a chunk the browser could fetch.
 */
export async function loadPdfjs(): Promise<PdfjsModule> {
  if (typeof globalThis.DOMMatrix === "undefined") {
    return (await import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ "pdfjs-dist/legacy/build/pdf.mjs"
    )) as PdfjsModule;
  }
  const pdfjs = await import("pdfjs-dist");
  if (!workerConfigured) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    workerConfigured = true;
  }
  return pdfjs;
}

/**
 * Await a pdfjs loading task, releasing it and translating the failure when
 * the document does not open. Every `getDocument` caller goes through this, so
 * no tool can surface pdfjs's raw "No password given" again —
 * `pdfjs-open.test.ts` pairs every `getDocument` in shipped source with a call
 * to this.
 */
export async function awaitPdfjsDocument<T>(task: {
  promise: Promise<T>;
  destroy(): Promise<void>;
}): Promise<T> {
  try {
    return await task.promise;
  } catch (err) {
    await task.destroy().catch(() => {});
    // The engine's one translation of a pdf.js open failure: a password
    // refusal and an unreadable file become its typed errors; anything that
    // is not about the file (a worker that failed to start) passes unchanged.
    throw pdfjsLoadError(err);
  }
}

/** Open `bytes` with pdfjs, mapping known open failures to engine errors. */
async function openDocument(bytes: Uint8Array) {
  const pdfjs = await loadPdfjs();
  // pdfjs may detach the buffer it is handed; the caller's bytes stay intact.
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
  });
  return { task, doc: await awaitPdfjsDocument(task) };
}

/**
 * Page count and each page's rotation, read through pdfjs — the preflight
 * for tools whose whole pipeline is pdfjs.
 */
export async function readPagesWithPdfjs(
  bytes: Uint8Array,
): Promise<{ pageCount: number; rotations: Rotation[] }> {
  const { task, doc } = await openDocument(bytes);
  try {
    const rotations: Rotation[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      rotations.push(normalizeAngle(page.rotate));
      page.cleanup();
    }
    return { pageCount: doc.numPages, rotations };
  } finally {
    await task.destroy().catch(() => {});
  }
}
