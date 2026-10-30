// @native-canvas
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import { boxOf, drawnImages } from "@/tests/drawn-images";
import { JPEG_30X20, JPEG_HEIGHT, JPEG_WIDTH } from "@/tests/jpeg-fixtures";
import { decodePageImages } from "@/tests/pdf-image-decode";
import { encodeGrayJpeg } from "./gray-jpeg";
import { IMAGE_PAGE_SIZES } from "./image-page-layout";
import {
  BW_SENSITIVITY,
  SCAN_ENHANCEMENTS,
  blackWhitePlane,
  documentPlane,
  luminance,
  packBits,
} from "./scan-enhance";
import {
  MAX_SCAN_SIDE_PX,
  SCAN_PAGE_SIZES,
  SCAN_TITLE,
  scanOutputName,
  scanPageLayout,
  scanTargetSize,
  scansToPdf,
  type ScanPageInput,
} from "./scan-to-pdf";

/**
 * Scan to PDF: each filter does what its label says (to the pixel), and the
 * PDF stores what the filter made — read back by pdf-lib (the image's own
 * dictionary) and decoded by pdf.js (an independent reader).
 */

/**
 * A synthetic "phone photo" of a page: paper whose brightness falls from 200
 * on the left to 110 on the right (a shadow), with dark text strokes (value
 * 40 below the local paper) every 10 pixels, in a warm tint.
 */
function photo(width: number, height: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const paper = 200 - (90 * x) / (width - 1);
      const ink = y % 10 < 2 && x % 10 < 6;
      const v = ink ? paper - 70 : paper;
      const p = (y * width + x) * 4;
      rgba[p] = v + 20;
      rgba[p + 1] = v;
      rgba[p + 2] = v - 20;
      rgba[p + 3] = 255;
    }
  }
  return rgba;
}

const isInk = (x: number, y: number) => y % 10 < 2 && x % 10 < 6;

describe("scan-enhance", () => {
  it("offers exactly the three clean-ups the copy names", () => {
    expect(SCAN_ENHANCEMENTS.map((e) => e.label)).toEqual([
      "Original",
      "Document",
      "Black & white",
    ]);
  });

  it("document: one channel, stretched to (nearly) the full range", () => {
    const rgba = photo(80, 60);
    const before = luminance(rgba);
    const after = documentPlane(rgba);
    expect(after.length).toBe(80 * 60);
    const range = (p: Uint8Array) => Math.max(...p) - Math.min(...p);
    expect(range(after)).toBeGreaterThan(range(before));
    expect(Math.min(...after)).toBeLessThanOrEqual(5);
    expect(Math.max(...after)).toBeGreaterThanOrEqual(250);
    // Order is kept: a darker input pixel is never lighter after.
    for (let i = 1; i < before.length; i += 1) {
      if (before[i]! < before[i - 1]!) {
        expect(after[i]!).toBeLessThanOrEqual(after[i - 1]!);
      }
    }
  });

  it("bw: only 0 and 255, ink black and the shadowed paper still white", () => {
    const w = 160;
    const h = 120;
    const plane = blackWhitePlane(photo(w, h), w, h);
    expect(new Set(plane)).toEqual(new Set([0, 255]));
    let wrong = 0;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const black = plane[y * w + x] === 0;
        if (black !== isInk(x, y)) wrong += 1;
      }
    }
    // The darkest paper (110, right edge) is darker than the lightest ink
    // (130, left edge): a fixed threshold must get one of them wrong. The
    // adaptive one gets (almost) every pixel right.
    expect(wrong / (w * h)).toBeLessThan(0.02);
  });

  it("control: a FIXED threshold fails the same photo", () => {
    const w = 160;
    const h = 120;
    const lum = luminance(photo(w, h));
    let wrong = 0;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const black = lum[y * w + x]! < 128;
        if (black !== isInk(x, y)) wrong += 1;
      }
    }
    expect(wrong / (w * h)).toBeGreaterThan(0.1);
    expect(BW_SENSITIVITY).toBeGreaterThan(0);
  });

  it("packs 1-bit rows MSB first, 1 = white, rows padded to a byte", () => {
    const plane = new Uint8Array([255, 0, 255, 255, 0, 0, 0, 0, 0, 255]);
    // Two rows of five.
    expect([...packBits(plane, 5, 2)]).toEqual([0b10110000, 0b00001000]);
  });
});

