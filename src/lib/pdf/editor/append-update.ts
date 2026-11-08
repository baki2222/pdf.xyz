import type { PDFDict, PDFObject } from "pdf-lib";
import { loadPdfLib, type PdfLibModule } from "../pdf-lib";
import { readXref } from "../security/document";
import { writeIncrementalUpdate } from "../security/incremental";
import type { Removal } from "./signed-edit";

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

/** How a signed file's edit was saved, and what that did to its signatures. */
export interface SignedSave {
  bytes: Uint8Array;
  /**
   * `appended`: the original bytes are an untouched prefix. `rewritten`:
   * the whole file was written again — because the edit takes something
   * out (`removes`: appended, it would stay in the earlier revision), or
   * because the file's cross-reference chain could not be read strictly
   * enough to append to (`unreadable`; pdf-lib opened it leniently).
   */
  mode: "appended" | "rewritten";
  reason?: "removes" | "unreadable";
  signatures: SignatureCheck;
}

/**
 * Save the edit of a certificate-signed, unencrypted file: appended when it
 * only adds or changes, rewritten when it removes (`./signed-edit`) or when
 * appending fails. The signature count is read back from the OUTPUT.
 */
export async function saveSignedEdit(
  original: Uint8Array,
  edited: Uint8Array,
  removals: readonly Removal[],
): Promise<SignedSave> {
  let bytes = edited;
  let mode: SignedSave["mode"] = "rewritten";
  let reason: SignedSave["reason"];
  if (removals.length > 0) {
    reason = "removes";
  } else {
    try {
      bytes = await appendEditsAsUpdate(original, edited);
      mode = "appended";
    } catch {
      reason = "unreadable";
    }
  }
  return {
    bytes,
    mode,
    ...(reason ? { reason } : {}),
    signatures: await signaturesKept(original, bytes),
  };
}

/** Signature fields with a signed value: `total` in the input, `kept` in the output. */
export interface SignatureCheck {
  total: number;
  kept: number;
}

/**
 * How many of the input's signatures the output still carries, as a
 * validator finds them: a signature field reachable from the CURRENT
 * revision's `/AcroForm /Fields` (through `/Kids`), whose `/V` has the same
 * `/ByteRange` and `/Contents` as in the input, and whose covered bytes are
 * identical in both files. A count of `/ByteRange`s cannot say this: a page
 * deletion leaves the signature dictionary in the file, unreferenced.
 */
export async function signaturesKept(
  original: Uint8Array,
  out: Uint8Array,
): Promise<SignatureCheck> {
  const lib = await loadPdfLib();
  const read = async (bytes: Uint8Array) => {
    try {
      return signatureValues(
        lib,
        await lib.PDFDocument.load(bytes, {
          ignoreEncryption: true,
          updateMetadata: false,
          throwOnInvalidObject: false,
        }),
      );
    } catch {
      return [];
    }
  };
  const before = await read(original);
  const after = new Set((await read(out)).map((s) => s.key));
  const kept = before.filter(
    (s) => after.has(s.key) && sameCovered(original, out, s.range),
  ).length;
  return { total: before.length, kept };
}

interface SignatureValue {
  key: string;
  range: number[];
}

function signatureValues(
  lib: PdfLibModule,
  doc: import("pdf-lib").PDFDocument,
): SignatureValue[] {
  const { PDFArray, PDFDict, PDFName, PDFNumber } = lib;
  const out: SignatureValue[] = [];
  const seen = new Set<PDFDict>();
  const form = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  const visit = (node: PDFObject | undefined, ft: PDFObject | undefined) => {
    const field = node ? doc.context.lookup(node) : undefined;
    if (!(field instanceof PDFDict) || seen.has(field)) return;
    seen.add(field);
    const type = field.get(PDFName.of("FT")) ?? ft;
    const value = field.lookup(PDFName.of("V"));
    if (type === PDFName.of("Sig") && value instanceof PDFDict) {
      const range = (value as PDFDict).lookup(PDFName.of("ByteRange"));
      const contents = (value as PDFDict).get(PDFName.of("Contents"));
      if (range instanceof PDFArray) {
        const nums = range
          .asArray()
          .map((n) => (n instanceof PDFNumber ? n.asNumber() : NaN));
        out.push({
          key: `${nums.join(" ")}|${contents?.toString() ?? ""}`,
          range: nums,
        });
      }
    }
    const kids = field.lookup(PDFName.of("Kids"));
    if (kids instanceof PDFArray)
      for (const k of kids.asArray()) visit(k, type);
  };
  const fields = form?.lookup(PDFName.of("Fields"));
  if (fields instanceof PDFArray)
    for (const f of fields.asArray()) visit(f, undefined);
  return out;
}

/** Are the bytes `range` covers identical in both files? */
function sameCovered(a: Uint8Array, b: Uint8Array, range: number[]): boolean {
  if (range.length < 2 || range.length % 2 !== 0) return false;
  for (let i = 0; i < range.length; i += 2) {
    const from = range[i]!;
    const len = range[i + 1]!;
    if (!Number.isInteger(from) || !Number.isInteger(len)) return false;
    if (from + len > a.length || from + len > b.length) return false;
    for (let j = from; j < from + len; j += 1) if (a[j] !== b[j]) return false;
  }
  return true;
}
