/**
 * HOSTILE MATRIX — family "conversion-in" (audit, 2026-11-08).
 *
 * Every entry point that turns a stranger's image or text into a PDF, run
 * against every hostile class that applies to it. Each cell records ONE
 * outcome (see {@link cell}):
 *
 *   refused   a PdfEngineError — user-facing copy; the cell quotes it
 *   output    a PDF — the cell checks it loads and is not silently wrong
 *   internal  any other throw — its raw message would reach the user
 *   timeout   still running past the cell's bound
 *
 * A cell whose outcome is acceptable is an assertion that PASSES. A cell that
 * shows a defect is `finding("CI-NN …")` — `it.fails`: it asserts the
 * behaviour the product SHOULD have, so it is red today and the file is green
 * — and the day the defect is fixed the cell turns red and must be inverted
 * (not deleted), per CLAUDE.md. Cells that cannot run in Node (the browser's
 * own decoder) are `it.skip` with the reason, never silently absent.
 *
 * A finding cell that fails for the WRONG reason (a TypeError in the probe,
 * a fixture that never landed) is indistinguishable from outside. Run with
 * HOSTILE_SHOW_FINDINGS=1 and every finding cell becomes a plain `it`, so its
 * actual assertion failure is printed — read each one before trusting it.
 *
 * The PDF-input classes of the survey (H05–H24) are about PDF structure; for
 * this family they are applied to the formats these tools READ: an IFD chain
 * loop is the TIFF's xref loop (H06), a pHYs / XResolution of 2^32-1 is the
 * enormous MediaBox (H10), an IHDR claiming 100,000² is the huge image
 * XObject (H11), an all-zero IDAT is the Flate bomb (H12), a second IHDR is
 * the duplicate object (H19), 500 TIFF pages and a form-feed flood are the
 * 2,000-page document (H21), and a list or quote nested a thousand deep is
 * the deep page tree (H08).
 *
 * Time bounds: every cell runs under {@link cell}'s own bound (a promise race,
 * so an async hang is recorded as `timeout`, not a frozen run) AND the test's
 * timeout. None of these engines takes an AbortSignal. A SYNCHRONOUS hang
 * cannot be interrupted by either, so the unbounded-work cells (CI-11, the paragraph flood)
 * measure a small input and EXTRAPOLATE to the published input cap instead of
 * running the cap. Known-slow cells say SLOW in their names.
 */
import { PDFDocument } from "pdf-lib";
import { deflateSync, inflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PdfEngineError } from "@/lib/pdf/engine-errors";
import {
  buildImagePdf,
  imagePageCount,
  imagesToPdf,
  imagesToPdfs,
  sniffImageFormat,
  sniffRasterFormat,
  unsupportedImageMessage,
  validateImagePdfInputs,
  type ImagePdfInput,
} from "@/lib/pdf/image-to-pdf";
import type { ImagePageOptions } from "@/lib/pdf/image-page-layout";
import { MAX_DECODED_PIXELS } from "@/lib/pdf/pixel-ceiling";
import { readTiffPages, MAX_TIFF_PAGES } from "@/lib/pdf/tiff";
import { textToPdf } from "@/lib/pdf/text-to-pdf";
import { markdownToPdf, parseMarkdownBlocks } from "@/lib/pdf/markdown-to-pdf";
import { scansToPdf } from "@/lib/pdf/scan-to-pdf";
import { MAX_SOURCE_BYTES } from "@/lib/tools/limits";
import { boxOf, drawnImages } from "@/tests/drawn-images";
import { useNodeFontSource } from "@/tests/unicode-fonts";
import * as F from "./conversion-in.fixtures";

/* ------------------------------------------------------------------ *
 *  The outcome recorder
 * ------------------------------------------------------------------ */

/** A recorded defect: expected to fail; a plain test under HOSTILE_SHOW_FINDINGS. */
const finding = process.env.HOSTILE_SHOW_FINDINGS ? it : it.fails;

type Outcome =
  | { kind: "output"; value: unknown; ms: number }
  | { kind: "refused"; message: string; ms: number }
  | { kind: "internal"; name: string; message: string; ms: number }
  | { kind: "timeout"; ms: number };

const TIMEOUT = Symbol("timeout");

