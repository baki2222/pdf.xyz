"use client";

import type { PdfPermissions } from "@/lib/jobs/pdf-permissions";
import { readFileBytes } from "@/lib/pdf/browser";
import { GRAYSCALE_PASSWORD_LABEL } from "@/lib/pdf/grayscale-password-label";
import { PasswordField, withheldWords } from "./password-field";
import type { LoadedPdf } from "./use-single-pdf";

/**
 * Under Grayscale PDF's refusal of an encrypted file: a password field, so
 * the job stays on the device instead of a round trip through the server's
 * Unlock PDF (audit grayscale-pdf#6). The password is checked in the
 * browser by the file's own security handler (`./grayscale-unlock`, its own
 * chunk), held in this component's state only while it is typed, cleared
 * as it is checked, and never stored or sent.
 *
 * The grayscale copy has no encryption, so a password that does not entitle
 * the person to drop the author's restrictions is refused with the reason
 * (`./grayscale-unlock`). Sentences are constants, pinned by
 * `grayscale-password.test.tsx`. The form itself is `./password-field`,
 * shared with the owner-password field of five other tools.
 */

export { GRAYSCALE_PASSWORD_LABEL };

export const GRAYSCALE_PASSWORD_HINT =
  "Type the password that opens this PDF, or its owner password. It is checked here in your browser against the file itself and never uploaded.";

/**
 * For a file that opens WITHOUT a password (the restricted verdict): only its
 * owner password can change anything, so the hint asks for that one alone.
 */
export const GRAYSCALE_OWNER_PASSWORD_HINT =
  "This PDF opens without a password, so only its owner password helps here. It is checked here in your browser against the file itself and never uploaded.";

export const GRAYSCALE_WRONG_PASSWORD =
  "That password doesn't open this PDF. Nothing was changed.";

export const GRAYSCALE_UNSUPPORTED =
  "This PDF's encryption can't be opened in your browser. Unlock PDF can remove it with the password.";

export const GRAYSCALE_OPENED_NOTE =
  "Opened with its password, here in your browser. The grayscale copy is a new file without a password or encryption.";

export { withheldWords };

export function grayscaleWithheldMessage(permissions: PdfPermissions): string {
  return `This PDF's author doesn't allow ${withheldWords(permissions)}. The grayscale copy is a new file without encryption, so it can't keep those restrictions: it needs the owner password.`;
}

export function GrayscalePassword({
  file,
  opensWithoutPassword = false,
  onOpened,
}: {
  file: File;
  /** The refusal's verdict was "opens-without-password". */
  opensWithoutPassword?: boolean;
  onOpened: (pdf: LoadedPdf) => void;
}) {
  const check = async (typed: string): Promise<string | null> => {
    try {
      const [{ unlockForGrayscale }, bytes] = await Promise.all([
        import("./grayscale-unlock"),
        readFileBytes(file),
      ]);
      const result = await unlockForGrayscale(file, bytes, typed);
      if (result.kind === "opened") {
        onOpened(result.pdf);
        return null;
      }
      return result.kind === "wrong-password"
        ? GRAYSCALE_WRONG_PASSWORD
        : result.kind === "withheld"
          ? grayscaleWithheldMessage(result.permissions)
          : GRAYSCALE_UNSUPPORTED;
    } catch {
      return GRAYSCALE_UNSUPPORTED;
    }
  };

  return (
    <PasswordField
      label={GRAYSCALE_PASSWORD_LABEL}
      hint={
        opensWithoutPassword
          ? GRAYSCALE_OWNER_PASSWORD_HINT
          : GRAYSCALE_PASSWORD_HINT
      }
      button="Open with password"
      check={check}
      marker="data-grayscale-password"
    />
  );
}
