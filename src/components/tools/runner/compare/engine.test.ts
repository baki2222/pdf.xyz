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

/**
 * "Ignore page headers and numbers" sets aside page FURNITURE, and nothing
 * a reader wrote. Each pair below changes one number in a body line that
 * sits at a page's edge — where the detector looks — and must stay
 * "different" with the option on, the changed number listed. Until
 * 2026-11-14 every one compared as identical (review of audit
 * compare-pdf#4): the detector folded every number into `#`, so lines that
 * differed page to page looked like one repeated line, and were dropped.
 */
const NUMBER_EDITS: Record<string, [string[], string[], string]> = (() => {
  const statement = (p: number, bal: string) =>
    [
      `Transactions for week ${p}`,
      `Coffee ${p} 3.50`,
      `Lunch ${p} 12.00`,
      `Taxi ${p} 25.00`,
      `Hotel ${p} 140.00`,
      `Balance carried forward: ${bal}`,
    ].join("\n");
  const pages5 = [1, 2, 3, 4, 5];
  const deck = (rev: string) =>
    [1, 2, 3, 4].map((q) =>
      [
        `Q${q} results`,
        `Revenue grew ${q === 2 ? rev : "10"}%`,
        `Headcount ${q}0`,
      ].join("\n"),
    );
  const contract = (amt: string) =>
    [1, 2, 3].map((p) =>
      [
        `The Tenant shall pay ${p === 2 ? amt : "1200"} dollars per month.`,
        `Clause ${p} body text that is unique ${p}`,
        `more unique body ${p}`,
        `and more ${p}`,
        `end of clause ${p}`,
      ].join("\n"),
    );
  const ledger = (swap: (p: number, i: number) => string | undefined) =>
    [0, 1, 2, 3].map((p) =>
      Array.from(
        { length: 12 },
        (_, i) =>
          `2026-0${p + 1}-${i + 10} Payment received ${swap(p, i) ?? `${100 + p * 12 + i}.00`}`,
      ).join("\n"),
    );
  return {
    "a running balance on page 3": [
      pages5.map((p) => statement(p, `${p}000.00`)),
      pages5.map((p) => statement(p, p === 3 ? "9000.00" : `${p}000.00`)),
      "9000.00",
    ],
    "a one-page invoice's last cell": [
      ["Invoice 42\nWidget\nQty 3\nAmount due\n4250"],
      ["Invoice 42\nWidget\nQty 3\nAmount due\n9250"],
      "9250",
    ],
    "a figure on a short slide": [deck("10"), deck("40"), "40%"],
    "a clause at a page's top": [contract("1200"), contract("1500"), "1500"],
    "ledger rows at a page's edges": [
      ledger(() => undefined),
      ledger((p, i) =>
        (p === 1 && i === 0) || (p === 2 && i === 11) ? "999.00" : undefined,
      ),
      "999.00",
    ],
  };
})();

describe("compare: ignoring page furniture never hides a changed body line", () => {
  it("health: each pair differs with no option, in the number it names", () => {
    for (const [name, [l, r, changed]] of Object.entries(NUMBER_EDITS)) {
      const result = compareExtractedPdfText(doc("a", l), doc("b", r));
      expect(result.verdict, name).toBe("different");
      expect(result.report, name).toContain(changed);
    }
  });

  it("with the option on, each pair is still different and the changed number is listed", () => {
    const hidden: string[] = [];
    for (const [name, [l, r, changed]] of Object.entries(NUMBER_EDITS)) {
      for (const opts of [{ ignoreFurniture: true }, FULL]) {
        const result = compareExtractedPdfText(doc("a", l), doc("b", r), opts);
        const listed = result.hunks.some((h) =>
          h.ops.some(
            (op) =>
              op.k === "added" &&
              result.diff.some(
                (d) =>
                  d.kind === "added" &&
                  d.right === op.b &&
                  d.text.includes(changed),
              ),
          ),
        );
        if (result.verdict !== "different" || !listed)
          hidden.push(
            `${name} ${JSON.stringify(opts)}: ${result.verdict}, dropped ${JSON.stringify(result.dropped)}`,
          );
      }
    }
    expect(hidden).toEqual([]);
  });
});

