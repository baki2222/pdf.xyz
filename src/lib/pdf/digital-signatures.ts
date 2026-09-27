/**
 * How many digital (certificate) signatures a PDF already carries.
 *
 * WHY A TOOL NEEDS TO KNOW. A digital signature hashes the file's exact bytes
 * — the ranges its `/ByteRange` names. Every client tool that writes a PDF
 * saves through pdf-lib, which has no incremental-update writer: it rewrites
 * the whole file, so the signed bytes are gone and Acrobat reports the
 * signature as invalid ("the document has been altered"). The common case is
 * counter-signing a contract the other party signed through DocuSign or Adobe
 * Sign: the person adds their visual signature and sends back a file whose
 * counterparty signature no longer verifies. The runner warns before Run; this
 * is what it asks.
 *
 * HOW. A byte scan for `/ByteRange [a b c d]` — four integers, the shape only
 * a signature dictionary that has actually been signed carries:
 *
 *  - An unsigned signature FIELD (a `/FT /Sig` box waiting to be signed) has no
 *    value and so no signature dictionary: it is not counted, and nothing about
 *    it is invalidated by a rewrite.
 *  - A signature dictionary cannot sit in a compressed object stream: its
 *    `/ByteRange` names byte offsets in the file and its `/Contents` must be
 *    patched in place at one of them, so both are always literal bytes here.
 *  - Placeholders written before signing (`/ByteRange [0 /********** ...]`)
 *    fail the four-integer shape.
 *
 * Distinct arrays are counted, so a revision that re-writes the same signature
 * dictionary is one signature, not two. No parse, no pdf-lib: this runs on
 * every PDF a single-file tool opens and must not cost a second load, and
 * `doc.getForm()` would ADD an empty `/AcroForm` to a document it inspects.
 */

const SLASH = 0x2f;
const NAME = "ByteRange";
const NAME_CODES = Array.from(NAME, (c) => c.charCodeAt(0));
/** Enough for `/ByteRange [` + four 10-digit integers and generous spacing. */
const WINDOW = 96;
const ARRAY = /^\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/;

export function countDigitalSignatures(bytes: Uint8Array): number {
  const seen = new Set<string>();
  let at = bytes.indexOf(SLASH);
  while (at !== -1) {
    const start = at + 1;
    if (matchesName(bytes, start)) {
      const after = start + NAME_CODES.length;
      const tail = asciiWindow(bytes, after, WINDOW);
      const m = ARRAY.exec(tail);
      if (m) seen.add(`${m[1]} ${m[2]} ${m[3]} ${m[4]}`);
    }
    at = bytes.indexOf(SLASH, start);
  }
  return seen.size;
}

function matchesName(bytes: Uint8Array, from: number): boolean {
  if (from + NAME_CODES.length > bytes.length) return false;
  for (let i = 0; i < NAME_CODES.length; i += 1) {
    if (bytes[from + i] !== NAME_CODES[i]) return false;
  }
  // A longer name (`/ByteRangeX`) needs no check here: ARRAY is anchored, so
  // the regular character after the prefix fails it.
  return true;
}

function asciiWindow(bytes: Uint8Array, from: number, length: number): string {
  const end = Math.min(bytes.length, from + length);
  let out = "";
  for (let i = from; i < end; i += 1) out += String.fromCharCode(bytes[i]!);
  return out;
}
