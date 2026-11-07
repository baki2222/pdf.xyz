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
  spliceAfterSoi,
} from "@/tests/jpeg-fixtures";
import {
  DEFAULT_IMAGE_PAGE_OPTIONS,
  PHOTO_DETAILS_CHOICES,
  PHOTO_DETAILS_LABELS,
  type ImagePageOptions,
} from "./image-page-layout";
import { readJpegOrientation } from "./jpeg-orientation";
import {
  buildImagePdf,
  imagePdfOutputName,
  imagesToPdf,
  imagesToPdfs,
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
    // The edge moved, it did not vanish: TIFF was refused here until
    // 2026-11-04 (INVERTED: tiff.ts reads it); HEIC is refused now.
    expect(
      isImageAllowedForKind("png", { name: "a.tiff", type: "image/tiff" }),
    ).toBe(true);
    expect(
      isImageAllowedForKind("png", { name: "a.heic", type: "image/heic" }),
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

/** The one image XObject's raw (DCT) bytes. */
function embeddedImageStream(doc: PDFDocument): Uint8Array {
  const streams = doc.context
    .enumerateIndirectObjects()
    .map(([, obj]) => obj)
    .filter(
      (obj): obj is PDFRawStream =>
        obj instanceof PDFRawStream &&
        obj.dict.get(PDFName.of("Subtype"))?.toString() === "/Image",
    );
  expect(streams).toHaveLength(1);
  return streams[0]!.getContents();
}

/**
 * Photo details (audit jpg-to-pdf#5, 2026-11-07). Until then every JPEG went
 * into the PDF byte for byte, Exif and GPS included, and the FAQ told users to
 * strip it elsewhere. Now the camera and location segments are removed by
 * default, losslessly (jpeg-metadata.ts), and "keep" embeds the file as before.
 */
describe("photo details", () => {
  const GPS = "GPS 23.8103N 90.4125E";
  const photo = spliceAfterSoi(
    jpegWithOrientation(6),
    new Uint8Array([0xff, 0xfe, 0, GPS.length + 2, ...Buffer.from(GPS)]),
  );
  const has = (bytes: Uint8Array, text: string) =>
    Buffer.from(bytes).includes(Buffer.from(text, "latin1"));
  const run = (options?: ImagePageOptions) =>
    imagesToPdf(
      "jpg",
      [{ name: "phone.jpg", type: "image/jpeg", bytes: photo }],
      options,
    );

  it("health check: the photo carries Exif and the GPS text", () => {
    expect(has(photo, "Exif")).toBe(true);
    expect(has(photo, GPS)).toBe(true);
  });

  it("are removed by default, and the photo is still drawn upright", async () => {
    expect(DEFAULT_IMAGE_PAGE_OPTIONS.photoDetails).toBe("remove");
    const pdf = await run();
    const embedded = embeddedImageStream(await PDFDocument.load(pdf));
    expect(has(embedded, "Exif")).toBe(false);
    expect(has(embedded, GPS)).toBe(false);
    expect(has(pdf, GPS)).toBe(false);
    const [drawn] = await drawnImages(pdf);
    expect([drawn!.width, drawn!.height]).toEqual([JPEG_WIDTH, JPEG_HEIGHT]);
    expect(placementMismatches(drawn!, 6)).toEqual([]);
  });

  it("the page says what the default does, in the runner's words", async () => {
    const page = (await import("@/lib/tools/content/jpg-to-pdf")).default;
    const answer = page.faqs.find((f) => /metadata/.test(f.q))!.a;
    const label = (id: string) =>
      PHOTO_DETAILS_CHOICES.find((c) => c.id === id)!.label;
    const chosen = label(DEFAULT_IMAGE_PAGE_OPTIONS.photoDetails!);
    expect(answer).toContain(
      `Under ${PHOTO_DETAILS_LABELS.heading}, ${chosen} is chosen`,
    );
    expect(answer).toContain(`Choose ${label("keep")} to put each JPEG`);
    // The default named is the one that removes them.
    expect(chosen).toBe(label("remove"));
  });

  it("are kept, byte for byte, when the user keeps them", async () => {
    const pdf = await run({
      ...DEFAULT_IMAGE_PAGE_OPTIONS,
      photoDetails: "keep",
    });
    const embedded = embeddedImageStream(await PDFDocument.load(pdf));
    expect(embedded.length).toBe(photo.length);
    expect(has(embedded, GPS)).toBe(true);
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
    // else about the stream changes. Since 2026-11-07 this holds with photo
    // details KEPT; by default the Exif block is removed altogether (below).
    const input = jpegWithOrientation(6, { bigEndian: true });
    const pdf = await imagesToPdf(
      "jpg",
      [{ name: "phone.jpg", type: "image/jpeg", bytes: input }],
      { ...DEFAULT_IMAGE_PAGE_OPTIONS, photoDetails: "keep" },
    );
    const embedded = embeddedImageStream(await PDFDocument.load(pdf));
    expect(embedded.length).toBe(input.length);
    expect(readJpegOrientation(embedded)).toBe(1);
    const changed = [...embedded.keys()].filter(
      (i) => embedded[i] !== input[i],
    );
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.length).toBeLessThanOrEqual(2);
  });
});

/**
 * HISTORY (audit #49, 2026-11-06): every PDF these tools made had the Title
 * `${kind.toUpperCase()} images` — "JPG images" on holiday-pdf.pdf, "PNG
 * images" on a PDF of TIFFs — and viewers that show the Title instead of the
 * file name (Chrome's tab, Acrobat with DisplayDocTitle) showed that. The
 * Title is now the image's own name, as the download's name is.
 */
describe("image-to-pdf — the PDF's Title (audit #49)", () => {
  const titleOf = async (bytes: Uint8Array) =>
    (await PDFDocument.load(bytes)).getTitle();

  it("one PDF is titled after its first image, on both tools", async () => {
    for (const kind of ["jpg", "png"] as const) {
      const pdf = await imagesToPdf(kind, [
        { name: "holiday.jpg", type: "image/jpeg", bytes: JPG_1X1 },
        { name: "beach.png", type: "image/png", bytes: PNG_1X1 },
      ]);
      expect(await titleOf(pdf), kind).toBe("holiday");
    }
  });

  it("each per-image PDF is titled after its own image", async () => {
    const pdfs = await imagesToPdfs("png", [
      { name: "a.png", type: "image/png", bytes: PNG_1X1 },
      { name: "b.final.jpg", type: "image/jpeg", bytes: JPG_1X1 },
    ]);
    expect(await Promise.all(pdfs.map((p) => titleOf(p.bytes)))).toEqual([
      "a",
      "b.final",
    ]);
  });

  it("the size-limit builder titles its PDF the same way", async () => {
    const pdf = await buildImagePdf(
      "jpg",
      [{ name: "scan.jpeg", type: "image/jpeg", bytes: JPG_1X1 }],
      { pageSize: "letter", orientation: "portrait", margin: "small" },
    );
    expect(await titleOf(pdf)).toBe("scan");
  });
});
