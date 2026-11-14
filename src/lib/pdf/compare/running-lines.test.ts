import { describe, expect, it } from "vitest";
import {
  RECURRENCE_RUN,
  RECURRENCE_SHARE,
  RUNNING_PATTERNS,
  detectRunningLines,
  runningShape,
} from "./running-lines";

/**
 * "Ignore page headers and numbers", held in BOTH directions with a corpus
 * (CLAUDE.md, guards rule 1): every line that must go is dropped, every line
 * that must stay is kept, and every pattern in RUNNING_PATTERNS catches a
 * corpus line — a pattern nothing exercises is decoration.
 *
 * One ten-page document. Each page: the company name on top, a body of
 * lines unique to the page, and a page number at the foot in one of the
 * shapes real generators write.
 *
 * WIDENED 2026-11-14 (review of audit compare-pdf#4), history kept: the
 * corpus had no must-keep line shaped like a ledger row, a running balance
 * or a table's last cell at a page edge, and the detector, which folded
 * every number into `#`, dropped all of them — a changed amount then
 * compared as identical. Those shapes are in MUST_KEEP now, at edges.
 */
const TAGS = [
  "alpha",
  "bravo",
  "charlie",
  "delta",
  "echo",
  "foxtrot",
  "golf",
  "hotel",
  "india",
  "juliet",
];
const FOOTERS = [
  "Page 1 of 40",
  "Page 2 of 40",
  "3 / 40",
  "- 4 -",
  "Page 12",
  "Page 6 of 40",
  "7",
  "Page 8 of 40",
  "Page 9 of 40",
  "Page 10 of 40",
];
/**
 * On pages 1-3: 3 of 10, under the 0.4 share (4 pages), but 3 pages in a
 * row. INVERTED 2026-11-14, history kept: this was a must-KEEP line, held
 * by the share alone — and the share is what hid a chapter's running head
 * in any book over 62 pages. A line repeated on three pages running is a
 * running head.
 */
const PARTIAL_HEADER = "Quarterly summary";
/** On pages 5, 7 and 9: three pages, under the share, never in a row. */
const SCATTERED = "Notes";
/** An edge line with digits, on one page. */
const BODY_WITH_DIGITS = "Total due: 100";
/** A body sentence quoting a page number, mid-page. */
const QUOTE = "Page 3 of 40";
/** Each page's last body line: a running balance, different on every page. */
const balance = (n: number) => `Balance carried forward: ${n * 1000}.00`;
/** Each page's first body line: a dated ledger row. */
const ledger = (n: number) =>
  `2026-0${(n % 9) + 1}-1${n % 10} Payment received ${100 + n * 12}.00`;
/** The amount cell a table ends a page with, on pages 2 and 6. */
const AMOUNTS: Record<number, string> = { 2: "4250", 6: "980" };

function page(n: number): string[] {
  const tag = TAGS[n - 1]!;
  const bodyLines = Array.from(
    { length: 5 },
    (_, i) => `${tag} body line ${i + 1}`,
  );
  if (n === 9) bodyLines.splice(2, 0, QUOTE);
  return [
    "Acme Corp",
    ...(n <= 3 ? [PARTIAL_HEADER] : []),
    ...([5, 7, 9].includes(n) ? [SCATTERED] : []),
    ...(n === 8 ? [BODY_WITH_DIGITS] : []),
    ...([4, 6, 10].includes(n) ? [ledger(n)] : []),
    ...bodyLines,
    ...(AMOUNTS[n] ? [AMOUNTS[n]] : [balance(n)]),
    FOOTERS[n - 1]!,
  ];
}

const DOC = Array.from({ length: 10 }, (_, i) =>
  page(i + 1).map((text) => ({ text, page: i + 1 })),
).flat();

const MUST_DROP = [
  "Page 1 of 40",
  "3 / 40",
  "- 4 -",
  "7",
  "Acme Corp",
  PARTIAL_HEADER,
] as const;
/**
 * Page 5's footer, "Page 12", is 7 off its page where every other footer is
 * 0 off: a page REFERENCE (a table of contents' line), not this page's
 * number. INVERTED 2026-11-14 (second review of audit compare-pdf#4),
 * history kept: it was a must-DROP line, because a form with the word
 * "page" in it counted on any edge on its form alone, and a TOC's
 * "Page 12" changed to "Page 14" compared as identical. A page number is a
 * candidate now only where its distance from the page repeats.
 */
