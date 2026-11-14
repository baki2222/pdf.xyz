// @vitest-environment node
// @native-canvas
import { beforeAll, describe, expect, it } from "vitest";
import type {
  ComparablePdfText,
  PdfCompareResult,
} from "@/lib/pdf/compare-pdf";
import {
  RUNNING_PATTERNS,
  runningShape,
} from "@/lib/pdf/compare/running-lines";
import { comparablePdf, type PageLines } from "@/tests/compare-fixtures";
import { compareExtractedPdfText } from "./compare-result";

/**
 * "Ignore page headers and numbers" never hides a line whose words differ
 * between the two files (exit property (b) of audit compare-pdf#4, second
 * review, 2026-11-14). Until then the running lines of each file were
 * dropped from it ON ITS OWN, before the diff: a header repeated at the
 * page edges of both files was dropped from both even when its words
 * differed, and the comparison said identical — a renamed party, a changed
 * account number, a revised figure on every slide, a renumbered invoice
 * batch, a clause at the top of 2 of 5 pages, a 2-page letter's changed
 * date, a TOC's page reference. Where one file repeated a line and the
 * other did not, one side's copies were dropped and the other's kept, so an
 * edit read as a bare addition and unchanged lines as added.
 *
 * Every pair below is two real PDFs (pdf-lib, read back by the shipped
 * extractor). With the option off each one differs; with it on, each must
 * still list its edit, old value removed AND new value added. The pairs
 * whose page furniture is the same in both files must list exactly what
 * the option-off comparison lists: there is nothing to set aside.
 */
const pad = (tag: string, n = 6) =>
  Array.from(
    { length: n },
    (_, i) => `${tag} clause ${i + 1} text of the agreement`,
  );

interface Case {
  left: PageLines[];
  right: PageLines[];
  /** A text only in the first file's version of the edit, and one only in the second's. */
  edit: [string, string];
}

