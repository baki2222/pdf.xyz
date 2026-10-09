import { deflateSync, inflateSync } from "node:zlib";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFString,
  type PDFContext,
  type PDFObject,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  encodePng,
  extractPdfImages,
  reversePredictor,
} from "./extract-images";
import { embedRasterImage } from "./pdf-lib";

// A real 1×1 JPEG and PNG (the same fixtures the image-to-pdf tool is tested
// with) — genuine encoded image files, not page renders.
const JPG_1X1 = Uint8Array.from(
  Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Ap//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEP/EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EFBABAQAAAAAAAAAAAAAAAAAAARD/2gAIAQEAAT8Qf//Z",
    "base64",
  ),
);
const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  ),
);

// ── Test helpers ─────────────────────────────────────────────────────────────

/** Parse a JPEG's real dimensions from its SOF marker — independent of the PDF. */
function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  const at = (k: number) => bytes[k] ?? 0;
  expect(at(0)).toBe(0xff);
  expect(at(1)).toBe(0xd8); // SOI
  let i = 2;
  while (i < bytes.length) {
    if (at(i) !== 0xff) {
      i++;
      continue;
    }
    const marker = at(i + 1);
    const len = (at(i + 2) << 8) | at(i + 3);
    // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15 carry frame dimensions.
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      const height = (at(i + 5) << 8) | at(i + 6);
      const width = (at(i + 7) << 8) | at(i + 8);
      return { width, height };
    }
    i += 2 + len;
  }
  throw new Error("no SOF marker found");
}

interface DecodedPng {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  /** Raw samples with PNG per-row filter bytes stripped (encoder uses None). */
  samples: Uint8Array;
}

/** Minimal, dependency-light PNG reader used only to verify our encoder output. */
function decodePng(bytes: Uint8Array): DecodedPng {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) expect(bytes[i]).toBe(sig[i]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let off = 8;
  let header: {
    width: number;
    height: number;
    bitDepth: number;
    colorType: number;
  } | null = null;
  const idat: Uint8Array[] = [];
  let sawIend = false;
  while (off < bytes.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(
      bytes[off + 4]!,
      bytes[off + 5]!,
      bytes[off + 6]!,
      bytes[off + 7]!,
    );
    const data = bytes.subarray(off + 8, off + 8 + len);
    // Verify the chunk CRC so a malformed encoder can't slip through.
    const crcInput = bytes.subarray(off + 4, off + 8 + len);
    expect(view.getUint32(off + 8 + len)).toBe(crc32(crcInput));
    if (type === "IHDR") {
      header = {
        width: view.getUint32(off + 8),
        height: view.getUint32(off + 12),
        bitDepth: bytes[off + 16]!,
        colorType: bytes[off + 17]!,
      };
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      sawIend = true;
    }
    off += 12 + len;
  }
  expect(header).not.toBeNull();
  expect(sawIend).toBe(true);
  const inflated = new Uint8Array(
    inflateSync(Buffer.concat(idat.map((d) => Buffer.from(d)))),
  );

  const h = header!;
  // 2 = RGB, 6 = RGBA, 4 = gray+alpha, 0 = gray, 3 = palette index.
  const channels =
    h.colorType === 2 ? 3 : h.colorType === 6 ? 4 : h.colorType === 4 ? 2 : 1;
  const rowBytes = Math.ceil((h.width * channels * h.bitDepth) / 8);
  const samples = new Uint8Array(rowBytes * h.height);
  const stride = rowBytes + 1;
  for (let y = 0; y < h.height; y++) {
    expect(inflated[y * stride]).toBe(0); // filter type None
    samples.set(
      inflated.subarray(y * stride + 1, y * stride + 1 + rowBytes),
      y * rowBytes,
    );
  }
  return { ...h, samples };
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]!;
    for (let k = 0; k < 8; k++)
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Apply the PNG "Up" row filter (type 2) — the inverse of what we reconstruct. */
function pngUpFilter(rows: number[][]): Uint8Array {
  const rowBytes = rows[0]!.length;
  const out = new Uint8Array(rows.length * (rowBytes + 1));
  let prev: number[] = new Array(rowBytes).fill(0);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    const base = r * (rowBytes + 1);
    out[base] = 2; // Up
    for (let i = 0; i < rowBytes; i++)
      out[base + 1 + i] = (row[i]! - prev[i]!) & 0xff;
    prev = row;
  }
  return out;
}

/** Build an image XObject stream in a document's context. */
function flateImage(
  ctx: PDFContext,
  opts: {
    width: number;
    height: number;
    colorSpace: string;
    bitsPerComponent: number;
    samples: Uint8Array;
    decodeParms?: Record<string, number>;
  },
): PDFRawStream {
  const stream = ctx.flateStream(opts.samples, {
    Type: "XObject",
    Subtype: "Image",
    Width: opts.width,
    Height: opts.height,
    ColorSpace: opts.colorSpace,
    BitsPerComponent: opts.bitsPerComponent,
  });
  if (opts.decodeParms) {
    stream.dict.set(PDFName.of("DecodeParms"), ctx.obj(opts.decodeParms));
  }
  return stream;
}

/** Assemble a PDF whose pages carry the given image XObjects (no drawing needed). */
async function pdfWithImages(
  build: (ctx: PDFContext) => PDFRawStream[][],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const pagesImages = build(doc.context);
  for (const images of pagesImages) {
    const page = doc.addPage([200, 200]);
    images.forEach((img, i) => {
      const ref = doc.context.register(img);
      page.node.setXObject(PDFName.of(`Im${i}`), ref);
    });
  }
  return doc.save();
}

/** A PNG colour-type-6 (RGBA) file, encoded independently of the unit under test. */
function rgbaPng(width: number, height: number, rgba: number[]): Uint8Array {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    rows.push(Buffer.from([0]));
    rows.push(Buffer.from(rgba.slice(y * width * 4, (y + 1) * width * 4)));
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Uint8Array.from(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(Buffer.concat(rows))),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

/** Split decoded interleaved samples into per-pixel tuples. */
function pixelsOf(decoded: DecodedPng, channels: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < decoded.samples.length; i += channels)
    out.push(Array.from(decoded.samples.subarray(i, i + channels)));
  return out;
}

/** A palette lookup table as a hex string — the form most writers use. */
function hexLookup(bytes: number[]): PDFHexString {
  return PDFHexString.of(
    bytes.map((b) => b.toString(16).padStart(2, "0")).join(""),
  );
}

