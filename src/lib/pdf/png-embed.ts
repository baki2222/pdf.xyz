import type { PDFDocument, PDFImage } from "pdf-lib";
import { loadPdfLib } from "./pdf-lib";

/**
 * A PNG into a PDF image the way the PNG itself stores it (audit #10,
 * 2026-11-06) — JPG / PNG to PDF's embedder for every PNG, including the PNGs
 * `image-transcode.ts` writes for a transparent WebP, GIF or BMP.
 *
 * HISTORY: PNGs went through pdf-lib 1.17.1's `PngEmbedder`, which decodes to
 * 8-bit RGBA, stores colour as DeviceRGB (greyscale and palette images
 * expanded to three channels), deflates it WITHOUT PNG's row predictors, cuts
 * sixteen bits to eight and drops the iCCP colour profile. A smooth 1200×800
 * RGB gradient of ~14 KB became a ~460 KB PDF, which pushed users onto the
 * JPEG size ladder that blurs the screenshots the tool promises to keep
 * crisp; a Display P3 screenshot lost its profile and shifted colour.
 *
 * What this does instead, from the PDF specification's own tools:
 *  - **No alpha to split, not interlaced** (greyscale, RGB, palette — the
 *    common screenshot and diagram case): the IDAT data goes in UNCHANGED,
 *    as FlateDecode with `/DecodeParms << /Predictor 15 … >>`, which is PNG's
 *    row filtering by definition. Nothing is decoded except to check that the
 *    data is whole (a cut-off file is refused, never embedded as noise).
 *  - **Alpha, palette transparency or Adam7 interlacing**: the rows are
 *    decoded, the alpha split into a soft mask (only when some pixel is not
 *    opaque), and both planes are filtered again row by row (the encoder's
 *    usual "smallest sum" choice) before deflating, with the same predictor.
 *  - Greyscale stays DeviceGray and a palette stays Indexed, at the PNG's own
 *    bit depth (1, 2, 4, 8 or 16). A tRNS colour key becomes `/Mask`.
 *  - An iCCP profile becomes an ICCBased colour space (N 1 or 3, the device
 *    space as its Alternate) when its header says it is a profile for the
 *    PNG's colour type; a profile that does not match is dropped, as libpng
 *    drops it. gAMA, cHRM and sRGB are not read.
 *
 * Anything that is not a whole, single-frame PNG throws — the caller words
 * that as "could not be decoded as a PNG image", as it did for pdf-lib's.
 *
 * Loaded on the first PNG only (`image-to-pdf.ts` imports it lazily). It
 * builds the image itself and draws nothing: drawing stays in
 * `drawRasterImage` (`raster-draw-boundary.test.ts`).
 */

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Channels per pixel, by PNG colour type. */
const CHANNELS: Readonly<Record<number, number>> = {
  0: 1,
  2: 3,
  3: 1,
  4: 2,
  6: 4,
};

/** The bit depths the PNG specification allows for each colour type. */
const DEPTHS: Readonly<Record<number, readonly number[]>> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

/** The seven Adam7 passes: first column, first row, column step, row step. */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

/** A colour profile larger than this is not a profile a PNG should carry. */
const MAX_ICC_BYTES = 4 * 1024 * 1024;

class PngDamage extends Error {}

interface PngParts {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlaced: boolean;
  palette?: Uint8Array;
  trns?: Uint8Array;
  /** The iCCP profile, still zlib-compressed as the PNG stores it. */
  icc?: Uint8Array;
  idat: Uint8Array;
}

const u32 = (b: Uint8Array, at: number) =>
  ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;

const ascii = (b: Uint8Array, at: number, n: number) =>
  String.fromCharCode(...b.subarray(at, at + n));

