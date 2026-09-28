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

/* ------------------------------------------------------------------ *
 *  The in-browser editors' verdict — the same probe, read for them.
 * ------------------------------------------------------------------ */

/**
 * What an in-browser editor says when pdf-lib refuses an encrypted file,
 * reduced to the two facts the person holding it can act on:
 *
 *  - NEEDS A PASSWORD: no viewer opens it without one. "Password-protected" is
 *    true, and Unlock PDF with that password is the way forward.
 *  - OPENS WITHOUT ONE: bank statements, government forms and e-books very
 *    often ship like this. Every viewer opens it with no prompt, so being told
 *    it is "password-protected" is false from where the user sits.
 *
 * `null` is "could not tell", and its copy is true in both cases rather than a
 * guess. It is {@link classifyPdfAccess} read for that question — not a second
 * probe. Two lanes built this independently on 2026-09-27 (L12 for Compress,
 * L06 for every pdf-lib loader); they were merged into one pdf.js open at the
 * integration of wave1/l06-copy-other, so no two surfaces can classify the
 * same file two ways.
 */
export type EncryptionVerdict = "opens-without-password" | "needs-password";

/**
 * The tool every message below sends the user to, and where it lives. The
 * pair is checked against the catalogue in `encryption-verdict.test.ts`, so a
 * rename cannot leave the copy pointing at a tool that is not there.
 */
export const UNLOCK_TOOL_NAME = "Unlock PDF";
export const UNLOCK_TOOL_HREF = "/tools/unlock-pdf";

/** The file needs a password to open. */
export const PDF_NEEDS_PASSWORD_MESSAGE = `This PDF is password-protected. Remove the password with ${UNLOCK_TOOL_NAME} first, then try again.`;

/**
 * The file opens freely but its author restricted changes.
 *
 * Written (L06, 0cf157b) as "use Unlock PDF and leave the password blank".
 * Unlock never removes protection without the password that set it — the rule
 * the other lane kept (a50c54c): an empty password is refused, and a
 * restrictions-only file is unlocked with its OWNER password. So the way out
 * this names is that one.
 */
export const PDF_RESTRICTED_MESSAGE = `This PDF has editing restrictions set by its author. It opens without a password, but these tools can't change it until the restrictions are removed — ${UNLOCK_TOOL_NAME} removes them with the owner (permissions) password that set them.`;

/** The probe could not run: a sentence true of both kinds. */
export const PDF_ENCRYPTED_UNKNOWN_MESSAGE = `This PDF is encrypted, so these tools can't change it. Remove the encryption with ${UNLOCK_TOOL_NAME} first — enter the password that opens it or, if it opens without one, its owner (permissions) password — then try again.`;

/** The copy for a verdict. `null` is "could not tell". */
export function encryptedPdfMessage(verdict: EncryptionVerdict | null): string {
  if (verdict === "needs-password") return PDF_NEEDS_PASSWORD_MESSAGE;
  if (verdict === "opens-without-password") return PDF_RESTRICTED_MESSAGE;
  return PDF_ENCRYPTED_UNKNOWN_MESSAGE;
}

/** Every sentence above — a surface that renders one can offer the way out. */
export const ENCRYPTED_PDF_MESSAGES: readonly string[] = [
  PDF_NEEDS_PASSWORD_MESSAGE,
  PDF_RESTRICTED_MESSAGE,
  PDF_ENCRYPTED_UNKNOWN_MESSAGE,
];

/** The slice of pdf.js a caller of {@link probePdfEncryption} may inject. */
export type PdfjsOpener = PdfjsForAccess;

/**
 * Ask pdf.js to open the bytes with no password, as a viewer does. `null`
 * means the probe itself could not run (pdf.js failed to load, or the file
 * failed for a reason that is not a password) — never a guess either way.
 *
 * `load` defaults to the same source {@link classifyPdfAccess} uses (the
 * browser build, or the legacy build `src/tests/setup.ts` installs).
 */
export async function probePdfEncryption(
  bytes: Uint8Array,
  load: () => Promise<PdfjsOpener> = () => pdfjsSource(),
): Promise<EncryptionVerdict | null> {
  let lib: PdfjsOpener;
  try {
    lib = await load();
  } catch {
    return null;
  }
  const access = await classifyPdfAccess(bytes, lib);
  switch (access.kind) {
    case "password-required":
      return "needs-password";
    case "restricted":
    case "unencrypted":
      return "opens-without-password";
    case "unreadable":
      return null;
  }
}
