// @native-canvas
/**
 * Audit #9 (2026-11-06): a phone photo reached Tesseract with its EXIF turn
 * and its 72 dpi untouched. Leptonica applies neither, so a portrait photo
 * was read sideways and a 4032-pixel one became a 56-inch page.
 *
 * These tests read what Tesseract is GIVEN — the file the runner writes —
 * the way Leptonica reads it: stored pixels, EXIF ignored (the tag is set to
 * "as stored" before decoding), and the declared resolution. Only the Linux
 * worker image, with Tesseract installed, can show the recognised text.
 */
import { describe, expect, it } from "vitest";
import { uprightJpeg } from "@/lib/pdf/jpeg-orientation";
import { displayedGrid } from "@/tests/exif-display";
import {
  exifApp1,
  jpegWithOrientation,
  spliceAfterSoi,
  JPEG_30X20,
  JPEG_30X20_EXIF6,
  JPEG_HEIGHT,
  JPEG_WIDTH,
} from "@/tests/jpeg-fixtures";
import { OCR_IMAGE_MAX_TURN_PIXELS, type OcrOptions } from "@/lib/jobs/ocr";
import type { NativeOcrConfig } from "./ocr-native-config";
import { createNativeOcrRunner, type NativeOcrFs } from "./ocr-native";
import {
  OCR_IMAGE_MAX_PAGE_INCHES,
  ocrImageDpi,
  ocrReadyImage,
} from "./ocr-image";
import { loadNodeCanvas } from "./pdf-office-export/pdfjs-node";
import { MAX_DECODED_IMAGE_PIXELS } from "./pdf-office-export/picture-limits";