/** Run `fn` under `bound` ms and classify what happened. */
async function cell(fn: () => unknown, bound = 10_000): Promise<Outcome> {
  const t0 = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      Promise.resolve().then(fn),
      new Promise<typeof TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMEOUT), bound);
      }),
    ]);
    const ms = performance.now() - t0;
    if (value === TIMEOUT) return { kind: "timeout", ms };
    return { kind: "output", value, ms };
  } catch (e) {
    const ms = performance.now() - t0;
    if (e instanceof PdfEngineError)
      return { kind: "refused", message: e.message, ms };
    const err = e as Error;
    return {
      kind: "internal",
      name: err?.name ?? typeof e,
      message: String(err?.message ?? e),
      ms,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** One line for an assertion message: the kind, and what it carried. */
function describeOutcome(o: Outcome): string {
  const ms = `${o.ms.toFixed(0)} ms`;
  switch (o.kind) {
    case "refused":
      return `refused (${ms}): ${o.message}`;
    case "internal":
      return `INTERNAL ${o.name} (${ms}): ${o.message}`;
    case "timeout":
      return `TIMEOUT after ${ms}`;
    case "output":
      return o.value instanceof Uint8Array
        ? `output (${ms}): ${o.value.length} B`
        : `output (${ms}): ${typeof o.value}`;
  }
}

/** The outcome must be a refusal whose copy matches `copy`. */
function expectRefused(o: Outcome, copy: RegExp): void {
  expect(o.kind, describeOutcome(o)).toBe("refused");
  expect((o as { message: string }).message).toMatch(copy);
}

/** The outcome must be a PDF that loads; returns it. */
async function expectPdf(
  o: Outcome,
): Promise<{ bytes: Uint8Array; doc: PDFDocument }> {
  expect(o.kind, describeOutcome(o)).toBe("output");
  const bytes = (o as { value: Uint8Array }).value;
  expect(bytes).toBeInstanceOf(Uint8Array);
  const doc = await PDFDocument.load(bytes);
  return { bytes, doc };
}

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

/** PDF's smallest page side (ISO 32000-1 Annex C). */
const MIN_PAGE_SIDE_PT = 3;
const MAX_PAGE_SIDE_PT = 14_400;

/**
 * The largest `new Uint8Array(n)` made while `fn` runs. The engines resolve
 * the global at call time, so a Proxy over the constructor sees every
 * numeric-length allocation (Buffer and other subclasses bound earlier are
 * not counted — this is a LOWER bound).
 */
async function largestAllocation(fn: () => Promise<unknown>): Promise<number> {
  const Original = globalThis.Uint8Array;
  let largest = 0;
  globalThis.Uint8Array = new Proxy(Original, {
    construct(target, args) {
      if (typeof args[0] === "number") largest = Math.max(largest, args[0]);
      return Reflect.construct(target, args);
    },
  });
  try {
    await fn().catch(() => undefined);
  } finally {
    globalThis.Uint8Array = Original;
  }
  return largest;
}

/** Every stream of a PDF inflated (when Flate), plus the raw file, as text. */
function pdfText(pdf: Uint8Array): string {
  const raw = Buffer.from(pdf).toString("latin1");
  let out = raw;
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    try {
      out += inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1");
    } catch {
      /* not Flate */
    }
  }
  return out;
}

let restoreFonts: () => void;
beforeAll(() => {
  restoreFonts = useNodeFontSource();
});
afterAll(() => restoreFonts());

/* ------------------------------------------------------------------ *
 *  Health checks: the recorder, the probes, the fixtures
 * ------------------------------------------------------------------ */

describe("health: the recorder classifies each outcome (positive controls)", () => {
  it("a PdfEngineError is refused, a TypeError internal, a hang a timeout, a value output", async () => {
    expect(
      (
        await cell(() => {
          throw new PdfEngineError("nope");
        })
      ).kind,
    ).toBe("refused");
    expect(
      (
        await cell(() => {
          throw new TypeError("raw");
        })
      ).kind,
    ).toBe("internal");
    expect((await cell(() => new Promise(() => undefined), 50)).kind).toBe(
      "timeout",
    );
    expect((await cell(() => 1)).kind).toBe("output");
  });

  it("largestAllocation sees an engine allocation (a 4 × 3 PNG inflates 15 bytes)", async () => {
    const n = await largestAllocation(() =>
      imagesToPdf("png", [img("a.png", F.validGreyPng(4, 3))]),
    );
    expect(n).toBeGreaterThanOrEqual(15);
  });

  it("pdfText finds an inflated content operator in a control PDF", async () => {
    const { bytes } = await expectPdf(
      await cell(() => imagesToPdf("png", [img("a.png", F.validGreyPng())])),
    );
    expect(pdfText(bytes)).toMatch(/\bDo\b/);
  });
});

describe("health: every hostile fixture is hostile in the way it claims", () => {
  it("controls convert (PNG, JPEG, TIFF) — so a refusal below is the hostility, not the harness", async () => {
    for (const [name, bytes] of [
      ["c.png", F.validGreyPng()],
      ["c.jpg", F.VALID_JPEG],
      ["c.tif", F.validTiff()],
    ] as const) {
      const { doc } = await expectPdf(
        await cell(() => imagesToPdf("png", [img(name, bytes)])),
      );
      expect(doc.getPageCount()).toBe(1);
    }
  });

  it("pngClaiming's IHDR reads back the claimed size; its IDAT is tiny", () => {
    const p = F.pngClaiming(100_000, 100_000);
    const v = new DataView(p.buffer, p.byteOffset);
    expect([v.getUint32(16), v.getUint32(20)]).toEqual([100_000, 100_000]);
    expect(p.length).toBeLessThan(120);
  });

  it("jpegClaiming's SOF reads back the claimed size", () => {
    const j = F.jpegClaiming(65_535, 65_535);
    const at = F.sofOffset(j);
    expect(at).toBeGreaterThan(0);
    expect((j[at + 5]! << 8) | j[at + 6]!).toBe(65_535);
    expect((j[at + 7]! << 8) | j[at + 8]!).toBe(65_535);
  });

  it("the TIFF loops loop: the self loop has 1 IFD, A->B->A has 2, both chains revisit", () => {
    const self = F.tiffWithLastNext(1, "self");
    const aba = F.tiffWithLastNext(2, "first");
    expect(F.ifdOffsets(self)).toHaveLength(1);
    expect(F.ifdOffsets(aba)).toHaveLength(2);
    const lastOf = (t: Uint8Array) => {
      const ifds = F.ifdOffsets(t);
      const link = F.linkOf(t, ifds.at(-1)!);
      return new DataView(t.buffer, t.byteOffset).getUint32(link, true);
    };
    expect(lastOf(self)).toBe(F.ifdOffsets(self)[0]);
    expect(lastOf(aba)).toBe(F.ifdOffsets(aba)[0]);
  });

  it("the PNG bomb is over the pixel ceiling at better than 500:1", () => {
    const bomb = F.pngBomb(12_000, 12_000);
    expect(12_000 * 12_000).toBeGreaterThan(MAX_DECODED_PIXELS);
    expect((12_000 * 12_001) / bomb.length).toBeGreaterThan(500);
  });

  it("tiffWithRational writes the rational it names (num, den) into both tags", () => {
    const t = F.tiffWithRational(0xffffffff, 1);
    const dv = new DataView(t.buffer, t.byteOffset);
    for (const tag of [282, 283]) {
      const at = F.tagValueAt(t, tag);
      expect([dv.getUint32(at, true), dv.getUint32(at + 4, true)]).toEqual([
        0xffffffff, 1,
      ]);
    }
  });

  it("the truncated JPEGs keep their frame header and lose their end", () => {
    const half = F.VALID_JPEG.subarray(0, F.VALID_JPEG.length >> 1);
    expect(F.sofOffset(half)).toBeGreaterThan(0);
    expect(half.at(-2) === 0xff && half.at(-1) === 0xd9).toBe(false);
    expect(F.VALID_JPEG.at(-2) === 0xff && F.VALID_JPEG.at(-1) === 0xd9).toBe(
      true,
    );
  });
});

/* ------------------------------------------------------------------ *
 *  Image to PDF: imagesToPdf / imagesToPdfs / buildImagePdf
 * ------------------------------------------------------------------ */

/** The three ways a file list becomes a PDF, each returning PDF bytes. */
const IMAGE_ENTRIES: [
  string,
  (files: ImagePdfInput[], o?: ImagePageOptions) => Promise<Uint8Array>,
][] = [
  ["imagesToPdf", (f, o) => imagesToPdf("png", f, o)],
  ["imagesToPdfs", async (f, o) => (await imagesToPdfs("png", f, o))[0]!.bytes],
  ["buildImagePdf", (f, o) => buildImagePdf("png", f, o ?? FIT)],
];

describe.each(IMAGE_ENTRIES)("%s — H01/H02/H03 not an image", (_entry, run) => {
  it.each([
    [
      "H01 zero bytes named .png",
      "a.png",
      new Uint8Array(),
      /"a\.png" is empty\./,
    ],
    [
      "H01 zero bytes named .pdf",
      "a.pdf",
      new Uint8Array(),
      /isn't a PNG, JPG, WebP, GIF, BMP or TIFF image/,
    ],
    [
      "H02 PDF bytes named .png",
      "a.png",
      F.TINY_PDF,
      /"a\.png" isn't a PNG, JPG, WebP, GIF, BMP or TIFF image/,
    ],
    ["H02 ZIP/DOCX bytes named .jpg", "a.jpg", F.ZIP_MAGIC, /isn't a PNG, JPG/],
    ["H02 4 KB noise named .png", "a.png", F.noise(4096), /isn't a PNG, JPG/],
    ["H02 HTML named .jpg", "a.jpg", F.HTML_TEXT, /isn't a PNG, JPG/],
    ["H02 noise named .tif", "a.tif", F.noise(4096), /isn't a PNG, JPG/],
    [
      "H02 HEIC (ftyp heic) named .png",
      "a.png",
      F.ftypOf("heic"),
      /"a\.png" is a HEIC image\. Only PNG, JPG, WebP, GIF, BMP and TIFF images/,
    ],
    [
      "H02 AVIF (ftyp avif) named .png",
      "a.png",
      F.ftypOf("avif"),
      /"a\.png" is an AVIF image\./,
    ],
    [
      "H03 PNG signature only",
      "a.png",
      F.PNG_SIGNATURE,
      /"a\.png" could not be decoded as a PNG image\./,
    ],
    [
      "H03 PNG IHDR and no IDAT",
      "a.png",
      F.pngOfChunks([["IHDR", F.ihdr(4, 3)]]),
      /could not be decoded as a PNG image/,
    ],
    [
      "H03 JPEG SOI only",
      "a.jpg",
      Uint8Array.from([0xff, 0xd8, 0xff]),
      /"a\.jpg" could not be decoded as a JPG image\./,
    ],
    [
      "H03 TIFF header only",
      "a.tif",
      F.latin1("II*\0\x08\0\0\0"),
      /"a\.tif" page 1 is damaged and could not be read\./,
    ],
  ])("%s → refused with copy", async (_c, name, bytes, copy) => {
    expectRefused(await cell(() => run([img(name, bytes)])), copy);
  });

  it("H02 JPEG bytes named .png → converted by its bytes (sniffed, not trusted by name)", async () => {
    const { doc } = await expectPdf(
      await cell(() => run([img("a.png", F.VALID_JPEG)])),
    );
    expect(doc.getPageCount()).toBe(1);
  });
});

describe.each(IMAGE_ENTRIES)("%s — H04 truncated", (_entry, run) => {
  it("H04 PNG cut at 50% → refused (never embedded as noise)", async () => {
    const p = F.validGreyPng(64, 64);
    expectRefused(
      await cell(() => run([img("a.png", p.subarray(0, p.length >> 1))])),
      /could not be decoded as a PNG image/,
    );
  });

  it("H04 JPEG cut before its frame header → refused", async () => {
    expectRefused(
      await cell(() =>
        run([
          img("a.jpg", F.VALID_JPEG.subarray(0, F.sofOffset(F.VALID_JPEG))),
        ]),
      ),
      /could not be decoded as a JPG image/,
    );
  });

  it("H04 TIFF cut at 50% → refused", async () => {
    const t = F.validTiff();
    expectRefused(
      await cell(() => run([img("a.tif", t.subarray(0, t.length >> 1))])),
      /is damaged and could not be read/,
    );
  });

  // CI-01: pdf-lib reads a JPEG only to its SOF; the entropy data is never
  // checked, so a file cut anywhere after the frame header is embedded and
  // the PDF shows a grey/garbled image. The PNG path promises the opposite
  // ("a cut-off file is refused, never embedded as noise"). Pinned as
  // accepted by image-intake.test.ts ("accepts a JPEG cut off after its frame
  // header, as Create PDF does") — a test that pins the defect.
  finding(
    "CI-01 H04 JPEG cut at 50% (after SOF, before EOI) → should be refused, is embedded",
    async () => {
      const half = F.VALID_JPEG.subarray(0, F.VALID_JPEG.length >> 1);
      expectRefused(
        await cell(() => run([img("a.jpg", half)])),
        /could not be decoded/,
      );
    },
  );

  finding(
    "CI-01 H04 JPEG cut right after SOS (no scan data at all) → should be refused, is embedded",
    async () => {
      const atSos = F.VALID_JPEG.subarray(0, F.sosOffset(F.VALID_JPEG) + 2);
      expectRefused(
        await cell(() => run([img("a.jpg", atSos)])),
        /could not be decoded/,
      );
    },
  );
});

describe("TIFF structure — H05/H06/H07/H09 (imagesToPdf, imagePageCount, readTiffPages)", () => {
  it("H06 IFD chain whose last next points at itself → the loop ends the chain: 1 page", async () => {
    const t = F.tiffWithLastNext(1, "self");
    expect(await imagePageCount(img("a.tif", t))).toBe(1);
    const { doc } = await expectPdf(
      await cell(() => imagesToPdf("png", [img("a.tif", t)])),
    );
    expect(doc.getPageCount()).toBe(1);
  });

  it("H06 A->B->A IFD cycle → 2 pages, no hang", async () => {
    const t = F.tiffWithLastNext(2, "first");
    const o = await cell(() => imagesToPdf("png", [img("a.tif", t)]), 5_000);
    const { doc } = await expectPdf(o);
    expect(doc.getPageCount()).toBe(2);
  });

  it("H09 IFD0 entry count 65,535 with nothing behind it → refused as damaged", async () => {
    expectRefused(
      await cell(() =>
        imagesToPdf("png", [img("a.tif", F.tiffWithEntryCount(0xffff))]),
      ),
      /"a\.tif" page 1 is damaged/,
    );
  });

  it(`H09 ${MAX_TIFF_PAGES + 1} pages → refused before decoding; ${MAX_TIFF_PAGES} pages are counted`, async () => {
    expectRefused(
      await cell(() =>
        imagePageCount(img("a.tif", F.validTiff(MAX_TIFF_PAGES + 1))),
      ),
      /has more than 500 pages, the most one TIFF can bring here\. Split it into smaller TIFFs first\./,
    );
    expect(
      await imagePageCount(img("a.tif", F.validTiff(MAX_TIFF_PAGES))),
    ).toBe(MAX_TIFF_PAGES);
  });

  it("H11 a header claiming 60,000 × 60,000 is refused by size, naming the pixels (the TIFF path has the ceiling)", () => {
    // Built by hand: tiffOf would allocate the rows. Patch width/height.
    const t = F.validTiff();
    const dv = new DataView(t.buffer, t.byteOffset);
    dv.setUint32(F.tagValueAt(t, 256), 60_000, true);
    dv.setUint32(F.tagValueAt(t, 257), 60_000, true);
    expect(() => readTiffPages("a.tif", t)).toThrow(
      /page 1 is 60,000 × 60,000 pixels, more than the 100 megapixels a page can have here/,
    );
  });

  it("H12 a Deflate strip inflating to 64 MB for a 64 × 64 page → read no further than the page needs", async () => {
    const t = F.tiffDeflateBomb(64 * 1024 * 1024);
    const n = await largestAllocation(() =>
      imagesToPdf("png", [img("a.tif", t)]),
    );
    const { doc } = await expectPdf(
      await cell(() => imagesToPdf("png", [img("a.tif", t)])),
    );
    expect(doc.getPageCount()).toBe(1);
    expect(n).toBeLessThan(1024 * 1024);
  });

  it("H18 XResolution 0/0 and 1/0 → no resolution believed: one pixel per point, finite page", async () => {
    for (const [num, den] of [
      [0, 0],
      [1, 0],
    ]) {
      const { doc } = await expectPdf(
        await cell(() =>
          imagesToPdf(
            "png",
            [img("a.tif", F.tiffWithRational(num!, den!))],
            FIT,
          ),
        ),
      );
      expect(doc.getPage(0).getSize()).toEqual({ width: 4, height: 3 });
    }
  });

  // CI-09: a dangling `next` after two good pages throws away both and names
  // a page 3 the file does not have.
  finding(
    "CI-09 H05 next-IFD pointer past EOF after 2 good pages → should keep 2 pages (or name the real damage), says 'page 3 is damaged'",
    async () => {
      const o = await cell(() =>
        imagesToPdf("png", [img("a.tif", F.tiffWithLastNext(2, 0x7fffffff))]),
      );
      if (o.kind === "refused") expect(o.message).not.toMatch(/page 3/);
      else expect((await expectPdf(o)).doc.getPageCount()).toBe(2);
    },
  );

  it(
    "SLOW H21 a 500-page TIFF through imagesToPdf → 500 pages within the bound",
    { timeout: 60_000 },
    async () => {
      const o = await cell(
        () => imagesToPdf("png", [img("a.tif", F.validTiff(500))]),
        45_000,
      );
      const { doc } = await expectPdf(o);
      expect(doc.getPageCount()).toBe(500);
    },
  );
});

describe("JPEG segment walks — H07/H08/H09", () => {
  it.each([
    ["H08 10,000 empty APP15 segments", () => F.jpegManySegments(10_000)],
    [
      "H07 an Exif IFD0 whose next points at itself",
      () => F.jpegExifSelfLoop(),
    ],
    ["H09 an Exif IFD0 claiming 65,535 entries", () => F.jpegExifHugeCount()],
  ])("%s → converted, one 30 × 20 image, under 2 s", async (_c, make) => {
    const o = await cell(
      () => imagesToPdf("jpg", [img("a.jpg", make())]),
      2_000,
    );
    const { bytes } = await expectPdf(o);
    const drawn = await drawnImages(bytes);
    expect(drawn.map((d) => [d.width, d.height])).toEqual([[30, 20]]);
  });
});

describe("declared size vs real data — H11/H12 (PNG and JPEG)", () => {
  it.each([
    ["100,000 × 100,000 grey", 100_000, 100_000, 0],
    ["2^31-1 × 2^31-1 grey", 0x7fffffff, 0x7fffffff, 0],
  ])(
    "H11 PNG IHDR claiming %s with a 16-byte IDAT → refused",
    async (_c, w, h, ct) => {
      expectRefused(
        await cell(() =>
          imagesToPdf("png", [img("a.png", F.pngClaiming(w, h, ct))]),
        ),
        /"a\.png"/,
      );
    },
  );

  // CI-05: png-embed.ts allocates the DECLARED size (`new Uint8Array(want)`)
  // before inflating a byte, with no pixel ceiling: an 80-byte file claiming
  // 20,000 × 20,000 RGBA asks for 1.6 GB. In Node the zero pages are lazy and
  // it is refused in a millisecond; a browser tab may not be so lucky.
  finding(
    "CI-05 H11 PNG claiming 20,000 × 20,000 RGBA → should refuse by size before allocating (allocates the declared 1.6 GB)",
    async () => {
      const png = F.pngClaiming(20_000, 20_000, 6);
      const n = await largestAllocation(() =>
        imagesToPdf("png", [img("a.png", png)]),
      );
      expect(n).toBeLessThan(MAX_DECODED_PIXELS * 4);
    },
  );

  // CI-06: the TIFF path names the size ("… pixels, more than the 100
  // megapixels a page can have here"); the PNG path says the file is broken.
  finding(
    "CI-06 H11 PNG over the pixel ceiling → should say it is too large, says 'could not be decoded'",
    async () => {
      expectRefused(
        await cell(() =>
          imagesToPdf("png", [img("a.png", F.pngClaiming(100_000, 100_000))]),
        ),
        /megapixels|too large/,
      );
    },
  );

  // CI-04: pixel-ceiling.ts says the 100 MP ceiling is read by "both engines
  // that decode a stranger's pixels"; png-embed.ts decodes (inflates in full)
  // and never reads it. A 141 KB file inflates 144 MB and lands in the PDF.
  finding(
    "CI-04 H12 PNG Flate bomb, 12,000 × 12,000 (144 MP) in ~141 KB → should be refused by the 100 MP ceiling, is inflated and embedded",
    { timeout: 30_000 },
    async () => {
      const o = await cell(
        () => imagesToPdf("png", [img("a.png", F.pngBomb(12_000, 12_000))]),
        20_000,
      );
      expectRefused(o, /megapixels|too large/);
    },
  );

  // CI-02: a 30 × 20 JPEG whose SOF says 65,535 × 65,535 is embedded as a
  // 4.29-gigapixel image XObject — no viewer can decode it; the page is blank.
  finding(
    "CI-02 H11 JPEG SOF claiming 65,535 × 65,535 over 30 × 20 of data → should be refused, is embedded at the claimed size",
    async () => {
      const o = await cell(() =>
        imagesToPdf("jpg", [img("a.jpg", F.jpegClaiming(65_535, 65_535))]),
      );
      expectRefused(o, /./);
    },
  );

  // CI-03: SOF 0 × 0 (a DNL-height or broken header) → /Width 0 /Height 0.
  finding(
    "CI-03 H11 JPEG SOF claiming 0 × 0 → should be refused, is embedded as a 0 × 0 image XObject",
    async () => {
      const o = await cell(() =>
        imagesToPdf("jpg", [img("a.jpg", F.jpegClaiming(0, 0))]),
      );
      expectRefused(o, /./);
    },
  );

  it("H11 the recorded behaviour behind CI-02/03: the PDF really carries the claimed size", async () => {
    for (const [w, h] of [
      [65_535, 65_535],
      [0, 0],
    ]) {
      const { bytes } = await expectPdf(
        await cell(() =>
          imagesToPdf("jpg", [img("a.jpg", F.jpegClaiming(w!, h!))]),
        ),
      );
      expect(
        (await drawnImages(bytes)).map((d) => [d.width, d.height]),
      ).toEqual([[w, h]]);
    }
  });
});

describe("page geometry from stated resolution — H10/H18", () => {
  it("H18 PNG pHYs 2^32-1 per metre → implausible, ignored: 4 × 3 pt page", async () => {
    const png = F.pngOfChunks([
      ["IHDR", F.ihdr(4, 3)],
      ["pHYs", F.phys(0xffffffff, 0xffffffff)],
      ["IDAT", deflateSync(F.greyRows(4, 3))],
    ]);
    const { doc } = await expectPdf(
      await cell(() => imagesToPdf("png", [img("a.png", png)], FIT)),
    );
    expect(doc.getPage(0).getSize()).toEqual({ width: 4, height: 3 });
  });

  it("H10 a 20,000 px wide TIFF at 10 dpi under Fit → the page is clamped to PDF's 14,400 pt side", async () => {
    const t = F.tiffWithRational(10, 1, { width: 20_000, height: 1 });
    const { doc } = await expectPdf(
      await cell(() => imagesToPdf("png", [img("a.tif", t)], FIT)),
    );
    expect(doc.getPage(0).getSize().width).toBeLessThanOrEqual(
      MAX_PAGE_SIDE_PT,
    );
  });

  // CI-07: resolution() (tiff.ts) has a floor (MIN_BELIEVED_DPI 10) and no
  // ceiling, where JPEG/PNG reject anything over MAX_PLAUSIBLE_DPI (2,400).
  // XResolution 4,294,967,295 dpi makes a 100 px page 1.7e-6 pt wide.
  finding(
    "CI-07 H10 TIFF XResolution 2^32-1 dpi under Fit → should ignore the dpi, makes a 0.0000017 pt page",
    async () => {
      const t = F.tiffWithRational(0xffffffff, 1, { width: 100, height: 100 });
      const { doc } = await expectPdf(
        await cell(() => imagesToPdf("png", [img("a.tif", t)], FIT)),
      );
      expect(doc.getPage(0).getSize().width).toBeGreaterThanOrEqual(
        MIN_PAGE_SIDE_PT,
      );
    },
  );

  finding(
    "CI-07 H10 TIFF XResolution 2^32-1 dpi on Letter → should fill the page as a 100 px image, is drawn as a speck",
    async () => {
      const t = F.tiffWithRational(0xffffffff, 1, { width: 100, height: 100 });
      const { bytes } = await expectPdf(
        await cell(() => imagesToPdf("png", [img("a.tif", t)])),
      );
      const [drawn] = await drawnImages(bytes);
      const box = boxOf(drawn!.ctm);
      expect(box.x1 - box.x0).toBeGreaterThan(1);
    },
  );

  // CI-08: Fit to image with no margin makes a page as thin as the image:
  // below ISO 32000's 3-unit minimum.
  finding(
    "CI-08 H10 a 20,000 × 1 PNG under Fit → page side should be ≥ 3 pt, is 0.72 pt",
    async () => {
      const { doc } = await expectPdf(
        await cell(() =>
          imagesToPdf("png", [img("a.png", F.validGreyPng(20_000, 1))], FIT),
        ),
      );
      const { width, height } = doc.getPage(0).getSize();
      expect(Math.min(width, height)).toBeGreaterThanOrEqual(MIN_PAGE_SIDE_PT);
    },
  );

  finding(
    "CI-08 H10 a 1 × 1 PNG under Fit → page side should be ≥ 3 pt, is 1 pt",
    async () => {
      const { doc } = await expectPdf(
        await cell(() =>
          imagesToPdf("png", [img("a.png", F.validGreyPng(1, 1))], FIT),
        ),
      );
      expect(doc.getPage(0).getSize().width).toBeGreaterThanOrEqual(
        MIN_PAGE_SIDE_PT,
      );
    },
  );
});

describe("duplicates — H19", () => {
  // CI-10: PNG requires exactly one IHDR, first. png-embed.ts overwrites its
  // header with the second, so the PDF shows a 40 × 30 image of a file that
  // libpng (and so the browser's own thumbnail) rejects.
  finding(
    "CI-10 H19 a PNG with two IHDR chunks (1 × 1 then 40 × 30) → should be refused, converts using the second",
    async () => {
      expectRefused(
        await cell(() =>
          imagesToPdf("png", [img("a.png", F.pngTwoHeaders([1, 1], [40, 30]))]),
        ),
        /could not be decoded/,
      );
    },
  );
});

describe("page setup options at the engine gate — H18 (NaN / negative numbers)", () => {
  const png = () => [img("a.png", F.validGreyPng())];
  it("a custom margin that swallows the page → refused with copy", async () => {
    expectRefused(
      await cell(() =>
        imagesToPdf("png", png(), {
          ...FIT,
          pageSize: "letter",
          margin: "custom",
          customMarginPt: 1e9,
        }),
      ),
      /That margin leaves no room for the image on a 215\.9 mm wide page\. Choose a smaller margin\./,
    );
  });

  // CI-13: validatePageSetup is documented as "the engine refusing it
  // anyway", but pageSetupProblem() lets NaN through (every comparison is
  // false) and never checks a negative margin or a Fit margin over its
  // published 0–144 pt range. The runner's parsers bound them today; the
  // engine gate does not.
  finding(
    "CI-13 H18 customMarginPt NaN → should be refused with copy, throws pdf-lib's raw TypeError",
    async () => {
      const o = await cell(() =>
        imagesToPdf("png", png(), {
          ...FIT,
          pageSize: "letter",
          margin: "custom",
          customMarginPt: NaN,
        }),
      );
      expect(o.kind).toBe("refused");
    },
  );

  finding(
    "CI-13 H18 custom page size NaN × 100 → should be refused with copy, throws pdf-lib's raw TypeError",
    async () => {
      const o = await cell(() =>
        imagesToPdf("png", png(), {
          ...FIT,
          pageSize: "custom",
          customSize: { width: NaN, height: 100 },
        }),
      );
      expect(o.kind).toBe("refused");
    },
  );

  finding(
    "CI-13 H18 a negative custom margin under Fit → should be refused, makes a negative-sized page",
    async () => {
      const o = await cell(() =>
        imagesToPdf("png", png(), {
          ...FIT,
          margin: "custom",
          customMarginPt: -1e6,
        }),
      );
      expect(o.kind).toBe("refused");
    },
  );
});

describe("sniffers and validators on degenerate bytes", () => {
  it.each([
    ["empty", new Uint8Array()],
    ["1 byte", Uint8Array.of(0x89)],
    ["3 bytes of PNG", F.PNG_SIGNATURE.subarray(0, 3)],
    ["'BM' alone", F.latin1("BM")],
    ["'RIFF' alone", F.latin1("RIFF")],
  ])(
    "sniffImageFormat / sniffRasterFormat / unsupportedImageMessage on %s → null and a message, no throw",
    (_c, bytes) => {
      expect(sniffImageFormat(bytes)).toBeNull();
      expect(sniffRasterFormat(bytes)).toBeNull();
      expect(unsupportedImageMessage("x.png", bytes)).toMatch(
        /^"x\.png" isn't a PNG, JPG, WebP, GIF, BMP or TIFF image\.$/,
      );
    },
  );

  it("validateImagePdfInputs: no files, a zero-byte file, a .heic name → refused with copy", () => {
    expect(() => validateImagePdfInputs("jpg", [])).toThrow(
      /Add at least one JPG image\./,
    );
    expect(() =>
      validateImagePdfInputs("png", [img("a.png", new Uint8Array())]),
    ).toThrow(/"a\.png" is empty\./);
    expect(() =>
      validateImagePdfInputs("png", [img("a.heic", F.ftypOf("heic"))]),
    ).toThrow(PdfEngineError);
  });

  // CI-16: describeImageBytes reads only the MAJOR brand, and "mif1" is in
  // its HEIC list — so an AVIF written with major brand mif1 (compatible
  // "avif", as several encoders do) is named a HEIC image.
  finding(
    "CI-16 H02 ftyp major 'mif1' with compatible 'avif' → should say AVIF, says HEIC",
    () => {
      const b = F.ftypOf("mif1");
      b.set(F.latin1("avif"), 16);
      expect(unsupportedImageMessage("a.png", b)).toMatch(/AVIF/);
    },
  );
});

describe("decoded formats (GIF/BMP/WebP via the browser's decoder)", () => {
  it("in Node (no createImageBitmap) noise named .gif is refused by the name gate, header-only GIF by the decoder — both with copy", async () => {
    expectRefused(
      await cell(() => imagesToPdf("png", [img("a.gif", F.noise(64))])),
      /isn't a PNG, JPG/,
    );
    expectRefused(
      await cell(() => imagesToPdf("png", [img("a.gif", F.latin1("GIF89a"))])),
      /"a\.gif" could not be read as a GIF image\./,
    );
  });

  it.skip("BROWSER-ONLY: hostile GIF/BMP/WebP (huge logical screen, truncated LZW, BMP height -2^31) — decoded by createImageBitmap, not reachable in Node; needs the e2e client proof", () => {});
});

/* ------------------------------------------------------------------ *
 *  Text to PDF
 * ------------------------------------------------------------------ */

describe("textToPdf", () => {
  const S = (c: number) => String.fromCharCode(c);

  it.each([
    ["H01 empty", "", /Add some text or choose a non-empty \.txt file\./],
    [
      "H01 control characters only",
      S(1) + S(7) + S(27) + S(0),
      /Add some text/,
    ],
    ["H01 form feeds only", S(12).repeat(10), /Add some text/],
    [
      "over the 2 MB cap",
      "x".repeat(MAX_SOURCE_BYTES + 1),
      /This text file is too large for in-browser conversion \(max 2 MB\)\./,
    ],
    [
      "emoji",
      "hi \u{1F600}",
      /emoji is not supported because colour emoji are pictures/,
    ],
    [
      "4 KB of noise decoded as UTF-8",
      new TextDecoder().decode(F.noise(4096)),
      /cannot draw yet/,
    ],
  ])("%s → refused with copy", async (_c, text, copy) => {
    expectRefused(await cell(() => textToPdf(text)), copy);
  });

  it.each([
    ["NUL inside a word", "a" + S(0) + "b"],
    ["bidi override + isolate", "abc" + S(0x202e) + "def" + S(0x2066)],
    ["5,000 combining accents on one letter", "a" + S(0x0301).repeat(5000)],
    ["PDF bytes pasted as text", new TextDecoder("latin1").decode(F.TINY_PDF)],
    ["HTML with a script", new TextDecoder().decode(F.HTML_TEXT)],
  ])("%s → a PDF that loads", async (_c, text) => {
    const { doc } = await expectPdf(await cell(() => textToPdf(text)));
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("a 200 KB word with no spaces wraps (63 pages) inside the bound", async () => {
    const { doc } = await expectPdf(
      await cell(() => textToPdf("x".repeat(200_000)), 15_000),
    );
    expect(doc.getPageCount()).toBeGreaterThan(50);
  });

  // CI-14: a lone surrogate or a noncharacter is not "a script"; the copy
  // prints U+FFFD / an invisible U+FFFE as the offending "character".
  finding(
    "CI-14 a lone surrogate → should name it as an invalid character, the copy calls it a script it cannot draw and shows U+FFFD",
    async () => {
      const o = await cell(() => textToPdf("a" + S(0xd800) + "b"));
      expectRefused(o, /^(?![\s\S]*script it cannot draw)/);
    },
  );

  // CI-11: no page ceiling. "x\f" is two bytes and one page, so the 2 MB cap
  // admits 1,048,576 pages; each costs ~0.9 ms and ~300 B here, all on the
  // main thread (the page loop is synchronous until doc.save). Measured on a
  // small run and extrapolated — running the cap would freeze this file for
  // ~15 minutes, which is the finding.
  finding(
    "SLOW CI-11 H21 form-feed flood: the 2 MB cap admits 1,048,576 pages → should be refused or bounded, extrapolates to minutes",
    { timeout: 60_000 },
    async () => {
      const N = 3000;
      const o = await cell(() => textToPdf("x\f".repeat(N)), 45_000);
      const { doc } = await expectPdf(o);
      expect(doc.getPageCount()).toBe(N);
      const capPages = MAX_SOURCE_BYTES / 2;
      const projectedSeconds = ((o.ms / N) * capPages) / 1000;
      console.info(
        `[CI-11] ${N} pages in ${o.ms.toFixed(0)} ms → ${capPages} pages ≈ ${projectedSeconds.toFixed(0)} s`,
      );
      expect(projectedSeconds).toBeLessThan(60);
    },
  );
});

/* ------------------------------------------------------------------ *
 *  Markdown to PDF
 * ------------------------------------------------------------------ */

describe("markdownToPdf / parseMarkdownBlocks", () => {
  it("H01 whitespace only → refused with copy", async () => {
    expectRefused(
      await cell(() => markdownToPdf("  \n ")),
      /Add some Markdown or choose a non-empty \.md file\./,
    );
  });

  it("over the 2 MB cap → refused with copy", async () => {
    expectRefused(
      await cell(() => markdownToPdf("x".repeat(MAX_SOURCE_BYTES + 1))),
      /This Markdown file is too large for in-browser conversion \(max 2 MB\)\./,
    );
  });

  it.each([
    ["20,000 '*'", "*".repeat(20_000)],
    ["40,000 'a*'", "a*".repeat(40_000)],
    ["40,000 '['", "[".repeat(40_000)],
    ["40,000 '[a]('", "[a](".repeat(40_000)],
    ["40,000 '`a'", "`a".repeat(40_000)],
    ["40,000 '<a'", "<a".repeat(40_000)],
    ["40,000 'a_'", "a_".repeat(40_000)],
    ["20,000 '~~a'", "~~a".repeat(20_000)],
    ["20,000 '!['", "![".repeat(20_000)],
    ["20,000 '&#'", "&#".repeat(20_000)],
    [
      "10,000-deep '*_' nesting",
      "*_".repeat(10_000) + "x" + "_*".repeat(10_000),
    ],
    ["4,000-deep link nesting", "[".repeat(4000) + "x" + "](u)".repeat(4000)],
    [
      "5,000 footnote refs",
      Array.from({ length: 5000 }, (_, i) => `[^${i}]`).join(" "),
    ],
  ])(
    "inline storm: %s → parsed under 1 s (no backtracking blow-up)",
    async (_c, md) => {
      const o = await cell(() => parseMarkdownBlocks(md), 1_000);
      expect(o.kind).toBe("output");
      expect(o.ms).toBeLessThan(1_000);
    },
  );

  it("H08 a quote nested 20,000 deep ('> ' × 20,000) → rendered, no stack overflow", async () => {
    const { doc } = await expectPdf(
      await cell(() => markdownToPdf("> ".repeat(20_000) + "x"), 10_000),
    );
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it(
    "H08 a list nested ~1,400 deep at the 2 MB cap → parsed within 10 s (SLOW: superlinear, recorded)",
    { timeout: 30_000 },
    async () => {
      let depth = 1;
      while ((depth + 1) * (depth + 1) + 4 * (depth + 1) < MAX_SOURCE_BYTES)
        depth++;
      const md = Array.from(
        { length: depth },
        (_, i) => "  ".repeat(i) + "- x",
      ).join("\n");
      expect(new TextEncoder().encode(md).length).toBeLessThanOrEqual(
        MAX_SOURCE_BYTES,
      );
      const o = await cell(() => parseMarkdownBlocks(md), 20_000);
      expect(o.kind).toBe("output");
      console.info(
        `[H08 list] depth ${depth}, ${md.length} B parsed in ${o.ms.toFixed(0)} ms`,
      );
      expect(o.ms).toBeLessThan(10_000);
    },
  );

  it.each([
    [
      "a 2,000-column table",
      "|" +
        "a|".repeat(2000) +
        "\n|" +
        "-|".repeat(2000) +
        "\n|" +
        "b|".repeat(2000),
    ],
    ["an unclosed fence over 5,000 lines", "```\n" + "x\n".repeat(5000)],
    ["a 100 KB heading", "# " + "x".repeat(100_000)],
  ])("%s → a PDF that loads", async (_c, md) => {
    await expectPdf(await cell(() => markdownToPdf(md), 15_000));
  });

  it("H16 javascript:, data: and file: link targets → no /URI action carries them, nothing executable written", async () => {
    const { bytes } = await expectPdf(
      await cell(() =>
        markdownToPdf(
          "[a](javascript:alert(1)) <javascript:alert(2)> [b](data:text/html,x) [c](file:///etc/passwd) [ok](https://example.com)",
        ),
      ),
    );
    const text = pdfText(bytes);
    // Positive control: the https link IS written, so the probe can see URIs.
    expect(text).toMatch(/\/URI\s*\(https:\/\/example\.com\)/);
    expect(text).not.toMatch(/\/URI\s*\((javascript|data|file):/i);
    expect(text).not.toMatch(/\/(JavaScript|JS|Launch)\b/);
  });

  // Not a finding (measured 2026-11-08): no page ceiling here either, but a
  // blank-line paragraph is 3 bytes, so the cap admits ~700,000 paragraphs ≈
  // 22,600 pages, extrapolated at ~18 s — linear and under the bound. Text to
  // PDF's form feed (CI-11) is 2 bytes a PAGE, which is what makes it one.
  // Extrapolated, not run: linearity is assumed past N.
  it(
    "SLOW H21 paragraph flood: the 2 MB cap (~700k paragraphs) extrapolates under 60 s",
    { timeout: 60_000 },
    async () => {
      const N = 6000;
      const o = await cell(() => markdownToPdf("a\n\n".repeat(N)), 45_000);
      const { doc } = await expectPdf(o);
      const capParas = MAX_SOURCE_BYTES / 3;
      const projectedSeconds = ((o.ms / N) * capParas) / 1000;
      console.info(
        `[H21 paragraphs] ${N} paragraphs → ${doc.getPageCount()} pages in ${o.ms.toFixed(0)} ms → ${capParas.toFixed(0)} ≈ ${projectedSeconds.toFixed(0)} s, ${Math.round((doc.getPageCount() / N) * capParas)} pages`,
      );
      expect(projectedSeconds).toBeLessThan(60);
    },
  );
});

/* ------------------------------------------------------------------ *
 *  Scan to PDF
 * ------------------------------------------------------------------ */

describe("scansToPdf (inputs come from the browser camera pipeline)", () => {
  it.each([
    ["no photos", [] as never[], /Add at least one photo first\./],
    [
      "a plane shorter than width × height",
      [{ enhancement: "bw", plane: new Uint8Array(3), width: 2, height: 2 }],
      /A photo could not be read\./,
    ],
    [
      "NaN width",
      [{ enhancement: "bw", plane: new Uint8Array(4), width: NaN, height: 2 }],
      /A photo could not be read\./,
    ],
    [
      "zero height",
      [
        {
          enhancement: "document",
          plane: new Uint8Array(0),
          width: 2,
          height: 0,
        },
      ],
      /A photo could not be read\./,
    ],
  ])("%s → refused with copy", async (_c, inputs, copy) => {
    expectRefused(await cell(() => scansToPdf(inputs as never, "fit")), copy);
  });

  it("an 'original' page of 2^31-1 × 1 px on A4 → a page inside PDF limits", async () => {
    const o = await cell(() =>
      scansToPdf(
        [
          {
            enhancement: "original",
            jpeg: F.VALID_JPEG,
            width: 2 ** 31 - 1,
            height: 1,
          },
        ],
        "a4",
      ),
    );
    expect(o.kind).toBe("output");
    const doc = await PDFDocument.load(
      (o as { value: { bytes: Uint8Array } }).value.bytes,
    );
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.max(width, height)).toBeLessThanOrEqual(MAX_PAGE_SIDE_PT);
  });

  // CI-12: a non-JPEG in an 'original' page reaches pdf-lib, whose raw
  // "SOI not found in JPEG" is thrown as it is.
  finding(
    "CI-12 H02 an 'original' page whose bytes are not a JPEG → should be refused with copy, throws pdf-lib's raw Error",
    async () => {
      const o = await cell(() =>
        scansToPdf(
          [
            {
              enhancement: "original",
              jpeg: F.noise(100),
              width: 10,
              height: 10,
            },
          ],
          "fit",
        ),
      );
      expect(o.kind).toBe("refused");
    },
  );
});
