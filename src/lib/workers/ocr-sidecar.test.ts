// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  SIDECAR_PAGE_BREAK,
  fillSkippedSidecarPages,
  skippedSidecarPages,
} from "./ocr-sidecar";

/** A merged OCRmyPDF sidecar: one chunk per page, form-feed separated. */
const sidecar = (...pages: string[]) => pages.join(SIDECAR_PAGE_BREAK);

describe("skippedSidecarPages", () => {
  it("finds the placeholder OCRmyPDF writes for a page it skipped", () => {
    const text = sidecar(
      "[OCR skipped on page 1]",
      "Recognized scan text\n",
      "[OCR skipped on page 3]",
    );
    expect(skippedSidecarPages(text)).toEqual([1, 3]);
  });

  it("finds nothing in a fully recognized sidecar (positive control's mirror)", () => {
    expect(skippedSidecarPages(sidecar("one", "two"))).toEqual([]);
    // A page whose recognized TEXT mentions skipping is not a placeholder.
    expect(
      skippedSidecarPages(sidecar("The form says [OCR skipped on page 1] x")),
    ).toEqual([]);
  });
});

describe("fillSkippedSidecarPages", () => {
  it("puts each skipped page's existing text where its placeholder was", () => {
    const { text, filled } = fillSkippedSidecarPages(
      sidecar("[OCR skipped on page 1]", "Scanned words\n"),
      ["Typed cover page\n", ""],
    );
    expect(filled).toEqual([1]);
    expect(text).toBe(sidecar("Typed cover page\n", "Scanned words\n"));
    expect(skippedSidecarPages(text)).toEqual([]);
  });

  it("leaves the sidecar untouched when the page counts disagree", () => {
    const original = sidecar("[OCR skipped on page 1]", "Scanned words");
    expect(fillSkippedSidecarPages(original, ["only one page"])).toEqual({
      text: original,
      filled: [],
    });
  });

  it("never moves text to a page the placeholder does not name", () => {
    // A placeholder at position 1 naming page 2 means the split is not what it
    // seems; filling it would put page 1's text in the wrong place.
    const original = sidecar("[OCR skipped on page 2]", "x");
    expect(fillSkippedSidecarPages(original, ["page one", "x"]).filled).toEqual(
      [],
    );
  });

  it("keeps the placeholder when the page has no extractable text", () => {
    const original = sidecar("[OCR skipped on page 1]");
    expect(fillSkippedSidecarPages(original, ["   \n"]).text).toBe(original);
  });

  it("accepts the plural wording variants", () => {
    for (const placeholder of [
      "[OCR skipped on pages 1]",
      "[OCR skipped on page(s) 1]",
    ]) {
      expect(fillSkippedSidecarPages(placeholder, ["digital"]).text).toBe(
        "digital",
      );
    }
  });
});
