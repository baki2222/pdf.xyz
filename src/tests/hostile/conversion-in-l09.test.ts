// @native-canvas
/**
 * Hostile-input regressions for image and text inputs to PDF (lane l09 of
 * the conversion-in matrix, branch test/hostile-matrix, 2026-11-08). Each
 * test is named by its finding and asserts the behaviour the product should
 * have, at the entry point the user reaches: the image engine
 * (`imagesToPdf` / `imagesToPdfs` / `buildImagePdf`), the add-time check
 * (`imageDecodes`), the TIFF reader, Text to PDF and Scan to PDF.
 *
 * Hangs and memory bombs run in a child process (`bounded.ts`): see
 * conversion-in-l09.child.ts.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { PdfEngineError } from "@/lib/pdf/engine-errors";
import {
  buildImagePdf,
  imagePageCount,
  imagesToPdf,
  imagesToPdfs,
  unsupportedImageMessage,
  type ImagePdfInput,
} from "@/lib/pdf/image-to-pdf";
import {
  imageDecodes,
  imageIntakeProblem,
  undecodableImageMessage,
} from "@/lib/pdf/image-intake";
import { tooManyPixelsMessage } from "@/lib/pdf/raster-check";
import { decodePageImages } from "@/tests/pdf-image-decode";
import type { ImagePageOptions } from "@/lib/pdf/image-page-layout";
import { MAX_DECODED_PIXELS } from "@/lib/pdf/pixel-ceiling";
import {
  MIN_CUSTOM_PAGE_PT,
  pageSetupProblem,
} from "@/lib/pdf/image-page-custom";
import {
  MAX_ORDINARY_TIFF_DPI,
  MIN_BELIEVED_PAGE_PT,
  readTiffPages,
} from "@/lib/pdf/tiff";
import { MAX_PLAUSIBLE_DPI } from "@/lib/pdf/image-density";
import { scansToPdf } from "@/lib/pdf/scan-to-pdf";
import { layoutPlainText, textToPdf } from "@/lib/pdf/text-to-pdf";
import {
  MAX_TEXT_PAGES,
  TOO_MANY_TEXT_PAGES,
} from "@/lib/pdf/text-page-ceiling";
import { MAX_SOURCE_BYTES } from "@/lib/tools/limits";
import { JPEG_30X20, spliceAfterSoi } from "@/tests/jpeg-fixtures";
import { boxOf, drawnImages } from "@/tests/drawn-images";
import { useNodeFontSource } from "@/tests/unicode-fonts";
import { runBounded } from "./bounded";
import * as F from "./conversion-in.fixtures";
import { FLAT_GREY_MOZJPEG, REAL_JPEGS } from "./real-jpegs.fixtures";

const CHILD = "src/tests/hostile/conversion-in-l09.child.ts";

/** "x" and a form feed: one page of Text to PDF in two bytes (built from char codes). */
const XFF = "x" + String.fromCharCode(0x0c);
const NL = String.fromCharCode(0x0a);

const img = (name: string, bytes: Uint8Array): ImagePdfInput => ({
  name,
  type: "",
  bytes,
});

const FIT: ImagePageOptions = {
  pageSize: "fit",
  orientation: "auto",
  margin: "none",
  photoDetails: "remove",
};

/** The three engine entry points that embed a user's image. */
const ENTRIES = {
  imagesToPdf: (files: ImagePdfInput[]) => imagesToPdf("jpg", files),
  imagesToPdfs: (files: ImagePdfInput[]) => imagesToPdfs("jpg", files),
  buildImagePdf: (files: ImagePdfInput[]) =>
    buildImagePdf("jpg", files, FIT, []),
} as const;

const JPEG_SOS = F.sosOffset(F.VALID_JPEG);
const HALF_JPEG = F.VALID_JPEG.subarray(0, F.VALID_JPEG.length >> 1);
const SOS_JPEG = F.VALID_JPEG.subarray(0, JPEG_SOS + 2);
/** Cut one byte short of its end: the EOI marker is gone, the scan is not. */
const NO_EOI_JPEG = F.VALID_JPEG.subarray(0, F.VALID_JPEG.length - 2);

/** An APP1 segment holding a WHOLE JPEG, as an Exif thumbnail does. */
function withThumbnail(jpeg: Uint8Array): Uint8Array {
  const payload = new Uint8Array(6 + JPEG_30X20.length);
  payload.set([0x45, 0x78, 0x69, 0x66, 0, 0]); // "Exif\0\0"
  payload.set(JPEG_30X20, 6);
  const seg = new Uint8Array(4 + payload.length);
  seg.set([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 255]);
  seg.set(payload, 4);
  return spliceAfterSoi(jpeg, seg);
}

