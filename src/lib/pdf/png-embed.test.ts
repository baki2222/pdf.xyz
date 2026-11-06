// @native-canvas
/**
 * PNG into JPG / PNG to PDF, kept as a PNG keeps it (audit #10, 2026-11-06).
 *
 * HISTORY: every PNG went through pdf-lib 1.17.1's `PngEmbedder`, which
 * decodes to 8-bit RGBA, stores the colour as DeviceRGB (greyscale and
 * palette images expanded to three channels), deflates it WITHOUT PNG's row
 * predictors, and drops the iCCP colour profile. A smooth 1200×800 RGB
 * gradient of ~16 KB came out as a ~460 KB PDF (28×), which pushed users onto
 * the JPEG size ladder that blurs the screenshots this tool promises to keep
 * crisp; a P3 screenshot lost its profile and shifted colour.
 *
 * The oracle is never the embedder's own reader: each fixture below is built
 * here from known pixels with Node's zlib, and every PDF is re-opened from
 * its saved bytes and RENDERED by pdf.js, so a palette, a polarity, a bit
 * depth or an alpha channel that came out wrong shows up as pixels.
 */
import { createRequire } from "node:module";
import { deflateSync, inflateSync } from "node:zlib";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderPdfPages } from "@/tests/pdf-render";
import { imagesToPdf, imagesToPdfs } from "./image-to-pdf";
import type { ImagePageOptions } from "./image-page-layout";

const FIT: ImagePageOptions = {
  pageSize: "fit",
  orientation: "auto",
  margin: "none",
};

// ── A small PNG writer, independent of the code under test ────────────────

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as const;
type ColorType = keyof typeof CHANNELS;

interface PngSpec {
  width: number;
  height: number;
  colorType: ColorType;
  bitDepth: 1 | 2 | 4 | 8 | 16;
  /** Samples, row-major, one number per channel per pixel. */
  samples: (x: number, y: number) => number[];
  palette?: number[][];
  trns?: Uint8Array;
  iccp?: Uint8Array;
  interlace?: boolean;
  extra?: Buffer[];
}

/** Pack one row of pixels at `bitDepth`, PNG order (MSB first). */
function packRow(spec: PngSpec, xs: number[], y: number): Uint8Array {
  const channels = CHANNELS[spec.colorType];
  const bits = spec.bitDepth;
  const out = new Uint8Array(Math.ceil((xs.length * channels * bits) / 8));
  let bit = 0;
  for (const x of xs) {
    for (const v of spec.samples(x, y)) {
      if (bits === 16) {
        out[bit >> 3] = v >> 8;
        out[(bit >> 3) + 1] = v & 0xff;
      } else {
        out[bit >> 3]! |= v << (8 - bits - (bit & 7));
      }
      bit += bits;
    }
  }
  return out;
}

/** Paeth-filter `rows` (as a real encoder would) and deflate them. */
function filtered(rows: Uint8Array[], bpp: number): Buffer {
  const parts: Uint8Array[] = [];
  let prev: Uint8Array = new Uint8Array(rows[0]?.length ?? 0);
  for (const row of rows) {
    const out = new Uint8Array(row.length + 1);
    out[0] = 4;
    for (let i = 0; i < row.length; i++) {
      const a = i >= bpp ? row[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      out[i + 1] = (row[i]! - pred) & 0xff;
    }
    parts.push(out);
    prev = row;
  }
  return Buffer.concat(parts);
}

const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

function pngOf(spec: PngSpec): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(spec.width, 0);
  ihdr.writeUInt32BE(spec.height, 4);
  ihdr[8] = spec.bitDepth;
  ihdr[9] = spec.colorType;
  ihdr[12] = spec.interlace ? 1 : 0;
  const bpp = Math.max(1, (CHANNELS[spec.colorType] * spec.bitDepth) / 8);
  const range = (from: number, to: number, step: number) => {
    const out: number[] = [];
    for (let i = from; i < to; i += step) out.push(i);
    return out;
  };
  let raw: Buffer;
  if (!spec.interlace) {
    const xs = range(0, spec.width, 1);
    raw = filtered(
      range(0, spec.height, 1).map((y) => packRow(spec, xs, y)),
      bpp,
    );
  } else {
    raw = Buffer.concat(
      ADAM7.map(([x0, y0, dx, dy]) => {
        const xs = range(x0, spec.width, dx);
        const ys = range(y0, spec.height, dy);
        if (xs.length === 0 || ys.length === 0) return Buffer.alloc(0);
        return filtered(
          ys.map((y) => packRow(spec, xs, y)),
          bpp,
        );
      }),
    );
  }
  const chunks = [chunk("IHDR", ihdr)];
  if (spec.iccp) {
    chunks.push(
      chunk(
        "iCCP",
        Buffer.concat([
          Buffer.from("Display P3\0\0", "latin1"),
          deflateSync(spec.iccp),
        ]),
      ),
    );
  }
  if (spec.palette)
    chunks.push(chunk("PLTE", Uint8Array.from(spec.palette.flat())));
  if (spec.trns) chunks.push(chunk("tRNS", spec.trns));
  chunks.push(...(spec.extra ?? []));
  // Two IDATs, as encoders that stream do: the embedder must join them.
  const z = deflateSync(raw, { level: 9 });
  const half = z.length >> 1;
  chunks.push(chunk("IDAT", z.subarray(0, half)));
  chunks.push(chunk("IDAT", z.subarray(half)));
  chunks.push(chunk("IEND", new Uint8Array(0)));
  return new Uint8Array(
    Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]),
  );
}

