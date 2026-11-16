/**
 * What the size guides tell a reader to type for a form that counts 1 KB as
 * 1,000 bytes (audit #2, 2026-11-17).
 *
 * `portalSafeKb` is checked three ways, none of which restates its formula:
 *  - a bound from BOTH sides: the value fits under the form's size, and one
 *    more KB would not, so it is the largest whole KB that fits;
 *  - a second bound from elsewhere: both Custom boxes accept the value;
 *  - values worked out by hand, before the function existed.
 * A wrong helper (`Math.ceil`) is run through the same bound as a control.
 */
import { describe, expect, it } from "vitest";
import { MIN_TARGET_BYTES } from "./compress-target";
import { MIN_LIMIT_BYTES } from "./image-size-limit";
import { KB, MB, SIZE_PRESETS } from "./size-presets";
import { decimalBytes, portalSafeKb } from "./size-targets";

/** Every size a guide names: the presets and the two off-preset sizes. */
const SIZES = [...SIZE_PRESETS.map((p) => p.bytes), 300 * KB, 2 * MB];

/** The sizes in `sizes` whose value is NOT the largest whole KB under the form's size. */
function boundProblems(
  safeKb: (bytes: number) => number,
  sizes: readonly number[],
): number[] {
  return sizes.filter(
    (b) =>
      !(
        safeKb(b) * KB < decimalBytes(b) &&
        (safeKb(b) + 1) * KB > decimalBytes(b)
      ),
  );
}

describe("portalSafeKb", () => {
  it("checks the sizes the guides name (health check)", () => {
    expect(SIZES).toHaveLength(6);
  });

  it("is the largest whole KB still under the form's size, for every size", () => {
    expect(boundProblems(portalSafeKb, SIZES)).toEqual([]);
  });

  it("a helper that rounds up fails that bound (positive control)", () => {
    const ceil = (b: number) => Math.ceil(decimalBytes(b) / KB);
    expect(boundProblems(ceil, [100 * KB])).toEqual([100 * KB]);
  });

  it("is a value both Custom boxes accept", () => {
    const floorKb = Math.max(MIN_TARGET_BYTES, MIN_LIMIT_BYTES) / KB;
    for (const b of SIZES)
      expect(portalSafeKb(b)).toBeGreaterThanOrEqual(floorKb);
  });

  it("matches the values worked out by hand", () => {
    expect(SIZES.map((b) => [b, portalSafeKb(b)])).toEqual([
      [100 * KB, 97],
      [200 * KB, 195],
      [500 * KB, 488],
      [MB, 976],
      [300 * KB, 292],
      [2 * MB, 1953],
    ]);
  });

  it("reads a whole MB as 1,000,000 bytes and a KB size as 1,000 a KB", () => {
    expect(decimalBytes(100 * KB)).toBe(100_000);
    expect(decimalBytes(2 * MB)).toBe(2_000_000);
  });
});