/** Bytes from the end of a JPEG's first SOS header to its last FF D9. */
function scanLength(jpeg: Uint8Array): number {
  const sos = F.sosOffset(jpeg);
  const headerEnd = sos + 2 + ((jpeg[sos + 2]! << 8) | jpeg[sos + 3]!);
  return jpeg.lastIndexOf(0xd9) - 1 - headerEnd;
}

/**
 * The control JPEG claiming `width` x `height`, its scan data padded with
 * zero bytes (legal entropy-coded data) to `scan` bytes: the shape of a real
 * file whose data matches its size, without encoding 100 MP in a test.
 */
function jpegWithScan(width: number, height: number, scan: number) {
  const base = F.jpegClaiming(width, height);
  const pad = scan - scanLength(base);
  if (pad < 0) throw new Error("fixture: scan shorter than the control's");
  const eoi = base.length - 2;
  const out = new Uint8Array(base.length + pad);
  out.set(base.subarray(0, eoi));
  out.set(base.subarray(eoi), eoi + pad);
  return out;
}

describe("fixture health", () => {
  it("the control JPEG has its SOS after the half cut, and ends in EOI", () => {
    expect(JPEG_SOS).toBeGreaterThan(HALF_JPEG.length);
    expect([...F.VALID_JPEG.subarray(-2)]).toEqual([0xff, 0xd9]);
    expect(Object.keys(REAL_JPEGS).length).toBeGreaterThanOrEqual(8);
    for (const bytes of Object.values(REAL_JPEGS))
      expect([...bytes.subarray(0, 2), ...bytes.subarray(-2)]).toEqual([
        0xff, 0xd8, 0xff, 0xd9,
      ]);
  });
});

describe("CI-01: a JPEG cut off after its frame header is refused", () => {
  for (const [entry, run] of Object.entries(ENTRIES)) {
    it.each([
      ["cut at half", HALF_JPEG],
      ["cut right after SOS", SOS_JPEG],
      ["missing only its EOI", NO_EOI_JPEG],
    ])(`CI-01: ${entry} refuses a JPEG %s`, async (_what, bytes) => {
      await expect(run([img("a.jpg", bytes)])).rejects.toThrow(
        new PdfEngineError(undecodableImageMessage("a.jpg", "jpg")),
      );
    });
  }

  it("CI-01: the add-time check refuses the same cut files", async () => {
    for (const bytes of [HALF_JPEG, SOS_JPEG, NO_EOI_JPEG])
      expect(await imageDecodes(bytes, "jpg")).toBe(false);
  });

  it("CI-01: an Exif thumbnail's own end marker does not stand in for the image's", async () => {
    const thumbed = withThumbnail(F.VALID_JPEG);
    // Positive control: the whole file, thumbnail and all, converts.
    expect(await imageDecodes(thumbed, "jpg")).toBe(true);
    // The same file cut inside its main scan still holds the thumbnail's EOI.
    const sos = F.sosOffset(thumbed.subarray(JPEG_30X20.length + 10));
    const cut = thumbed.subarray(0, JPEG_30X20.length + 10 + sos + 20);
    expect(cut.indexOf(0xd9)).toBeGreaterThan(0);
    expect(await imageDecodes(cut, "jpg")).toBe(false);
  });

  it("CI-01 positive control: every real encoder's JPEG converts, and bytes after EOI are tolerated", async () => {
    const trailing = new Uint8Array(F.VALID_JPEG.length + 64);
    trailing.set(F.VALID_JPEG);
    trailing.set(F.noise(64), F.VALID_JPEG.length);
    const files = [
      ...Object.entries(REAL_JPEGS).map(([n, b]) => img(`${n}.jpg`, b)),
      img("trailing.jpg", trailing),
      img("thumb.jpg", withThumbnail(F.VALID_JPEG)),
    ];
    for (const file of files)
      expect(await imageDecodes(file.bytes, "jpg"), file.name).toBe(true);
    const doc = await PDFDocument.load(await imagesToPdf("jpg", files));
    expect(doc.getPageCount()).toBe(files.length);
  });
});