/** A minimal ICC header: what the embedder may check, and nothing more. */
function iccHeader(space: "RGB " | "GRAY"): Uint8Array {
  const icc = Buffer.alloc(132);
  icc.writeUInt32BE(132, 0);
  icc.write("mntr", 12, "latin1");
  icc.write(space, 16, "latin1");
  icc.write("XYZ ", 20, "latin1");
  icc.write("acsp", 36, "latin1");
  return new Uint8Array(icc);
}

/**
 * Skia's PNG decoder (pdf.js's own canvas here): the health check that the
 * writer above encodes what it was asked to, so the embedder and its fixtures
 * cannot agree on a mistake both of them make.
 */
const napi = createRequire(
  createRequire(import.meta.url).resolve("pdfjs-dist/package.json"),
)("@napi-rs/canvas") as {
  loadImage(bytes: Buffer): Promise<{ width: number; height: number }>;
  createCanvas(
    w: number,
    h: number,
  ): {
    getContext(kind: "2d"): {
      drawImage(image: unknown, x: number, y: number): void;
      getImageData(
        x: number,
        y: number,
        w: number,
        h: number,
      ): { data: Uint8ClampedArray };
    };
  };
};

async function decodedBySkia(png: Uint8Array) {
  const image = await napi.loadImage(Buffer.from(png));
  const ctx = napi.createCanvas(image.width, image.height).getContext("2d");
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, image.width, image.height).data;
}

// ── Reading the PDF back ───────────────────────────────────────────────────

async function convert(png: Uint8Array): Promise<Uint8Array> {
  return imagesToPdf(
    "png",
    [{ name: "x.png", type: "image/png", bytes: png }],
    FIT,
  );
}

/** The one base image XObject in `pdf` (not its soft mask). */
async function baseImage(pdf: Uint8Array) {
  const doc = await PDFDocument.load(pdf);
  const images: PDFRawStream[] = [];
  const masks = new Set<PDFRawStream>();
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (obj.dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
    images.push(obj);
    const smask = obj.dict.get(PDFName.of("SMask"));
    if (smask instanceof PDFRef)
      masks.add(doc.context.lookup(smask) as PDFRawStream);
  }
  const base = images.filter((i) => !masks.has(i));
  expect(base).toHaveLength(1);
  const image = base[0]!;
  const get = (key: string) => image.dict.get(PDFName.of(key));
  const lookup = (v: unknown) =>
    v instanceof PDFRef ? doc.context.lookup(v) : v;
  return { doc, image, get, lookup };
}

/** What a viewer paints over white, for a pixel of colour `rgb` and alpha `a`/255. */
const over = (rgb: number[], a = 255) =>
  rgb.map((c) => Math.round((c * a + 255 * (255 - a)) / 255));

