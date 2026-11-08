import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { boxOf, drawnImages } from "@/tests/drawn-images";
import { JPEG_30X20, JPEG_HEIGHT, JPEG_WIDTH } from "@/tests/jpeg-fixtures";
import {
  DEFAULT_IMAGE_PAGE_OPTIONS,
  imageMarginPoints,
  imagePageSizeById,
  type ImagePageOptions,
} from "./image-page-layout";
import { buildImagePdf, imagesToPdf } from "./image-to-pdf";

/*
 * Audits jpg-to-pdf#4 / png-to-pdf#4, second half (2026-11-08): "Enlarge to
 * fit" scales an image smaller than the paper up to the margin. Read back
 * from the saved PDF: the image's box under the CTM a viewer applies.
 */

const photo = { name: "small.jpg", type: "image/jpeg", bytes: JPEG_30X20 };
const A4: ImagePageOptions = { ...DEFAULT_IMAGE_PAGE_OPTIONS, pageSize: "a4" };

async function drawn(pdf: Uint8Array) {
  const doc = await PDFDocument.load(pdf);
  const { width, height } = doc.getPage(0).getSize();
  const b = boxOf((await drawnImages(pdf))[0]!.ctm);
  return { width, height, w: b.x1 - b.x0, h: b.y1 - b.y0, b };
}

describe("Small images: Enlarge to fit (audits jpg-to-pdf#4, png-to-pdf#4)", () => {
  it("health check: by default a 30 × 20 image stays 30 × 20 on A4", async () => {
    const d = await drawn(await imagesToPdf("jpg", [photo], A4));
    expect(d.w).toBeCloseTo(JPEG_WIDTH, 6);
    expect(d.h).toBeCloseTo(JPEG_HEIGHT, 6);
  });

  it("Enlarge to fit scales it up to the margin, proportions kept, centred", async () => {
    const d = await drawn(
      await imagesToPdf("jpg", [photo], { ...A4, smallImages: "enlarge" }),
    );
    const margin = imageMarginPoints(A4.margin);
    const a4 = imagePageSizeById("a4").size!;
    expect(d.w).toBeCloseTo(a4.width - margin * 2, 6);
    expect(d.h / d.w).toBeCloseTo(JPEG_HEIGHT / JPEG_WIDTH, 6);
    expect((d.b.y0 + d.b.y1) / 2).toBeCloseTo(a4.height / 2, 6);
  });

  it("a tall image meets the top and bottom margins instead", async () => {
    const d = await drawn(
      await imagesToPdf("jpg", [{ ...photo, rotation: 90 }], {
        ...A4,
        smallImages: "enlarge",
      }),
    );
    const margin = imageMarginPoints(A4.margin);
    expect(d.h).toBeCloseTo(d.height - margin * 2, 6);
    expect(d.w).toBeLessThan(d.width - margin * 2);
  });

  it("does nothing under Fit to image, whose page is the image", async () => {
    const fit: ImagePageOptions = { ...A4, pageSize: "fit", margin: "none" };
    const d = await drawn(
      await imagesToPdf("jpg", [photo], { ...fit, smallImages: "enlarge" }),
    );
    expect([d.width, d.height]).toEqual([JPEG_WIDTH, JPEG_HEIGHT]);
  });

  it("the size-limit builder enlarges the same way", async () => {
    const d = await drawn(
      await buildImagePdf("jpg", [photo], { ...A4, smallImages: "enlarge" }),
    );
    expect(d.w).toBeGreaterThan(JPEG_WIDTH * 10);
  });
});
