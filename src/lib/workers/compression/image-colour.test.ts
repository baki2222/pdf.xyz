import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { encodePng } from "@/lib/pdf/extract-images";
import { drawRasterImage, embedRasterImage } from "@/lib/pdf/pdf-lib";
import { colourImagePdf } from "@/lib/workers/compression/colour-image-pdf";
import {
  grayscaleVerdict,
  hasColourImage,
  imageColourComponents,
} from "./image-colour";

describe("imageColourComponents — what the reader of the output sees", () => {
  it("positive control: an RGB image reads as 3 components", async () => {
    const counts = await imageColourComponents(
      await colourImagePdf({ components: 3 }),
    );
    expect(counts).toEqual([3]);
  });

  it("a DeviceGray image reads as 1 component", async () => {
    const counts = await imageColourComponents(
      await colourImagePdf({ components: 1 }),
    );
    expect(counts).toEqual([1]);
  });

  it("a gray PNG through pdf-lib's embedder is RGB — why the fixture writes its own image", async () => {
    const doc = await PDFDocument.create();
    const samples = new Uint8Array(8 * 8);
    const img = await embedRasterImage(
      doc,
      encodePng(8, 8, "gray8", samples),
      "png",
    );
    await drawRasterImage(doc.addPage([100, 100]), img, {
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    });
    expect(await imageColourComponents(await doc.save())).toEqual([3]);
  });

  it("follows an ICCBased colour space to its /N", async () => {
    const doc = await PDFDocument.load(await colourImagePdf({ components: 3 }));
    const icc = doc.context.register(
      doc.context.stream(new Uint8Array(4), { N: 1 }),
    );
    let rewritten = 0;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (
        obj instanceof PDFRawStream &&
        obj.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")
      ) {
        obj.dict.set(
          PDFName.of("ColorSpace"),
          doc.context.obj([PDFName.of("ICCBased"), icc]),
        );
        rewritten += 1;
      }
    }
    // Health check: the rewrite landed on the one image, or this proves nothing.
    expect(rewritten).toBe(1);
    expect(await imageColourComponents(await doc.save())).toEqual([1]);
  });

  it("a PDF with no images reports none, and the verdict does not call that gray", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    const bytes = await doc.save();
    expect(await imageColourComponents(bytes)).toEqual([]);
    expect((await grayscaleVerdict(bytes)).ok).toBe(false);
    expect(await hasColourImage(bytes)).toBe(false);
  });
});

describe("grayscaleVerdict — every image must be one component", () => {
  it("passes a gray-only file and names the count", async () => {
    const verdict = await grayscaleVerdict(
      await colourImagePdf({ components: 1 }),
    );
    expect(verdict).toMatchObject({ ok: true });
    expect(verdict.detail).toMatch(/1 image/);
  });

  it("fails a file that still carries a colour image", async () => {
    const verdict = await grayscaleVerdict(
      await colourImagePdf({ components: 3 }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/components: 3/);
  });

  it("fails bytes it cannot read rather than passing them", async () => {
    const verdict = await grayscaleVerdict(new Uint8Array([1, 2, 3]));
    expect(verdict.ok).toBe(false);
  });
});
