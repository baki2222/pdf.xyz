import { inflateSync } from "node:zlib";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  type PDFContext,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import { encodePng, extractPdfImages, reversePredictor } from "./extract-images";

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
  let header: { width: number; height: number; bitDepth: number; colorType: number } | null =
    null;
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
  const inflated = new Uint8Array(inflateSync(Buffer.concat(idat.map((d) => Buffer.from(d)))));

  const h = header!;
  const channels = h.colorType === 2 ? 3 : 1;
  const rowBytes = Math.ceil((h.width * channels * h.bitDepth) / 8);
  const samples = new Uint8Array(rowBytes * h.height);
  const stride = rowBytes + 1;
  for (let y = 0; y < h.height; y++) {
    expect(inflated[y * stride]).toBe(0); // filter type None
    samples.set(inflated.subarray(y * stride + 1, y * stride + 1 + rowBytes), y * rowBytes);
  }
  return { ...h, samples };
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]!;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
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
    for (let i = 0; i < rowBytes; i++) out[base + 1 + i] = (row[i]! - prev[i]!) & 0xff;
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

// ── The pure PNG encoder ─────────────────────────────────────────────────────

describe("encodePng", () => {
  it("wraps RGB samples in a valid, CRC-correct PNG with exact pixels", () => {
    // 2×2: red, green / blue, white
    const samples = Uint8Array.from([
      255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255,
    ]);
    const png = encodePng(2, 2, "rgb8", samples);
    const decoded = decodePng(png);
    expect(decoded).toMatchObject({ width: 2, height: 2, bitDepth: 8, colorType: 2 });
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
    expect(decoded).toMatchObject({ width: 8, height: 1, bitDepth: 1, colorType: 0 });
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
    expect(reversePredictor(data, { predictor: 1, colors: 1, columns: 3, bitsPerComponent: 8 })).toBe(
      data,
    );
  });
});

// ── Real JPEG extraction (DCTDecode) ─────────────────────────────────────────

describe("extractPdfImages — JPEG", () => {
  it("extracts an embedded JPEG byte-for-byte at its native resolution", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const jpg = await doc.embedJpg(JPG_1X1);
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
    expect([img.bytes[0], img.bytes[1], img.bytes[2]]).toEqual([0xff, 0xd8, 0xff]);
    expect([img.bytes[img.bytes.length - 2], img.bytes[img.bytes.length - 1]]).toEqual([
      0xff, 0xd9,
    ]);
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
    expect(Buffer.from(result.images[0]!.bytes).equals(Buffer.from(JPG_1X1))).toBe(true);
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
          decodeParms: { Predictor: 15, Colors: 3, Columns: 2, BitsPerComponent: 8 },
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
    const png = await doc.embedPng(PNG_1X1);
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
    expect((await skipReasonFor({ ColorSpace: "DeviceGray", BitsPerComponent: 1 }, "CCITTFaxDecode")).reason).toMatch(
      /CCITT/,
    );
    expect((await skipReasonFor({ ColorSpace: "DeviceGray", BitsPerComponent: 1 }, "JBIG2Decode")).reason).toMatch(
      /JBIG2/,
    );
  });

  it("skips Indexed (palette) images", async () => {
    const bytes = await pdfWithImages((ctx) => {
      const cs = PDFArray.withContext(ctx);
      cs.push(PDFName.of("Indexed"));
      cs.push(PDFName.of("DeviceRGB"));
      cs.push(PDFNumber.of(1));
      cs.push(PDFName.of("xx"));
      const stream = ctx.flateStream(new Uint8Array([0, 1]), {
        Type: "XObject",
        Subtype: "Image",
        Width: 2,
        Height: 1,
        BitsPerComponent: 8,
      });
      stream.dict.set(PDFName.of("ColorSpace"), cs);
      return [[stream]];
    });
    const result = await extractPdfImages(bytes);
    expect(result.images).toHaveLength(0);
    expect(result.skipped[0]!.reason).toMatch(/Indexed/);
  });

  it("skips CMYK images", async () => {
    const skip = await skipReasonFor(
      { ColorSpace: "DeviceCMYK", BitsPerComponent: 8, Filter: "FlateDecode" },
    );
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
    const skip = await skipReasonFor({ ImageMask: true, Filter: "FlateDecode" });
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
