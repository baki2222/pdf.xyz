import { loadPdfLib } from "../pdf-lib";
import { readXref } from "../security/document";
import { writeIncrementalUpdate } from "../security/incremental";

/**
 * An edit of an UNENCRYPTED PDF, appended to it as an incremental update
 * (ISO 32000-1 §7.5.6) instead of the whole-file rewrite pdf-lib saves
 * (audit sign-pdf#5, 2026-11-08).
 *
 * WHY. A certificate signature hashes the exact bytes its /ByteRange names.
 * `exportEditedPdf` rewrites the file, so those bytes are gone and a viewer
 * reports the counterparty's signature as altered — the countersigning flow
 * Sign PDF exists for. Appended, the original bytes come first, untouched,
 * and only the objects the edit changed or added follow, so each earlier
 * signature still verifies for the revision it signed (a viewer will also
 * say the document changed after it was signed, which is true).
 *
 * `edited` is pdf-lib's save of `original` with the edit; what changed is
 * decided by comparing the two object by object (`writeIncrementalUpdate`,
 * the writer the restricted-PDF path already uses, with no handler).
 *
 * Feature-scoped and lazy: the editor's Apply imports it only for a file
 * that carries a digital signature.
 */
export async function appendEditsAsUpdate(
  original: Uint8Array,
  edited: Uint8Array,
): Promise<Uint8Array> {
  const lib = await loadPdfLib();
  const xref = await readXref(lib, original);
  const { bytes } = await writeIncrementalUpdate({
    original,
    handler: null,
    xref,
    plain: original,
    edited,
  });
  return bytes;
}