const CASES: Record<string, Case> = {
  "a renamed party in the header of every page": {
    left: [1, 2, 3, 4].map((p) => [
      "Master Services Agreement between Acme Ltd and Beta LLC",
      ...pad(`p${p}`),
      `Page ${p} of 4`,
    ]),
    right: [1, 2, 3, 4].map((p) => [
      "Master Services Agreement between Acme Ltd and Gamma LLC",
      ...pad(`p${p}`),
      `Page ${p} of 4`,
    ]),
    edit: ["Beta LLC", "Gamma LLC"],
  },
  "an account number in a statement's header": {
    left: [1, 2, 3, 4, 5].map((p) => [
      "Account 12345678 Statement period 01/10/2026 to 31/10/2026",
      ...pad(`s${p}`),
      `Balance carried forward: ${p}000.00`,
      `Page ${p} of 5`,
    ]),
    right: [1, 2, 3, 4, 5].map((p) => [
      "Account 12345679 Statement period 01/10/2026 to 31/10/2026",
      ...pad(`s${p}`),
      `Balance carried forward: ${p}000.00`,
      `Page ${p} of 5`,
    ]),
    edit: ["12345678", "12345679"],
  },
  "a figure revised on every slide": {
    left: [1, 2, 3].map((p) => [
      "Q3 Revenue",
      "Revenue target: $4.2M",
      ...pad(`slide${p}`, 4),
    ]),
    right: [1, 2, 3].map((p) => [
      "Q3 Revenue",
      "Revenue target: $4.5M",
      ...pad(`slide${p}`, 4),
    ]),
    edit: ["$4.2M", "$4.5M"],
  },
  "a figure revised on one slide": {
    left: [1, 2, 3].map((p) => [
      "Q3 Revenue",
      "Revenue target: $4.2M",
      ...pad(`slide${p}`, 4),
    ]),
    right: [1, 2, 3].map((p) => [
      "Q3 Revenue",
      p === 2 ? "Revenue target: $4.5M" : "Revenue target: $4.2M",
      ...pad(`slide${p}`, 4),
    ]),
    edit: ["$4.2M", "$4.5M"],
  },
  // Found while fixing the two above: a moved copy of the old figure must
  // not stand in for the edited one, near or far.
  "a figure revised on one slide while a new slide repeats the old one": {
    left: [1, 2, 3].map((p) => [
      "Q3 Revenue",
      "Revenue target: $4.2M",
      ...pad(`slide${p}`, 4),
    ]),
    right: [1, 2, 3, 4].map((p) => [
      "Q3 Revenue",
      p === 2 ? "Revenue target: $4.5M" : "Revenue target: $4.2M",
      ...pad(`slide${p}`, 4),
    ]),
    edit: ["$4.2M", "$4.5M"],
  },
  "a figure withdrawn on one slide while a new slide repeats it": {
    left: [1, 2, 3].map((p) => [
      "Q3 Revenue",
      "Revenue target: $4.2M",
      ...pad(`slide${p}`, 4),
    ]),
    right: [1, 2, 3, 4].map((p) => [
      "Q3 Revenue",
      p === 2 ? "Guidance withdrawn pending audit" : "Revenue target: $4.2M",
      ...pad(`slide${p}`, 4),
    ]),
    edit: ["$4.2M", "Guidance withdrawn"],
  },
  "one invoice of a batch renumbered": {
    left: [1, 2, 3, 4].map((p) => [
      `Invoice no: ${1042 + p}`,
      ...pad(`inv${p}`, 4),
      `Amount due: ${100 * p}.00`,
    ]),
    right: [1, 2, 3, 4].map((p) => [
      `Invoice no: ${p === 3 ? 1099 : 1042 + p}`,
      ...pad(`inv${p}`, 4),
      `Amount due: ${100 * p}.00`,
    ]),
    edit: ["Invoice no: 1045", "Invoice no: 1099"],
  },
  "a batch of invoices renumbered": {
    left: [1, 2, 3, 4].map((p) => [
      `Invoice no: ${1042 + p}`,
      ...pad(`inv${p}`, 4),
      `Amount due: ${100 * p}.00`,
    ]),
    right: [1, 2, 3, 4].map((p) => [
      `Invoice no: ${2042 + p}`,
      ...pad(`inv${p}`, 4),
      `Amount due: ${100 * p}.00`,
    ]),
    edit: ["Invoice no: 1043", "Invoice no: 2043"],
  },
  "an amount in a footer, changed on one page": {
    left: [1, 2, 3].map((p) => [...pad(`f${p}`), "Total due 3 of 40 items"]),
    right: [1, 2, 3].map((p) => [
      ...pad(`f${p}`),
      p === 2 ? "Total due 3 of 45 items" : "Total due 3 of 40 items",
    ]),
    edit: ["40 items", "45 items"],
  },
  "a vote tally shaped like a page number": {
    left: [
      [...pad("v1"), "Motion carried"],
      [...pad("v2"), "Votes in favour", "2 / 3"],
      [...pad("v3"), "End"],
    ],
    right: [
      [...pad("v1"), "Motion carried"],
      [...pad("v2"), "Votes in favour", "1 / 3"],
      [...pad("v3"), "End"],
    ],
    edit: ["2 / 3", "1 / 3"],
  },
  "a tally whose total changed, still on its own page": {
    left: [
      [...pad("w1"), "Motion carried"],
      [...pad("w2"), "Votes in favour", "2 / 3"],
      [...pad("w3"), "End"],
    ],
    right: [
      [...pad("w1"), "Motion carried"],
      [...pad("w2"), "Votes in favour", "2 / 5"],
      [...pad("w3"), "End"],
    ],
    edit: ["2 / 3", "2 / 5"],
  },
  "a table of contents' page reference": {
    left: [
      ["Contents", "Introduction", "Page 4", "Pricing schedule", "Page 12"],
      ...[2, 3].map((p) => pad(`t${p}`)),
    ],
    right: [
      ["Contents", "Introduction", "Page 4", "Pricing schedule", "Page 14"],
      ...[2, 3].map((p) => pad(`t${p}`)),
    ],
    edit: ["Page 12", "Page 14"],
  },
  "a rate repeated on three pages, changed on one": {
    left: [1, 2, 3, 4, 5, 6].map((p) => [
      p <= 3 ? "Interest rate: 5.0% per annum" : `Schedule ${p}`,
      ...pad(`k${p}`),
    ]),
    right: [1, 2, 3, 4, 5, 6].map((p) => [
      p <= 3
        ? p === 2
          ? "Interest rate: 7.5% per annum"
          : "Interest rate: 5.0% per annum"
        : `Schedule ${p}`,
      ...pad(`k${p}`),
    ]),
    edit: ["5.0%", "7.5%"],
  },
  "a clause at the top of 2 of 5 pages": {
    left: [1, 2, 3, 4, 5].map((p) => [
      p === 2 || p === 4
        ? "The Buyer shall pay the sum of USD 10,000."
        : `Heading ${p}`,
      ...pad(`c${p}`),
    ]),
    right: [1, 2, 3, 4, 5].map((p) => [
      p === 2 || p === 4
        ? "The Buyer shall pay the sum of USD 12,000."
        : `Heading ${p}`,
      ...pad(`c${p}`),
    ]),
    edit: ["10,000", "12,000"],
  },
  "a 2-page letter's date at the foot of both pages": {
    left: [
      [...pad("a"), "Effective date: 1 March 2026", "Signed"],
      [...pad("b"), "Effective date: 1 March 2026", "Signed"],
    ],
    right: [
      [...pad("a"), "Effective date: 1 April 2026", "Signed"],
      [...pad("b"), "Effective date: 1 April 2026", "Signed"],
    ],
    edit: ["March", "April"],
  },
  "a fee between margin line numbers": {
    left: [1, 2, 3].map((p) => [
      "1",
      `Section ${p} recital`,
      "2",
      `The fee is ${p}00 dollars`,
      "3",
      `End of section ${p}`,
      "4",
    ]),
    right: [1, 2, 3].map((p) => [
      "1",
      `Section ${p} recital`,
      "2",
      `The fee is ${p === 2 ? 250 : p * 100} dollars`,
      "3",
      `End of section ${p}`,
      "4",
    ]),
    edit: ["200 dollars", "250 dollars"],
  },
  "a table's last cell equal to its page number": {
    left: [
      [...pad("q1"), "Quantity"],
      [...pad("q2"), "Quantity", "2"],
      [...pad("q3"), "Quantity"],
    ],
    right: [
      [...pad("q1"), "Quantity"],
      [...pad("q2"), "Quantity", "7"],
      [...pad("q3"), "Quantity"],
    ],
    edit: ["2", "7"],
  },
};

