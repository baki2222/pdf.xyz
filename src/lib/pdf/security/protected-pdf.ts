import {
  permissionsFromP,
  type PdfPermissions,
} from "@/lib/jobs/pdf-permissions";
import {
  UnreadablePdfError,
  decryptDocument,
  openHandler,
  writePlain,
  type XrefInfo,
} from "./document";
import { writeIncrementalUpdate, type IncrementalResult } from "./incremental";
import {
  StandardSecurityHandler,
  UnsupportedEncryptionError,
} from "./standard-handler";

/**
 * An encrypted PDF that opens without a password, held the way a viewer
 * holds it: decrypted to read, with the author's grant (/P) and the key to
 * write the changes that grant allows back under the author's encryption.
 *
 * Two modes, and nothing between them:
 *  - RESTRICTED (no owner password): only what /P grants — here, filling
 *    the form's existing fields and, when /P bit 6 is granted, adding
 *    comments (`restricted-comments.test.ts`). {@link ProtectedPdf.saveChanges} appends
 *    an incremental update, so the copy keeps the original encryption,
 *    permissions and owner password byte for byte.
 *  - UNLOCKED (owner password verified): everything. The editor works on
 *    the decrypted copy and saves an UNENCRYPTED file — what Unlock PDF
 *    does on the server, here in the browser.
 *
 * The owner password is checked and dropped: this object holds no copy of
 * it, and nothing here logs it or sends it anywhere.
 */
export class ProtectedPdf {
  #unlocked = false;

  private constructor(
    /** The file as published. */
    readonly original: Uint8Array,
    /** The decrypted copy, object numbers as in the original. */
    readonly plain: Uint8Array,
    private readonly handler: StandardSecurityHandler,
    private readonly xref: XrefInfo,
  ) {}

  /** What the author grants without the owner password. */
  get permissions(): PdfPermissions {
    return permissionsFromP(this.handler.effectiveP);
  }

  /** Revision and cipher, e.g. "R6 · AES-256". */
  get scheme(): string {
    const { r, stream } = this.handler.params;
    const cipher =
      stream === "aesv3"
        ? "AES-256"
        : stream === "aesv2"
          ? "AES-128"
          : stream === "rc4"
            ? `RC4 ${this.handler.params.lengthBits}-bit`
            : "no cipher";
    return `R${r} · ${cipher}`;
  }

  /** May the existing form fields be filled? (/P bit 9, or bit 6.) */
  get canFillForms(): boolean {
    return (
      this.#unlocked || this.permissions.fillForms || this.permissions.annotate
    );
  }

  /**
   * May comments be added — highlights, drawings, notes, shapes and lines
   * saved as annotations? (/P bit 6, "add or modify annotations".) Without
   * the owner password they are written into an incremental update that
   * rewrites the page's /Annots and nothing else of the page.
   */
  get canAnnotate(): boolean {
    return this.#unlocked || this.permissions.annotate;
  }

  get unlocked(): boolean {
    return this.#unlocked;
  }

  /** Verify an owner password; true unlocks every tool for this session. */
  async unlock(password: string): Promise<boolean> {
    if (this.#unlocked) return true;
    const ok = await this.handler.isOwnerPassword(password);
    if (ok) this.#unlocked = true;
    return ok;
  }

  /**
   * `edited` (the decrypted copy after a form fill, or with comments
   * added) as the ORIGINAL file plus an incremental update under its own
   * encryption. Refuses an edit that touches a page
   * (`RestrictedChangeError`) — except a page's /Annots, when the author
   * allows comments.
   */
  async saveChanges(edited: Uint8Array): Promise<IncrementalResult> {
    return writeIncrementalUpdate({
      original: this.original,
      handler: this.handler,
      xref: this.xref,
      plain: this.plain,
      edited,
      allowAnnotations: this.permissions.annotate,
    });
  }

  /** @internal — {@link openProtectedPdf} */
  static async open(bytes: Uint8Array): Promise<OpenProtectedResult> {
    try {
      const { handler, xref } = await openHandler(bytes);
      if (!handler) return { kind: "needs-password" };
      const doc = await decryptDocument(bytes, handler, xref);
      const plain = await writePlain(doc);
      return {
        kind: "opened",
        pdf: new ProtectedPdf(bytes, plain, handler, xref),
      };
    } catch (err) {
      if (err instanceof UnsupportedEncryptionError)
        return { kind: "unsupported", reason: err.message };
      if (err instanceof UnreadablePdfError)
        return { kind: "unsupported", reason: err.message };
      return {
        kind: "unsupported",
        reason: err instanceof Error ? err.message : "unknown",
      };
    }
  }
}

export type OpenProtectedResult =
  | { kind: "opened"; pdf: ProtectedPdf }
  /** The empty password does not open it: it needs the open password. */
  | { kind: "needs-password" }
  /** A handler or layout this module does not read. */
  | { kind: "unsupported"; reason: string };

/** Open an encrypted PDF with the empty user password, as a viewer would. */
export function openProtectedPdf(
  bytes: Uint8Array,
): Promise<OpenProtectedResult> {
  return ProtectedPdf.open(bytes);
}