describe("CI-02 / CI-03: a JPEG's declared size is checked", () => {
  it("CI-02: a 30 x 20 JPEG claiming 65,535 x 65,535 is refused as damaged: its scan data cannot hold that", async () => {
    // HISTORY: the first fix refused this with the pixel-ceiling sentence
    // ("more than the 100 megapixels"), which also refused real 102 MP
    // camera JPEGs (review, 2026-11-08). The defect is a size the data
    // cannot hold, so the file is called what it is: damaged.
    await expect(
      imagesToPdf("jpg", [img("a.jpg", F.jpegClaiming(65_535, 65_535))]),
    ).rejects.toThrow(undecodableImageMessage("a.jpg", "jpg"));
    expect(await imageDecodes(F.jpegClaiming(65_535, 65_535), "jpg")).toBe(
      false,
    );
  });

  // INVERTED (review, 2026-11-08). This was "CI-02: the ceiling is the
  // shared MAX_DECODED_PIXELS, at its edge", asserting 10,000 x 10,001 was
  // refused "by size". A JPEG is not decoded on this path, so that ceiling
  // refused real files that converted before the lane. Each frame below
  // carries scan data at 170 px a byte, libjpeg-turbo's ratio for a flat
  // grey frame (measured), so it is as plausible as a real file.
  it.each([
    ["Fujifilm GFX100 / Hasselblad X2D", 11_648, 8_736],
    ["Phase One IQ4 150 MP", 14_204, 10_652],
    ["stitched panorama", 30_000, 6_000],
  ])(
    "CI-02: a %s JPEG (%i x %i), over 100 MP, still goes in",
    async (_label, w, h) => {
      const bytes = jpegWithScan(w, h, Math.ceil((w * h) / 170));
      expect(w * h).toBeGreaterThan(MAX_DECODED_PIXELS);
      expect(await imageDecodes(bytes, "jpg")).toBe(true);
      const doc = await PDFDocument.load(
        await imagesToPdf("jpg", [img("a.jpg", bytes)]),
      );
      expect(doc.getPageCount()).toBe(1);
    },
  );

  it("CI-02: the bound is MAX_PIXELS_PER_SCAN_BYTE, at its edge, and it is the one-bit proof", async () => {
    const { jpegFrameProblem, MAX_PIXELS_PER_SCAN_BYTE } =
      await import("@/lib/pdf/raster-check");
    // 8 bits a byte x 64 px a block x Vmax 4: one bit per block at least.
    expect(MAX_PIXELS_PER_SCAN_BYTE).toBe(8 * 64 * 4);
    const w = 4096;
    const h = 4096;
    const edge = (w * h) / MAX_PIXELS_PER_SCAN_BYTE;
    expect(jpegFrameProblem(jpegWithScan(w, h, edge))).toBeNull();
    expect(jpegFrameProblem(jpegWithScan(w, h, edge - 1))).toBe("damaged");
  });

  it("CI-02 second bound: the flattest real encoder output sits far under the bound", async () => {
    const { jpegFrameProblem, MAX_PIXELS_PER_SCAN_BYTE } =
      await import("@/lib/pdf/raster-check");
    const ratio = (1024 * 768) / scanLength(FLAT_GREY_MOZJPEG);
    // Health check: the fixture IS the compressible extreme it claims.
    expect(ratio).toBeGreaterThan(300);
    expect(ratio * 4).toBeLessThan(MAX_PIXELS_PER_SCAN_BYTE);
    expect(jpegFrameProblem(FLAT_GREY_MOZJPEG)).toBeNull();
    const doc = await PDFDocument.load(
      await imagesToPdf("jpg", [img("flat.jpg", FLAT_GREY_MOZJPEG)]),
    );
    expect(doc.getPageCount()).toBe(1);
  });

  // INVERTED (hostile residuals res4, l09#126/#131, 2026-11-09). This was
  // "CI-02 limit: an arithmetic-coded frame (SOF9) is not held to the
  // one-bit bound", asserting jpegFrameProblem returned null for a 443-byte
  // SOF9 file claiming 65,535 x 65,535: the one-bit proof does not hold for
  // arithmetic coding, and NOTHING was put in its place, so imagesToPdf
  // wrote a 1,388-byte PDF holding a 4.29 GP image XObject (which pdf.js
  // cannot decode at all: it reads SOF0..SOF2 only). An arithmetic frame is
  // now held to MAX_DECODED_PIXELS instead, with the size refusal.
  it("CI-02: an arithmetic-coded frame (SOF9) over the pixel ceiling is refused by size", async () => {
    const bytes = F.jpegClaiming(65_535, 65_535);
    bytes[F.sofOffset(bytes) + 1] = 0xc9;
    const message = tooManyPixelsMessage("a.jpg", {
      width: 65_535,
      height: 65_535,
    });
    await expect(imagesToPdf("jpg", [img("a.jpg", bytes)])).rejects.toThrow(
      message,
    );
    expect(await imageIntakeProblem("a.jpg", bytes, "jpg")).toBe(message);
  });

  it("CI-02: the arithmetic ceiling is MAX_DECODED_PIXELS, at its edge", async () => {
    const arithmetic = (w: number, h: number) => {
      const bytes = F.jpegClaiming(w, h);
      bytes[F.sofOffset(bytes) + 1] = 0xc9;
      return bytes;
    };
    // Health check: the edge frame is far over the one-bit bound, so only
    // the ceiling can be what lets it through.
    expect(10_000 * 10_000).toBe(MAX_DECODED_PIXELS);
    const at = arithmetic(10_000, 10_000);
    expect(await imageIntakeProblem("a.jpg", at, "jpg")).toBeNull();
    expect(
      (
        await PDFDocument.load(await imagesToPdf("jpg", [img("a.jpg", at)]))
      ).getPageCount(),
    ).toBe(1);
    await expect(
      imagesToPdf("jpg", [img("a.jpg", arithmetic(10_000, 10_001))]),
    ).rejects.toThrow(
      tooManyPixelsMessage("a.jpg", { width: 10_000, height: 10_001 }),
    );
    // A small arithmetic frame goes in.
    expect(
      await imageIntakeProblem("a.jpg", arithmetic(30, 20), "jpg"),
    ).toBeNull();
    // Control: the same 65,535-square header, Huffman-coded, is still
    // refused by the one-bit bound as damaged, not by size.
    expect(
      await imageIntakeProblem("a.jpg", F.jpegClaiming(65_535, 65_535), "jpg"),
    ).toBe(undecodableImageMessage("a.jpg", "jpg"));
  });

  it.each([
    [0, 0],
    [0, 20],
    [30, 0],
  ])(
    "CI-03: a JPEG claiming %i x %i is refused as undecodable",
    async (w, h) => {
      await expect(
        imagesToPdf("jpg", [img("a.jpg", F.jpegClaiming(w, h))]),
      ).rejects.toThrow(undecodableImageMessage("a.jpg", "jpg"));
      expect(await imageDecodes(F.jpegClaiming(w, h), "jpg")).toBe(false);
    },
  );
});

