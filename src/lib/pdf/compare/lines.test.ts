// @native-canvas
import { describe, expect, it } from "vitest";
import type { ExtractedPdfText } from "../text";
import {
  body,
  extractLegacy,
  linesPdf,
  pageHeaderPair,
  type PageLines,
} from "@/tests/compare-fixtures";
import { comparableLines, linesOf } from "./lines";

/**
 * Provenance identity: the lines the comparison diffs, built page by page so
 * each one knows its page, are EXACTLY the lines it diffed before pages were
 * tracked — `normalizeComparableText(extracted.text)` — over real PDFs read
 * by the extractor that ships. If they were not, every report since would
 * describe a different diff from the one the verdict was computed on.
 *
 * The oracle is a frozen copy of that function as it stood on adb519ab
 * (`compare-pdf.ts:61-67`), not an import: an import would move with the
 * code it is checking.
 */
function legacyNormalize(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean);
}

/**
 * Pages of raw text, joined raw. `extractPdfText` normalises line endings
 * before it joins, so its `text` never holds "
"; this one does, to hold
 * the identity on input the extractor never produces as well.
 */
function synthetic(pages: string[]): ExtractedPdfText {
  const text = pages.join("\n\n");
  return {
    pageCount: pages.length,
    pages: pages.map((t, i) => ({
      pageNumber: i + 1,
      text: t,
      characterCount: t.length,
    })),
    text,
    characterCount: text.length,
    hasText: text.trim().length > 0,
  };
}

const REAL: Record<string, readonly PageLines[]> = {
  "three pages": [body("one"), body("two"), body("three")],
  "a blank middle page": [body("before"), [], body("after", 12)],
  "the page-header pair, revised, with a blank": pageHeaderPair({
    blank: true,
  }).right,
  "repeated lines on every page": [
    ["Acme Corp", ...body("p1", 5), "Page 1 of 3"],
    ["Acme Corp", ...body("p2", 5), "Page 2 of 3"],
    ["Acme Corp", ...body("p3", 5), "Page 3 of 3"],
  ],
};

/** Inputs no PDF writer here can produce: CRLF, tabs, edge spaces. */
const SYNTHETIC: Record<string, ExtractedPdfText> = {
  "CRLF line endings, tabs and edge spaces": synthetic([
    "  Indented\tline  \r\n   An indented middle line\r\nSecond\t\tline\r\n\r\n",
    "\tThird page start\rOld Mac ending  ",
  ]),
};

async function corpus(): Promise<[string, ExtractedPdfText][]> {
  const real = await Promise.all(
    Object.entries(REAL).map(
      async ([name, pages]) =>
        [name, await extractLegacy(await linesPdf(pages))] as [
          string,
          ExtractedPdfText,
        ],
    ),
  );
  return [...real, ...Object.entries(SYNTHETIC)];
}

describe("compare lines: the page-aware lines are the lines the diff always read", () => {
  it("health: real multi-page PDFs, enough lines, a CRLF input and a blank middle page", async () => {
    const all = await corpus();
    const multiPage = all.filter(([, x]) => x.pageCount >= 2);
    expect(multiPage.map(([name]) => name).length).toBeGreaterThanOrEqual(3);
    const total = all.reduce((n, [, x]) => n + linesOf(x).length, 0);
    expect(total).toBeGreaterThanOrEqual(50);
    expect(all.some(([, x]) => x.text.includes("\r\n"))).toBe(true);
    // A blank page in the MIDDLE: the extractor drops it from the text, and
    // the lines after it must still carry their real page numbers.
    const blank = all.find(([name]) => name === "a blank middle page")![1];
    expect(blank.pages[1]!.text.trim()).toBe("");
    expect(new Set(linesOf(blank).map((l) => l.page))).toEqual(new Set([1, 3]));
  });

  it("linesOf(x).map(text) equals the legacy lines of x.text, on every fixture", async () => {
    for (const [name, extracted] of await corpus()) {
      expect(
        linesOf(extracted).map((l) => l.text),
        name,
      ).toEqual(legacyNormalize(extracted.text));
    }
  });

  it("positive control: lines read straight off the raw pages are NOT the legacy lines", async () => {
    // A plausible wrong derivation — each page's raw text split on "\n", no
    // per-page normalisation — must fail the same comparison, or the
    // identity above could not tell a right derivation from a wrong one.
    const wrong = (x: ExtractedPdfText) =>
      x.pages.flatMap((page) => page.text.split("\n"));
    const caught = (await corpus())
      .filter(
        ([, x]) =>
          JSON.stringify(wrong(x)) !== JSON.stringify(legacyNormalize(x.text)),
      )
      .map(([name]) => name);
    expect(caught).toContain("CRLF line endings, tabs and edge spaces");
    expect(caught).toContain("a blank middle page");
  });

  it("each line carries its page, and its rank among equal lines on that page", async () => {
    const x = await extractLegacy(
      await linesPdf([["Same", "Other", "Same"], [], ["Same"]]),
    );
    expect(
      linesOf(x).map(({ text, page, occurrence }) => [text, page, occurrence]),
    ).toEqual([
      ["Same", 1, 0],
      ["Other", 1, 0],
      ["Same", 1, 1],
      ["Same", 3, 0],
    ]);
  });

  it("ignore case keys on the lowercase text and keeps the text verbatim", () => {
    const { lines } = comparableLines(synthetic(["Total DUE"]), {
      ignoreCase: true,
    });
    expect(lines).toEqual([
      { text: "Total DUE", key: "total due", page: 1, occurrence: 0 },
    ]);
  });
});