/**
 * A palette lookup table as a literal string. `PDFString.of` writes its value
 * between parentheses as-is, so the delimiters a byte can collide with are
 * escaped here, the way a real writer must.
 */
function literalLookup(bytes: number[]): PDFString {
  return PDFString.of(
    bytes
      .map((b) => {
        const ch = String.fromCharCode(b);
        return b === 0x28 || b === 0x29 || b === 0x5c ? `\\${ch}` : ch;
      })
      .join(""),
  );
}

/** Pack per-pixel index values MSB-first into byte-aligned rows. */
function packRows(values: number[], width: number, bpc: number): Uint8Array {
  const height = values.length / width;
  const rowBytes = Math.ceil((width * bpc) / 8);
  const out = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = values[y * width + x]!;
      const bit = x * bpc;
      out[y * rowBytes + (bit >> 3)]! |= v << (8 - bpc - (bit & 7));
    }
  }
  return out;
}

/** Build an `[/Indexed base hival lookup]` image XObject. */
function indexedImage(
  ctx: PDFContext,
  opts: {
    width: number;
    height: number;
    bitsPerComponent: number;
    base: string | PDFObject;
    hival: number;
    lookup: PDFObject;
    indices: Uint8Array;
    decodeParms?: Record<string, number>;
    extra?: Record<string, unknown>;
  },
): PDFRawStream {
  const cs = PDFArray.withContext(ctx);
  cs.push(PDFName.of("Indexed"));
  cs.push(typeof opts.base === "string" ? PDFName.of(opts.base) : opts.base);
  cs.push(PDFNumber.of(opts.hival));
  cs.push(opts.lookup);
  const stream = ctx.flateStream(opts.indices, {
    Type: "XObject",
    Subtype: "Image",
    Width: opts.width,
    Height: opts.height,
    BitsPerComponent: opts.bitsPerComponent,
    ...(opts.extra ?? {}),
  });
  stream.dict.set(PDFName.of("ColorSpace"), cs);
  if (opts.decodeParms) {
    stream.dict.set(PDFName.of("DecodeParms"), ctx.obj(opts.decodeParms));
  }
  return stream;
}

/** An 8-bit DeviceGray soft mask stream. */
function softMask(
  ctx: PDFContext,
  width: number,
  height: number,
  alpha: number[],
  extra: Record<string, unknown> = {},
): PDFRawStream {
  return ctx.flateStream(Uint8Array.from(alpha), {
    Type: "XObject",
    Subtype: "Image",
    Width: width,
    Height: height,
    ColorSpace: "DeviceGray",
    BitsPerComponent: 8,
    ...extra,
  });
}

/**
 * A one-page PDF whose page content is `content` — split across several
 * streams when an array is given, the way many producers write /Contents.
 */
async function pdfWithContent(
  content: string | string[],
  setup?: (doc: PDFDocument) => void,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const parts = Array.isArray(content) ? content : [content];
  const refs = parts.map((c) =>
    doc.context.register(
      doc.context.flateStream(Uint8Array.from(Buffer.from(c, "latin1"))),
    ),
  );
  page.node.set(
    PDFName.of("Contents"),
    refs.length === 1 ? refs[0]! : doc.context.obj(refs),
  );
  setup?.(doc);
  return doc.save();
}

/** `BI … ID <data> EI` for a w×h 8-bit RGB inline image in ASCIIHex. */
function inlineRgb(w: number, h: number, extraKeys = ""): string {
  const hex = "7f".repeat(w * h * 3);
  return `BI /W ${w} /H ${h} /CS /RGB /BPC 8 /F /AHx${extraKeys} ID ${hex}> EI`;
}

// ── The pure PNG encoder ─────────────────────────────────────────────────────

describe("encodePng", () => {
  it("wraps RGB samples in a valid, CRC-correct PNG with exact pixels", () => {
    // 2×2: red, green / blue, white
    const samples = Uint8Array.from([
      255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255,
    ]);
    const png = encodePng(2, 2, "rgb8", samples);
    const decoded = decodePng(png);
    expect(decoded).toMatchObject({
      width: 2,
      height: 2,
      bitDepth: 8,
      colorType: 2,
    });
    expect(Array.from(decoded.samples)).toEqual(Array.from(samples));
  });

  it("encodes 8-bit grayscale", () => {
    const samples = Uint8Array.from([0, 64, 128, 255]);
    const decoded = decodePng(encodePng(4, 1, "gray8", samples));
    expect(decoded).toMatchObject({ bitDepth: 8, colorType: 0 });
    expect(Array.from(decoded.samples)).toEqual([0, 64, 128, 255]);
  });

  it("encodes 1-bit grayscale bitmaps", () => {
    const samples = Uint8Array.from([0b10100000]); // 8 px, 1 row
    const decoded = decodePng(encodePng(8, 1, "gray1", samples));
    expect(decoded).toMatchObject({
      width: 8,
      height: 1,
      bitDepth: 1,
      colorType: 0,
    });
    expect(decoded.samples[0]).toBe(0b10100000);
  });

  it("stays valid across the 65535-byte stored-block boundary", () => {
    const width = 40000; // rowBytes 40000 > one DEFLATE stored block
    const samples = new Uint8Array(width);
    for (let i = 0; i < width; i++) samples[i] = i & 0xff;
    const decoded = decodePng(encodePng(width, 1, "gray8", samples));
    expect(Array.from(decoded.samples)).toEqual(Array.from(samples));
  });
});

// ── Predictor reversal ───────────────────────────────────────────────────────