/**
 * Hostile residuals res4 (l09#132, 2026-11-09). The segment walk refused any
 * non-0xFF byte before a marker as "damaged". libjpeg skips such bytes with
 * a warning ("Corrupt JPEG data: N extraneous bytes before marker"), as
 * browsers do, and older camera and phone writers produce them, so a real
 * photo was refused. The bytes are now skipped, and dropped from the copy
 * that is embedded, so pdf-lib, the EXIF and metadata walkers, and the
 * viewer see clean segments.
 */
describe("CI-12: extraneous bytes between a JPEG's segments are skipped, as libjpeg does", () => {
  /** `real` with `junk` inserted after its first segment (APP0 or DQT). */
  const withJunk = (real: Uint8Array, junk: number[]) => {
    const cut = 4 + ((real[4]! << 8) | real[5]!);
    const out = new Uint8Array(real.length + junk.length);
    out.set(real.subarray(0, cut));
    out.set(junk, cut);
    out.set(real.subarray(cut), cut + junk.length);
    return out;
  };

  it.each(Object.keys(REAL_JPEGS))(
    "a real %s JPEG with two 0x00 bytes after its first segment embeds and renders as the clean file does",
    async (key) => {
      const real = REAL_JPEGS[key]!;
      const junk = withJunk(real, [0, 0]);
      expect(await imageIntakeProblem("x.jpg", junk, "jpg")).toBeNull();
      const [clean] = await decodePageImages(
        await imagesToPdf("jpg", [img("x.jpg", real)]),
      );
      const seen = await decodePageImages(
        await imagesToPdf("jpg", [img("x.jpg", junk)]),
      );
      // Health check: the clean file decodes through pdf.js at all.
      expect(clean!.width * clean!.height).toBeGreaterThan(0);
      expect(seen).toHaveLength(1);
      expect(seen[0]!.width).toBe(clean!.width);
      expect(seen[0]!.height).toBe(clean!.height);
      expect(Buffer.from(seen[0]!.gray).equals(Buffer.from(clean!.gray))).toBe(
        true,
      );
    },
  );

  it("other junk bytes, and an FF 00 pair, are skipped too", async () => {
    const real = REAL_JPEGS.baseline!;
    for (const junk of [
      [0x12, 0x34, 0x56],
      [0xff, 0x00, 0x07],
    ]) {
      const bytes = withJunk(real, junk);
      expect(await imageIntakeProblem("x.jpg", bytes, "jpg")).toBeNull();
      const doc = await PDFDocument.load(
        await imagesToPdf("jpg", [img("x.jpg", bytes)]),
      );
      expect(doc.getPageCount()).toBe(1);
    }
  });

  it("controls: no SOI, and a file cut inside a segment, are still damaged", async () => {
    const { jpegFrameProblem } = await import("@/lib/pdf/raster-check");
    const real = REAL_JPEGS.baseline!;
    const junk = withJunk(real, [0, 0]);
    // Health check: the junk file itself passes.
    expect(jpegFrameProblem(junk)).toBeNull();
    expect(jpegFrameProblem(junk.subarray(2))).toBe("damaged");
    // Cut inside the frame header, after the junk.
    const sof = F.sofOffset(real) + 2;
    expect(jpegFrameProblem(junk.subarray(0, sof + 6))).toBe("damaged");
    // Junk that runs to the end with no marker after it.
    const cut = 4 + ((real[4]! << 8) | real[5]!);
    expect(jpegFrameProblem(junk.subarray(0, cut + 2))).toBe("damaged");
  });
});

