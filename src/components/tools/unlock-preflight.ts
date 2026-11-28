import { classifyPdfAccess } from "@/lib/pdf/encryption";
import { checkOpenPassword } from "@/lib/pdf/open-password";

/**
 * Unlock PDF's look at a picked file before anything uploads (audit
 * unlock-pdf#1). The batch has had it since e4067b1e (`securityPreflight`);
 * the single-file panel uploaded up to 100 MB, with the password, only for
 * our server to say the file was not locked or the password was a typo.
 *
 * The panel fetches this through the batch's chunk
 * (`./runner/batch/security-batch` re-exports {@link lookForUnlock}), so the
 * Protect and Unlock pages' first load carries none of it, and no chunk of
 * its own is added to every page's chunk map.
 */

/** Said under a picked PDF that has no password and no restrictions. */
export const UNLOCK_NOT_LOCKED_LINE =
  "This PDF isn't password-protected, so there's nothing to unlock. Nothing was uploaded.";
/** The field's label for a PDF that opens freely but is restricted. */
export const UNLOCK_OWNER_PASSWORD_LABEL = "Owner (permissions) password";
/** The field's hint for that file. */
export const UNLOCK_OWNER_PASSWORD_HINT =
  "This PDF opens without a password, but its owner locked printing, copying or editing. Enter its owner (permissions) password to remove those locks.";
/** Said under the field when the browser found the password wrong. */
export const UNLOCK_WRONG_PASSWORD_LINE =
  "That password doesn't open this PDF. Check capitals, spaces and the keyboard layout, then try again. Nothing was uploaded.";
/** Run's reason while the password is tried. */
export const UNLOCK_CHECKING_LINE = "Checking the password in your browser…";

/** What the panel shows for a picked file, and how it tries a password. */
export interface UnlockLook {
  readonly file: File;
  /** Said under the file; Run stays off and nothing is sent. */
  readonly stop: string | null;
  /** The password field's label and hint, when they differ from the default. */
  readonly label: string | null;
  readonly hint: string | null;
  readonly checking: string;
  /**
   * The line to show instead of uploading with `password`, or `null` to
   * upload. Never throws: a check that cannot run decides nothing.
   */
  readonly check: (password: string) => Promise<string | null>;
  /** The password last refused, and the line that said so (set by the panel). */
  readonly refused?: string;
  readonly refusal?: string;
}

/**
 * Read the file the way a viewer does (`classifyPdfAccess`, which opens it
 * with no password and never unlocks anything). A file it cannot read is
 * left to our server, as before. Never throws.
 */
export async function lookForUnlock(file: File): Promise<UnlockLook> {
  let bytes: Uint8Array | null = null;
  let kind = "unreadable";
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
    kind = (await classifyPdfAccess(bytes)).kind;
  } catch {
    // Unread: our server decides.
  }
  const look = {
    file,
    stop: null,
    label: null,
    hint: null,
    checking: UNLOCK_CHECKING_LINE,
    check: async () => null,
  };
  if (kind === "unencrypted") return { ...look, stop: UNLOCK_NOT_LOCKED_LINE };
  if (kind === "restricted")
    return {
      ...look,
      label: UNLOCK_OWNER_PASSWORD_LABEL,
      hint: UNLOCK_OWNER_PASSWORD_HINT,
    };
  if (kind !== "password-required" || !bytes) return look;
  const locked = bytes;
  return {
    ...look,
    // Only a password `checkOpenPassword` calls "wrong" is stopped; anything
    // it cannot judge goes to our server, which decides.
    check: async (password) =>
      (await checkOpenPassword(locked, password)) === "wrong"
        ? UNLOCK_WRONG_PASSWORD_LINE
        : null,
  };
}
