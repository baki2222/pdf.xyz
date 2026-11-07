import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { boxOf, drawnImages } from "@/tests/drawn-images";
import { JPEG_30X20, JPEG_HEIGHT, JPEG_WIDTH } from "@/tests/jpeg-fixtures";
import {
  greyPng,
  jpegWithExifResolution,
  jpegWithJfifDensity,
  ppmOf,
} from "@/tests/density-fixtures";
import {
  DEFAULT_IMAGE_PAGE_OPTIONS,
  imagePageSizeById,
  type ImagePageOptions,
} from "./image-page-layout";
import { buildImagePdf, imagesToPdf } from "./image-to-pdf";
import {
  MAX_PLAUSIBLE_DPI,
  MIN_PLAUSIBLE_DPI,
  PLACEHOLDER_DPIS,
  isPlausibleDpi,
  storedImageDpi,
} from "./image-density";

/*
 * Audits jpg-to-pdf#4 / png-to-pdf#4 (2026-11-08): under Fit to image, a
 * JPEG or PNG that states a plausible resolution gets a page of its size on
 * paper, as a TIFF already did. Read back from the saved PDF's MediaBox.
 */

const FIT: ImagePageOptions = {
  ...DEFAULT_IMAGE_PAGE_OPTIONS,
  pageSize: "fit",
  margin: "none",
};

async function pageOf(pdf: Uint8Array) {
  const doc = await PDFDocument.load(pdf);
  const { width, height } = doc.getPage(0).getSize();
  return { width, height };
}

const jpg = (bytes: Uint8Array) => ({
  name: "scan.jpg",
  type: "image/jpeg",
  bytes,
});
const png = (bytes: Uint8Array) => ({
  name: "scan.png",
  type: "image/png",
  bytes,
});

describe("stored resolution under Fit to image (audits jpg-to-pdf#4, png-to-pdf#4)", () => {
  it("a 300 dpi A4 scan saved as PNG is an A4 page, not 34 × 49 in", async () => {
    // 2480 × 3508 px is A4 at 300 dpi, the audit's own example.
    const scan = greyPng(2480, 3508, {
      x: ppmOf(300),
      y: ppmOf(300),
      unit: 1,
    });
    const page = await pageOf(await imagesToPdf("png", [png(scan)], FIT));
    const a4 = imagePageSizeById("a4").size!;
    expect(page.width).toBeCloseTo(a4.width, 0);
    expect(page.height).toBeCloseTo(a4.height, 0);
  });

  it.each([
    ["JFIF APP0, dots per inch", jpegWithJfifDensity(300)],
    ["JFIF APP0, dots per cm", jpegWithJfifDensity(118, 118, 2)],
    ["Exif XResolution, inches", jpegWithExifResolution(300)],
  ])("a JPEG's %s sizes the page", async (_how, bytes) => {
    const dpi = storedImageDpi(bytes)!;
    expect(dpi).toBeGreaterThan(299);
    const page = await pageOf(await imagesToPdf("jpg", [jpg(bytes)], FIT));
    expect(page.width).toBeCloseTo((JPEG_WIDTH * 72) / dpi, 3);
    expect(page.height).toBeCloseTo((JPEG_HEIGHT * 72) / dpi, 3);
  });

  it.each([
    ["no density at all", JPEG_30X20],
    ["a JFIF aspect ratio only (units 0)", jpegWithJfifDensity(1, 1, 0)],
    ...PLACEHOLDER_DPIS.map(
      (d) => [`the ${d} dpi placeholder`, jpegWithJfifDensity(d)] as const,
    ),
    ["under the floor", jpegWithJfifDensity(MIN_PLAUSIBLE_DPI - 1)],
    ["over the ceiling", jpegWithJfifDensity(MAX_PLAUSIBLE_DPI + 1)],
    ["non-square pixels", jpegWithJfifDensity(300, 150)],
  ])("%s keeps one pixel per point", async (_how, bytes) => {
    expect(storedImageDpi(bytes)).toBeUndefined();
    const page = await pageOf(await imagesToPdf("jpg", [jpg(bytes)], FIT));
    expect([page.width, page.height]).toEqual([JPEG_WIDTH, JPEG_HEIGHT]);
  });

  it("a PNG's pHYs in unit 0 (aspect only) is ignored", () => {
    expect(
      storedImageDpi(greyPng(4, 4, { x: ppmOf(300), y: ppmOf(300), unit: 0 })),
    ).toBeUndefined();
    expect(
      storedImageDpi(greyPng(4, 4, { x: ppmOf(300), y: ppmOf(300), unit: 1 })),
    ).toBeCloseTo(300, 0);
  });

  it("applies under Fit to image only: on A4 the image box is unchanged", async () => {
    const a4: ImagePageOptions = {
      ...DEFAULT_IMAGE_PAGE_OPTIONS,
      pageSize: "a4",
    };
    const plain = await drawnImages(
      await imagesToPdf("jpg", [jpg(JPEG_30X20)], a4),
    );
    const dense = await drawnImages(
      await imagesToPdf("jpg", [jpg(jpegWithJfifDensity(300))], a4),
    );
    expect(boxOf(dense[0]!.ctm)).toEqual(boxOf(plain[0]!.ctm));
  });

  it("the size-limit builder lays the page out the same way", async () => {
    const page = await pageOf(
      await buildImagePdf("jpg", [jpg(jpegWithJfifDensity(300))], FIT),
    );
    expect(page.width).toBeCloseTo((JPEG_WIDTH * 72) / 300, 3);
  });

  it("the plausibility rule, stated", () => {
    expect(isPlausibleDpi(300)).toBe(true);
    expect(isPlausibleDpi(150)).toBe(true);
    for (const d of PLACEHOLDER_DPIS) expect(isPlausibleDpi(d)).toBe(false);
    expect(isPlausibleDpi(MIN_PLAUSIBLE_DPI)).toBe(true);
    expect(isPlausibleDpi(MAX_PLAUSIBLE_DPI)).toBe(true);
    expect(isPlausibleDpi(Number.NaN)).toBe(false);
  });
});
