import type { PDFContext, PDFDict, PDFObject, PDFRef } from "pdf-lib";
import { loadPdfLib, type PdfLibModule } from "../pdf-lib";
import { mapCrypt, type XrefInfo } from "./document";
import type { StandardSecurityHandler } from "./standard-handler";

/**
 * Write the changes made to a decrypted copy back onto the ORIGINAL file as
 * an incremental update (ISO 32000-1 §7.5.6) — the original bytes first,
 * untouched, then only the objects that changed, each encrypted with the
 * document's own key, a cross-reference section of the same kind as the
 * file's newest one, and a trailer carrying the original /Encrypt and /ID.
 *
 * That is how a viewer saves a form it was allowed to fill: the author's
 * encryption, permissions and owner password stay exactly as they were,
 * because not one byte of them is rewritten — they are not even read back.
 * pdf-lib cannot write an encrypted file, so the section is written here.
 *
 * WHAT CHANGED is decided by comparing objects, not by trusting the caller:
 * the plain copy and the edited copy are both parsed by pdf-lib and every
 * object of the edited copy that is new, or serialises differently, is
 * written. New objects get numbers above the original's /Size — never a
 * number the original uses for an object stream or its xref stream, which
 * the plain copy cannot see.
 *
 * And a property, not a promise: the update REFUSES to carry a page, the
 * page tree, or any stream a page draws as its content. Without the owner
 * password the author's "no changes to the page" is enforced here, below
 * every editor tool, so no tool can ship an edit the author did not allow.
 * The exceptions are the author's own: when /P grants "add or modify
 * annotations" (bit 6), a page dictionary whose /Annots is ALL that changed
 * may be rewritten — that is how a comment is attached to a page — and its
 * content streams stay refused (`restricted-comments.test.ts`). When it
 * grants "assemble the document" (bit 11, which names rotating pages), a
 * page dictionary whose /Rotate is all that changed may be rewritten too
 * (`restricted-rotate.test.ts`).
 *
 * UNENCRYPTED ORIGINALS (2026-11-08, audit sign-pdf#5). With `handler: null`
 * the same writer appends an edit to a file that is not encrypted at all —
 * the editor does it for a file that already carries certificate signatures,
 * so the bytes their /ByteRange covers survive (`../editor/append-update`).
 * Objects are then written as they are (their references renumbered like
 * any new object's), and no page is guarded: an unencrypted file has no
 * author's restrictions to enforce. The guard is tied to the handler, not to
 * a flag, so the encrypted path cannot be asked to skip it.
 */

export class RestrictedChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestrictedChangeError";
  }
}

function serialize(obj: PDFObject): Uint8Array {
  const out = new Uint8Array(obj.sizeInBytes());
  obj.copyBytesInto(out, 0);
  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

const latin1 = (s: string) =>
  Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

/** Object numbers a page uses for itself and for what it draws. */
function protectedNumbers(lib: PdfLibModule, context: PDFContext): Set<number> {
  const out = new Set<number>();
  const contentsOf = (page: PDFDict) => {
    const contents = page.get(lib.PDFName.of("Contents"));
    const refs =
      contents instanceof lib.PDFRef
        ? [contents]
        : contents instanceof lib.PDFArray
          ? contents.asArray()
          : [];
    for (const r of refs) {
      if (!(r instanceof lib.PDFRef)) continue;
      out.add(r.objectNumber);
      // `/Contents [..]` held by reference: the array object too.
      const inner = context.lookup(r);
      if (inner instanceof lib.PDFArray)
        for (const x of inner.asArray())
          if (x instanceof lib.PDFRef) out.add(x.objectNumber);
    }
  };
  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof lib.PDFDict)) continue;
    const type = obj.lookup(lib.PDFName.of("Type"));
    if (type === lib.PDFName.of("Page")) {
      out.add(ref.objectNumber);
      contentsOf(obj);
    } else if (type === lib.PDFName.of("Pages")) out.add(ref.objectNumber);
  }
  return out;
}

export interface IncrementalInput {
  /** The file as the author published it. */
  original: Uint8Array;
  /** The file's security handler; null for an unencrypted file. */
  handler: StandardSecurityHandler | null;
  xref: XrefInfo;
  /** The decrypted copy the editor opened (`writePlain`); unencrypted, the original itself. */
  plain: Uint8Array;
  /** The same copy after the edit (pdf-lib's save of `plain` + changes). */
  edited: Uint8Array;
  /**
   * The author grants "add or modify annotations" (/P bit 6): a page
   * dictionary may be rewritten when its /Annots is ALL that differs.
   * Its content streams stay guarded either way.
   */
  allowAnnotations?: boolean;
  /**
   * The author grants "assemble the document" (/P bit 11 — insert, rotate
   * or delete pages): a page dictionary may be rewritten when its /Rotate
   * is ALL that differs (with /Annots, when comments are granted too).
   */
  allowRotation?: boolean;
}