describe("CI-04 / CI-05: a PNG's declared size is checked before anything is inflated", () => {
  it(
    "CI-04: a 141 KB Flate bomb of 12,000 x 12,000 is refused by the 100 MP ceiling",
    { timeout: 60_000 },
    async () => {
      const r = await runBounded(CHILD, ["png-bomb"], 45_000);
      expect(r).toMatchObject({
        kind: "settled",
        value: {
          refused:
            '"a.png" is 12,000 × 12,000 pixels, more than the 100 megapixels an image can have here.',
        },
      });
    },
  );

  it(
    "CI-05: a PNG claiming 20,000 x 20,000 RGBA is refused before its 1.6 GB buffer is allocated",
    { timeout: 60_000 },
    async () => {
      const r = await runBounded(CHILD, ["png-claiming"], 45_000);
      expect(r.kind).toBe("settled");
      const value = (r as { value: { refused: string; largest: number } })
        .value;
      expect(value.refused).toMatch(/more than the 100 megapixels/);
      // Health check: the probe saw allocations at all.
      expect(value.largest).toBeGreaterThan(0);
      expect(value.largest).toBeLessThan(MAX_DECODED_PIXELS);
    },
  );

  it("CI-04: the add-time check refuses an over-ceiling PNG too", async () => {
    expect(await imageDecodes(F.pngClaiming(20_000, 20_000, 6), "png")).toBe(
      false,
    );
  });

  // Hostile residuals res4 (l09#128): the add-time check returned a bare
  // boolean, so the runner said '"x" could not be decoded as a PNG image.'
  // of a VALID PNG that is merely over the ceiling, while Create PDF said
  // the true thing. Add time and run time now say the same sentence.
  it("CI-04: an over-ceiling PNG gets the size refusal at add time, the same words as at run", async () => {
    const bytes = F.pngClaiming(20_000, 20_000);
    const message = tooManyPixelsMessage("big.png", {
      width: 20_000,
      height: 20_000,
    });
    expect(await imageIntakeProblem("big.png", bytes, "png")).toBe(message);
    await expect(imagesToPdf("png", [img("big.png", bytes)])).rejects.toThrow(
      message,
    );
    // Controls: a damaged PNG still gets the decode refusal; a whole one none.
    const whole = F.validGreyPng(8, 8);
    expect(
      await imageIntakeProblem(
        "cut.png",
        whole.subarray(0, whole.length - 20),
        "png",
      ),
    ).toBe(undecodableImageMessage("cut.png", "png"));
    expect(await imageIntakeProblem("ok.png", whole, "png")).toBeNull();
  });
});

