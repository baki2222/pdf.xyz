import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";

/**
 * What kind of lock a PDF carries — asked of a READER, not of our editor.
 *
 * pdf-lib refuses every document that has an `/Encrypt` dictionary, and until
 * this module existed every refusal was reported as "This PDF is
 * password-protected". Most encrypted PDFs in the wild are not: bank
 * statements, e-invoices and publisher PDFs carry an OWNER password that only
 * restricts editing, and open in every viewer with no prompt at all. Telling
 * that user they have a password they were never asked for is false, and it
 * dead-ended a tool (Compress) whose secure-worker path could still run.
 *
 * pdf-lib cannot tell the two apart — it does not decrypt. pdf.js does: it
 * opens a document with the empty user password when the file allows it, and
 * rejects with a `PasswordException` when it does not. So the question is put
 * to pdf.js, which is also the renderer the rest of the product trusts for
 * "what does a reader see".
 *
 * Deliberately NOT `PDFDocument.load(..., { ignoreEncryption: true })`: in a
 * PDF 1.5+ file the page objects live inside object streams, which are
 * themselves encrypted, so pdf-lib reads garbage or nothing there — a page
 * count from it is a number with no relationship to the document.
 */
export type PdfAccess =
  /** No `/Encrypt` at all — pdf-lib can rewrite it. */
  | { readonly kind: "unencrypted"; readonly pageCount: number }
  /** Encrypted, but opens with no password (owner/permissions lock only). */
  | { readonly kind: "restricted"; readonly pageCount: number }
  /** Needs a password just to open. */
  | { readonly kind: "password-required" }
  /** Not readable as a PDF by pdf.js either. */
  | { readonly kind: "unreadable" };

/**
 * What to tell a person about each kind of lock — one definition for every
 * surface that reports it. Only `password-required` mentions a password,
 * because it is the only kind that has one the person could know.
 */
export const LOCKED_PDF_COPY = {
  restricted:
    "This PDF has permission restrictions. It opens without a password, but its owner locked it against changes, so it can't be rewritten in your browser.",
  "password-required":
    "This PDF needs a password to open. Unlock it with its password first, then try again.",
  unreadable:
    "This PDF is encrypted in a way we couldn't open. It may be damaged.",
} as const satisfies Record<Exclude<PdfAccess["kind"], "unencrypted">, string>;

/** The slice of pdf.js this needs; injectable so Node tests can pass the legacy build. */
export type PdfjsForAccess = Pick<
  typeof import("pdfjs-dist"),
  "getDocument" | "PasswordResponses"
>;

let workerConfigured = false;

/** The browser build, pointed at the bundled worker (once). */
async function loadBrowserPdfjs(): Promise<PdfjsForAccess> {
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

type PdfjsSource = () => Promise<PdfjsForAccess>;
let pdfjsSource: PdfjsSource = loadBrowserPdfjs;

/**
 * Replace where pdf.js comes from. For tests only: the browser build needs a
 * worker URL only the bundler can produce, so `src/tests/setup.ts` points this
 * at the legacy build, which runs under Node. Returns the previous source.
 */
export function setPdfjsForAccessSource(source: PdfjsSource): PdfjsSource {
  const previous = pdfjsSource;
  pdfjsSource = source;
  return previous;
}

function isPasswordException(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === "PasswordException"
  );
}

/**
 * Classify a PDF's lock by opening it the way a viewer does. Never throws.
 *
 * `pdfjs` defaults to the browser build the rest of the app uses; pass a module
 * only from a test.
 */
export async function classifyPdfAccess(
  bytes: Uint8Array,
  pdfjs?: PdfjsForAccess,
): Promise<PdfAccess> {
  let lib: PdfjsForAccess;
  try {
    lib = pdfjs ?? (await pdfjsSource());
  } catch {
    return { kind: "unreadable" };
  }
  // pdf.js may transfer (detach) the buffer it is handed; the caller still
  // needs these bytes for the upload, so it gets a private copy.
  const task = lib.getDocument({
    data: bytes.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
  });
  try {
    const doc = await task.promise;
    // `EncryptFilterName` is `xref.encrypt?.filterName ?? null` in pdf.js's
    // document info: non-null exactly when the trailer carries an /Encrypt
    // dictionary and pdf.js is decrypting — the same fact pdf-lib refuses on.
    // (Not `getPermissions()`: that is also null for an /Encrypt with no /P.)
    const { info } = await doc.getMetadata();
    const filter = (info as { EncryptFilterName?: unknown } | null)
      ?.EncryptFilterName;
    return filter === null || filter === undefined
      ? { kind: "unencrypted", pageCount: doc.numPages }
      : { kind: "restricted", pageCount: doc.numPages };
  } catch (err) {
    return isPasswordException(err)
      ? { kind: "password-required" }
      : { kind: "unreadable" };
  } finally {
    await task.destroy().catch(() => {});
  }
}
