import { describe, expect, it } from "vitest";
import { formatBytes, formatSignedBytes } from "./utils";

/*
 * Compare PDF's "Size delta" tile printed `formatBytes(Math.abs(delta))` with a
 * "+" only when the delta was non-negative — so a second file 1.2 MB SMALLER
 * showed "1.2 MB", which reads as growth, while the report beside it printed a
 * negative byte count.
 */
describe("formatSignedBytes", () => {
  const magnitudes = [1, 512, 1536, 1_258_291, 5 * 1024 ** 3];

  it("a negative delta carries a minus sign (U+2212) and the same magnitude", () => {
    for (const bytes of magnitudes) {
      expect(formatSignedBytes(-bytes)).toBe(`\u2212${formatBytes(bytes)}`);
    }
    expect(formatSignedBytes(-1_258_291)).toBe("\u22121.2 MB");
  });

  it("control: a positive delta carries a plus sign", () => {
    for (const bytes of magnitudes) {
      expect(formatSignedBytes(bytes)).toBe(`+${formatBytes(bytes)}`);
    }
  });

  it("zero is unsigned", () => {
    expect(formatSignedBytes(0)).toBe("0 B");
  });

  it("opposite deltas never render the same", () => {
    for (const bytes of magnitudes) {
      expect(formatSignedBytes(-bytes)).not.toBe(formatSignedBytes(bytes));
    }
  });
});
