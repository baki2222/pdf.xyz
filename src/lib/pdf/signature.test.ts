import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { PdfEngineError } from "./engine";
import {
  fontSizeForWidth,
  placeSignatureBox,
  signatureOutputName,
  signPdf,
  validateSignature,
} from "./signature";

async function blankPdf(
  pages: number,
  size: [number, number] = [600, 800],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage(size);
  return doc.save();
}

// A minimal, valid 1×1 transparent PNG (base64) used to exercise the image path.
const PNG_1x1 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

describe("placeSignatureBox", () => {
  const page = { pageWidth: 600, pageHeight: 800 };

  it("pins to each corner with the margin", () => {
    expect(
      placeSignatureBox({
        ...page,
        boxWidth: 200,
        boxHeight: 80,
        h: "left",
        v: "bottom",
        margin: 24,
      }),
    ).toEqual({ x: 24, y: 24 });
    expect(
      placeSignatureBox({
        ...page,
        boxWidth: 200,
        boxHeight: 80,
        h: "right",
        v: "top",
        margin: 24,
      }),
    ).toEqual({ x: 600 - 24 - 200, y: 800 - 24 - 80 });
  });

  it("centers on the middle-center anchor", () => {
    expect(
      placeSignatureBox({
        ...page,
        boxWidth: 200,
        boxHeight: 80,
        h: "center",
        v: "middle",
        margin: 24,
      }),
    ).toEqual({ x: 200, y: 360 });
  });
});

describe("fontSizeForWidth", () => {
  it("scales a unit width to the target, clamped to a legible range", () => {
    expect(fontSizeForWidth(10, 200)).toBe(20);
    expect(fontSizeForWidth(10, 100000)).toBe(96);
    expect(fontSizeForWidth(0, 200)).toBe(8);
  });
});

describe("validateSignature", () => {
  it("rejects empty typed text and empty images", () => {
    expect(() =>
      validateSignature({ kind: "typed", text: "  ", style: "signature" }),
    ).toThrow(PdfEngineError);
    expect(() =>
      validateSignature({
        kind: "image",
        bytes: new Uint8Array(),
        format: "png",
      }),
    ).toThrow(PdfEngineError);
  });
});

describe("signPdf", () => {
  it("draws a typed signature and preserves the page count and metadata", async () => {
    const input = await blankPdf(2);
    const output = await signPdf(
      input,
      { kind: "typed", text: "Ada Lovelace", style: "signature" },
      { pageIndex: 1, position: "bottom-right", width: 200 },
    );
    const doc = await PDFDocument.load(output);
    expect(doc.getPageCount()).toBe(2);
    expect(output.byteLength).toBeGreaterThan(input.byteLength);
    expect(doc.getCreator()).toBe("pdf.xyz");
  });

  it("embeds a PNG signature image", async () => {
    const output = await signPdf(
      await blankPdf(1),
      { kind: "image", bytes: PNG_1x1, format: "png" },
      { pageIndex: 0, position: "bottom-left", width: 120 },
    );
    const doc = await PDFDocument.load(output);
    expect(doc.getPageCount()).toBe(1);
  });

  it("rejects an out-of-range page", async () => {
    await expect(
      signPdf(
        await blankPdf(1),
        { kind: "typed", text: "x", style: "print" },
        { pageIndex: 5, position: "bottom-right", width: 200 },
      ),
    ).rejects.toThrow(/page that exists/i);
  });

  it("rejects unreadable (non-PNG) image bytes", async () => {
    await expect(
      signPdf(
        await blankPdf(1),
        {
          kind: "image",
          bytes: Uint8Array.from([1, 2, 3, 4]),
          format: "png",
        },
        { pageIndex: 0, position: "bottom-left", width: 120 },
      ),
    ).rejects.toThrow(PdfEngineError);
  });

  it("names the download from the source", () => {
    expect(signatureOutputName("contract.pdf")).toBe("contract-signed.pdf");
  });
});