/** The chunks this embedder reads, checked against the specification. */
function readPng(bytes: Uint8Array): PngParts {
  if (bytes.length < 8 || SIGNATURE.some((v, i) => bytes[i] !== v))
    throw new PngDamage("not a PNG");
  let at = 8;
  let header: Omit<PngParts, "idat"> | undefined;
  const idat: Uint8Array[] = [];
  let ended = false;
  while (at + 8 <= bytes.length && !ended) {
    const length = u32(bytes, at);
    const type = ascii(bytes, at + 4, 4);
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (data.length !== length) throw new PngDamage(`${type} cut short`);
    at += 12 + length;
    if (type === "IHDR") {
      if (length !== 13) throw new PngDamage("IHDR");
      header = {
        width: u32(data, 0),
        height: u32(data, 4),
        bitDepth: data[8]!,
        colorType: data[9]!,
        interlaced: data[12] === 1,
      };
      const depths = DEPTHS[header.colorType];
      if (
        header.width === 0 ||
        header.height === 0 ||
        !depths?.includes(header.bitDepth) ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12]! > 1
      )
        throw new PngDamage("IHDR values");
    } else if (!header) {
      throw new PngDamage("IHDR is not first");
    } else if (type === "PLTE") {
      if (length === 0 || length % 3 !== 0 || length > 768)
        throw new PngDamage("PLTE");
      header.palette = data;
    } else if (type === "tRNS") {
      header.trns = data;
    } else if (type === "iCCP") {
      const nul = data.indexOf(0);
      // Name (1-79 bytes), NUL, compression method 0 (zlib), then the profile.
      if (nul >= 1 && nul <= 79 && data[nul + 1] === 0)
        header.icc = data.subarray(nul + 2);
    } else if (type === "acTL") {
      // An animated PNG: its IDAT is only the first frame, and a PDF page
      // that silently showed one frame of many would be a fake.
      if (length >= 4 && u32(data, 0) > 1)
        throw new PngDamage("more than one frame");
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      ended = true;
    }
  }
  if (!header || idat.length === 0) throw new PngDamage("no image data");
  if (header.colorType === 3 && !header.palette) throw new PngDamage("no PLTE");
  return { ...header, idat: concat(idat) };
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0]!;
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * zlib Deflate through the browser's own decompressor, read no further than
 * `want` bytes. Returns what arrived: a stream that ends early or is not
 * Deflate is counted, not thrown, and the caller decides.
 */
async function inflate(src: Uint8Array, want: number): Promise<Uint8Array> {
  const out = new Uint8Array(want);
  let written = 0;
  const reader = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(src);
      controller.close();
    },
  })
    .pipeThrough(
      new DecompressionStream("deflate") as unknown as TransformStream<
        Uint8Array,
        Uint8Array
      >,
    )
    .getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = Math.min(value.length, want - written);
      out.set(value.subarray(0, take), written);
      written += take;
      if (written >= want) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  } catch {
    // Damaged or short: what arrived is counted below.
  }
  return out.subarray(0, written);
}

/** One reduced image: its size, and where its filtered rows start. */
interface Pass {
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  cols: number;
  rows: number;
  stride: number;
}

function passesOf(png: PngParts, bitsPerPixel: number): Pass[] {
  const layout = png.interlaced ? ADAM7 : ([[0, 0, 1, 1]] as const);
  return layout
    .map(([x0, y0, dx, dy]) => {
      const cols = Math.ceil(Math.max(0, png.width - x0) / dx);
      const rows = Math.ceil(Math.max(0, png.height - y0) / dy);
      return {
        x0,
        y0,
        dx,
        dy,
        cols,
        rows,
        stride: Math.ceil((cols * bitsPerPixel) / 8),
      };
    })
    .filter((p) => p.cols > 0 && p.rows > 0);
}

