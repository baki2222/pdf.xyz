import { describe, expect, it } from "vitest";
import { eligibleFilesFor, handoffCapabilityFor } from "./capability";

describe("handoffCapabilityFor", () => {
  it("maps merge to collect, compress to batch", () => {
    expect(handoffCapabilityFor("merge-pdf")).toMatchObject({
      mode: "collect",
      supported: true,
      minFiles: 2,
    });
    expect(handoffCapabilityFor("compress-pdf")).toMatchObject({
      mode: "batch",
      supported: true,
      minFiles: 1,
    });
  });

  it("maps every single-file runner to single (max one file)", () => {
    for (const slug of [
      "rotate-pdf",
      "organize-pages",
      "split-pdf",
      "remove-pages",
      "extract-pages",
    ]) {
      expect(handoffCapabilityFor(slug)).toMatchObject({
        mode: "single",
        supported: true,
        maxFiles: 1,
      });
    }
  });

  it("reports unsupported for worker/AI tools and unknown slugs", () => {
    for (const slug of ["ocr-pdf", "word-to-pdf", "chat-with-pdf", "does-not-exist"]) {
      expect(handoffCapabilityFor(slug)).toMatchObject({
        mode: "none",
        supported: false,
      });
    }
  });
});

describe("eligibleFilesFor", () => {
  const pdf = { name: "a.pdf", type: "application/pdf" };
  const pdfByExt = { name: "b.PDF", type: "" };
  const png = { name: "c.png", type: "image/png" };

  it("keeps only PDFs for a supported tool", () => {
    expect(eligibleFilesFor("merge-pdf", [pdf, png, pdfByExt])).toEqual([pdf, pdfByExt]);
  });

  it("returns nothing for an unsupported tool", () => {
    expect(eligibleFilesFor("ocr-pdf", [pdf, pdfByExt])).toEqual([]);
  });
});