interface Decoded {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

/** Decode as Leptonica does: the stored pixels, whatever the EXIF tag says. */
async function asTesseractSees(bytes: Uint8Array): Promise<Decoded> {
  const canvas = loadNodeCanvas();
  const image = await canvas.loadImage(uprightJpeg(bytes).bytes);
  const c = canvas.createCanvas(image.width, image.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  return { width: image.width, height: image.height, rgba: data };
}

function isRed(d: Decoded, x: number, y: number): boolean {
  const i = (y * d.width + x) * 4;
  return d.rgba[i]! > 180 && d.rgba[i + 1]! < 90 && d.rgba[i + 2]! < 90;
}

/** The declared dpi: a PNG's pHYs, or a JPEG's JFIF density in inches. */
function declaredDpi(bytes: Uint8Array): number | null {
  if (bytes[0] === 0x89) {
    for (let at = 8; at + 8 <= bytes.length;) {
      const v = new DataView(bytes.buffer, bytes.byteOffset);
      const length = v.getUint32(at);
      const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
      if (type === "pHYs" && bytes[at + 16] === 1)
        return Math.round(v.getUint32(at + 8) * 0.0254);
      at += 12 + length;
    }
    return null;
  }
  // libjpeg takes a JFIF APP0 wherever it sits before the scan, and
  // Leptonica reads its density only in units 1 (inch) or 2 (cm).
  for (let at = 2; at + 4 <= bytes.length && bytes[at] === 0xff;) {
    const marker = bytes[at + 1]!;
    if (marker === 0xda) break;
    const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
    const id = String.fromCharCode(...bytes.subarray(at + 4, at + 9));
    if (marker === 0xe0 && id === "JFIF\0") {
      const units = bytes[at + 11]!;
      const x = (bytes[at + 12]! << 8) | bytes[at + 13]!;
      if (units === 1) return x;
      if (units === 2) return Math.round(x * 2.54);
      return null;
    }
    at += 2 + length;
  }
  return null;
}

/** `jpeg` without its first JFIF APP0 (health: it had one at offset 2). */
function withoutJfif(jpeg: Uint8Array): Uint8Array {
  expect([jpeg[2], jpeg[3]]).toEqual([0xff, 0xe0]);
  const length = (jpeg[4]! << 8) | jpeg[5]!;
  const out = new Uint8Array(jpeg.length - 2 - length);
  out.set(jpeg.subarray(0, 2));
  out.set(jpeg.subarray(4 + length), 2);
  return out;
}

/** `jpeg` with `segment` placed after its JFIF APP0, where a camera puts Exif. */
function afterJfif(jpeg: Uint8Array, segment: Uint8Array): Uint8Array {
  expect([jpeg[2], jpeg[3]]).toEqual([0xff, 0xe0]);
  const at = 4 + ((jpeg[4]! << 8) | jpeg[5]!);
  const out = new Uint8Array(jpeg.length + segment.length);
  out.set(jpeg.subarray(0, at));
  out.set(segment, at);
  out.set(jpeg.subarray(at), at + segment.length);
  return out;
}

/** A plain white JPEG of `w` × `h` exactly as the canvas encodes it. */
async function canvasJpeg(w: number, h: number): Promise<Uint8Array> {
  const canvas = loadNodeCanvas() as unknown as {
    createCanvas(
      w: number,
      h: number,
    ): {
      getContext(k: "2d"): {
        fillStyle: string;
        fillRect(x: number, y: number, w: number, h: number): void;
      };
      encode(f: "jpeg"): Promise<Uint8Array>;
    };
  };
  const c = canvas.createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  return new Uint8Array(await c.encode("jpeg"));
}

/** A plain JPEG of `w` × `h` declaring `dpi` in its JFIF header. */
async function jpegAt(w: number, h: number, dpi: number): Promise<Uint8Array> {
  const bytes = await canvasJpeg(w, h);
  // Health: the canvas wrote a JFIF APP0 where the patch below expects it.
  expect(String.fromCharCode(...bytes.subarray(6, 11))).toBe("JFIF\0");
  bytes[13] = 1;
  bytes[14] = bytes[16] = dpi >> 8;
  bytes[15] = bytes[17] = dpi & 0xff;
  return bytes;
}

/** SOI, an Exif APP1 with `orientation`, a baseline frame header, EOI. */
function headerOnlyJpeg(w: number, h: number, orientation: number): Uint8Array {
  const sof = Uint8Array.of(
    0xff,
    0xc0,
    0x00,
    0x11,
    8,
    h >> 8,
    h & 0xff,
    w >> 8,
    w & 0xff,
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
  );
  const body = new Uint8Array(sof.length + 4);
  body.set([0xff, 0xd8]);
  body.set(sof, 2);
  body.set([0xff, 0xd9], 2 + sof.length);
  return spliceAfterSoi(body, exifApp1(orientation));
}

const CONFIG: NativeOcrConfig = {
  enabled: true,
  binaries: { ocrmypdf: "ocrmypdf", tesseract: "tesseract" },
  overridden: { ocrmypdf: false, tesseract: false },
  timeoutMs: 300_000,
  maxInputBytes: 200 * 1024 * 1024,
  maxOutputBytes: 500 * 1024 * 1024,
};
const TEXT_ONLY: OcrOptions = {
  languages: ["eng"],
  outputMode: "text",
  redoOcr: false,
  deskew: false,
  rotatePages: false,
};

/** Run the real runner on `bytes` and return the file it handed Tesseract. */
async function givenToTesseract(
  bytes: Uint8Array,
): Promise<{ path: string; bytes: Uint8Array }> {
  const written = new Map<string, Uint8Array>();
  let inputArg = "";
  const fs: NativeOcrFs = {
    mkdtemp: async (prefix) => `${prefix}x`,
    writeFile: async (file, data) => void written.set(file, data),
    readFile: async (file) => {
      if (file.endsWith(".tsv")) return new Uint8Array(0);
      return new TextEncoder().encode("text");
    },
    rm: async () => {},
  };
  const run = createNativeOcrRunner(CONFIG, {
    resolveOnPath: (bin) => bin === "tesseract",
    fs,
    exec: async (command, args) => {
      expect(command).toBe("tesseract");
      inputArg = args[0]!;
    },
  });
  await run({
    options: TEXT_ONLY,
    inputs: [
      {
        fileId: "f_1234567890",
        filename: "receipt.jpg",
        contentType: "image/jpeg",
        bytes,
      },
    ],
  });
  const given = written.get(inputArg);
  if (!given) throw new Error(`tesseract was given ${inputArg}, never written`);
  return { path: inputArg, bytes: given };
}

describe("OCR of a phone photo: Tesseract is given it upright, on a sane page (audit #9)", () => {
  it("a JPEG tagged 'turn 90°' is handed over turned: 20 × 30, red block top-right", async () => {
    // Health: the fixture really is stored sideways, red top-left.
    const stored = await asTesseractSees(JPEG_30X20_EXIF6);
    expect([stored.width, stored.height]).toEqual([JPEG_WIDTH, JPEG_HEIGHT]);
    expect(isRed(stored, 2, 2)).toBe(true);

    const given = await givenToTesseract(JPEG_30X20_EXIF6);
    const seen = await asTesseractSees(given.bytes);
    expect([seen.width, seen.height]).toEqual([JPEG_HEIGHT, JPEG_WIDTH]);
    expect(isRed(seen, JPEG_HEIGHT - 3, 2)).toBe(true);
    expect(isRed(seen, 2, 2)).toBe(false);
    // Re-encoded as a JPEG, not a PNG: a photo's searchable PDF then embeds
    // a JPEG about the size of the upload, not a lossless copy many times it.
    expect(given.path).toMatch(/input\.jpg$/);
    expect(declaredDpi(given.bytes)).toBe(ocrImageDpi(30, 20, null));
  });

  it("a big portrait phone photo (orientation 6) is turned AND declares an A4-long page", async () => {
    const photo = afterJfif(await jpegAt(2400, 1800, 72), exifApp1(6));
    expect(declaredDpi(photo)).toBe(72);
    const given = await givenToTesseract(photo);
    const seen = await asTesseractSees(given.bytes);
    expect([seen.width, seen.height]).toEqual([1800, 2400]);
    const dpi = declaredDpi(given.bytes)!;
    expect(dpi).toBe(Math.ceil(2400 / OCR_IMAGE_MAX_PAGE_INCHES));
    expect(2400 / dpi).toBeLessThanOrEqual(OCR_IMAGE_MAX_PAGE_INCHES);
  });

  it("a phone JPEG with Exif and NO JFIF segment gets a declared, A4-long resolution", async () => {
    // iPhone and Samsung cameras write FFD8 FFE1 (Exif) and no APP0; their
    // 72 dpi is in EXIF XResolution, which Leptonica never reads.
    const tail = withoutJfif(await canvasJpeg(2400, 1800));
    const photo = spliceAfterSoi(tail, exifApp1(1));
    expect([photo[2], photo[3]]).toEqual([0xff, 0xe1]);
    expect(declaredDpi(photo)).toBeNull();
    const given = await givenToTesseract(photo);
    expect(given.path).toMatch(/input\.jpg$/);
    const dpi = declaredDpi(given.bytes)!;
    expect(dpi).toBe(Math.ceil(2400 / OCR_IMAGE_MAX_PAGE_INCHES));
    expect(2400 / dpi).toBeLessThanOrEqual(OCR_IMAGE_MAX_PAGE_INCHES);
    // Only a segment was added: everything after SOI is the photo's own.
    expect(given.bytes.subarray(given.bytes.length - photo.length + 2)).toEqual(
      photo.subarray(2),
    );
  });

  it("a JFIF 'units 0' JPEG, as the canvas itself writes one, gets an A4-long resolution", async () => {
    const photo = await canvasJpeg(2400, 1800);
    // Health: the encoder really wrote JFIF with units 0 (no dpi at all).
    expect(String.fromCharCode(...photo.subarray(6, 11))).toBe("JFIF\0");
    expect(photo[13]).toBe(0);
    expect(declaredDpi(photo)).toBeNull();
    const given = await givenToTesseract(photo);
    const dpi = declaredDpi(given.bytes)!;
    expect(dpi).toBe(Math.ceil(2400 / OCR_IMAGE_MAX_PAGE_INCHES));
    expect(given.bytes.length).toBe(photo.length);
  });

  it("CONTROL: a units-0 JPEG whose page fits A4 even at Tesseract's 70 dpi floor is untouched", async () => {
    // 800 / 70 = 11.43 inches: Tesseract's own estimate (never below 70)
    // already keeps it within A4, so its estimate is left to it.
    const small = await canvasJpeg(800, 600);
    const given = await givenToTesseract(small);
    expect(given.bytes).toBe(small);
  });

  it("a turned JPEG over the pixel ceiling is never decoded, but still gets an A4-long page", async () => {
    let decoded = 0;
    const canvas = () => {
      decoded++;
      throw new Error("canvas unavailable");
    };
    // 10,000 × 10,000 = 100 MP, over the ceiling: never handed to the canvas.
    const big = headerOnlyJpeg(10_000, 10_000, 6);
    const out = await ocrReadyImage(big, "jpg", canvas);
    expect(decoded).toBe(0);
    expect(out.ext).toBe("jpg");
    expect(declaredDpi(out.bytes)).toBe(
      Math.ceil(10_000 / OCR_IMAGE_MAX_PAGE_INCHES),
    );
    // Positive control: just under the ceiling, the canvas IS asked (and its
    // failure still leaves a bounded page, not a failed job).
    const under = headerOnlyJpeg(8_000, 7_999, 6);
    expect(8_000 * 7_999).toBeLessThanOrEqual(OCR_IMAGE_MAX_TURN_PIXELS);
    const fell = await ocrReadyImage(under, "jpg", canvas);
    expect(decoded).toBe(1);
    expect(declaredDpi(fell.bytes)).toBe(
      Math.ceil(8_000 / OCR_IMAGE_MAX_PAGE_INCHES),
    );
  });

  it("the pixel ceiling is the one the worker's page reader takes for one picture", () => {
    expect(OCR_IMAGE_MAX_TURN_PIXELS).toBe(MAX_DECODED_IMAGE_PIXELS);
  });

  it.each([2, 3, 4, 5, 6, 7, 8] as const)(
    "orientation %i: the red block is where a browser shows it",
    async (orientation) => {
      // The oracle is pixel-grid operations (`@/tests/exif-display`), not the
      // transform table under test. Stored red is rows/cols 0-9; find where
      // the stored pixel (5, 5) is shown.
      const grid = displayedGrid(JPEG_WIDTH, JPEG_HEIGHT, orientation);
      const label = 5 * JPEG_WIDTH + 5;
      const y = grid.findIndex((row) => row.includes(label));
      const x = grid[y]!.indexOf(label);
      const given = await givenToTesseract(jpegWithOrientation(orientation));
      const seen = await asTesseractSees(given.bytes);
      expect([seen.width, seen.height]).toEqual([grid[0]!.length, grid.length]);
      expect(isRed(seen, x, y), `(${x}, ${y})`).toBe(true);
      // And not where it was stored, unless the turn leaves it there.
      if (x !== 5 || y !== 5) expect(isRed(seen, 5, 5)).toBe(false);
    },
  );

  it("CONTROL: a JPEG with no turn to make is handed over byte for byte", async () => {
    const given = await givenToTesseract(JPEG_30X20);
    expect(given.bytes).toBe(JPEG_30X20);
    expect(given.path).toMatch(/input\.jpg$/);
  });

  it("a 72 dpi photo too big for A4 declares the dpi that makes its page A4-long, no more", async () => {
    const photo = await jpegAt(2400, 1800, 72);
    expect(declaredDpi(photo)).toBe(72);
    const given = await givenToTesseract(photo);
    const dpi = declaredDpi(given.bytes)!;
    expect(dpi).toBe(Math.ceil(2400 / OCR_IMAGE_MAX_PAGE_INCHES));
    expect(2400 / dpi).toBeLessThanOrEqual(OCR_IMAGE_MAX_PAGE_INCHES);
    // Only the density changed: same length, same pixels.
    expect(given.bytes.length).toBe(photo.length);
    expect(given.bytes.subarray(20)).toEqual(photo.subarray(20));
  });

  it("CONTROL: a 300 dpi scan that already fits keeps its own resolution", async () => {
    const scan = await jpegAt(2400, 1800, 300);
    const given = await givenToTesseract(scan);
    expect(given.bytes).toBe(scan);
  });

  it("a PNG is not touched", async () => {
    const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    expect((await ocrReadyImage(png, "png")).bytes).toBe(png);
  });

  it("A4 is the bound: 11.69 inches", () => {
    expect(OCR_IMAGE_MAX_PAGE_INCHES).toBeCloseTo(297 / 25.4, 2);
  });
});