/**
 * Positive controls: pairs whose page furniture DOES differ, so the option
 * has something to set aside. Without them "hides nothing" would pass for
 * an option that does nothing.
 */
const CONTROLS: Record<string, Case> = {
  "a page inserted, every footer renumbered, one real edit": {
    left: [1, 2, 3].map((p) => [
      "Acme Annual Report",
      ...pad(`r${p}`),
      `Page ${p} of 3`,
    ]),
    right: [
      ["Acme Annual Report", ...pad("r1"), "Page 1 of 4"],
      ["Acme Annual Report", ...pad("new"), "Page 2 of 4"],
      [
        "Acme Annual Report",
        ...pad("r2").map((l, i) => (i === 2 ? l.replace("text", "TEXT 2") : l)),
        "Page 3 of 4",
      ],
      ["Acme Annual Report", ...pad("r3"), "Page 4 of 4"],
    ],
    edit: ["r2 clause 3 text of", "r2 clause 3 TEXT 2 of"],
  },
  "a re-paginated report: the same words, every page break moved": {
    left: [0, 1, 2, 3].map((p) => [
      "Acme Corp — Confidential",
      ...Array.from({ length: 6 }, (_, i) => `body sentence ${p * 6 + i + 1}`),
      `Page ${p + 1} of 4`,
    ]),
    right: [0, 1, 2, 3, 4].map((p) => [
      "Acme Corp — Confidential",
      ...Array.from({ length: 6 }, (_, i) => p * 5 + i + 1)
        .filter((n) => n <= 24 && n <= p * 5 + 5)
        .map((n) => `body sentence ${n}`),
      `Page ${p + 1} of 5`,
    ]),
    edit: ["", ""],
  },
};

type Changed = { kind: string; text: string }[];
const changedOf = (r: PdfCompareResult): Changed =>
  r.diff
    .filter((d) => d.kind !== "same")
    .map(({ kind, text }) => ({ kind, text }));
const sig = (c: Changed) => c.map((d) => `${d.kind}:${d.text}`);

/** The verdict as it was computed on main (adb519ab): the joined texts, `===`. */
function legacyVerdict(l: ComparablePdfText, r: ComparablePdfText) {
  const norm = (t: string) =>
    t
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[\t ]+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
  return norm(l.extracted.text) === norm(r.extracted.text)
    ? "identical"
    : "different";
}

/**
 * The lines the option took out of the comparison: every line of a side
 * (same or removed for the first file, same or added for the second) as
 * the option-off diff holds them, minus the ones the option-on diff holds.
 * Tagged "removed" for the first file and "added" for the second. Not the
 * difference of the CHANGED lists: a line the option merely aligned better
 * leaves that list without having been set aside.
 */
function hiddenBy(off: PdfCompareResult, on: PdfCompareResult): Changed {
  const side = (r: PdfCompareResult, kind: "removed" | "added") =>
    r.diff
      .filter((d) => d.kind === "same" || d.kind === kind)
      .map((d) => d.text);
  return (["removed", "added"] as const).flatMap((kind) => {
    const kept = side(on, kind);
    return side(off, kind)
      .filter((text) => {
        const at = kept.indexOf(text);
        if (at < 0) return true;
        kept.splice(at, 1);
        return false;
      })
      .map((text) => ({ kind, text }));
  });
}

const isPageNumber = (t: string) =>
  RUNNING_PATTERNS.some(({ re }) => re.test(runningShape(t)));

