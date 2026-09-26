import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
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
    expect(
      isImageAllowedForKind("png", { name: "a.webp", type: "image/webp" }),
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
    const webp = new Uint8Array([
      ...Buffer.from("RIFF"),
      0x1a,
      0,
      0,
      0,
      ...Buffer.from("WEBPVP8 "),
      0,
      0,
    ]);
    await expect(
      imagesToPdf("png", [{ name: "pic.png", type: "image/png", bytes: webp }]),
    ).rejects.toThrow(/"pic\.png" is a WebP image/);
  });

  it("names output from first image", () => {
    expect(imagePdfOutputName("png", "scan.png")).toBe("scan-pdf.pdf");
  });
});