describe("CI-07: a TIFF resolution that would make a speck is not believed", () => {
  const speck = () =>
    F.tiffWithRational(0xffffffff, 1, { width: 100, height: 100 });

  it("CI-07: under Fit to image, the page is one point per pixel", async () => {
    const doc = await PDFDocument.load(
      await imagesToPdf("png", [img("a.tif", speck())], FIT),
    );
    expect(doc.getPage(0).getSize()).toEqual({ width: 100, height: 100 });
  });

  it("CI-07: on Letter, the 100 px image is drawn 100 pt wide, not as a speck", async () => {
    const bytes = await imagesToPdf("png", [img("a.tif", speck())]);
    const [drawn] = await drawnImages(bytes);
    const box = boxOf(drawn!.ctm);
    expect(box.x1 - box.x0).toBeCloseTo(100, 5);
  });

  it("CI-07: the smallest believed page is the smallest custom page", () => {
    expect(MIN_BELIEVED_PAGE_PT).toBe(MIN_CUSTOM_PAGE_PT);
  });

  it.each([
    ["a 100 x 100 px icon", 100, 100, 24],
    ["a 140 x 50 px signature crop", 140, 50, 33.6],
  ])(
    "CI-07 positive control (review): %s at an ordinary 300 dpi keeps its size on paper",
    (_label, width, height, widthPt) => {
      // HISTORY: the first CI-07 fix ignored any resolution that made a page
      // under half an inch, so these were laid out at 1 px a point, 4 x too
      // big. A resolution up to MAX_PLAUSIBLE_DPI is believed whatever the
      // page size; the half-inch rule only rescues film scans above it.
      const [page] = readTiffPages(
        "small.tif",
        F.tiffWithRational(300, 1, { width, height }),
      );
      expect(page!.dpi).toEqual({ x: 300, y: 300 });
      expect(page!.widthPt).toBeCloseTo(widthPt, 5);
    },
  );

  it("CI-07: the TIFF reader's ordinary-dpi line is the JPG / PNG one", () => {
    expect(MAX_ORDINARY_TIFF_DPI).toBe(MAX_PLAUSIBLE_DPI);
    // At that line a 100 px page is believed (3 pt); one dpi over, not.
    const at = (dpi: number) =>
      readTiffPages(
        "edge.tif",
        F.tiffWithRational(dpi, 1, { width: 100, height: 100 }),
      )[0]!.dpi;
    expect(at(MAX_PLAUSIBLE_DPI)).toEqual({
      x: MAX_PLAUSIBLE_DPI,
      y: MAX_PLAUSIBLE_DPI,
    });
    expect(at(MAX_PLAUSIBLE_DPI + 1)).toBeNull();
  });

  it("CI-07 positive control: a 4,000 dpi film-scan resolution is still believed", () => {
    // 2,000 px at 4,000 dpi is half an inch: the smallest page believed.
    const [page] = readTiffPages(
      "film.tif",
      F.tiffWithRational(4000, 1, { width: 2000, height: 10 }),
    );
    expect(page!.dpi).toEqual({ x: 4000, y: 4000 });
    expect(page!.widthPt).toBeCloseTo(36, 5);
    // ...and just under half an inch is not.
    const [small] = readTiffPages(
      "film.tif",
      F.tiffWithRational(4000, 1, { width: 1990, height: 10 }),
    );
    expect(small!.dpi).toBeNull();
    expect(small!.widthPt).toBe(1990);
  });
});

describe("CI-08: a Fit to image page is never below PDF's 3-unit minimum", () => {
  it.each([
    [20_000, 1],
    [1, 1],
    [2, 50],
  ])(
    "CI-08: a %i x %i PNG gets a page at least 3 pt a side, the image not stretched",
    async (w, h) => {
      const bytes = await imagesToPdf(
        "png",
        [img("a.png", F.validGreyPng(w, h))],
        FIT,
      );
      const doc = await PDFDocument.load(bytes);
      const size = doc.getPage(0).getSize();
      expect(Math.min(size.width, size.height)).toBeGreaterThanOrEqual(3);
      const [drawn] = await drawnImages(bytes);
      const box = boxOf(drawn!.ctm);
      // The image keeps its own size and shape, centred on the page.
      const scale = Math.min(1, 14_400 / w, 14_400 / h);
      expect(box.x1 - box.x0).toBeCloseTo(w * scale, 5);
      expect(box.y1 - box.y0).toBeCloseTo(h * scale, 5);
      expect(box.x0).toBeCloseTo((size.width - w * scale) / 2, 5);
    },
  );
});

describe("CI-09: a dangling next-IFD pointer ends the chain, as libtiff does", () => {
  it("CI-09: two good pages and a next pointer past EOF make a 2-page PDF", async () => {
    const t = F.tiffWithLastNext(2, 0x7fffffff);
    expect(readTiffPages("a.tif", t)).toHaveLength(2);
    expect(await imagePageCount(img("a.tif", t))).toBe(2);
    const doc = await PDFDocument.load(
      await imagesToPdf("png", [img("a.tif", t)]),
    );
    expect(doc.getPageCount()).toBe(2);
  });

  it("CI-09 control: a first IFD past EOF is still a damaged TIFF, named without a page", () => {
    const t = F.validTiff(1);
    const bad = new Uint8Array(t);
    bad.set([0xff, 0xff, 0xff, 0x7f], 4);
    expect(() => readTiffPages("a.tif", bad)).toThrow(
      '"a.tif" is a damaged TIFF and could not be read.',
    );
  });
});