describe("scanPageLayout", () => {
  const a4 = IMAGE_PAGE_SIZES.find((s) => s.id === "a4")!.size!;

  it("fills an A4 page, scaling a small photo UP", () => {
    const layout = scanPageLayout(300, 400, "a4");
    expect(layout.pageWidth).toBeCloseTo(a4.width);
    expect(layout.pageHeight).toBeCloseTo(a4.height);
    // 3:4 into 210:297 — width-bound, so it spans the page's width.
    expect(layout.width).toBeCloseTo(a4.width);
    expect(layout.x).toBeCloseTo(0);
    expect(layout.height / layout.width).toBeCloseTo(400 / 300);
  });

  it("turns the page landscape for a wide photo", () => {
    const layout = scanPageLayout(4000, 3000, "letter");
    expect(layout.pageWidth).toBe(792);
    expect(layout.pageHeight).toBe(612);
  });

  it("fit to photo: the photo's shape, A4's long side", () => {
    const layout = scanPageLayout(1200, 1600, "fit");
    expect(layout.pageHeight).toBeCloseTo(a4.height);
    expect(layout.pageWidth).toBeCloseTo((a4.height * 1200) / 1600);
    expect(layout.x).toBe(0);
  });

  it("offers A4, US Letter and Fit to photo, in that order", () => {
    expect(SCAN_PAGE_SIZES.map((s) => s.label)).toEqual([
      "A4",
      "US Letter",
      "Fit to photo",
    ]);
  });

  it("caps the long side at the stated pixels, keeping the shape", () => {
    expect(scanTargetSize(4032, 3024)).toEqual({
      width: MAX_SCAN_SIDE_PX,
      height: 1800,
    });
    expect(scanTargetSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

/** Every image XObject in a saved PDF, page by page, with its dictionary. */
async function imageDicts(bytes: Uint8Array): Promise<PDFDict[][]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const xobjects = page.node
      .Resources()
      ?.lookup(PDFName.of("XObject"), PDFDict);
    if (!xobjects) return [];
    return xobjects
      .keys()
      .map((key) => xobjects.lookup(key))
      .filter((o): o is PDFRawStream => o instanceof PDFRawStream)
      .map((o) => o.dict)
      .filter((d) => d.get(PDFName.of("Subtype")) === PDFName.of("Image"));
  });
}

const name = (d: PDFDict, key: string) => d.get(PDFName.of(key))?.toString();
const num = (d: PDFDict, key: string) =>
  (d.get(PDFName.of(key)) as PDFNumber | undefined)?.asNumber();

describe("scansToPdf", () => {
  const w = 160;
  const h = 120;
  const pixels = photo(w, h);

  it("bw stores a 1-bit DeviceGray image that decodes to pure black and white", async () => {
    const plane = blackWhitePlane(pixels, w, h);
    const { bytes, pages } = await scansToPdf(
      [{ enhancement: "bw", plane, width: w, height: h }],
      "a4",
    );
    expect(pages[0]!.encoding).toBe("1-bit-flate");
    const [dicts] = await imageDicts(bytes);
    expect(dicts).toHaveLength(1);
    expect(name(dicts![0]!, "ColorSpace")).toBe("/DeviceGray");
    expect(num(dicts![0]!, "BitsPerComponent")).toBe(1);

    const [decoded] = await decodePageImages(bytes);
    expect(decoded!.width).toBe(w);
    expect(decoded!.channelsEqual).toBe(true);
    expect(new Set(decoded!.gray)).toEqual(new Set([0, 255]));
    // Pixel for pixel what the filter made — not inverted, not shifted.
    expect(Buffer.from(decoded!.gray).equals(Buffer.from(plane))).toBe(true);
  });

  it("document stores ONE channel (DeviceGray), never RGB", async () => {
    const plane = documentPlane(pixels);
    const { bytes, pages } = await scansToPdf(
      [{ enhancement: "document", plane, width: w, height: h }],
      "letter",
    );
    expect(["gray-jpeg", "gray-flate"]).toContain(pages[0]!.encoding);
    const [dicts] = await imageDicts(bytes);
    expect(name(dicts![0]!, "ColorSpace")).toBe("/DeviceGray");
    expect(num(dicts![0]!, "BitsPerComponent")).toBe(8);
    const [decoded] = await decodePageImages(bytes);
    expect(decoded!.channelsEqual).toBe(true);
  });

  it("control: the document plane as a one-component JPEG is gray too", () => {
    // The JPEG branch of "document" — whichever encoding wins, it is gray.
    const jpeg = encodeGrayJpeg(documentPlane(pixels), w, h, 0.85);
    expect(jpeg[0]).toBe(0xff);
    expect(jpeg[1]).toBe(0xd8);
  });

  it("original keeps colour", async () => {
    // A real three-component JPEG written by libvips (red and blue blocks).
    const { bytes, pages } = await scansToPdf(
      [
        {
          enhancement: "original",
          jpeg: JPEG_30X20,
          width: JPEG_WIDTH,
          height: JPEG_HEIGHT,
        },
      ],
      "a4",
    );
    expect(pages[0]!.encoding).toBe("rgb-jpeg");
    const [dicts] = await imageDicts(bytes);
    expect(name(dicts![0]!, "ColorSpace")).toBe("/DeviceRGB");
    const [decoded] = await decodePageImages(bytes);
    expect(decoded!.channelsEqual).toBe(false);
  });

  it("one page per photo, in order, each filling its page", async () => {
    const inputs: ScanPageInput[] = [
      {
        enhancement: "bw",
        plane: blackWhitePlane(pixels, w, h),
        width: w,
        height: h,
      },
      {
        enhancement: "bw",
        plane: new Uint8Array(30 * 40).fill(255),
        width: 30,
        height: 40,
      },
    ];
    const { bytes } = await scansToPdf(inputs, "a4");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getTitle()).toBe(SCAN_TITLE);
    // Page 1 is the wide photo: landscape A4. Page 2 the tall one: portrait.
    const [p1, p2] = doc.getPages().map((p) => p.getSize());
    expect(p1!.width).toBeGreaterThan(p1!.height);
    expect(p2!.height).toBeGreaterThan(p2!.width);
    const drawn = await drawnImages(bytes);
    expect(drawn.map((d) => [d.page, d.width, d.height])).toEqual([
      [0, w, h],
      [1, 30, 40],
    ]);
    // The second photo spans its page's full width (it is width-bound).
    const box = boxOf(drawn[1]!.ctm);
    expect(box.x1 - box.x0).toBeCloseTo(p2!.width, 1);
  });

  it("refuses an empty scan", async () => {
    await expect(scansToPdf([], "a4")).rejects.toThrow(/at least one photo/);
  });

  it("names the download after the day", () => {
    expect(scanOutputName(new Date(2026, 9, 30))).toBe("scan-2026-10-30.pdf");
  });
});
