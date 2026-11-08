// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
import type { JobResults } from "@/lib/jobs/results";
import {
  DEFAULT_IMAGE_QUALITY,
  IMAGE_QUALITY_LEVELS,
} from "@/lib/pdf/compress-image-quality";
import {
  imageQualityProofPdf,
  imageQualityProofVerdict,
  jpegLuminanceScale,
  nearestImageQuality,
  proofImages,
} from "./image-quality-proof";

/** The standard luminance table, natural order (T.81 K.1), typed again here on purpose. */
const STD = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16,
  24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109,
  103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
];
const ZZ = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40,
  48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29,
  22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54,
  47, 55, 62, 63,
];

/**
 * The head of a JPEG as libjpeg writes it at `jpeg_set_linear_quality(scale
 * * 100)`, which is what Ghostscript's QFactor does: each entry is
 * (std * percent + 50) / 100, clamped to 1..255. Table 1 (chroma) first, so
 * the reader must pick table 0 by its id, not its position.
 */
function libjpegHead(qFactor: number): Uint8Array {
  const percent = Math.round(qFactor * 100);
  const table = (id: number, base: number[]) => [
    id,
    ...ZZ.map((n) =>
      Math.min(255, Math.max(1, Math.floor((base[n]! * percent + 50) / 100))),
    ),
  ];
  const chroma = STD.map((v) => Math.min(99, v + 20));
  const body = [...table(1, chroma), ...table(0, STD)];
  const length = body.length + 2;
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00, // a 2-byte APP0, so the walk steps over a segment first
    0xff,
    0xdb,
    length >> 8,
    length & 0xff,
    ...body,
    0xff,
    0xd9,
  ]);
}

/** A PDF whose one image is `jpeg` under DCTDecode, padded to about `pad` bytes. */
async function jpegPdf(jpeg: Uint8Array, pad = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const image = doc.context.stream(jpeg, {
    Type: "XObject",
    Subtype: "Image",
    Width: 8,
    Height: 8,
    BitsPerComponent: 8,
    ColorSpace: "DeviceRGB",
    Filter: "DCTDecode",
  });
  page.node.setXObject(PDFName.of("Im0"), doc.context.register(image));
  if (pad > 0) doc.setSubject("x".repeat(pad));
  return doc.save({ useObjectStreams: false });
}

const qFactor = (id: string) =>
  IMAGE_QUALITY_LEVELS.find((l) => l.id === id)!.qFactor;
const record = (imageQuality?: string): JobResults => ({
  compression: {
    pageCheck: "verified",
    pagesIn: 1,
    pagesOut: 1,
    ...(imageQuality ? { imageQuality } : {}),
  },
});
const BIG_INPUT = 1_000_000;

describe("jpegLuminanceScale reads the scale libjpeg encoded at", () => {
  it.each(IMAGE_QUALITY_LEVELS.map((l) => [l.id, l.qFactor] as const))(
    "%s (QFactor %s) reads back as its own level",
    (id, q) => {
      const scale = jpegLuminanceScale(libjpegHead(q));
      expect(scale).not.toBeNull();
      expect(Math.abs(scale! - q) / q).toBeLessThan(0.1);
      expect(nearestImageQuality(scale!)).toBe(id);
    },
  );

  it("HEALTH: not a JPEG, or a JPEG with no table 0, has no scale", () => {
    expect(jpegLuminanceScale(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
    expect(
      jpegLuminanceScale(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])),
    ).toBeNull();
  });
});

describe("imageQualityProofVerdict", () => {
  it("POSITIVE CONTROL: a JPEG at Lowest, the record saying lowest, smaller than the input", async () => {
    const out = await jpegPdf(libjpegHead(qFactor("lowest")));
    const v = await imageQualityProofVerdict(out, record("lowest"), {
      asked: "lowest",
      inputBytes: BIG_INPUT,
    });
    expect(v.detail).toMatch(/every JPEG at "lowest"/);
    expect(v.ok).toBe(true);
  });

  it("NEGATIVE CONTROL (the defect): an older worker's /ebook JPEG and no imageQuality on the record", async () => {
    const out = await jpegPdf(libjpegHead(qFactor(DEFAULT_IMAGE_QUALITY)));
    const v = await imageQualityProofVerdict(out, record(), {
      asked: "lowest",
      inputBytes: BIG_INPUT,
    });
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/imageQuality is absent/);
    // The measurement reaches the operator even on the failing line.
    expect(v.detail).toMatch(/\(medium\)/);
  });

  it("NEGATIVE: the record claims lowest but the JPEG is at Medium — the bytes win", async () => {
    const out = await jpegPdf(libjpegHead(qFactor(DEFAULT_IMAGE_QUALITY)));
    const v = await imageQualityProofVerdict(out, record("lowest"), {
      asked: "lowest",
      inputBytes: BIG_INPUT,
    });
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/other than "lowest"/);
  });

  it("NEGATIVE: Low is not Lowest", async () => {
    const out = await jpegPdf(libjpegHead(qFactor("low")));
    const v = await imageQualityProofVerdict(out, record("lowest"), {
      asked: "lowest",
      inputBytes: BIG_INPUT,
    });
    expect(v.ok).toBe(false);
  });

  it("NEGATIVE (the no-worse swap): the original handed back has no JPEG and is not smaller", async () => {
    const input = await imageQualityProofPdf();
    // Health on the fixture: its photo is Flate, so any JPEG in a download
    // was written by the worker.
    const images = await proofImages(input);
    expect(images).toHaveLength(1);
    expect(images[0]!.filters).toEqual(["FlateDecode"]);
    const v = await imageQualityProofVerdict(input, record("lowest"), {
      asked: "lowest",
      inputBytes: input.byteLength,
    });
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/no image in the download is a readable JPEG/);
  });

  it("NEGATIVE: a Lowest JPEG that is not smaller than the input fails as a swap", async () => {
    const out = await jpegPdf(libjpegHead(qFactor("lowest")), 2000);
    const v = await imageQualityProofVerdict(out, record("lowest"), {
      asked: "lowest",
      inputBytes: out.byteLength,
    });
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/no-worse swap/);
  });

  it("HEALTH: not a PDF, a PDF with no image, and asking for the default all fail", async () => {
    const none = await (async () => {
      const doc = await PDFDocument.create();
      doc.addPage([100, 100]);
      return doc.save();
    })();
    const opts = { asked: "lowest" as const, inputBytes: BIG_INPUT };
    expect(
      (
        await imageQualityProofVerdict(
          new TextEncoder().encode("not a pdf at all, just some words"),
          record("lowest"),
          opts,
        )
      ).ok,
    ).toBe(false);
    const empty = await imageQualityProofVerdict(none, record("lowest"), opts);
    expect(empty.ok).toBe(false);
    expect(empty.detail).toMatch(/no image/);
    const out = await jpegPdf(libjpegHead(qFactor(DEFAULT_IMAGE_QUALITY)));
    expect(
      (
        await imageQualityProofVerdict(out, record(DEFAULT_IMAGE_QUALITY), {
          asked: DEFAULT_IMAGE_QUALITY,
          inputBytes: BIG_INPUT,
        })
      ).ok,
    ).toBe(false);
  });

  it("the fixture is deterministic and quick to upload", async () => {
    const a = await imageQualityProofPdf();
    const b = await imageQualityProofPdf();
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(a.byteLength).toBeLessThan(1_000_000);
  });
});
