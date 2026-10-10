// @vitest-environment node
// @native-canvas
/**
 * The Translate panel's pre-upload refusal, run against REAL extractions.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * The panel refused on `plan.chunks.length === 0` and always said "too long":
 *
 *   "This document has 0 characters of text, and Translate PDF can handle
 *    about 10,258 in one run … Split it into smaller files and translate them
 *    one at a time."
 *
 * That is what a SCANNED PDF was told — the most common thing people try to
 * translate — because a scan has no text pages and therefore no chunks. And a
 * single page over one pass was told to split a file whose pages translate
 * already splits between. Neither advice could work; the scan was never sent
 * to OCR, which is the one thing that would.
 *
 * NOTHING CAUGHT IT because nothing ever ran the browser extractor on a PDF
 * with no text: every translate test hands the engine a hand-built extraction,
 * and the panel had no test at all. So these fixtures are real PDFs, read by
 * the real `extractPdfText` (on pdfjs's Node build — see
 * `@/tests/pdf-text-fixtures`), and every number asserted is one the extractor
 * produced rather than one this file typed.
 */
import { describe, expect, it, vi } from "vitest";
import { imageOnlyPdf, textPdf } from "@/tests/pdf-text-fixtures";
import {
  TRANSLATE_MAX_INPUT_CHARS,
  TRANSLATE_NO_TEXT_MESSAGE,
  translateEveryPageTooLongMessage,
  translateTooLongMessage,
} from "@/lib/jobs/translate-limits";
import { DEFAULT_OCR_OUTPUT_MODE, ocrOutputsForMode } from "@/lib/jobs/ocr";
import { getToolBySlug } from "@/lib/tools";
import { translatePreflight } from "./preflight";
import { runTranslate } from "./engine";
import type { ExtractedPdfText } from "@/lib/pdf/text";

vi.mock("pdfjs-dist", async () => ({
  ...(await import("pdfjs-dist/legacy/build/pdf.mjs")),
  // `text.ts` points the worker at a URL relative to itself; the legacy
  // build's in-process fake worker needs none, so the assignment goes nowhere.
  GlobalWorkerOptions: { workerSrc: "" },
}));
const { extractPdfText } = await import("@/lib/pdf/text");

const CEILING = TRANSLATE_MAX_INPUT_CHARS;
const OLD_ZERO = /\b0 characters\b/;
const OLD_SPLIT = /Split it into smaller files/;

async function read(bytes: Uint8Array | Promise<Uint8Array>) {
  return extractPdfText(await bytes);
}

describe("the fixtures are what they claim (health checks)", () => {
  it("an image-only page really extracts to no text", async () => {
    const extracted = await read(imageOnlyPdf(2));
    expect(extracted.pageCount).toBe(2);
    expect(extracted.pages).toHaveLength(2);
    expect(extracted.hasText).toBe(false);
  });

  it("the extractor reads text where there is text (positive control)", async () => {
    const extracted = await read(textPdf([400]));
    expect(extracted.hasText).toBe(true);
    expect(extracted.characterCount).toBeGreaterThan(300);
    expect(extracted.text).toMatch(/quarterly report/);
  });

  it("an oversize fixture page really is over one pass, as extracted", async () => {
    const extracted = await read(textPdf([CEILING + 2_000]));
    expect(extracted.pages[0]!.characterCount).toBeGreaterThan(CEILING);
  });
});

