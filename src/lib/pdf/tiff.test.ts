// @native-canvas
/**
 * TIFF into JPG / PNG to PDF (2026-11-04): `tiff.ts` reads and decodes the
 * pages, `image-to-pdf.ts` puts each on its own PDF page, in order.
 *
 * The oracle is never this module's own reader. Committed fixtures are real
 * Ghostscript output (`src/tests/tiff-fixtures.ts` records how each was
 * made); built fixtures are checked by ROUND TRIP — the samples written are
 * the samples decoded — and every PDF is re-opened from its saved bytes and
 * RENDERED by pdf.js, so a lossless page that inverted its polarity or lost
 * its palette shows up as pixels, not as a field nobody reads.
 *
 * HISTORY: until 2026-11-04 a TIFF was sniffed only to be refused —
 * `"scan.tif" is a TIFF image. Only PNG, JPG, WebP, GIF and BMP images can be
 * converted here.` (image-formats.test.ts held that edge; it now holds HEIC
 * and AVIF, still refused).
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  GS_FIXTURE,
  blockRows,
  rgbRows,
  tiffFixture,
  tiffOf,
  type TiffEntry,
  type TiffPageSpec,
} from "@/tests/tiff-fixtures";
import { renderPdfPages, type RenderedPage } from "@/tests/pdf-render";
import { imagePageCount, imagesToPdf, imagesToPdfs } from "./image-to-pdf";
import { imagesToPdfUnderLimit } from "./image-size-fit";
import { encodeGrayJpeg } from "./gray-jpeg";
import { swapsAxes } from "./jpeg-orientation";
import {
  MAX_TIFF_PAGES,
  MAX_TIFF_PAGE_PIXELS,
  decodeTiffPage,
  lzwDecode,
  readTiffPages,
  resolution,
  tiffRefusal,
} from "./tiff";

const FIT_NO_MARGIN = {
  pageSize: "fit",
  orientation: "auto",
  margin: "none",
} as const;

const file = (name: string, bytes: Uint8Array) => ({
  name,
  type: "image/tiff",
  bytes,
});

/** Each page's image XObject dictionary, page by page. */
async function pageImages(pdf: Uint8Array) {
  const doc = await PDFDocument.load(pdf);
  return doc.getPages().map((page) => {
    const xobjects = page.node
      .Resources()!
      .lookup(PDFName.of("XObject"), PDFDict);
    const [, ref] = [...xobjects.entries()][0]!;
    const stream = doc.context.lookup(ref as PDFRef) as PDFRawStream;
    const get = (key: string) => stream.dict.get(PDFName.of(key));
    const decode = get("Decode");
    return {
      width: (get("Width") as PDFNumber).asNumber(),
      height: (get("Height") as PDFNumber).asNumber(),
      bits: (get("BitsPerComponent") as PDFNumber).asNumber(),
      filter: get("Filter")?.toString(),
      colorSpace:
        get("ColorSpace") instanceof PDFArray
          ? (get("ColorSpace") as PDFArray).get(0).toString()
          : get("ColorSpace")?.toString(),
      decode:
        decode instanceof PDFArray
          ? decode.asArray().map((n) => (n as PDFNumber).asNumber())
          : null,
      smask: get("SMask") !== undefined,
    };
  });
}

/** Dark and red pixels of a rendered page. */
function inkAndRed(page: RenderedPage) {
  let dark = 0;
  let red = 0;
  for (let i = 0; i < page.data.length; i += 4) {
    const r = page.data[i]!;
    const g = page.data[i + 1]!;
    const b = page.data[i + 2]!;
    if (r < 96 && g < 96 && b < 96) dark++;
    if (r > 160 && g < 96 && b < 96) red++;
  }
  return { dark, red, total: page.data.length / 4 };
}

