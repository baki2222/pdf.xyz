import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { boxOf, drawnImages } from "@/tests/drawn-images";
import {
  DEFAULT_IMAGE_PAGE_OPTIONS,
  IMAGE_MARGINS,
  IMAGE_PAGE_SIZES,
  MAX_PAGE_SIDE_PT,
  imagePageLayout,
  type ImagePageOptions,
} from "./image-page-layout";
import { IMAGE_PAGE_MARGIN_PT, US_LETTER_PT } from "./page-geometry";
import { imagesToPdf, imagesToPdfs, perImageZipName } from "./image-to-pdf";
import { zipFiles } from "./browser";

const JPG_1X1 = Uint8Array.from(
  Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Ap//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEP/EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EFBABAQAAAAAAAAAAAAAAAAAAARD/2gAIAQEAAT8Qf//Z",
    "base64",
  ),
);

/** A JPEG whose SOF0 declares `width`×`height` (pdf-lib sizes from it). */
function jpegOfSize(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(JPG_1X1);
  for (let i = 0; i < bytes.length - 8; i += 1) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xc0) {
      bytes[i + 5] = height >> 8;
      bytes[i + 6] = height & 0xff;
      bytes[i + 7] = width >> 8;
      bytes[i + 8] = width & 0xff;
      return bytes;
    }
  }
  throw new Error("fixture has no SOF0 marker");
}

const opts = (o: Partial<ImagePageOptions>): ImagePageOptions => ({
  ...DEFAULT_IMAGE_PAGE_OPTIONS,
  ...o,
});

const A4 = IMAGE_PAGE_SIZES.find((s) => s.id === "a4")!.size!;

describe("image page layout — the math", () => {
  it("the defaults are the old fixed layout: Letter, portrait, 36pt", () => {
    const l = imagePageLayout(4000, 2000);
    expect([l.pageWidth, l.pageHeight]).toEqual([
      US_LETTER_PT.width,
      US_LETTER_PT.height,
    ]);
    // A wide photo spans the width between the margins.
    expect(l.x).toBeCloseTo(IMAGE_PAGE_MARGIN_PT, 6);
    expect(l.width).toBeCloseTo(US_LETTER_PT.width - 72, 6);
    expect(l.height / l.width).toBeCloseTo(0.5, 6);
  });

  it("the ISO sizes are the published millimetre sizes", () => {
    const pt = (mm: number) => (mm * 72) / 25.4;
    const sizes = Object.fromEntries(
      IMAGE_PAGE_SIZES.filter((s) => s.size).map((s) => [s.id, s.size!]),
    );
    expect(sizes.a4!.width).toBeCloseTo(pt(210), 1);
    expect(sizes.a4!.height).toBeCloseTo(pt(297), 1);
    expect(sizes.a3!.height).toBeCloseTo(pt(420), 1);
    expect(sizes.a5!.width).toBeCloseTo(pt(148), 1);
    expect(sizes.legal).toEqual({ width: 612, height: 1008 });
  });

  it("auto orientation turns the page for a wide image only", () => {
    const wide = imagePageLayout(
      3000,
      2000,
      opts({ pageSize: "a4", orientation: "auto" }),
    );
    expect([wide.pageWidth, wide.pageHeight]).toEqual([A4.height, A4.width]);
    const tall = imagePageLayout(
      2000,
      3000,
      opts({ pageSize: "a4", orientation: "auto" }),
    );
    expect([tall.pageWidth, tall.pageHeight]).toEqual([A4.width, A4.height]);
    const square = imagePageLayout(
      500,
      500,
      opts({ pageSize: "a4", orientation: "auto" }),
    );
    expect(square.pageHeight).toBeGreaterThan(square.pageWidth);
  });

  it("portrait and landscape are forced whatever the image's shape", () => {
    const p = imagePageLayout(
      3000,
      2000,
      opts({ pageSize: "a4", orientation: "portrait" }),
    );
    expect(p.pageHeight).toBeGreaterThan(p.pageWidth);
    const l = imagePageLayout(
      2000,
      3000,
      opts({ pageSize: "a4", orientation: "landscape" }),
    );
    expect(l.pageWidth).toBeGreaterThan(l.pageHeight);
  });

  it.each(IMAGE_MARGINS)(
    "margin $label: the image sits inside it, centred",
    ({ id, points }) => {
      for (const [w, h] of [
        [5000, 1000],
        [1000, 5000],
      ] as const) {
        const l = imagePageLayout(w, h, opts({ pageSize: "a4", margin: id }));
        // The binding side touches the margin exactly; the other is centred.
        expect(Math.min(l.x, l.y)).toBeCloseTo(points, 6);
        expect(l.x + l.width + l.x).toBeCloseTo(l.pageWidth, 6);
        expect(l.y + l.height + l.y).toBeCloseTo(l.pageHeight, 6);
        expect(l.width / l.height).toBeCloseTo(w / h, 6);
      }
    },
  );

  it("a small image is never enlarged, on any page size", () => {
    for (const size of IMAGE_PAGE_SIZES) {
      const l = imagePageLayout(
        30,
        20,
        opts({ pageSize: size.id, margin: "none" }),
      );
      expect([l.width, l.height], size.id).toEqual([30, 20]);
    }
  });

  it("fit to image: the page is the image plus the margin, whatever the orientation", () => {
    for (const orientation of ["auto", "portrait", "landscape"] as const) {
      const l = imagePageLayout(
        800,
        600,
        opts({ pageSize: "fit", margin: "small", orientation }),
      );
      expect([l.pageWidth, l.pageHeight]).toEqual([836, 636]);
      expect([l.x, l.y, l.width, l.height]).toEqual([18, 18, 800, 600]);
    }
    const bare = imagePageLayout(
      800,
      600,
      opts({ pageSize: "fit", margin: "none" }),
    );
    expect([bare.pageWidth, bare.pageHeight]).toEqual([800, 600]);
  });

  it("fit to image never makes a page larger than PDF allows", () => {
    const l = imagePageLayout(
      30000,
      1000,
      opts({ pageSize: "fit", margin: "none" }),
    );
    expect(l.pageWidth).toBeLessThanOrEqual(MAX_PAGE_SIDE_PT);
    expect(l.width / l.height).toBeCloseTo(30, 6);
  });
});

