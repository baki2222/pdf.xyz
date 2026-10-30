// @native-canvas
/**
 * WebP, GIF (its first frame) and BMP into JPG / PNG to PDF.
 *
 * The browser decodes them (`createImageBitmap`, a canvas) and the engine
 * re-embeds the pixels: as a JPEG when the image is opaque, as a PNG when it
 * has transparency. Under Node those two browser globals are stood in for by
 * `@napi-rs/canvas` — the canvas pdf.js itself paints with here — so the
 * module's OWN code (format sniffing, the alpha scan, the encoder choice,
 * the page) runs unchanged; the real browser path is driven by
 * `e2e/client-proof/cases.ts`.
 *
 * Every fixture is generated in the test: a hand-written GIF (two frames, so
 * "first frame" is checkable) and BMP, and a WebP the canvas encodes.
 * Every assertion re-opens the SAVED PDF and reads its image XObjects.
 *
 * HISTORY: until 2026-10-30 all three were refused at pick time with
 * `"x.webp" is a WebP image. Only PNG and JPG images can be converted here.`
 * — the positive controls below hold the gate's new edge (TIFF, HEIC).
 */
import { createRequire } from "node:module";
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
} from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  imagePickerAccept,
  imagesToPdf,
  isImageAllowedForKind,
  sniffImageFormat,
  unsupportedImageMessage,
} from "./image-to-pdf";
import {
  BLUE,
  bmpOf,
  gifOf,
  RED,
  type RGB,
} from "@/tests/image-format-fixtures";

interface NapiImage {
  width: number;
  height: number;
}
interface NapiCtx {
  fillStyle: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: unknown, x: number, y: number): void;
  getImageData(
    x: number,
    y: number,
    w: number,
    h: number,
  ): { data: Uint8ClampedArray };
}
interface NapiCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): NapiCtx;
  toBuffer(type: string, quality?: number): Buffer;
}
const napi = createRequire(
  createRequire(import.meta.url).resolve("pdfjs-dist/package.json"),
)("@napi-rs/canvas") as {
  createCanvas(w: number, h: number): NapiCanvas;
  loadImage(bytes: Buffer): Promise<NapiImage>;
};

/* ------------------------------------------------------------------ *
 *  The two browser globals, stood in for by the Node canvas
 * ------------------------------------------------------------------ */

class NodeOffscreenCanvas {
  readonly canvas: NapiCanvas;
  constructor(width: number, height: number) {
    this.canvas = napi.createCanvas(width, height);
  }
  get width() {
    return this.canvas.width;
  }
  get height() {
    return this.canvas.height;
  }
  getContext(kind: "2d") {
    return this.canvas.getContext(kind);
  }
  async convertToBlob(options: { type: string; quality?: number }) {
    const quality =
      options.type === "image/jpeg"
        ? Math.round((options.quality ?? 0.92) * 100)
        : undefined;
    return new Blob([
      new Uint8Array(this.canvas.toBuffer(options.type, quality)),
    ]);
  }
}

const g = globalThis as Record<string, unknown>;
const saved = {
  createImageBitmap: g.createImageBitmap,
  OffscreenCanvas: g.OffscreenCanvas,
};
beforeAll(() => {
  g.OffscreenCanvas = NodeOffscreenCanvas;
  g.createImageBitmap = async (blob: Blob) => {
    const image = await napi.loadImage(Buffer.from(await blob.arrayBuffer()));
    return Object.assign(image, { close() {} });
  };
});
afterAll(() => {
  g.createImageBitmap = saved.createImageBitmap;
  g.OffscreenCanvas = saved.OffscreenCanvas;
});

/* ------------------------------------------------------------------ *
 *  Fixtures
 * ------------------------------------------------------------------ */

// GIF and BMP are written byte by byte, shared with the browser proof.