describe("reversePredictor", () => {
  it("reverses PNG Up-filtered rows", () => {
    const rows = [
      [10, 20, 30, 40, 50, 60],
      [70, 80, 90, 100, 110, 120],
    ];
    const filtered = pngUpFilter(rows);
    const out = reversePredictor(filtered, {
      predictor: 15,
      colors: 3,
      columns: 2,
      bitsPerComponent: 8,
    });
    expect(out).not.toBeNull();
    expect(Array.from(out!)).toEqual(rows.flat());
  });

  it("reverses TIFF horizontal differencing (predictor 2)", () => {
    // Original row [10,20,30, 40,50,60]; TIFF-differenced by bpp=3.
    const diffed = Uint8Array.from([10, 20, 30, 30, 30, 30]);
    const out = reversePredictor(diffed, {
      predictor: 2,
      colors: 3,
      columns: 2,
      bitsPerComponent: 8,
    });
    expect(Array.from(out!)).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it("declines non-8-bit predictors", () => {
    expect(
      reversePredictor(new Uint8Array(4), {
        predictor: 15,
        colors: 1,
        columns: 4,
        bitsPerComponent: 16,
      }),
    ).toBeNull();
  });

  it("passes data through untouched when there is no predictor", () => {
    const data = Uint8Array.from([1, 2, 3]);
    expect(
      reversePredictor(data, {
        predictor: 1,
        colors: 1,
        columns: 3,
        bitsPerComponent: 8,
      }),
    ).toBe(data);
  });
});

// ── Real JPEG extraction (DCTDecode) ─────────────────────────────────────────

describe("extractPdfImages — JPEG", () => {
  it("extracts an embedded JPEG byte-for-byte at its native resolution", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const jpg = await embedRasterImage(doc, JPG_1X1, "jpg");
    page.drawImage(jpg, { x: 0, y: 0, width: 100, height: 100 });
    const bytes = await doc.save();

    const result = await extractPdfImages(bytes);
    expect(result.pageCount).toBe(1);
    expect(result.skipped).toHaveLength(0);
    expect(result.images).toHaveLength(1);

    const img = result.images[0]!;
    expect(img.format).toBe("jpg");
    expect(img.name).toBe("page-001-image-001.jpg");
    // Byte-for-byte identical to the source JPEG — proves it is the embedded
    // image itself, not a re-render.
    expect(Buffer.from(img.bytes).equals(Buffer.from(JPG_1X1))).toBe(true);
    // Magic + terminator of a real JPEG file.
    expect([img.bytes[0], img.bytes[1], img.bytes[2]]).toEqual([
      0xff, 0xd8, 0xff,
    ]);
    expect([
      img.bytes[img.bytes.length - 2],
      img.bytes[img.bytes.length - 1],
    ]).toEqual([0xff, 0xd9]);
    // Reported dimensions match the JPEG's own SOF, not the drawn box (100×100).
    expect({ width: img.width, height: img.height }).toEqual(jpegSize(JPG_1X1));
    expect(img.width).toBe(1);
  });

  it("recovers a JPEG that sits behind a preceding stream filter", async () => {
    // Build [/FlateDecode /DCTDecode]: Flate-compress the JPEG, then declare the
    // chain so the extractor must undo the Flate to reach the JPEG.
    const bytes = await pdfWithImages((ctx) => {
      const stream = ctx.flateStream(JPG_1X1, {
        Type: "XObject",
        Subtype: "Image",
        Width: 1,
        Height: 1,
        ColorSpace: "DeviceRGB",
        BitsPerComponent: 8,
      });
      stream.dict.set(
        PDFName.of("Filter"),
        ctx.obj(["FlateDecode", "DCTDecode"]),
      );
      return [[stream]];
    });

    const result = await extractPdfImages(bytes);
    expect(result.images).toHaveLength(1);
    expect(result.images[0]!.format).toBe("jpg");
    expect(
      Buffer.from(result.images[0]!.bytes).equals(Buffer.from(JPG_1X1)),
    ).toBe(true);
  });
});

// ── Real pixel extraction (Flate → PNG) ──────────────────────────────────────

describe("extractPdfImages — Flate pixel images", () => {
  it("reconstructs an RGB image from raw samples", async () => {
    const samples = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9]);
    const bytes = await pdfWithImages((ctx) => [
      [
        flateImage(ctx, {
          width: 2,
          height: 2,
          colorSpace: "DeviceRGB",
          bitsPerComponent: 8,
          samples,
        }),
      ],
    ]);

    const result = await extractPdfImages(bytes);
    expect(result.skipped).toHaveLength(0);
    expect(result.images).toHaveLength(1);
    const img = result.images[0]!;
    expect(img.format).toBe("png");
    expect(img.name).toBe("page-001-image-001.png");
    expect(img.colorSpace).toBe("DeviceRGB");
    const decoded = decodePng(img.bytes);
    expect(decoded).toMatchObject({ width: 2, height: 2, colorType: 2 });
    expect(Array.from(decoded.samples)).toEqual(Array.from(samples));
  });

  it("reverses a PNG predictor when decoding (the common real-world case)", async () => {
    const rows = [
      [200, 100, 50, 1, 2, 3],
      [40, 80, 120, 160, 200, 240],
    ];
    const predicted = pngUpFilter(rows);
    const bytes = await pdfWithImages((ctx) => [
      [
        flateImage(ctx, {
          width: 2,
          height: 2,
          colorSpace: "DeviceRGB",
          bitsPerComponent: 8,
          samples: predicted,
          decodeParms: {
            Predictor: 15,
            Colors: 3,
            Columns: 2,
            BitsPerComponent: 8,
          },
        }),
      ],
    ]);

    const result = await extractPdfImages(bytes);
    expect(result.images).toHaveLength(1);
    const decoded = decodePng(result.images[0]!.bytes);
    expect(Array.from(decoded.samples)).toEqual(rows.flat());
  });

  it("reconstructs an ICCBased RGB image", async () => {
    const samples = Uint8Array.from([12, 34, 56]);
    const bytes = await pdfWithImages((ctx) => {
      const icc = ctx.flateStream(new Uint8Array([0]), { N: 3 });
      const iccRef = ctx.register(icc);
      const arr = PDFArray.withContext(ctx);
      arr.push(PDFName.of("ICCBased"));
      arr.push(iccRef);
      const stream = ctx.flateStream(samples, {
        Type: "XObject",
        Subtype: "Image",
        Width: 1,
        Height: 1,
        BitsPerComponent: 8,
      });
      stream.dict.set(PDFName.of("ColorSpace"), arr);
      return [[stream]];
    });

    const result = await extractPdfImages(bytes);
    expect(result.images).toHaveLength(1);
    expect(result.images[0]!.colorSpace).toBe("ICCBased(3)");
    const decoded = decodePng(result.images[0]!.bytes);
    expect(Array.from(decoded.samples)).toEqual([12, 34, 56]);
  });

  it("reconstructs an 8-bit grayscale image", async () => {
    const samples = Uint8Array.from([0, 128, 255, 64]);
    const bytes = await pdfWithImages((ctx) => [
      [
        flateImage(ctx, {
          width: 4,
          height: 1,
          colorSpace: "DeviceGray",
          bitsPerComponent: 8,
          samples,
        }),
      ],
    ]);
    const result = await extractPdfImages(bytes);
    expect(result.images).toHaveLength(1);
    const decoded = decodePng(result.images[0]!.bytes);
    expect(decoded).toMatchObject({ colorType: 0, bitDepth: 8 });
    expect(Array.from(decoded.samples)).toEqual([0, 128, 255, 64]);
  });

  it("reconstructs a 1-bit grayscale bitmap", async () => {
    const samples = Uint8Array.from([0b11000000]); // 8 px, 1 row
    const bytes = await pdfWithImages((ctx) => [
      [
        flateImage(ctx, {
          width: 8,
          height: 1,
          colorSpace: "DeviceGray",
          bitsPerComponent: 1,
          samples,
        }),
      ],
    ]);
    const result = await extractPdfImages(bytes);
    expect(result.images).toHaveLength(1);
    const decoded = decodePng(result.images[0]!.bytes);
    expect(decoded).toMatchObject({ bitDepth: 1, colorType: 0 });
    expect(decoded.samples[0]).toBe(0b11000000);
  });

  it("extracts an embedded PNG (pdf-lib stores it as a Flate image)", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const png = await embedRasterImage(doc, PNG_1X1, "png");
    page.drawImage(png, { x: 0, y: 0, width: 100, height: 100 });
    const result = await extractPdfImages(await doc.save());
    expect(result.images).toHaveLength(1);
    expect(result.images[0]!.format).toBe("png");
    const decoded = decodePng(result.images[0]!.bytes);
    expect(decoded).toMatchObject({ width: 1, height: 1 });
  });
});

