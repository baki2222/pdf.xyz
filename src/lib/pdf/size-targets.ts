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
import { KB, MB } from "./size-presets";

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
