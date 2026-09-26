// @vitest-environment node
/**
 * Grayscale PDF must produce a GRAYSCALE PDF — in the colour space, not just
 * in the pixels.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * Until this file, every page was desaturated on a canvas and then encoded
 * with `canvas.toBlob("image/jpeg")`. The browser's encoder only writes YCbCr,
 * three components, and pdf-lib picks an image's colour space from that count
 * (`JpegEmbedder`: 1 → DeviceGray, 3 → DeviceRGB). So every page shipped as a
 * DeviceRGB image of neutral pixels, on a page first painted with `1 1 1 rg`.
 * Grey to the eye; COLOUR to a print driver, a print shop's preflight, and
 * Acrobat's Output Preview — and "print it in black & white" is the one thing
 * this tool is chosen for.
 *
 * Why nothing caught it: the e2e proof decoded the page images and counted
 * saturated pixels. That measures how the output LOOKS. The property is what
 * the file DECLARES, and neutral pixels in an RGB container pass every
 * look-based check there is.
 *
 * ── WHAT IS CHECKED HERE ────────────────────────────────────────────────────
 *
 * The builder the tool runs is fed luminance planes and its saved bytes are
 * read back two independent ways:
 *  - structurally, by walking EVERY image XObject in the file (not the ones
 *    the pages happen to reference) and every page's decoded content stream;
 *  - visually, by decoding each page image with pdf.js, as a viewer would.
 * The canvas → plane step is `luminancePlane` (pinned against
 * `grayscaleImageData` in grayscale.test.ts); the real-browser run of the
 * whole chain is the grayscale-pdf case in e2e/client-proof/cases.ts.
 */
import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
  rgb,
} from "pdf-lib";
import { encodeGrayJpeg, jpegComponentCount } from "./gray-jpeg";
import {
  createGrayscaleBuilder,
  grayscaleTitle,
  type GrayPageRecord,
} from "./grayscale";
import { embedRasterImage } from "./pdf-lib";
import type { RasterCanvasInfo } from "./render";
import { decodePageImages } from "@/tests/pdf-image-decode";

/** A real 3-component (YCbCr) JPEG — what `canvas.toBlob` always produced. */
const RGB_JPEG_1X1 = Uint8Array.from(
  Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Ap//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEP/EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EFBABAQAAAAAAAAAAAAAAAAAAARD/2gAIAQEAAT8Qf//Z",
    "base64",
  ),
);

/**
 * Operators that set a colour or colour space. A grayscale page may use only
 * `g`/`G` (DeviceGray); anything here makes it a colour page.
 */
const COLOUR_OPERATORS = /(?:^|\s)(rg|RG|k|K|sc|SC|scn|SCN|cs|CS)(?=\s|$)/g;

/**
 * Everything in a saved PDF that makes it a colour document: every image
 * XObject in the file not declared DeviceGray (or a DCT image whose frame
 * header disagrees), and every colour operator in any page's content.
 */
async function colourViolations(pdf: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(pdf);
  const violations: string[] = [];
  let images = 0;
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (obj.dict.get(PDFName.of("Subtype"))?.toString() !== "/Image") continue;
    images++;
    const space = obj.dict.get(PDFName.of("ColorSpace"))?.toString();
    if (space !== "/DeviceGray") {
      violations.push(`image ${ref} has ColorSpace ${space}`);
    }
    if (obj.dict.get(PDFName.of("Filter"))?.toString() === "/DCTDecode") {
      const components = jpegComponentCount(obj.contents);
      if (components !== 1) {
        violations.push(`image ${ref} is a ${components}-component JPEG`);
      }
    }
  }
  // Health check: a file with no images at all has nothing to be wrong with,
  // and would report a perfect score for the wrong reason.
  if (images === 0) violations.push("no image XObjects at all");

  doc.getPages().forEach((page, index) => {
    const contents = page.node.Contents();
    const streams =
      contents instanceof PDFArray
        ? contents.asArray().map((ref) => doc.context.lookup(ref))
        : [contents];
    for (const stream of streams) {
      if (!(stream instanceof PDFRawStream)) {
        violations.push(`page ${index + 1} content is not a stream`);
        continue;
      }
      const text = new TextDecoder("latin1").decode(
        decodePDFRawStream(stream).decode(),
      );
      for (const match of text.matchAll(COLOUR_OPERATORS)) {
        violations.push(`page ${index + 1} sets colour with "${match[1]}"`);
      }
    }
  });
  return violations;
}