// ── Naming, dedupe, multi-page ───────────────────────────────────────────────

describe("extractPdfImages — naming & dedupe", () => {
  it("numbers multiple images per page in resource order", async () => {
    const rgb = (ctx: PDFContext, v: number) =>
      flateImage(ctx, {
        width: 1,
        height: 1,
        colorSpace: "DeviceRGB",
        bitsPerComponent: 8,
        samples: Uint8Array.from([v, v, v]),
      });
    const bytes = await pdfWithImages((ctx) => [[rgb(ctx, 1), rgb(ctx, 2)]]);
    const result = await extractPdfImages(bytes);
    expect(result.images.map((i) => i.name)).toEqual([
      "page-001-image-001.png",
      "page-001-image-002.png",
    ]);
  });

  it("extracts a reused image once, attributed to its first page", async () => {
    const doc = await PDFDocument.create();
    const shared = flateImage(doc.context, {
      width: 1,
      height: 1,
      colorSpace: "DeviceRGB",
      bitsPerComponent: 8,
      samples: Uint8Array.from([7, 7, 7]),
    });
    const ref = doc.context.register(shared);
    for (let p = 0; p < 3; p++) {
      doc.addPage([100, 100]).node.setXObject(PDFName.of("Im0"), ref);
    }
    const result = await extractPdfImages(await doc.save());
    expect(result.pageCount).toBe(3);
    expect(result.images).toHaveLength(1);
    expect(result.images[0]!.page).toBe(1);
    expect(result.images[0]!.name).toBe("page-001-image-001.png");
  });

  it("finds images nested inside a Form XObject", async () => {
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const image = flateImage(ctx, {
      width: 1,
      height: 1,
      colorSpace: "DeviceRGB",
      bitsPerComponent: 8,
      samples: Uint8Array.from([3, 3, 3]),
    });
    const imageRef = ctx.register(image);
    // A Form XObject whose own /Resources reference the image.
    const formResources = ctx.obj({});
    const formXobjects = ctx.obj({});
    (formXobjects as PDFDict).set(PDFName.of("Inner"), imageRef);
    (formResources as PDFDict).set(PDFName.of("XObject"), formXobjects);
    const form = ctx.stream(new Uint8Array(0), {
      Type: "XObject",
      Subtype: "Form",
      BBox: [0, 0, 1, 1],
    });
    form.dict.set(PDFName.of("Resources"), formResources);
    const formRef = ctx.register(form);
    doc.addPage([100, 100]).node.setXObject(PDFName.of("Fm0"), formRef);

    const result = await extractPdfImages(await doc.save());
    expect(result.images).toHaveLength(1);
    expect(result.images[0]!.width).toBe(1);
  });

  it("returns nothing for a PDF with no images", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]).drawText("hello");
    const result = await extractPdfImages(await doc.save());
    expect(result.images).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });
});

// ── Honest skips ─────────────────────────────────────────────────────────────

