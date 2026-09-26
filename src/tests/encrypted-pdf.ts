/**
 * Really-encrypted PDF fixtures, for tests only.
 *
 * pdf-lib cannot write encryption, and the fixtures that stood in for it here
 * before this file were a bare `/Encrypt << /Filter /Standard /V 1 /R 2 >>`
 * bolted onto a plain document: enough to make pdf-lib refuse the file, and
 * nothing a real reader would open. That is fine for a test whose only question
 * is "does pdf-lib refuse it", and useless for the question the compress tool
 * has to answer — "can a reader open this WITHOUT a password?" — because the
 * answer for a stub is "no" whatever the owner meant.
 *
 * So this implements the Standard security handler, revision 3 (RC4, 128-bit;
 * ISO 32000-1 §7.6.3, algorithms 2, 3 and 5) over a pdf-lib document: every
 * string and stream is encrypted with its per-object key, and the /O and /U
 * entries are the real ones. The oracle that it is correct is not this file:
 * `encryption.test.ts` opens the output with pdf.js, which has its own
 * independent implementation of the same algorithms. A user-password fixture
 * that pdf.js opens without the password, or an owner-only one it refuses,
 * would fail there — so a bug here cannot quietly certify the code under test.
 *
 * Two layouts. The default writes a classic cross-reference table, where every
 * dictionary — the page tree included — is plaintext and only strings and
 * stream bodies are ciphertext. `objectStreams: true` writes what a modern
 * producer writes (PDF 1.5+): every non-stream object packed into ONE
 * encrypted object stream behind a cross-reference stream, so the catalog and
 * the page tree are ciphertext too. That is the shape pdf-lib cannot read even
 * with `ignoreEncryption` (it does not decrypt), and so the shape that breaks
 * any page count taken with pdf-lib. Until 2026-09-27 only the classic layout
 * existed, and it could not see the worker's page check fail on an encrypted
 * file: pdf-lib read the plaintext page tree. pdf-lib packs object streams at
 * save time, after any walk here could run, so this layout is serialised by
 * hand (ISO 32000-1 §7.5.7, §7.5.8); strings inside the packed objects are not
 * encrypted individually, because the stream that holds them is.
 */
import { createHash } from "node:crypto";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
  type PDFObject,
} from "pdf-lib";

/** ISO 32000-1 §7.6.3.3, the 32-byte password padding string. */
const PAD = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff,
  0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c,
  0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const KEY_BYTES = 16;

function md5(...parts: Uint8Array[]): Uint8Array {
  const h = createHash("md5");
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
}

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
    out[k] = data[k]! ^ s[(s[i]! + s[j]!) & 0xff]!;
  }
  return out;
}

function padPassword(password: string): Uint8Array {
  const bytes = new TextEncoder().encode(password).slice(0, 32);
  const out = new Uint8Array(32);
  out.set(bytes);
  out.set(PAD.subarray(0, 32 - bytes.length), bytes.length);
  return out;
}

/** RC4 with `key`, then 19 more passes with each byte XOR-ed by the pass index. */
function rc4Twenty(key: Uint8Array, data: Uint8Array): Uint8Array {
  let out = rc4(key, data);
  for (let pass = 1; pass <= 19; pass++) {
    out = rc4(
      key.map((b) => b ^ pass),
      out,
    );
  }
  return out;
}

