import { describe, expect, it } from "vitest";
import {
  NEAR_WHITE_LUM,
  PATH_LIMITS,
  colourLum,
  scanPaths,
  type OpsLike,
} from "./form-detect-paths";

/**
 * The walker on hand-built operator lists in pdf.js 6's layout (see the
 * module docblock). The same layout read from a REAL page's operator list is
 * pinned by H1/H2/H3 in form-detect.corpus.test.ts.
 */

const OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  constructPath: 91,
  setLineWidth: 2,
  setStrokeRGBColor: 58,
  setFillRGBColor: 59,
  setStrokeGray: 56,
  setFillGray: 57,
  endPath: 28,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
  clip: 29,
  eoClip: 30,
  beginGroup: 76,
  endGroup: 77,
  paintImageXObject: 85,
} satisfies OpsLike;

const M = 0;
const L = 1;
const Cv = 2;
const Z = 4;

type Op = [number, unknown[]];

function path(paint: number, ...data: number[]): Op {
  return [OPS.constructPath, [paint, [new Float32Array(data)], null]];
}

function scan(ops: Op[], limits = {}) {
  return scanPaths(
    ops.map((o) => o[0]),
    ops.map((o) => o[1]),
    OPS,
    limits,
  );
}

/** A `re` as pdf.js encodes it: moveTo + 3 lineTo + closePath. */
function re(x: number, y: number, w: number, h: number): number[] {
  return [M, x, y, L, x + w, y, L, x + w, y + h, L, x, y + h, Z];
}