describe("extractPdfImages — honest skips", () => {
  async function skipReasonFor(dict: Record<string, unknown>, filter?: string) {
    const bytes = await pdfWithImages((ctx) => {
      const stream = ctx.stream(new Uint8Array([0, 0, 0, 0]), {
        Type: "XObject",
        Subtype: "Image",
        Width: 1,
        Height: 1,
        ...dict,
        ...(filter ? { Filter: filter } : {}),
      });
      return [[stream]];
    });
    const result = await extractPdfImages(bytes);
    expect(result.images).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    const skip = result.skipped[0];
    expect(skip).toBeDefined();
    return skip!;
  }

  it("skips JPEG 2000 with a clear reason", async () => {
    const skip = await skipReasonFor(
      { ColorSpace: "DeviceRGB", BitsPerComponent: 8 },
      "JPXDecode",
    );
    expect(skip.reason).toMatch(/JPEG 2000/);
    expect(skip.filter).toBe("JPXDecode");
    expect(skip.page).toBe(1);
  });

  it("skips CCITT fax and JBIG2", async () => {
    expect(
      (
        await skipReasonFor(
          { ColorSpace: "DeviceGray", BitsPerComponent: 1 },
          "CCITTFaxDecode",
        )
      ).reason,
    ).toMatch(/CCITT/);
    expect(
      (
        await skipReasonFor(
          { ColorSpace: "DeviceGray", BitsPerComponent: 1 },
          "JBIG2Decode",
        )
      ).reason,
    ).toMatch(/JBIG2/);
  });

  // HISTORY: this block used to hold `it("skips Indexed (palette) images")`,
  // which asserted `images` was EMPTY for a palette image and so pinned the
  // defect as intended behaviour. Palette lookup is lossless, and GIF-style and
  // PNG-8 images are common, so the test is inverted (not deleted) below in
  // "extractPdfImages — Indexed (palette) images". What stays skipped is a
  // palette over a base we cannot write losslessly (CMYK), pinned here.
  it("still skips a palette whose base colour space is CMYK", async () => {
    const bytes = await pdfWithImages((ctx) => [
      [
        indexedImage(ctx, {
          width: 2,
          height: 1,
          bitsPerComponent: 8,
          base: "DeviceCMYK",
          hival: 1,
          lookup: hexLookup([0, 0, 0, 255, 255, 255, 255, 0]),
          indices: Uint8Array.from([0, 1]),
        }),
      ],
    ]);
    const result = await extractPdfImages(bytes);
    expect(result.images).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toMatch(/Indexed/);
    expect(result.skipped[0]!.reason).toMatch(/CMYK/);
  });

  it("skips CMYK images", async () => {
    const skip = await skipReasonFor({
      ColorSpace: "DeviceCMYK",
      BitsPerComponent: 8,
      Filter: "FlateDecode",
    });
    expect(skip.reason).toMatch(/CMYK/);
  });

  it("skips unusual bit depths", async () => {
    const skip = await skipReasonFor({
      ColorSpace: "DeviceRGB",
      BitsPerComponent: 16,
      Filter: "FlateDecode",
    });
    expect(skip.reason).toMatch(/16-bit/);
  });

  it("skips stencil image masks", async () => {
    const skip = await skipReasonFor({
      ImageMask: true,
      Filter: "FlateDecode",
    });
    expect(skip.reason).toMatch(/mask/i);
  });

  it("skips images with a custom /Decode array", async () => {
    const bytes = await pdfWithImages((ctx) => {
      const stream = ctx.flateStream(new Uint8Array([1, 2, 3]), {
        Type: "XObject",
        Subtype: "Image",
        Width: 1,
        Height: 1,
        ColorSpace: "DeviceRGB",
        BitsPerComponent: 8,
        Decode: [1, 0, 1, 0, 1, 0],
      });
      return [[stream]];
    });
    const result = await extractPdfImages(bytes);
    expect(result.images).toHaveLength(0);
    expect(result.skipped[0]!.reason).toMatch(/Decode/);
  });

  it("reports a mix of extracted and skipped images on the same page", async () => {
    const bytes = await pdfWithImages((ctx) => {
      const good = flateImage(ctx, {
        width: 1,
        height: 1,
        colorSpace: "DeviceRGB",
        bitsPerComponent: 8,
        samples: Uint8Array.from([1, 2, 3]),
      });
      const bad = ctx.stream(new Uint8Array([0]), {
        Type: "XObject",
        Subtype: "Image",
        Width: 1,
        Height: 1,
        ColorSpace: "DeviceRGB",
        BitsPerComponent: 8,
        Filter: "JPXDecode",
      });
      return [[good, bad]];
    });
    const result = await extractPdfImages(bytes);
    expect(result.images).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
  });
});

// ── Transparency: /SMask and /Mask ───────────────────────────────────────────
//
// Found 2026-09-27: nothing in the extractor read /SMask or /Mask, so a PNG
// with an alpha channel — including one run through this site's own PNG to
// PDF, which goes through pdf-lib's embedPng — came back as an opaque RGB PNG,
// and nothing said so. These assertions decode the PNG the user downloads.

