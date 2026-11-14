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
 *   - two entries whose data overlaps — one stored region declared as many
 *     files, each judged by the ratio below as if its bytes were its own:
 *     `unreadable` (`./zip-directory`, where the directory is read);
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
import {
  ZipEntryError,
  packedBytesOf,
  readZipDirectory,
  type ZipLimits,
  type ZipRefusal,
} from "./zip-directory";

// The directory half (no `node:zlib`) is its own module, so the browser
// judges a picked archive by the same code: re-exported, one definition.
export {
  ZipEntryError,
  type ZipLimits,
  type ZipRefusal,
} from "./zip-directory";

export const EPUB_ZIP_LIMITS: ZipLimits = {
  maxEntries: EPUB_MAX_ENTRIES,
  maxUnpackedBytes: EPUB_MAX_UNPACKED_BYTES,
  maxEntryRatio: EPUB_MAX_ENTRY_RATIO,
  ratioFloorBytes: EPUB_RATIO_FLOOR_BYTES,
};

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

/**
 * Open `bytes` as a ZIP within `limits` (EPUB's unless given), or say why
 * not. Nothing is inflated here: only the central directory is read
 * (`./zip-directory`, which also refuses entries that share their data).
 */
export function openBoundedZip(
  bytes: Uint8Array,
  limits: ZipLimits = EPUB_ZIP_LIMITS,
): { ok: true; zip: BoundedZip } | { ok: false; refusal: ZipRefusal } {
  const read = readZipDirectory(bytes, limits);
  if (!read.ok) return read;
  const { names, entries } = read.directory;

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
      const data = packedBytesOf(bytes, entry);
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