describe("scanPaths", () => {
  it("keeps a two-point `m l` subpath as a segment", () => {
    const r = scan([path(OPS.stroke, M, 10, 20, L, 110, 20)]);
    expect(r.segs).toEqual([
      expect.objectContaining({
        x0: 10,
        y0: 20,
        x1: 110,
        y1: 20,
        stroked: true,
      }),
    ]);
    expect(r.rects).toEqual([]);
  });

  it("emits a segment for every lineTo of an open polyline", () => {
    const r = scan([path(OPS.stroke, M, 0, 0, L, 10, 0, L, 10, 10)]);
    expect(r.segs).toHaveLength(2);
  });

  it("reads `re` and `m l l l h` as a Rect", () => {
    const r = scan([path(OPS.stroke, ...re(10, 10, 12, 12))]);
    expect(r.rects).toEqual([
      expect.objectContaining({ x0: 10, y0: 10, x1: 22, y1: 22 }),
    ]);
    expect(r.segs).toEqual([]);
  });

  it("reads a four-line path that returns to its start as a Rect", () => {
    const r = scan([
      path(OPS.stroke, M, 0, 0, L, 5, 0, L, 5, 8, L, 0, 8, L, 0, 0),
    ]);
    expect(r.rects).toHaveLength(1);
  });

  it("gives several Rects for several `re` in one paint operator", () => {
    const r = scan([
      path(
        OPS.stroke,
        ...re(0, 0, 10, 10),
        ...re(0, 20, 10, 10),
        ...re(0, 40, 10, 10),
      ),
    ]);
    expect(r.rects).toHaveLength(3);
  });

  it("does not read a diagonal quadrilateral as a Rect", () => {
    const r = scan([
      path(OPS.stroke, M, 0, 0, L, 10, 2, L, 12, 12, L, 2, 10, Z),
    ]);
    expect(r.rects).toEqual([]);
    expect(r.segs).toHaveLength(3);
  });

  it("discards a clip-only path (endPath)", () => {
    const r = scan([path(OPS.endPath, M, 0, 0, L, 100, 0)]);
    expect(r.segs).toEqual([]);
    expect(r.painted).toBe(0);
  });

  it("drops near-white paths and keeps darker ones", () => {
    const white: Op = [OPS.setStrokeRGBColor, ["#ffffff"]];
    const r = scan([white, path(OPS.stroke, M, 0, 0, L, 100, 0)]);
    expect(r.segs).toEqual([]);
    expect(r.painted).toBe(1); // ink was put down, near-white or not
    const grey: Op = [OPS.setStrokeRGBColor, ["#eeeeee"]];
    expect(
      scan([grey, path(OPS.stroke, M, 0, 0, L, 100, 0)]).segs,
    ).toHaveLength(1);
  });

  it("NEAR_WHITE_LUM: at the threshold is dropped, just under is kept", () => {
    const at: Op = [OPS.setStrokeGray, [NEAR_WHITE_LUM]];
    const under: Op = [OPS.setStrokeGray, [NEAR_WHITE_LUM - 0.001]];
    const line = path(OPS.stroke, M, 0, 0, L, 100, 0);
    expect(scan([at, line]).segs).toHaveLength(0);
    expect(scan([under, line]).segs).toHaveLength(1);
  });

  it("reads colour as pdf.js 6 hands it, and the luminance weights", () => {
    expect(colourLum(["#000000"])).toBe(0);
    expect(colourLum(["#ffffff"])).toBeCloseTo(1, 6);
    expect(colourLum(["#ff0000"])).toBeCloseTo(0.2126, 4);
    expect(colourLum(["#00ff00"])).toBeCloseTo(0.7152, 4);
    expect(colourLum(["#0000ff"])).toBeCloseTo(0.0722, 4);
    expect(colourLum([0.5])).toBe(0.5);
    expect(colourLum([255, 255, 255])).toBeCloseTo(1, 6);
  });

  it("takes stroke colour for stroked and fill colour for filled paths", () => {
    const r = scan([
      [OPS.setStrokeRGBColor, ["#ffffff"]],
      [OPS.setFillRGBColor, ["#000000"]],
      path(OPS.fill, ...re(0, 0, 50, 1)),
      path(OPS.stroke, M, 0, 10, L, 50, 10),
    ]);
    expect(r.rects).toEqual([
      expect.objectContaining({ filled: true, stroked: false, lum: 0 }),
    ]);
    expect(r.segs).toEqual([]);
  });

  it("reads fill-and-stroke in a white fill as a stroked outline", () => {
    const r = scan([
      [OPS.setFillRGBColor, ["#ffffff"]],
      path(OPS.fillStroke, ...re(0, 0, 12, 12)),
    ]);
    expect(r.rects).toEqual([
      expect.objectContaining({ stroked: true, filled: false }),
    ]);
  });

  it("applies `transform`, and `save`/`restore` bring the CTM back", () => {
    const r = scan([
      [OPS.save, []],
      [OPS.transform, [2, 0, 0, 2, 100, 50]],
      path(OPS.stroke, M, 0, 0, L, 10, 0),
      [OPS.restore, []],
      path(OPS.stroke, M, 0, 0, L, 10, 0),
    ]);
    expect(r.segs[0]).toMatchObject({ x0: 100, y0: 50, x1: 120, y1: 50 });
    expect(r.segs[1]).toMatchObject({ x0: 0, y0: 0, x1: 10, y1: 0 });
  });

  it("pre-multiplies: a later `cm` acts inside the earlier one", () => {
    const r = scan([
      [OPS.transform, [1, 0, 0, 1, 100, 0]],
      [OPS.transform, [2, 0, 0, 2, 0, 0]],
      path(OPS.stroke, M, 5, 0, L, 10, 0),
    ]);
    expect(r.segs[0]).toMatchObject({ x0: 110, x1: 120 });
  });

  it("restores line width and colour with the CTM", () => {
    const r = scan([
      [OPS.save, []],
      [OPS.setLineWidth, [3]],
      [OPS.setStrokeRGBColor, ["#808080"]],
      [OPS.restore, []],
      path(OPS.stroke, M, 0, 0, L, 10, 0),
    ]);
    expect(r.segs[0]).toMatchObject({ width: 1, lum: 0 });
  });

  it("scales line width by the CTM: a uniform scale scales it", () => {
    const r = scan([
      [OPS.transform, [2, 0, 0, 2, 0, 0]],
      [OPS.setLineWidth, [0.5]],
      path(OPS.stroke, M, 0, 0, L, 10, 0),
    ]);
    expect(r.segs[0]!.width).toBeCloseTo(1, 6);
  });

  // This test used to read "scales line width by sqrt(|det CTM|)", and it
  // held only for a uniform scale. Under cm [0.125 0 0 8] sqrt(|det|) is 1,
  // so a 1 w line drawn level came out 1 pt thick while it shows as an 8 pt
  // bar (review finding; corpus N21 and P15). The thickness is measured
  // ACROSS each segment: lineWidth x |det M| / |M u|.
  it("measures thickness across each segment under a stretched CTM", () => {
    const squash = scan([
      [OPS.transform, [0.125, 0, 0, 8, 0, 0]],
      [OPS.setLineWidth, [1]],
      path(OPS.stroke, M, 0, 0, L, 100, 0, L, 100, 10),
    ]);
    expect(squash.segs[0]!.width).toBeCloseTo(8, 6); // level: stretched
    expect(squash.segs[1]!.width).toBeCloseTo(0.125, 6); // plumb: squashed
    const stretch = scan([
      [OPS.transform, [8, 0, 0, 0.125, 0, 0]],
      [OPS.setLineWidth, [4]],
      path(OPS.stroke, M, 0, 0, L, 10, 0),
    ]);
    expect(stretch.segs[0]!.width).toBeCloseTo(0.5, 6);
  });

  it("measures across a segment under a rotation and a shear", () => {
    // A quarter turn swaps nothing in thickness.
    const turned = scan([
      [OPS.transform, [0, 2, -2, 0, 0, 0]],
      [OPS.setLineWidth, [0.5]],
      path(OPS.stroke, M, 0, 0, L, 10, 0),
    ]);
    expect(turned.segs[0]!.width).toBeCloseTo(1, 6);
    // Shear [1 0 1 1]: a level line stays level and its thickness is the
    // vertical extent of the stroke, lineWidth x 1.
    const sheared = scan([
      [OPS.transform, [1, 0, 1, 1, 0, 0]],
      [OPS.setLineWidth, [2]],
      path(OPS.stroke, M, 0, 0, L, 10, 0),
    ]);
    expect(sheared.segs[0]!.width).toBeCloseTo(2, 6);
  });

  it("gives a Rect the thickness of its thickest edge", () => {
    const r = scan([
      [OPS.transform, [0.125, 0, 0, 8, 0, 0]],
      [OPS.setLineWidth, [1]],
      path(OPS.stroke, ...re(0, 0, 800, 2)),
    ]);
    expect(r.rects[0]!.width).toBeCloseTo(8, 6);
  });

  it("enters a form XObject with its matrix and leaves it at its end", () => {
    const r = scan([
      [
        OPS.paintFormXObjectBegin,
        [
          [1, 0, 0, 1, 30, 40],
          [0, 0, 100, 100],
        ],
      ],
      path(OPS.stroke, M, 0, 0, L, 10, 0),
      [OPS.paintFormXObjectEnd, []],
      path(OPS.stroke, M, 0, 0, L, 10, 0),
    ]);
    expect(r.segs[0]).toMatchObject({ x0: 30, y0: 40 });
    expect(r.segs[1]).toMatchObject({ x0: 0, y0: 0 });
  });

  // Clipping was not applied at all once: a rule clipped away by a form's
  // /BBox or by `W n` was invisible on the page and still had a field
  // proposed on it (review finding; corpus N22, N23 and the control P16).
  describe("clipping", () => {
    const line = path(OPS.stroke, M, 130, 600, L, 330, 600);
    const clipTo = (x: number, y: number, w: number, h: number): Op[] => [
      [OPS.clip, []],
      path(OPS.endPath, ...re(x, y, w, h)),
    ];

    it("a `W n` clip hides a line outside it, and `Q` lifts the clip", () => {
      const r = scan([
        [OPS.save, []],
        ...clipTo(0, 0, 10, 10),
        line,
        [OPS.restore, []],
        line,
      ]);
      expect(r.segs).toEqual([expect.objectContaining({ x0: 130, x1: 330 })]);
    });

    it("eoClip clips the same way", () => {
      const r = scan([
        [OPS.eoClip, []],
        path(OPS.endPath, ...re(0, 0, 10, 10)),
        line,
      ]);
      expect(r.segs).toEqual([]);
    });

    it("trims a line that runs out of the clip to the part inside", () => {
      // Line width 0: the clip is widened by half the stroke (see below).
      const r = scan([
        ...clipTo(0, 0, 200, 792),
        [OPS.setLineWidth, [0]],
        line,
      ]);
      expect(r.segs).toEqual([
        expect.objectContaining({ x0: 130, y0: 600, x1: 200, y1: 600 }),
      ]);
    });

    it("a clip set with a paint op applies after it, not to it", () => {
      const r = scan([
        [OPS.clip, []],
        path(OPS.stroke, ...re(0, 0, 10, 10)),
        line,
      ]);
      expect(r.rects).toHaveLength(1);
      expect(r.segs).toEqual([]);
    });

    it("clips in user space, under the CTM the clip was set in", () => {
      const r = scan([
        [OPS.save, []],
        [OPS.transform, [1, 0, 0, 1, 120, 590]],
        ...clipTo(0, 0, 300, 20),
        [OPS.restore, []],
        line,
      ]);
      expect(r.segs).toHaveLength(1);
      const kept = scan([
        [OPS.transform, [1, 0, 0, 1, 120, 590]],
        ...clipTo(0, 0, 300, 20),
        [OPS.transform, [1, 0, 0, 1, -120, -590]],
        line,
      ]);
      expect(kept.segs).toHaveLength(1);
      const gone = scan([
        [OPS.transform, [1, 0, 0, 1, 120, 0]],
        ...clipTo(0, 0, 300, 20),
        [OPS.transform, [1, 0, 0, 1, -120, 0]],
        line,
      ]);
      expect(gone.segs).toEqual([]);
    });

    it("a form XObject's /BBox clips what it draws, and stops at its end", () => {
      const r = scan([
        [
          OPS.paintFormXObjectBegin,
          [
            [1, 0, 0, 1, 0, 0],
            [0, 0, 10, 10],
          ],
        ],
        line,
        [OPS.paintFormXObjectEnd, []],
        line,
      ]);
      expect(r.segs).toHaveLength(1);
      // The BBox is in form space: under the form's matrix it moves too.
      const moved = scan([
        [
          OPS.paintFormXObjectBegin,
          [
            [1, 0, 0, 1, 120, 590],
            [0, 0, 300, 20],
          ],
        ],
        path(OPS.stroke, M, 10, 10, L, 210, 10),
        [OPS.paintFormXObjectEnd, []],
      ]);
      expect(moved.segs).toEqual([
        expect.objectContaining({ x0: 130, y0: 600, x1: 330 }),
      ]);
    });

    it("a transparency group's bbox clips like a form's", () => {
      const r = scan([
        [
          OPS.beginGroup,
          [{ matrix: [1, 0, 0, 1, 0, 0], bbox: [0, 0, 10, 10] }],
        ],
        [OPS.paintFormXObjectBegin, [[1, 0, 0, 1, 0, 0], null]],
        line,
        [OPS.paintFormXObjectEnd, []],
        [OPS.endGroup, [{}]],
        line,
      ]);
      expect(r.segs).toHaveLength(1);
    });

    it("drops a Rect outside the clip, trims a filled one, and cuts a stroked one into its visible edges", () => {
      const clip = clipTo(0, 0, 100, 100);
      expect(
        scan([...clip, path(OPS.stroke, ...re(200, 200, 12, 12))]).rects,
      ).toEqual([]);
      const filled = scan([...clip, path(OPS.fill, ...re(50, 50, 100, 2))]);
      expect(filled.rects).toEqual([
        expect.objectContaining({ x0: 50, y0: 50, x1: 100, y1: 52 }),
      ]);
      const stroked = scan([
        ...clip,
        [OPS.setLineWidth, [0]],
        path(OPS.stroke, ...re(90, 40, 20, 20)),
      ]);
      expect(stroked.rects).toEqual([]);
      // Bottom and top cut at x = 100, the left edge whole, the right one gone.
      expect(
        stroked.segs.map((s) => [s.x0, s.y0, s.x1, s.y1].map(Math.round)),
      ).toEqual([
        [90, 40, 100, 40],
        [100, 60, 90, 60],
        [90, 60, 90, 40],
      ]);
    });

    it("keeps a line whose stroke touches the clip's edge", () => {
      // BBox [0 0 400 600] and a 1 pt line at y = 600.4: half of it shows.
      const at = (y: number) =>
        scan([
          ...clipTo(0, 0, 400, 600),
          [OPS.setLineWidth, [1]],
          path(OPS.stroke, M, 130, y, L, 330, y),
        ]).segs;
      expect(at(600.4)).toHaveLength(1);
      expect(at(600.6)).toEqual([]);
    });
  });

  it("caps form depth: deeper content is skipped and counted", () => {
    const depth = 3;
    const ops: Op[] = [];
    for (let k = 0; k < depth + 1; k++)
      ops.push([OPS.paintFormXObjectBegin, [[1, 0, 0, 1, 0, 0], null]]);
    ops.push(path(OPS.stroke, M, 0, 0, L, 10, 0));
    for (let k = 0; k < depth + 1; k++) ops.push([OPS.paintFormXObjectEnd, []]);
    ops.push(path(OPS.stroke, M, 0, 5, L, 10, 5));
    const r = scan(ops, { maxFormDepth: depth });
    expect(r.segs).toEqual([expect.objectContaining({ y0: 5 })]);
    expect(r.ignored).toBeGreaterThan(0);
    // At the cap itself, content is read.
    const ok = scan(ops.slice(1, -2).concat(ops.slice(-1)), {
      maxFormDepth: depth,
    });
    expect(ok.segs).toHaveLength(2);
  });

  it("ends a straight run at a curve, and carries on from the curve's end", () => {
    const r = scan([
      path(OPS.stroke, M, 0, 0, L, 10, 0, Cv, 12, 0, 14, 2, 14, 4, L, 14, 40),
    ]);
    expect(r.segs).toHaveLength(2);
    expect(r.segs[1]).toMatchObject({ x0: 14, y0: 4, x1: 14, y1: 40 });
    expect(r.rects).toEqual([]);
  });

  it("records the box an image is painted into", () => {
    const r = scan([
      [OPS.transform, [612, 0, 0, 792, 0, 0]],
      [OPS.paintImageXObject!, ["img1", 1, 1]],
    ]);
    expect(r.images).toEqual([{ x0: 0, y0: 0, x1: 612, y1: 792 }]);
    expect(r.painted).toBe(1);
  });

  it("ignores a path with no data instead of throwing", () => {
    const r = scan([[OPS.constructPath, [OPS.stroke, [null], null]]]);
    expect(r.segs).toEqual([]);
  });

  it("caps operators: past maxOps it stops and says so", () => {
    const ops: Op[] = Array.from({ length: 11 }, () =>
      path(OPS.stroke, M, 0, 0, L, 10, 0),
    );
    expect(scan(ops, { maxOps: 11 }).capped).toBe(false);
    const r = scan(ops, { maxOps: 10 });
    expect(r.capped).toBe("ops");
    expect(r.segs).toHaveLength(10);
  });

  it("caps primitives: past maxPrimitives it stops and says so", () => {
    const data: number[] = [];
    for (let k = 0; k < 6; k++) data.push(M, 0, k, L, 10, k);
    expect(scan([path(OPS.stroke, ...data)], { maxPrimitives: 6 }).capped).toBe(
      false,
    );
    expect(scan([path(OPS.stroke, ...data)], { maxPrimitives: 5 }).capped).toBe(
      "primitives",
    );
  });

  it("PATH_LIMITS are the documented values", () => {
    expect(PATH_LIMITS).toEqual({
      maxOps: 200_000,
      maxPrimitives: 20_000,
      maxFormDepth: 32,
    });
  });
});