describe("extractPdfImages — transparency", () => {
  it("round-trips an RGBA PNG embedded by pdf-lib (the PNG to PDF path) with its alpha", async () => {
    // Row 0: fully transparent, opaque red, half-transparent green.
    // Row 1: opaque blue ×2, fully transparent white.
    const rgba = [
      10, 20, 30, 0, 255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 0, 0, 255,
      255, 255, 255, 255, 0,
    ];
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const img = await embedRasterImage(doc, rgbaPng(3, 2, rgba), "png");
    page.drawImage(img, { x: 0, y: 0, width: 90, height: 60 });

    const result = await extractPdfImages(await doc.save());
    expect(result.skipped).toEqual([]);
    expect(result.images).toHaveLength(1);
    const out = result.images[0]!;
    expect(out.note).toBeUndefined();
    const decoded = decodePng(out.bytes);
    expect(decoded).toMatchObject({ width: 3, height: 2, colorType: 6 });
    expect(pixelsOf(decoded, 4)[0]![3]).toBe(0);
    // Lossless: every channel of every pixel, alpha included, as embedded.
    expect(Array.from(decoded.samples)).toEqual(rgba);
  });

  it("writes gray + alpha for a grayscale image with a soft mask", async () => {
    const bytes = await pdfWithImages((ctx) => {
      const image = flateImage(ctx, {
        width: 2,
        height: 1,
        colorSpace: "DeviceGray",
        bitsPerComponent: 8,
        samples: Uint8Array.from([40, 200]),
      });
      image.dict.set(
        PDFName.of("SMask"),
        ctx.register(softMask(ctx, 2, 1, [0, 255])),
      );
      return [[image]];
    });
    const result = await extractPdfImages(bytes);
    const decoded = decodePng(result.images[0]!.bytes);
    expect(decoded).toMatchObject({ colorType: 4, bitDepth: 8 });
    expect(pixelsOf(decoded, 2)).toEqual([
      [40, 0],
      [200, 255],
    ]);
  });

  it("expands a 1-bit bitmap to 8-bit gray so it can carry a soft mask", async () => {
    const bytes = await pdfWithImages((ctx) => {
      const image = flateImage(ctx, {
        width: 3,
        height: 1,
        colorSpace: "DeviceGray",
        bitsPerComponent: 1,
        samples: Uint8Array.from([0b10100000]),
      });
      image.dict.set(
        PDFName.of("SMask"),
        ctx.register(softMask(ctx, 3, 1, [255, 0, 90])),
      );
      return [[image]];
    });
    const decoded = decodePng((await extractPdfImages(bytes)).images[0]!.bytes);
    expect(decoded).toMatchObject({ colorType: 4, bitDepth: 8 });
    expect(pixelsOf(decoded, 2)).toEqual([
      [255, 255],
      [0, 0],
      [255, 90],
    ]);
  });

  it("honours an inverting /Decode [1 0] on the soft mask", async () => {
    const bytes = await pdfWithImages((ctx) => {
      const image = flateImage(ctx, {
        width: 2,
        height: 1,
        colorSpace: "DeviceGray",
        bitsPerComponent: 8,
        samples: Uint8Array.from([1, 2]),
      });
      image.dict.set(
        PDFName.of("SMask"),
        ctx.register(softMask(ctx, 2, 1, [0, 200], { Decode: [1, 0] })),
      );
      return [[image]];
    });
    const decoded = decodePng((await extractPdfImages(bytes)).images[0]!.bytes);
    expect(pixelsOf(decoded, 2)).toEqual([
      [1, 255],
      [2, 55],
    ]);
  });

  it("reverses a predictor on the soft mask using the MASK's one channel", async () => {
    const alphaRows = [
      [0, 50, 100],
      [150, 200, 250],
    ];
    const bytes = await pdfWithImages((ctx) => {
      const image = flateImage(ctx, {
        width: 3,
        height: 2,
        colorSpace: "DeviceRGB",
        bitsPerComponent: 8,
        samples: new Uint8Array(18).fill(9),
      });
      const mask = ctx.flateStream(pngUpFilter(alphaRows), {
        Type: "XObject",
        Subtype: "Image",
        Width: 3,
        Height: 2,
        ColorSpace: "DeviceGray",
        BitsPerComponent: 8,
      });
      mask.dict.set(
        PDFName.of("DecodeParms"),
        ctx.obj({ Predictor: 15, Columns: 3 }),
      );
      image.dict.set(PDFName.of("SMask"), ctx.register(mask));
      return [[image]];
    });
    const decoded = decodePng((await extractPdfImages(bytes)).images[0]!.bytes);
    expect(pixelsOf(decoded, 4).map((p) => p[3])).toEqual(alphaRows.flat());
  });

  it("emits the opaque image WITH a note when the mask is pre-blended (/Matte)", async () => {
    const bytes = await pdfWithImages((ctx) => {
      const image = flateImage(ctx, {
        width: 1,
        height: 1,
        colorSpace: "DeviceRGB",
        bitsPerComponent: 8,
        samples: Uint8Array.from([1, 2, 3]),
      });
      image.dict.set(
        PDFName.of("SMask"),
        ctx.register(softMask(ctx, 1, 1, [7], { Matte: [0, 0, 0] })),
      );
      return [[image]];
    });
    const result = await extractPdfImages(bytes);
    // Never dropped, and never counted as skipped: it WAS extracted.
    expect(result.skipped).toEqual([]);
    expect(result.images).toHaveLength(1);
    expect(result.images[0]!.note).toMatch(/transparency/i);
    expect(result.images[0]!.note).toMatch(/Matte/);
    const decoded = decodePng(result.images[0]!.bytes);
    expect(decoded.colorType).toBe(2);
    expect(Array.from(decoded.samples)).toEqual([1, 2, 3]);
  });

  it("emits the opaque image WITH a note when the mask is a different size", async () => {
    const bytes = await pdfWithImages((ctx) => {
      const image = flateImage(ctx, {
        width: 2,
        height: 1,
        colorSpace: "DeviceRGB",
        bitsPerComponent: 8,
        samples: Uint8Array.from([1, 2, 3, 4, 5, 6]),
      });
      image.dict.set(
        PDFName.of("SMask"),
        ctx.register(softMask(ctx, 4, 2, [0, 0, 0, 0, 0, 0, 0, 0])),
      );
      return [[image]];
    });
    const result = await extractPdfImages(bytes);
    expect(result.skipped).toEqual([]);
    expect(result.images).toHaveLength(1);
    expect(result.images[0]!.note).toMatch(/transparency/i);
    expect(decodePng(result.images[0]!.bytes).colorType).toBe(2);
  });

  it("keeps a JPEG byte-for-byte and notes that its soft mask was not applied", async () => {
    const bytes = await pdfWithImages((ctx) => {
      const jpeg = ctx.stream(JPG_1X1, {
        Type: "XObject",
        Subtype: "Image",
        Width: 1,
        Height: 1,
        ColorSpace: "DeviceGray",
        BitsPerComponent: 8,
        Filter: "DCTDecode",
      });
      jpeg.dict.set(
        PDFName.of("SMask"),
        ctx.register(softMask(ctx, 1, 1, [0])),
      );
      return [[jpeg]];
    });
    const result = await extractPdfImages(bytes);
    expect(result.skipped).toEqual([]);
    const img = result.images[0]!;
    expect(img.format).toBe("jpg");
    expect(Buffer.from(img.bytes).equals(Buffer.from(JPG_1X1))).toBe(true);
    expect(img.note).toMatch(/transparency/i);
  });

  it("applies a colour-key /Mask array", async () => {
    const bytes = await pdfWithImages((ctx) => {
      const image = flateImage(ctx, {
        width: 2,
        height: 1,
        colorSpace: "DeviceRGB",
        bitsPerComponent: 8,
        samples: Uint8Array.from([255, 0, 0, 0, 0, 255]),
      });
      // Key out pure red (every component inside its [min max] range).
      image.dict.set(PDFName.of("Mask"), ctx.obj([250, 255, 0, 5, 0, 5]));
      return [[image]];
    });
    const decoded = decodePng((await extractPdfImages(bytes)).images[0]!.bytes);
    expect(decoded.colorType).toBe(6);
    expect(pixelsOf(decoded, 4)).toEqual([
      [255, 0, 0, 0],
      [0, 0, 255, 255],
    ]);
  });

  it("applies an explicit stencil /Mask stream (1 = masked out)", async () => {
    const bytes = await pdfWithImages((ctx) => {
      const image = flateImage(ctx, {
        width: 3,
        height: 1,
        colorSpace: "DeviceGray",
        bitsPerComponent: 8,
        samples: Uint8Array.from([10, 20, 30]),
      });
      const mask = ctx.flateStream(Uint8Array.from([0b01000000]), {
        Type: "XObject",
        Subtype: "Image",
        Width: 3,
        Height: 1,
        ImageMask: true,
      });
      image.dict.set(PDFName.of("Mask"), ctx.register(mask));
      return [[image]];
    });
    const decoded = decodePng((await extractPdfImages(bytes)).images[0]!.bytes);
    expect(decoded.colorType).toBe(4);
    expect(pixelsOf(decoded, 2)).toEqual([
      [10, 255],
      [20, 0],
      [30, 255],
    ]);
  });

  it("notes a stencil /Mask it cannot line up with the image", async () => {
    const bytes = await pdfWithImages((ctx) => {
      const image = flateImage(ctx, {
        width: 2,
        height: 1,
        colorSpace: "DeviceGray",
        bitsPerComponent: 8,
        samples: Uint8Array.from([10, 20]),
      });
      const mask = ctx.flateStream(Uint8Array.from([0, 0, 0, 0]), {
        Type: "XObject",
        Subtype: "Image",
        Width: 16,
        Height: 2,
        ImageMask: true,
      });
      image.dict.set(PDFName.of("Mask"), ctx.register(mask));
      return [[image]];
    });
    const result = await extractPdfImages(bytes);
    expect(result.skipped).toEqual([]);
    expect(result.images[0]!.note).toMatch(/transparency/i);
    expect(decodePng(result.images[0]!.bytes).colorType).toBe(0);
  });

  it("positive control: an opaque image carries no note and no alpha", async () => {
    const bytes = await pdfWithImages((ctx) => [
      [
        flateImage(ctx, {
          width: 1,
          height: 1,
          colorSpace: "DeviceRGB",
          bitsPerComponent: 8,
          samples: Uint8Array.from([1, 2, 3]),
        }),
      ],
    ]);
    const img = (await extractPdfImages(bytes)).images[0]!;
    expect(img.note).toBeUndefined();
    expect(decodePng(img.bytes).colorType).toBe(2);
  });
});

