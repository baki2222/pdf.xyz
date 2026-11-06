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
  jpegWithOrientation,
  JPEG_30X20,
  JPEG_30X20_EXIF6,
  JPEG_HEIGHT,
  JPEG_WIDTH,
} from "@/tests/jpeg-fixtures";
import type { OcrOptions } from "@/lib/jobs/ocr";
import type { NativeOcrConfig } from "./ocr-native-config";
import { createNativeOcrRunner, type NativeOcrFs } from "./ocr-native";
import {
  OCR_IMAGE_MAX_PAGE_INCHES,
  ocrImageDpi,
  ocrReadyImage,
} from "./ocr-image";
import { loadNodeCanvas } from "./pdf-office-export/pdfjs-node";

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
  if (bytes[3] === 0xe0 && bytes[13] === 1)
    return (bytes[14]! << 8) | bytes[15]!;
  return null;
}

/** A plain JPEG of `w` × `h` declaring `dpi` in its JFIF header. */
async function jpegAt(w: number, h: number, dpi: number): Promise<Uint8Array> {
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
  const bytes = new Uint8Array(await c.encode("jpeg"));
  // Health: the canvas wrote a JFIF APP0 where the patch below expects it.
  expect(String.fromCharCode(...bytes.subarray(6, 11))).toBe("JFIF\0");
  bytes[13] = 1;
  bytes[14] = bytes[16] = dpi >> 8;
  bytes[15] = bytes[17] = dpi & 0xff;
  return bytes;
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
    expect(given.path).toMatch(/input\.png$/);
    expect(declaredDpi(given.bytes)).toBe(ocrImageDpi(30, 20, null));
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
