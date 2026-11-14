import { describe, expect, it } from "vitest";
import {
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
  "Page 7 of 40",
  "Page 8 of 40",
  "Page 9 of 40",
  "Page 10 of 40",
];
/** On pages 1-3 only: 3 of 10, under the 0.4 share (4 pages). */
const PARTIAL_HEADER = "Quarterly summary";
/** An edge line with digits, on one page. */
const BODY_WITH_DIGITS = "Total due: 100";
/** A body sentence quoting a page number, mid-page. */
const QUOTE = "Page 3 of 40";

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
    ...(n === 8 ? [BODY_WITH_DIGITS] : []),
    ...bodyLines,
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
  "Page 12",
  "Acme Corp",
] as const;
const MUST_KEEP = [BODY_WITH_DIGITS, PARTIAL_HEADER, QUOTE] as const;

function dropped(): { text: string; page: number }[] {
  const running = detectRunningLines(DOC);
  return DOC.filter((_, i) => running.has(i));
}

describe("running lines: the corpus, both directions", () => {
  it("health: the corpus is what it says", () => {
    expect(DOC.length).toBeGreaterThanOrEqual(70);
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

  it("every pattern catches a must-drop line (no decoration), and none a must-keep line", () => {
    const idle = RUNNING_PATTERNS.filter(
      (p) => !MUST_DROP.some((t) => p.test(runningShape(t))),
    ).map(String);
    expect(idle).toEqual([]);
    // The quote matches a pattern by its words: only its place keeps it.
    expect(RUNNING_PATTERNS.some((p) => p.test(runningShape(QUOTE)))).toBe(
      true,
    );
    expect(
      RUNNING_PATTERNS.some((p) => p.test(runningShape(BODY_WITH_DIGITS))),
    ).toBe(false);
  });

  it("the company name goes by recurrence alone, not by a pattern", () => {
    expect(
      RUNNING_PATTERNS.some((p) => p.test(runningShape("Acme Corp"))),
    ).toBe(false);
  });

  it("a short document has no recurrence to go on, only page-number shapes", () => {
    const two = [
      { text: "Acme Corp", page: 1 },
      { text: "Body one", page: 1 },
      { text: "Page 1 of 2", page: 1 },
      { text: "Acme Corp", page: 2 },
      { text: "Body two", page: 2 },
      { text: "Page 2 of 2", page: 2 },
    ];
    const running = detectRunningLines(two);
    expect(two.filter((_, i) => running.has(i)).map((l) => l.text)).toEqual([
      "Page 1 of 2",
      "Page 2 of 2",
    ]);
  });
});
