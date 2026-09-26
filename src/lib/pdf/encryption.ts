import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";

/**
 * What the in-browser tools say when a PDF is encrypted — and the one probe
 * that decides WHICH kind of encrypted it is.
 *
 * pdf-lib refuses every encrypted PDF with the same error, whether the file
 * needs a password to open or merely carries its author's editing
 * restrictions (an "owner" password only). The two are different facts for the
 * person holding the file:
 *
 *  - NEEDS A PASSWORD: no viewer opens it without one. "Password-protected" is
 *    true, and Unlock PDF with that password is the way forward.
 *  - OPENS WITHOUT ONE: bank statements, government forms and e-books very
 *    often ship like this. Every viewer opens it with no prompt, so being told
 *    it is "password-protected" is false from where the user sits, and being
 *    sent to a tool that asks for a password they never had is a dead end.
 *
 * pdf.js — already shipped for thumbnails and text — tries the empty user
 * password exactly as a viewer does, so asking it to open the file answers the
 * question by the same rule the user experienced. The answer is three-valued:
 * when the probe cannot run at all, the copy must be true in BOTH cases rather
 * than guess one.
 *
 * DOM-free by construction: pdf.js is imported lazily, only when a load has
 * already failed on encryption, and the loader is injectable so the probe can
 * be driven under Node with the legacy build (the modern build needs
 * `DOMMatrix`).
 */

export type EncryptionVerdict = "opens-without-password" | "needs-password";

/**
 * The tool every message below sends the user to, and where it lives. The
 * pair is checked against the catalogue in `encryption.test.ts`, so a rename
 * cannot leave the copy pointing at a tool that is not there.
 */
export const UNLOCK_TOOL_NAME = "Unlock PDF";
export const UNLOCK_TOOL_HREF = "/tools/unlock-pdf";

/** The file needs a password to open. */
export const PDF_NEEDS_PASSWORD_MESSAGE = `This PDF is password-protected. Remove the password with ${UNLOCK_TOOL_NAME} first, then try again.`;

/** The file opens freely but its author restricted changes. */
export const PDF_RESTRICTED_MESSAGE = `This PDF has editing restrictions set by its author. It opens without a password, but these tools can't change it until the restrictions are removed — use ${UNLOCK_TOOL_NAME} and leave the password blank, then try again.`;

/** The probe could not run: a sentence true of both kinds. */
export const PDF_ENCRYPTED_UNKNOWN_MESSAGE = `This PDF is encrypted, so these tools can't change it. Remove the encryption with ${UNLOCK_TOOL_NAME} first — enter its password, or leave the password blank if it opens without one — then try again.`;

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

/** The slice of pdf.js the probe needs. */
export interface PdfjsOpener {
  getDocument(src: Record<string, unknown> & { data: Uint8Array }): {
    promise: Promise<unknown>;
    destroy(): Promise<void>;
  };
}

let workerConfigured = false;

/** The browser's pdf.js, pointed at the bundled worker (as render.ts does). */
async function loadBrowserPdfjs(): Promise<PdfjsOpener> {
  const pdfjs = await import("pdfjs-dist");
  if (!workerConfigured) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    workerConfigured = true;
  }
  return pdfjs as unknown as PdfjsOpener;
}

/**
 * Ask pdf.js to open the bytes with no password. `null` means the probe itself
 * could not run (pdf.js failed to load, or the file failed for a reason that is
 * not a password) — never a guess in either direction.
 */
export async function probePdfEncryption(
  bytes: Uint8Array,
  load: () => Promise<PdfjsOpener> = loadBrowserPdfjs,
): Promise<EncryptionVerdict | null> {
  let pdfjs: PdfjsOpener;
  try {
    pdfjs = await load();
  } catch {
    return null;
  }
  // pdf.js may transfer (detach) the buffer it is handed: give it a copy so
  // the caller's bytes stay intact.
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
  });
  try {
    await task.promise;
    return "opens-without-password";
  } catch (err) {
    // Matched by name, not class: pdf.js rebuilds exceptions that cross its
    // worker boundary, so identity is not preserved.
    return (err as { name?: unknown } | null)?.name === "PasswordException"
      ? "needs-password"
      : null;
  } finally {
    await task.destroy().catch(() => {});
  }
}
