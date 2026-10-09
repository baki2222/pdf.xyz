// @vitest-environment node
/**
 * The one-component JPEG encoder, read back by a decoder that is not ours.
 *
 * Every assertion about pixels goes through pdf.js (`decodePageImages`): the
 * image is embedded the way the product embeds it (`embedRasterImage`, which
 * lets pdf-lib pick the colour space from the frame header) and decoded the way
 * a viewer decodes it. An encoder checked against its own idea of the format
 * would certify that idea, not the file.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  encodeGrayJpeg,
  grayJpegQuantTable,
  jpegComponentCount,
  optimalHuffmanTable,
} from "./gray-jpeg";
import { embedRasterImage } from "./pdf-lib";
import { decodePageImages } from "@/tests/pdf-image-decode";

/** A real 3-component (YCbCr) JPEG, the same 1×1 file the other image tests use. */
const RGB_JPEG_1X1 = Uint8Array.from(
  Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Ap//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEP/EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EFBABAQAAAAAAAAAAAAAAAAAAARD/2gAIAQEAAT8Qf//Z",
    "base64",
  ),
);

/** ITU T.81 Table K.1, natural order — typed out as the spec prints it. */
const TABLE_K1 = [
  [16, 11, 10, 16, 24, 40, 51, 61],
  [12, 12, 14, 19, 26, 58, 60, 55],
  [14, 13, 16, 24, 40, 57, 69, 56],
  [14, 17, 22, 29, 51, 87, 80, 62],
  [18, 22, 37, 56, 68, 109, 103, 77],
  [24, 35, 55, 64, 81, 104, 113, 92],
  [49, 64, 78, 87, 103, 121, 120, 101],
  [72, 92, 95, 98, 112, 100, 103, 99],
].flat();

/** Deterministic test planes: a gradient with seeded noise, or a constant. */
function plane(
  width: number,
  height: number,
  kind: "texture" | "flat",
  seed = 7,
): Uint8Array {
  const out = new Uint8Array(width * height);
  let s = seed;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      out[y * width + x] =
        kind === "flat"
          ? 200
          : Math.min(
              255,
              ((x * 255) / Math.max(1, width - 1)) * 0.6 + (s % 96),
            );
    }
  }
  return out;
}

function psnr(a: Uint8Array, b: Uint8Array): number {
  let se = 0;
  for (let i = 0; i < a.length; i++) se += (a[i]! - b[i]!) ** 2;
  return se === 0 ? Infinity : 10 * Math.log10((255 * 255) / (se / a.length));
}

/** Embed as the product does, then decode as a viewer does. */
async function roundTrip(jpeg: Uint8Array) {
  const doc = await PDFDocument.create();
  const image = await embedRasterImage(doc, jpeg, "jpg");
  doc
    .addPage([image.width, image.height])
    .drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  const [decoded, ...rest] = await decodePageImages(await doc.save());
  expect(rest).toEqual([]);
  return decoded!;
}

describe("grayJpegQuantTable", () => {
  it("is Table K.1 itself at quality 50, as libjpeg's scaling defines", () => {
    expect([...grayJpegQuantTable(0.5)]).toEqual(TABLE_K1);
  });

  it("scales toward all-ones at 100 and clamps to baseline's 255 at 1", () => {
    expect([...grayJpegQuantTable(1)]).toEqual(Array(64).fill(1));
    expect(Math.max(...grayJpegQuantTable(0))).toBe(255);
    // Quality 88: scale 24, so every entry is floor((K1 * 24 + 50) / 100).
    expect([...grayJpegQuantTable(0.88)]).toEqual(
      TABLE_K1.map((v) => Math.max(1, Math.floor((v * 24 + 50) / 100))),
    );
  });
});