/**
 * Is `after` the page dictionary `before` with only the `keys` changed?
 * /Annots alone is an annotation change — what /P bit 6 allows; /Rotate
 * alone is a rotation — what bit 11 allows. Nothing else a page draws:
 * /Contents, /Resources and the boxes must serialise byte for byte as they
 * did, and so must any key the author's grant does not name.
 */
function onlyKeysDiffer(
  lib: PdfLibModule,
  before: PDFObject,
  after: PDFObject,
  keys: readonly string[],
): boolean {
  if (keys.length === 0) return false;
  if (!(before instanceof lib.PDFDict) || !(after instanceof lib.PDFDict))
    return false;
  const page = lib.PDFName.of("Page");
  const type = lib.PDFName.of("Type");
  if (before.get(type) !== page || after.get(type) !== page) return false;
  const strip = (d: PDFDict) => {
    const copy = d.clone();
    for (const key of keys) copy.delete(lib.PDFName.of(key));
    return serialize(copy);
  };
  return sameBytes(strip(before), strip(after));
}

/** `obj` with every reference passed through `remap`; nothing else changes. */
function remapRefs(
  lib: PdfLibModule,
  context: PDFContext,
  obj: PDFObject,
  remap: (ref: PDFRef) => PDFRef,
): PDFObject {
  if (obj instanceof lib.PDFRef) return remap(obj);
  if (obj instanceof lib.PDFArray) {
    const out = lib.PDFArray.withContext(context);
    for (const item of obj.asArray())
      out.push(remapRefs(lib, context, item, remap));
    return out;
  }
  if (obj instanceof lib.PDFStream) {
    const dict = remapRefs(lib, context, obj.dict, remap) as PDFDict;
    return lib.PDFRawStream.of(dict, obj.getContents());
  }
  if (obj instanceof lib.PDFDict) {
    const out = lib.PDFDict.withContext(context);
    for (const [key, value] of obj.entries())
      out.set(key, remapRefs(lib, context, value, remap));
    return out;
  }
  return obj;
}

export interface IncrementalResult {
  bytes: Uint8Array;
  /** Objects written: changed ones keep their number, new ones get one. */
  changed: number;
  added: number;
}