/** A WebP the canvas encodes: opaque red, or red over transparency. */
function webpOf(w: number, h: number, transparent: boolean): Buffer {
  const canvas = napi.createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (transparent) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, w / 2, h);
  } else {
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, w, h);
  }
  // Lossless, so the transparent half stays exactly transparent.
  return canvas.toBuffer("image/webp", 100);
}

/* ------------------------------------------------------------------ *
 *  Reading the saved PDF
 * ------------------------------------------------------------------ */

interface SavedImage {
  width: number;
  height: number;
  filter: string;
  hasAlpha: boolean;
  bytes: Uint8Array;
}

/** The page images of a saved PDF (not their soft masks), read by pdf-lib. */
async function savedImages(pdf: Uint8Array): Promise<SavedImage[]> {
  const doc = await PDFDocument.load(pdf);
  const masks = new Set<string>();
  const images: { key: string; stream: PDFRawStream }[] = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (obj.dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
    const mask = obj.dict.get(PDFName.of("SMask"));
    if (mask) masks.add(String(mask));
    images.push({ key: String(ref), stream: obj });
  }
  return images
    .filter(({ key }) => !masks.has(key))
    .map(({ stream }) => {
      const num = (k: string) =>
        (stream.dict.get(PDFName.of(k)) as PDFNumber).asNumber();
      return {
        width: num("Width"),
        height: num("Height"),
        filter: String(stream.dict.get(PDFName.of("Filter"))),
        hasAlpha: stream.dict.get(PDFName.of("SMask")) !== undefined,
        bytes: stream.contents,
      };
    });
}

