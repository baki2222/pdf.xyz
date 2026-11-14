/**
 * A ZIP's central directory, read and JUDGED without inflating anything —
 * the half of the bounded reader that needs no `node:zlib`, so the browser
 * judges a picked archive by the very code the worker does
 * (`../html-render/zip-inspect.ts`), and `./zip.ts` adds the capped inflate.
 *
 * What is refused here, each a {@link ZipRefusal}:
 *   - not a ZIP at all, or ZIP64: `unreadable`;
 *   - two entries whose data regions OVERLAP: `unreadable`. No archiver
 *     writes that, and it is how a small upload declares many large files
 *     over ONE stored region: each entry's growth is judged against its own
 *     declared packed size, so without this a region counted once could be
 *     unpacked eleven times (hostile review 2026-11-14: 84 KB declared and
 *     served 88 MiB, 1,090-fold, past every bound). With it, the packed sizes
 *     the ratio is judged against are DISJOINT bytes of the upload;
 *   - more than `maxEntries` files, more than `maxUnpackedBytes` declared in
 *     total, or one file declared to grow more than `maxEntryRatio`-fold
 *     (above `ratioFloorBytes`): `bomb`.
 *
 * The first of two entries with one name wins, as in most readers — and as
 * in the browser's check, which reads the same directory with this code.
 */

/** The four bounds a ZIP is judged by before anything is inflated. */
export interface ZipLimits {
  maxEntries: number;
  maxUnpackedBytes: number;
  maxEntryRatio: number;
  /** A file unpacking to no more than this is not judged by the ratio. */
  ratioFloorBytes: number;
}

export type ZipRefusal =
  | { kind: "unreadable"; why: string }
  | {
      kind: "bomb";
      limit: "entries" | "unpacked" | "ratio";
      why: string;
    };

export class ZipEntryError extends Error {
  constructor(
    readonly entry: string,
    why: string,
  ) {
    super(`${entry}: ${why}`);
    this.name = "ZipEntryError";
  }
}

export interface ZipDirectoryEntry {
  name: string;
  method: number;
  encrypted: boolean;
  packed: number;
  unpacked: number;
  localOffset: number;
  directory: boolean;
  symlink: boolean;
}

export interface ZipDirectory {
  /** Every entry name, in central-directory order (first of a name only). */
  names: string[];
  entries: Map<string, ZipDirectoryEntry>;
}

