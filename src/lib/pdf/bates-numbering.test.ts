// @native-canvas
/**
 * Bates numbering in Add Page Numbers: a `{n:W}` width token pads the number
 * with leading zeros, and the runner's Bates style builds a prefix + padded
 * number template from it.
 *
 * Read back the way a reader receives it: pdf.js's text layer over the SAVED
 * file, never the template the engine was handed. Until 2026-10-30 the tool
 * page said fixed-width numbers were "not available", and `{n:6}` was drawn
 * literally — the positive control below is that shape.
 */
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { PdfEngineError } from "./engine";
import {
  addPageNumbers,
  batesFormat,
  BATES_MAX_DIGITS,
  numberingPlan,
  previewPageNumber,
  validatePageNumberFormat,
} from "./page-numbers";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";
import { toolFacts } from "@/lib/tools/tool-facts";
import content from "@/lib/tools/content/page-numbers";

async function blankPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([400, 500]);
  return doc.save();
}

/** Every page's extractable text, as pdf.js reads it from the saved bytes. */
async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    disableFontFace: true,
    ...PDFJS_DOCUMENT_DEFAULTS,
  });
  try {
    const doc = await task.promise;
    const out: string[] = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const content = await (await doc.getPage(i)).getTextContent();
      out.push(
        content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join("")
          .trim(),
      );
    }
    return out;
  } finally {
    await task.destroy();
  }
}

describe("zero-padded page numbers", () => {
  it("pads {n:W} and {total:W} to W digits", () => {
    expect(previewPageNumber("{n:6}", 42, 99)).toBe("000042");
    expect(previewPageNumber("ACME-{n:6}", 1, 3)).toBe("ACME-000001");
    expect(previewPageNumber("{page:3} of {pages:3}", 7, 12)).toBe(
      "007 of 012",
    );
    // Case-insensitive, like the plain tokens.
    expect(previewPageNumber("{N:4}", 5, 5)).toBe("0005");
  });

  it("prints a number wider than W in full, never truncated", () => {
    expect(previewPageNumber("{n:2}", 1234, 1234)).toBe("1234");
  });

  it("leaves the plain tokens as they were", () => {
    expect(previewPageNumber("Page {n} of {total}", 3, 9)).toBe("Page 3 of 9");
  });

  it("refuses a width outside 1 to the maximum, in plain words", () => {
    for (const bad of ["{n:0}", `{n:${BATES_MAX_DIGITS + 1}}`, "X-{total:00}"])
      expect(() => validatePageNumberFormat(bad), bad).toThrow(PdfEngineError);
    expect(() => validatePageNumberFormat("{n:0}")).toThrow(
      `Pick a width from 1 to ${BATES_MAX_DIGITS} digits`,
    );
    // The edges themselves are fine.
    expect(() => validatePageNumberFormat("{n:1}")).not.toThrow();
    expect(() =>
      validatePageNumberFormat(`{n:${BATES_MAX_DIGITS}}`),
    ).not.toThrow();
  });

  it("builds the Bates style's template from a prefix and a digit count", () => {
    expect(batesFormat("ACME-", 6)).toBe("ACME-{n:6}");
    expect(previewPageNumber(batesFormat("ACME-", 6), 1, 3)).toBe(
      "ACME-000001",
    );
    // A blank prefix is just the padded number.
    expect(batesFormat("", 4)).toBe("{n:4}");
  });
});

describe("Bates numbers in the saved file", () => {
  it("draws ACME-000001.. as extractable text, continuing from First number", async () => {
    const out = await addPageNumbers(await blankPdf(3), {
      format: batesFormat("ACME-", 6),
      startAt: 1,
    });
    expect(await pageTexts(out)).toEqual([
      "ACME-000001",
      "ACME-000002",
      "ACME-000003",
    ]);

    const next = await addPageNumbers(await blankPdf(2), {
      format: batesFormat("ACME-", 6),
      startAt: 124,
    });
    expect(await pageTexts(next)).toEqual(["ACME-000124", "ACME-000125"]);
  });

  it("positive control: the literal, unpadded shapes are told apart", async () => {
    // What the tool drew before the width token existed: the braces verbatim.
    // And the plain {n} prefix template the old FAQ recommended. Neither can
    // pass the assertion above.
    const literal = await pageTexts(
      await addPageNumbers(await blankPdf(1), { format: "ACME-{n}" }),
    );
    expect(literal).toEqual(["ACME-1"]);
    expect(literal).not.toEqual(["ACME-000001"]);
  });

  it("the plan is unchanged by the width token", () => {
    expect(numberingPlan(3, { startAt: 1 }).total).toBe(3);
  });
});

describe("the page's Bates claims are the engine's output", () => {
  const example = previewPageNumber(batesFormat("ACME-", 6), 1, 1);

  it("the Bates fact quotes what the style draws for ACME- and 6 digits", () => {
    const fact = toolFacts("page-numbers").find(
      (f) => f.label === "Bates numbering",
    );
    expect(fact, "page-numbers no longer states its Bates fact").toBeDefined();
    expect(example).toBe("ACME-000001");
    expect(fact!.value).toContain(example);
  });

  it("the FAQ no longer says fixed-width numbers are unavailable, and shows one", () => {
    const faq = content.faqs.find((f) => /bates/i.test(f.q));
    expect(faq, "the Bates FAQ is gone").toBeDefined();
    // HISTORY: until 2026-10-30 this answer read "Numbers are printed without
    // leading zeros, though, so a fixed-width style like 000123 is not
    // available." — true then, and the defect this test now pins absent.
    expect(faq!.a).not.toMatch(/not available|without leading zeros/i);
    expect(faq!.a).toContain(example);
  });
});