describe("CI-10: a PNG with a second IHDR is damaged", () => {
  it("CI-10: refused by the engine and by the add-time check", async () => {
    const png = F.pngTwoHeaders([1, 1], [40, 30]);
    await expect(imagesToPdf("png", [img("a.png", png)])).rejects.toThrow(
      undecodableImageMessage("a.png", "png"),
    );
    expect(await imageDecodes(png, "png")).toBe(false);
    // Positive control: a single IHDR of either size converts.
    expect(await imageDecodes(F.validGreyPng(40, 30), "png")).toBe(true);
  });
});

describe("CI-11: Text to PDF bounds its page count", () => {
  it(
    "CI-11: a 2 MB form-feed flood is refused in seconds, not laid out as a million pages",
    { timeout: 60_000 },
    async () => {
      const r = await runBounded(CHILD, ["form-feeds"], 30_000);
      expect(r).toMatchObject({
        kind: "settled",
        value: {
          refused:
            "This text would make more than 5,000 pages, the most one PDF can have here. Split it into smaller files first.",
        },
      });
      expect(r.ms).toBeLessThan(30_000);
    },
  );
});

describe("CI-11: the 5,000-page ceiling, against real text", () => {
  const courier = async () =>
    (await PDFDocument.create()).embedFont(StandardFonts.Courier);

  it("CI-11: exactly the ceiling is laid out; one page more is refused", async () => {
    const font = await courier();
    expect(
      layoutPlainText(XFF.repeat(MAX_TEXT_PAGES), font).pages,
    ).toHaveLength(MAX_TEXT_PAGES);
    expect(() => layoutPlainText(XFF.repeat(MAX_TEXT_PAGES + 1), font)).toThrow(
      new PdfEngineError(TOO_MANY_TEXT_PAGES),
    );
    // Blank lines reach it too, without a single form feed.
    expect(() =>
      layoutPlainText(NL.repeat(46 * MAX_TEXT_PAGES + 1), font),
    ).toThrow(TOO_MANY_TEXT_PAGES);
  });

  it(
    "CI-11 headroom: 2 MB of prose is ~670 pages, 2 MB of 20-byte lines ~2,500",
    { timeout: 60_000 },
    async () => {
      const font = await courier();
      const words =
        "lorem ipsum dolor sit amet consectetur adipiscing elit sed do";
      const prose = (words + " ").repeat(
        Math.ceil(MAX_SOURCE_BYTES / (words.length + 1)),
      );
      const proseText = prose.slice(0, MAX_SOURCE_BYTES);
      const logLine = "2026-11-08 12:00 ok" + NL; // 20 bytes
      const logText = logLine.repeat(
        Math.floor(MAX_SOURCE_BYTES / logLine.length),
      );
      const prosePages = layoutPlainText(proseText, font).pages.length;
      const logPages = layoutPlainText(logText, font).pages.length;
      console.log(`[CI-11] prose ${prosePages} pages, log ${logPages} pages`);
      expect(prosePages).toBeGreaterThan(600);
      expect(prosePages).toBeLessThan(750);
      expect(logPages).toBeGreaterThan(2_350);
      expect(logPages).toBeLessThan(2_500);
      expect(MAX_TEXT_PAGES / logPages).toBeGreaterThanOrEqual(2);
    },
  );

  it(
    "CI-11: a text at the ceiling still converts, inside the bound",
    { timeout: 120_000 },
    async () => {
      const r = await runBounded(CHILD, ["ceiling"], 100_000);
      expect(r).toMatchObject({
        kind: "settled",
        value: { pages: MAX_TEXT_PAGES },
      });
      console.log(`[CI-11] ${MAX_TEXT_PAGES} pages converted in ${r.ms} ms`);
    },
  );
});

describe("CI-12: Scan to PDF words a non-JPEG original page", () => {
  it("CI-12: refused with the scan tool's own copy, as a PdfEngineError", async () => {
    const run = scansToPdf(
      [{ enhancement: "original", jpeg: F.noise(100), width: 10, height: 10 }],
      "fit",
    );
    await expect(run).rejects.toThrow(
      new PdfEngineError("A photo could not be read."),
    );
    await expect(run).rejects.toBeInstanceOf(PdfEngineError);
  });
});

