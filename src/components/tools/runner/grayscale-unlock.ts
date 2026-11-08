import { countDigitalSignatures } from "@/lib/pdf/digital-signatures";
import {
  hasRestrictions,
  type PdfPermissions,
} from "@/lib/jobs/pdf-permissions";
import { openWithPassword } from "@/lib/pdf/security/open-with-password";
import { readPageBoard, type LoadedPdf } from "./use-single-pdf";

/**
 * Grayscale PDF's password path (audit grayscale-pdf#6), in its own chunk:
 * fetched only when someone types a password into the panel, so the page
 * never carries the security handler in its first load.
 *
 * The grayscale copy is a NEW file, rasterized, with no encryption at all.
 * So the password decides more than whether the file opens:
 *  - the OWNER password: every restriction is the person's to waive;
 *  - the OPEN password of a file whose author withholds nothing: the copy
 *    loses only the password the person typed;
 *  - the open password (or none) of a file whose author withholds
 *    something: the copy would lift those restrictions, so it is refused —
 *    the owner password is needed.
 */
export type GrayscaleUnlock =
  | { kind: "opened"; pdf: LoadedPdf }
  | { kind: "wrong-password" }
  | { kind: "withheld"; permissions: PdfPermissions }
  | { kind: "unsupported" };

export async function unlockForGrayscale(
  file: File,
  bytes: Uint8Array,
  password: string,
): Promise<GrayscaleUnlock> {
  const result = await openWithPassword(bytes, password);
  if (result.kind === "wrong-password") return result;
  if (result.kind === "unsupported") return { kind: "unsupported" };
  if (result.as !== "owner" && hasRestrictions(result.permissions))
    return { kind: "withheld", permissions: result.permissions };
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
      },
    };
  } catch {
    return { kind: "unsupported" };
  }
}
