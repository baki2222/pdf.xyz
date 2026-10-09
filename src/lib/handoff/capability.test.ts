import { describe, expect, it } from "vitest";
import { eligibleFilesFor, handoffCapabilityFor } from "./capability";

describe("handoffCapabilityFor", () => {
  it("maps merge to collect, compress and image-to-pdf to batch", () => {
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
    expect(handoffCapabilityFor("jpg-to-pdf")).toMatchObject({
      mode: "batch",
      supported: true,
      minFiles: 1,
    });
    expect(handoffCapabilityFor("compare-pdf")).toMatchObject({
      mode: "collect",
      supported: true,
      minFiles: 2,
    });
  });

  it("maps every single-file runner to single (max one file)", () => {
    for (const slug of [
      "rotate-pdf",
      "organize-pages",
      "split-pdf",
      "remove-pages",
      "extract-pages",
      "pdf-to-text",
      "pdf-to-markdown",
      "text-to-pdf",
      "markdown-to-pdf",
      "pdf-to-jpg",
      "pdf-to-png",
      "page-numbers",
      "watermark-pdf",
      "header-footer",
      "crop-pdf",
      "sign-pdf",
      "flatten-pdf",
      "overlay-pdf",
      "grayscale-pdf",
      "redact-pdf",
      "fill-forms",
      "create-forms",
      "annotate-pdf",
      "edit-pdf",
      "extract-images",
    ]) {
      expect(handoffCapabilityFor(slug)).toMatchObject({
        mode: "single",
        supported: true,
        maxFiles: 1,
      });
    }
  });

  it("reports unsupported for worker/AI tools and unknown slugs", () => {
    for (const slug of [
      "ocr-pdf",
      "word-to-pdf",
      "chat-with-pdf",
      "does-not-exist",
    ]) {
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

  it("keeps only PDFs for a supported PDF tool", () => {
    expect(eligibleFilesFor("merge-pdf", [pdf, png, pdfByExt])).toEqual([
      pdf,
      pdfByExt,
    ]);
  });

  it("keeps only PDFs for the PDF-to-image tools", () => {
    expect(eligibleFilesFor("pdf-to-jpg", [pdf, png, pdfByExt])).toEqual([
      pdf,
      pdfByExt,
    ]);
    expect(eligibleFilesFor("pdf-to-png", [pdf, png, pdfByExt])).toEqual([
      pdf,
      pdfByExt,
    ]);
  });

  it("keeps only text files for text-to-pdf", () => {
    const txt = { name: "notes.txt", type: "text/plain" };
    const textByExt = { name: "readme.TEXT", type: "" };
    expect(eligibleFilesFor("text-to-pdf", [pdf, txt, png, textByExt])).toEqual(
      [txt, textByExt],
    );
  });

  it("keeps Markdown files for markdown-to-pdf", () => {
    const markdown = { name: "README.md", type: "text/markdown" };
    const markdownByExt = { name: "notes.MARKDOWN", type: "" };
    const plainMarkdown = { name: "draft.md", type: "text/plain" };
    const textButWrongExt = { name: "notes.txt", type: "text/plain" };
    expect(
      eligibleFilesFor("markdown-to-pdf", [
        pdf,
        markdown,
        png,
        markdownByExt,
        plainMarkdown,
        textButWrongExt,
      ]),
    ).toEqual([markdown, markdownByExt, plainMarkdown]);
  });

  it("keeps every PNG and JPEG for both image-to-pdf tools", () => {
    const jpg = { name: "photo.jpeg", type: "image/jpeg" };
    const jpgByExt = { name: "scan.JPG", type: "" };
    const webp = { name: "pic.webp", type: "image/webp" };
    // INVERTED. JPG to PDF used to keep only JPEGs and PNG to PDF only PNGs, so
    // "Turn your 5 images into a PDF" handed a mixed set to a tool that
    // silently dropped the other format. Both engines embed both now.
    expect(
      eligibleFilesFor("jpg-to-pdf", [pdf, jpg, jpgByExt, png, webp]),
    ).toEqual([jpg, jpgByExt, png]);
    expect(eligibleFilesFor("png-to-pdf", [pdf, jpg, png, webp])).toEqual([
      jpg,
      png,
    ]);
  });

  it("returns nothing for an unsupported tool", () => {
    expect(eligibleFilesFor("ocr-pdf", [pdf, pdfByExt])).toEqual([]);
  });
});
