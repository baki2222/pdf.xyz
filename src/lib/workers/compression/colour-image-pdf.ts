/**
 * A PDF carrying one image XObject in an EXACT colour space — DeviceGray or
 * DeviceRGB, as the caller asks.
 *
 * Why not `embedPng`: pdf-lib decodes every PNG and writes it back as
 * DeviceRGB, so a gray PNG embedded through it is a 3-component image. A
 * grayscale test built that way would have no gray file to pass, and every
 * "is it gray?" check would be tested against colour alone. This writes the
 * image dictionary itself (Flate-compressed samples) and paints it with `Do`.
 *
 * It is also the in-image options proof's input (`../options-proof.ts`),
 * which ships in the worker image, so it lives here and not in `src/tests`
 * (test-support modules must stay unreachable from shipped code).
 */
import {
  concatTransformationMatrix,
  drawObject,
  PDFDocument,
  PDFName,
  popGraphicsState,
  pushGraphicsState,
} from "pdf-lib";

export interface ColourImagePdfOptions {
  /** 1 → DeviceGray, 3 → DeviceRGB. */
  components: 1 | 3;
  /** Pixel width and height of the square image. */
  size?: number;
  /** Pages, each painting the same image. */
  pages?: number;
  /** Bytes of padding in /Subject, to make one file larger than another. */
  pad?: number;
}

export async function colourImagePdf({
  components,
  size = 16,
  pages = 1,
  pad = 0,
}: ColourImagePdfOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const samples = new Uint8Array(size * size * components);
  // Deterministic noise, so a recompressor has real pixels to work on.
  for (let i = 0; i < samples.length; i++) samples[i] = (i * 7919) % 251;
  const image = doc.context.flateStream(samples, {
    Type: "XObject",
    Subtype: "Image",
    Width: size,
    Height: size,
    BitsPerComponent: 8,
    ColorSpace: components === 1 ? "DeviceGray" : "DeviceRGB",
  });
  const ref = doc.context.register(image);
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([200, 200]);
    const name: PDFName = page.node.newXObject("Im", ref);
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(150, 0, 0, 150, 25, 25),
      drawObject(name),
      popGraphicsState(),
    );
  }
  if (pad > 0) doc.setSubject("x".repeat(pad));
  return doc.save({ useObjectStreams: false });
}

/**
 * A "phone scan" for the target-size proof (2026-10-31): one RGB image of
 * true noise (an LCG, so Flate cannot shrink it and neither can anything but
 * downsampling), drawn `inches` wide on each page at `px` pixels — so its
 * resolution is `px / inches` DPI. Above 1.5x a rung's DPI, Ghostscript
 * downsamples it (`-dDownsample*`, threshold 1.5), so every rung of the
 * ladder makes a different file.
 */
export async function noisePhotoPdf({
  px,
  inches,
  pages = 1,
  kind = "noise",
}: {
  px: number;
  inches: number;
  pages?: number;
  /**
   * `noise`: every sample random. `smooth`: a photo-like picture — colour
   * gradients with a little grain — to compare how Ghostscript encodes an
   * ordinary photo at each rung against the worst case.
   */
  kind?: "noise" | "smooth";
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const samples = new Uint8Array(px * px * 3);
  let seed = 0x2545f491;
  for (let i = 0; i < samples.length; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    if (kind === "noise") {
      samples[i] = seed >>> 24;
      continue;
    }
    const p = Math.floor(i / 3);
    const x = p % px;
    const y = Math.floor(p / px);
    const c = i % 3;
    const base =
      c === 0
        ? (255 * x) / px
        : c === 1
          ? (255 * y) / px
          : 128 + 100 * Math.sin((x + y) / 40);
    samples[i] = Math.max(
      0,
      Math.min(255, Math.round(base + ((seed >>> 24) - 128) / 16)),
    );
  }
  const image = doc.context.flateStream(samples, {
    Type: "XObject",
    Subtype: "Image",
    Width: px,
    Height: px,
    BitsPerComponent: 8,
    ColorSpace: "DeviceRGB",
  });
  const ref = doc.context.register(image);
  const side = inches * 72;
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([side + 72, side + 72]);
    const name: PDFName = page.node.newXObject("Im", ref);
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(side, 0, 0, side, 36, 36),
      drawObject(name),
      popGraphicsState(),
    );
  }
  return doc.save({ useObjectStreams: false });
}