/** Undo PNG filtering in place, pass by pass; throws on a bad filter type. */
function unfilter(raw: Uint8Array, passes: readonly Pass[], bpp: number) {
  let at = 0;
  for (const pass of passes) {
    let prev = -1;
    for (let r = 0; r < pass.rows; r++) {
      const filter = raw[at]!;
      const row = at + 1;
      if (filter > 4) throw new PngDamage("filter type");
      for (let i = 0; i < pass.stride; i++) {
        const a = i >= bpp ? raw[row + i - bpp]! : 0;
        const b = prev >= 0 ? raw[prev + i]! : 0;
        const c = i >= bpp && prev >= 0 ? raw[prev + i - bpp]! : 0;
        let pred = 0;
        if (filter === 1) pred = a;
        else if (filter === 2) pred = b;
        else if (filter === 3) pred = (a + b) >> 1;
        else if (filter === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        raw[row + i] = (raw[row + i]! + pred) & 0xff;
      }
      prev = row;
      at = row + pass.stride;
    }
  }
}

/** The filter types of every row, without decoding: true if all are valid. */
function filtersValid(raw: Uint8Array, passes: readonly Pass[]): boolean {
  let at = 0;
  for (const pass of passes)
    for (let r = 0; r < pass.rows; r++, at += pass.stride + 1)
      if (raw[at]! > 4) return false;
  return true;
}

/**
 * The unfiltered passes as ONE image of packed rows (`stride` bytes each) —
 * the bytes themselves when there is one pass, a deinterlaced copy for Adam7.
 */
function assemble(
  raw: Uint8Array,
  passes: readonly Pass[],
  png: PngParts,
  bitsPerPixel: number,
): { rows: Uint8Array; stride: number } {
  const stride = Math.ceil((png.width * bitsPerPixel) / 8);
  const rows = new Uint8Array(stride * png.height);
  let at = 0;
  for (const pass of passes) {
    for (let r = 0; r < pass.rows; r++) {
      const src = at + 1;
      const y = pass.y0 + r * pass.dy;
      for (let c = 0; c < pass.cols; c++) {
        const x = pass.x0 + c * pass.dx;
        if (bitsPerPixel >= 8) {
          const n = bitsPerPixel >> 3;
          rows.set(
            raw.subarray(src + c * n, src + c * n + n),
            y * stride + x * n,
          );
        } else {
          // Sub-byte samples only occur with one channel (grey or palette).
          const sBit = c * bitsPerPixel;
          const v =
            (raw[src + (sBit >> 3)]! >> (8 - bitsPerPixel - (sBit & 7))) &
            ((1 << bitsPerPixel) - 1);
          const dBit = x * bitsPerPixel;
          rows[y * stride + (dBit >> 3)]! |=
            v << (8 - bitsPerPixel - (dBit & 7));
        }
      }
      at = src + pass.stride;
    }
  }
  return { rows, stride };
}

/**
 * Filter packed rows again for a FlateDecode stream with PNG predictors —
 * each row with whichever of the five filters gives the smallest sum of
 * absolute (signed) bytes, the heuristic libpng uses.
 */
function refilter(rows: Uint8Array, stride: number, bpp: number): Uint8Array {
  const height = rows.length / stride;
  const out = new Uint8Array(height * (stride + 1));
  const trial = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    const prev = y > 0 ? row - stride : -1;
    let best = 0;
    let bestSum = Infinity;
    const dst = y * (stride + 1);
    for (let f = 0; f <= 4; f++) {
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? rows[row + i - bpp]! : 0;
        const b = prev >= 0 ? rows[prev + i]! : 0;
        const c = i >= bpp && prev >= 0 ? rows[prev + i - bpp]! : 0;
        let pred = 0;
        if (f === 1) pred = a;
        else if (f === 2) pred = b;
        else if (f === 3) pred = (a + b) >> 1;
        else if (f === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        const v = (rows[row + i]! - pred) & 0xff;
        trial[i] = v;
        sum += v < 128 ? v : 256 - v;
        if (sum >= bestSum) break;
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = f;
        out[dst] = f;
        out.set(trial, dst + 1);
      }
    }
    out[dst] = best;
  }
  return out;
}

