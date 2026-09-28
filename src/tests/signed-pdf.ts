/**
 * Digitally-signed PDF fixtures, and the check a signature VALIDATOR makes.
 *
 * The fixtures are signed in structure, not in cryptography: each signature
 * dictionary has a real `/ByteRange` that covers the whole file except the
 * `/Contents` hole, computed from the saved bytes and patched in place — the
 * same two-pass dance a real signer does. The `/Contents` is zeros rather than
 * a PKCS#7 blob, so no viewer would call it VALID; that changes nothing about
 * the property under test: a validator hashes exactly the bytes `/ByteRange`
 * names, so a signature is still valid after a rewrite if and only if those
 * bytes are still there, in that order, around a `/Contents` hole
 * ({@link signedBytes}). Saved without object streams, because a signature
 * dictionary is never compressed: its offsets have to be literal.
 *
 * Two builders, one patcher ({@link patchByteRanges}):
 *
 *  - {@link makeSignedPdf} — every way a signature VALUE can sit in a file
 *    ({@link SignaturePlacement}), for the detection routes Compress counts.
 *  - {@link signedPdf} — `signatures` signed fields beside `unsignedFields`
 *    empty ones, on a Letter page, for the tools that warn before a rewrite.
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  type PDFRef,
} from "pdf-lib";

/** Where the signature VALUE lives, which is what each detection route sees. */
export type SignaturePlacement =
  /** The usual shape: field in /AcroForm /Fields, /V → indirect sig dict. */
  | "field"
  /** Signature dict exists, but no field lists it (seen after incremental updates). */
  | "orphan"
  /** Field in /Fields whose /V is a DIRECT dict with no /ByteRange. */
  | "direct-value"
  /** Field in /Fields with no /V: waiting to be signed, nothing to invalidate. */
  | "unsigned-field";

/** Fixed-width `/ByteRange` placeholder, patched after the save without moving a byte. */
const PLACEHOLDER = [1111111111, 2222222222, 3333333333];
const CONTENTS_HEX_CHARS = 1024;

export interface SignedPdfOptions {
  placement?: SignaturePlacement;
  /** How many signatures (each with its own field). Default 1. */
  count?: number;
}

export async function makeSignedPdf(
  opts: SignedPdfOptions = {},
): Promise<Uint8Array> {
  const placement = opts.placement ?? "field";
  const count = opts.count ?? 1;
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const ctx = doc.context;

  const fieldRefs: PDFRef[] = [];
  for (let i = 0; i < count; i++) {
    const sigDict = ctx.obj({
      Type: "Sig",
      Filter: "Adobe.PPKLite",
      SubFilter: "adbe.pkcs7.detached",
      ByteRange: [0, ...PLACEHOLDER],
      Contents: PDFHexString.of("0".repeat(CONTENTS_HEX_CHARS)),
      M: PDFString.of("D:20260927120000Z"),
    });
    const field = ctx.obj({
      Type: "Annot",
      Subtype: "Widget",
      FT: "Sig",
      T: PDFString.of(`Signature${i + 1}`),
      Rect: [0, 0, 0, 0],
      F: 132,
      P: page.ref,
    });
    if (placement === "field")
      field.set(PDFName.of("V"), ctx.register(sigDict));
    if (placement === "orphan") ctx.register(sigDict);
    if (placement === "direct-value") {
      field.set(
        PDFName.of("V"),
        ctx.obj({ Type: "Sig", Contents: PDFHexString.of("00") }),
      );
    }
    const ref = ctx.register(field);
    if (placement !== "orphan") fieldRefs.push(ref);
  }
  if (fieldRefs.length > 0) {
    page.node.set(PDFName.of("Annots"), ctx.obj(fieldRefs));
    doc.catalog.set(
      PDFName.of("AcroForm"),
      ctx.obj({ Fields: fieldRefs, SigFlags: PDFNumber.of(3) }),
    );
  }

  const bytes = await doc.save({ useObjectStreams: false });
  if (placement !== "field" && placement !== "orphan") return bytes;
  return patchByteRanges(bytes);
}

/**
 * A PDF laid out the way a certificate signer writes one: an `/AcroForm`
 * signature field whose value is a `/Sig` dictionary, with a `/Contents`
 * placeholder written as literal bytes and a `/ByteRange` that excludes exactly
 * that placeholder — patched in after the save, as a signer does.
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
        ByteRange: [0, ...PLACEHOLDER],
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
  return signatures > 0 ? patchByteRanges(bytes) : bytes;
}

/**
 * Replace every placeholder `/ByteRange` with the real one around its
 * `/Contents` hole, padded to the placeholder's width so no offset moves.
 */
function patchByteRanges(bytes: Uint8Array): Uint8Array {
  const text = Buffer.from(bytes).toString("latin1");
  const out = Uint8Array.from(bytes);
  // pdf-lib writes arrays with inner spaces: `[ 0 1 2 3 ]`.
  const placeholder = `[ 0 ${PLACEHOLDER.join(" ")} ]`;
  let from = 0;
  let patched = 0;
  for (;;) {
    const at = text.indexOf(placeholder, from);
    if (at < 0) break;
    // The /Contents hex string of the SAME dictionary follows its /ByteRange.
    const open = text.indexOf("<", text.indexOf("/Contents", at));
    const close = text.indexOf(">", open) + 1;
    const real = `[ 0 ${open} ${close} ${bytes.length - close}`;
    const padded = real.padEnd(placeholder.length - 1, " ") + "]";
    if (padded.length !== placeholder.length) {
      throw new Error(
        "signed-pdf fixture: /ByteRange wider than its placeholder",
      );
    }
    out.set(Buffer.from(padded, "latin1"), at);
    from = at + placeholder.length;
    patched++;
  }
  if (patched === 0)
    throw new Error("signed-pdf fixture: no /ByteRange to patch");
  return out;
}

/**
 * The bytes each signature covers, exactly as a validator reads them: parse
 * the file, take each signature dictionary's `/ByteRange`, and require that
 * the gap between the two ranges is a hex string and the second range ends at
 * end-of-file. `null` for a signature whose ranges no longer describe the file
 * — a validator reports that one as altered without hashing anything.
 */
export async function signedBytes(
  bytes: Uint8Array,
): Promise<(string | null)[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const out: (string | null)[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const range = obj.get(PDFName.of("ByteRange"));
    if (!(range instanceof PDFArray)) continue;
    const [a, b, c, d] = range
      .asArray()
      .map((n) => (n instanceof PDFNumber ? n.asNumber() : NaN));
    const ok =
      a === 0 &&
      b !== undefined &&
      c !== undefined &&
      d !== undefined &&
      bytes[b] === 0x3c /* < */ &&
      bytes[c - 1] === 0x3e /* > */ &&
      c + d === bytes.length;
    out.push(
      ok
        ? Buffer.concat([
            Buffer.from(bytes.subarray(0, b)),
            Buffer.from(bytes.subarray(c, c + d)),
          ]).toString("base64")
        : null,
    );
  }
  return out;
}

/** Every four-integer `/ByteRange` in the file, in file order — a byte scan, no parse. */
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
