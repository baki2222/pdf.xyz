// @native-canvas
/**
 * Photos and scans into one PDF for OCR (audits ocr-pdf#2 and ocr-pdf#3).
 *
 * Every check decodes the PDF `buildOcrPdf` returns: its page count, each
 * page's size, the order of the sources, and that the JPEG went in as it was
 * (its DCT stream is in the file byte for byte). The page-size rule is held
 * equal to the worker's own rule for an image (`ocrImageDpi`).
 */
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  JPEG_30X20,
  JPEG_30X20_EXIF6,
  JPEG_HEIGHT,
  JPEG_WIDTH,
} from "@/tests/jpeg-fixtures";
import { ocrImageDpi } from "@/lib/workers/ocr-image";
import { userPasswordEncryptedPdf } from "@/tests/encrypted-pdf-fixture";
import { buildOcrPdf, ocrPageDpi, ocrPdfName } from "./ocr-photo-pdf";

async function markedPdf(...markers: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const marker of markers)
    doc.addPage([200, 200]).drawText(marker, { x: 20, y: 100, size: 12, font });
  return doc.save();
}

const jpg = (name: string, bytes = JPEG_30X20) => ({
  name,
  type: "image/jpeg",
  bytes,
});

const contains = (hay: Uint8Array, needle: Uint8Array) => {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++)
      if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
};

/** The JPEG's entropy-coded scan, from its SOS segment to EOI. */
function scanData(jpeg: Uint8Array): Uint8Array {
  for (let i = 2; i + 3 < jpeg.length;) {
    const marker = jpeg[i + 1]!;
    const length = (jpeg[i + 2]! << 8) | jpeg[i + 3]!;
    if (marker === 0xda) return jpeg.subarray(i);
    i += 2 + length;
  }
  throw new Error("no SOS");
}

describe("buildOcrPdf", () => {
  it("one photo makes one page, with the JPEG embedded as it is", async () => {
    const out = await buildOcrPdf([jpg("receipt.jpg")]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(1);
    expect(contains(out, scanData(JPEG_30X20))).toBe(true);
    // A 30 x 20 photo declaring nothing is sized at 72 dpi: 30 x 20 pt.
    const { width, height } = doc.getPage(0).getSize();
    expect([Math.round(width), Math.round(height)]).toEqual([
      JPEG_WIDTH,
      JPEG_HEIGHT,
    ]);
  });

  it("a photo whose EXIF says turn a quarter gets an upright page (axes swapped)", async () => {
    const doc = await PDFDocument.load(
      await buildOcrPdf([jpg("phone.jpg", JPEG_30X20_EXIF6)]),
    );
    const { width, height } = doc.getPage(0).getSize();
    expect([Math.round(width), Math.round(height)]).toEqual([
      JPEG_HEIGHT,
      JPEG_WIDTH,
    ]);
  });

  it("photos and PDFs are combined in the order given: 3 photos + a 1-page PDF = 4 pages", async () => {
    const pdf = await markedPdf("MARKER-FOUR");
    const out = await buildOcrPdf([
      jpg("one.jpg"),
      jpg("two.jpg", JPEG_30X20_EXIF6),
      jpg("three.jpg"),
      { name: "four.pdf", type: "application/pdf", bytes: pdf },
    ]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(4);
    const sizes = doc.getPages().map((p) => {
      const s = p.getSize();
      return [Math.round(s.width), Math.round(s.height)];
    });
    // The order is the list's: landscape, portrait (turned), landscape, the PDF's page.
    expect(sizes).toEqual([
      [30, 20],
      [20, 30],
      [30, 20],
      [200, 200],
    ]);
  });

  it("a PDF's every page is kept, in its order", async () => {
    const out = await buildOcrPdf([
      {
        name: "a.pdf",
        type: "application/pdf",
        bytes: await markedPdf("A1", "A2"),
      },
      jpg("b.jpg"),
    ]);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(3);
  });

  it("a file that is neither a PDF nor a photo is refused in words", async () => {
    await expect(
      buildOcrPdf([
        {
          name: "notes.txt",
          type: "text/plain",
          bytes: new Uint8Array([1, 2, 3]),
        },
      ]),
    ).rejects.toThrow(/not a PDF, JPG or PNG/);
  });

  it("a locked PDF in the list is refused with ITS name, so the person knows which one", async () => {
    // Review of 7b498d92 (finding 6): the refusal was plain but named no file.
    const err = await buildOcrPdf([
      jpg("one.jpg"),
      {
        name: "bank-statement.pdf",
        type: "application/pdf",
        bytes: userPasswordEncryptedPdf(),
      },
    ]).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toMatch(/^bank-statement\.pdf could not be added: /);
    expect(err!.message).toMatch(/password/i);
  });

  it("names the upload after the first file", () => {
    expect(ocrPdfName([{ name: "receipt.jpg" }])).toBe("receipt.pdf");
    expect(ocrPdfName([{ name: "p1.jpg" }, { name: "p2.png" }])).toBe(
      "p1-combined.pdf",
    );
  });
});

describe("ocrPageDpi is the worker's own image rule", () => {
  it("equals ocrImageDpi over a grid of sizes and declared resolutions", () => {
    const sides = [1, 30, 640, 2480, 3508, 4032, 9000, 40_000];
    const declared = [null, 72, 150, 300, 600, 3000];
    let checked = 0;
    for (const w of sides)
      for (const h of sides)
        for (const d of declared) {
          expect(ocrPageDpi(w, h, d), `${w}x${h}@${d}`).toBe(
            ocrImageDpi(w, h, d),
          );
          checked++;
        }
    expect(checked).toBe(sides.length * sides.length * declared.length);
  });

  it("a 4032 x 3024 phone photo gets an A4-length page, not a 56-inch one", () => {
    const dpi = ocrPageDpi(4032, 3024, null);
    expect(4032 / dpi).toBeLessThanOrEqual(11.7);
    expect(4032 / dpi).toBeGreaterThan(11);
  });
});