const PAGE_REFERENCE = "Page 12";
const MUST_KEEP = [
  PAGE_REFERENCE,
  BODY_WITH_DIGITS,
  SCATTERED,
  QUOTE,
  ...Object.values(AMOUNTS),
  ...[1, 3, 4, 5, 7, 8, 9, 10].map(balance),
  ...[4, 6, 10].map(ledger),
] as const;

function droppedFrom(doc: readonly { text: string; page: number }[]) {
  const running = detectRunningLines(doc);
  return doc.filter((_, i) => running.has(i));
}
const dropped = () => droppedFrom(DOC);

/** Is `text` among the first two or last two lines of every page it is on? */
function atAnEdge(
  doc: readonly { text: string; page: number }[],
  text: string,
) {
  return doc
    .filter((l) => l.text === text)
    .every(({ page: p }) => {
      const on = doc.filter((l) => l.page === p).map((l) => l.text);
      const at = on.indexOf(text);
      return at < 2 || at >= on.length - 2;
    });
}

describe("running lines: the corpus, both directions", () => {
  it("health: the corpus is what it says", () => {
    expect(DOC.length).toBeGreaterThanOrEqual(90);
    expect(new Set(DOC.map((l) => l.page)).size).toBe(10);
    // The quote really is mid-page, not at an edge.
    const p9 = DOC.filter((l) => l.page === 9).map((l) => l.text);
    const at = p9.indexOf(QUOTE);
    expect(at).toBeGreaterThanOrEqual(2);
    expect(at).toBeLessThan(p9.length - 2);
    // The partial header is at an edge (so it IS a candidate) on 3 pages.
    expect(
      DOC.filter((l) => l.text === PARTIAL_HEADER).map((l) => l.page),
    ).toEqual([1, 2, 3]);
    expect(DOC.filter((l) => l.text === SCATTERED).map((l) => l.page)).toEqual([
      5, 7, 9,
    ]);
    // Every must-keep line but the quote is a CANDIDATE: at an edge, so the
    // place rule is not what keeps it.
    for (const text of MUST_KEEP.filter((t) => t !== QUOTE)) {
      expect(
        DOC.some((l) => l.text === text),
        `${text} missing`,
      ).toBe(true);
      expect(atAnEdge(DOC, text), `${text} not at an edge`).toBe(true);
    }
    // The amounts and balances share one shape page to page — the shape the
    // detector folded until 2026-11-14 — so the corpus can tell.
    expect(new Set([1, 3, 4].map((n) => runningShape(balance(n)))).size).toBe(
      1,
    );
  });

  it("every must-drop line is dropped wherever it stands", () => {
    const gone = dropped();
    for (const text of MUST_DROP) {
      const all = DOC.filter((l) => l.text === text);
      expect(all.length, text).toBeGreaterThan(0);
      expect(
        gone.filter((l) => l.text === text).length,
        `${text} survived`,
      ).toBe(all.length);
    }
  });

  it("every must-keep line is kept, and so is every body line", () => {
    const gone = new Set(dropped().map((l) => l.text));
    expect(MUST_KEEP.filter((t) => gone.has(t))).toEqual([]);
    const bodies = DOC.filter((l) => /body line/.test(l.text));
    expect(bodies.length).toBe(50);
    expect(bodies.filter((l) => gone.has(l.text))).toEqual([]);
  });

  it("every pattern catches a must-drop line (no decoration), and none a must-keep line at an edge", () => {
    const idle = RUNNING_PATTERNS.filter(
      ({ re }) => !MUST_DROP.some((t) => re.test(runningShape(t))),
    ).map(({ re }) => String(re));
    expect(idle).toEqual([]);
    // The quote matches a pattern by its words: only its place keeps it.
    expect(
      RUNNING_PATTERNS.some(({ re }) => re.test(runningShape(QUOTE))),
    ).toBe(true);
    expect(
      RUNNING_PATTERNS.some(({ re }) =>
        re.test(runningShape(BODY_WITH_DIGITS)),
      ),
    ).toBe(false);
    // A table's amount cell has a page number's FORM: only the tracking
    // rule keeps it.
    for (const amount of Object.values(AMOUNTS))
      expect(
        RUNNING_PATTERNS.some(({ re }) => re.test(runningShape(amount))),
      ).toBe(true);
  });

  it("the company name goes by recurrence alone, not by a pattern", () => {
    expect(
      RUNNING_PATTERNS.some(({ re }) => re.test(runningShape("Acme Corp"))),
    ).toBe(false);
  });

  /*
   * INVERTED 2026-11-14 (history kept): this test was "a short document has
   * no recurrence to go on, only page-number shapes", and pinned the company
   * name KEPT on both pages of a two-page file, under a floor of three pages
   * — while the FAQ said a line repeated on most pages goes. Two of two is
   * every page.
   */
  it("a two-page document: a line on both pages repeats, a line on one does not", () => {
    const two = [
      { text: "Acme Corp", page: 1 },
      { text: "Body one", page: 1 },
      { text: "Page 1 of 2", page: 1 },
      { text: "Acme Corp", page: 2 },
      { text: "Body two", page: 2 },
      { text: "Page 2 of 2", page: 2 },
    ];
    expect(droppedFrom(two).map((l) => l.text)).toEqual([
      "Acme Corp",
      "Page 1 of 2",
      "Acme Corp",
      "Page 2 of 2",
    ]);
  });

  /*
   * INVERTED 2026-11-14 (second review of audit compare-pdf#4), history
   * kept: this was "only a page number goes, never a bare amount", and
   * pinned a one-page file's closing "1" as a page number by its form. One
   * page repeats nothing, and the same rule let "2 / 3" closing a vote tally
   * on page 2 of 3 go as a page number. A one-page document has no
   * candidates at all.
   */
  it("a one-page document: nothing is a candidate, not even a page-number shape", () => {
    const invoice = ["Invoice 42", "Widget", "Qty 3", "Amount due", "4250"].map(
      (text) => ({ text, page: 1 }),
    );
    expect(droppedFrom(invoice)).toEqual([]);
    const numbered = ["Invoice 42", "Widget", "Amount due 4250", "1"].map(
      (text) => ({ text, page: 1 }),
    );
    expect(droppedFrom(numbered)).toEqual([]);
  });

  it("a page number goes only where its distance from the page repeats", () => {
    const tally = [
      ["Minutes", "body a", "Motion carried"],
      ["Votes", "body b", "Votes in favour", "2 / 3"],
      ["Close", "body c", "End"],
    ].flatMap((lines, p) => lines.map((text) => ({ text, page: p + 1 })));
    expect(droppedFrom(tally)).toEqual([]);
    const numbered = [1, 2, 3].flatMap((p) =>
      [`head ${p}`, `body ${p}`, `${p} / 3`].map((text) => ({ text, page: p })),
    );
    expect(droppedFrom(numbered).map((l) => l.text)).toEqual([
      "1 / 3",
      "2 / 3",
      "3 / 3",
    ]);
  });
});

