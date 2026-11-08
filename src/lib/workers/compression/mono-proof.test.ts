import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
import { DEEP_MONO_MIN_DPI } from "@/lib/pdf/offered-kinds";
import {
  MONO_PROOF_SOURCE_DPI,
  monoFloorVerdict,
  monoProofImages,
  monoScanPdf,
} from "./mono-proof";

/** A page with one 8-bit gray image across it: what a mono scan becomes on the gray path. */
async function grayImagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const image = doc.context.flateStream(new Uint8Array(850 * 1100).fill(200), {
    Type: "XObject",
    Subtype: "Image",
    Width: 850,
    Height: 1100,
    ColorSpace: "DeviceGray",
    BitsPerComponent: 8,
  });
  page.node.setXObject(PDFName.of("Im0"), doc.context.register(image));
  return doc.save();
}

describe("monoScanPdf (the proof's fixture)", () => {
  it("is one 1-bit image across a Letter page at the asked resolution", async () => {
    const images = await monoProofImages(await monoScanPdf());
    // Health: exactly the image the proof is about, and it is black-and-white.
    expect(images).toEqual([{ width: 5100, bits: 1, mask: false, dpi: 600 }]);
  });

  it("sits past Ghostscript's default 1.5x threshold over the floor", () => {
    // At 2x the floor, an engine that honours it MUST downsample to about the
    // floor, and one that ignores it lands on the target instead. A fixture
    // under 1.5x the floor would come back untouched either way and prove
    // nothing.
    expect(MONO_PROOF_SOURCE_DPI / DEEP_MONO_MIN_DPI).toBeGreaterThan(1.5);
  });
});

describe("monoFloorVerdict", () => {
  it("passes a black-and-white image at the floor and above", async () => {
    const at = await monoFloorVerdict(
      await monoScanPdf(DEEP_MONO_MIN_DPI),
      DEEP_MONO_MIN_DPI,
    );
    expect(at).toEqual({
      ok: true,
      detail: `1 black-and-white image at ${DEEP_MONO_MIN_DPI} DPI, none below ${DEEP_MONO_MIN_DPI}`,
    });
    expect(
      (await monoFloorVerdict(await monoScanPdf(), DEEP_MONO_MIN_DPI)).ok,
    ).toBe(true);
  });

  it("fails the defect: a black-and-white scan taken down to the 72 DPI target", async () => {
    // Negative control: what deep compression did before 2026-11-07, when
    // MonoImageResolution followed the target (72-150 DPI).
    const verdict = await monoFloorVerdict(
      await monoScanPdf(72),
      DEEP_MONO_MIN_DPI,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("fell below 300 DPI (72 DPI)");
  });

  it("fails a file with no images, which proves nothing", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const verdict = await monoFloorVerdict(await doc.save(), DEEP_MONO_MIN_DPI);
    expect(verdict).toEqual({
      ok: false,
      detail: "the output carries no images, so the floor proves nothing",
    });
  });

  it("fails an image that left the black-and-white path", async () => {
    const verdict = await monoFloorVerdict(
      await grayImagePdf(),
      DEEP_MONO_MIN_DPI,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain(
      "no longer black-and-white (bits per component: 8)",
    );
  });

  it("fails the untouched original, which never exercised the floor", async () => {
    // The first version of this proof PASSED on production with the file
    // handed back byte for byte (the engine's no-worse swap): 600 DPI is above
    // the floor, so "none below 300" held while nothing was resampled. With the
    // source resolution named, that outcome is a failure.
    const verdict = await monoFloorVerdict(
      await monoScanPdf(),
      DEEP_MONO_MIN_DPI,
      MONO_PROOF_SOURCE_DPI,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("nothing was resampled");
    // Positive control: a file resampled to the floor passes the same check.
    expect(
      (
        await monoFloorVerdict(
          await monoScanPdf(DEEP_MONO_MIN_DPI),
          DEEP_MONO_MIN_DPI,
          MONO_PROOF_SOURCE_DPI,
        )
      ).ok,
    ).toBe(true);
  });

  it("fails bytes that are not a PDF", async () => {
    const verdict = await monoFloorVerdict(
      new Uint8Array([1, 2, 3]),
      DEEP_MONO_MIN_DPI,
    );
    expect(verdict).toEqual({
      ok: false,
      detail: "the output could not be read as a PDF",
    });
  });
});