async function expectRenders(
  pdf: Uint8Array,
  width: number,
  height: number,
  expected: (x: number, y: number) => number[],
  tolerance = 3,
) {
  const [page] = await renderPdfPages(pdf, Math.max(width, height));
  expect(page!.width).toBe(width);
  expect(page!.height).toBe(height);
  let worst = 0;
  let where = "";
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const want = expected(x, y);
      const i = (y * width + x) * 4;
      for (let k = 0; k < 3; k++) {
        const d = Math.abs(page!.data[i + k]! - want[k]!);
        if (d > worst) {
          worst = d;
          where = `(${x},${y}) got ${[...page!.data.subarray(i, i + 3)]} want ${want}`;
        }
      }
    }
  }
  expect(worst, where).toBeLessThanOrEqual(tolerance);
}

// ── The fixtures ───────────────────────────────────────────────────────────

const W = 24;
const H = 16;
const rgbAt = (x: number, y: number) => [
  (x * 10) & 0xff,
  (y * 15) & 0xff,
  ((x + y) * 7) & 0xff,
];
const PALETTE = [
  [255, 0, 0],
  [0, 128, 0],
  [0, 0, 255],
  [250, 200, 20],
  [20, 20, 20],
];

describe("PNG embedding keeps the PNG's own encoding (audit #10)", () => {
  it("a smooth RGB gradient PDF is about the size of the PNG, not ~28× it", async () => {
    const png = pngOf({
      width: 1200,
      height: 800,
      colorType: 2,
      bitDepth: 8,
      samples: (x, y) => [
        Math.round((x / 1199) * 255),
        Math.round((y / 799) * 255),
        Math.round(((x + y) / 1998) * 255),
      ],
    });
    const pdf = await convert(png);
    // A PDF's own scaffolding is ~1 KB; everything else is the image.
    expect(pdf.length).toBeLessThan(png.length + 4096);
    const { get } = await baseImage(pdf);
    expect(get("ColorSpace")).toBe(PDFName.of("DeviceRGB"));
    const parms = get("DecodeParms") as PDFDict;
    expect(parms.get(PDFName.of("Predictor"))).toEqual(PDFNumber.of(15));
  });

  it("RGB renders pixel for pixel", async () => {
    const pdf = await convert(
      pngOf({ width: W, height: H, colorType: 2, bitDepth: 8, samples: rgbAt }),
    );
    await expectRenders(pdf, W, H, rgbAt);
  });

  it("8-bit greyscale stays one-channel DeviceGray", async () => {
    const g = (x: number, y: number) => [(x * 9 + y * 5) & 0xff];
    const pdf = await convert(
      pngOf({ width: W, height: H, colorType: 0, bitDepth: 8, samples: g }),
    );
    const { get } = await baseImage(pdf);
    expect(get("ColorSpace")).toBe(PDFName.of("DeviceGray"));
    expect(get("BitsPerComponent")).toEqual(PDFNumber.of(8));
    await expectRenders(pdf, W, H, (x, y) => [
      g(x, y)[0]!,
      g(x, y)[0]!,
      g(x, y)[0]!,
    ]);
  });

  it("1-bit greyscale stays one bit per pixel", async () => {
    const bw = (x: number, y: number) => [(x + y) % 3 === 0 ? 1 : 0];
    const pdf = await convert(
      pngOf({ width: W, height: H, colorType: 0, bitDepth: 1, samples: bw }),
    );
    const { get } = await baseImage(pdf);
    expect(get("ColorSpace")).toBe(PDFName.of("DeviceGray"));
    expect(get("BitsPerComponent")).toEqual(PDFNumber.of(1));
    await expectRenders(pdf, W, H, (x, y) =>
      bw(x, y)[0] ? [255, 255, 255] : [0, 0, 0],
    );
  });

  it("a palette PNG stays Indexed, at its own bit depth", async () => {
    const idx = (x: number, y: number) => [(x + 2 * y) % PALETTE.length];
    const pdf = await convert(
      pngOf({
        width: W,
        height: H,
        colorType: 3,
        bitDepth: 4,
        palette: PALETTE,
        samples: idx,
      }),
    );
    const { get, lookup } = await baseImage(pdf);
    const cs = lookup(get("ColorSpace")) as PDFArray;
    expect(cs.get(0)).toBe(PDFName.of("Indexed"));
    expect(cs.get(1)).toBe(PDFName.of("DeviceRGB"));
    expect(cs.get(2)).toEqual(PDFNumber.of(PALETTE.length - 1));
    expect(get("BitsPerComponent")).toEqual(PDFNumber.of(4));
    await expectRenders(pdf, W, H, (x, y) => PALETTE[idx(x, y)[0]!]!);
  });

  it("a palette PNG with tRNS keeps its palette and gets a soft mask", async () => {
    const alpha = [255, 0, 128, 255, 60];
    const idx = (x: number, y: number) => [(x + y) % PALETTE.length];
    const pdf = await convert(
      pngOf({
        width: W,
        height: H,
        colorType: 3,
        bitDepth: 8,
        palette: PALETTE,
        trns: Uint8Array.from(alpha),
        samples: idx,
      }),
    );
    const { get } = await baseImage(pdf);
    expect(get("SMask")).toBeInstanceOf(PDFRef);
    await expectRenders(pdf, W, H, (x, y) => {
      const i = idx(x, y)[0]!;
      return over(PALETTE[i]!, alpha[i]);
    });
  });

  it("RGBA with real transparency keeps RGB colour and an 8-bit soft mask", async () => {
    const px = (x: number, y: number) => [...rgbAt(x, y), (x * 11) & 0xff];
    const pdf = await convert(
      pngOf({ width: W, height: H, colorType: 6, bitDepth: 8, samples: px }),
    );
    const { get, lookup } = await baseImage(pdf);
    expect(get("ColorSpace")).toBe(PDFName.of("DeviceRGB"));
    const mask = lookup(get("SMask")) as PDFRawStream;
    expect(mask.dict.get(PDFName.of("ColorSpace"))).toBe(
      PDFName.of("DeviceGray"),
    );
    await expectRenders(pdf, W, H, (x, y) => over(rgbAt(x, y), px(x, y)[3]));
  });

  it("an opaque RGBA screenshot needs no soft mask, and stays small", async () => {
    const px = (x: number, y: number) => [
      Math.round((x / 1199) * 255),
      Math.round((y / 799) * 255),
      90,
      255,
    ];
    const png = pngOf({
      width: 1200,
      height: 800,
      colorType: 6,
      bitDepth: 8,
      samples: px,
    });
    const pdf = await convert(png);
    const { get } = await baseImage(pdf);
    expect(get("SMask")).toBeUndefined();
    expect(pdf.length).toBeLessThan(png.length * 1.5 + 4096);
  });

  it("grey with alpha stays DeviceGray, with a soft mask", async () => {
    const px = (x: number, y: number) => [(x * 9) & 0xff, (y * 16) & 0xff];
    const pdf = await convert(
      pngOf({ width: W, height: H, colorType: 4, bitDepth: 8, samples: px }),
    );
    const { get } = await baseImage(pdf);
    expect(get("ColorSpace")).toBe(PDFName.of("DeviceGray"));
    expect(get("SMask")).toBeInstanceOf(PDFRef);
    await expectRenders(pdf, W, H, (x, y) => {
      const [g, a] = px(x, y) as [number, number];
      return over([g, g, g], a);
    });
  });

  it("16-bit RGB keeps sixteen bits per channel", async () => {
    const px = (x: number, y: number) =>
      rgbAt(x, y).map((v) => v * 257 + (x & 1));
    const pdf = await convert(
      pngOf({ width: W, height: H, colorType: 2, bitDepth: 16, samples: px }),
    );
    const { get } = await baseImage(pdf);
    expect(get("BitsPerComponent")).toEqual(PDFNumber.of(16));
    await expectRenders(pdf, W, H, rgbAt);
  });

  it("an RGB colour key (tRNS) becomes a /Mask of that colour", async () => {
    const key = [10, 15, 7];
    const pdf = await convert(
      pngOf({
        width: W,
        height: H,
        colorType: 2,
        bitDepth: 8,
        trns: Uint8Array.from([0, 10, 0, 15, 0, 7]),
        samples: rgbAt,
      }),
    );
    const { get, lookup } = await baseImage(pdf);
    const mask = lookup(get("Mask")) as PDFArray;
    expect(mask.asArray().map((n) => (n as PDFNumber).asNumber())).toEqual([
      10, 10, 15, 15, 7, 7,
    ]);
    await expectRenders(pdf, W, H, (x, y) => {
      const c = rgbAt(x, y);
      return c.every((v, k) => v === key[k]) ? [255, 255, 255] : c;
    });
  });

  it("an interlaced (Adam7) PNG renders pixel for pixel", async () => {
    const pdf = await convert(
      pngOf({
        width: W - 3,
        height: H - 5,
        colorType: 2,
        bitDepth: 8,
        interlace: true,
        samples: rgbAt,
      }),
    );
    await expectRenders(pdf, W - 3, H - 5, rgbAt);
  });

  it("an interlaced 2-bit palette PNG renders pixel for pixel", async () => {
    const idx = (x: number, y: number) => [(x * 3 + y) % 4];
    const pdf = await convert(
      pngOf({
        width: 13,
        height: 9,
        colorType: 3,
        bitDepth: 2,
        palette: PALETTE.slice(0, 4),
        interlace: true,
        samples: idx,
      }),
    );
    await expectRenders(pdf, 13, 9, (x, y) => PALETTE[idx(x, y)[0]!]!);
  });
});