/** Deterministic planes in the two shapes that matter to the encoder choice. */
function photoPlane(width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  let s = 12345;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const wave = 90 * Math.sin(x / 9) * Math.cos(y / 13);
      out[y * width + x] = Math.max(0, Math.min(255, 128 + wave + (s % 48)));
    }
  }
  return out;
}

function textPlane(width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height).fill(255);
  for (let line = 10; line + 6 < height; line += 14) {
    for (let y = line; y < line + 6; y++) {
      for (let x = 12; x < width - 12; x++) {
        if ((x >> 2) % 5 !== 4) out[y * width + x] = 20;
      }
    }
  }
  return out;
}

interface CorpusPage {
  label: string;
  plane: Uint8Array;
  info: RasterCanvasInfo;
}

/** A photo page, a text page, and an off-block page size. */
function corpus(): CorpusPage[] {
  const page = (
    label: string,
    index: number,
    width: number,
    height: number,
    pageWidth: number,
    pageHeight: number,
    make: (w: number, h: number) => Uint8Array,
  ): CorpusPage => ({
    label,
    plane: make(width, height),
    info: { index, width, height, pageWidth, pageHeight },
  });
  return [
    page("photo", 0, 200, 150, 240, 180, photoPlane),
    page("text", 1, 160, 208, 192, 249.6, textPlane),
    page("odd", 2, 37, 23, 44.4, 27.6, photoPlane),
  ];
}

async function build(pages: CorpusPage[], title = "Report (grayscale)") {
  const builder = await createGrayscaleBuilder({ quality: 0.88 });
  const records: GrayPageRecord[] = [];
  for (const page of pages) {
    records.push(await builder.addPage(page.plane, page.info));
  }
  // The builder's own ledger is what grayscalePdf reports from.
  expect(builder.pages).toEqual(records);
  return { bytes: await builder.save(title), records };
}

function psnr(a: Uint8Array, b: Uint8Array): number {
  let se = 0;
  for (let i = 0; i < a.length; i++) se += (a[i]! - b[i]!) ** 2;
  return se === 0 ? Infinity : 10 * Math.log10((255 * 255) / (se / a.length));
}

describe("the colour-space predicate itself", () => {
  // One control per half of the predicate, plus the exact pre-fix shape, so
  // neither half can go blind without this block turning red.
  async function pdfWith(
    image: Uint8Array,
    whiteFill: boolean,
  ): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    if (whiteFill) {
      page.drawRectangle({
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        color: rgb(1, 1, 1),
      });
    }
    const embedded = await embedRasterImage(doc, image, "jpg");
    page.drawImage(embedded, { x: 0, y: 0, width: 100, height: 100 });
    return doc.save();
  }
  const grayJpeg = encodeGrayJpeg(new Uint8Array([128]), 1, 1);

  it("rejects the pre-fix output: an RGB fill and a 3-component JPEG", async () => {
    const found = await colourViolations(await pdfWith(RGB_JPEG_1X1, true));
    expect(found.some((v) => v.includes("ColorSpace /DeviceRGB"))).toBe(true);
    expect(found.some((v) => v.includes("3-component JPEG"))).toBe(true);
    expect(found.some((v) => v.includes('"rg"'))).toBe(true);
  });

  it("rejects an RGB image alone, and an RGB fill alone", async () => {
    expect(await colourViolations(await pdfWith(RGB_JPEG_1X1, false))).toEqual([
      expect.stringContaining("ColorSpace /DeviceRGB"),
      expect.anything(),
    ]);
    expect(await colourViolations(await pdfWith(grayJpeg, true))).toEqual([
      'page 1 sets colour with "rg"',
    ]);
  });

  it("accepts a DeviceGray image with no colour operators", async () => {
    expect(await colourViolations(await pdfWith(grayJpeg, false))).toEqual([]);
  });
});