const u16 = (b: Uint8Array, i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
const u32 = (b: Uint8Array, i: number) =>
  ((b[i] ?? 0) |
    ((b[i + 1] ?? 0) << 8) |
    ((b[i + 2] ?? 0) << 16) |
    ((b[i + 3] ?? 0) << 24)) >>>
  0;

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
/** A local file header before its name and extra field. */
const LOCAL_HEADER_BYTES = 30;

/** Unix file-type bits of a mode, and the two types read here. */
const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;
/** "Version made by" host system 3: the external attributes hold a Unix mode. */
const HOST_UNIX = 3;
const DOS_DIRECTORY = 0x10;

/** Read and judge `bytes`' central directory within `limits`, or say why not. */
export function readZipDirectory(
  bytes: Uint8Array,
  limits: ZipLimits,
): { ok: true; directory: ZipDirectory } | { ok: false; refusal: ZipRefusal } {
  const floor = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= floor; i -= 1)
    if (u32(bytes, i) === EOCD) {
      eocd = i;
      break;
    }
  if (eocd < 0)
    return {
      ok: false,
      refusal: { kind: "unreadable", why: "no ZIP directory" },
    };
  const count = u16(bytes, eocd + 10);
  const dirOffset = u32(bytes, eocd + 16);
  if (count === 0xffff || dirOffset === 0xffffffff)
    return { ok: false, refusal: { kind: "unreadable", why: "ZIP64" } };
  if (count > limits.maxEntries)
    return {
      ok: false,
      refusal: {
        kind: "bomb",
        limit: "entries",
        why: `${count} files`,
      },
    };
  const entries = new Map<string, ZipDirectoryEntry>();
  const names: string[] = [];
  /** Every record's data region, at least: duplicates of a name included. */
  const regions: [start: number, end: number][] = [];
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let total = 0;
  let at = dirOffset;
  for (let n = 0; n < count; n += 1) {
    if (at + 46 > bytes.length || u32(bytes, at) !== CENTRAL)
      return {
        ok: false,
        refusal: { kind: "unreadable", why: "broken ZIP directory" },
      };
    const madeBy = u16(bytes, at + 4);
    const flags = u16(bytes, at + 8);
    const method = u16(bytes, at + 10);
    const packed = u32(bytes, at + 20);
    const unpacked = u32(bytes, at + 24);
    const nameLength = u16(bytes, at + 28);
    const skip = nameLength + u16(bytes, at + 30) + u16(bytes, at + 32);
    const external = u32(bytes, at + 38);
    const localOffset = u32(bytes, at + 42);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + skip;
    if (
      packed === 0xffffffff ||
      unpacked === 0xffffffff ||
      localOffset === 0xffffffff
    )
      return { ok: false, refusal: { kind: "unreadable", why: "ZIP64" } };
    // What the record occupies: its local header (as the LOCAL header
    // sizes its name and extra field, which is where a reader finds the
    // data) through its packed bytes. A header that is not there occupies
    // at least its fixed part; reading that entry fails on its own.
    regions.push([localOffset, dataStartOf(bytes, localOffset) + packed]);
    total += unpacked;
    if (total > limits.maxUnpackedBytes)
      return {
        ok: false,
        refusal: {
          kind: "bomb",
          limit: "unpacked",
          why: `more than ${limits.maxUnpackedBytes} bytes unpacked`,
        },
      };
    if (
      unpacked > limits.ratioFloorBytes &&
      unpacked > packed * limits.maxEntryRatio
    )
      return {
        ok: false,
        refusal: {
          kind: "bomb",
          limit: "ratio",
          why: `${name} grows ${packed === 0 ? "without bound" : `${Math.round(unpacked / packed)}-fold`}`,
        },
      };
    if (entries.has(name)) continue;
    names.push(name);
    const unixMode =
      madeBy >>> 8 === HOST_UNIX ? (external >>> 16) & S_IFMT : 0;
    entries.set(name, {
      name,
      method,
      encrypted: (flags & 0x01) !== 0,
      packed,
      unpacked,
      localOffset,
      directory:
        name.endsWith("/") ||
        (external & DOS_DIRECTORY) !== 0 ||
        unixMode === S_IFDIR,
      symlink: unixMode === S_IFLNK,
    });
  }
  regions.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < regions.length; i += 1)
    if (regions[i]![0] < regions[i - 1]![1])
      return {
        ok: false,
        refusal: { kind: "unreadable", why: "entries share their data" },
      };
  return { ok: true, directory: { names, entries } };
}

/** Where a local header's data begins (just past its fixed part when it is not a header). */
function dataStartOf(bytes: Uint8Array, local: number): number {
  if (local + LOCAL_HEADER_BYTES > bytes.length || u32(bytes, local) !== LOCAL)
    return local + LOCAL_HEADER_BYTES;
  return (
    local + LOCAL_HEADER_BYTES + u16(bytes, local + 26) + u16(bytes, local + 28)
  );
}

/**
 * An entry's packed bytes, exactly the size the directory declared, located
 * through its local header. Throws {@link ZipEntryError} when they are not
 * there: no header, or truncated.
 */
export function packedBytesOf(
  bytes: Uint8Array,
  entry: ZipDirectoryEntry,
): Uint8Array {
  const local = entry.localOffset;
  if (local + LOCAL_HEADER_BYTES > bytes.length || u32(bytes, local) !== LOCAL)
    throw new ZipEntryError(entry.name, "no local header");
  const start = dataStartOf(bytes, local);
  if (start + entry.packed > bytes.length)
    throw new ZipEntryError(entry.name, "truncated");
  return bytes.subarray(start, start + entry.packed);
}