/** The colour at the centre of a DCT-coded image, decoded by the canvas. */
async function jpegCentre(image: SavedImage): Promise<RGB> {
  const decoded = await napi.loadImage(Buffer.from(image.bytes));
  const canvas = napi.createCanvas(decoded.width, decoded.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(decoded, 0, 0);
  const { data } = ctx.getImageData(
    Math.floor(decoded.width / 2),
    Math.floor(decoded.height / 2),
    1,
    1,
  );
  return [data[0]!, data[1]!, data[2]!];
}

const near = (got: RGB, want: RGB) =>
  got.every((c, i) => Math.abs(c - want[i]!) <= 48);

const input = (name: string, bytes: Buffer, type = "") => ({
  name,
  type,
  bytes: new Uint8Array(bytes),
});

/* ------------------------------------------------------------------ *
 *  The tests
 * ------------------------------------------------------------------ */

describe("which images go in", () => {
  it("sniffs WebP, GIF and BMP by their bytes, whatever the file is called", () => {
    expect(sniffImageFormat(webpOf(4, 4, false))).toBe("webp");
    expect(sniffImageFormat(gifOf(2, 2, [RED]))).toBe("gif");
    expect(sniffImageFormat(bmpOf(2, 2, RED))).toBe("bmp");
    // The two embedded as they are keep their answer.
    expect(sniffImageFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      "jpg",
    );
    expect(
      sniffImageFormat(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe("png");
  });

  it("positive control: TIFF and HEIC are still not sniffed as anything", () => {
    const tiff = new Uint8Array([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0]);
    const heic = new Uint8Array([
      0,
      0,
      0,
      24,
      ...Buffer.from("ftypheic"),
      0,
      0,
      0,
      0,
    ]);
    expect(sniffImageFormat(tiff)).toBeNull();
    expect(sniffImageFormat(heic)).toBeNull();
    expect(unsupportedImageMessage("scan.tif", tiff)).toBe(
      '"scan.tif" is a TIFF image. Only PNG, JPG, WebP, GIF and BMP images can be converted here.',
    );
  });

  it("the pick-time gate and the picker take .webp, .gif and .bmp on both tools", () => {
    for (const kind of ["jpg", "png"] as const) {
      for (const [name, type] of [
        ["a.webp", "image/webp"],
        ["a.gif", "image/gif"],
        ["a.bmp", "image/bmp"],
      ] as const) {
        expect(isImageAllowedForKind(kind, { name, type: "" }), name).toBe(
          true,
        );
        expect(isImageAllowedForKind(kind, { name: "x", type }), type).toBe(
          true,
        );
        expect(imagePickerAccept(kind).split(",")).toContain(name.slice(1));
      }
      for (const name of ["a.tif", "a.tiff", "a.heic", "a.avif"])
        expect(isImageAllowedForKind(kind, { name, type: "" }), name).toBe(
          false,
        );
    }
  });
});

describe("the saved PDF", () => {
  it("an opaque WebP becomes one page holding a JPEG at the image's own pixel size", async () => {
    const pdf = await imagesToPdf("jpg", [
      input("photo.webp", webpOf(30, 20, false)),
    ]);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
    const [image, ...rest] = await savedImages(pdf);
    expect(rest).toEqual([]);
    expect([image!.width, image!.height]).toEqual([30, 20]);
    expect(image!.filter).toBe("/DCTDecode");
    expect(image!.hasAlpha).toBe(false);
    expect(near(await jpegCentre(image!), RED)).toBe(true);
  });

  it("a WebP with transparency is kept transparent: a PNG with a soft mask", async () => {
    const pdf = await imagesToPdf("png", [
      input("logo.webp", webpOf(16, 8, true)),
    ]);
    const [image] = await savedImages(pdf);
    expect([image!.width, image!.height]).toEqual([16, 8]);
    expect(image!.filter).toBe("/FlateDecode");
    expect(image!.hasAlpha).toBe(true);
  });

  it("a GIF becomes its FIRST frame, at its own size", async () => {
    const pdf = await imagesToPdf("jpg", [
      input("anim.gif", gifOf(6, 4, [RED, BLUE])),
    ]);
    const [image] = await savedImages(pdf);
    expect([image!.width, image!.height]).toEqual([6, 4]);
    expect(image!.filter).toBe("/DCTDecode");
    const centre = await jpegCentre(image!);
    expect(near(centre, RED), `first frame is red, got ${centre}`).toBe(true);
    // Positive control: the second frame's colour is told apart.
    expect(near(centre, BLUE)).toBe(false);
  });

  it("a BMP becomes a page at its own pixel size, named by its bytes not its name", async () => {
    const pdf = await imagesToPdf("png", [
      input("scan.png", bmpOf(5, 3, BLUE)),
      input("plain.bmp", bmpOf(7, 2, RED), "image/bmp"),
    ]);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(2);
    const images = await savedImages(pdf);
    expect(images.map((i) => [i.width, i.height]).sort()).toEqual([
      [5, 3],
      [7, 2],
    ]);
  });

  it("an image the decoder cannot read is refused by name, in plain words", async () => {
    // A truncated GIF. The browser's createImageBitmap REJECTS it; the Node
    // canvas crashes its process on the same bytes (measured 2026-10-30), so
    // here the stand-in rejects the way the browser does.
    const broken = gifOf(2, 2, [RED]).subarray(0, 13);
    const decode = g.createImageBitmap;
    g.createImageBitmap = async () => {
      throw new DOMException("The source image could not be decoded.");
    };
    try {
      await expect(
        imagesToPdf("jpg", [input("broken.gif", broken)]),
      ).rejects.toThrow('"broken.gif" could not be read as a GIF image.');
    } finally {
      g.createImageBitmap = decode;
    }
  });

  it("the page dictionary's image is the one the page draws (no stray copies)", async () => {
    const pdf = await imagesToPdf("jpg", [
      input("one.webp", webpOf(10, 10, false)),
    ]);
    const doc = await PDFDocument.load(pdf);
    const resources = doc.getPage(0).node.Resources()!;
    const xobjects = resources.lookup(PDFName.of("XObject"), PDFDict);
    expect(xobjects.keys().length).toBe(1);
  });
});
