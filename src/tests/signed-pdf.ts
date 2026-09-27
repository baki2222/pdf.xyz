import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  type PDFRef,
} from "pdf-lib";

/**
 * A PDF laid out the way a certificate signer writes one: an `/AcroForm`
 * signature field whose value is a `/Sig` dictionary, with a `/Contents`
 * placeholder written as literal bytes and a `/ByteRange` that excludes exactly
 * that placeholder — patched in after the save, as a signer does.
 *
 * There is no real PKCS#7 blob in `/Contents` (zeros), so no viewer would call
 * it VALID; every structural fact a detector or a rewrite can touch is real,
 * which is what the tests using it need. Saved without object streams, because
 * a signature dictionary is never compressed: its offsets have to be literal.
 *
 * `signatures` signed fields and `unsignedFields` empty ones (a `/FT /Sig`
 * widget with no `/V` — a box waiting for someone to sign).
 */
export async function signedPdf(
  opts: { signatures?: number; unsignedFields?: number } = {},
): Promise<Uint8Array> {
  const { signatures = 1, unsignedFields = 0 } = opts;
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const ctx = doc.context;
  const fields: PDFRef[] = [];

  const widget = (name: string, value?: PDFRef): PDFRef =>
    ctx.register(
      ctx.obj({
        Type: "Annot",
        Subtype: "Widget",
        FT: "Sig",
        T: PDFString.of(name),
        Rect: [0, 0, 0, 0],
        F: 132,
        P: page.ref,
        ...(value ? { V: value } : {}),
      }),
    );

  for (let i = 0; i < signatures; i += 1) {
    const sig = ctx.register(
      ctx.obj({
        Type: "Sig",
        Filter: "Adobe.PPKLite",
        SubFilter: "adbe.pkcs7.detached",
        // Fixed-width placeholders, patched below without moving a byte.
        ByteRange: [0, placeholder(i, 1), placeholder(i, 2), placeholder(i, 3)],
        Contents: PDFHexString.of("0".repeat(512)),
        M: PDFString.of("D:20260901120000Z"),
      }),
    );
    fields.push(widget(`Signature${i + 1}`, sig));
  }
  for (let i = 0; i < unsignedFields; i += 1) {
    fields.push(widget(`Unsigned${i + 1}`));
  }

  page.node.set(PDFName.of("Annots"), ctx.obj(fields));
  if (fields.length > 0) {
    const acroForm = ctx.obj({
      Fields: fields,
      SigFlags: signatures > 0 ? 3 : 0,
    });
    doc.catalog.set(PDFName.of("AcroForm"), ctx.register(acroForm));
  }

  const bytes = await doc.save({ useObjectStreams: false });
  return patchByteRanges(bytes, signatures);
}

/** A 10-digit integer unique to signature `i`, slot `k`. */
function placeholder(i: number, k: number): number {
  return Number(`${k}${String(i).padStart(9, "0")}`);
}

/**
 * Replace each placeholder `/ByteRange` with the real ranges around the
 * `/Contents` string that follows it, padded to the same width.
 */
function patchByteRanges(bytes: Uint8Array, signatures: number): Uint8Array {
  const text = Buffer.from(bytes).toString("latin1");
  let out = text;
  for (let i = 0; i < signatures; i += 1) {
    // pdf-lib writes arrays with inner spaces: `[ 0 1 2 3 ]`.
    const ph = `[ 0 ${placeholder(i, 1)} ${placeholder(i, 2)} ${placeholder(i, 3)} ]`;
    const at = out.indexOf(ph);
    if (at === -1) throw new Error(`fixture: ByteRange ${i} not written`);
    const open = out.indexOf("/Contents <", at) + "/Contents ".length;
    const close = out.indexOf(">", open) + 1;
    const real = `[0 ${open} ${close} ${out.length - close}]`;
    if (real.length > ph.length) throw new Error("fixture: range too wide");
    out =
      out.slice(0, at) +
      real.padEnd(ph.length, " ") +
      out.slice(at + ph.length);
  }
  return new Uint8Array(Buffer.from(out, "latin1"));
}

/** Every four-integer `/ByteRange` in the file, in file order. */
export function signedRanges(
  bytes: Uint8Array,
): [number, number, number, number][] {
  const text = Buffer.from(bytes).toString("latin1");
  const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  return [...text.matchAll(re)].map(
    (m) =>
      [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as [
        number,
        number,
        number,
        number,
      ],
  );
}

/** The bytes a signature over `range` covers — what its digest is taken of. */
export function hashedBytes(
  bytes: Uint8Array,
  [a, b, c, d]: [number, number, number, number],
): Uint8Array {
  const out = new Uint8Array(b + d);
  out.set(bytes.subarray(a, a + b), 0);
  out.set(bytes.subarray(c, c + d), b);
  return out;
}
