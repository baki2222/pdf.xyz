import { describe, expect, it } from "vitest";
import { clampOutputTokens } from "./output-budget";

describe("clampOutputTokens", () => {
  it("sends the default when there is no override", () => {
    expect(clampOutputTokens(2000, undefined)).toBe(2000);
  });

  it("lets an override lower the default", () => {
    expect(clampOutputTokens(2000, 512)).toBe(512);
    expect(clampOutputTokens(2000, 1)).toBe(1);
  });

  it("never lets an override raise the default", () => {
    expect(clampOutputTokens(2000, 2001)).toBe(2000);
    expect(clampOutputTokens(2000, 1_000_000)).toBe(2000);
    expect(clampOutputTokens(2000, Number.POSITIVE_INFINITY)).toBe(2000);
  });

  it("ignores an override that is not a usable budget, rather than sending 0 or NaN", () => {
    // `Math.min(2000, 0)` is 0 and `Math.min(2000, NaN)` is NaN: the bare
    // `Math.min` this replaced would have sent either to the provider.
    for (const bad of [0, -1, 0.5, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(clampOutputTokens(2000, bad), `override ${bad}`).toBe(2000);
    }
  });

  it("floors a fractional override, since providers take whole tokens", () => {
    expect(clampOutputTokens(2000, 512.9)).toBe(512);
  });
});
