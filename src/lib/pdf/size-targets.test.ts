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
import {
  COMPRESS_TABLE_SIZES,
  LIMIT_TABLE_SIZES,
  OFF_PRESET_BYTES,
  OFF_PRESET_SMALL_BYTES,
  SIZE_PARAM,
  decimalBytes,
  parseSizeParam,
  portalSafeKb,
  sizeSpelling,
} from "./size-targets";
import { sizeLabel } from "./size-presets";

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

/**
 * The `?size=` links the size guides carry (audit #2, PR part 2). The parser
 * is an allowlist: the table's own sizes, spelled as the table spells them,
 * and nothing else, so a mistyped or hand-made link sets nothing.
 */
describe("parseSizeParam", () => {
  const q = (value: string) => `?${SIZE_PARAM}=${value}`;

  it("lists the table rows, smallest first (health check)", () => {
    expect(COMPRESS_TABLE_SIZES.map(sizeLabel)).toEqual([
      "100 KB",
      "200 KB",
      "500 KB",
      "1 MB",
      "2 MB",
    ]);
    expect(LIMIT_TABLE_SIZES.map(sizeLabel)).toEqual([
      "100 KB",
      "200 KB",
      "300 KB",
      "500 KB",
      "1 MB",
      "2 MB",
    ]);
  });

  it.each([
    ["compress", COMPRESS_TABLE_SIZES],
    ["limit", LIMIT_TABLE_SIZES],
  ] as const)(
    "every %s row's own spelling comes back as its bytes",
    (_n, list) => {
      for (const b of list)
        expect(parseSizeParam(q(sizeSpelling(sizeLabel(b))), list)).toBe(b);
    },
  );

  it("ignores case and the spaces around the value", () => {
    expect(parseSizeParam(q("2MB%20"), COMPRESS_TABLE_SIZES)).toBe(2 * MB);
    expect(parseSizeParam(q("200KB"), COMPRESS_TABLE_SIZES)).toBe(200 * KB);
  });

  it.each([
    ["a size not in the table", q("150kb")],
    ["zero", q("0kb")],
    ["a number in another notation", q("1e3kb")],
    ["a space inside", q("200%20kb")],
    ["a plus inside (a space in a query)", q("200+kb")],
    ["an empty value", q("")],
    ["no value at all", ""],
    ["another parameter", "?tool=200kb"],
    ["junk", q("junk")],
  ])("%s sets nothing", (_name, search) => {
    expect(parseSizeParam(search, COMPRESS_TABLE_SIZES)).toBeNull();
  });

  it("reads the first value when the parameter is given twice", () => {
    expect(
      parseSizeParam(`${q("150kb")}&${q("200kb")}`, COMPRESS_TABLE_SIZES),
    ).toBeNull();
    expect(
      parseSizeParam(`${q("200kb")}&${q("150kb")}`, COMPRESS_TABLE_SIZES),
    ).toBe(200 * KB);
  });

  it("300 KB is a JPG row only: Compress PDF's list does not take it", () => {
    expect(parseSizeParam(q("300kb"), COMPRESS_TABLE_SIZES)).toBeNull();
    expect(parseSizeParam(q("300kb"), LIMIT_TABLE_SIZES)).toBe(300 * KB);
  });

  it("the off-preset sizes are NOT presets (if one becomes one, the 'Custom, then type' cells and FAQs must be rewritten)", () => {
    const presets = SIZE_PRESETS.map((p) => p.bytes);
    expect(presets).not.toContain(OFF_PRESET_BYTES);
    expect(presets).not.toContain(OFF_PRESET_SMALL_BYTES);
  });

  it("spells sizes the way the existing keywords do", () => {
    expect(sizeSpelling(sizeLabel(100 * KB))).toBe("100kb");
    expect(sizeSpelling(sizeLabel(MB))).toBe("1mb");
  });
});
