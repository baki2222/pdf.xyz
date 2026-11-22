import { classifyPdfAccess } from "@/lib/pdf/encryption";
import { checkOpenPassword } from "@/lib/pdf/open-password";

/**
 * Unlock PDF's look at a picked file before anything uploads (audit
 * unlock-pdf#1). The batch has had it since e4067b1e (`securityPreflight`);
 * the single-file panel uploaded up to 100 MB, with the password, only for
 * our server to say the file was not locked or the password was a typo.
 *
 * Its own module, fetched by the panel when a file is picked, so the
 * Protect and Unlock pages' first load does not carry it.
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

/** What the panel shows for a picked file. */
export interface UnlockLook {
  /** Said under the file; Run stays off and nothing is sent. */
  readonly stop: string | null;
  /** The password field's label and hint, when they differ from the default. */
  readonly label: string | null;
  readonly hint: string | null;
  /** The file needs a password to open: try it here before uploading. */
  readonly checkPassword: boolean;
}

/**
 * Read the file the way a viewer does (`classifyPdfAccess`, which opens it
 * with no password and never unlocks anything). A file it cannot read is
 * left to our server, as before.
 */
export async function lookForUnlock(bytes: Uint8Array): Promise<UnlockLook> {
  const access = await classifyPdfAccess(bytes);
  const none = { stop: null, label: null, hint: null, checkPassword: false };
  switch (access.kind) {
    case "unencrypted":
      return { ...none, stop: UNLOCK_NOT_LOCKED_LINE };
    case "restricted":
      return {
        ...none,
        label: UNLOCK_OWNER_PASSWORD_LABEL,
        hint: UNLOCK_OWNER_PASSWORD_HINT,
      };
    case "password-required":
      return { ...none, checkPassword: true };
    default:
      return none;
  }
}

/**
 * The line to show instead of uploading, or `null` to upload. Only a
 * password `checkOpenPassword` calls "wrong" is stopped; anything it cannot
 * judge goes to our server, which decides.
 */
export async function refuseOpenPassword(
  bytes: Uint8Array,
  password: string,
): Promise<string | null> {
  return (await checkOpenPassword(bytes, password)) === "wrong"
    ? UNLOCK_WRONG_PASSWORD_LINE
    : null;
}
