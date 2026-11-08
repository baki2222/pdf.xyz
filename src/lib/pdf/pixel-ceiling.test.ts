import { describe, expect, it } from "vitest";
import { MAX_DECODED_PIXELS } from "./pixel-ceiling";
import { imagesToPdf, type ImagePdfInput } from "./image-to-pdf";
import { checkPixelCeiling, jpegFrameProblem } from "./raster-check";
import * as F from "@/tests/hostile/conversion-in.fixtures";

/*
 * One ceiling, three readers (hostile matrix CI-02 / CI-04 / CI-05,
 * 2026-11-08). pixel-ceiling.ts used to say "both engines" read the ceiling
 * while the PNG embedder inflated a 144 MP bomb without looking. Each JPG /
 * PNG to PDF reader is run here with a file ONE ROW over the ceiling, through
 * the engine entry point, so a reader that drifts to its own number (or
 * stops reading it) turns this red.
 */

const W = 10_000;
const OVER = MAX_DECODED_PIXELS / W + 1;

/** A one-page grey TIFF whose ImageWidth / ImageLength claim `w` × `h`. */
function tiffClaiming(w: number, h: number): Uint8Array {
  const t = F.validTiff(1);
  const view = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const ifd = view.getUint32(4, true);
  const n = view.getUint16(ifd, true);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    const tag = view.getUint16(e, true);
    if (tag !== 256 && tag !== 257) continue;
    const value = tag === 256 ? w : h;
    if (view.getUint16(e + 2, true) === 3) view.setUint16(e + 8, value, true);
    else view.setUint32(e + 8, value, true);
  }
  return t;
}

const file = (name: string, bytes: Uint8Array): ImagePdfInput => ({
  name,
  type: "",
  bytes,
});

describe("MAX_DECODED_PIXELS is read by every JPG / PNG to PDF reader", () => {
  it("health check: the edge is a whole number of 10,000 px rows", () => {
    expect(MAX_DECODED_PIXELS % W).toBe(0);
    expect(OVER * W).toBeGreaterThan(MAX_DECODED_PIXELS);
    expect(() => checkPixelCeiling(W, OVER - 1)).not.toThrow();
    expect(jpegFrameProblem(F.jpegClaiming(W, OVER - 1))).toBeNull();
  });

  it.each([
    ["a.png", () => F.pngClaiming(W, OVER)],
    ["a.jpg", () => F.jpegClaiming(W, OVER)],
    ["a.tif", () => tiffClaiming(W, OVER)],
  ])(
    "%s one row over the ceiling is refused by its size",
    async (name, make) => {
      await expect(imagesToPdf("png", [file(name, make())])).rejects.toThrow(
        `"${name}" ${name.endsWith(".tif") ? "page 1 " : ""}is 10,000 × ${OVER.toLocaleString("en-US")} pixels, more than the ${MAX_DECODED_PIXELS / 1_000_000} megapixels`,
      );
    },
  );
});