function le32(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setInt32(0, n, true);
  return out;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface EncryptOptions {
  /** Password needed to OPEN the file. `""` means anyone can open it. */
  userPassword: string;
  /** Password that lifts the permission restrictions. */
  ownerPassword: string;
  /**
   * Permission bits (ISO 32000-1 Table 22). The default grants printing only,
   * which is the common "restricted" shape: opens freely, cannot be modified.
   */
  permissions?: number;
  /**
   * Pack every non-stream object (catalog and page tree included) into one
   * encrypted object stream, behind a cross-reference stream. See the file
   * header for why this layout exists.
   */
  objectStreams?: boolean;
}

/**
 * Encrypt `source` with the Standard security handler, R3/RC4-128, and return
 * the bytes. `source` is serialised and re-parsed first so every stream is a raw
 * stream whose bytes are final, and so the caller's document is left untouched.
 */
export async function encryptPdf(
  source: Uint8Array,
  opts: EncryptOptions,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(source, { updateMetadata: false });
  const ctx = doc.context;
  const permissions = opts.permissions ?? -3900; // print only; no modify/copy

  const id = md5(
    new TextEncoder().encode(`pdf.xyz fixture ${opts.ownerPassword}`),
  );

  // Algorithm 3: the /O value.
  let ownerKey = md5(padPassword(opts.ownerPassword || opts.userPassword));
  for (let i = 0; i < 50; i++) ownerKey = md5(ownerKey);
  const O = rc4Twenty(
    ownerKey.subarray(0, KEY_BYTES),
    padPassword(opts.userPassword),
  );

  // Algorithm 2: the file encryption key.
  let key = md5(padPassword(opts.userPassword), O, le32(permissions), id);
  for (let i = 0; i < 50; i++) key = md5(key.subarray(0, KEY_BYTES));
  key = key.subarray(0, KEY_BYTES);

  // Algorithm 5: the /U value (16 meaningful bytes + 16 of arbitrary padding).
  const U = new Uint8Array(32);
  U.set(rc4Twenty(key, md5(PAD, id)));
  U.set(PAD.subarray(0, 16), 16);

  const objectKey = (ref: PDFRef): Uint8Array => {
    const n = ref.objectNumber;
    const g = ref.generationNumber;
    const salt = Uint8Array.of(
      n & 0xff,
      (n >> 8) & 0xff,
      (n >> 16) & 0xff,
      g & 0xff,
      (g >> 8) & 0xff,
    );
    return md5(key, salt).subarray(0, Math.min(KEY_BYTES + 5, 16));
  };

  const encryptValue = (value: PDFObject, k: Uint8Array): PDFObject => {
    if (value instanceof PDFString || value instanceof PDFHexString) {
      return PDFHexString.of(toHex(rc4(k, value.asBytes())));
    }
    if (value instanceof PDFArray) {
      for (let i = 0; i < value.size(); i++)
        value.set(i, encryptValue(value.get(i), k));
      return value;
    }
    if (value instanceof PDFDict) {
      for (const [name, v] of value.entries())
        value.set(name, encryptValue(v, k));
      return value;
    }
    return value;
  };

  if (opts.objectStreams) {
    return writeObjectStreamLayout(doc, {
      objectKey,
      encryptValue,
      encryptDict: {
        V: 2,
        R: 3,
        Length: KEY_BYTES * 8,
        P: permissions,
        O: toHex(O),
        U: toHex(U),
      },
      id,
    });
  }

  let encrypted = 0;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    const k = objectKey(ref);
    if (obj instanceof PDFRawStream) {
      encryptValue(obj.dict, k);
      const cipher = rc4(k, obj.contents);
      ctx.assign(ref, PDFRawStream.of(obj.dict, cipher));
      encrypted++;
    } else {
      ctx.assign(ref, encryptValue(obj, k));
    }
  }
  // Health check: a document with no stream at all has no page content, so a
  // fixture that encrypted nothing is not the fixture anyone asked for.
  if (encrypted === 0) throw new Error("encryptPdf: no stream was encrypted");

  // Registered AFTER the walk: the Encrypt dictionary's own strings are never
  // encrypted (ISO 32000-1 §7.6.1).
  ctx.trailerInfo.Encrypt = ctx.register(
    ctx.obj({
      Filter: PDFName.of("Standard"),
      V: PDFNumber.of(2),
      R: PDFNumber.of(3),
      Length: PDFNumber.of(KEY_BYTES * 8),
      P: PDFNumber.of(permissions),
      O: PDFHexString.of(toHex(O)),
      U: PDFHexString.of(toHex(U)),
    }),
  );
  const idHex = PDFHexString.of(toHex(id));
  ctx.trailerInfo.ID = ctx.obj([idHex, idHex]);
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}

const latin1 = (text: string): Uint8Array =>
  Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);

