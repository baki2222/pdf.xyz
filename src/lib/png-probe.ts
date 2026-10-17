import { inflateSync } from "node:zlib";

/**
 * A minimal PNG reader, for tests that need to look at what a card actually
 * paints rather than at the JSX that asked for it.
 *
 * This exists because every guard on the share cards checked the author's
 * artifact. `og-identity.test.ts` asserted on the source of `src/lib/og.tsx`
 * and passed six of six while `/opengraph-image` — which had its own copy of
 * everything and imported one constant — served the retired violet mark to
 * every link ever pasted. Source guards cannot see a route that opted out of
 * the source. Pixels can.
 *
 * Supports what `next/og` emits (8-bit RGB or RGBA) and what the PowerPoint
 * export writes (`pdf-office-export/png-encode`: 1- and 8-bit grey, 8-bit
 * RGB and RGBA), plus 8-bit grey with alpha; non-interlaced only. Anything
 * else throws rather than returning a plausible-looking buffer, because a
 * decoder that quietly mis-reads is a green nobody can explain.
 */
export interface DecodedPng {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8Array;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** `#rrggbb` → channels. Throws on any other shape: a silent 0,0,0 is a lie. */
export function hexToRgb(hex: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`not a 6-digit hex colour: ${hex}`);
  const n = parseInt(match[1] ?? "", 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Euclidean distance in RGB — good enough to tell cyan from violet. */
export function colourDistance(a: Rgb, b: Rgb): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodePng(buffer: Uint8Array): DecodedPng {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < signature.length; i += 1) {
    if (buffer[i] !== signature[i]) throw new Error("not a PNG");
  }

  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let bitDepth = 8;
  const idat: Uint8Array[] = [];

  while (offset < buffer.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      ...[4, 5, 6, 7].map((k) => buffer[offset + k] ?? 0),
    );
    const body = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      bitDepth = body[8] ?? 0;
      colorType = body[9] ?? -1;
      const interlace = body[12];
      const supported =
        (colorType === 0 && (bitDepth === 1 || bitDepth === 8)) ||
        ((colorType === 2 || colorType === 4 || colorType === 6) &&
          bitDepth === 8);
      if (!supported)
        throw new Error(
          `colour type ${colorType} at bit depth ${bitDepth} unsupported`,
        );
      if (interlace !== 0) throw new Error("interlaced PNG unsupported");
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }

    offset += 12 + length;
  }

  if (!width || !height) throw new Error("no IHDR");
  if (!idat.length) throw new Error("no IDAT");

  const channels =
    colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const stride = Math.ceil((width * channels * bitDepth) / 8);
  // Filters work on whole bytes: the byte "to the left" is one pixel back,
  // or one byte back when a pixel is less than a byte.
  const bpp = Math.max(1, (channels * bitDepth) / 8);
  const raw = inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c))));
  const expected = (stride + 1) * height;
  if (raw.length < expected) {
    throw new Error(`short scanline data: ${raw.length} < ${expected}`);
  }

  const out = new Uint8Array(width * height * 4);
  const previous = new Uint8Array(stride);
  const current = new Uint8Array(stride);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart] ?? -1;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[rowStart + 1 + x] ?? 0;
      const left = x >= bpp ? (current[x - bpp] ?? 0) : 0;
      const up = previous[x] ?? 0;
      const upLeft = x >= bpp ? (previous[x - bpp] ?? 0) : 0;
      let restored: number;
      if (filter === 0) restored = value;
      else if (filter === 1) restored = value + left;
      else if (filter === 2) restored = value + up;
      else if (filter === 3) restored = value + ((left + up) >> 1);
      else if (filter === 4) restored = value + paeth(left, up, upLeft);
      else throw new Error(`unknown PNG filter ${filter} on row ${y}`);
      current[x] = restored & 255;
    }
    for (let x = 0; x < width; x += 1) {
      const to = (y * width + x) * 4;
      if (bitDepth === 1) {
        const v = ((current[x >> 3] ?? 0) >> (7 - (x & 7))) & 1 ? 255 : 0;
        out[to] = out[to + 1] = out[to + 2] = v;
        out[to + 3] = 255;
        continue;
      }
      const from = x * channels;
      if (channels <= 2) {
        out[to] = out[to + 1] = out[to + 2] = current[from] ?? 0;
        out[to + 3] = channels === 2 ? (current[from + 1] ?? 0) : 255;
        continue;
      }
      out[to] = current[from] ?? 0;
      out[to + 1] = current[from + 1] ?? 0;
      out[to + 2] = current[from + 2] ?? 0;
      out[to + 3] = channels === 4 ? (current[from + 3] ?? 0) : 255;
    }
    previous.set(current);
  }

  return { width, height, data: out };
}

/** The colour at a pixel, alpha discarded (cards are fully opaque). */
export function pixelAt(png: DecodedPng, x: number, y: number): Rgb {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) {
    throw new Error(`(${x},${y}) is outside ${png.width}x${png.height}`);
  }
  const i = (y * png.width + x) * 4;
  return {
    r: png.data[i] ?? 0,
    g: png.data[i + 1] ?? 0,
    b: png.data[i + 2] ?? 0,
  };
}

/** How many pixels sit within `tolerance` of `target`. */
export function countNear(
  png: DecodedPng,
  target: Rgb,
  tolerance: number,
): number {
  let n = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const dr = (png.data[i] ?? 0) - target.r;
    const dg = (png.data[i + 1] ?? 0) - target.g;
    const db = (png.data[i + 2] ?? 0) - target.b;
    if (dr * dr + dg * dg + db * db <= tolerance * tolerance) n += 1;
  }
  return n;
}
