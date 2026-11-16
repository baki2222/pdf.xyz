// @vitest-environment node
// @native-canvas
/**
 * The one selection function, over BOTH extractors' shapes.
 *
 * The browser declares what it will send and the worker reads it; both call
 * `selectExtraction`, so the property worth pinning is that it selects by
 * PAGE NUMBER on each shape — the worker's (`parseLayoutText`, form-feed
 * pages, blank ones included) and the browser's (pdfjs, every page pushed) —
 * and that selecting every page is the identity on each, so a whole-document
 * declaration cannot change by routing through it.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { parseLayoutText } from "@/lib/workers/pdf-text/parse";
import type { PageSpan } from "./page-spans";
import {
  firstSpanBeyond,
  pageInSpans,
  selectExtraction,
} from "./page-selection";
import { extractPdfText, pageTextChunks } from "./text";
import { extractSelectionOnDemand } from "./text-lazy";

/** pdf.js's legacy build, the one Node runs. */
const legacy = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Pick<
    typeof import("pdfjs-dist"),
    "getDocument"
  >;

const FF = String.fromCharCode(12);

/** pdftotext-shaped output: 5 pages, page 2 blank, markers on 1, 3, 4, 5. */
const WORKER = parseLayoutText(
  ["MARKER-ONE", "", "MARKER-THREE", "MARKER-FOUR", "MARKER-FIVE"].join(FF) +
    FF,
);

const markersIn = (text: string) => text.match(/MARKER-[A-Z]+/g) ?? [];

describe("selectExtraction on the worker's shape (blank page 2)", () => {
  it("health: the fixture is five pages with page 2 blank", () => {
    expect(WORKER.pageCount).toBe(5);
    expect(WORKER.pages.map((p) => p.pageNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(WORKER.pages[1]!.text).toBe("");
    // The trap this module exists for: chunk index is NOT page number.
    expect(pageTextChunks(WORKER.pages)[1]!.pageNumber).toBe(3);
  });

  it.each([
    [[[3, 4]], ["MARKER-THREE", "MARKER-FOUR"]],
    [[[3, 3]], ["MARKER-THREE"]],
    [
      [
        [1, 1],
        [5, 5],
      ],
      ["MARKER-ONE", "MARKER-FIVE"],
    ],
    [[[2, 3]], ["MARKER-THREE"]],
    [[[2, 2]], []],
  ] as [PageSpan[], string[]][])("%j reads exactly %j", (spans, expected) => {
    const selected = selectExtraction(WORKER, spans);
    expect(markersIn(selected.text)).toEqual(expected);
    expect(selected.characterCount).toBe(selected.text.length);
    expect(selected.hasText).toBe(expected.length > 0);
    // The document's total, so notices say "of 5".
    expect(selected.pageCount).toBe(5);
  });

  it("selecting every page is the identity", () => {
    const all = selectExtraction(WORKER, [[1, 5]]);
    expect(all).toEqual(WORKER);
  });

  it("returns a new object and leaves the extraction untouched", () => {
    const before = JSON.stringify(WORKER);
    const selected = selectExtraction(WORKER, [[3, 3]]);
    expect(selected).not.toBe(WORKER);
    expect(JSON.stringify(WORKER)).toBe(before);
  });
});

async function fourPagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // Lengths differ per page, so a wrong page changes the count, not only the text.
  for (const line of [
    "PROBEPAGEALPHA",
    "",
    "PROBEPAGEGAMMA and a longer line of text on page three",
    "PROBEPAGEDELTA ends it",
  ]) {
    const page = doc.addPage([300, 300]);
    if (line) page.drawText(line, { x: 20, y: 200, size: 10, font });
  }
  return doc.save();
}

describe("selectExtraction on the browser's shape (pdfjs)", () => {
  it("selects by page number through the lazy path, and all pages is the identity", async () => {
    const bytes = await fourPagePdf();
    const { extracted, select } = await extractSelectionOnDemand(bytes, legacy);
    // Health: pdfjs keeps the blank page in `pages` with its own number.
    expect(extracted.pageCount).toBe(4);
    expect(extracted.pages.map((p) => p.pageNumber)).toEqual([1, 2, 3, 4]);
    expect(extracted.pages[1]!.text.trim()).toBe("");

    expect(select).toBe(selectExtraction);
    const gamma = select(extracted, [[3, 3]]);
    expect(gamma.text).toContain("PROBEPAGEGAMMA");
    expect(gamma.text).not.toContain("PROBEPAGEALPHA");
    expect(gamma.text).not.toContain("PROBEPAGEDELTA");
    expect(gamma.characterCount).toBeLessThan(extracted.characterCount);

    // The same extraction the whole-document declaration counts today.
    const whole = await extractPdfText(bytes, legacy);
    expect(select(extracted, [[1, 4]])).toEqual(whole);
    expect(extracted).toEqual(whole);
  });
});

describe("pageInSpans and firstSpanBeyond", () => {
  const spans: PageSpan[] = [
    [2, 4],
    [9, 9],
  ];
  it.each([
    [1, false],
    [2, true],
    [4, true],
    [5, false],
    [9, true],
    [10, false],
  ])("page %i in [[2,4],[9,9]] -> %s", (page, expected) => {
    expect(pageInSpans(page, spans)).toBe(expected);
  });

  it("names the first span past the document, or null", () => {
    expect(firstSpanBeyond(spans, 9)).toBeNull();
    expect(firstSpanBeyond(spans, 8)).toEqual([9, 9]);
    expect(firstSpanBeyond(spans, 3)).toEqual([2, 4]);
    expect(firstSpanBeyond([], 1)).toBeNull();
  });
});