// ── Indexed (palette) images ─────────────────────────────────────────────────

/** PNG "Sub" row filter (type 1) at 1 byte per pixel. */
function pngSubFilter(rows: Uint8Array[]): Uint8Array {
  const rowBytes = rows[0]!.length;
  const out = new Uint8Array(rows.length * (rowBytes + 1));
  rows.forEach((row, r) => {
    const base = r * (rowBytes + 1);
    out[base] = 1;
    for (let i = 0; i < rowBytes; i++)
      out[base + 1 + i] = (row[i]! - (i > 0 ? row[i - 1]! : 0)) & 0xff;
  });
  return out;
}

describe("extractPdfImages — Indexed (palette) images", () => {
  const RED_BLUE = [255, 0, 0, 0, 0, 255];

  it("expands an 8-bit RGB palette to exact colours", async () => {
    const bytes = await pdfWithImages((ctx) => [
      [
        indexedImage(ctx, {
          width: 2,
          height: 2,
          bitsPerComponent: 8,
          base: "DeviceRGB",
          hival: 1,
          lookup: hexLookup(RED_BLUE),
          indices: Uint8Array.from([0, 1, 1, 0]),
        }),
      ],
    ]);
    const result = await extractPdfImages(bytes);
    expect(result.skipped).toEqual([]);
    expect(result.images).toHaveLength(1);
    const img = result.images[0]!;
    expect(img.format).toBe("png");
    expect(img.colorSpace).toMatch(/Indexed/);
    const decoded = decodePng(img.bytes);
    expect(decoded).toMatchObject({ width: 2, height: 2, colorType: 2 });
    expect(pixelsOf(decoded, 3)).toEqual([
      [255, 0, 0],
      [0, 0, 255],
      [0, 0, 255],
      [255, 0, 0],
    ]);
  });

  it("unpacks 4-bit indices across a padded row, with a literal-string table", async () => {
    // Three entries. 40 is "(" and must arrive escaped; 0xC8 (>127) must be
    // read as a byte, not decoded as text.
    const table = [10, 20, 30, 40, 50, 60, 0xc8, 0x11, 0x22];
    const indices = [0, 1, 2, 2, 1, 0]; // 3×2, so each row is 2 bytes (1 pad nibble)
    const bytes = await pdfWithImages((ctx) => [
      [
        indexedImage(ctx, {
          width: 3,
          height: 2,
          bitsPerComponent: 4,
          base: "DeviceRGB",
          hival: 2,
          lookup: literalLookup(table),
          indices: packRows(indices, 3, 4),
        }),
      ],
    ]);
    const decoded = decodePng((await extractPdfImages(bytes)).images[0]!.bytes);
    expect(pixelsOf(decoded, 3)).toEqual(
      indices.map((i) => table.slice(i * 3, i * 3 + 3)),
    );
  });

  it("writes gray for a 1-bit palette over DeviceGray", async () => {
    const indices = [0, 1, 1, 0, 0, 0, 1, 1, 1, 0]; // width 10 → 2-byte rows
    const bytes = await pdfWithImages((ctx) => [
      [
        indexedImage(ctx, {
          width: 10,
          height: 1,
          bitsPerComponent: 1,
          base: "DeviceGray",
          hival: 1,
          lookup: hexLookup([0x40, 0xc0]),
          indices: packRows(indices, 10, 1),
        }),
      ],
    ]);
    const decoded = decodePng((await extractPdfImages(bytes)).images[0]!.bytes);
    expect(decoded).toMatchObject({ colorType: 0, bitDepth: 8 });
    expect(Array.from(decoded.samples)).toEqual(
      indices.map((i) => (i ? 0xc0 : 0x40)),
    );
  });

  it("reads the table from a stream and resolves an ICCBased base", async () => {
    const bytes = await pdfWithImages((ctx) => {
      const icc = ctx.register(ctx.flateStream(new Uint8Array([0]), { N: 3 }));
      const base = PDFArray.withContext(ctx);
      base.push(PDFName.of("ICCBased"));
      base.push(icc);
      const table = ctx.register(ctx.flateStream(Uint8Array.from(RED_BLUE)));
      return [
        [
          indexedImage(ctx, {
            width: 2,
            height: 1,
            bitsPerComponent: 8,
            base,
            hival: 1,
            lookup: table,
            indices: Uint8Array.from([1, 0]),
          }),
        ],
      ];
    });
    const decoded = decodePng((await extractPdfImages(bytes)).images[0]!.bytes);
    expect(pixelsOf(decoded, 3)).toEqual([
      [0, 0, 255],
      [255, 0, 0],
    ]);
  });

  it("reverses a PNG predictor on 8-bit indices with ONE colour, not the base's three", async () => {
    const rows = [Uint8Array.from([0, 1, 1]), Uint8Array.from([1, 0, 1])];
    const bytes = await pdfWithImages((ctx) => [
      [
        indexedImage(ctx, {
          width: 3,
          height: 2,
          bitsPerComponent: 8,
          base: "DeviceRGB",
          hival: 1,
          lookup: hexLookup(RED_BLUE),
          indices: pngSubFilter(rows),
          decodeParms: { Predictor: 15, Columns: 3 },
        }),
      ],
    ]);
    const result = await extractPdfImages(bytes);
    expect(result.skipped).toEqual([]);
    const decoded = decodePng(result.images[0]!.bytes);
    expect(pixelsOf(decoded, 3)).toEqual(
      [0, 1, 1, 1, 0, 1].map((i) => RED_BLUE.slice(i * 3, i * 3 + 3)),
    );
  });

  it("reverses a PNG predictor on 4-bit indices (how pdfTeX embeds PNG-8)", async () => {
    const indices = [0, 1, 2, 3, 3, 2, 1, 0, 1, 1];
    const table = [0, 0, 0, 90, 90, 90, 170, 170, 170, 255, 255, 255];
    const packed = packRows(indices, 5, 4); // 3 bytes per row
    const rows = [packed.subarray(0, 3), packed.subarray(3, 6)];
    const bytes = await pdfWithImages((ctx) => [
      [
        indexedImage(ctx, {
          width: 5,
          height: 2,
          bitsPerComponent: 4,
          base: "DeviceRGB",
          hival: 3,
          lookup: hexLookup(table),
          indices: pngSubFilter(rows),
          decodeParms: {
            Predictor: 15,
            Colors: 1,
            BitsPerComponent: 4,
            Columns: 5,
          },
        }),
      ],
    ]);
    const result = await extractPdfImages(bytes);
    expect(result.skipped).toEqual([]);
    const decoded = decodePng(result.images[0]!.bytes);
    expect(pixelsOf(decoded, 3)).toEqual(
      indices.map((i) => table.slice(i * 3, i * 3 + 3)),
    );
  });

  it("clamps an index above hival to the last entry", async () => {
    const bytes = await pdfWithImages((ctx) => [
      [
        indexedImage(ctx, {
          width: 2,
          height: 1,
          bitsPerComponent: 8,
          base: "DeviceRGB",
          hival: 1,
          lookup: hexLookup(RED_BLUE),
          indices: Uint8Array.from([0, 200]),
        }),
      ],
    ]);
    const decoded = decodePng((await extractPdfImages(bytes)).images[0]!.bytes);
    expect(pixelsOf(decoded, 3)).toEqual([
      [255, 0, 0],
      [0, 0, 255],
    ]);
  });

  it("skips a palette whose table is shorter than it declares", async () => {
    const bytes = await pdfWithImages((ctx) => [
      [
        indexedImage(ctx, {
          width: 2,
          height: 1,
          bitsPerComponent: 8,
          base: "DeviceRGB",
          hival: 3,
          lookup: hexLookup(RED_BLUE),
          indices: Uint8Array.from([0, 1]),
        }),
      ],
    ]);
    const result = await extractPdfImages(bytes);
    expect(result.images).toHaveLength(0);
    expect(result.skipped[0]!.reason).toMatch(/palette/i);
  });

  it("accepts the default /Decode [0 2^bpc-1] and still skips a remapping one", async () => {
    const make = (decode: number[]) =>
      pdfWithImages((ctx) => [
        [
          indexedImage(ctx, {
            width: 2,
            height: 1,
            bitsPerComponent: 4,
            base: "DeviceRGB",
            hival: 1,
            lookup: hexLookup(RED_BLUE),
            indices: packRows([0, 1], 2, 4),
            extra: { Decode: decode },
          }),
        ],
      ]);
    const identity = await extractPdfImages(await make([0, 15]));
    expect(identity.skipped).toEqual([]);
    expect(identity.images).toHaveLength(1);
    const remapped = await extractPdfImages(await make([15, 0]));
    expect(remapped.images).toHaveLength(0);
    expect(remapped.skipped[0]!.reason).toMatch(/Decode/);
  });

  it("applies a colour-key /Mask on the INDEX (how GIF transparency is stored)", async () => {
    const bytes = await pdfWithImages((ctx) => [
      [
        indexedImage(ctx, {
          width: 2,
          height: 1,
          bitsPerComponent: 8,
          base: "DeviceRGB",
          hival: 1,
          lookup: hexLookup(RED_BLUE),
          indices: Uint8Array.from([0, 1]),
          extra: { Mask: [1, 1] },
        }),
      ],
    ]);
    const decoded = decodePng((await extractPdfImages(bytes)).images[0]!.bytes);
    expect(decoded.colorType).toBe(6);
    expect(pixelsOf(decoded, 4)).toEqual([
      [255, 0, 0, 255],
      [0, 0, 255, 0],
    ]);
  });
});

