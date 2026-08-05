/**
 * A minimal PNG decoder for screenshot pixel sampling.
 *
 * The a11y audit needs the REAL rendered background under a piece of text, not
 * a composite of the ancestors' `background-color`. Those two differ here: the
 * app paints an ambient radial-gradient layer (`body::before`, `z-index: -1`)
 * that every translucent glass panel sits on top of, so an ancestor walk
 * terminates at the opaque body colour and reports a background DARKER than the
 * one on screen — i.e. it over-reports contrast for light text, in the exact
 * direction that would let a failure pass.
 *
 * Rather than take a dependency (nothing in `dependencies` decodes PNG, and the
 * `sharp` copy under node_modules is a transitive optional of Next that CI is
 * not entitled to assume), this decodes the narrow subset Chromium's
 * `page.screenshot()` actually emits: 8-bit, non-interlaced, colour type 2
 * (RGB) or 6 (RGBA). Anything else throws rather than guessing — a decoder that
 * silently returns plausible-looking pixels is worse than no decoder.
 */

import { inflateSync } from "node:zlib";

export type DecodedPng = {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8Array;
};

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Byte read with an out-of-range result of 0.
 *
 * `noUncheckedIndexedAccess` widens every `Uint8Array` read to `number |
 * undefined`, and 0 is not a papered-over default here: the PNG filter
 * predictors are DEFINED to treat bytes left of the row and above the image as
 * zero, which is exactly the out-of-range case.
 */
function byteAt(buffer: Uint8Array, index: number): number {
  return buffer[index] ?? 0;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(buffer: Uint8Array): DecodedPng {
  if (buffer.length < 8 || SIGNATURE.some((byte, i) => byteAt(buffer, i) !== byte)) {
    throw new Error("not a PNG (bad signature)");
  }

  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Uint8Array[] = [];

  while (offset + 8 <= buffer.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      byteAt(buffer, offset + 4),
      byteAt(buffer, offset + 5),
      byteAt(buffer, offset + 6),
      byteAt(buffer, offset + 7),
    );
    const dataStart = offset + 8;

    if (type === "IHDR") {
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      bitDepth = byteAt(buffer, dataStart + 8);
      colorType = byteAt(buffer, dataStart + 9);
      const interlace = byteAt(buffer, dataStart + 12);
      if (bitDepth !== 8) {
        throw new Error(`unsupported PNG bit depth: ${bitDepth}`);
      }
      if (colorType !== 2 && colorType !== 6) {
        throw new Error(`unsupported PNG colour type: ${colorType}`);
      }
      if (interlace !== 0) {
        throw new Error("unsupported PNG: interlaced");
      }
    } else if (type === "IDAT") {
      idat.push(buffer.subarray(dataStart, dataStart + length));
    } else if (type === "IEND") {
      break;
    }

    offset = dataStart + length + 4; // + CRC
  }

  if (!width || !height) throw new Error("PNG has no IHDR");
  if (idat.length === 0) throw new Error("PNG has no IDAT");

  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = new Uint8Array(inflateSync(Buffer.concat(idat)));
  const expected = (stride + 1) * height;
  if (raw.length < expected) {
    throw new Error(
      `PNG inflate produced ${raw.length} bytes, expected ${expected}`,
    );
  }

  // Unfilter in place into a contiguous RGB(A) buffer.
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = byteAt(raw, y * (stride + 1));
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const up = dst - stride;
    for (let x = 0; x < stride; x++) {
      const value = byteAt(raw, src + x);
      const left = x >= bpp ? byteAt(pixels, dst + x - bpp) : 0;
      const above = y > 0 ? byteAt(pixels, up + x) : 0;
      const upperLeft = y > 0 && x >= bpp ? byteAt(pixels, up + x - bpp) : 0;
      let out: number;
      switch (filter) {
        case 0:
          out = value;
          break;
        case 1:
          out = value + left;
          break;
        case 2:
          out = value + above;
          break;
        case 3:
          out = value + ((left + above) >> 1);
          break;
        case 4:
          out = value + paeth(left, above, upperLeft);
          break;
        default:
          throw new Error(`unsupported PNG filter type: ${filter}`);
      }
      pixels[dst + x] = out & 0xff;
    }
  }

  if (bpp === 4) return { width, height, data: pixels };

  // Widen RGB to RGBA so callers have one shape to read.
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < pixels.length; i += 3, j += 4) {
    rgba[j] = byteAt(pixels, i);
    rgba[j + 1] = byteAt(pixels, i + 1);
    rgba[j + 2] = byteAt(pixels, i + 2);
    rgba[j + 3] = 255;
  }
  return { width, height, data: rgba };
}
