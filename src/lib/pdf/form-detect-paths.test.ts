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

/**
 * A path op in pdf.js 6's layout. args[2] is the path's [minX, minY, maxX,
 * maxY] BEFORE the CTM, which pdf.js always hands and the walker reads for
 * a clip. This helper once handed null, so every clipping test ran the
 * fallback and dropping the CTM from the branch pdf.js takes stayed green
 * (review finding). {@link pathNoBox} keeps the fallback covered.
 */
function path(paint: number, ...data: number[]): Op {
  return pathOf(paint, data);
}

/** {@link path} for data too long to spread into a call. */
function pathOf(paint: number, data: number[]): Op {
  return [OPS.constructPath, [paint, [new Float32Array(data)], minMax(data)]];
}

/** A path op with no bbox, for the walker's fallback. */
function pathNoBox(paint: number, ...data: number[]): Op {
  return [OPS.constructPath, [paint, [new Float32Array(data)], null]];
}

/** pdf.js's minMax: every point the path data names, before the CTM. */
function minMax(data: number[]): Float32Array {
  const box = new Float32Array([Infinity, Infinity, -Infinity, -Infinity]);
  // Coordinates after each DrawOPS code: moveTo, lineTo, curveTo,
  // quadraticCurveTo, closePath.
  const counts = [2, 2, 6, 4, 0];
  for (let i = 0; i < data.length;) {
    const n = counts[data[i++]!] ?? 0;
    for (let k = 0; k < n; k += 2) {
      box[0] = Math.min(box[0]!, data[i + k]!);
      box[1] = Math.min(box[1]!, data[i + k + 1]!);
      box[2] = Math.max(box[2]!, data[i + k]!);
      box[3] = Math.max(box[3]!, data[i + k + 1]!);
    }
    i += n;
  }
  return box;
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

  // A fill closes every subpath (PDF 32000-1 8.5.3.3), so `m l l l f` with
  // no `h` paints a box. Read as three filled edges, it was dropped with no
  // exclusion recorded (review finding; corpus P17).
  it("reads a filled `m l l l` with no `h` as a Rect: the fill closes it", () => {
    const bar = [M, 130, 599.6, L, 330, 599.6, L, 330, 600.4, L, 130, 600.4];
    for (const paint of [OPS.fill, OPS.eoFill, OPS.fillStroke]) {
      const r = scan([path(paint, ...bar)]);
      expect(r.rects, `paint op ${paint}`).toEqual([
        expect.objectContaining({ x0: 130, x1: 330, filled: true }),
      ]);
      expect(r.segs).toEqual([]);
    }
    // A stroke does not close it: three edges, no box.
    const open = scan([path(OPS.stroke, ...bar)]);
    expect(open.rects).toEqual([]);
    expect(open.segs).toHaveLength(3);
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

  // A path under a singular CTM (det 0) is flattened to a line or a point,
  // and pdf.js paints no pixel of it at any line width (rendered: 0 dark
  // pixels, against 800-2,000 for the same shapes at det 1). It was read as
  // a 0-width hairline, a rule, and proposed as a field (review finding;
  // corpus N27).
  it("reads nothing painted under a singular CTM (det 0)", () => {
    const under = (m: number[]) =>
      scan([
        [OPS.transform, m],
        [OPS.setLineWidth, [3]],
        path(OPS.stroke, ...re(110, 300, 200, 50)),
        path(OPS.stroke, M, 110, 300, L, 310, 300),
      ]);
    for (const m of [
      [1, 0, 0, 0, 0, 400],
      [0, 0, 0, 1, 400, 0],
      [2, 1, 4, 2, 0, 0],
    ]) {
      const flat = under(m);
      expect(flat.segs, String(m)).toEqual([]);
      expect(flat.rects, String(m)).toEqual([]);
      expect(flat.painted).toBe(2);
    }
    // Control: det 1 reads the box and the line.
    const ok = under([1, 0, 0, 1, 0, 0]);
    expect(ok.rects).toHaveLength(1);
    expect(ok.segs).toHaveLength(1);
  });

  it("gives a Rect the thickness of its thickest edge", () => {
    const r = scan([
      [OPS.transform, [0.125, 0, 0, 8, 0, 0]],
      [OPS.setLineWidth, [1]],
      path(OPS.stroke, ...re(0, 0, 800, 2)),
    ]);
    expect(r.rects[0]!.width).toBeCloseTo(8, 6);
  });

  // A Rect's level and plumb thicknesses could be handed to pushRect in
  // either order with everything green: the Rect's own width is the larger
  // of the two, and the only cut-outline test used line width 0. A clipped
  // outline under a stretched CTM then gave its visible edges the other
  // axis's thickness (review finding).
  it("a clipped outline under a stretched CTM cuts each edge at its own thickness", () => {
    const cut = (cm: number[], box: number[], clip: number[]) =>
      scan([
        [OPS.clip, []],
        path(OPS.endPath, ...re(clip[0]!, clip[1]!, clip[2]!, clip[3]!)),
        [OPS.transform, cm],
        [OPS.setLineWidth, [4]],
        path(OPS.stroke, ...re(box[0]!, box[1]!, box[2]!, box[3]!)),
      ]).segs.map((s) => [
        Math.abs(s.y1 - s.y0) < 0.01 ? "level" : "plumb",
        s.width,
      ]);
    // Both boxes are [130 600 330 620] on the page, clipped to x 150..310,
    // which drops the plumb sides and cuts the level edges. Under
    // [8 0 0 0.125] its level edges are 0.5 thick (plumb ones 32) ...
    expect(
      cut([8, 0, 0, 0.125, 0, 0], [16.25, 4800, 25, 160], [150, 0, 160, 792]),
    ).toEqual([
      ["level", 0.5],
      ["level", 0.5],
    ]);
    // ... and under the transpose [0.125 0 0 8] they are 32 thick.
    expect(
      cut([0.125, 0, 0, 8, 0, 0], [1040, 75, 1600, 2.5], [150, 0, 160, 792]),
    ).toEqual([
      ["level", 32],
      ["level", 32],
    ]);
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

    // Only level lines were trimmed in a test, so the clipper's y-edge
    // terms could have their signs swapped with everything green, and a
    // plumb line crossing the clip's edge was dropped instead of trimmed,
    // taking the table-grid evidence it carries with it (review finding).
    it("trims a plumb line that crosses the clip's bottom or top edge", () => {
      const trim = (y0: number, y1: number) =>
        scan([
          ...clipTo(0, 590, 612, 202),
          [OPS.setLineWidth, [0]],
          path(OPS.stroke, M, 130, y0, L, 130, y1),
        ]).segs.map((s) =>
          [s.y0, s.y1].map((v) => Math.round(v * 1000) / 1000),
        );
      // Across the bottom edge (y 590), drawn either way ...
      expect(trim(500, 700)).toEqual([[590, 700]]);
      expect(trim(700, 500)).toEqual([[700, 590]]);
      // ... and across the top edge (y 792).
      expect(trim(600, 900)).toEqual([[600, 792]]);
      expect(trim(900, 600)).toEqual([[792, 600]]);
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

    it("clips under a scaling CTM too: pdf.js's bbox goes through it", () => {
      const at = (y: number) =>
        scan([
          [OPS.save, []],
          [OPS.transform, [2, 0, 0, 2, 0, 0]],
          // [60 295 180 305] under the scale: [120 590 360 610].
          ...clipTo(60, 295, 120, 10),
          [OPS.transform, [0.5, 0, 0, 0.5, 0, 0]],
          path(OPS.stroke, M, 130, y, L, 330, y),
          [OPS.restore, []],
        ]).segs;
      expect(at(600)).toHaveLength(1);
      expect(at(620)).toEqual([]);
    });

    it("a clip path with no bbox from pdf.js falls back to its points", () => {
      const gone = scan([
        [OPS.clip, []],
        pathNoBox(OPS.endPath, ...re(0, 0, 10, 10)),
        line,
      ]);
      expect(gone.segs).toEqual([]);
      const kept = scan([
        [OPS.transform, [1, 0, 0, 1, 120, 590]],
        [OPS.clip, []],
        pathNoBox(OPS.endPath, ...re(0, 0, 300, 20)),
        [OPS.transform, [1, 0, 0, 1, -120, -590]],
        line,
      ]);
      expect(kept.segs).toHaveLength(1);
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

    // No case nested one clip in another, so a union in place of the
    // intersection, or a new `W` replacing the clip, stayed green, and a
    // line an outer clip hides came back (review finding; corpus N29).
    it("nested clips intersect: an inner clip never widens an outer one", () => {
      const nested = (outer: number[], inner: number[]) =>
        scan([
          [OPS.save, []],
          ...clipTo(outer[0]!, outer[1]!, outer[2]!, outer[3]!),
          [OPS.save, []],
          ...clipTo(inner[0]!, inner[1]!, inner[2]!, inner[3]!),
          line,
          [OPS.restore, []],
          [OPS.restore, []],
        ]).segs;
      expect(nested([0, 0, 10, 10], [0, 0, 612, 792])).toEqual([]);
      expect(nested([0, 0, 612, 792], [0, 0, 10, 10])).toEqual([]);
      // Control: both clips hold the line.
      expect(nested([0, 0, 612, 792], [100, 580, 300, 40])).toHaveLength(1);
      // A form's /BBox inside a `W` clip intersects it too, both ways.
      const formIn = (clip: number[], bbox: number[]) =>
        scan([
          ...clipTo(clip[0]!, clip[1]!, clip[2]!, clip[3]!),
          [OPS.paintFormXObjectBegin, [[1, 0, 0, 1, 0, 0], bbox]],
          line,
          [OPS.paintFormXObjectEnd, []],
        ]).segs;
      expect(formIn([0, 0, 10, 10], [0, 0, 612, 792])).toEqual([]);
      expect(formIn([0, 0, 612, 792], [0, 0, 10, 10])).toEqual([]);
      expect(formIn([0, 0, 612, 792], [0, 0, 612, 792])).toHaveLength(1);
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

    // pdf.js 6 hands a grouped form's /BBox ONLY to beginGroup (the form
    // begin gets null), so the group's matrix is the only thing that places
    // that clip. The test above used an identity matrix, so ignoring it
    // stayed green, and a line inside the moved bbox was dropped (review
    // finding; corpus P26 and N30).
    it("a group's bbox is placed by the group's matrix", () => {
      const moved = (y: number) =>
        scan([
          [
            OPS.beginGroup,
            [{ matrix: [1, 0, 0, 1, 120, 590], bbox: [0, 0, 300, 20] }],
          ],
          [OPS.paintFormXObjectBegin, [[1, 0, 0, 1, 120, 590], null]],
          path(OPS.stroke, M, 10, y, L, 210, y),
          [OPS.paintFormXObjectEnd, []],
          [OPS.endGroup, [{}]],
        ]).segs;
      expect(moved(10)).toEqual([
        expect.objectContaining({ x0: 130, y0: 600, x1: 330 }),
      ]);
      expect(moved(30)).toEqual([]);
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

    // A clip whose bbox is not finite (a coordinate past float32's range)
    // fell back to Math.min(...xs) over every point: 200,000 points threw
    // "Maximum call stack size exceeded" on a main thread, and the page read
    // as "unread" although it held a plain labelled line (review finding).
    // A million here, because a worker thread's larger stack takes 200,000.
    it("a clip of 1,000,000 points with no finite bbox is read, not thrown", () => {
      const data = [M, 0, 0, L, 1e39, 0];
      for (let k = 0; k < 1_000_000; k++) data.push(L, k % 600, (k * 7) % 780);
      data.push(Z);
      const r = scan([[OPS.clip, []], pathOf(OPS.endPath, data), line]);
      expect(r.segs).toEqual([expect.objectContaining({ x0: 130, x1: 330 })]);
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
