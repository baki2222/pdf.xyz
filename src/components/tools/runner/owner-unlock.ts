import { countDigitalSignatures } from "@/lib/pdf/digital-signatures";
import type { PdfPermissions } from "@/lib/jobs/pdf-permissions";
import { openForCopy } from "@/lib/pdf/security/open-with-password";
import { readPageBoard, type LoadedPdf } from "./use-single-pdf";

/**
 * The owner-password field's check (`./owner-password`), in its own chunk:
 * fetched only when someone submits a password under a restricted file's
 * refusal, so no tool page carries the security handler in its first load.
 *
 * The decision is not made here. It is `openForCopy`, the one rule Grayscale
 * PDF already used (`./grayscale-unlock`): only the OWNER password may lift
 * the author's restrictions (/P), so the open password of a file whose
 * author withholds something — or no password — is refused.
 *
 * The opened file carries its `protection`, unlocked by the owner password:
 * Rotate PDF writes the rotation back under the author's own encryption
 * through it, and Extract Images reads its grant from it. Merge PDF,
 * Extract Pages and Delete Pages use `bytes`, the decrypted copy, to build
 * their new file.
 *
 * The password is used and dropped: nothing here keeps, logs or sends it.
 */
export type OwnerUnlock =
  | { kind: "opened"; pdf: LoadedPdf }
  | { kind: "wrong-password" }
  | { kind: "withheld"; permissions: PdfPermissions }
  | { kind: "unsupported" };

export async function unlockWithOwnerPassword(
  file: File,
  bytes: Uint8Array,
  password: string,
): Promise<OwnerUnlock> {
  const result = await openForCopy(bytes, password);
  if (result.kind !== "opened") return result;
  try {
    const { pageCount, rotations } = await readPageBoard(
      result.plain,
      "pdf-lib",
    );
    return {
      kind: "opened",
      pdf: {
        file,
        bytes: result.plain,
        pageCount,
        rotations,
        digitalSignatures: countDigitalSignatures(result.plain),
        protection: result.pdf,
      },
    };
  } catch {
    return { kind: "unsupported" };
  }
}
