// @vitest-environment node
// @native-canvas
import { describe, expect, it } from "vitest";
import {
  COMPARE_VERDICTS,
  type ComparablePdfText,
  type CompareVerdict,
} from "@/lib/pdf/compare-pdf";
import type { CompareOptions } from "@/lib/pdf/compare/lines";
import { comparablePdf, pageHeaderPair } from "@/tests/compare-fixtures";
import { compareExtractedPdfText } from "./compare-result";

/** One document of pages of text, as `extractPdfText` would hand it over. */
function doc(name: string, pages: string[]): ComparablePdfText {
  const text = pages.filter((p) => p.trim()).join("\n\n");
  return {
    name,
    size: text.length,
    extracted: {
      pageCount: pages.length,
      pages: pages.map((t, i) => ({
        pageNumber: i + 1,
        text: t,
        characterCount: t.length,
      })),
      text,
      characterCount: text.length,
      hasText: text.trim().length > 0,
    },
  };
}

/** Three pages, each topped with a running header and footed with a number. */
const paged = (bodies: string[]) =>
  bodies.map((b, i) => `Acme Corp\n${b}\nPage ${i + 1} of 3`);

/** Pairs that land on every verdict, under one option or another. */
const CORPUS: Record<string, [ComparablePdfText, ComparablePdfText]> = {
  "the same text": [doc("a", ["One\nTwo"]), doc("b", ["One\nTwo"])],
  "a changed line": [doc("a", ["One\nTwo"]), doc("b", ["One\nThree"])],
  "only the case differs": [
    doc("a", ["Total due\nPayable now"]),
    doc("b", ["TOTAL DUE\npayable now"]),
  ],
  "only the page furniture differs": [
    doc("a", paged(["alpha text", "bravo text", "charlie text"])),
    doc(
      "b",
      paged(["alpha text", "bravo text", "charlie text"]).map((p) =>
        p.replace("of 3", "of 4"),
      ),
    ),
  ],
  "case and furniture differ": [
    doc("a", paged(["alpha text", "bravo text", "charlie text"])),
    doc(
      "b",
      paged(["ALPHA text", "bravo TEXT", "charlie text"]).map((p) =>
        p.replace("of 3", "of 4"),
      ),
    ),
  ],
  "spacing only": [
    doc("a", ["Total  due:\t100"]),
    doc("b", ["Total due: 100"]),
  ],
  "neither has text": [doc("a", [""]), doc("b", [" "])],
  "only the second has text": [doc("a", [""]), doc("b", ["One"])],
  "only the first has text": [doc("a", ["One"]), doc("b", [""])],
};

/** A full options sample: every key there is. The combinations are DERIVED. */
const FULL: Required<CompareOptions> = {
  ignoreCase: true,
  ignoreFurniture: true,
};

function combinations(): CompareOptions[] {
  const keys = Object.keys(FULL) as (keyof CompareOptions)[];
  return Array.from({ length: 2 ** keys.length }, (_, mask) =>
    Object.fromEntries(keys.map((k, i) => [k, Boolean(mask & (1 << i))])),
  );
}

/** The verdict as it was computed on adb519ab: the joined texts, `===`. */
function legacyVerdict(l: ComparablePdfText, r: ComparablePdfText) {
  const norm = (t: string) =>
    t
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[\t ]+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
  const lt = l.extracted.hasText;
  const rt = r.extracted.hasText;
  if (!lt && !rt) return "no-text";
  if (!lt) return "left-no-text";
  if (!rt) return "right-no-text";
  return norm(l.extracted.text) === norm(r.extracted.text)
    ? "identical"
    : "different";
}