/** A pdf-lib object's exact serialised bytes. */
function objectBytes(obj: PDFObject): Uint8Array {
  const out = new Uint8Array(obj.sizeInBytes());
  obj.copyBytesInto(out, 0);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Serialise `doc` as an encrypted PDF 1.5 file: stream objects stay top-level
 * (encrypted with their own keys), every other object goes into one object
 * stream whose body is encrypted as a whole, and a cross-reference stream —
 * never encrypted (§7.6.1) — indexes both. The encryption dictionary stays
 * top-level and in plaintext, as §7.5.7 requires.
 */
function writeObjectStreamLayout(
  doc: PDFDocument,
  crypto: {
    objectKey: (ref: PDFRef) => Uint8Array;
    encryptValue: (value: PDFObject, k: Uint8Array) => PDFObject;
    encryptDict: {
      V: number;
      R: number;
      Length: number;
      P: number;
      O: string;
      U: string;
    };
    id: Uint8Array;
  },
): Uint8Array {
  const ctx = doc.context;
  const streams: [PDFRef, PDFRawStream][] = [];
  const packed: [PDFRef, PDFObject][] = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (ref.generationNumber !== 0) {
      throw new Error("encryptPdf: object streams hold generation-0 objects");
    }
    if (obj instanceof PDFRawStream) streams.push([ref, obj]);
    else packed.push([ref, obj]);
  }
  // Health check: the point of this layout is a page tree in ciphertext. A walk
  // that packed nothing, or left no page content, is not that fixture.
  if (packed.length === 0 || streams.length === 0) {
    throw new Error("encryptPdf: nothing to pack into an object stream");
  }

  let next = ctx.largestObjectNumber + 1;
  const objStmRef = PDFRef.of(next++);
  const encryptRef = PDFRef.of(next++);
  const xrefNumber = next++;
  const size = next;

  // The object stream body: "num offset" pairs, then the objects themselves.
  const bodies = packed.map(([, obj]) => objectBytes(obj));
  const header: string[] = [];
  let offset = 0;
  packed.forEach(([ref], i) => {
    header.push(`${ref.objectNumber} ${offset}`);
    offset += bodies[i]!.length + 1;
  });
  const headerBytes = latin1(`${header.join(" ")}\n`);
  const plainObjStm = concat(
    [headerBytes].concat(bodies.flatMap((b) => [b, latin1("\n")])),
  );
  const cipherObjStm = rc4(crypto.objectKey(objStmRef), plainObjStm);

  const parts: Uint8Array[] = [latin1("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")];
  let cursor = parts[0]!.length;
  const offsets = new Map<number, number>();
  const emit = (objectNumber: number, bytes: Uint8Array) => {
    offsets.set(objectNumber, cursor);
    const wrapped = concat([
      latin1(`${objectNumber} 0 obj\n`),
      bytes,
      latin1("\nendobj\n"),
    ]);
    parts.push(wrapped);
    cursor += wrapped.length;
  };
  const streamBytes = (dict: PDFDict, body: Uint8Array) =>
    concat([
      objectBytes(dict),
      latin1("\nstream\n"),
      body,
      latin1("\nendstream"),
    ]);

  for (const [ref, stream] of streams) {
    const k = crypto.objectKey(ref);
    crypto.encryptValue(stream.dict, k);
    const cipher = rc4(k, stream.contents);
    stream.dict.set(PDFName.of("Length"), PDFNumber.of(cipher.length));
    emit(ref.objectNumber, streamBytes(stream.dict, cipher));
  }
  emit(
    objStmRef.objectNumber,
    streamBytes(
      ctx.obj({
        Type: "ObjStm",
        N: packed.length,
        First: headerBytes.length,
        Length: cipherObjStm.length,
      }),
      cipherObjStm,
    ),
  );
  const e = crypto.encryptDict;
  emit(
    encryptRef.objectNumber,
    objectBytes(
      ctx.obj({
        Filter: "Standard",
        V: e.V,
        R: e.R,
        Length: e.Length,
        P: e.P,
        O: PDFHexString.of(e.O),
        U: PDFHexString.of(e.U),
      }),
    ),
  );

  // The cross-reference stream: W [1 4 2] — type, offset or stream, index.
  const xrefOffset = cursor;
  const rows = new Uint8Array(size * 7);
  const view = new DataView(rows.buffer);
  const row = (n: number, type: number, field2: number, field3: number) => {
    rows[n * 7] = type;
    view.setUint32(n * 7 + 1, field2);
    view.setUint16(n * 7 + 5, field3);
  };
  row(0, 0, 0, 0xffff);
  packed.forEach(([ref], i) =>
    row(ref.objectNumber, 2, objStmRef.objectNumber, i),
  );
  for (const [n, at] of offsets) row(n, 1, at, 0);
  row(xrefNumber, 1, xrefOffset, 0);

  const idHex = PDFHexString.of(toHex(crypto.id));
  const xrefDict = ctx.obj({
    Type: "XRef",
    Size: size,
    W: [1, 4, 2],
    Length: rows.length,
  });
  xrefDict.set(PDFName.of("Root"), ctx.trailerInfo.Root as PDFRef);
  if (ctx.trailerInfo.Info) {
    xrefDict.set(PDFName.of("Info"), ctx.trailerInfo.Info as PDFRef);
  }
  xrefDict.set(PDFName.of("Encrypt"), encryptRef);
  xrefDict.set(PDFName.of("ID"), ctx.obj([idHex, idHex]));
  emit(xrefNumber, streamBytes(xrefDict, rows));
  parts.push(latin1(`startxref\n${xrefOffset}\n%%EOF\n`));
  return concat(parts);
}
