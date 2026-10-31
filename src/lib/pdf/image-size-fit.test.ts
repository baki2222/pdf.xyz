/**
 * The composed chain for "Max file size" (2026-10-31): ladder → re-encoder →
 * the real image PDF engine → the bytes. Only the browser's canvas is played
 * here (Node has none): the fake re-encoder returns REAL JPEGs whose pixel
 * size follows the rung, so pdf-lib embeds them and every size measured is a
 * real PDF's. The real canvas is proven in the browser e2e case.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { encodeGrayJpeg } from "./gray-jpeg";
import { imagesToPdf } from "./image-to-pdf";
import { DEFAULT_IMAGE_PAGE_OPTIONS } from "./image-page-layout";
import { rungPixelSize, type ReencodeRung } from "./image-size-limit";
import {
  imagesToPdfUnderLimit,
  imagesToPdfsUnderLimit,
  type Reencoder,
} from "./image-size-fit";

/** A noisy gray JPEG: noise keeps it heavy, so a limit has work to do. */
function noisyJpeg(w: number, h: number, quality = 0.95, seed = 7): Uint8Array {
  const plane = new Uint8Array(w * h);
  let x = seed;
  for (let i = 0; i < plane.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    plane[i] = x & 0xff;
  }
  return encodeGrayJpeg(plane, w, h, quality);
}

const photo = (name: string, w = 600, h = 400, seed = 7) => ({
  name,
  type: "image/jpeg",
  bytes: noisyJpeg(w, h, 0.95, seed),
});

/** The canvas, played: a real JPEG at the rung's pixel size and quality. */
const fakeReencode =
  (calls: ReencodeRung[] = []): Reencoder =>
  async (_name, bytes, _mime, rung) => {
    calls.push(rung);
    // The fixtures are gray JPEGs; their size is in the SOF0 marker.
    const sof = bytes.findIndex((b, i) => b === 0xff && bytes[i + 1] === 0xc0);
    const h0 = (bytes[sof + 5]! << 8) | bytes[sof + 6]!;
    const w0 = (bytes[sof + 7]! << 8) | bytes[sof + 8]!;
    const { width, height } = rungPixelSize(w0, h0, rung.scale);
    return {
      bytes: noisyJpeg(width, height, rung.quality),
      layoutWidth: w0,
      layoutHeight: h0,
      width,
      height,
      flattened: false,
    };
  };

async function imageWidths(pdf: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(pdf);
  const widths: number[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects())
    if (
      obj instanceof PDFRawStream &&
      obj.dict.get(PDFName.of("Subtype"))?.toString() === "/Image"
    )
      widths.push(Number(obj.dict.get(PDFName.of("Width"))?.toString()));
  return widths.sort((a, b) => a - b);
}

const opts = DEFAULT_IMAGE_PAGE_OPTIONS;
const fast = { now: () => 0, pause: async () => {} };

describe("imagesToPdfUnderLimit — the composed chain", () => {
  it("a PDF already under the limit is byte-for-byte the No limit PDF", async () => {
    const files = [photo("a.jpg", 80, 60)];
    const plain = await imagesToPdf("jpg", files, opts);
    const calls: ReencodeRung[] = [];
    const fit = await imagesToPdfUnderLimit(
      "jpg",
      files,
      opts,
      1024 * 1024,
      "a.pdf",
      {
        ...fast,
        reencode: fakeReencode(calls),
      },
    );
    // The Producer dates differ between saves only if pdf-lib wrote them;
    // compare everything but the creation and modification dates.
    const strip = (b: Uint8Array) =>
      Buffer.from(b)
        .toString("latin1")
        .replace(/\/(CreationDate|ModDate) \([^)]*\)/g, "");
    expect(strip(fit.bytes)).toBe(strip(plain));
    expect(calls).toEqual([]);
    expect(fit).toMatchObject({
      reencoded: false,
      report: { chosenRung: 0, met: true },
    });
  });

  it("over the limit: re-encodes, fits, and keeps every page exactly where it was", async () => {
    const files = [photo("a.jpg"), photo("b.jpg", 500, 700, 9)];
    const plain = await imagesToPdf("jpg", files, opts);
    const limit = Math.floor(plain.byteLength / 3);
    const fit = await imagesToPdfUnderLimit(
      "jpg",
      files,
      opts,
      limit,
      "a.pdf",
      {
        ...fast,
        reencode: fakeReencode(),
      },
    );
    expect(fit.bytes.byteLength).toBeLessThanOrEqual(limit);
    expect(fit.report.met).toBe(true);
    expect(fit.reencoded).toBe(true);
    // Every attempt before the chosen one was over the limit: the sharpest fit.
    for (const t of fit.report.tried.slice(0, -1))
      expect(t.bytes).toBeGreaterThan(limit);
    const a = await PDFDocument.load(plain);
    const b = await PDFDocument.load(fit.bytes);
    expect(b.getPageCount()).toBe(2);
    expect(b.getPages().map((p) => p.getSize())).toEqual(
      a.getPages().map((p) => p.getSize()),
    );
    // The pixels really are fewer.
    const [w0, w1] = await imageWidths(fit.bytes);
    expect(Math.max(w0!, w1!)).toBeLessThan(600);
  });

  it("an unreachable limit returns the smallest PDF made, and says it is over", async () => {
    const files = [photo("a.jpg"), photo("b.jpg", 600, 400, 3)];
    const fit = await imagesToPdfUnderLimit("jpg", files, opts, 1, "a.pdf", {
      ...fast,
      reencode: fakeReencode(),
    });
    expect(fit.report.met).toBe(false);
    expect(fit.report.stoppedBy).toBe("exhausted");
    expect(fit.bytes.byteLength).toBe(
      Math.min(...fit.report.tried.map((t) => t.bytes)),
    );
  });

  it("an image whose re-encode is BIGGER keeps its original", async () => {
    // A tiny, low-quality JPEG; the played canvas saves it at 0.85+ quality.
    const tiny = {
      name: "t.jpg",
      type: "image/jpeg",
      bytes: noisyJpeg(64, 64, 0.3),
    };
    const fit = await imagesToPdfUnderLimit("jpg", [tiny], opts, 1, "t.pdf", {
      ...fast,
      reencode: fakeReencode(),
      ladder: [{ quality: 0.95, scale: 1 }],
    });
    expect(fit.report.tried.length).toBe(2);
    // Both attempts are the same PDF; the original was kept.
    expect(fit.reencoded).toBe(false);
  });

  it("One PDF per image applies the limit to EACH file and names them as imagesToPdfs does", async () => {
    const files = [photo("a.jpg"), photo("b.jpg", 40, 30)];
    const big = (await imagesToPdf("jpg", [files[0]!], opts)).byteLength;
    const limit = Math.floor(big / 2);
    const out = await imagesToPdfsUnderLimit("jpg", files, opts, limit, {
      ...fast,
      reencode: fakeReencode(),
    });
    expect(out.map((o) => o.name)).toEqual(["a.pdf", "b.pdf"]);
    for (const o of out) expect(o.bytes.byteLength).toBeLessThanOrEqual(limit);
    // The small one was already under: untouched.
    expect(out[1]!.reencoded).toBe(false);
    expect(out[0]!.reencoded).toBe(true);
  });
});