describe("the fixture writer, checked by an independent decoder", () => {
  it("Skia reads the interlaced and low-depth fixtures as the pixels asked for", async () => {
    const cases = [
      {
        spec: {
          width: 13,
          height: 9,
          colorType: 3,
          bitDepth: 2,
          palette: PALETTE.slice(0, 4),
          interlace: true,
          samples: (x: number, y: number) => [(x * 3 + y) % 4],
        } satisfies PngSpec,
        rgb: (x: number, y: number) => PALETTE[(x * 3 + y) % 4]!,
      },
      {
        spec: {
          width: W - 3,
          height: H - 5,
          colorType: 2,
          bitDepth: 8,
          interlace: true,
          samples: rgbAt,
        } satisfies PngSpec,
        rgb: rgbAt,
      },
      {
        spec: {
          width: W,
          height: H,
          colorType: 0,
          bitDepth: 1,
          samples: (x: number, y: number) => [(x + y) % 3 === 0 ? 1 : 0],
        } satisfies PngSpec,
        rgb: (x: number, y: number) =>
          (x + y) % 3 === 0 ? [255, 255, 255] : [0, 0, 0],
      },
    ];
    for (const { spec, rgb } of cases) {
      const data = await decodedBySkia(pngOf(spec));
      // Positive control: the decode produced the whole image, not nothing.
      expect(data.length).toBe(spec.width * spec.height * 4);
      for (let y = 0; y < spec.height; y++)
        for (let x = 0; x < spec.width; x++) {
          const i = (y * spec.width + x) * 4;
          expect([...data.subarray(i, i + 3)], `(${x},${y})`).toEqual(
            rgb(x, y),
          );
        }
    }
  });
});

