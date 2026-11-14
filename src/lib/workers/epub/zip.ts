/**
 * A BOUNDED reader for the ZIP an EPUB is: the central directory is read and
 * judged before a single byte is inflated, and every inflate is capped at the
 * size the directory declared for that file.
 *
 * Why not `jszip`: it inflates whatever it is asked to, at whatever size the
 * stream turns out to be. A ZIP bomb lies in its directory and is caught only
 * by a reader that refuses to inflate past the declared size, which
 * `inflateRawSync`'s `maxOutputLength` does exactly.
 *
 * What is refused, and where (each a {@link ZipRefusal} the engine words):
 *   - not a ZIP at all, or ZIP64 (no real EPUB needs it): `unreadable`;
 *   - more than {@link EPUB_MAX_ENTRIES} files, more than
 *     {@link EPUB_MAX_UNPACKED_BYTES} declared in total, or one file declared
 *     to grow more than {@link EPUB_MAX_ENTRY_RATIO}-fold: `bomb`, before any
 *     inflate;
 *   - a file that inflates past its declared size, or short of it: thrown as
 *     {@link ZipEntryError} when that file is read — the directory lied.
 *
 * SHARED, NOT COPIED. The limits are a parameter ({@link ZipLimits}), EPUB's
 * by default: HTML to PDF opens a ZIP of a web page through this same reader
 * with its own measured bounds (`../html-render/zip-config.ts`), and
 * `../office-conversion/xlsx-page-setup.ts` reads an .xlsx with EPUB's. The
 * directory also says which entries are folders and which are symbolic
 * links ({@link BoundedZip.isDirectory}, {@link BoundedZip.isSymlink}), so
 * a reader that serves entries can refuse both.
 */
import { inflateRawSync } from "node:zlib";
import {
  EPUB_MAX_ENTRIES,
  EPUB_MAX_ENTRY_RATIO,
  EPUB_MAX_UNPACKED_BYTES,
  EPUB_RATIO_FLOOR_BYTES,
} from "./native-config";

/** The four bounds a ZIP is judged by before anything is inflated. */
export interface ZipLimits {
  maxEntries: number;
  maxUnpackedBytes: number;
  maxEntryRatio: number;
  /** A file unpacking to no more than this is not judged by the ratio. */
  ratioFloorBytes: number;
}

export const EPUB_ZIP_LIMITS: ZipLimits = {
  maxEntries: EPUB_MAX_ENTRIES,
  maxUnpackedBytes: EPUB_MAX_UNPACKED_BYTES,
  maxEntryRatio: EPUB_MAX_ENTRY_RATIO,
  ratioFloorBytes: EPUB_RATIO_FLOOR_BYTES,
};

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

interface CentralEntry {
  name: string;
  method: number;
  encrypted: boolean;
  packed: number;
  unpacked: number;
  localOffset: number;
  directory: boolean;
  symlink: boolean;
}

export interface BoundedZip {
  /** Every entry name, in central-directory order. */
  readonly names: readonly string[];
  /** True when an entry of exactly this name exists. */
  has(name: string): boolean;
  /** True when the entry is encrypted at the ZIP level. */
  isEncrypted(name: string): boolean;
  /**
   * True when the entry is a folder: its name ends in `/`, or its external
   * attributes say so (MS-DOS's directory bit, or a Unix `S_IFDIR` mode).
   */
  isDirectory(name: string): boolean;
  /**
   * True when the entry is a symbolic link: made on Unix (the high byte of
   * "version made by" is 3) with an `S_IFLNK` mode. Its bytes are the link's
   * target path, never the file it names.
   */
  isSymlink(name: string): boolean;
  /** The entry's declared unpacked size, or null when there is none. */
  sizeOf(name: string): number | null;
  /** The entry's bytes, inflated within its declared size; null if absent. */
  read(name: string): Uint8Array | null;
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

/** Unix file-type bits of a mode, and the two types read here. */
const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;
/** "Version made by" host system 3: the external attributes hold a Unix mode. */
const HOST_UNIX = 3;
const DOS_DIRECTORY = 0x10;

/**
 * Open `bytes` as a ZIP within `limits` (EPUB's unless given), or say why
 * not. Nothing is inflated here: only the central directory is read.
 */
export function openBoundedZip(
  bytes: Uint8Array,
  limits: ZipLimits = EPUB_ZIP_LIMITS,
): { ok: true; zip: BoundedZip } | { ok: false; refusal: ZipRefusal } {
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
  const entries = new Map<string, CentralEntry>();
  const names: string[] = [];
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
    // The first of two entries with one name wins, as in most readers.
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

  const zip: BoundedZip = {
    names,
    has: (name) => entries.has(name),
    isEncrypted: (name) => entries.get(name)?.encrypted === true,
    isDirectory: (name) => entries.get(name)?.directory === true,
    isSymlink: (name) => entries.get(name)?.symlink === true,
    sizeOf: (name) => entries.get(name)?.unpacked ?? null,
    read(name) {
      const entry = entries.get(name);
      if (!entry) return null;
      if (entry.encrypted) throw new ZipEntryError(name, "encrypted");
      const local = entry.localOffset;
      if (local + 30 > bytes.length || u32(bytes, local) !== LOCAL)
        throw new ZipEntryError(name, "no local header");
      const start =
        local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
      if (start + entry.packed > bytes.length)
        throw new ZipEntryError(name, "truncated");
      const data = bytes.subarray(start, start + entry.packed);
      let out: Uint8Array;
      if (entry.method === 0) out = data;
      else if (entry.method === 8) {
        try {
          // Never past the declared size: the directory's figure is the one
          // the limits above were checked against.
          out = new Uint8Array(
            inflateRawSync(data, {
              maxOutputLength: Math.max(1, entry.unpacked),
            }),
          );
        } catch {
          throw new ZipEntryError(name, "inflates past its declared size");
        }
      } else
        throw new ZipEntryError(name, `compression method ${entry.method}`);
      if (out.byteLength !== entry.unpacked)
        throw new ZipEntryError(name, "size differs from the directory");
      return out;
    },
  };
  return { ok: true, zip };
}
