/**
 * The arithmetic the size guides print (audit #2, 2026-11-17).
 *
 * A leaf module: it imports only `./size-presets`, and `size-presets.ts`
 * gains no export, because both size panels' chunks read that module and a
 * new export there can change how it is concatenated into a first load.
 *
 * Every size on the site counts 1 KB as 1,024 bytes (`size-presets.ts`).
 * Some upload forms count 1 KB as 1,000 bytes and 1 MB as 1,000,000; these
 * two functions are what the guides tell a reader to type for such a form.
 * `size-targets.test.ts` holds them to a second, independent bound and to
 * values worked out by hand.
 */
import { KB, MB, SIZE_PRESETS, sizeLabel } from "./size-presets";

/** The bytes a form means by a label when it counts 1 KB as 1,000 and 1 MB as 1,000,000. */
export function decimalBytes(bytes: number): number {
  return bytes % MB === 0
    ? (bytes / MB) * 1_000_000
    : Math.round(bytes / KB) * 1_000;
}

/** The largest whole-KB value (1 KB = 1,024 bytes) still under that decimal size. */
export function portalSafeKb(bytes: number): number {
  return Math.floor(decimalBytes(bytes) / KB);
}

/**
 * Sizes the guides name that are NOT presets, so they are reached through
 * "Custom" (moved here from catalog.ts, which imports them):
 * 2 MB for both guides, 300 KB for the JPG guide.
 */
export const OFF_PRESET_BYTES = 2 * MB;
export const OFF_PRESET_SMALL_BYTES = 300 * KB;

/** "100 KB" -> "100kb": the spelling searchers type, and the `?size=` value. */
export const sizeSpelling = (label: string) =>
  label.replace(" ", "").toLowerCase();

const ascending = (sizes: readonly number[]) =>
  [...new Set(sizes)].sort((a, b) => a - b);

/**
 * The rows of each guide's size table, smallest first. The `?size=` links
 * accept exactly these sizes and nothing else: the table IS the allowlist.
 */
export const COMPRESS_TABLE_SIZES: readonly number[] = ascending([
  ...SIZE_PRESETS.map((p) => p.bytes),
  OFF_PRESET_BYTES,
]);
export const LIMIT_TABLE_SIZES: readonly number[] = ascending([
  ...SIZE_PRESETS.map((p) => p.bytes),
  OFF_PRESET_SMALL_BYTES,
  OFF_PRESET_BYTES,
]);

/** The query parameter a guide's link sets: `/tools/compress-pdf?size=200kb`. */
export const SIZE_PARAM = "size";

/**
 * The size a `?size=` link asks for, if and only if its value is one of
 * `allowed`'s spellings exactly (ignoring case and surrounding spaces).
 * Anything else, including a valid-looking "150kb", is null. There is no
 * number parsing, so a link can never put a value in a box that the box
 * would then warn about.
 */
export function parseSizeParam(
  search: string,
  allowed: readonly number[],
): number | null {
  const value = new URLSearchParams(search).get(SIZE_PARAM);
  if (value === null) return null;
  const wanted = value.trim().toLowerCase();
  return allowed.find((b) => sizeSpelling(sizeLabel(b)) === wanted) ?? null;
}
