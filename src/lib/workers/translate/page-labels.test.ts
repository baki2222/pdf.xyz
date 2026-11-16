/**
 * Every page label a reader meets has one author, derived from the chosen
 * spans (audit #29 slice 6, D8), and is BYTE-IDENTICAL to the three old
 * writers for a whole-document job.
 *
 * The golden half keeps a FROZEN COPY of each writer as it stood on main
 * (6288d8ac) in this file, not an import: the writers now call `pagesLabel`,
 * so comparing against them would compare the function with itself. Built
 * from code points (house rule): the en dash is U+2013.
 */
import { describe, expect, it } from "vitest";
import { interruptedNotice } from "./assembly";
import { withheldPagesMarker } from "./chunking";
import { labelSpans, pagesLabel } from "./page-labels";
import { pageRangeLabel } from "./typeset";

const EN = String.fromCharCode(0x2013);

/** typeset.ts `pageRangeLabel` on 6288d8ac. */
function frozenPageRangeLabel(pages: readonly number[]): string {
  const first = pages[0];
  const last = pages[pages.length - 1];
  return pages.length === 1 || first === last
    ? `Page ${first}`
    : `Pages ${first}${EN}${last}`;
}

/** assembly.ts `interruptedNotice`'s list on 6288d8ac. */
function frozenInterruptedList(pages: readonly number[]): string {
  return pages.length === 1
    ? `Page ${pages[0]}`
    : `Pages ${pages[0]}${EN}${pages[pages.length - 1]}`;
}

/** chunking.ts `withheldPagesMarker`'s list on 6288d8ac. */
function frozenWithheldList(pages: readonly number[]): string {
  const first = pages[0];
  const last = pages[pages.length - 1];
  return pages.length === 1 ? `Page ${first}` : `Pages ${first}${EN}${last}`;
}

/** Page lists a whole-document job produces: single, runs, blank gaps, long. */
const WHOLE_DOCUMENT_LISTS: readonly (readonly number[])[] = [
  [1],
  [7],
  [100_000],
  [1, 2],
  [3, 4, 5],
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  [2, 4], // page 3 blank in a whole document: today's range is honest
  [5, 6, 8, 9], // page 7 blank
  [10, 20],
  [1, 3, 5, 7, 9],
  Array.from({ length: 400 }, (_, i) => i + 1),
  [98, 99, 100, 101],
  [4, 9, 10, 11, 12], // the pre-existing non-consecutive interrupted gap
];

describe("page labels: whole-document jobs keep main's bytes (golden)", () => {
  it("health: the golden corpus is the size it claims", () => {
    expect(WHOLE_DOCUMENT_LISTS.length).toBeGreaterThanOrEqual(12);
  });

  it.each(WHOLE_DOCUMENT_LISTS.map((l) => [l.length, l] as const))(
    "a %i-page list without a selection is labelled as on main",
    (_n, pages) => {
      const label = pagesLabel(pages, null);
      expect(label).toBe(frozenPageRangeLabel(pages));
      expect(label).toBe(frozenInterruptedList(pages));
      expect(label).toBe(frozenWithheldList(pages));
      expect(pageRangeLabel(pages, null)).toBe(frozenPageRangeLabel(pages));
    },
  );

  it("the full gap sentences are main's for a whole-document job", () => {
    const pages = [5, 6, 7];
    expect(interruptedNotice(pages, null)).toContain(
      `**Pages 5${EN}7 could not be translated.**`,
    );
    const withheld = withheldPagesMarker(
      pages,
      "characters",
      { characters: 4_000 },
      null,
      "separate-document",
    );
    expect(withheld).toContain(`**Pages 5${EN}7 are not translated.**`);
    expect(withheld).toContain(
      "This job reserved enough of the daily allowance for 4,000 characters of text, and the document holds more.",
    );
    expect(
      withheldPagesMarker(
        pages,
        "pages",
        { characters: 9, pages: 2 },
        null,
        "separate-document",
      ),
    ).toContain(
      "This document was submitted as 2 pages of text and holds more than that.",
    );
  });
});

describe("page labels: under a selection, only chosen pages are named", () => {
  const rows: readonly {
    pages: readonly number[];
    chosen: readonly (readonly [number, number])[];
    label: string;
  }[] = [
    {
      pages: [2, 4],
      chosen: [
        [2, 2],
        [4, 4],
      ],
      label: "Pages 2, 4",
    },
    {
      pages: [4, 9, 10, 11, 12],
      chosen: [
        [2, 2],
        [4, 4],
        [9, 12],
      ],
      label: `Pages 4, 9${EN}12`,
    },
    // Page 10 is a blank chosen page: it was chosen, so the range is honest.
    { pages: [9, 11], chosen: [[9, 12]], label: `Pages 9${EN}11` },
    { pages: [5], chosen: [[5, 6]], label: "Page 5" },
    {
      pages: [5, 6],
      chosen: [
        [2, 2],
        [4, 6],
      ],
      label: `Pages 5${EN}6`,
    },
    {
      pages: [4, 6],
      chosen: [
        [2, 2],
        [4, 4],
        [6, 6],
      ],
      label: "Pages 4, 6",
    },
  ];

  it.each(rows.map((r) => [r.label, r] as const))("%s", (_label, row) => {
    expect(pagesLabel(row.pages, row.chosen)).toBe(row.label);
    expect(pageRangeLabel(row.pages, row.chosen)).toBe(row.label);
    // Never a range that reaches across an unchosen page.
    for (const [a, b] of labelSpans(row.pages, row.chosen))
      for (let p = a; p <= b; p += 1)
        expect(
          row.chosen.some(([x, y]) => p >= x && p <= y),
          `page ${p} in "${row.label}" was not chosen`,
        ).toBe(true);
  });

  it("the verb's number matches the label's (one page if and only if singular)", () => {
    for (const row of rows) {
      const marker = withheldPagesMarker(
        row.pages,
        "characters",
        { characters: 1 },
        row.chosen,
        "separate-document",
      );
      const singular = row.pages.length === 1;
      expect(row.label.startsWith("Page ")).toBe(singular);
      expect(marker).toContain(
        `**${row.label} ${singular ? "is" : "are"} not translated.**`,
      );
    }
  });

  it("the gap sentences name the chosen pages, never the document", () => {
    const chosen = [
      [2, 2],
      [4, 4],
      [6, 6],
    ] as const;
    expect(interruptedNotice([4, 6], chosen)).toContain(
      "**Pages 4, 6 could not be translated.**",
    );
    const chars = withheldPagesMarker(
      [6],
      "characters",
      { characters: 4_000 },
      chosen,
      "separate-document",
    );
    expect(chars).toContain("the pages you chose hold more.");
    expect(chars).not.toContain("the document holds more");
    const pages = withheldPagesMarker(
      [6],
      "pages",
      { characters: 9, pages: 2 },
      chosen,
      "separate-document",
    );
    expect(pages).toContain(
      "The pages you chose were submitted as 2 pages of text and hold more than that.",
    );
    expect(pages).not.toContain("This document");
  });

  it("an empty page list has no spans to name", () => {
    expect(labelSpans([], null)).toEqual([]);
    expect(labelSpans([], [[1, 3]])).toEqual([]);
  });
});
