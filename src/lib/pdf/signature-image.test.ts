import { describe, expect, it } from "vitest";
import { crc32, deflateSync } from "node:zlib";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { readAsViewer } from "@/tests/pdf-viewer-read";
import { signPdf } from "./signature";
import {
  SIGNATURE_MAX_EDGE,
  inkBounds,
  prepareSignatureBitmap,
  type RgbaImage,
} from "./signature-image";

/**
 * Signature bitmaps: cropped to the ink, paper keyed out, resolution bounded.
 *
 * The audit (at 67e8d0f): the pad exported its whole 520×180 canvas, so the
 * Size control sized the canvas and not the signature; an uploaded photo of a
 * signature on paper landed as an opaque rectangle over the page; and a phone
 * photo was embedded at full resolution as a lossless PNG. Every answer below
 * is known in advance from how the synthetic pixels were drawn.
 */

/** A canvas-like RGBA image filled with one colour. */
function canvas(
  width: number,
  height: number,
  fill: [number, number, number, number],
): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { width, height, data };
}

function paint(
  img: RgbaImage,
  box: { x: number; y: number; width: number; height: number },
  rgba: [number, number, number, number],
) {
  for (let y = box.y; y < box.y + box.height; y += 1) {
    for (let x = box.x; x < box.x + box.width; x += 1) {
      img.data.set(rgba, (y * img.width + x) * 4);
    }
  }
}

const INK: [number, number, number, number] = [15, 23, 42, 255];
const BLUE_INK: [number, number, number, number] = [20, 40, 160, 255];

/** A drawn signature: ink in the middle of a transparent 520×180 pad. */
function drawnPad() {
  const pad = canvas(520, 180, [0, 0, 0, 0]);
  const ink = { x: 180, y: 60, width: 160, height: 60 };
  paint(pad, ink, INK);
  return { pad, ink };
}

/** A phone photo of a signature on grey paper — no transparency anywhere. */
function photo(width = 800, height = 600) {
  const img = canvas(width, height, [190, 188, 184, 255]);
  const ink = { x: 200, y: 250, width: 400, height: 100 };
  paint(img, ink, BLUE_INK);
  return { img, ink };
}

const alphaAt = (img: RgbaImage, x: number, y: number) =>
  img.data[(y * img.width + x) * 4 + 3]!;