const read: Record<string, [ComparablePdfText, ComparablePdfText]> = {};
beforeAll(async () => {
  for (const [name, c] of Object.entries({ ...CASES, ...CONTROLS }))
    read[name] = [
      await comparablePdf("left.pdf", c.left),
      await comparablePdf("right.pdf", c.right),
    ];
}, 120_000);

describe("compare: ignoring page furniture never hides a line whose words differ", () => {
  it("health: enough pairs, each read from a real PDF, each different with the option off as on main", () => {
    expect(Object.keys(CASES).length).toBeGreaterThanOrEqual(15);
    for (const [name, [l, r]] of Object.entries(read)) {
      expect(l.extracted.pageCount, name).toBeGreaterThan(0);
      const off = compareExtractedPdfText(l, r, {});
      expect(off.verdict, name).toBe(legacyVerdict(l, r));
      expect(off.verdict, name).toBe("different");
      if (name in CASES) {
        const [before, after] = CASES[name]!.edit;
        expect(
          sig(changedOf(off)).some(
            (s) => s.startsWith("removed:") && s.includes(before),
          ),
          name,
        ).toBe(true);
        expect(
          sig(changedOf(off)).some(
            (s) => s.startsWith("added:") && s.includes(after),
          ),
          name,
        ).toBe(true);
      }
    }
  });

  it("with the option on, each pair is different and lists its edit, the old value removed and the new one added", () => {
    const hidden: string[] = [];
    for (const [name, c] of Object.entries(CASES)) {
      const [l, r] = read[name]!;
      for (const opts of [
        { ignoreFurniture: true },
        { ignoreFurniture: true, ignoreCase: true },
      ]) {
        const on = compareExtractedPdfText(l, r, opts);
        const listed = sig(changedOf(on));
        const [before, after] = c.edit;
        if (
          on.verdict !== "different" ||
          !listed.some((s) => s.startsWith("removed:") && s.includes(before)) ||
          !listed.some((s) => s.startsWith("added:") && s.includes(after))
        )
          hidden.push(
            `${name} ${JSON.stringify(opts)}: ${on.verdict} ${JSON.stringify(listed)}`,
          );
      }
    }
    expect(hidden).toEqual([]);
  });

  it("where both files carry the same furniture, the option lists exactly what the option-off comparison lists", () => {
    const differ: string[] = [];
    for (const name of Object.keys(CASES)) {
      const [l, r] = read[name]!;
      const off = sig(changedOf(compareExtractedPdfText(l, r, {})));
      const onResult = compareExtractedPdfText(l, r, { ignoreFurniture: true });
      const on = sig(changedOf(onResult));
      if (
        JSON.stringify(on) !== JSON.stringify(off) ||
        onResult.dropped.left + onResult.dropped.right !== 0
      )
        differ.push(
          `${name}: off ${JSON.stringify(off)} on ${JSON.stringify(on)} dropped ${JSON.stringify(onResult.dropped)}`,
        );
    }
    expect(differ).toEqual([]);
  });

  it("positive control: where the furniture differs, the option sets it aside, only it, and counts it", () => {
    for (const name of Object.keys(CONTROLS)) {
      const [l, r] = read[name]!;
      const off = compareExtractedPdfText(l, r, {});
      const onResult = compareExtractedPdfText(l, r, { ignoreFurniture: true });
      const gone = hiddenBy(off, onResult);
      expect(gone.length, name).toBeGreaterThan(0);
      // Only furniture went: page numbers, and the running head.
      expect(
        gone.filter(
          (d) =>
            !isPageNumber(d.text) &&
            !/^Acme (Annual Report|Corp — Confidential)$/.test(d.text),
        ),
        name,
      ).toEqual([]);
      // The counts are the lines that went, per side.
      expect(onResult.dropped.left, name).toBe(
        gone.filter((d) => d.kind === "removed").length,
      );
      expect(onResult.dropped.right, name).toBe(
        gone.filter((d) => d.kind === "added").length,
      );
    }
    // The re-pagination is nothing but furniture: identical once it is set aside.
    const [l, r] =
      read["a re-paginated report: the same words, every page break moved"]!;
    expect(compareExtractedPdfText(l, r, {}).verdict).toBe("different");
    expect(
      compareExtractedPdfText(l, r, { ignoreFurniture: true }).verdict,
    ).toBe("identical");
    // The inserted page's real edit is still listed under the option.
    const [il, ir] =
      read["a page inserted, every footer renumbered, one real edit"]!;
    const listed = sig(
      changedOf(compareExtractedPdfText(il, ir, { ignoreFurniture: true })),
    );
    expect(
      listed.some((s) => s.startsWith("added:") && s.includes("TEXT 2")),
    ).toBe(true);
  });
});
