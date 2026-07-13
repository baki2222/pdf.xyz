import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { PdfEngineError } from "./engine";
import {
  checkEditImage,
  editPdf,
  editedOutputName,
  getEditPageSizes,
  sniffImageFormat,
  validateEditOps,
  type EditOp,
  type PageSize,
} from "./edit";

/** A blank PDF with the given page sizes (points). */
async function blankPdf(sizes: [number, number][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const [w, h] of sizes) doc.addPage([w, h]);
  return doc.save();
}

// Real 1×1 fixtures that pdf-lib can decode (shared with the image-to-pdf tests).
const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  ),
);
const JPG_1X1 = Uint8Array.from(
  Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Ap//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEP/EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EFBABAQAAAAAAAAAAAAAAAAAAARD/2gAIAQEAAT8Qf//Z",
    "base64",
  ),
);

/** PNG magic bytes followed by junk: sniffs as PNG but can't be decoded. */
const BROKEN_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03,
]);

describe("editedOutputName", () => {
  it("derives the name from the source file", () => {
    expect(editedOutputName("report.pdf")).toBe("report-edited.pdf");
    expect(editedOutputName("")).toBe("document-edited.pdf");
  });
});

describe("sniffImageFormat", () => {
  it("identifies PNG and JPG by magic bytes", () => {
    expect(sniffImageFormat(PNG_1X1)).toBe("png");
    expect(sniffImageFormat(JPG_1X1)).toBe("jpg");
  });

  it("returns null for unsupported or too-short data", () => {
    expect(sniffImageFormat(new TextEncoder().encode("GIF89a..."))).toBeNull();
    expect(sniffImageFormat(Uint8Array.from([0x00, 0x01]))).toBeNull();
    expect(sniffImageFormat(new Uint8Array())).toBeNull();
  });
});

describe("checkEditImage", () => {
  it("accepts a matching, in-budget image", () => {
    expect(checkEditImage("png", PNG_1X1)).toBeNull();
    expect(checkEditImage("jpg", JPG_1X1)).toBeNull();
  });

  it("flags missing bytes", () => {
    expect(checkEditImage("png", new Uint8Array())).toBe("image-missing");
  });

  it("flags unsupported data and a format mismatch", () => {
    expect(checkEditImage("png", new TextEncoder().encode("not an image"))).toBe("image-type");
    // Real PNG bytes but declared as a JPG.
    expect(checkEditImage("jpg", PNG_1X1)).toBe("image-type");
  });
});

describe("validateEditOps", () => {
  const pages: PageSize[] = [
    { width: 612, height: 792 },
    { width: 400, height: 300 },
  ];
  const rect = (over: Partial<EditOp> = {}): EditOp =>
    ({ type: "rect", page: 1, x: 100, y: 100, width: 200, height: 50, color: "#3b82f6", ...over } as EditOp);

  it("returns no issues for a valid set across the four types", () => {
    const ops: EditOp[] = [
      { type: "text", page: 1, x: 20, y: 700, text: "Draft", color: "#111111", size: 14 },
      { type: "rect", page: 1, x: 10, y: 30, width: 100, height: 40, color: "#22c55e", filled: true },
      { type: "line", page: 2, x1: 0, y1: 0, x2: 100, y2: 80, color: "#ef4444", arrow: true },
      { type: "image", page: 2, x: 10, y: 10, width: 60, height: 60, format: "png", bytes: PNG_1X1 },
    ];
    expect(validateEditOps(ops, pages)).toEqual([]);
  });

  it("flags out-of-range and non-integer pages", () => {
    expect(validateEditOps([rect({ page: 0 })], pages)[0]?.code).toBe("page-out-of-range");
    expect(validateEditOps([rect({ page: 3 })], pages)[0]?.code).toBe("page-out-of-range");
    expect(validateEditOps([rect({ page: 1.5 })], pages)[0]?.code).toBe("page-out-of-range");
  });

  it("flags invalid colors and out-of-range opacity", () => {
    expect(validateEditOps([rect({ color: "nope" })], pages)[0]?.code).toBe("invalid-color");
    expect(validateEditOps([rect({ opacity: 2 })], pages)[0]?.code).toBe("invalid-opacity");
    expect(validateEditOps([rect({ opacity: -0.1 })], pages)[0]?.code).toBe("invalid-opacity");
  });

  it("flags non-finite, empty, and out-of-bounds rectangles", () => {
    expect(validateEditOps([rect({ x: Number.NaN })], pages)[0]?.code).toBe("invalid");
    expect(validateEditOps([rect({ width: 0 })], pages)[0]?.code).toBe("empty");
    expect(validateEditOps([rect({ x: 500, width: 200 })], pages)[0]?.code).toBe("out-of-bounds");
    expect(validateEditOps([rect({ filled: false, borderWidth: 0 })], pages)[0]?.code).toBe("invalid");
  });

  it("flags empty text, a bad size, and text off the page", () => {
    const text = (over: Partial<EditOp>): EditOp =>
      ({ type: "text", page: 1, x: 10, y: 10, text: "hi", color: "#000", ...over } as EditOp);
    expect(validateEditOps([text({ text: "   " })], pages)[0]?.code).toBe("empty");
    expect(validateEditOps([text({ size: 0 })], pages)[0]?.code).toBe("invalid");
    expect(validateEditOps([text({ x: 700 })], pages)[0]?.code).toBe("out-of-bounds");
  });

  it("flags a zero-length line and endpoints off the page", () => {
    const line = (over: Partial<EditOp>): EditOp =>
      ({ type: "line", page: 1, x1: 0, y1: 0, x2: 100, y2: 100, color: "#000", ...over } as EditOp);
    expect(validateEditOps([line({ x2: 0, y2: 0 })], pages)[0]?.code).toBe("empty");
    expect(validateEditOps([line({ x2: 900 })], pages)[0]?.code).toBe("out-of-bounds");
  });

  it("flags missing/unsupported images and image geometry", () => {
    const image = (over: Partial<EditOp>): EditOp =>
      ({ type: "image", page: 1, x: 10, y: 10, width: 60, height: 60, format: "png", bytes: PNG_1X1, ...over } as EditOp);
    expect(validateEditOps([image({ bytes: new Uint8Array() })], pages)[0]?.code).toBe("image-missing");
    expect(validateEditOps([image({ format: "jpg" })], pages)[0]?.code).toBe("image-type");
    expect(validateEditOps([image({ width: 0 })], pages)[0]?.code).toBe("empty");
    expect(validateEditOps([image({ x: 600, width: 100 })], pages)[0]?.code).toBe("out-of-bounds");
  });

  it("reports the offending index for each issue", () => {
    const issues = validateEditOps(
      [rect(), rect({ width: 0 }), rect({ page: 9 })],
      pages,
    );
    expect(issues.map((issue) => issue.index)).toEqual([1, 2]);
  });
});

