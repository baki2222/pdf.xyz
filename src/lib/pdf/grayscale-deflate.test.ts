// @vitest-environment node
/**
 * Grayscale PDF deflates each page image with the platform's own deflater
 * (`CompressionStream`), and falls back to pdf-lib's (pako, plain JS) only
 * where there is none.
 *
 * WHY. Once the JPEG stopped being made on text pages (`./gray-jpeg-bound`),
 * the deflate was the largest cost left: measured in Chromium on a rendered
 * Letter page of 50 lines at 150 DPI, pako took 36.2 ms and
 * `CompressionStream("deflate")` 16.2 ms, for 232,336 against 231,746 bytes
 * (6 lines: 13.1 ms against 7.7 ms; a 40-page noise scan page: 61.7 against
 * 25.6 ms). With pako, a 40-page PDF of 50-line pages took 1.59 times PDF to
 * PNG (`e2e/grayscale-large-run.spec.ts`).
 *
 * Spies are `vi.spyOn` on prototypes and `vi.stubGlobal`, restored after each
 * test, never `vi.mock` (the suite shares one module cache).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { inflateSync } from "node:zlib";
import { PDFContext, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { createGrayscaleBuilder } from "./grayscale-builder";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const W = 400;
const H = 300;
const info = {
  index: 0,
  width: W,
  height: H,
  pageWidth: (W * 72) / 150,
  pageHeight: (H * 72) / 150,
};

/** Text-like: Flate wins, so the stored image IS the deflated plane. */
function textPlane(): Uint8Array {
  const out = new Uint8Array(W * H).fill(255);
  for (let line = 20; line + 10 < H; line += 24)
    for (let y = line; y < line + 10; y++)
      for (let x = 20; x < W - 20; x++)
        if (((x * 7) ^ (y * 3)) % 5 < 2) out[y * W + x] = 0;
  return out;
}

/** The one image stream in the saved file, inflated. */
async function storedImage(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  const images = doc.context
    .enumerateIndirectObjects()
    .map(([, object]) => object)
    .filter(
      (object): object is PDFRawStream =>
        object instanceof PDFRawStream &&
        object.dict.get(PDFName.of("Subtype"))?.toString() === "/Image",
    );
  expect(images).toHaveLength(1);
  expect(images[0]!.dict.get(PDFName.of("Filter"))?.toString()).toBe(
    "/FlateDecode",
  );
  return new Uint8Array(inflateSync(images[0]!.contents));
}

describe("grayscale builder: the page image is deflated natively", () => {
  it("uses CompressionStream where there is one: pdf-lib's flateStream is called 0 times, and the stored image inflates to the plane", async () => {
    expect(typeof CompressionStream).toBe("function");
    const pako = vi.spyOn(PDFContext.prototype, "flateStream");
    const plane = textPlane();
    const builder = await createGrayscaleBuilder();
    const record = await builder.addPage(plane, info);
    expect(record.encoding).toBe("flate");
    expect(pako).toHaveBeenCalledTimes(0);
    expect(await storedImage(await builder.save("t"))).toEqual(plane);
  });

  it("POSITIVE CONTROL and FALLBACK: without CompressionStream it deflates with pdf-lib, losslessly", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    const pako = vi.spyOn(PDFContext.prototype, "flateStream");
    const plane = textPlane();
    const builder = await createGrayscaleBuilder();
    const record = await builder.addPage(plane, info);
    expect(record.encoding).toBe("flate");
    expect(pako).toHaveBeenCalledTimes(1);
    expect(await storedImage(await builder.save("t"))).toEqual(plane);
  });
});