describe("grayscale builder output", () => {
  it("is a DeviceGray document: every image single-channel, no colour set anywhere", async () => {
    const pages = corpus();
    const { bytes, records } = await build(pages);

    // Health checks: one image per page, and BOTH encodings exercised — a
    // corpus that only ever took one branch would certify the other unseen.
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(pages.length);
    expect(new Set(records.map((r) => r.encoding))).toEqual(
      new Set(["jpeg", "flate"]),
    );
    expect(await colourViolations(bytes)).toEqual([]);
  });

  it("decodes, in pdf.js, to the planes it was given, on pages of the right size", async () => {
    const pages = corpus();
    const { bytes, records } = await build(pages);
    const decoded = await decodePageImages(bytes);

    expect(decoded.map((d) => d.page)).toEqual(pages.map((_, i) => i + 1));
    pages.forEach((page, i) => {
      const image = decoded[i]!;
      expect([image.width, image.height]).toEqual([
        page.info.width,
        page.info.height,
      ]);
      expect(image.view[0]).toBeCloseTo(page.info.pageWidth, 3);
      expect(image.view[1]).toBeCloseTo(page.info.pageHeight, 3);
      expect(image.channelsEqual).toBe(true);
      if (records[i]!.encoding === "flate") {
        // Lossless: byte-for-byte the plane.
        expect(Buffer.from(image.gray).equals(Buffer.from(page.plane))).toBe(
          true,
        );
      } else {
        expect(psnr(page.plane, image.gray)).toBeGreaterThan(30);
      }
    });
  });

  it("keeps the smaller encoding: Flate for text, JPEG for photographs", async () => {
    const pages = corpus();
    const { records } = await build(pages);
    const byLabel = new Map(pages.map((p, i) => [p.label, [p, records[i]!]]));

    const [text, textRecord] = byLabel.get("text") as [
      CorpusPage,
      GrayPageRecord,
    ];
    expect(textRecord.encoding).toBe("flate");
    expect(textRecord.imageBytes).toBeLessThan(
      encodeGrayJpeg(text.plane, text.info.width, text.info.height, 0.88)
        .length,
    );

    const [photo, photoRecord] = byLabel.get("photo") as [
      CorpusPage,
      GrayPageRecord,
    ];
    expect(photoRecord.encoding).toBe("jpeg");
    expect(photoRecord.imageBytes).toBeLessThan(
      deflateSync(photo.plane).length,
    );
  });

  it("refuses a plane that does not match its page's bitmap size", async () => {
    const builder = await createGrayscaleBuilder();
    await expect(
      builder.addPage(new Uint8Array(10), {
        index: 0,
        width: 4,
        height: 4,
        pageWidth: 10,
        pageHeight: 10,
      }),
    ).rejects.toThrow(RangeError);
  });
});

describe("grayscale output title", () => {
  it("carries the source's title, else the file's stem, into the saved Info", async () => {
    const cases: Array<[string | null, string | undefined, string]> = [
      ["Quarterly Report", "q3.pdf", "Quarterly Report (grayscale)"],
      ["  ", "annual   review.pdf", "annual review (grayscale)"],
      [null, "scan.final.PDF", "scan.final (grayscale)"],
      [null, undefined, "Grayscale PDF"],
    ];
    for (const [sourceTitle, sourceName, expected] of cases) {
      const title = grayscaleTitle(sourceTitle, sourceName);
      expect(title).toBe(expected);
      const { bytes } = await build(corpus().slice(0, 1), title);
      expect((await PDFDocument.load(bytes)).getTitle()).toBe(expected);
    }
  });
});