describe("a PDF with no selectable text is sent to OCR, not told to split", () => {
  it("refuses a scan with the worker's own no-text sentence", async () => {
    const { refusal, textPages } = translatePreflight(
      await read(imageOnlyPdf(3)),
      CEILING,
    );
    expect(textPages).toEqual([]);
    expect(refusal).toBe(TRANSLATE_NO_TEXT_MESSAGE);
    // The inverted defect: the old refusal, word for word, must not come back.
    expect(refusal).not.toBe(translateTooLongMessage(0, CEILING));
    expect(refusal).not.toMatch(OLD_ZERO);
    expect(refusal).not.toMatch(OLD_SPLIT);
  });

  it("says the SAME sentence the worker says for the same document", async () => {
    // Composed, not compared by eye: the browser's extraction of the scan is
    // handed to the real engine, and the two refusals must be identical.
    const extracted = await read(imageOnlyPdf(1));
    const run = await runTranslate(
      new Uint8Array([1]),
      { targetLanguage: "fr", sourceLanguage: "auto" },
      {
        extract: async (): Promise<ExtractedPdfText> => extracted,
        provider: {
          id: "openai",
          model: "m",
          complete: () => {
            throw new Error("a scan must never reach the model");
          },
        },
      },
    );
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.kind).toBe("no_text");
    expect(translatePreflight(extracted, CEILING).refusal).toBe(run.message);
  });

  it("points at a tool that exists, by its real name, whose default output Translate can read", () => {
    // "Run OCR PDF first, then translate the result" is only honest if OCR
    // PDF's result carries a selectable text layer. Its default is a
    // searchable PDF; if that default ever became the text sidecar, the
    // sentence would promise a round trip that cannot happen.
    const ocr = getToolBySlug("ocr-pdf");
    expect(ocr, "the OCR tool this sentence sends people to").toBeDefined();
    expect(TRANSLATE_NO_TEXT_MESSAGE).toContain(ocr!.name);
    expect(ocrOutputsForMode(DEFAULT_OCR_OUTPUT_MODE)).toContain("PDF");
  });
});

describe("a page too long for one pass is named, and splitting is not suggested", () => {
  it("names the one oversize page and its extracted size", async () => {
    const extracted = await read(textPdf([CEILING + 2_000]));
    const { refusal, plan } = translatePreflight(extracted, CEILING);
    expect(plan.oversize).toHaveLength(1);
    const page = plan.oversize[0]!;
    // The number in the sentence is the one the extractor produced.
    expect(page.characters).toBe(extracted.pages[0]!.text.length);
    expect(refusal).toContain(`Page ${page.pageNumber} alone holds`);
    expect(refusal).toContain(page.characters.toLocaleString("en-US"));
    expect(refusal).toContain(CEILING.toLocaleString("en-US"));
    expect(refusal).not.toMatch(OLD_SPLIT);
    expect(refusal).not.toMatch(OLD_ZERO);
  });

  it("names every oversize page when there are several, and skips blank ones", async () => {
    const extracted = await read(
      textPdf([CEILING + 1_500, 0, CEILING + 3_000]),
    );
    const { refusal, plan } = translatePreflight(extracted, CEILING);
    expect(plan.oversize.map((p) => p.pageNumber)).toEqual([1, 3]);
    expect(refusal).toMatch(/^Every page with text/);
    for (const page of plan.oversize) {
      expect(refusal).toContain(
        `page ${page.pageNumber} holds ${page.characters.toLocaleString("en-US")}`,
      );
    }
    expect(refusal).not.toContain("page 2");
    expect(refusal).not.toMatch(OLD_SPLIT);
  });

  it("keeps a long list readable: three pages named, the rest counted", () => {
    const pages = [1, 2, 3, 4, 5].map((pageNumber) => ({
      pageNumber,
      characters: CEILING + pageNumber,
    }));
    const five = translateEveryPageTooLongMessage(pages, CEILING);
    for (const page of pages.slice(0, 3))
      expect(five).toContain(`page ${page.pageNumber} holds`);
    expect(five).not.toContain("page 4 holds");
    expect(five).toContain("and 2 more pages are over it too");
    expect(
      translateEveryPageTooLongMessage(pages.slice(0, 4), CEILING),
    ).toContain("and 1 more page is over it too");
    expect(five).not.toMatch(OLD_SPLIT);
  });

  it("the worker refuses the same document with the same sentence", async () => {
    const extracted = await read(textPdf([CEILING + 2_000]));
    const run = await runTranslate(
      new Uint8Array([1]),
      { targetLanguage: "fr", sourceLanguage: "auto" },
      {
        extract: async () => extracted,
        provider: {
          id: "openai",
          model: "m",
          complete: () => {
            throw new Error("an oversize page must never reach the model");
          },
        },
      },
    );
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.kind).toBe("too_much_text");
    expect(translatePreflight(extracted, CEILING).refusal).toBe(run.message);
  });
});