describe("the committed Ghostscript fixtures", () => {
  it.each(["g4.tif", "lzw.tif"] as const)(
    "%s: two pages, 400 × 300 at 100 dpi (288 × 216 pt)",
    (name) => {
      const pages = readTiffPages(name, tiffFixture(name));
      expect(pages.length).toBe(GS_FIXTURE.pages);
      for (const page of pages) {
        expect([page.width, page.height]).toEqual([
          GS_FIXTURE.width,
          GS_FIXTURE.height,
        ]);
        expect(page.dpi).toEqual({ x: GS_FIXTURE.dpi, y: GS_FIXTURE.dpi });
        expect([page.widthPt, page.heightPt]).toEqual([
          GS_FIXTURE.widthPt,
          GS_FIXTURE.heightPt,
        ]);
      }
      expect(pages.map((p) => p.number)).toEqual([1, 2]);
    },
  );

  it("g4.tif decodes to 1-bit WhiteIsZero pages with text on both", async () => {
    const bytes = tiffFixture("g4.tif");
    const pages = readTiffPages("g4.tif", bytes);
    expect(pages.map((p) => p.compression)).toEqual([4, 4]);
    for (const page of pages) {
      const raster = await decodeTiffPage("g4.tif", bytes, page);
      expect(raster.bitsPerComponent).toBe(1);
      expect(raster.colorSpace).toBe("gray");
      expect(raster.invert).toBe(true);
      // Ink is a set bit: text, not a blank (all 0) or solid (all 1) page.
      let set = 0;
      for (const byte of raster.samples)
        for (let b = 0; b < 8; b++) set += (byte >> b) & 1;
      const fraction = set / (raster.width * raster.height);
      expect(fraction).toBeGreaterThan(0.01);
      expect(fraction).toBeLessThan(0.5);
    }
  });

  it("lzw.tif decodes to RGB; red only on page 2", async () => {
    const bytes = tiffFixture("lzw.tif");
    const pages = readTiffPages("lzw.tif", bytes);
    expect(pages.map((p) => p.compression)).toEqual([5, 5]);
    const reds: number[] = [];
    for (const page of pages) {
      const raster = await decodeTiffPage("lzw.tif", bytes, page);
      expect([raster.colorSpace, raster.bitsPerComponent]).toEqual(["rgb", 8]);
      let red = 0;
      let dark = 0;
      const s = raster.samples;
      for (let i = 0; i < s.length; i += 3) {
        if (s[i]! > 160 && s[i + 1]! < 96 && s[i + 2]! < 96) red++;
        if (s[i]! < 96 && s[i + 1]! < 96 && s[i + 2]! < 96) dark++;
      }
      expect(dark, `page ${page.number} has its black text`).toBeGreaterThan(
        500,
      );
      reds.push(red);
    }
    expect(reds[0]).toBe(0);
    expect(reds[1]).toBeGreaterThan(500);
  });
});

describe("into the PDF", () => {
  it("two 2-page TIFFs make 4 pages, in order, each 288 × 216 pt under Fit to image", async () => {
    const pdf = await imagesToPdf(
      "jpg",
      [
        file("g4.tif", tiffFixture("g4.tif")),
        file("lzw.tif", tiffFixture("lzw.tif")),
      ],
      FIT_NO_MARGIN,
    );
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPages().map((p) => p.getSize())).toEqual(
      Array(4).fill({ width: 288, height: 216 }),
    );
    const images = await pageImages(pdf);
    // G4 pages first (1-bit gray, WhiteIsZero), then the LZW pages (RGB).
    expect(
      images.map((i) => [i.colorSpace, i.bits, i.filter, i.decode]),
    ).toEqual([
      ["/DeviceGray", 1, "/FlateDecode", [1, 0]],
      ["/DeviceGray", 1, "/FlateDecode", [1, 0]],
      ["/DeviceRGB", 8, "/FlateDecode", null],
      ["/DeviceRGB", 8, "/FlateDecode", null],
    ]);
    const rendered = (await renderPdfPages(pdf, 400)).map(inkAndRed);
    // Text on every page; red only on the LZW file's page 2 — the G4 file's
    // page 2 says "RED" too, in black (the control).
    for (const [i, page] of rendered.entries())
      expect(page.dark, `page ${i + 1} is drawn`).toBeGreaterThan(200);
    expect(rendered.map((p) => p.red > 200)).toEqual([
      false,
      false,
      false,
      true,
    ]);
    // Polarity: a fax page is mostly white paper, never mostly black.
    expect(rendered[0]!.dark / rendered[0]!.total).toBeLessThan(0.3);
  });

  it("One PDF per image: a 2-page TIFF is ONE 2-page PDF", async () => {
    const outs = await imagesToPdfs(
      "png",
      [
        file("g4.tif", tiffFixture("g4.tif")),
        file("lzw.tif", tiffFixture("lzw.tif")),
      ],
      FIT_NO_MARGIN,
    );
    expect(outs.map((o) => o.name)).toEqual(["g4.pdf", "lzw.pdf"]);
    for (const out of outs)
      expect((await PDFDocument.load(out.bytes)).getPageCount()).toBe(2);
  });

  it("imagePageCount reads the header: 2 for each fixture, 1 for anything else", async () => {
    expect(await imagePageCount(file("g4.tif", tiffFixture("g4.tif")))).toBe(2);
    expect(
      await imagePageCount({
        name: "a.png",
        type: "image/png",
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      }),
    ).toBe(1);
  });
});

