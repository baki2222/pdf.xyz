/**
 * The lossless repack drops what no page can show (audit compress-pdf#6,
 * 2026-11-08): objects nothing in the file refers to, and embedded page
 * thumbnails. Until then `optimizeLossless` was setProducer + save, and
 * pdf-lib's save writes every indirect object it parsed, orphans included.
 *
 * Every check reads the bytes the repack produced, re-parsed.
 */
import { describe, expect, it } from "vitest";
import {
  PDFDocument,
  PDFName,
  PDFRawStream,
  StandardFonts,
  type PDFRef,
} from "pdf-lib";
import { analyzePdf, optimizeLossless } from "./analyze";
import { REPACK_CLEANUP_SENTENCE, removedLine } from "./compress-cleanup";
import compressContent from "@/lib/tools/content/compress-pdf";

const ORPHAN_MARK = "pdfxyz-orphan-marker";
const KEPT_MARK = "pdfxyz-kept-marker";

/** Bytes that do not compress, so a dropped stream shows in the size. */
function noise(n: number, seed = 7): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    out[i] = s >>> 24;
  }
  return out;
}

/**
 * Two pages of text; page 1 carries a /Thumb, an orphan stream nothing
 * refers to sits in the file, and a stream the catalog DOES refer to is the
 * control that must survive.
 */
async function bloated(): Promise<{ bytes: Uint8Array; thumbRef: PDFRef }> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) {
    doc.addPage([300, 300]).drawText(`Kept page ${i + 1}`, {
      x: 20,
      y: 150,
      size: 14,
      font,
    });
  }
  const ctx = doc.context;
  const thumbRef = ctx.register(
    ctx.stream(noise(20_000, 3), {
      Width: 100,
      Height: 66,
      BitsPerComponent: 8,
      ColorSpace: "DeviceRGB",
    }),
  );
  doc.getPage(0).node.set(PDFName.of("Thumb"), thumbRef);
  ctx.register(ctx.stream(noise(30_000), { Subject: ORPHAN_MARK }));
  const kept = ctx.register(ctx.stream(noise(500, 9), { Subject: KEPT_MARK }));
  doc.catalog.set(PDFName.of("PdfxyzKept"), kept);
  return { bytes: await doc.save({ useObjectStreams: false }), thumbRef };
}

/** Every stream in the re-parsed output whose /Subject is `mark`. */
async function streamsMarked(bytes: Uint8Array, mark: string) {
  const doc = await PDFDocument.load(bytes);
  return doc.context
    .enumerateIndirectObjects()
    .filter(
      ([, obj]) =>
        obj instanceof PDFRawStream &&
        obj.dict.get(PDFName.of("Subject"))?.toString() === `/${mark}`,
    );
}

describe("the lossless repack drops what no page can show", () => {
  it("health check: the fixture really carries the orphan, the thumbnail and the control", async () => {
    const { bytes } = await bloated();
    expect(await streamsMarked(bytes, ORPHAN_MARK)).toHaveLength(1);
    expect(await streamsMarked(bytes, KEPT_MARK)).toHaveLength(1);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPage(0).node.get(PDFName.of("Thumb"))).toBeDefined();
  });

  it("drops the unreferenced stream and the page thumbnail; keeps every referenced object and page", async () => {
    const { bytes } = await bloated();
    const { bytes: out } = await optimizeLossless(bytes);
    expect(await streamsMarked(out, ORPHAN_MARK)).toHaveLength(0);
    // Control: a stream the catalog refers to is kept.
    expect(await streamsMarked(out, KEPT_MARK)).toHaveLength(1);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    for (const page of doc.getPages()) {
      expect(page.node.get(PDFName.of("Thumb"))).toBeUndefined();
    }
    // The 50 KB of noise is gone from the file, not merely unlinked.
    expect(out.byteLength).toBeLessThan(bytes.byteLength - 45_000);
  });

  it("the single-file analysis downloads the same cleaned bytes, and says what it removed", async () => {
    const { bytes } = await bloated();
    const { optimized, analysis } = await analyzePdf(bytes);
    expect(await streamsMarked(optimized, ORPHAN_MARK)).toHaveLength(0);
    expect(analysis.optimizedBytes).toBe(optimized.byteLength);
    // One orphan stream, plus the thumbnail's stream once its link is gone.
    expect(analysis.removed).toEqual({ thumbnails: 1, unreferenced: 2 });
  });

  it("a file with nothing to drop reports nothing removed", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const { analysis } = await analyzePdf(await doc.save());
    expect(analysis.removed).toEqual({ thumbnails: 0, unreferenced: 0 });
  });

  it("the page states the cleanup, and the panel's line counts only what was removed", () => {
    expect(compressContent.intro.join(" ")).toContain(REPACK_CLEANUP_SENTENCE);
    expect(removedLine({ thumbnails: 0, unreferenced: 0 })).toBeNull();
    expect(removedLine({ thumbnails: 1, unreferenced: 2 })).toBe(
      "The repack also dropped 2 unused objects and 1 page thumbnail.",
    );
    expect(removedLine({ thumbnails: 0, unreferenced: 1 })).toBe(
      "The repack also dropped 1 unused object.",
    );
  });
});