describe("compare: the verdict and the listed changes agree under every option", () => {
  it("health: every option key is enumerated and every verdict is reached", () => {
    expect(combinations()).toHaveLength(4);
    const seen = new Set<CompareVerdict>();
    for (const opts of combinations())
      for (const [l, r] of Object.values(CORPUS))
        seen.add(compareExtractedPdfText(l, r, opts).verdict);
    expect([...seen].sort()).toEqual([...COMPARE_VERDICTS].sort());
  });

  it("identical exactly when no change is listed, for every pair and every option", () => {
    const disagree: string[] = [];
    const both = { identical: 0, different: 0 };
    for (const opts of combinations()) {
      for (const [name, [l, r]] of Object.entries(CORPUS)) {
        const result = compareExtractedPdfText(l, r, opts);
        if (!result.hasComparableText) continue;
        if (result.verdict === "identical") both.identical += 1;
        else both.different += 1;
        if ((result.verdict === "identical") !== (result.hunks.length === 0))
          disagree.push(
            `${name} ${JSON.stringify(opts)}: ${result.verdict}, ${result.hunks.length} hunks`,
          );
      }
    }
    // Both sides of the equivalence are exercised, so it is not vacuous.
    expect(both.identical).toBeGreaterThan(0);
    expect(both.different).toBeGreaterThan(0);
    expect(disagree).toEqual([]);
  });

  it("each option turns its own pair identical, and only its own", () => {
    const verdict = (name: string, opts: CompareOptions) =>
      compareExtractedPdfText(...CORPUS[name]!, opts).verdict;
    expect(verdict("only the case differs", {})).toBe("different");
    expect(verdict("only the case differs", { ignoreCase: true })).toBe(
      "identical",
    );
    expect(verdict("only the page furniture differs", {})).toBe("different");
    expect(
      verdict("only the page furniture differs", { ignoreFurniture: true }),
    ).toBe("identical");
    expect(verdict("case and furniture differ", { ignoreCase: true })).toBe(
      "different",
    );
    expect(verdict("case and furniture differ", FULL)).toBe("identical");
  });

  it("with no option, the verdict is the legacy verdict on every pair", () => {
    for (const [name, [l, r]] of Object.entries(CORPUS))
      expect(compareExtractedPdfText(l, r).verdict, name).toBe(
        legacyVerdict(l, r),
      );
  });
});

describe("compare: each change names its page in both files, from real PDFs", () => {
  it("a page inserted before page 2 moves the edit on it to page 3", async () => {
    const { left, right } = pageHeaderPair();
    const result = compareExtractedPdfText(
      await comparablePdf("v1.pdf", left),
      await comparablePdf("v2.pdf", right),
    );
    expect(result.report).toMatch(/^@@ Page 1 -> page 2 @@$/m);
    expect(result.report).toMatch(/^@@ Page 2 -> page 3 @@$/m);
    expect(result.report).toMatch(/^- Total due: 100$/m);
    expect(result.report).toMatch(/^\+ Total due: 120$/m);
    expect(result.report).toMatch(/^~ Total due: \[-100-\]\{\+120\+\}$/m);
  });

  it("a blank page before the insertion counts: the page number is the page's own", async () => {
    const { left, right } = pageHeaderPair({ blank: true });
    const result = compareExtractedPdfText(
      await comparablePdf("v1.pdf", left),
      await comparablePdf("v2.pdf", right),
    );
    expect(result.pagesWithoutText).toEqual({ left: [], right: [2] });
    expect(result.report).toMatch(/^@@ Page 1 -> page 3 @@$/m);
    expect(result.report).toMatch(/^@@ Page 2 -> page 4 @@$/m);
    expect(result.report).toMatch(
      /^Pages without selectable text: first PDF none; second PDF 2$/m,
    );
  });

  it("control: with no page inserted, the edit stays on page 2 of both", async () => {
    const { left, right } = pageHeaderPair({ insert: false });
    const result = compareExtractedPdfText(
      await comparablePdf("v1.pdf", left),
      await comparablePdf("v2.pdf", right),
    );
    expect(result.hunks).toHaveLength(1);
    expect(result.report).toMatch(/^@@ Page 2 -> page 2 @@$/m);
  });
});
