import {
  hasRestrictions,
  type PdfPermissions,
} from "@/lib/jobs/pdf-permissions";
import { ProtectedPdf } from "./protected-pdf";
import type { Authenticated } from "./standard-handler";

/**
 * An encrypted PDF opened with a password the person typed — decrypted in
 * the browser by `ProtectedPdf.open`, the opener Edit PDF uses, never
 * uploaded. Says WHICH password it was and what the author grants, so the
 * tool can decide whether what it is about to write would lift a
 * restriction: a copy made from `plain` carries no encryption at all.
 *
 * The password is used and dropped: nothing here keeps, logs or sends it.
 */
export type PasswordOpenResult =
  | {
      kind: "opened";
      /** The decrypted copy: no /Encrypt, object numbers as in the file. */
      plain: Uint8Array;
      /** "owner": every permission is the person's to waive. */
      as: Authenticated;
      /** What the author grants without the owner password. */
      permissions: PdfPermissions;
      /**
       * The file as opened: unlocked when `as` is "owner" — so a tool that
       * writes back under the author's encryption (Rotate PDF) can.
       */
      pdf: ProtectedPdf;
    }
  /** Neither the open password nor the owner password. */
  | { kind: "wrong-password" }
  /** Not encrypted, damaged, or an encryption the handler does not read. */
  | { kind: "unsupported"; reason: string };

export async function openWithPassword(
  bytes: Uint8Array,
  password: string,
): Promise<PasswordOpenResult> {
  // The same opener Edit PDF and the restricted-file tools use, with the
  // typed password in place of the empty one.
  const result = await ProtectedPdf.open(bytes, password);
  if (result.kind === "needs-password") return { kind: "wrong-password" };
  if (result.kind === "unsupported") return result;
  return {
    kind: "opened",
    plain: result.pdf.plain,
    as: result.pdf.authenticatedAs,
    permissions: result.pdf.permissions,
    pdf: result.pdf,
  };
}

/**
 * THE RULE (owner decision, competitor-audit backlog #11): a copy made from
 * a password-opened PDF never lifts a restriction its author set (/P)
 * unless the password typed was the OWNER password. The open password, or
 * none, opens a file whose author withholds something only to be refused
 * here — the copy would carry the pages without the restrictions.
 *
 * The ONE place that decision is made in the browser outside the editor:
 * Grayscale PDF (`grayscale-unlock.ts`) and the owner-password field of
 * Merge PDF, Extract Pages, Delete Pages, Rotate PDF and Extract Images
 * (`owner-unlock.ts`) all come through here. `owner-password-matrix.test.ts`
 * holds it over every tool × password kind × cipher.
 */
export type CopyOpenResult =
  | Extract<PasswordOpenResult, { kind: "opened" }>
  | { kind: "wrong-password" }
  /** It opened, but not as owner, and the author withholds something. */
  | { kind: "withheld"; permissions: PdfPermissions }
  | { kind: "unsupported" };

export async function openForCopy(
  bytes: Uint8Array,
  password: string,
): Promise<CopyOpenResult> {
  const result = await openWithPassword(bytes, password);
  if (result.kind === "wrong-password") return result;
  if (result.kind === "unsupported") return { kind: "unsupported" };
  if (result.as !== "owner" && hasRestrictions(result.permissions))
    return { kind: "withheld", permissions: result.permissions };
  return result;
}
