// @native-canvas
import { describe, expect, it } from "vitest";
import {
  PDFDocument,
  PDFName,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
} from "pdf-lib";
import { readAsViewer } from "./pdf-viewer-read";

/**
 * The placement reader reports what a viewer SHOWS, not what the file paints.
 *
 * `readAsViewer` backs the placement proofs for Edit PDF and Sign PDF. pdfjs
 * emits the paint op for an image it cannot decode and resolves its pixels to
 * `null` — measured with the JPEG2000 below: with no reachable `wasmUrl` the op
 * is there and the image is null. A reader that counts ops therefore reports a
 * box where a viewer shows nothing.
 *
 * Two properties, each with its control:
 *  - the reader's decoders are REACHABLE in this process: a real JPEG2000
 *    image (8 x 8 px solid red, OpenJPEG 2.5.4 via Pillow) comes back decoded
 *    at the box it was drawn — this fails if `wasmUrl` is left as the app's
 *    same-origin HTTP path, which `fs.readFile` cannot open;
 *  - the reader can SEE a decode failure: the same stream truncated to its
 *    header is painted and reported undecoded, and absent from `images`.
 */

/** 8 x 8 solid-red JPEG2000 (JP2 container), 244 bytes. */
const JP2_8X8 =
  "AAAADGpQICANCocKAAAAFGZ0eXBqcDIgAAAAAGpwMiAAAAAtanAyaAAAABZpaGRyAAAACAAAAAgAAwcHAAAAAAAPY29scgEAAAAAABAAAACnanAyY/9P/1EALwAAAAAACAAAAAgAAAAAAAAAAAAAAAgAAAAIAAAAAAAAAAAAAwcBAQcBAQcBAf9SAAwAAAABAAMEBAAB/1wADUBASEhQSEhQSEhQ/2QAJQABQ3JlYXRlZCBieSBPcGVuSlBFRyB2ZXJzaW9uIDIuNS40/5AACgAAAAAAJgAB/5PPtAgET8+0CAifz7QICJ+AgICAgICAgID/2Q==";

/** The JP2 bytes, or only its signature and header boxes (no codestream). */
const jp2 = (broken: boolean): Uint8Array => {
  const bytes = new Uint8Array(Buffer.from(JP2_8X8, "base64"));
  return broken ? bytes.slice(0, 80) : bytes;
};

async function pageWithImage(
  filter: "JPXDecode" | "brokenJPX" | null,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  const ref =
    filter !== null
      ? doc.context.register(
          doc.context.stream(jp2(filter === "brokenJPX"), {
            Type: "XObject",
            Subtype: "Image",
            Width: 8,
            Height: 8,
            Filter: "JPXDecode",
          }),
        )
      : doc.context.register(
          doc.context.stream(new Uint8Array(8 * 8 * 3).fill(200), {
            Type: "XObject",
            Subtype: "Image",
            Width: 8,
            Height: 8,
            ColorSpace: "DeviceRGB",
            BitsPerComponent: 8,
          }),
        );
  const name = page.node.newXObject("Im", ref);
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(100, 0, 0, 50, 10, 20),
    drawObject(name),
    popGraphicsState(),
  );
  expect(page.node.Resources()?.lookup(PDFName.of("XObject"))).toBeDefined();
  return doc.save({ useObjectStreams: false });
}

describe("readAsViewer sees every image a viewer shows", () => {
  it("CONTROL: an uncompressed image is read at the box it was drawn", async () => {
    const read = await readAsViewer(await pageWithImage(null));
    expect(read.images).toEqual([[10, 20, 110, 70]]);
  });

  it("a JPEG2000 image decodes and is read at the box it was drawn", async () => {
    const read = await readAsViewer(await pageWithImage("JPXDecode"));
    expect(
      read.imageFrames.map((f) => f.decoded),
      "pdfjs could not decode the JPEG2000 image: the reader's wasmUrl does " +
        "not resolve in this process, so placement proofs cannot see JPX/JBIG2",
    ).toEqual([true]);
    expect(read.images).toEqual([[10, 20, 110, 70]]);
  });

  it("CONTROL: an image pdfjs cannot decode is painted, reported undecoded, and not shown", async () => {
    const read = await readAsViewer(await pageWithImage("brokenJPX"));
    expect(read.imageFrames.map((f) => [f.box, f.decoded])).toEqual([
      [[10, 20, 110, 70], false],
    ]);
    expect(read.images).toEqual([]);
  });
});
