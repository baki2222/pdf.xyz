import { describe, expect, it } from "vitest";
import { luminancePlane } from "@/lib/pdf/render";
import {
  ADDED_RGB,
  AREA_TOLERANCE,
  MAX_REGIONS,
  MAX_SHIFT_PX,
  NO_SHIFT,
  REMOVED_RGB,
  TOLERANCE,
  bestShift,
  compositeInto,
  describePlace,
  diffPlanes,
  onDot,
  onHatch,
  type Plane,
  type Region,
  type VisualDiff,
} from "./visual-diff";

/**
 * The Overlay's pure half on synthetic planes (S3, 2026-11-15). Every
 * pixel assertion is relative to the drawing's own ink: the only typed
 * counts are 0 and ≥ 1, so a renderer drawing text thinner (Linux CI)
 * cannot move a threshold here. The composed chain through pdf.js is
 * `runner/compare/visual-render.native.test.ts`.
 */

function blank(w: number, h: number): Plane {
  return { w, h, data: new Uint8Array(w * h).fill(255) };
}

function copy(p: Plane): Plane {
  return { w: p.w, h: p.h, data: p.data.slice() };
}

/** Paint a filled rectangle of luminance `lum`. */
function rect(p: Plane, x: number, y: number, w: number, h: number, lum = 0) {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++)
      if (xx >= 0 && yy >= 0 && xx < p.w && yy < p.h)
        p.data[yy * p.w + xx] = lum;
  return p;
}

/**
 * A page of "text": lines 26 px apart (12 pt leading at 150 dpi) of short
 * strokes `stroke` px thick, spaced irregularly as glyphs are (seeded), so
 * no shift but the true one lines the page up with itself.
 */
function textPage(w: number, h: number, stroke: number, ox = 0, oy = 0): Plane {
  const p = blank(w, h);
  let s = 11;
  const rnd = () => (s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32;
  for (let y = 30; y < h - 30; y += 26)
    for (let x = 30; x < w - 40; x += 6 + Math.floor(rnd() * 7)) {
      rect(p, x + ox, y + oy, stroke, 8 + Math.floor(rnd() * 5)); // a stem
      rect(p, x + ox, y + 12 + oy, 4, stroke); // a foot
    }
  return p;
}

/** Ink pixels of a plane: darker than the tolerance. */
function ink(p: Plane): number {
  let n = 0;
  for (const v of p.data) if (255 - v > TOLERANCE) n++;
  return n;
}

/** Seeded blocks, so a shift has exactly one best answer. */
function texture(w: number, h: number, seed: number, margin = 24): Plane {
  const p = blank(w, h);
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32;
  for (let i = 0; i < 90; i++)
    rect(
      p,
      margin + Math.floor(rnd() * (w - 2 * margin - 12)),
      margin + Math.floor(rnd() * (h - 2 * margin - 12)),
      2 + Math.floor(rnd() * 10),
      2 + Math.floor(rnd() * 10),
      Math.floor(rnd() * 80),
    );
  return p;
}

/** `p` with its content moved by (dx, dy): out(x + dx, y + dy) = p(x, y). */
function moved(p: Plane, dx: number, dy: number): Plane {
  const out = blank(p.w, p.h);
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx >= 0 && ty >= 0 && tx < p.w && ty < p.h)
        out.data[ty * p.w + tx] = p.data[y * p.w + x]!;
    }
  return out;
}

function iou(a: Region[], box: { x: number; y: number; w: number; h: number }) {
  // Union of the regions' boxes against one box, by pixel.
  let inter = 0;
  let union = 0;
  const x0 = Math.min(box.x, ...a.map((r) => r.x));
  const y0 = Math.min(box.y, ...a.map((r) => r.y));
  const x1 = Math.max(box.x + box.w, ...a.map((r) => r.x + r.w));
  const y1 = Math.max(box.y + box.h, ...a.map((r) => r.y + r.h));
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const inR = a.some(
        (r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h,
      );
      const inB =
        x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
      if (inR && inB) inter++;
      if (inR || inB) union++;
    }
  return union === 0 ? 0 : inter / union;
}

const STAMP = { x: 120, y: 60, w: 64, h: 32 };