describe("page size follows the resolution", () => {
  // A blank 300-dpi A4 page: 2480 × 3508 pixels, 1-bit, PackBits.
  const a4 = (dpi?: TiffPageSpec["dpi"]) =>
    tiffOf([
      {
        width: 2480,
        height: 3508,
        bits: [1],
        photometric: 0,
        compression: 32773,
        rows: new Uint8Array(310 * 3508),
        rowsPerStrip: 64,
        dpi,
      },
    ]);

  it("a 300-dpi A4 scan is an A4 page under Fit to image", async () => {
    const pdf = await imagesToPdf(
      "png",
      [file("a4.tif", a4({ x: 300, y: 300 }))],
      FIT_NO_MARGIN,
    );
    const { width, height } = (await PDFDocument.load(pdf))
      .getPage(0)
      .getSize();
    expect(width).toBeCloseTo((210 * 72) / 25.4, 0);
    expect(height).toBeCloseTo((297 * 72) / 25.4, 0);
  });

  it("the same scan in centimetres is the same page", async () => {
    const pdf = await imagesToPdf(
      "png",
      [file("a4.tif", a4({ x: 300 / 2.54, y: 300 / 2.54, unit: 3 }))],
      FIT_NO_MARGIN,
    );
    const { width } = (await PDFDocument.load(pdf)).getPage(0).getSize();
    expect(width).toBeCloseTo(595.3, 0);
  });

  it("positive control: with no resolution it is one pixel per point, as JPEG and PNG are", async () => {
    const pdf = await imagesToPdf("png", [file("a4.tif", a4())], FIT_NO_MARGIN);
    const { width } = (await PDFDocument.load(pdf)).getPage(0).getSize();
    expect(width).toBe(2480);
  });

  it("fax resolution (204 × 196 dpi) keeps the page's proportions", () => {
    expect(resolution(204, 196, 2)).toEqual({ x: 204, y: 196 });
    expect(resolution(1, 1, 2)).toBeNull(); // "I do not know", not 1 dpi
    expect(resolution(300, 300, 1)).toBeNull(); // no absolute unit
    expect(resolution(300, undefined, 2)).toEqual({ x: 300, y: 300 });
  });
});