/** Split interleaved colour+alpha rows (8- or 16-bit) into two planes. */
function splitAlpha(
  rows: Uint8Array,
  png: PngParts,
): { colour: Uint8Array; alpha: Uint8Array | undefined } {
  const n = png.bitDepth >> 3;
  const colourChannels = CHANNELS[png.colorType]! - 1;
  const pixels = png.width * png.height;
  const colour = new Uint8Array(pixels * colourChannels * n);
  const alpha = new Uint8Array(pixels * n);
  let opaque = true;
  for (let p = 0, s = 0; p < pixels; p++) {
    for (let k = 0; k < colourChannels * n; k++)
      colour[p * colourChannels * n + k] = rows[s++]!;
    for (let k = 0; k < n; k++) {
      const v = rows[s++]!;
      alpha[p * n + k] = v;
      if (v !== 0xff) opaque = false;
    }
  }
  return { colour, alpha: opaque ? undefined : alpha };
}

/** A palette image's alpha from its tRNS entries, or none if all opaque. */
function paletteAlpha(
  rows: Uint8Array,
  stride: number,
  png: PngParts,
): Uint8Array | undefined {
  const trns = png.trns!;
  if (trns.every((v) => v === 0xff)) return undefined;
  const bits = png.bitDepth;
  const alpha = new Uint8Array(png.width * png.height);
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const bit = x * bits;
      const index =
        (rows[y * stride + (bit >> 3)]! >> (8 - bits - (bit & 7))) &
        ((1 << bits) - 1);
      alpha[y * png.width + x] = trns[index] ?? 0xff;
    }
  }
  return alpha;
}

/** A tRNS colour key as a `/Mask` range, or undefined if out of range. */
function colourKey(png: PngParts): number[] | undefined {
  const t = png.trns;
  const channels = png.colorType === 0 ? 1 : 3;
  if (!t || t.length < channels * 2) return undefined;
  const max = 2 ** png.bitDepth - 1;
  const out: number[] = [];
  for (let k = 0; k < channels; k++) {
    const v = (t[k * 2]! << 8) | t[k * 2 + 1]!;
    if (v > max) return undefined;
    out.push(v, v);
  }
  return out;
}

/**
 * The iCCP profile, if its header says it is a colour profile for `channels`
 * (GRAY for 1, RGB for 3). The bytes stay compressed: a PDF stream can carry
 * them as FlateDecode, which is the same zlib format.
 */
async function usableProfile(
  compressed: Uint8Array | undefined,
  channels: number,
): Promise<Uint8Array | undefined> {
  if (!compressed) return undefined;
  const head = await inflate(compressed, 128);
  if (head.length < 128 || ascii(head, 36, 4) !== "acsp") return undefined;
  const space = ascii(head, 16, 4);
  if (space !== (channels === 1 ? "GRAY" : "RGB ")) return undefined;
  const declared = u32(head, 0);
  if (declared < 128 || declared > MAX_ICC_BYTES) return undefined;
  const whole = await inflate(compressed, declared);
  return whole.length === declared ? compressed : undefined;
}

/**
 * Embed `bytes` (a PNG) in `doc` as described above. Throws on anything that
 * is not one whole, single-frame PNG.
 */