describe("PNG colour profiles are kept (audit #10, iCCP)", () => {
  it("an RGB PNG's iCCP becomes an ICCBased colour space with N 3", async () => {
    const icc = iccHeader("RGB ");
    const pdf = await convert(
      pngOf({
        width: W,
        height: H,
        colorType: 2,
        bitDepth: 8,
        samples: rgbAt,
        iccp: icc,
      }),
    );
    const { get, lookup } = await baseImage(pdf);
    const cs = lookup(get("ColorSpace")) as PDFArray;
    expect(cs.get(0)).toBe(PDFName.of("ICCBased"));
    const profile = lookup(cs.get(1)) as PDFRawStream;
    expect(profile.dict.get(PDFName.of("N"))).toEqual(PDFNumber.of(3));
    expect(profile.dict.get(PDFName.of("Alternate"))).toBe(
      PDFName.of("DeviceRGB"),
    );
    expect(new Uint8Array(inflateSync(profile.contents))).toEqual(icc);
  });

  it("a greyscale PNG's profile is ICCBased with N 1", async () => {
    const pdf = await convert(
      pngOf({
        width: W,
        height: H,
        colorType: 0,
        bitDepth: 8,
        samples: (x) => [x * 5],
        iccp: iccHeader("GRAY"),
      }),
    );
    const { get, lookup } = await baseImage(pdf);
    const cs = lookup(get("ColorSpace")) as PDFArray;
    const profile = lookup(cs.get(1)) as PDFRawStream;
    expect(profile.dict.get(PDFName.of("N"))).toEqual(PDFNumber.of(1));
  });

  it("a palette PNG's profile is the Indexed base", async () => {
    const pdf = await convert(
      pngOf({
        width: W,
        height: H,
        colorType: 3,
        bitDepth: 8,
        palette: PALETTE,
        samples: (x) => [x % PALETTE.length],
        iccp: iccHeader("RGB "),
      }),
    );
    const { get, lookup } = await baseImage(pdf);
    const cs = lookup(get("ColorSpace")) as PDFArray;
    expect(cs.get(0)).toBe(PDFName.of("Indexed"));
    const base = lookup(cs.get(1)) as PDFArray;
    expect(base.get(0)).toBe(PDFName.of("ICCBased"));
  });

  it("an RGBA PNG's profile is kept too", async () => {
    const pdf = await convert(
      pngOf({
        width: W,
        height: H,
        colorType: 6,
        bitDepth: 8,
        samples: (x, y) => [...rgbAt(x, y), 200],
        iccp: iccHeader("RGB "),
      }),
    );
    const { get, lookup } = await baseImage(pdf);
    const cs = lookup(get("ColorSpace")) as PDFArray;
    expect(cs.get(0)).toBe(PDFName.of("ICCBased"));
  });

  it("a profile that does not match the colour type is dropped, not trusted", async () => {
    const pdf = await convert(
      pngOf({
        width: W,
        height: H,
        colorType: 2,
        bitDepth: 8,
        samples: rgbAt,
        iccp: iccHeader("GRAY"),
      }),
    );
    const { get } = await baseImage(pdf);
    expect(get("ColorSpace")).toBe(PDFName.of("DeviceRGB"));
  });
});

