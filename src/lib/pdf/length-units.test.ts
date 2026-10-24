import { describe, expect, it } from "vitest";
import {
  LENGTH_UNITS,
  formatLength,
  fromPoints,
  toPoints,
} from "./length-units";

describe("length units", () => {
  it("knows the published ratios: 72 pt to the inch, 25.4 mm to the inch", () => {
    expect(toPoints(1, "in")).toBe(72);
    expect(toPoints(25.4, "mm")).toBeCloseTo(72, 10);
    expect(fromPoints(72, "mm")).toBe(25.4);
    expect(fromPoints(36, "in")).toBe(0.5);
  });

  it("round-trips a typed value within the shown precision", () => {
    for (const unit of LENGTH_UNITS) {
      for (const typed of [0, 0.5, 3.2, 12.7, 100]) {
        expect(fromPoints(toPoints(typed, unit), unit)).toBeCloseTo(typed, 6);
      }
    }
  });

  it("formats with the unit, and the default 24 pt reads the same in pt", () => {
    expect(formatLength(24, "pt")).toBe("24 pt");
    expect(formatLength(24, "mm")).toBe("8.5 mm");
    expect(formatLength(24, "in")).toBe("0.33 in");
  });

  it("reads garbage as zero rather than NaN", () => {
    expect(toPoints(Number.NaN, "mm")).toBe(0);
  });
});