describe("every compression and colour model, by round trip", () => {
  const W = 37; // odd, so rows end mid-byte at 1, 2 and 4 bits
  const H = 23;
  const gray8 = new Uint8Array(W * H).map((_, i) => (i * 7) & 255);
  const rgb = rgbRows(W, H, [250, 250, 250], [200, 20, 30]);
  const rgba = rgbRows(W, H, [10, 120, 250], [250, 10, 10], 4, 128);
  const bilevel = blockRows(W, H, 1, { inkIsOne: false });
  const pal4 = new Uint8Array(Math.ceil(W / 2) * H).map((_, i) => i & 255);
  const colorMap = Array.from({ length: 48 }, (_, i) => (i * 4099) & 0xffff);

  const cases: [string, TiffPageSpec, { bigEndian?: boolean }?][] = [
    [
      "uncompressed bilevel",
      { width: W, height: H, bits: [1], photometric: 1, rows: bilevel },
    ],
    [
      "PackBits gray",
      {
        width: W,
        height: H,
        bits: [8],
        photometric: 1,
        compression: 32773,
        rows: gray8,
        rowsPerStrip: 5,
      },
    ],
    [
      "Deflate RGB with predictor 2",
      {
        width: W,
        height: H,
        bits: [8, 8, 8],
        photometric: 2,
        compression: 8,
        rows: rgb,
        predictor: 2,
        rowsPerStrip: 7,
      },
    ],
    [
      "PackBits 4-bit palette",
      {
        width: W,
        height: H,
        bits: [4],
        photometric: 3,
        compression: 32773,
        rows: pal4,
        extra: [[320, 3, colorMap]],
      },
    ],
    [
      "Deflate RGBA (unassociated alpha)",
      {
        width: W,
        height: H,
        bits: [8, 8, 8, 8],
        photometric: 2,
        compression: 8,
        rows: rgba,
        extra: [[338, 3, [2]]],
      },
    ],
    [
      "tiled PackBits gray",
      {
        width: W,
        height: H,
        bits: [8],
        photometric: 1,
        compression: 32773,
        rows: gray8,
        tile: { width: 16, height: 16 },
      },
    ],
    [
      "big-endian uncompressed gray",
      { width: W, height: H, bits: [8], photometric: 0, rows: gray8 },
      { bigEndian: true },
    ],
  ];

  it.each(cases)("%s", async (_label, spec, order) => {
    const bytes = tiffOf([spec], order);
    const [page] = readTiffPages("t.tif", bytes);
    const raster = await decodeTiffPage("t.tif", bytes, page!);
    const colours = spec.photometric === 2 ? 3 : 1;
    if (spec.bits.length > colours) {
      // Colour and alpha come apart: the alpha is its own plane.
      const spp = spec.bits.length;
      const colour = new Uint8Array(W * H * colours);
      const alpha = new Uint8Array(W * H);
      for (let p = 0; p < W * H; p++) {
        for (let c = 0; c < colours; c++)
          colour[p * colours + c] = spec.rows[p * spp + c]!;
        alpha[p] = spec.rows[p * spp + colours]!;
      }
      expect(raster.samples).toEqual(colour);
      expect(raster.alpha).toEqual(alpha);
    } else {
      expect(raster.samples).toEqual(spec.rows);
      expect(raster.alpha).toBeNull();
    }
    expect(raster.invert).toBe(spec.photometric === 0);
    if (spec.photometric === 3)
      // Entry i is (R[i], G[i], B[i]); the map holds all R, then G, then B.
      expect(Array.from(raster.palette!.subarray(0, 6))).toEqual(
        [0, 16, 32, 1, 17, 33].map((at) => colorMap[at]! >> 8),
      );
  });

  it("16-bit gray keeps the high byte of each sample, in either byte order", async () => {
    const rows16 = new Uint8Array(W * H * 2);
    for (let i = 0; i < W * H; i++) {
      rows16[i * 2] = 0x12; // little-endian: low byte first
      rows16[i * 2 + 1] = (i * 3) & 255;
    }
    const bytes = tiffOf([
      { width: W, height: H, bits: [16], photometric: 1, rows: rows16 },
    ]);
    const [page] = readTiffPages("t.tif", bytes);
    const raster = await decodeTiffPage("t.tif", bytes, page!);
    expect(raster.bitsPerComponent).toBe(8);
    expect(Array.from(raster.samples.subarray(0, 4))).toEqual([0, 3, 6, 9]);
  });

  it("the saved PDF renders each model as it was written (palette and polarity included)", async () => {
    const pdf = await imagesToPdf(
      "png",
      cases.map(([label, spec, order]) =>
        file(`${label}.tif`, tiffOf([spec], order)),
      ),
      FIT_NO_MARGIN,
    );
    const images = await pageImages(pdf);
    expect(images.map((i) => [i.colorSpace, i.bits])).toEqual([
      ["/DeviceGray", 1],
      ["/DeviceGray", 8],
      ["/DeviceRGB", 8],
      ["/Indexed", 4],
      ["/DeviceRGB", 8],
      ["/DeviceGray", 8],
      ["/DeviceGray", 8],
    ]);
    expect(images.map((i) => i.smask)).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
      false,
    ]);
    const [bi, , rgbPage] = await renderPdfPages(pdf, 74);
    // BlackIsZero bilevel with ink as 0: the top-left block is black.
    const at = (p: RenderedPage, fx: number, fy: number) => {
      const i =
        (Math.floor(fy * p.height) * p.width + Math.floor(fx * p.width)) * 4;
      return [p.data[i]!, p.data[i + 1]!, p.data[i + 2]!];
    };
    expect(at(bi!, 0.2, 0.2).every((v) => v < 64)).toBe(true);
    expect(at(bi!, 0.8, 0.8).every((v) => v > 192)).toBe(true);
    const red = at(rgbPage!, 0.2, 0.2);
    expect(red[0]! > 160 && red[1]! < 96 && red[2]! < 96).toBe(true);
  });
});

