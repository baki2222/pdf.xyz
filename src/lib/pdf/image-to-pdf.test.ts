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
    expect(
      isImageAllowedForKind("jpg", { name: "a.png", type: "image/png" }),
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

  it("names output from first image", () => {
    expect(imagePdfOutputName("png", "scan.png")).toBe("scan-pdf.pdf");
  });
});
