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
 *     (above `ratioFloorBytes`): `bomb`;
 *   - when the caller sets `maxEntryBytes`, one file declared to unpack past
 *     it: `bomb` with limit `file`. HTML to PDF sets it, because every file
 *     of its archive is handed to Chromium whole; EPUB does not.
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
  /**
   * The most ONE file may unpack to, whatever its ratio; unset = no such
   * bound (EPUB, .xlsx). Judged on the declared size, which every inflate
   * is then capped at (`./zip.ts`), so no read can pass it.
   */
  maxEntryBytes?: number;
  /**
   * Read a `\` in an entry name as the `/` it stands for — what Windows
   * PowerShell 5.1's `Compress-Archive` writes — unless the archive also
   * holds that name spelled with `/` (then the `/` entry is the one served,
   * as the first of two names wins). Unset = names exactly as stored.
   */
  backslashSeparators?: boolean;
}

export type ZipRefusal =
  | { kind: "unreadable"; why: string }
  | {
      kind: "bomb";
      limit: "entries" | "unpacked" | "ratio" | "file";
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

/**
 * An entry name as its archiver meant it. General-purpose flag bit 11 set:
 * UTF-8 (APPNOTE 6.3.0, appendix D). Clear: the APPNOTE says IBM code page
 * 437, which is what Windows Explorer's "Compressed folder" writes — but
 * most other archivers write UTF-8 without setting the bit, so a name that
 * is valid UTF-8 is read as UTF-8 (pure ASCII reads alike either way) and
 * only one that is NOT is read as code page 437. Before 2026-11-14 every
 * name was read as UTF-8, so `Café.html` from Explorer became
 * `Caf�.html` and its page's links to `café_files/` matched nothing.
 */
export function decodeEntryName(raw: Uint8Array, flags: number): string {
  if ((flags & 0x0800) !== 0) return LENIENT_UTF8.decode(raw);
  try {
    return STRICT_UTF8.decode(raw);
  } catch {
    let out = "";
    for (const byte of raw)
      out += byte < 0x80 ? String.fromCharCode(byte) : CP437_HIGH[byte - 0x80];
    return out;
  }
}

const LENIENT_UTF8 = new TextDecoder("utf-8", { fatal: false });
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

/**
 * Code page 437's bytes 0x80-0xFF, as code points (generated from Python's
 * `cp437` codec; `zip-directory.test.ts` holds 0x82 as e-acute and the
 * table's length). Bytes below 0x80 are ASCII.
 */
const CP437_HIGH: readonly string[] = [
  0x00c7, 0x00fc, 0x00e9, 0x00e2, 0x00e4, 0x00e0, 0x00e5, 0x00e7, 0x00ea,
  0x00eb, 0x00e8, 0x00ef, 0x00ee, 0x00ec, 0x00c4, 0x00c5, 0x00c9, 0x00e6,
  0x00c6, 0x00f4, 0x00f6, 0x00f2, 0x00fb, 0x00f9, 0x00ff, 0x00d6, 0x00dc,
  0x00a2, 0x00a3, 0x00a5, 0x20a7, 0x0192, 0x00e1, 0x00ed, 0x00f3, 0x00fa,
  0x00f1, 0x00d1, 0x00aa, 0x00ba, 0x00bf, 0x2310, 0x00ac, 0x00bd, 0x00bc,
  0x00a1, 0x00ab, 0x00bb, 0x2591, 0x2592, 0x2593, 0x2502, 0x2524, 0x2561,
  0x2562, 0x2556, 0x2555, 0x2563, 0x2551, 0x2557, 0x255d, 0x255c, 0x255b,
  0x2510, 0x2514, 0x2534, 0x252c, 0x251c, 0x2500, 0x253c, 0x255e, 0x255f,
  0x255a, 0x2554, 0x2569, 0x2566, 0x2560, 0x2550, 0x256c, 0x2567, 0x2568,
  0x2564, 0x2565, 0x2559, 0x2558, 0x2552, 0x2553, 0x256b, 0x256a, 0x2518,
  0x250c, 0x2588, 0x2584, 0x258c, 0x2590, 0x2580, 0x03b1, 0x00df, 0x0393,
  0x03c0, 0x03a3, 0x03c3, 0x00b5, 0x03c4, 0x03a6, 0x0398, 0x03a9, 0x03b4,
  0x221e, 0x03c6, 0x03b5, 0x2229, 0x2261, 0x00b1, 0x2265, 0x2264, 0x2320,
  0x2321, 0x00f7, 0x2248, 0x00b0, 0x2219, 0x00b7, 0x221a, 0x207f, 0x00b2,
  0x25a0, 0x00a0,
].map((code) => String.fromCharCode(code));

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
  /** Every record, in directory order, duplicates of a name included. */
  const records: ZipDirectoryEntry[] = [];
  /** Every record's data region, at least: duplicates of a name included. */
  const regions: [start: number, end: number][] = [];
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
    const name = decodeEntryName(
      bytes.subarray(at + 46, at + 46 + nameLength),
      flags,
    );
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
    if (limits.maxEntryBytes !== undefined && unpacked > limits.maxEntryBytes)
      return {
        ok: false,
        refusal: {
          kind: "bomb",
          limit: "file",
          why: `${name} unpacks to ${unpacked} bytes, past ${limits.maxEntryBytes}`,
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
    const unixMode =
      madeBy >>> 8 === HOST_UNIX ? (external >>> 16) & S_IFMT : 0;
    records.push({
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
  // A `\` read as `/` only where no entry already has that `/` spelling:
  // the stored names are all known first, so the order of entries cannot
  // decide which of two spellings is served.
  const stored = new Set(records.map((r) => r.name));
  const entries = new Map<string, ZipDirectoryEntry>();
  const names: string[] = [];
  for (const record of records) {
    let name = record.name;
    if (limits.backslashSeparators && name.includes("\\")) {
      const slashed = name.replaceAll("\\", "/");
      if (!stored.has(slashed)) name = slashed;
    }
    if (entries.has(name)) continue;
    names.push(name);
    entries.set(name, {
      ...record,
      name,
      directory: record.directory || name.endsWith("/"),
    });
  }
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
