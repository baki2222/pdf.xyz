// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  compositeOver,
  contrastRatio,
  isLargeText,
  parseColor,
  relativeLuminance,
  requiredRatioAA,
} from "./contrast";

/**
 * WOULD THIS BE GREEN IF THE MATH WERE WRONG? The anchors below are not
 * self-generated: black-on-white is 21:1 and mid-grey `#767676` on white is
 * 4.54:1 by the WCAG definition itself, and `#777` on white is 4.48:1 — the
 * pair either side of the AA threshold that the W3C's own understanding
 * document uses. A luminance formula with the sRGB linearisation dropped, or
 * with the 0.05 flare term missing, misses both.
 */

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

describe("relativeLuminance", () => {
  it("anchors at the ends of the range", () => {
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 10);
    expect(relativeLuminance(BLACK)).toBeCloseTo(0, 10);
  });

  it("applies the sRGB transfer curve, not a linear ramp", () => {
    // Mid grey is ~21.6% luminance, not 50%. A linear ramp would say 0.5.
    expect(relativeLuminance({ r: 128, g: 128, b: 128 })).toBeCloseTo(0.2159, 4);
  });

  it("uses the below-knee linear segment for very dark channels", () => {
    // 10/255 = 0.0392 < 0.03928, so it divides by 12.92 rather than raising to 2.4.
    expect(relativeLuminance({ r: 10, g: 10, b: 10 })).toBeCloseTo(
      0.0030352,
      6,
    );
  });
});

describe("contrastRatio", () => {
  it("is 21:1 for black on white and symmetric", () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 6);
    expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(21, 6);
  });

  it("is 1:1 for a colour against itself", () => {
    expect(contrastRatio({ r: 99, g: 44, b: 200 }, { r: 99, g: 44, b: 200 })).toBe(
      1,
    );
  });

  it("straddles the AA threshold exactly where the W3C says it does", () => {
    expect(contrastRatio({ r: 118, g: 118, b: 118 }, WHITE)).toBeCloseTo(4.54, 2);
    expect(contrastRatio({ r: 119, g: 119, b: 119 }, WHITE)).toBeCloseTo(4.48, 2);
  });

  it("decreases as the background lightens, under light-on-dark", () => {
    // This monotonicity is what licenses a single worst-case background
    // measurement to stand in for every darker one.
    const text = { r: 148, g: 163, b: 184 }; // slate-400
    const ratios = [0, 16, 32, 48].map((v) =>
      contrastRatio(text, { r: v, g: v, b: v + 10 }),
    );
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i] ?? 0).toBeLessThan(ratios[i - 1] ?? 0);
    }
  });
});

describe("parseColor", () => {
  it("reads the shapes a browser emits", () => {
    expect(parseColor("rgb(1, 2, 3)")).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseColor("rgba(1, 2, 3, 0.5)")).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
    expect(parseColor("rgb(1 2 3 / 50%)")).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
    expect(parseColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("reads hex in all four lengths", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#64748b")).toEqual({ r: 100, g: 116, b: 139, a: 1 });
    expect(parseColor("#0006")).toEqual({ r: 0, g: 0, b: 0, a: 102 / 255 });
    expect(parseColor("#64748b80")).toEqual({
      r: 100,
      g: 116,
      b: 139,
      a: 128 / 255,
    });
  });

  it("returns null rather than a plausible guess for anything else", () => {
    // A parser that fell back to black would make every unreadable colour look
    // like maximum contrast against this app's dark background.
    expect(parseColor("color-mix(in oklab, red, blue)")).toBeNull();
    expect(parseColor("currentColor")).toBeNull();
    expect(parseColor("rgb(1, 2)")).toBeNull();
  });
});

describe("compositeOver", () => {
  it("returns the backdrop at alpha 0 and the top colour at alpha 1", () => {
    const backdrop = { r: 6, g: 6, b: 17 };
    expect(compositeOver({ r: 255, g: 255, b: 255, a: 0 }, backdrop)).toEqual(
      backdrop,
    );
    expect(compositeOver({ r: 255, g: 255, b: 255, a: 1 }, backdrop)).toEqual({
      r: 255,
      g: 255,
      b: 255,
    });
  });

  it("mixes linearly in sRGB space, the way the compositor does", () => {
    expect(
      compositeOver({ r: 255, g: 255, b: 255, a: 0.1 }, { r: 6, g: 6, b: 17 }),
    ).toEqual({ r: 30.9, g: 30.9, b: 40.8 });
  });
});

describe("requiredRatioAA", () => {
  it("holds normal text to 4.5 and large text to 3", () => {
    expect(requiredRatioAA(14, 400)).toBe(4.5);
    expect(requiredRatioAA(24, 400)).toBe(3);
    expect(requiredRatioAA(18.66, 700)).toBe(3);
  });

  it("does not let bold alone downgrade small text", () => {
    // 14px bold is not "large" — 14pt bold is, and 14pt is 18.66px.
    expect(isLargeText(14, 700)).toBe(false);
    expect(requiredRatioAA(14, 700)).toBe(4.5);
  });
});