describe("optimalHuffmanTable", () => {
  /** Every property a decoder relies on, checked from the table alone. */
  function checkTable(freq: number[]) {
    const table = optimalHuffmanTable(freq);
    const used = freq.flatMap((f, symbol) => (f > 0 ? [symbol] : []));
    // Exactly the symbols that occur, each with a code of 1..16 bits.
    expect([...table.values].sort((a, b) => a - b)).toEqual(used);
    for (const symbol of used) {
      expect(table.size[symbol]).toBeGreaterThanOrEqual(1);
      expect(table.size[symbol]).toBeLessThanOrEqual(16);
    }
    // Kraft sum strictly below 1: the reserved code point is really reserved,
    // so no symbol is given the all-ones code T.81 forbids.
    const kraft = used.reduce((sum, s) => sum + 2 ** -table.size[s]!, 0);
    expect(kraft).toBeLessThan(1);
    for (const s of used) {
      expect(table.code[s]).not.toBe(2 ** table.size[s]! - 1);
    }
    // Prefix-free.
    const words = used.map((s) =>
      table.code[s]!.toString(2).padStart(table.size[s]!, "0"),
    );
    for (const a of words) {
      for (const b of words) {
        if (a !== b) expect(b.startsWith(a)).toBe(false);
      }
    }
    return table;
  }

  it("builds a valid table for one symbol, a few, and a full alphabet", () => {
    checkTable([5]);
    checkTable([0, 3, 0, 9, 1]);
    checkTable(Array.from({ length: 256 }, (_, i) => (i * 7919) % 101));
  });

  it("limits code lengths to 16 bits when the ideal tree is deeper", () => {
    // Powers of two: every symbol outweighs all the lighter ones combined, so
    // the unbounded tree is a chain one level deeper per symbol and 30 of
    // them want a ~30-bit code. The limiter must engage, and this is the input
    // that proves it does (a max of exactly 16). Fibonacci frequencies, the
    // textbook example, do NOT: equal-weight merges keep that tree at depth
    // 16 on its own — measured, with the limiter removed, when this test was
    // first written that way and stayed green.
    const chain = Array.from({ length: 30 }, (_, i) => 2 ** i);
    const table = checkTable(chain);
    expect(Math.max(...chain.map((_, s) => table.size[s]!))).toBe(16);
  });
});

describe("jpegComponentCount", () => {
  it("reads the frame header: 3 for a YCbCr JPEG, null for non-JPEG bytes", () => {
    expect(jpegComponentCount(RGB_JPEG_1X1)).toBe(3);
    expect(jpegComponentCount(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(
      null,
    );
  });
});

describe("encodeGrayJpeg, decoded by pdf.js", () => {
  // Sizes chosen to hit every edge-padding case: a single pixel, an exact
  // block, a width and height that are both off-block, and a thin strip.
  const SHAPES: Array<[number, number]> = [
    [1, 1],
    [8, 8],
    [9, 17],
    [3, 100],
    [64, 48],
  ];

  it.each(SHAPES)(
    "%i×%i: one component, DeviceGray, right size, faithful pixels",
    async (width, height) => {
      for (const kind of ["texture", "flat"] as const) {
        const source = plane(width, height, kind);
        const jpeg = encodeGrayJpeg(source, width, height, 0.88);
        expect(jpegComponentCount(jpeg)).toBe(1);

        const decoded = await roundTrip(jpeg);
        expect([decoded.width, decoded.height]).toEqual([width, height]);
        expect(decoded.channelsEqual).toBe(true);
        // A flat image has no AC energy to quantize away; a noisy texture at
        // 0.88 measured 34-36 dB here, and libjpeg-turbo matched our PSNR to
        // 0.03 dB on photographs (see the commit that added this file).
        expect(psnr(source, decoded.gray)).toBeGreaterThan(
          kind === "flat" ? 48 : 30,
        );
      }
    },
  );

  it("gets more faithful as quality rises, and is near-lossless at 1", async () => {
    const source = plane(64, 48, "texture", 11);
    const scores: number[] = [];
    for (const quality of [0.1, 0.5, 0.88, 1]) {
      const decoded = await roundTrip(encodeGrayJpeg(source, 64, 48, quality));
      scores.push(psnr(source, decoded.gray));
    }
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i - 1]!);
    }
    expect(scores.at(-1)).toBeGreaterThan(45);
  });

  it("control: the same decode sees a damaged stream as damaged", async () => {
    // The comparison above is only worth something if a broken encode FAILS
    // it. Flip bits inside the entropy-coded segment of a good file.
    const source = plane(64, 48, "texture", 3);
    const jpeg = encodeGrayJpeg(source, 64, 48, 0.88);
    const sos = jpeg.findIndex((b, i) => b === 0xff && jpeg[i + 1] === 0xda);
    const damaged = jpeg.slice();
    for (let i = sos + 20; i < damaged.length - 40; i += 13) {
      if (damaged[i] !== 0xff && damaged[i - 1] !== 0xff)
        damaged[i] = damaged[i]! ^ 0x5a;
    }
    let score = 0;
    try {
      score = psnr(source, (await roundTrip(damaged)).gray);
    } catch {
      score = 0; // an undecodable stream is as damaged as it gets
    }
    expect(score).toBeLessThan(30);
  });

  it("rejects a plane that does not match its dimensions", () => {
    expect(() => encodeGrayJpeg(new Uint8Array(10), 4, 4)).toThrow(RangeError);
    expect(() => encodeGrayJpeg(new Uint8Array(0), 0, 0)).toThrow(RangeError);
  });
});
