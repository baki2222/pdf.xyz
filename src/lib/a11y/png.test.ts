// @vitest-environment node
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodePng } from "./png";

/**
 * WOULD THIS BE GREEN IF THE DECODER WERE WRONG? The round-trip below encodes
 * each row with a DIFFERENT filter type (0–4), so a decoder that implemented
 * only "None" — or that got Paeth's tie-breaking backwards — returns wrong
 * pixels for at least one row and fails. The fixture is deliberately noisy
 * rather than flat: every filter reconstructs a flat image correctly by
 * accident.
 */

type Pixel = [number, number, number, number];

/** Encode an RGBA image, applying `filters[y]` to row y. */
function encodePng(
  width: number,
  height: number,
  pixels: Pixel[],
  filters: number[],
  { colorType = 6, bitDepth = 8, interlace = 0 } = {},
): Uint8Array {
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;

  const at = (buf: Uint8Array, i: number) => buf[i] ?? 0;

  const flat = new Uint8Array(stride * height);
  for (let i = 0; i < width * height; i++) {
    const pixel = pixels[i] ?? [0, 0, 0, 0];
    for (let c = 0; c < bpp; c++) flat[i * bpp + c] = pixel[c] ?? 0;
  }

  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  };

  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const filter = filters[y] ?? 0;
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const value = at(flat, y * stride + x);
      const left = x >= bpp ? at(flat, y * stride + x - bpp) : 0;
      const above = y > 0 ? at(flat, (y - 1) * stride + x) : 0;
      const upperLeft =
        y > 0 && x >= bpp ? at(flat, (y - 1) * stride + x - bpp) : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? above
              : filter === 3
                ? (left + above) >> 1
                : paeth(left, above, upperLeft);
      raw[y * (stride + 1) + 1 + x] = (value - predictor) & 0xff;
    }
  }

  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    new DataView(out.buffer).setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    // CRC is left zeroed: the decoder skips it on purpose, because a
    // screenshot buffer is produced in-process and never crosses a wire.
    return out;
  };

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[12] = interlace;

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(Buffer.from(raw)))),
    chunk("IEND", new Uint8Array(0)),
  ];
  return new Uint8Array(Buffer.concat(parts.map((p) => Buffer.from(p))));
}

function noisyPixels(width: number, height: number): Pixel[] {
  const out: Pixel[] = [];
  for (let i = 0; i < width * height; i++) {
    out.push([(i * 37) % 256, (i * 91 + 13) % 256, (i * 7 + 200) % 256, 255]);
  }
  return out;
}

describe("decodePng", () => {
  it("round-trips every filter type", () => {
    const width = 5;
    const height = 5;
    const pixels = noisyPixels(width, height);
    const png = encodePng(width, height, pixels, [0, 1, 2, 3, 4]);

    const decoded = decodePng(png);
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    expect([...decoded.data]).toEqual(pixels.flat());
  });

  it("widens RGB (colour type 2) to RGBA", () => {
    const pixels: Pixel[] = [
      [10, 20, 30, 255],
      [200, 100, 50, 255],
      [1, 2, 3, 255],
      [250, 250, 250, 255],
    ];
    const png = encodePng(2, 2, pixels, [0, 4], { colorType: 2 });
    const decoded = decodePng(png);
    expect([...decoded.data]).toEqual(pixels.flat());
  });

  it("refuses formats it cannot actually read, rather than guessing", () => {
    const pixels = noisyPixels(2, 2);
    expect(() =>
      decodePng(encodePng(2, 2, pixels, [0, 0], { interlace: 1 })),
    ).toThrow(/interlaced/);
    expect(() =>
      decodePng(encodePng(2, 2, pixels, [0, 0], { bitDepth: 16 })),
    ).toThrow(/bit depth/);
    expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow(/signature/);
  });
});