describe("safety before decoding", () => {
  it("a 1 KB header claiming 60,000 × 60,000 is refused by size, before anything is allocated", async () => {
    const bytes = tiffOf([
      {
        width: 60_000,
        height: 60_000,
        bits: [1],
        photometric: 0,
        compression: 4,
        rows: new Uint8Array(16),
      },
    ]);
    expect(bytes.length).toBeLessThan(1024);
    const message = tiffRefusal.tooLarge("huge.tif", 1, 60_000, 60_000);
    expect(message).toContain(`${MAX_TIFF_PAGE_PIXELS / 1_000_000} megapixels`);
    expect(() => readTiffPages("huge.tif", bytes)).toThrow(message);
    // The decoded page would be 450 MB of 1-bit samples; the refusal costs
    // nothing near that. Measured around the whole engine run.
    const before = process.memoryUsage().arrayBuffers;
    await expect(
      imagesToPdf("png", [file("huge.tif", bytes)], FIT_NO_MARGIN),
    ).rejects.toThrow(message);
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(
      64 * 1024 * 1024,
    );
  });

  it(`refuses a TIFF of more than ${MAX_TIFF_PAGES} pages; takes exactly ${MAX_TIFF_PAGES}`, () => {
    const tiny: TiffPageSpec = {
      width: 1,
      height: 1,
      bits: [8],
      photometric: 1,
      rows: new Uint8Array([7]),
    };
    expect(
      readTiffPages("ok.tif", tiffOf(Array(MAX_TIFF_PAGES).fill(tiny))).length,
    ).toBe(MAX_TIFF_PAGES);
    expect(() =>
      readTiffPages("many.tif", tiffOf(Array(MAX_TIFF_PAGES + 1).fill(tiny))),
    ).toThrow(tiffRefusal.tooManyPages("many.tif"));
  });

  it("an unsupported compression is refused by page, by name", () => {
    const ok: TiffPageSpec = {
      width: 4,
      height: 4,
      bits: [8],
      photometric: 1,
      rows: new Uint8Array(16),
    };
    const bytes = tiffOf([ok, { ...ok, compression: 34712 }]);
    expect(() => readTiffPages("j2k.tif", bytes)).toThrow(
      '"j2k.tif" page 2 uses JPEG 2000 compression, which this tool cannot read.',
    );
  });

  it("a strip outside the file is a damaged page, by number", () => {
    const ok: TiffPageSpec = {
      width: 4,
      height: 4,
      bits: [8],
      photometric: 1,
      rows: new Uint8Array(16),
    };
    const bytes = tiffOf([ok, ok]);
    // Page 2's strip offset (tag 273) pointed past the end.
    const pages = readTiffPages("x.tif", bytes);
    const at = findEntry(bytes, 273, 1);
    new DataView(bytes.buffer).setUint32(at + 8, bytes.length + 10, true);
    expect(pages.length).toBe(2);
    expect(() => readTiffPages("x.tif", bytes)).toThrow(
      tiffRefusal.damaged("x.tif", 2),
    );
  });
});

/** The byte offset of the `nth` (0-based) IFD's entry for `tag` (little-endian TIFF). */
function findEntry(bytes: Uint8Array, tag: number, nth: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  let ifd = view.getUint32(4, true);
  for (let i = 0; i < nth; i++) {
    const n = view.getUint16(ifd, true);
    ifd = view.getUint32(ifd + 2 + n * 12, true);
  }
  const n = view.getUint16(ifd, true);
  for (let i = 0; i < n; i++) {
    const at = ifd + 2 + i * 12;
    if (view.getUint16(at, true) === tag) return at;
  }
  throw new Error(`no tag ${tag} in IFD ${nth}`);
}