/**
 * "Ignore case" is case FOLDING, not lowercasing (review of audit
 * compare-pdf#4, 2026-11-14): "İ" lowercases to "i" plus a combining dot,
 * and "ß" has no one-letter capital, so both compared as changes under the
 * option until then. Each pair differs only by case.
 */
const CASE_ONLY: [string, string][] = [
  ["İSTANBUL", "istanbul"],
  ["STRASSE", "straße"],
  ["ΣΊΣΥΦΟΣ", "σίσυφος"],
  ["OFFICE", "oﬃce"],
  ["Total due", "TOTAL DUE"],
];

describe("compare: ignore case folds case the way Unicode does", () => {
  it("each pair differs with no option, and is identical with ignore case, in the lines and the words", () => {
    const wrong: string[] = [];
    for (const [l, r] of CASE_ONLY) {
      const pair = (opts: CompareOptions) =>
        compareExtractedPdfText(doc("a", [l]), doc("b", [r]), opts);
      if (pair({}).verdict !== "different") wrong.push(`${l}/${r}: no option`);
      if (pair({ ignoreCase: true }).verdict !== "identical")
        wrong.push(`${l}/${r}: ignore case`);
      // Inside a changed line, the case-only word is not marked.
      const words = compareExtractedPdfText(
        doc("a", [`${l} 1`]),
        doc("b", [`${r} 2`]),
        { ignoreCase: true },
      ).hunks.flatMap((h) => h.pairs.flatMap((p) => p.tokens ?? []));
      if (!words.some((t) => t.k === "same" && t.text.startsWith(l)))
        wrong.push(`${l}/${r}: word marks ${JSON.stringify(words)}`);
    }
    expect(wrong).toEqual([]);
  });

  it("control: different letters are still different under ignore case", () => {
    expect(
      compareExtractedPdfText(doc("a", ["STRASSE"]), doc("b", ["strasze"]), {
        ignoreCase: true,
      }).verdict,
    ).toBe("different");
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

/**
 * What the overview says of page breaks (second review of audit
 * compare-pdf#4, 2026-11-14). It said "a line that only moved to another
 * page is not a change", and a line taken off page 1 and put at the end of
 * page 3 is listed as removed and added. What is ignored is re-flow: the
 * same lines in the same order, broken into pages differently.
 */
describe("compare: a moved line is a change; re-flowed text is not", () => {
  const pages = [0, 1, 2].map((p) =>
    Array.from({ length: 10 }, (_, i) => `page ${p + 1} unique body ${i + 1}`),
  );

  it("re-flowed: the same lines in the same order on other pages are identical", () => {
    const flat = pages.flat();
    const reflowed = [flat.slice(0, 7), flat.slice(7, 19), flat.slice(19)];
    const result = compareExtractedPdfText(
      doc(
        "a",
        pages.map((p) => p.join("\n")),
      ),
      doc(
        "b",
        reflowed.map((p) => p.join("\n")),
      ),
    );
    expect(result.verdict).toBe("identical");
  });

  it("moved: a line taken off page 1 and put on page 3 is removed and added", () => {
    const moved = pages.map((p) => [...p]);
    const [line] = moved[0]!.splice(4, 1);
    moved[2]!.push(line!);
    const result = compareExtractedPdfText(
      doc(
        "a",
        pages.map((p) => p.join("\n")),
      ),
      doc(
        "b",
        moved.map((p) => p.join("\n")),
      ),
    );
    expect(result.verdict).toBe("different");
    expect(result.summary).toMatchObject({ addedLines: 1, removedLines: 1 });
    expect(result.report).toMatch(/^- page 1 unique body 5$/m);
    expect(result.report).toMatch(/^\+ page 1 unique body 5$/m);
  });
});
