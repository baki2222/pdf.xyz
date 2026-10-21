// @vitest-environment node
import { describe, expect, it } from "vitest";
import { unwrapAngle } from "./unwrapped-angle";

/**
 * M25: a page tile turns the short way. Its rotation is stored as 0, 90, 180
 * or 270, and a CSS transition from `rotate(270deg)` to `rotate(0deg)` spins
 * the sheet three quarters BACKWARDS after a press of "Right". The angle drawn
 * is unwrapped instead: the stored angle's nearest equivalent to what is shown.
 */
describe("unwrapAngle", () => {
  it("a quarter turn right from 270° is drawn at 360°, not back at 0°", () => {
    expect(unwrapAngle(270, 0)).toBe(360);
  });

  it("left from 0° is −90°, and further turns keep winding the same way", () => {
    expect(unwrapAngle(0, 270)).toBe(-90);
    expect(unwrapAngle(-90, 180)).toBe(-180);
    expect(unwrapAngle(360, 90)).toBe(450);
  });

  it("an unchanged angle stays where it is drawn, however wound", () => {
    expect(unwrapAngle(720, 0)).toBe(720);
    expect(unwrapAngle(-450, 270)).toBe(-450);
  });

  it("a half turn has no short way, and always goes clockwise", () => {
    expect(unwrapAngle(0, 180)).toBe(180);
    expect(unwrapAngle(180, 0)).toBe(360);
  });

  it("positive control: every result is the stored angle, mod 360", () => {
    for (const prev of [-450, -90, 0, 90, 270, 360, 810])
      for (const next of [0, 90, 180, 270]) {
        const shown = unwrapAngle(prev, next);
        expect(((shown % 360) + 360) % 360).toBe(next);
        expect(Math.abs(shown - prev)).toBeLessThanOrEqual(180);
      }
  });
});