describe("damaged PNGs are still refused, not embedded as noise", () => {
  it("a truncated image stream is refused by name", async () => {
    const good = pngOf({
      width: W,
      height: H,
      colorType: 2,
      bitDepth: 8,
      samples: rgbAt,
    });
    // Cut the second IDAT's data short, CRC fixed up, so the chunk is valid
    // and only the pixels are missing.
    const buf = Buffer.from(good);
    let at = 8;
    const parts: Buffer[] = [buf.subarray(0, 8)];
    let idats = 0;
    while (at < buf.length) {
      const len = buf.readUInt32BE(at);
      const type = buf.toString("latin1", at + 4, at + 8);
      const data = buf.subarray(at + 8, at + 8 + len);
      if (type === "IDAT" && ++idats === 2) {
        parts.push(chunk("IDAT", data.subarray(0, data.length >> 2)));
      } else parts.push(buf.subarray(at, at + 12 + len));
      at += 12 + len;
    }
    await expect(
      imagesToPdf("png", [
        {
          name: "cut.png",
          type: "image/png",
          bytes: new Uint8Array(Buffer.concat(parts)),
        },
      ]),
    ).rejects.toThrow(/"cut\.png" could not be decoded as a PNG image/);
  });

  it("a two-frame APNG is still refused", async () => {
    const actl = Buffer.alloc(8);
    actl.writeUInt32BE(2, 0);
    const png = pngOf({
      width: W,
      height: H,
      colorType: 2,
      bitDepth: 8,
      samples: rgbAt,
      extra: [chunk("acTL", actl)],
    });
    await expect(
      imagesToPdf("png", [{ name: "anim.png", type: "image/png", bytes: png }]),
    ).rejects.toThrow(/"anim\.png" could not be decoded as a PNG image/);
  });

  it("the per-image ZIP path embeds the same way", async () => {
    const [one] = await imagesToPdfs(
      "png",
      [
        {
          name: "g.png",
          type: "image/png",
          bytes: pngOf({
            width: W,
            height: H,
            colorType: 0,
            bitDepth: 8,
            samples: (x) => [x * 5],
          }),
        },
      ],
      FIT,
    );
    const { get } = await baseImage(one!.bytes);
    expect(get("ColorSpace")).toBe(PDFName.of("DeviceGray"));
  });

  it("JPG to PDF takes a PNG through the same embedder", async () => {
    const png = pngOf({
      width: W,
      height: H,
      colorType: 0,
      bitDepth: 8,
      samples: (x) => [x * 5],
    });
    const pdf = await imagesToPdf(
      "jpg",
      [{ name: "g.png", type: "image/png", bytes: png }],
      FIT,
    );
    const { get } = await baseImage(pdf);
    expect(get("ColorSpace")).toBe(PDFName.of("DeviceGray"));
  });
});