export async function writeIncrementalUpdate(
  input: IncrementalInput,
): Promise<IncrementalResult> {
  const lib = await loadPdfLib();
  const { original, handler, xref } = input;
  const parse = (b: Uint8Array) =>
    lib.PDFParser.forBytesWithOptions(b, Infinity, false).parseDocument();
  const before = await parse(input.plain);
  const after = await parse(input.edited);
  // An unencrypted file has no author's restrictions: nothing is guarded.
  const guarded = handler ? protectedNumbers(lib, before) : new Set<number>();
  // The page keys the author's grant lets an update rewrite.
  const granted = [
    ...(input.allowAnnotations ? ["Annots"] : []),
    ...(input.allowRotation ? ["Rotate"] : []),
  ];

  const changed: [PDFRef, PDFObject][] = [];
  const added: [PDFRef, PDFObject][] = [];
  for (const [ref, obj] of after.enumerateIndirectObjects()) {
    const old = before.lookup(ref);
    if (old === undefined) {
      added.push([ref, obj]);
    } else if (!sameBytes(serialize(old), serialize(obj))) {
      if (
        guarded.has(ref.objectNumber) &&
        !onlyKeysDiffer(lib, old, obj, granted)
      )
        throw new RestrictedChangeError(
          "This change would alter a page, and the PDF's author does not allow that without the owner password.",
        );
      changed.push([ref, obj]);
    }
  }

  const sizeOf = (d: PDFDict) => {
    const s = d.get(lib.PDFName.of("Size"));
    return s instanceof lib.PDFNumber ? s.asNumber() : 0;
  };
  let next = Math.max(sizeOf(xref.trailer), before.largestObjectNumber + 1);
  const fresh = new Map<string, PDFRef>();
  added.sort((a, b) => a[0].objectNumber - b[0].objectNumber);
  for (const [ref] of added) fresh.set(ref.tag, lib.PDFRef.of(next++, 0));
  const remap = (ref: PDFRef) => fresh.get(ref.tag) ?? ref;

  const parts: Uint8Array[] = [];
  let at = original.length;
  const last = original[original.length - 1];
  if (last !== 0x0a && last !== 0x0d) {
    parts.push(latin1("\n"));
    at += 1;
  }
  const offsets = new Map<number, { offset: number; gen: number }>();
  const write = (num: number, gen: number, body: Uint8Array) => {
    offsets.set(num, { offset: at, gen });
    const head = latin1(`${num} ${gen} obj\n`);
    const tail = latin1("\nendobj\n");
    parts.push(head, body, tail);
    at += head.length + body.length + tail.length;
  };

  for (const [ref, obj] of [...changed, ...added]) {
    const target = remap(ref);
    const body = handler
      ? await mapCrypt(
          lib,
          after,
          obj,
          handler.params,
          (kind, data) =>
            handler.encrypt(
              kind,
              target.objectNumber,
              target.generationNumber,
              data,
            ),
          remap,
        )
      : remapRefs(lib, after, obj, remap);
    write(target.objectNumber, target.generationNumber, serialize(body));
  }

  const get = (key: string) => xref.trailer.get(lib.PDFName.of(key));
  const remapped = (obj: PDFObject | undefined) =>
    obj instanceof lib.PDFRef ? remap(obj) : obj;
  const trailer = lib.PDFDict.withContext(after);
  const put = (key: string, value: PDFObject | undefined) => {
    if (value !== undefined) trailer.set(lib.PDFName.of(key), value);
  };
  put("Root", remapped(after.trailerInfo.Root) ?? get("Root"));
  put("Info", remapped(after.trailerInfo.Info) ?? get("Info"));
  // The author's, as they are: the very objects the original trailer holds.
  put("Encrypt", get("Encrypt"));
  put("ID", get("ID"));
  put("Prev", lib.PDFNumber.of(xref.startxref));

  const subsections = (nums: number[]) => {
    const sorted = [...nums].sort((a, b) => a - b);
    const out: [number, number[]][] = [];
    for (const n of sorted) {
      const tail = out[out.length - 1];
      if (tail && tail[0] + tail[1].length === n) tail[1].push(n);
      else out.push([n, [n]]);
    }
    return out;
  };

  if (xref.usesXrefStream) {
    const xrefNum = next++;
    const xrefOffset = at;
    offsets.set(xrefNum, { offset: xrefOffset, gen: 0 });
    const groups = subsections([...offsets.keys()]);
    const rows: number[] = [];
    for (const [, nums] of groups)
      for (const n of nums) {
        const { offset, gen } = offsets.get(n)!;
        rows.push(1, (offset >>> 24) & 0xff, (offset >>> 16) & 0xff);
        rows.push(
          (offset >>> 8) & 0xff,
          offset & 0xff,
          (gen >> 8) & 0xff,
          gen & 0xff,
        );
      }
    put("Type", lib.PDFName.of("XRef"));
    put("Size", lib.PDFNumber.of(next));
    put("W", after.obj([1, 4, 2]));
    put(
      "Index",
      after.obj(groups.flatMap(([first, nums]) => [first, nums.length])),
    );
    const stream = lib.PDFRawStream.of(trailer, Uint8Array.from(rows));
    const head = latin1(`${xrefNum} 0 obj\n`);
    const body = serialize(stream);
    parts.push(
      head,
      body,
      latin1(`\nendobj\nstartxref\n${xrefOffset}\n%%EOF\n`),
    );
  } else {
    put("Size", lib.PDFNumber.of(next));
    let table = "xref\n";
    for (const [first, nums] of subsections([...offsets.keys()])) {
      table += `${first} ${nums.length}\n`;
      for (const n of nums) {
        const { offset, gen } = offsets.get(n)!;
        table += `${String(offset).padStart(10, "0")} ${String(gen).padStart(5, "0")} n\r\n`;
      }
    }
    const xrefOffset = at;
    parts.push(latin1(table), latin1("trailer\n"), serialize(trailer));
    parts.push(latin1(`\nstartxref\n${xrefOffset}\n%%EOF\n`));
  }

  const total = original.length + parts.reduce((n, p) => n + p.length, 0);
  const bytes = new Uint8Array(total);
  bytes.set(original);
  let o = original.length;
  for (const p of parts) {
    bytes.set(p, o);
    o += p.length;
  }
  return { bytes, changed: changed.length, added: added.length };
}