export async function embedPngAsStored(
  doc: PDFDocument,
  bytes: Uint8Array,
): Promise<PDFImage> {
  const png = readPng(bytes);
  const lib = await loadPdfLib();
  const context = doc.context;
  const { width, height, bitDepth, colorType } = png;
  const channels = CHANNELS[colorType]!;
  const bitsPerPixel = channels * bitDepth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const passes = passesOf(png, bitsPerPixel);
  const want = passes.reduce((n, p) => n + p.rows * (p.stride + 1), 0);
  const raw = await inflate(png.idat, want);
  if (raw.length !== want) throw new PngDamage("image data cut short");

  const hasAlphaChannel = colorType === 4 || colorType === 6;
  const paletteTransparency = colorType === 3 && png.trns !== undefined;
  const colourChannels = hasAlphaChannel ? channels - 1 : channels;
  const deviceChannels = colorType === 3 ? 3 : colourChannels;

  const profile = await usableProfile(png.icc, deviceChannels);
  const device = deviceChannels === 1 ? "DeviceGray" : "DeviceRGB";
  const base = profile
    ? [
        "ICCBased",
        context.register(
          context.stream(profile, {
            N: deviceChannels,
            Alternate: device,
            Filter: "FlateDecode",
          }),
        ),
      ]
    : device;
  const colorSpace =
    colorType === 3
      ? [
          "Indexed",
          base,
          png.palette!.length / 3 - 1,
          lib.PDFHexString.of(
            Array.from(png.palette!, (b) =>
              b.toString(16).padStart(2, "0"),
            ).join(""),
          ),
        ]
      : base;
  const key = hasAlphaChannel || colorType === 3 ? undefined : colourKey(png);
  const parms = (colors: number, bits: number) => ({
    Predictor: 15,
    Colors: colors,
    BitsPerComponent: bits,
    Columns: width,
  });
  const imageDict = (
    bits: number,
    cs: typeof colorSpace | "DeviceGray",
    colors: number,
  ) => ({
    Type: "XObject",
    Subtype: "Image",
    Width: width,
    Height: height,
    BitsPerComponent: bits,
    ColorSpace: cs,
    DecodeParms: parms(colors, bits),
  });

  let stream;
  let smask;
  if (!png.interlaced && !hasAlphaChannel && !paletteTransparency) {
    // The PNG's own compressed, filtered rows ARE a valid PDF image stream.
    if (!filtersValid(raw, passes)) throw new PngDamage("filter type");
    stream = context.stream(png.idat, {
      ...imageDict(bitDepth, colorSpace, channels),
      Filter: "FlateDecode",
      ...(key ? { Mask: key } : {}),
    });
  } else {
    unfilter(raw, passes, bpp);
    const { rows, stride } = assemble(raw, passes, png, bitsPerPixel);
    let colour = rows;
    let colourStride = stride;
    let alpha: Uint8Array | undefined;
    let alphaBits = bitDepth;
    if (hasAlphaChannel) {
      ({ colour, alpha } = splitAlpha(rows, png));
      colourStride = width * colourChannels * (bitDepth >> 3);
    } else if (paletteTransparency) {
      alpha = paletteAlpha(rows, stride, png);
      alphaBits = 8;
    }
    if (alpha) {
      smask = context.register(
        context.flateStream(
          refilter(alpha, width * (alphaBits >> 3), alphaBits >> 3),
          imageDict(alphaBits, "DeviceGray", 1),
        ),
      );
    }
    stream = context.flateStream(
      refilter(
        colour,
        colourStride,
        Math.max(1, (colourChannels * bitDepth) >> 3),
      ),
      {
        ...imageDict(bitDepth, colorSpace, colourChannels),
        ...(smask ? { SMask: smask } : {}),
        ...(key ? { Mask: key } : {}),
      },
    );
  }

  const ref = context.nextRef();
  // pdf-lib's PDFImage takes only its own two embedders (an `instanceof`
  // check), so this borrows PngEmbedder's prototype for that check and
  // overrides everything the image reads of it — the same move `tiff.ts`
  // makes for a TIFF page.
  const embedder = Object.assign(
    Object.create(lib.PngEmbedder.prototype) as object,
    {
      width,
      height,
      embedIntoContext: async (ctx: typeof context, at = ref) => {
        ctx.assign(at, stream);
        return at;
      },
    },
  );
  const image = lib.PDFImage.of(
    ref,
    doc,
    embedder as Parameters<typeof lib.PDFImage.of>[2],
  );
  await image.embed();
  return image;
}
