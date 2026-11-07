import {
  permissionsFromP,
  type PdfPermissions,
} from "@/lib/jobs/pdf-permissions";
import { decryptDocument, openHandler, writePlain } from "./document";
import type { Authenticated } from "./standard-handler";

/**
 * An encrypted PDF opened with a password the person typed — decrypted in
 * the browser by the same handler Edit PDF uses, never uploaded. Says WHICH
 * password it was and what the author grants, so the tool can decide
 * whether what it is about to write would lift a restriction: a copy made
 * from `plain` carries no encryption at all.
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
    }
  /** Neither the open password nor the owner password. */
  | { kind: "wrong-password" }
  /** Not encrypted, damaged, or an encryption the handler does not read. */
  | { kind: "unsupported"; reason: string };

export async function openWithPassword(
  bytes: Uint8Array,
  password: string,
): Promise<PasswordOpenResult> {
  try {
    const { handler, xref } = await openHandler(bytes, password);
    if (!handler) return { kind: "wrong-password" };
    const doc = await decryptDocument(bytes, handler, xref);
    return {
      kind: "opened",
      plain: await writePlain(doc),
      as: handler.authenticatedAs,
      permissions: permissionsFromP(handler.effectiveP),
    };
  } catch (err) {
    return {
      kind: "unsupported",
      reason: err instanceof Error ? err.message : "unknown",
    };
  }
}
