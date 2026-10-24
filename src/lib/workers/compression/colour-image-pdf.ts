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