describe("CI-13: the engine's page-setup gate refuses what the parsers refuse", () => {
  const png = () => [img("a.png", F.validGreyPng())];
  it.each([
    [
      "a NaN custom margin",
      { pageSize: "letter", margin: "custom", customMarginPt: NaN },
    ],
    ["a negative custom margin", { margin: "custom", customMarginPt: -1e6 }],
    [
      "a custom margin over 2 in under Fit",
      { margin: "custom", customMarginPt: 145 },
    ],
    [
      "a NaN custom size",
      { pageSize: "custom", customSize: { width: NaN, height: 100 } },
    ],
    [
      "an infinite custom size",
      { pageSize: "custom", customSize: { width: 100, height: Infinity } },
    ],
    [
      "a custom size under half an inch",
      { pageSize: "custom", customSize: { width: 10, height: 100 } },
    ],
  ] as const)("CI-13: %s is refused with copy", async (_what, extra) => {
    const options = { ...FIT, ...extra } as ImagePageOptions;
    const problem = pageSetupProblem(options);
    expect(problem).toMatch(
      /^(Enter a margin from 0 to|Each side of a custom page must be from)/,
    );
    await expect(imagesToPdf("png", png(), options)).rejects.toThrow(
      new PdfEngineError(problem!),
    );
  });

  it("CI-13 positive control: the edges the parsers accept still lay out", async () => {
    for (const extra of [
      { margin: "custom", customMarginPt: 0 },
      { margin: "custom", customMarginPt: 144 },
      { pageSize: "custom", customSize: { width: 36, height: 14_400 } },
    ] as const) {
      const options = { ...FIT, ...extra } as ImagePageOptions;
      expect(pageSetupProblem(options)).toBeUndefined();
      await expect(imagesToPdf("png", png(), options)).resolves.toBeInstanceOf(
        Uint8Array,
      );
    }
  });
});

describe("CI-14: an invalid code point is named as one, not as a script", () => {
  const restore = useNodeFontSource;
  it.each([
    ["a lone high surrogate", 0xd800, "U+D800"],
    ["a lone low surrogate", 0xdc00, "U+DC00"],
    ["U+FFFE", 0xfffe, "U+FFFE"],
    ["U+FFFF", 0xffff, "U+FFFF"],
  ])("CI-14: %s", async (_what, code, label) => {
    const undo = restore();
    try {
      const text = "a" + String.fromCharCode(code) + "b";
      const run = textToPdf(text);
      await expect(run).rejects.toBeInstanceOf(PdfEngineError);
      const message = await run.catch((e: Error) => e.message);
      expect(message).toContain(label);
      expect(message).toContain("not characters any font can draw");
      expect(message).not.toMatch(/script|Bengali/);
      expect(message).not.toContain(String.fromCharCode(code));
    } finally {
      undo();
    }
  });
});

describe("CI-16: an AVIF under a mif1 major brand is named AVIF", () => {
  const ftyp = (major: string, compatible: string) => {
    const b = F.ftypOf(major);
    b.set(F.latin1(compatible), 16);
    return b;
  };
  it("CI-16: major mif1, compatible avif or avis → AVIF", () => {
    expect(unsupportedImageMessage("a.png", ftyp("mif1", "avif"))).toBe(
      '"a.png" is an AVIF image. Only PNG, JPG, WebP, GIF, BMP and TIFF images can be converted here.',
    );
    expect(unsupportedImageMessage("a.png", ftyp("msf1", "avis"))).toMatch(
      /is an AVIF image/,
    );
  });

  it("CI-16 controls: HEIC stays HEIC, a major avif stays AVIF", () => {
    expect(unsupportedImageMessage("a.png", ftyp("mif1", "heic"))).toMatch(
      /is a HEIC image/,
    );
    expect(unsupportedImageMessage("a.png", F.ftypOf("mif1"))).toMatch(
      /is a HEIC image/,
    );
    expect(unsupportedImageMessage("a.png", F.ftypOf("heic"))).toMatch(
      /is a HEIC image/,
    );
    expect(unsupportedImageMessage("a.png", F.ftypOf("avif"))).toMatch(
      /is an AVIF image/,
    );
    // A brand list past the box's own size is not read: offset 24 is
    // outside ftypOf's 24-byte box.
    const outside = F.ftypOf("mif1");
    outside.set(F.latin1("avif"), 24);
    expect(unsupportedImageMessage("a.png", outside)).toMatch(/HEIC/);
  });
});
