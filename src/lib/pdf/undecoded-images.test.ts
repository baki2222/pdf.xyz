// @vitest-environment node
/**
 * The undecoded-image counter reads pdfjs's verdict and nothing else.
 *
 * The whole value of this counter over a pixel heuristic is that it CANNOT
 * fire on a legitimately blank page, so that is the first thing pinned here.
 * The rest guards the id parsing: two object pools, two id shapes, and several
 * kinds of object that are not images at all.
 */
import { describe, expect, it } from "vitest";
import { countUndecodedImages } from "./render-utils";

describe("countUndecodedImages", () => {
  it("reports zero for a legitimately blank page", () => {
    // The constraint that made this approach acceptable: an empty page paints
    // no images, so there is no failed image object and nothing to warn about.
    expect(countUndecodedImages([], 0)).toBe(0);
    expect(countUndecodedImages(null, 0)).toBe(0);
    expect(countUndecodedImages(undefined, 3)).toBe(0);
  });

  it("counts only images that resolved to null", () => {
    const entries: [string, unknown][] = [
      ["img_p0_1", { data: new Uint8Array(4) }],
      ["img_p0_2", null],
      ["img_p0_3", null],
    ];
    expect(countUndecodedImages(entries, 0)).toBe(2);
  });

  it("attributes by the page in the id, not by position", () => {
    const entries: [string, unknown][] = [
      ["img_p0_1", null],
      ["img_p2_1", null],
      ["img_p2_2", null],
    ];
    expect(countUndecodedImages(entries, 0)).toBe(1);
    expect(countUndecodedImages(entries, 2)).toBe(2);
    expect(countUndecodedImages(entries, 1)).toBe(0);
  });

  it("reads the globally-cached id shape too", () => {
    // Cross-page cached images live in commonObjs under `g_d{doc}_img_p{n}_{k}`.
    // Missing this shape would undercount silently — the failure mode this
    // counter exists to avoid.
    const entries: [string, unknown][] = [["g_d0_img_p2_1", null]];
    expect(countUndecodedImages(entries, 2)).toBe(1);
  });

  it("ignores objects that are not images", () => {
    const entries: [string, unknown][] = [
      ["pattern_p0_1", null],
      ["mask_p0_1", null],
      ["g_font_abc", null],
      ["img_p0_1", null],
    ];
    expect(countUndecodedImages(entries, 0)).toBe(1);
  });

  it("counts a repeated id once", () => {
    const entries: [string, unknown][] = [
      ["img_p1_1", null],
      ["img_p1_1", null],
    ];
    expect(countUndecodedImages(entries, 1)).toBe(1);
  });

  it("survives malformed entries rather than throwing mid-render", () => {
    // This runs inside the render loop; a crash here would turn a warning into
    // a failed conversion, which is a worse outcome than the thing it reports.
    const entries = [null, undefined, [], ["img_p0_1", null], 42] as never;
    expect(countUndecodedImages(entries, 0)).toBe(1);
  });
});
