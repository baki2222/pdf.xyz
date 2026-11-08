/**
 * Fixtures for lane l02's regression tests that the matrix's builders
 * (`./security-in-browser.fixtures`) cannot express on their own.
 */
import {
  ONE_PAGE,
  ownerOnlyEncrypted,
  text,
  zeroBomb,
} from "./security-in-browser.fixtures";

/** Every `N 0 obj` header the builders wrote, by object number. */
export function objectOffsets(bytes: Uint8Array): Map<number, number> {
  const out = new Map<number, number>();
  for (const m of text(bytes).matchAll(/(?:^|\n)(\d+) 0 obj\n/g))
    out.set(Number(m[1]), m.index + (m[0].startsWith("\n") ? 1 : 0));
  return out;
}

/**
 * An owner-only R3 file whose PAGE (object 3) lives in an object stream that
 * inflates to `mebibytes` MiB of zeros: the xref says "object 3 is member 0 of
 * stream 5", and stream 5 is a FlateDecode zero bomb (sealed with RC4 like
 * every other stream, so only a decrypting reader meets the bomb).
 *
 * Built in two passes: the matrix's builder lays the file out, then the xref
 * stream body is rewritten (same row count, same length, so no offset moves)
 * to point object 3 into the bomb.
 */
export function objStmBombPdf(mebibytes: number): Uint8Array {
  const objects = [
    ...ONE_PAGE,
    {
      dict: "/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode",
      stream: zeroBomb(mebibytes),
    },
  ];
  const first = ownerOnlyEncrypted(objects, { layout: "stream" });
  const at = objectOffsets(first);
  // 1..4 the page objects, 5 the bomb, 6 /Encrypt, 7 the xref stream.
  const rows: [number, number, number][] = [[0, 0, 0xffff]];
  for (let n = 1; n <= 7; n += 1) {
    if (n === 3) rows.push([2, 5, 0]);
    else {
      const offset = at.get(n);
      if (offset === undefined) throw new Error(`no object ${n}`);
      rows.push([1, offset, 0]);
    }
  }
  const body = new Uint8Array(rows.length * 7);
  rows.forEach(([t, a, b], i) => {
    const v = new DataView(body.buffer, i * 7, 7);
    v.setUint8(0, t);
    v.setUint32(1, a);
    v.setUint16(5, b);
  });
  const second = ownerOnlyEncrypted(objects, {
    layout: "stream",
    xrefBody: body,
  });
  if (second.length !== first.length)
    throw new Error("the rewritten xref moved an offset");
  return second;
}