describe("the browser refuses exactly what the worker refuses, in the same words", () => {
  /**
   * The pre-upload check is only worth having if it is the worker's decision
   * made early. Stricter, and it hides work the worker can do (the reason the
   * planner is shared); looser, and a user is charged a daily run to be told
   * no; different words, and the same document reads as two different
   * problems. So every small document shape — blank, short, one under / at /
   * one over the ceiling, far over — is run through BOTH, and they must agree.
   */
  const SIZES = [
    0,
    50,
    3_000,
    CEILING - 1,
    CEILING,
    CEILING + 1,
    CEILING + 5_000,
  ];
  function* documents(): Generator<number[]> {
    for (const a of SIZES) {
      yield [a];
      for (const b of SIZES) {
        yield [a, b];
        for (const c of SIZES) yield [a, b, c];
      }
    }
  }
  function extraction(sizes: readonly number[]): ExtractedPdfText {
    const pages = sizes.map((n, i) => ({
      pageNumber: i + 1,
      text: "a".repeat(n),
      characterCount: n,
    }));
    const text = pages
      .map((p) => p.text)
      .filter((t) => t.length > 0)
      .join("\n\n");
    return {
      pageCount: pages.length,
      pages,
      text,
      characterCount: text.length,
      hasText: text.trim().length > 0,
    };
  }

  it("agrees on every document shape up to three pages", async () => {
    const outcomes = { passed: 0, noText: 0, everyPage: 0 };
    const disagreements: string[] = [];
    for (const sizes of documents()) {
      const extracted = extraction(sizes);
      const browser = translatePreflight(extracted, CEILING).refusal;
      const worker = await runTranslate(
        new Uint8Array([1]),
        { targetLanguage: "fr", sourceLanguage: "auto" },
        {
          extract: async () => extracted,
          provider: {
            id: "openai",
            model: "m",
            complete: async () => ({
              ok: true,
              text: "Une traduction.",
              model: "m",
              usage: { inputTokens: 1, outputTokens: 1 },
            }),
          },
        },
      );
      const workerRefusal = worker.ok ? null : worker.message;
      if (browser !== workerRefusal)
        disagreements.push(
          `[${sizes.join(", ")}] browser=${browser?.slice(0, 40) ?? "submit"} worker=${workerRefusal?.slice(0, 40) ?? "translated"}`,
        );
      if (browser === null) outcomes.passed += 1;
      else if (browser === TRANSLATE_NO_TEXT_MESSAGE) outcomes.noText += 1;
      else outcomes.everyPage += 1;
    }
    expect(disagreements, disagreements.join("\n")).toEqual([]);
    // The corpus exercised every branch, so agreement is not vacuous.
    expect(outcomes.passed).toBeGreaterThan(100);
    expect(outcomes.noText).toBeGreaterThan(0);
    expect(outcomes.everyPage).toBeGreaterThan(10);
  });
});

describe("what may be submitted still is (positive controls)", () => {
  it("passes a page under the ceiling", async () => {
    const extracted = await read(textPdf([2_000]));
    const { refusal, textPages } = translatePreflight(extracted, CEILING);
    expect(refusal).toBeNull();
    expect(textPages).toHaveLength(1);
  });

  it("passes a document with one oversize page and one it can translate", async () => {
    // The worker delivers the translatable page and marks the other in place,
    // so refusing here would hide work the worker can do.
    const extracted = await read(textPdf([CEILING + 2_000, 1_500]));
    const { refusal, plan } = translatePreflight(extracted, CEILING);
    expect(plan.chunks).toHaveLength(1);
    expect(plan.oversize).toHaveLength(1);
    expect(refusal).toBeNull();
  });

  it("keeps the whole-document message ONLY where there is no page structure", () => {
    const text = "x".repeat(CEILING + 1);
    const { refusal } = translatePreflight(
      { pages: [], hasText: true, characterCount: text.length },
      CEILING,
    );
    expect(refusal).toBe(translateTooLongMessage(text.length, CEILING));
    expect(
      translatePreflight(
        { pages: [], hasText: true, characterCount: 10 },
        CEILING,
      ).refusal,
    ).toBeNull();
  });
});
