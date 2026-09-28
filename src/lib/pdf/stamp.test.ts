import { describe, expect, it } from "vitest";
import {
  applyTokens,
  clamp,
  normalizeRotation,
  placeCenteredStamp,
  placeStamp,
  resolveAlign,
  STAMP_POSITIONS,
} from "./stamp";

describe("resolveAlign", () => {
  it("splits every position into horizontal + vertical alignment", () => {
    expect(resolveAlign("bottom-center")).toEqual({ h: "center", v: "bottom" });
    expect(resolveAlign("top-left")).toEqual({ h: "left", v: "top" });
    expect(resolveAlign("middle-right")).toEqual({ h: "right", v: "middle" });
    expect(STAMP_POSITIONS).toHaveLength(9);
  });
});

describe("normalizeRotation", () => {
  it("snaps to the nearest quarter turn in [0, 360)", () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(90)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(44)).toBe(0);
    expect(normalizeRotation(46)).toBe(90);
  });
});

describe("clamp", () => {
  it("bounds values and defaults NaN to the minimum", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(20, 0, 10)).toBe(10);
    expect(clamp(Number.NaN, 2, 10)).toBe(2);
  });
});

describe("applyTokens", () => {
  it("substitutes n / total / date and their aliases", () => {
    expect(applyTokens("Page {n} of {total}", { n: 3, total: 10 })).toBe(
      "Page 3 of 10",
    );
    expect(applyTokens("{page}/{pages}", { n: 2, total: 7 })).toBe("2/7");
    expect(applyTokens("Printed {DATE}", { date: "2026-07-12" })).toBe(
      "Printed 2026-07-12",
    );
  });

  it("blanks missing values but leaves unknown braces intact", () => {
    expect(applyTokens("{n} — {date}", { n: 1 })).toBe("1 — ");
    expect(applyTokens("Chapter {title}", { n: 1 })).toBe("Chapter {title}");
  });
});

describe("placeStamp — unrotated pages", () => {
  const base = {
    box: { x: 0, y: 0, width: 600, height: 800 },
    pageRotation: 0,
    textWidth: 100,
    textHeight: 12,
    margin: 36,
  };

  it("centers a bottom-center footer", () => {
    const p = placeStamp({ ...base, h: "center", v: "bottom" });
    expect(p).toEqual({ x: 250, y: 36, rotate: 0 });
  });

  it("anchors a top-left header", () => {
    const p = placeStamp({ ...base, h: "left", v: "top" });
    // top baseline sits margin + textHeight below the top edge
    expect(p).toEqual({ x: 36, y: 800 - 36 - 12, rotate: 0 });
  });

  it("anchors a bottom-right stamp against the right margin", () => {
    const p = placeStamp({ ...base, h: "right", v: "bottom" });
    expect(p).toEqual({ x: 600 - 36 - 100, y: 36, rotate: 0 });
  });

  it("centers a middle-center stamp on both axes", () => {
    const p = placeStamp({ ...base, h: "center", v: "middle" });
    expect(p).toEqual({ x: 250, y: (800 - 12) / 2, rotate: 0 });
  });
});

describe("placeStamp — rotated pages keep the stamp in the visual frame", () => {
  const base = {
    box: { x: 0, y: 0, width: 600, height: 800 },
    textWidth: 100,
    textHeight: 12,
    margin: 36,
    h: "center" as const,
    v: "bottom" as const,
  };

  it("maps bottom-center through a 90° page", () => {
    // visual box is 800×600; bottom-center anchor (350, 36) → content (564, 350)
    const p = placeStamp({ ...base, pageRotation: 90 });
    expect(p).toEqual({ x: 600 - 36, y: 350, rotate: 90 });
  });

  it("maps bottom-center through a 180° page", () => {
    const p = placeStamp({ ...base, pageRotation: 180 });
    expect(p).toEqual({ x: 350, y: 800 - 36, rotate: 180 });
  });

  it("maps bottom-center through a 270° page", () => {
    const p = placeStamp({ ...base, pageRotation: 270 });
    expect(p).toEqual({ x: 36, y: 800 - 350, rotate: 270 });
  });
});

describe("placeCenteredStamp — watermarks", () => {
  const base = {
    box: { x: 0, y: 0, width: 600, height: 800 },
    textWidth: 200,
    textHeight: 60,
  };

  it("centers an untilted watermark on the page center", () => {
    const p = placeCenteredStamp({ ...base, pageRotation: 0, tilt: 0 });
    expect(p.rotate).toBe(0);
    // bounding-box center = anchor + (halfW, halfH) = page center
    expect(p.x + 100).toBeCloseTo(300, 6);
    expect(p.y + 30).toBeCloseTo(400, 6);
  });

  it("keeps the center invariant when tilted", () => {
    const tilt = 45;
    const p = placeCenteredStamp({ ...base, pageRotation: 0, tilt });
    const rad = (tilt * Math.PI) / 180;
    const cx = p.x + (100 * Math.cos(rad) - 30 * Math.sin(rad));
    const cy = p.y + (100 * Math.sin(rad) + 30 * Math.cos(rad));
    expect(cx).toBeCloseTo(300, 6);
    expect(cy).toBeCloseTo(400, 6);
    expect(p.rotate).toBe(45);
  });

  it("absorbs page rotation into the tilt so the visual angle is preserved", () => {
    const p = placeCenteredStamp({ ...base, pageRotation: 90, tilt: 45 });
    expect(p.rotate).toBe(135);
  });
});

describe("placement is relative to the VISIBLE box, origin included", () => {
  // A cropped page: CropBox [100 150 480 700] inside a Letter MediaBox. The
  // mapping happens within the box's own size and is THEN translated, so every
  // rotation is the zero-origin answer shifted by (100, 150) — the property,
  // stated against the zero-origin cases above rather than as new constants.
  const box = { x: 100, y: 150, width: 380, height: 550 };
  const at0 = { ...box, x: 0, y: 0 };
  const common = {
    textWidth: 40,
    textHeight: 9,
    margin: 30,
    h: "left" as const,
    v: "top" as const,
  };

  for (const pageRotation of [0, 90, 180, 270]) {
    it(`shifts a /Rotate ${pageRotation} stamp by exactly the box origin`, () => {
      const shifted = placeStamp({ ...common, box, pageRotation });
      const origin = placeStamp({ ...common, box: at0, pageRotation });
      expect(shifted).toEqual({
        x: origin.x + box.x,
        y: origin.y + box.y,
        rotate: origin.rotate,
      });
    });
  }

  it("keeps an unrotated top-left stamp at the margin from the VISIBLE corner", () => {
    const p = placeStamp({ ...common, box, pageRotation: 0 });
    expect(p).toEqual({ x: 100 + 30, y: 150 + 550 - 30 - 9, rotate: 0 });
  });

  it("centres a watermark on the visible box, not on the page", () => {
    const p = placeCenteredStamp({
      box,
      pageRotation: 0,
      tilt: 0,
      textWidth: 40,
      textHeight: 10,
    });
    expect(p.x + 20).toBeCloseTo(100 + 380 / 2, 6);
    expect(p.y + 5).toBeCloseTo(150 + 550 / 2, 6);
  });
});