describe("image to PDF — the options reach the output", () => {
  const file = (name: string, w: number, h: number) => ({
    name,
    type: "image/jpeg",
    bytes: jpegOfSize(w, h),
  });

  it("no options: byte-for-byte the layout it always drew", async () => {
    const before = await imagesToPdf("jpg", [file("a.jpg", 4000, 2000)]);
    const explicit = await imagesToPdf(
      "jpg",
      [file("a.jpg", 4000, 2000)],
      DEFAULT_IMAGE_PAGE_OPTIONS,
    );
    const [a] = await drawnImages(before);
    const [b] = await drawnImages(explicit);
    expect(a!.ctm).toEqual(b!.ctm);
    const doc = await PDFDocument.load(before);
    expect(doc.getPage(0).getSize()).toEqual(US_LETTER_PT);
  });

  it("A4 landscape, small margin: the page and the drawn box", async () => {
    const pdf = await imagesToPdf("jpg", [file("a.jpg", 4000, 2000)], {
      pageSize: "a4",
      orientation: "landscape",
      margin: "small",
    });
    const doc = await PDFDocument.load(pdf);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(A4.height, 1);
    expect(height).toBeCloseTo(A4.width, 1);
    const box = boxOf((await drawnImages(pdf))[0]!.ctm);
    expect(box.x0).toBeCloseTo(18, 1);
    expect(width - box.x1).toBeCloseTo(18, 1);
  });

  it("fit to image: each page takes its own image's size", async () => {
    const pdf = await imagesToPdf(
      "jpg",
      [file("a.jpg", 300, 200), file("b.jpg", 100, 400)],
      { pageSize: "fit", orientation: "auto", margin: "none" },
    );
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPages().map((p) => p.getSize())).toEqual([
      { width: 300, height: 200 },
      { width: 100, height: 400 },
    ]);
  });

  it("one PDF per image: N one-page PDFs, distinct names, options applied", async () => {
    const outputs = await imagesToPdfs(
      "jpg",
      [file("a.jpg", 300, 200), file("b.jpg", 100, 400), file("a.png", 50, 50)],
      { pageSize: "a5", orientation: "auto", margin: "none" },
    );
    expect(outputs.map((o) => o.name)).toEqual(["a.pdf", "b.pdf", "a-2.pdf"]);
    for (const out of outputs) {
      const doc = await PDFDocument.load(out.bytes);
      expect(doc.getPageCount()).toBe(1);
      const { width, height } = doc.getPage(0).getSize();
      expect(Math.min(width, height)).toBeCloseTo(419.53, 1);
    }
    // Each holds ITS image: the second is tall, so its A5 page is portrait.
    const second = await PDFDocument.load(outputs[1]!.bytes);
    expect(second.getPage(0).getHeight()).toBeGreaterThan(
      second.getPage(0).getWidth(),
    );
    const first = await PDFDocument.load(outputs[0]!.bytes);
    expect(first.getPage(0).getWidth()).toBeGreaterThan(
      first.getPage(0).getHeight(),
    );
  });

  it("one PDF per image: the ZIP holds every PDF under its name", async () => {
    const outputs = await imagesToPdfs("png", [
      file("x.jpg", 30, 20),
      file("y.jpg", 20, 30),
    ]);
    const blob = await zipFiles(outputs);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual(["x.pdf", "y.pdf"]);
    for (const name of names) {
      const bytes = await zip.file(name)!.async("uint8array");
      expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    }
    expect(perImageZipName("png", "x.jpg")).toBe("x-pdfs.zip");
    expect(perImageZipName("png")).toBe("png-images-pdfs.zip");
  });
});