describe("prepareSignatureBitmap", () => {
  it("crops a drawn signature to its ink plus a small pad (positive control)", () => {
    const { pad, ink } = drawnPad();
    // Health: the finder sees exactly the ink that was painted.
    expect(inkBounds(pad)).toEqual(ink);
    const out = prepareSignatureBitmap(pad)!;
    // 3 % of the longer side (160 px) is 5 px on every side.
    expect([out.width, out.height]).toEqual([160 + 10, 60 + 10]);
    expect(out.opaque).toBe(false);
    expect(alphaAt(out, 5, 5)).toBe(255);
    expect(alphaAt(out, 0, 0)).toBe(0);
  });

  it("keys out a photo's grey paper and keeps the ink's colour", () => {
    const { img, ink } = photo();
    const out = prepareSignatureBitmap(img)!;
    expect(out.opaque).toBe(false);
    const pad = Math.round(ink.width * 0.03);
    expect([out.width, out.height]).toEqual([
      ink.width + 2 * pad,
      ink.height + 2 * pad,
    ]);
    // The paper margin is transparent, the ink opaque and still blue.
    expect(alphaAt(out, 0, 0)).toBe(0);
    const mid = ((pad + 50) * out.width + pad + 200) * 4;
    expect(Array.from(out.data.subarray(mid, mid + 4))).toEqual(BLUE_INK);
  });

  it("keeps the paper, opaque, when asked to — still cropped", () => {
    const { img, ink } = photo();
    const out = prepareSignatureBitmap(img, { removeBackground: false })!;
    expect(out.opaque).toBe(true);
    for (let i = 3; i < out.data.length; i += 4) expect(out.data[i]).toBe(255);
    expect(out.width).toBeLessThan(img.width);
    expect(out.width).toBeGreaterThanOrEqual(ink.width);
  });

  it("gives a pen stroke's anti-aliased edge partial alpha", () => {
    const img = canvas(40, 20, [200, 200, 200, 255]);
    paint(img, { x: 10, y: 5, width: 20, height: 10 }, [20, 20, 20, 255]);
    // A column half-way between ink and paper.
    paint(img, { x: 30, y: 5, width: 1, height: 10 }, [140, 140, 140, 255]);
    const out = prepareSignatureBitmap(img)!;
    const edge = alphaAt(out, out.width - 1 - 2, 8);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(255);
  });

  it("bounds a phone-sized photo to the maximum edge", () => {
    const img = canvas(4032, 3024, [185, 185, 185, 255]);
    paint(img, { x: 500, y: 1000, width: 3000, height: 800 }, INK);
    const out = prepareSignatureBitmap(img)!;
    expect(Math.max(out.width, out.height)).toBe(SIGNATURE_MAX_EDGE);
    expect(out.width / out.height).toBeCloseTo((3000 + 180) / (800 + 180), 1);
  });

  it("does not bleed the transparent surround into the ink when shrinking", () => {
    const img = canvas(3000, 100, [255, 255, 255, 0]);
    paint(img, { x: 0, y: 0, width: 3000, height: 100 }, [255, 255, 255, 0]);
    paint(img, { x: 0, y: 40, width: 3000, height: 3 }, INK);
    const out = prepareSignatureBitmap(img)!;
    // Every pixel that carries any ink carries the ink's colour, not grey.
    for (let i = 0; i < out.data.length; i += 4) {
      if (out.data[i + 3]! > 0) {
        expect(Array.from(out.data.subarray(i, i + 3))).toEqual(
          INK.slice(0, 3),
        );
      }
    }
  });

  it("finds no signature on an empty pad or a blank photo", () => {
    expect(prepareSignatureBitmap(canvas(520, 180, [0, 0, 0, 0]))).toBeNull();
    expect(
      prepareSignatureBitmap(canvas(800, 600, [190, 190, 190, 255])),
    ).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 *  The composed chain: pad pixels → PNG → signPdf → what a reader sees
 * ------------------------------------------------------------------ */

/** RGBA PNG, as a canvas's toBlob would hand it over. */
function encodeRgbaPng(img: RgbaImage): Uint8Array {
  const row = img.width * 4;
  const raw = Buffer.alloc((row + 1) * img.height);
  for (let y = 0; y < img.height; y += 1) {
    raw[y * (row + 1)] = 0;
    Buffer.from(img.data.buffer, img.data.byteOffset + y * row, row).copy(
      raw,
      y * (row + 1) + 1,
    );
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

async function blankLetter(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
}

/** Pixel size of the one image XObject on page 1. */
async function embeddedImageSize(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const found: { width: number; height: number }[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (obj.dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
    if (obj.dict.has(PDFName.of("SMask")) || !obj.dict.has(PDFName.of("Width")))
      continue;
    found.push({
      width: Number(obj.dict.get(PDFName.of("Width"))!.toString()),
      height: Number(obj.dict.get(PDFName.of("Height"))!.toString()),
    });
  }
  return found;
}

describe("a drawn signature is placed at the size the person asked for", () => {
  it("the ink, not the pad, spans the requested width on the page", async () => {
    const { pad, ink } = drawnPad();
    const prepared = prepareSignatureBitmap(pad)!;
    const out = await signPdf(
      await blankLetter(),
      { kind: "image", bytes: encodeRgbaPng(prepared), format: "png" },
      { pageIndex: 0, position: "bottom-right", width: 200, margin: 24 },
    );

    const [embedded, ...rest] = await embeddedImageSize(out);
    expect(rest).toEqual([]);
    expect(embedded).toEqual({
      width: prepared.width,
      height: prepared.height,
    });

    const read = await readAsViewer(out);
    expect(read.images.length).toBe(1);
    const [x0, , x1] = read.images[0]!;
    expect(x1 - x0).toBeCloseTo(200, 1);
    // The ink covers all but the small pad of what was placed: at least 90 %
    // of the requested width. Embedding the whole pad put it at 160/520.
    const inkOnPage = ((x1 - x0) * ink.width) / embedded!.width;
    expect(inkOnPage).toBeGreaterThan(0.9 * 200);
  });

  it("a photo whose paper was kept is embedded as a JPEG, not a PNG", async () => {
    // A 1×1 JPEG stands in for the runner's canvas encode of the kept photo.
    const jpeg = Uint8Array.from(
      Buffer.from(
        "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Ap//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEP/EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EFBABAQAAAAAAAAAAAAAAAAAAARD/2gAIAQEAAT8Qf//Z",
        "base64",
      ),
    );
    const out = await signPdf(
      await blankLetter(),
      { kind: "image", bytes: jpeg, format: "jpg" },
      { pageIndex: 0, position: "bottom-right", width: 120 },
    );
    const doc = await PDFDocument.load(out);
    const filters: string[] = [];
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFRawStream) {
        const f = obj.dict.get(PDFName.of("Filter"));
        if (f) filters.push(f.toString());
      }
    }
    expect(filters).toContain("/DCTDecode");
  });
});