describe("editPdf", () => {
  it("flattens text and shapes, preserving page count and sizes", async () => {
    const sizes: [number, number][] = [
      [612, 792],
      [400, 300],
    ];
    const base = await blankPdf(sizes);
    const ops: EditOp[] = [
      { type: "text", page: 1, x: 72, y: 700, text: "Approved — v2", color: "#111111", size: 16 },
      { type: "rect", page: 1, x: 60, y: 600, width: 240, height: 80, color: "#ffffff", filled: true },
      { type: "rect", page: 1, x: 60, y: 600, width: 240, height: 80, color: "#3b82f6", filled: false, borderWidth: 2 },
      { type: "line", page: 2, x1: 20, y1: 40, x2: 300, y2: 200, color: "#ef4444", thickness: 2, arrow: true },
    ];

    const result = await editPdf(base, ops);

    expect(result.pageCount).toBe(2);
    expect(result.opCount).toBe(4);
    expect(result.counts).toEqual({ text: 1, rect: 2, line: 1, image: 0 });
    expect(result.bytes.byteLength).toBeGreaterThan(base.byteLength);

    const out = await PDFDocument.load(result.bytes);
    expect(out.getPageCount()).toBe(2);
    expect(out.getCreator()).toBe("pdf.xyz");
    out.getPages().forEach((page, i) => {
      expect(page.getWidth()).toBeCloseTo(sizes[i]![0]);
      expect(page.getHeight()).toBeCloseTo(sizes[i]![1]);
    });
  });

  it("embeds a PNG image and preserves the page", async () => {
    const base = await blankPdf([[300, 300]]);
    const result = await editPdf(base, [
      { type: "image", page: 1, x: 40, y: 40, width: 120, height: 120, format: "png", bytes: PNG_1X1 },
    ]);
    expect(result.counts.image).toBe(1);
    expect(result.bytes.byteLength).toBeGreaterThan(base.byteLength);
    const out = await PDFDocument.load(result.bytes);
    expect(out.getPageCount()).toBe(1);
  });

  it("embeds a JPG image", async () => {
    const base = await blankPdf([[300, 300]]);
    const result = await editPdf(base, [
      { type: "image", page: 1, x: 40, y: 40, width: 120, height: 120, format: "jpg", bytes: JPG_1X1 },
    ]);
    expect(result.counts.image).toBe(1);
    const out = await PDFDocument.load(result.bytes);
    expect(out.getPageCount()).toBe(1);
  });

  it("draws text with non-WinAnsi characters without throwing", async () => {
    const base = await blankPdf([[300, 300]]);
    const result = await editPdf(base, [
      { type: "text", page: 1, x: 20, y: 150, text: "Emoji 😀 and 日本語", color: "#000000", maxWidth: 260 },
    ]);
    expect(result.counts.text).toBe(1);
    const out = await PDFDocument.load(result.bytes);
    expect(out.getPageCount()).toBe(1);
  });

  it("rejects an empty edit list", async () => {
    const base = await blankPdf([[200, 200]]);
    await expect(editPdf(base, [])).rejects.toBeInstanceOf(PdfEngineError);
  });

  it("rejects invalid edits before saving", async () => {
    const base = await blankPdf([[200, 100]]);
    await expect(
      editPdf(base, [
        { type: "rect", page: 2, x: 0, y: 0, width: 10, height: 10, color: "#000" },
      ]),
    ).rejects.toThrow(/page 2 is out of range/);
  });

  it("rejects a file that isn't a PDF", async () => {
    const notPdf = new TextEncoder().encode("this is not a pdf");
    await expect(
      editPdf(notPdf, [
        { type: "rect", page: 1, x: 0, y: 0, width: 10, height: 10, color: "#000" },
      ]),
    ).rejects.toBeInstanceOf(PdfEngineError);
  });

  it("rejects an image that passes the sniff but can't be decoded", async () => {
    const base = await blankPdf([[300, 300]]);
    await expect(
      editPdf(base, [
        { type: "image", page: 1, x: 10, y: 10, width: 50, height: 50, format: "png", bytes: BROKEN_PNG },
      ]),
    ).rejects.toBeInstanceOf(PdfEngineError);
  });
});

describe("getEditPageSizes", () => {
  it("reads each page's content-space size", async () => {
    const base = await blankPdf([
      [612, 792],
      [400, 300],
    ]);
    expect(await getEditPageSizes(base)).toEqual([
      { width: 612, height: 792 },
      { width: 400, height: 300 },
    ]);
  });
});
