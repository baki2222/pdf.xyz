/**
 * Hand-made ZIP archives for tests of the bounded readers: shapes no
 * archiver writes (records that share one local header, two entries of one
 * name), which JSZip cannot be made to produce.
 */
/**
 * A ZIP written by hand, as no archiver would: an entry with `at` has NO
 * data of its own, and its directory record points at the named entry's
 * local header instead. Two files may share a name: each keeps its own
 * data, and `at` names the first. CRCs are zero; the reader does not check them.
 */
export function handZip(
  files: {
    name: string;
    data: Uint8Array;
    unpacked: number;
    method: 0 | 8;
    at?: string;
  }[],
): Uint8Array {
  const parts: Uint8Array[] = [];
  /** Each file's local header, by position; and by name, the first's. */
  const own: number[] = [];
  const offsets = new Map<string, number>();
  let size = 0;
  const push = (b: Uint8Array) => {
    parts.push(b);
    size += b.length;
  };
  const header = (sig: number, length: number) => {
    const b = new Uint8Array(length);
    new DataView(b.buffer).setUint32(0, sig, true);
    return b;
  };
  for (const [i, f] of files.entries()) {
    if (f.at) continue;
    const name = new TextEncoder().encode(f.name);
    const h = header(0x04034b50, 30);
    const v = new DataView(h.buffer);
    v.setUint16(8, f.method, true);
    v.setUint32(18, f.data.length, true);
    v.setUint32(22, f.unpacked, true);
    v.setUint16(26, name.length, true);
    own[i] = size;
    if (!offsets.has(f.name)) offsets.set(f.name, size);
    push(h);
    push(name);
    push(f.data);
  }
  const dirStart = size;
  for (const [i, f] of files.entries()) {
    const name = new TextEncoder().encode(f.name);
    const h = header(0x02014b50, 46);
    const v = new DataView(h.buffer);
    v.setUint16(10, f.method, true);
    v.setUint32(20, f.data.length, true);
    v.setUint32(24, f.unpacked, true);
    v.setUint16(28, name.length, true);
    v.setUint32(42, f.at ? offsets.get(f.at)! : own[i]!, true);
    push(h);
    push(name);
  }
  const end = header(0x06054b50, 22);
  const ev = new DataView(end.buffer);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, size - dirStart, true);
  ev.setUint32(16, dirStart, true);
  push(end);
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