describe("running lines: page numbers and running heads that change", () => {
  it("a header with the page number in it repeats as one line; a body line with a number does not", () => {
    const pages = Array.from({ length: 6 }, (_, i) => i + 1);
    const doc = pages.flatMap((p) =>
      [
        `Annual report 2026 · ${p + 2}`,
        `Coffee ${p} 3.50`,
        `unique body ${p}`,
        `more body ${p}`,
        `Total spent: ${p * 37}.00`,
      ].map((text) => ({ text, page: p })),
    );
    const gone = droppedFrom(doc).map((l) => l.text);
    // The header's number is the page's plus 2 on every page: it tracks.
    expect(gone).toEqual(pages.map((p) => `Annual report 2026 · ${p + 2}`));
  });

  it("a book's chapter heads go at any length: the run finds what the share cannot", () => {
    const CHAPTER = 25;
    for (const pages of [50, 100, 500]) {
      const doc: { text: string; page: number }[] = [];
      for (let p = 1; p <= pages; p += 1) {
        const ch = Math.ceil(p / CHAPTER);
        doc.push({
          text: `Chapter ${"ABCDEFGHIJKLMNOPQRST"[ch - 1]}: Results`,
          page: p,
        });
        for (let i = 0; i < 6; i += 1)
          doc.push({ text: `body ${p}-${i} unique sentence`, page: p });
      }
      // Health: past 62 pages no head is on the share's worth of pages, so
      // only the run can find them.
      if (pages >= 100)
        expect(CHAPTER).toBeLessThan(Math.ceil(RECURRENCE_SHARE * pages));
      expect(CHAPTER).toBeGreaterThanOrEqual(RECURRENCE_RUN);
      const gone = droppedFrom(doc);
      expect(gone.length, `${pages} pages`).toBe(pages);
      expect(
        gone.every((l) => l.text.startsWith("Chapter")),
        `${pages}`,
      ).toBe(true);
    }
  });
});