// ── Inline images (BI … ID … EI) ─────────────────────────────────────────────
//
// Found 2026-09-27: the extractor only walked /XObject resources, so a page
// whose image was written inline produced `{ images: 0, skipped: 0 }`, and the
// runner told the user the PDF had no images. They are now found and reported
// as skipped; extracting their pixels is not done yet.

describe("extractPdfImages — inline images", () => {
  it("reports an inline image as skipped instead of reporting nothing", async () => {
    const result = await extractPdfImages(
      await pdfWithContent(`q 40 0 0 40 10 10 cm ${inlineRgb(4, 4)} Q`),
    );
    expect(result.images).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!).toMatchObject({ page: 1 });
    expect(result.skipped[0]!.reason).toMatch(/inline image/i);
  });

  it("negative control: BI inside a string, a name or a comment is not an image", async () => {
    const result = await extractPdfImages(
      await pdfWithContent(
        "BT /F1 12 Tf (BI /W 4 ID xx EI) Tj ET\n/BI BMC EMC\n% BI ID EI\nq Q",
      ),
    );
    expect(result.skipped).toEqual([]);
  });

  it("counts one image when its binary data happens to contain BI … ID", async () => {
    // Uncompressed 8×1 gray whose eight sample bytes are literally "BI ID xx".
    // It needs the ID too: a scanner that re-reads the data only counts an
    // image once it reaches an ID, so data holding "BI" alone proved nothing
    // (a mutation that stopped skipping to EI stayed green on that fixture).
    const content = "q BI /W 8 /H 1 /CS /G /BPC 8 ID BI ID xx\nEI Q q Q";
    const result = await extractPdfImages(await pdfWithContent(content));
    expect(result.skipped).toHaveLength(1);
  });

  it("counts every inline image, across a /Contents array", async () => {
    const result = await extractPdfImages(
      await pdfWithContent(["q Q", `${inlineRgb(1, 1)}\n${inlineRgb(2, 1)}`]),
    );
    expect(result.skipped).toHaveLength(2);
  });

  it("finds an inline image drawn inside a Form XObject", async () => {
    const bytes = await pdfWithContent("q /Fm0 Do Q", (doc) => {
      const ctx = doc.context;
      const form = ctx.flateStream(
        Uint8Array.from(Buffer.from(inlineRgb(2, 2), "latin1")),
        { Type: "XObject", Subtype: "Form", BBox: [0, 0, 1, 1] },
      );
      doc.getPage(0).node.setXObject(PDFName.of("Fm0"), ctx.register(form));
    });
    const result = await extractPdfImages(bytes);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toMatch(/inline image/i);
  });

  it("reports an inline stencil mask the way an XObject stencil is reported", async () => {
    const result = await extractPdfImages(
      await pdfWithContent("BI /W 8 /H 1 /IM true ID ÿ\nEI"),
    );
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toMatch(/stencil/i);
  });
});