/** The strip of page `nth` of a little-endian TIFF: [offset, length]. */
function stripOf(bytes: Uint8Array, nth: number): [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const off = findEntry(bytes, 273, nth);
  const len = findEntry(bytes, 279, nth);
  return [view.getUint32(off + 8, true), view.getUint32(len + 8, true)];
}

describe("a damaged page is refused by its number, never drawn blank", () => {
  it("G4: page 2's strip overwritten with noise", async () => {
    const bytes = tiffFixture("g4.tif");
    const [off, len] = stripOf(bytes, 1);
    for (let i = 0; i < len; i++) bytes[off + i] = (i * 151 + 7) & 255;
    const pages = readTiffPages("g4.tif", bytes);
    await expect(
      decodeTiffPage("g4.tif", bytes, pages[0]!),
    ).resolves.toBeTruthy();
    await expect(decodeTiffPage("g4.tif", bytes, pages[1]!)).rejects.toThrow(
      tiffRefusal.damaged("g4.tif", 2),
    );
    await expect(imagesToPdf("png", [file("g4.tif", bytes)])).rejects.toThrow(
      tiffRefusal.damaged("g4.tif", 2),
    );
  });

  it("G4: a strip of zero bits — no code ever matches — ends in a refusal, not a hang", async () => {
    const bytes = tiffFixture("g4.tif");
    const [off, len] = stripOf(bytes, 0);
    bytes.fill(0, off, off + len);
    const pages = readTiffPages("g4.tif", bytes);
    const started = Date.now();
    await expect(decodeTiffPage("g4.tif", bytes, pages[0]!)).rejects.toThrow(
      tiffRefusal.damaged("g4.tif", 1),
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("LZW: page 2's strip cut short", async () => {
    const bytes = tiffFixture("lzw.tif");
    const pages = readTiffPages("lzw.tif", bytes);
    // The last strip of page 2 claims 4 bytes where it has more to say.
    const page = pages[1]!;
    const last = page.chunks.at(-1)!;
    const cut = {
      ...page,
      chunks: [...page.chunks.slice(0, -1), { offset: last.offset, length: 4 }],
    };
    await expect(decodeTiffPage("lzw.tif", bytes, cut)).rejects.toThrow(
      tiffRefusal.damaged("lzw.tif", 2),
    );
  });

  it("PackBits and Deflate: a strip that yields fewer bytes than its rows need", async () => {
    for (const compression of [32773, 8] as const) {
      const rows = new Uint8Array(64 * 8).map((_, i) => i & 255);
      const bytes = tiffOf([
        { width: 64, height: 8, bits: [8], photometric: 1, compression, rows },
      ]);
      const [page] = readTiffPages("t.tif", bytes);
      const short = {
        ...page!,
        chunks: [
          {
            ...page!.chunks[0]!,
            length: Math.floor(page!.chunks[0]!.length / 2),
          },
        ],
      };
      await expect(
        decodeTiffPage("t.tif", bytes, short),
        `compression ${compression}`,
      ).rejects.toThrow(tiffRefusal.damaged("t.tif", 1));
    }
  });

  it("health check: the LZW decoder reproduces the Ghostscript strip byte for byte in size", () => {
    const bytes = tiffFixture("lzw.tif");
    const [page] = readTiffPages("lzw.tif", bytes);
    const want = page!.rowsPerStrip * 400 * 3;
    const out = new Uint8Array(want);
    const first = page!.chunks[0]!;
    expect(lzwDecode(bytes, first.offset, first.length, out)).toBe(want);
  });
});

describe("under a Max file size", () => {
  // The ladder's rung 1, with the browser re-encoder stood in for: it hands
  // back a real JPEG, tiny or huge, so the keep-or-swap choice is the
  // engine's. `huge` is chosen per FILE: rung 1 must come out smaller than
  // rung 0 (the lossless PDF) or the ladder hands back rung 0, and a check
  // of rung 1's choices would be reading rung 0.
  const ladder = [{ quality: 0.5, scale: 1 }];
  const fakeJpeg = (huge: string) => async (name: string) => {
    const side = name === huge ? 600 : 8;
    const noise = new Uint8Array(side * side).map((_, i) => (i * 97) & 255);
    return {
      bytes: encodeGrayJpeg(noise, side, side, 0.95),
      layoutWidth: 0,
      layoutHeight: 0,
      width: side,
      height: side,
      flattened: false,
    };
  };
  const files = () => [
    file("g4.tif", tiffFixture("g4.tif")),
    file("lzw.tif", tiffFixture("lzw.tif")),
  ];
  const fast = { now: () => 0, pause: async () => {}, ladder };

  it("a fax page stays 1-bit and lossless where its JPEG would be bigger", async () => {
    const fit = await imagesToPdfUnderLimit(
      "png",
      files(),
      FIT_NO_MARGIN,
      100,
      "x.pdf",
      {
        ...fast,
        reencodePixels: fakeJpeg("g4.tif"),
      },
    );
    // Rung 1 was chosen (it is smaller than the lossless rung 0)...
    expect(fit.report.chosenRung).toBe(1);
    const images = await pageImages(fit.bytes);
    // ...and in it the fax pages stayed lossless while the colour pages,
    // whose JPEG was smaller, took it.
    expect(images.map((i) => [i.filter, i.bits])).toEqual([
      ["/FlateDecode", 1],
      ["/FlateDecode", 1],
      ["/DCTDecode", 8],
      ["/DCTDecode", 8],
    ]);
    expect(fit.reencoded).toBe(true);
  });

  it("positive control: where the JPEG is smaller, the page takes it — at its size on paper", async () => {
    const fit = await imagesToPdfUnderLimit(
      "png",
      files(),
      FIT_NO_MARGIN,
      100,
      "x.pdf",
      {
        ...fast,
        reencodePixels: fakeJpeg("none"),
      },
    );
    expect(fit.report.chosenRung).toBe(1);
    const images = await pageImages(fit.bytes);
    expect(images.map((i) => i.filter)).toEqual(Array(4).fill("/DCTDecode"));
    expect(fit.reencoded).toBe(true);
    const doc = await PDFDocument.load(fit.bytes);
    expect(doc.getPages().map((p) => p.getSize())).toEqual(
      Array(4).fill({ width: 288, height: 216 }),
    );
  });
});

/**
 * ORIENTATION (tag 274) is applied, as a JPEG's EXIF turn is. Until
 * 2026-11-05 every TIFF page was laid down as stored: a scanner that writes
 * a sideways page plus Orientation 6 produced a sideways PDF page.
 *
 * The oracle is the TIFF / EXIF definition of the eight values (which corner
 * the stored first row and first column belong to), written out here, not
 * read from `jpeg-orientation.ts`: a 40 × 20 page whose stored top-left
 * quarter is red and top-right quarter blue, and the corner each must be
 * seen in. One marker is not enough: Orientation 5 (a transpose) keeps the
 * top-left where it was, so a page merely stretched into the turned shape
 * passed on red alone (a mutation that recorded no turn left 5 green). The
 * blue quarter is what tells them apart.
 */
describe("Orientation (tag 274) is applied", () => {
  const W = 40;
  const H = 20;
  const red = rgbRows(W, H, [250, 250, 250], [220, 20, 20]);
  for (let y = 0; y < H / 2; y++)
    for (let x = W / 2; x < W; x++) red.set([20, 40, 220], (y * W + x) * 3);
  type Corner = "TL" | "TR" | "BR" | "BL";
  const SEEN: Record<number, { red: Corner; blue: Corner; turned: boolean }> = {
    1: { red: "TL", blue: "TR", turned: false },
    2: { red: "TR", blue: "TL", turned: false }, // mirrored left-right
    3: { red: "BR", blue: "BL", turned: false }, // turned 180°
    4: { red: "BL", blue: "BR", turned: false }, // mirrored top-bottom
    5: { red: "TL", blue: "BL", turned: true }, // transposed
    6: { red: "TR", blue: "BR", turned: true }, // turned 90° clockwise
    7: { red: "BR", blue: "TR", turned: true }, // transversed
    8: { red: "BL", blue: "TL", turned: true }, // turned 90° counter-clockwise
  };
  const oriented = (o: number | null) =>
    tiffOf([
      {
        width: W,
        height: H,
        bits: [8, 8, 8],
        photometric: 2,
        rows: red,
        ...(o === null ? {} : { extra: [[274, 3, [o]] as TiffEntry] }),
      },
    ]);

  /** Where one colour's pixels sit on a rendered page, by their centroid. */
  function cornerOf(page: RenderedPage, colour: "red" | "blue"): string {
    let n = 0;
    let sx = 0;
    let sy = 0;
    for (let y = 0; y < page.height; y++)
      for (let x = 0; x < page.width; x++) {
        const i = (y * page.width + x) * 4;
        const r = page.data[i]!;
        const g = page.data[i + 1]!;
        const b = page.data[i + 2]!;
        const hit =
          colour === "red" ? r > 160 && g < 96 && b < 96 : b > 160 && r < 96;
        if (hit) {
          n++;
          sx += x;
          sy += y;
        }
      }
    if (n === 0) return "none";
    return (
      (sy / n < page.height / 2 ? "T" : "B") +
      (sx / n < page.width / 2 ? "L" : "R")
    );
  }

  it.each(Object.entries(SEEN))(
    "Orientation %s: the stored top-left is seen at its corner, and the page turns with it",
    async (o, want) => {
      const pdf = await imagesToPdf(
        "png",
        [file("o.tif", oriented(Number(o)))],
        FIT_NO_MARGIN,
      );
      const doc = await PDFDocument.load(pdf);
      expect(doc.getPages()[0]!.getSize()).toEqual(
        want.turned ? { width: H, height: W } : { width: W, height: H },
      );
      const [page] = await renderPdfPages(pdf);
      expect([cornerOf(page!, "red"), cornerOf(page!, "blue")]).toEqual([
        want.red,
        want.blue,
      ]);
      // Lossless still: the image XObject is the stored raster, untouched.
      const [image] = await pageImages(pdf);
      expect([image!.width, image!.height, image!.filter]).toEqual([
        W,
        H,
        "/FlateDecode",
      ]);
    },
  );

  it("the engine's 'values 5-8 turn the page' rule is swapsAxes, for all eight", () => {
    // image-to-pdf.ts states the rule inline (importing jpeg-orientation there
    // costs every page bytes); held here to the one definition.
    for (const o of [1, 2, 3, 4, 5, 6, 7, 8] as const)
      expect(o >= 5, `Orientation ${o}`).toBe(swapsAxes(o));
  });

  it("an absent or out-of-range Orientation is 1, and the reader reports it", () => {
    expect(readTiffPages("a.tif", oriented(null))[0]!.orientation).toBe(1);
    expect(readTiffPages("a.tif", oriented(9))[0]!.orientation).toBe(1);
    expect(readTiffPages("a.tif", oriented(0))[0]!.orientation).toBe(1);
    expect(readTiffPages("a.tif", oriented(6))[0]!.orientation).toBe(6);
  });

  it("under a Max file size, a page that takes the JPEG rung turns too", async () => {
    // The re-encoder stood in for (as above): an 8 × 8 JPEG, much smaller
    // than the lossless page, so the page takes it; the page's shape is the
    // engine's layout, which must be turned.
    const tiny = encodeGrayJpeg(new Uint8Array(64).fill(128), 8, 8, 0.9);
    // Noise, so the lossless page is bigger than that JPEG and takes it.
    const noise = new Uint8Array(W * H * 3).map(
      (_, i) => (i * 2654435761) >>> 24,
    );
    const noisy = tiffOf([
      {
        width: W,
        height: H,
        bits: [8, 8, 8],
        photometric: 2,
        rows: noise,
        extra: [[274, 3, [6]]],
      },
    ]);
    const fit = await imagesToPdfUnderLimit(
      "png",
      [file("o.tif", noisy)],
      FIT_NO_MARGIN,
      1,
      "x.pdf",
      {
        now: () => 0,
        pause: async () => {},
        ladder: [{ quality: 0.5, scale: 1 }],
        reencodePixels: async () => ({
          bytes: tiny,
          layoutWidth: 0,
          layoutHeight: 0,
          width: 8,
          height: 8,
          flattened: false,
        }),
      },
    );
    expect(fit.report.chosenRung).toBe(1);
    const [image] = await pageImages(fit.bytes);
    expect(image!.filter).toBe("/DCTDecode");
    const doc = await PDFDocument.load(fit.bytes);
    expect(doc.getPages()[0]!.getSize()).toEqual({ width: H, height: W });
  });
});
