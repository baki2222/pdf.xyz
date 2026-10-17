// @vitest-environment node
/**
 * The picture path's pixel work, each piece against a value worked out by
 * hand — and the PNG reader every picture check now decodes with, against
 * the writer (`./png-encode`) it shares nothing with.
 */
import { describe, expect, it } from "vitest";
import { decodePng } from "@/lib/png-probe";
import { encodePngImage, type PngLayout } from "./png-encode";
import {
  applyClipCoverage,
  asAxisRect,
  containsRect,
  coverage,
  fitWithin,
  flattenPath,
  resampleImage,
  type ClipShape,
} from "./picture-pixels";

describe("the PNG reader decodes every layout the deck writes", () => {
  it.each<[PngLayout, number]>([
    ["gray1", 1],
    ["gray8", 1],
    ["rgb8", 3],
    ["rgba8", 4],
  ])("%s", (layout, channels) => {
    const w = 13;
    const h = 7;
    let samples: Uint8Array;
    let expected: (x: number, y: number) => number[];
    if (layout === "gray1") {
      const rowBytes = (w + 7) >> 3;
      samples = new Uint8Array(rowBytes * h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          if ((x + y) % 3 === 0)
            samples[y * rowBytes + (x >> 3)]! |= 0x80 >> (x & 7);
      expected = (x, y) => {
        const v = (x + y) % 3 === 0 ? 255 : 0;
        return [v, v, v, 255];
      };
    } else {
      samples = new Uint8Array(w * h * channels);
      for (let i = 0; i < samples.length; i++) samples[i] = (i * 37 + 11) & 255;
      expected = (x, y) => {
        const p = (y * w + x) * channels;
        const c = [...samples.subarray(p, p + channels)];
        return channels === 1
          ? [c[0]!, c[0]!, c[0]!, 255]
          : channels === 3
            ? [...c, 255]
            : c;
      };
    }
    const png = decodePng(encodePngImage(w, h, layout, samples));
    expect([png.width, png.height]).toEqual([w, h]);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        expect([...png.data.subarray(i, i + 4)], `${x},${y}`).toEqual(
          expected(x, y),
        );
      }
  });
});

describe("resampleImage reads pdf.js's layouts directly", () => {
  it("averages a 1-bit image's footprint: a 2 × 2 checker becomes mid grey", () => {
    // 4 × 2, rows padded to a byte: 1010 / 0101 (a set bit is white).
    const img = {
      width: 4,
      height: 2,
      kind: 1,
      data: Uint8Array.of(0b10100000, 0b01010000),
    };
    const out = resampleImage(img, [0, 0, 4, 2], 2, 1);
    for (const p of [0, 4]) {
      for (const c of [0, 1, 2])
        expect(Math.abs(out[p + c]! - 127.5)).toBeLessThan(1);
      expect(out[p + 3]).toBe(255);
    }
  });

  it("reads only the region asked for, from RGB rows", () => {
    const w = 4;
    const data = new Uint8Array(w * 2 * 3);
    // Right half red, left half blue.
    for (let p = 0; p < w * 2; p++)
      data.set(p % w >= 2 ? [255, 0, 0] : [0, 0, 255], p * 3);
    const right = resampleImage(
      { width: w, height: 2, kind: 2, data },
      [2, 0, 4, 2],
      1,
      1,
    );
    expect([...right]).toEqual([255, 0, 0, 255]);
  });

  it("does not darken a transparent edge (premultiplied)", () => {
    const data = Uint8Array.of(255, 255, 255, 255, 0, 0, 0, 0);
    const out = resampleImage(
      { width: 2, height: 1, kind: 3, data },
      [0, 0, 2, 1],
      1,
      1,
    );
    expect([out[0], out[1], out[2]]).toEqual([255, 255, 255]);
    expect(Math.abs(out[3]! - 127.5)).toBeLessThan(1);
  });

  it("fits within a side, aspect kept", () => {
    expect(fitWithin(8200, 8000, 3600)).toEqual([3600, 3512]);
    expect(fitWithin(100, 50, 3600)).toEqual([100, 50]);
  });
});

describe("clip shapes", () => {
  const circle = (cx: number, cy: number, r: number, n = 256): number[] => {
    const out: number[] = [];
    for (let k = 0; k < n; k++)
      out.push(
        cx + r * Math.cos((2 * Math.PI * k) / n),
        cy + r * Math.sin((2 * Math.PI * k) / n),
      );
    return out;
  };

  it("a circle covers π r² of the grid", () => {
    const cov = coverage(
      { polys: [circle(50, 50, 40)], evenOdd: false },
      100,
      100,
    );
    const area = cov.reduce((a, b) => a + b, 0);
    expect(Math.abs(area - Math.PI * 40 * 40) / (Math.PI * 1600)).toBeLessThan(
      0.01,
    );
    expect(cov[50 * 100 + 50]).toBe(1);
    expect(cov[0]).toBe(0);
  });

  it("even-odd leaves a donut's hole open; non-zero with the same winding fills it", () => {
    const shape = (evenOdd: boolean): ClipShape => ({
      polys: [circle(50, 50, 40), circle(50, 50, 20)],
      evenOdd,
    });
    expect(coverage(shape(true), 100, 100)[50 * 100 + 50]).toBe(0);
    expect(coverage(shape(false), 100, 100)[50 * 100 + 50]).toBe(1);
  });

  it("knows when a clip shows all of a rectangle", () => {
    const big: ClipShape = { polys: [circle(50, 50, 80)], evenOdd: false };
    const small: ClipShape = { polys: [circle(50, 50, 30)], evenOdd: false };
    expect(containsRect(big, [10, 10, 90, 90])).toBe(true);
    expect(containsRect(small, [10, 10, 90, 90])).toBe(false);
    // A clip on the rectangle's own edge contains it (the common idiom).
    const own: ClipShape = {
      polys: [[10, 10, 90, 10, 90, 90, 10, 90]],
      evenOdd: false,
    };
    expect(containsRect(own, [10, 10, 90, 90], 0.5)).toBe(true);
  });

  it("flattens pdf.js path data (a re-style rectangle) and recognises it as upright", () => {
    // moveTo, lineTo × 3, closePath — what pdf.js makes of `re`.
    const data = [0, 10, 20, 1, 110, 20, 1, 110, 70, 1, 10, 70, 4];
    const polys = flattenPath(data, [1, 0, 0, 1, 0, 0]);
    expect(asAxisRect(polys)).toEqual([10, 20, 110, 70]);
    // Turned 30°, it is no longer a crop.
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    expect(asAxisRect(flattenPath(data, [c, s, -s, c, 0, 0]))).toBeNull();
  });

  it("what a clip hides is transparent AND colourless in the file", () => {
    const rgba = new Uint8ClampedArray(4 * 4 * 4).fill(200);
    applyClipCoverage(rgba, 4, 4, [
      { polys: [[0, 0, 2, 0, 2, 4, 0, 4]], evenOdd: false },
    ]);
    // Left half kept, right half gone — colour included.
    expect([...rgba.subarray(0, 4)]).toEqual([200, 200, 200, 200]);
    expect([...rgba.subarray(12, 16)]).toEqual([0, 0, 0, 0]);
  });
});
