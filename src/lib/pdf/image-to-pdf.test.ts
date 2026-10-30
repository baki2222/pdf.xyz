import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { boxOf, drawnImages } from "@/tests/drawn-images";
import { placementMismatches } from "@/tests/exif-display";
import {
  JPEG_30X20,
  JPEG_30X20_EXIF6,
  JPEG_HEIGHT,
  JPEG_WIDTH,
  jpegWithOrientation,
} from "@/tests/jpeg-fixtures";
import { readJpegOrientation } from "./jpeg-orientation";
import {
  imagePdfOutputName,
  imagesToPdf,
  isImageAllowedForKind,
  validateImagePdfInputs,
} from "./image-to-pdf";

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

describe("image-to-pdf", () => {
  it("classifies images by requested kind", () => {
    expect(isImageAllowedForKind("jpg", { name: "a.jpeg", type: "" })).toBe(
      true,
    );
    expect(
      isImageAllowedForKind("png", { name: "a.png", type: "image/png" }),
    ).toBe(true);
    // INVERTED. This used to assert `false`: JPG to PDF refused PNGs (and PNG
    // to PDF refused JPGs) although the engine can embed both — so a mixed
    // workspace batch was silently cut down to one format. Both tools now take
    // both formats and pick the decoder from the file's bytes.
    expect(
      isImageAllowedForKind("jpg", { name: "a.png", type: "image/png" }),
    ).toBe(true);
    expect(
      isImageAllowedForKind("png", { name: "a.jpg", type: "image/jpeg" }),
    ).toBe(true);
    // INVERTED 2026-10-30: this asserted `false` while no browser decode
    // existed; WebP is now decoded and re-encoded (image-formats.test.ts).
    expect(
      isImageAllowedForKind("png", { name: "a.webp", type: "image/webp" }),
    ).toBe(true);
    // The edge moved, it did not vanish: TIFF is still refused.
    expect(
      isImageAllowedForKind("png", { name: "a.tiff", type: "image/tiff" }),
    ).toBe(false);
  });

  it("rejects empty input", () => {
    expect(() => validateImagePdfInputs("png", [])).toThrow(
      /Add at least one PNG/,
    );
  });

  it("creates a one-page PNG PDF", async () => {
    const bytes = await imagesToPdf("png", [
      { name: "pixel.png", type: "image/png", bytes: PNG_1X1 },
    ]);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
  });

  it("creates a one-page JPG PDF", async () => {
    const bytes = await imagesToPdf("jpg", [
      { name: "pixel.jpg", type: "image/jpeg", bytes: JPG_1X1 },
    ]);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
  });

  it("embeds a mixed PNG + JPG batch on BOTH tools, one page per image", async () => {
    for (const kind of ["png", "jpg"] as const) {
      const bytes = await imagesToPdf(kind, [
        { name: "shot.png", type: "image/png", bytes: PNG_1X1 },
        { name: "photo.jpg", type: "image/jpeg", bytes: JPG_1X1 },
      ]);
      expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
    }
  });

  it("decodes by the bytes, not the name: a .png that is really a JPEG embeds", async () => {
    const bytes = await imagesToPdf("png", [
      { name: "saved-from-web.png", type: "image/png", bytes: JPG_1X1 },
    ]);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("names the real format of a file it cannot embed", async () => {
    // HISTORY: the bytes here were a WebP until 2026-10-30, when WebP became
    // a format the tool converts. A HEIC named .png is the same shape now.
    const heic = new Uint8Array([
      0,
      0,
      0,
      0x18,
      ...Buffer.from("ftypheic"),
      0,
      0,
      0,
      0,
    ]);
    await expect(
      imagesToPdf("png", [{ name: "pic.png", type: "image/png", bytes: heic }]),
    ).rejects.toThrow(/"pic\.png" is a HEIC image/);
  });

  it("names output from first image", () => {
    expect(imagePdfOutputName("png", "scan.png")).toBe("scan-pdf.pdf");
  });
});

/**
 * A phone photo comes out the way the browser showed it.
 *
 * Portrait phone shots are stored as landscape pixels plus EXIF Orientation
 * (6 or 8). The runner's preview is an `<img>`, which honours the tag; the
 * engine embedded the raw DCT stream and drew it at its stored size, so every
 * portrait photo landed in the PDF on its side, fitted as a landscape.
 * Measured before the fix: libvips' Orientation-6 fixture below was drawn
 * with CTM [30 0 0 20 291 386] — a 30×20 landscape box, no turn — where the
 * browser shows a 20×30 portrait.
 *
 * Read from the saved file (the CTM in force at `Do`) and compared with what a
 * browser shows, built from pixel-grid turns in `exif-display.ts`.
 */
describe("EXIF Orientation reaches the page", () => {
  const ORIENTATIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

  const convert = async (bytes: Uint8Array) => {
    const pdf = await imagesToPdf("jpg", [
      { name: "phone.jpg", type: "image/jpeg", bytes },
    ]);
    const drawn = await drawnImages(pdf);
    expect(drawn).toHaveLength(1);
    const doc = await PDFDocument.load(pdf);
    return { drawn: drawn[0]!, page: doc.getPage(0).getSize(), pdf };
  };

  it("draws every orientation upright, in both byte orders", async () => {
    for (const o of ORIENTATIONS) {
      for (const bigEndian of [false, true]) {
        const { drawn, page } = await convert(
          jpegWithOrientation(o, { bigEndian }),
        );
        // The stored pixels are embedded untouched: no re-encode.
        expect([drawn.width, drawn.height]).toEqual([JPEG_WIDTH, JPEG_HEIGHT]);
        expect(placementMismatches(drawn, o)).toEqual([]);
        // …and the upright image is still centred on the page, inside it.
        const box = boxOf(drawn.ctm);
        expect((box.x0 + box.x1) / 2).toBeCloseTo(page.width / 2, 6);
        expect((box.y0 + box.y1) / 2).toBeCloseTo(page.height / 2, 6);
        expect(box.x0).toBeGreaterThan(0);
        expect(box.y0).toBeGreaterThan(0);
        expect(box.x1).toBeLessThan(page.width);
        expect(box.y1).toBeLessThan(page.height);
      }
    }
  });

  it("a real writer's Orientation 6 comes out portrait", async () => {
    const { drawn } = await convert(JPEG_30X20_EXIF6);
    const box = boxOf(drawn.ctm);
    expect(box.y1 - box.y0).toBeGreaterThan(box.x1 - box.x0);
    expect(placementMismatches(drawn, 6)).toEqual([]);
  });

  it("the turn is at the SAME scale an upright copy of the photo gets", async () => {
    // Fitting must use the displayed shape. A 30×20 photo turned upright is a
    // 20×30 image, so its box is the box a stored 20×30 image would get: the
    // same size, never a landscape box turned on its end.
    const turned = boxOf((await convert(jpegWithOrientation(6))).drawn.ctm);
    const plain = boxOf((await convert(jpegWithOrientation(1))).drawn.ctm);
    expect(turned.x1 - turned.x0).toBeCloseTo(
      ((plain.x1 - plain.x0) * JPEG_HEIGHT) / JPEG_WIDTH,
      6,
    );
    expect(turned.y1 - turned.y0).toBeCloseTo(
      ((plain.y1 - plain.y0) * JPEG_WIDTH) / JPEG_HEIGHT,
      6,
    );
  });

  it("orientation 1 is drawn exactly as before: no turn, no mirror", async () => {
    for (const bytes of [JPEG_30X20, jpegWithOrientation(1)]) {
      const { drawn } = await convert(bytes);
      const [a, b, c, d] = drawn.ctm;
      expect([b, c]).toEqual([0, 0]);
      expect(a).toBeGreaterThan(0);
      expect(d).toBeGreaterThan(0);
    }
  });

  it("the embedded stream no longer asks a viewer to turn it again", async () => {
    // Once the page turns the photo, a viewer that also honoured EXIF inside
    // the DCT stream would turn it twice. The tag is rewritten to 1; nothing
    // else about the stream changes.
    const input = jpegWithOrientation(6, { bigEndian: true });
    const { pdf } = await convert(input);
    const doc = await PDFDocument.load(pdf);
    const streams = doc.context
      .enumerateIndirectObjects()
      .map(([, obj]) => obj)
      .filter(
        (obj): obj is PDFRawStream =>
          obj instanceof PDFRawStream &&
          obj.dict.get(PDFName.of("Subtype"))?.toString() === "/Image",
      );
    expect(streams).toHaveLength(1);
    const embedded = streams[0]!.getContents();
    expect(embedded.length).toBe(input.length);
    expect(readJpegOrientation(embedded)).toBe(1);
    const changed = [...embedded.keys()].filter(
      (i) => embedded[i] !== input[i],
    );
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.length).toBeLessThanOrEqual(2);
  });
});