/** The stamp property, as a predicate a stub can be run through. */
function seesStamp(diff: (L: Plane, R: Plane) => VisualDiff): boolean {
  const base = textPage(320, 240, 2);
  const stamped = rect(copy(base), STAMP.x, STAMP.y, STAMP.w, STAMP.h, 40);
  const d = diff(base, stamped);
  return (
    d.regions.length >= 1 &&
    d.regions.every((r) => r.kind === "added") &&
    iou(d.regions, STAMP) >= 0.8
  );
}

describe("diffPlanes", () => {
  it("stub health: a diff that finds nothing fails the stamp property", () => {
    const stub = (L: Plane, R: Plane): VisualDiff => ({
      ...diffPlanes(L, R),
      regions: [],
    });
    expect(seesStamp(stub)).toBe(false);
    expect(seesStamp((L, R) => diffPlanes(L, R))).toBe(true);
  });

  it("an identical pair has no region", () => {
    const p = textPage(320, 240, 2);
    expect(ink(p)).toBeGreaterThan(0);
    const d = diffPlanes(p, copy(p));
    expect(d.regions).toHaveLength(0);
    expect(d.sizeDiffers).toBe(false);
    expect(d.blank).toBe(false);
  });

  for (const stroke of [1, 2])
    it(`1 px of jitter in any of 8 directions is no region (${stroke} px strokes)`, () => {
      const base = textPage(320, 240, stroke);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ] as const) {
        const other = textPage(320, 240, stroke, dx, dy);
        // Health: the two drawings really differ, pixel for pixel.
        expect(other.data).not.toEqual(base.data);
        expect(diffPlanes(base, other).regions, `${dx},${dy}`).toHaveLength(0);
        // And alignment does not turn jitter into a reported shift.
        expect(bestShift(base, other), `${dx},${dy}`).toEqual(NO_SHIFT);
      }
    });

  it("a stamp is one added region over it; the mirror is removed", () => {
    expect(seesStamp((L, R) => diffPlanes(L, R))).toBe(true);
    const base = textPage(320, 240, 2);
    const stamped = rect(copy(base), STAMP.x, STAMP.y, STAMP.w, STAMP.h, 40);
    const mirror = diffPlanes(stamped, base);
    expect(mirror.regions.length).toBeGreaterThanOrEqual(1);
    expect(mirror.regions.every((r) => r.kind === "removed")).toBe(true);
    expect(iou(mirror.regions, STAMP)).toBeGreaterThanOrEqual(0.8);
  });

  // INVERTED 2026-11-15 (review r1, finding 1). This test used to read
  // "one step above it is seen, at it is not": a 30 × 30 block at darkness
  // TOLERANCE (48 of 255) on white was pinned as NO region. That pinned the
  // defect: a pale stamp, a yellow highlight and a red logo turned blue are
  // all changes under 48 in luma over a large area, and each drew the
  // "No differences visible" sentence. The per-pixel test still stops at
  // TOLERANCE; the area test (AREA_TOLERANCE, mean darkness per cell) now
  // sees the same block, and its own threshold is the strict one.
  it("a block at the per-pixel tolerance is seen by the area test; the area threshold is strict", () => {
    const base = blank(160, 120);
    const atPixel = rect(blank(160, 120), 40, 40, 30, 30, 255 - TOLERANCE);
    expect(diffPlanes(base, atPixel).regions.length).toBeGreaterThanOrEqual(1);
    const above = rect(
      blank(160, 120),
      40,
      40,
      30,
      30,
      255 - (AREA_TOLERANCE + 1),
    );
    const at = rect(blank(160, 120), 40, 40, 30, 30, 255 - AREA_TOLERANCE);
    expect(diffPlanes(base, above).regions.length).toBeGreaterThanOrEqual(1);
    expect(
      diffPlanes(base, above).regions.every((r) => r.kind === "added"),
    ).toBe(true);
    expect(diffPlanes(base, at).regions).toHaveLength(0);
  });

  it("a recolour that keeps the shape is one changed region (red to blue: luma 76 to 29)", () => {
    // Both sides are inked, and no pixel differs by more than TOLERANCE.
    const red = rect(textPage(320, 240, 2), 120, 60, 80, 40, 76);
    const blue = rect(textPage(320, 240, 2), 120, 60, 80, 40, 29);
    expect(76 - 29).toBeLessThan(TOLERANCE);
    const d = diffPlanes(red, blue);
    expect(d.regions).toHaveLength(1);
    expect(d.regions[0]!.kind, JSON.stringify(d.regions)).toBe("changed");
    // Measured: 80 × 32 of the 80 × 40 block. A cell the block only partly
    // covers holds its edge, and the windows a pixel either way absorb an
    // edge's move: a tone change is marked where it covers whole cells.
    expect(
      iou(d.regions, { x: 120, y: 60, w: 80, h: 40 }),
    ).toBeGreaterThanOrEqual(0.75);
    // The bitsets carry it too, so the overlay paints it.
    expect(d.onlyR.some((b) => b !== 0)).toBe(true);
  });

  it("a pale stamp over text and a highlight bar are added regions", () => {
    const base = textPage(320, 240, 2);
    // A pale stamp, darkness 38 (a 0.85 grey): under TOLERANCE.
    const stamp = copy(base);
    for (let y = 40; y < 120; y++)
      for (let x = 60; x < 260; x++)
        if ((x - 60) % 40 < 24)
          stamp.data[y * 320 + x] = Math.min(stamp.data[y * 320 + x]!, 217);
    const ds = diffPlanes(base, stamp);
    expect(ds.regions.length).toBeGreaterThanOrEqual(1);
    expect(ds.regions.some((r) => r.kind !== "removed")).toBe(true);
    // A highlight, darkness 29 (pure yellow's luma is 226), over one line.
    const lit = copy(base);
    for (let y = 26; y < 50; y++)
      for (let x = 20; x < 300; x++)
        lit.data[y * 320 + x] = Math.min(lit.data[y * 320 + x]!, 226);
    expect(diffPlanes(base, lit).regions.length).toBeGreaterThanOrEqual(1);
    // Two pages of pale colour only, darkness 12 against 30: not "blank".
    const paleY = rect(blank(200, 160), 20, 20, 160, 120, 243);
    const paleB = rect(blank(200, 160), 20, 20, 160, 120, 225);
    const dp = diffPlanes(paleY, paleB);
    expect(dp.regions.length).toBeGreaterThanOrEqual(1);
  });

  it("scope probe: thin strokes recoloured within TOLERANCE are not seen (the stated limit)", () => {
    // 1 px rules turned from red to blue, each on a cell's edge: a pixel
    // either way takes the rule out of its cell, so the windows' range
    // holds both means, and no pixel moves by more than TOLERANCE. Real
    // text turned red to blue is marked in some cells and not others
    // (measured through pdf.js, 2026-11-15), so the copy says "may be missed".
    const rules = (lum: number) => {
      const p = blank(160, 120);
      for (let x = 7; x < 160; x += 16) rect(p, x, 20, 1, 80, lum);
      return p;
    };
    expect(diffPlanes(rules(76), rules(29)).regions).toHaveLength(0);
    // Control: the same rules removed are seen.
    expect(
      diffPlanes(rules(76), blank(160, 120)).regions.length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("half a pixel of jitter on a pale block's edges is no region (the area test's windows)", () => {
    for (const dark of [20, 40, 47]) {
      const L = rect(blank(200, 120), 40, 30, 80, 50, 255 - dark);
      const R = rect(blank(200, 120), 41, 30, 79, 50, 255 - dark);
      // Anti-aliased edges: half coverage on the columns the edge crosses.
      rect(R, 40, 30, 1, 50, 255 - Math.round(dark / 2));
      rect(R, 120, 30, 1, 50, 255 - Math.round(dark / 2));
      expect(R.data).not.toEqual(L.data);
      expect(diffPlanes(L, R).regions, `darkness ${dark}`).toHaveLength(0);
    }
  });

  it(`500 specks keep the ${MAX_REGIONS} largest and say so`, () => {
    // 32 px apart: four cells, so no two specks' grown cells touch.
    const p = blank(25 * 32, 20 * 32);
    let biggest = { x: 0, y: 0 };
    for (let i = 0; i < 500; i++) {
      const x = (i % 25) * 32 + 4;
      const y = Math.floor(i / 25) * 32 + 4;
      const size = i === 317 ? 6 : 2 + (i % 2);
      if (i === 317) biggest = { x, y };
      rect(p, x, y, size, size);
    }
    const d = diffPlanes(blank(p.w, p.h), p);
    expect(d.regions).toHaveLength(MAX_REGIONS);
    expect(d.capped).toBe(true);
    expect(
      d.regions.some(
        (r) =>
          biggest.x >= r.x &&
          biggest.x < r.x + r.w &&
          biggest.y >= r.y &&
          biggest.y < r.y + r.h,
      ),
    ).toBe(true);
    // Health: fewer specks than the cap are every one kept, uncapped.
    const few = blank(p.w, p.h);
    for (let i = 0; i < 10; i++) rect(few, i * 32 + 4, 4, 3, 3);
    const d10 = diffPlanes(blank(p.w, p.h), few);
    expect(d10.regions).toHaveLength(10);
    expect(d10.capped).toBe(false);
  });

  it("a 1 px speck is below the resolution limit: no region", () => {
    const speck = rect(blank(160, 120), 80, 60, 1, 1);
    expect(diffPlanes(blank(160, 120), speck).regions).toHaveLength(0);
    // Positive control: a 2 × 2 speck (4 px, past CELL_MIN_PX) is seen.
    const four = rect(blank(160, 120), 80, 60, 2, 2);
    expect(diffPlanes(blank(160, 120), four).regions).toHaveLength(1);
  });

  it("a page 20 px wider is a size difference, with a region over its extra strip", () => {
    const L = textPage(300, 240, 2);
    const R = blank(320, 240);
    R.data.set([]);
    for (let y = 0; y < 240; y++)
      for (let x = 0; x < 300; x++) R.data[y * 320 + x] = L.data[y * 300 + x]!;
    rect(R, 304, 40, 12, 160); // ink in the strip only PDF 2 has
    const d = diffPlanes(L, R);
    expect(d.sizeDiffers).toBe(true);
    expect(d.w).toBe(320);
    expect(d.regions.length).toBeGreaterThanOrEqual(1);
    expect(d.regions.some((r) => r.x + r.w > 300 && r.kind === "added")).toBe(
      true,
    );
    // A one-pixel difference in size is not one.
    expect(diffPlanes(blank(300, 240), blank(301, 241)).sizeDiffers).toBe(
      false,
    );
  });

  it("scope probe: a hue change at equal lightness is no region (it compares luminance)", () => {
    // (255, 0, 0) and (0, 130, 0) have the same Rec. 601 luma, 76.
    const rgba = (r: number, g: number, b: number) => {
      const data = new Uint8ClampedArray(120 * 80 * 4).fill(255);
      for (let y = 20; y < 60; y++)
        for (let x = 30; x < 90; x++) {
          const i = (y * 120 + x) * 4;
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
        }
      return { w: 120, h: 80, data: luminancePlane(data) };
    };
    const red = rgba(255, 0, 0);
    const green = rgba(0, 130, 0);
    expect(red.data).toEqual(green.data);
    expect(diffPlanes(red, green).regions).toHaveLength(0);
    // Positive control: a change of lightness at the same place is seen.
    expect(
      diffPlanes(red, rgba(0, 0, 0)).regions.length,
    ).toBeGreaterThanOrEqual(1);
    // And a SMALL change of lightness (red to blue, 76 to 29 in luma, under
    // TOLERANCE): unseen before 2026-11-15 (review r1), seen by the area test.
    expect(
      diffPlanes(red, rgba(0, 0, 255)).regions.length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("a blank pair is blank", () => {
    expect(diffPlanes(blank(80, 60), blank(80, 60)).blank).toBe(true);
    expect(diffPlanes(textPage(160, 120, 2), blank(160, 120)).blank).toBe(
      false,
    );
  });
});

describe("bestShift", () => {
  const base = texture(200, 200, 7);
  const steps = [-12, -9, -6, -3, 0, 3, 6, 9, 12];

  it(`is exact over [−${MAX_SHIFT_PX}, ${MAX_SHIFT_PX}]² in steps of 3, corners included`, () => {
    const wrong: string[] = [];
    for (const dy of steps)
      for (const dx of steps) {
        const R = moved(base, dx, dy);
        const s = bestShift(base, R);
        if (s.dx !== dx || s.dy !== dy)
          wrong.push(`(${dx},${dy}) → (${s.dx},${s.dy})`);
        else if (diffPlanes(base, R, s).regions.length !== 0)
          wrong.push(`(${dx},${dy}) left regions`);
      }
    expect(wrong).toEqual([]);
  });

  it("an odd shift is found too", () => {
    for (const [dx, dy] of [
      [5, -7],
      [-11, 2],
      [1, 4],
    ] as const)
      expect(bestShift(base, moved(base, dx, dy))).toEqual({ dx, dy });
  });

  it(`beyond ${MAX_SHIFT_PX} px nothing is hidden: regions remain`, () => {
    for (const [dx, dy] of [
      [16, 0],
      [0, -20],
      [15, 15],
    ] as const) {
      const R = moved(base, dx, dy);
      const s = bestShift(base, R);
      expect(Math.abs(s.dx)).toBeLessThanOrEqual(MAX_SHIFT_PX);
      expect(Math.abs(s.dy)).toBeLessThanOrEqual(MAX_SHIFT_PX);
      expect(diffPlanes(base, R, s).regions.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("two blank pages need no shift", () => {
    expect(bestShift(blank(100, 100), blank(100, 100))).toEqual(NO_SHIFT);
  });
});

describe("describePlace", () => {
  it("names a thirds grid in words", () => {
    expect(describePlace({ x: 80, y: 0, w: 10, h: 10 }, 90, 90)).toBe(
      "near the top right",
    );
    expect(describePlace({ x: 40, y: 40, w: 10, h: 10 }, 90, 90)).toBe(
      "in the middle",
    );
    expect(describePlace({ x: 0, y: 40, w: 10, h: 10 }, 90, 90)).toBe(
      "near the left",
    );
    expect(describePlace({ x: 40, y: 80, w: 10, h: 10 }, 90, 90)).toBe(
      "near the bottom",
    );
  });
});

describe("compositeInto", () => {
  it("removed ink carries a diagonal hatch and added ink a dot pattern, not colour alone", () => {
    const L = rect(blank(64, 64), 4, 4, 24, 24);
    const R = rect(blank(64, 64), 36, 36, 24, 24);
    const d = diffPlanes(L, R);
    const out = new Uint8ClampedArray(64 * 64 * 4);
    const px = (x: number, y: number) => {
      const i = (y * 64 + x) * 4;
      return [out[i]!, out[i + 1]!, out[i + 2]!];
    };
    // At the midpoint both kinds show.
    compositeInto(out, L, R, d, 0.5, false);
    const removedOn: number[][] = [];
    const removedOff: number[][] = [];
    const addedOn: number[][] = [];
    const addedOff: number[][] = [];
    for (let y = 8; y < 24; y++)
      for (let x = 8; x < 24; x++)
        (onHatch(x, y) ? removedOn : removedOff).push(px(x, y));
    for (let y = 40; y < 56; y++)
      for (let x = 40; x < 56; x++)
        (onDot(x, y) ? addedOn : addedOff).push(px(x, y));
    // Health: both sets are populated.
    for (const set of [removedOn, removedOff, addedOn, addedOff])
      expect(set.length).toBeGreaterThan(0);
    // The pattern: every on-pattern pixel is nearer its colour than every
    // off-pattern one, so the hatch and the dots are drawn.
    const dist = (c: number[], rgb: readonly number[]) =>
      Math.hypot(c[0]! - rgb[0]!, c[1]! - rgb[1]!, c[2]! - rgb[2]!);
    const worstOn = Math.max(...removedOn.map((c) => dist(c, REMOVED_RGB)));
    const bestOff = Math.min(...removedOff.map((c) => dist(c, REMOVED_RGB)));
    expect(worstOn).toBeLessThan(bestOff);
    const worstDot = Math.max(...addedOn.map((c) => dist(c, ADDED_RGB)));
    const bestNoDot = Math.min(...addedOff.map((c) => dist(c, ADDED_RGB)));
    expect(worstDot).toBeLessThan(bestNoDot);
  });

  it("draws each region's outline", () => {
    const L = blank(64, 64);
    const R = rect(blank(64, 64), 20, 20, 16, 16);
    const d = diffPlanes(L, R);
    const out = new Uint8ClampedArray(64 * 64 * 4);
    compositeInto(out, L, R, d, 0.5);
    const r = d.regions[0]!;
    const i = ((r.y - 1) * 64 + r.x + 4) * 4;
    expect([out[i], out[i + 1], out[i + 2]]).toEqual([0x1d, 0x4e, 0xd8]);
  });
});
