import type { PdfPermissions } from "@/lib/jobs/pdf-permissions";
import {
  openForCopy,
  type ToolGrant,
} from "@/lib/pdf/security/open-with-password";
import type { ProtectedPdf } from "@/lib/pdf/security/protected-pdf";

/**
 * The owner-password field's check (`./owner-password`), in its own chunk:
 * fetched only when someone submits a password under a refused file, so no
 * tool page carries the security handler in its first load.
 *
 * The decision is not made here. It is `openForCopy`, the one rule Grayscale
 * PDF already used (`./grayscale-unlock`): only the OWNER password may lift
 * the author's restrictions (/P), so the open password of a file whose
 * author withholds something — or no password — is refused. Rotate PDF and
 * Extract Images lift nothing (the rotation is written under the author's
 * encryption; no PDF is written at all), so for them the open password
 * serves when the author grants the tool's one permission (`grant`).
 *
 * The opened file carries its `protection`, unlocked by the owner password:
 * Rotate PDF writes the rotation back under the author's own encryption
 * through it, and Extract Images reads its grant from it. Merge PDF,
 * Extract Pages and Delete Pages build their new file from `plain`, the
 * decrypted copy.
 *
 * It imports NOTHING a tool page loads up front. The runner reads the page
 * board from `plain` with what it already holds: a lazy chunk that imports
 * a first-load module splits that module out of the shared chunk on every
 * page (measured 2026-11-17: `use-single-pdf`, `digital-signatures` and
 * `pdfjs` moved into a new chunk on every tool page, +0.4 KB gz each, when
 * this module read the board itself — Merge PDF does not load them).
 *
 * The password is used and dropped: nothing here keeps, logs or sends it.
 */
export interface OwnerOpened {
  file: File;
  /** The decrypted copy: no /Encrypt. */
  plain: Uint8Array;
  /** The file as opened — unlocked when the password was the owner's. */
  protection: ProtectedPdf;
}

export type OwnerUnlock =
  | { kind: "opened"; opened: OwnerOpened }
  | { kind: "wrong-password" }
  | { kind: "withheld"; permissions: PdfPermissions }
  | { kind: "unsupported" };

export async function unlockWithOwnerPassword(
  file: File,
  bytes: Uint8Array,
  password: string,
  /**
   * Rotate PDF and Extract Images, which make no unrestricted copy: the
   * open password serves when the author grants the tool's one permission.
   */
  grant?: ToolGrant,
): Promise<OwnerUnlock> {
  const result = await openForCopy(bytes, password, grant);
  if (result.kind !== "opened") return result;
  return {
    kind: "opened",
    opened: { file, plain: result.plain, protection: result.pdf },
  };
}
