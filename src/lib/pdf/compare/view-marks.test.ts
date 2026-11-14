// @vitest-environment node
// @native-canvas
import { describe, expect, it } from "vitest";
import { degrees, PDFDocument, StandardFonts } from "pdf-lib";
import {
  body,
  linesPdf,
  pageHeaderPair,
  type PageLines,
} from "@/tests/compare-fixtures";
import {
  rangeText,
  runCompareViewChain,
  type ChainRun,
} from "@/tests/compare-view-chain";
import { manyTextItemsPdf } from "@/tests/viewer-fixtures";
import { normalizeExtractedText, textItemsToPlainText } from "@/lib/pdf/text";
import { VIEWER_MAX_TEXT_ITEMS } from "@/lib/pdf/viewer-geometry";
import type { SearchItem } from "@/lib/pdf/viewer-search";
import type { CompareOptions } from "./lines";
import { normalizeComparableText } from "./lines";
import { streamLines } from "./view-marks";

/**
 * Compare PDF's page view puts each changed line's marks on the page's own
 * text (S2 of audit compare-pdf#2, 2026-11-15). Judged here on REAL PDFs,
 * through the composed chain the browser runs (`compare-view-chain.ts`):
 * extract, compare, open with the viewer's open, read the text the text
 * layer draws, place.
 *
 * The corpus is the record below, read whole (nothing names a subset), and
 * bounded both ways. Each case says what the reader must see; the general
 * assertions hold for every placed line of every case:
 *
 *  - each segment's ranges read back as the segment's text, and its kind is
 *    one the side can carry (removed or line on the first file, added or
 *    line on the second);
 *  - the line's ranges, joined, normalise to the line's text;
 *  - the items it lands on are the items the FIXTURE drew that line as,
 *    computed from the fixture, not from the placement (one drawn line is
 *    one pdf.js item in every builder here — the health check holds that).
 *
 * A changed line that cannot be placed must be flagged, never guessed: a
 * duplicated line on a page whose stream order is not its reading order,
 * and every change on a page past VIEWER_MAX_TEXT_ITEMS.
 */

interface Line {
  text: string;
  x: number;
  y: number;
  size?: number;
  rotate?: number;
}

interface DrawnPage {
  /** Lines in DRAW (content-stream) order. */
  draw: Line[];
  rotate?: 90;
}

/** One page per entry, Helvetica, lines drawn in the order given. */
async function drawnPdf(pages: readonly DrawnPage[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const spec of pages) {
    const page = doc.addPage([612, 792]);
    if (spec.rotate) page.setRotation(degrees(spec.rotate));
    for (const line of spec.draw) {
      page.drawText(line.text, {
        x: line.x,
        y: line.y,
        size: line.size ?? 12,
        font,
        ...(line.rotate ? { rotate: degrees(line.rotate) } : {}),
      });
    }
  }
  return doc.save();
}

const column = (prefix: string, x: number, top: number, n: number): Line[] =>
  Array.from({ length: n }, (_, i) => ({
    text: `${prefix} line ${i + 1}`,
    x,
    y: top - i * 14,
  }));

const LEFT = column("Left column", 72, 700, 6);
const RIGHT = column("Right column", 330, 700, 6);
const edit = (lines: Line[], at: number, text: string): Line[] =>
  lines.map((l, i) => (i === at ? { ...l, text } : l));

/** A page whose stream draws the title last and a later paragraph first. */
const TITLE_AFTER_BODY = (first: string): Line[] => [
  { text: "Second paragraph of body.", x: 72, y: 600 },
  { text: "Document Title", x: 72, y: 720, size: 20 },
  { text: first, x: 72, y: 660 },
  { text: "It continues on a second line.", x: 72, y: 646 },
];

/** Reordered, with "Total: 10" twice; the copy read SECOND is drawn first. */
const REORDERED_DUPLICATE = (second: string): Line[] => [
  { text: second, x: 72, y: 600 },
  { text: "Statement Heading", x: 72, y: 720, size: 18 },
  { text: "Total: 10", x: 72, y: 660 },
  { text: "Closing words of the statement.", x: 72, y: 560 },
];

interface Expect {
  side: "left" | "right";
  page: number;
  /** Text that must be covered by a mark of this kind on that page. */
  text: string;
  kind: "removed" | "added" | "line";
  /**
   * The line's place in the page's DRAW order (the fixture's own list):
   * the mark must sit on the item pdf.js made of that drawn line — the
   * `item`-th item with any text, since pdf.js adds empty items to end
   * lines and every builder here draws one item per line.
   */
  item?: number;
}

interface Case {
  left: () => Promise<Uint8Array>;
  right: () => Promise<Uint8Array>;
  options?: CompareOptions;
  /** Pages whose stream order is NOT reading order (health-checked). */
  outOfOrder?: { side: "left" | "right"; page: number }[];
  expect?: Expect[];
  /** Changed lines that must be flagged, by side and page. */
  flagged?: { side: "left" | "right"; page: number; text: string }[];
  capped?: boolean;
}

const lines = (pages: readonly PageLines[]) => () => linesPdf(pages);
const drawn = (pages: readonly DrawnPage[]) => () => drawnPdf(pages);
const DUP_BEFORE = [
  "Invoice 2026-11",
  "Total: 10",
  "Items listed below",
  "Total: 10",
  "Signed by the buyer",
];
const DUP_AFTER = DUP_BEFORE.map((l, i) => (i === 3 ? "Total: 12" : l));

const CORPUS: Record<string, Case> = {
  "the page-header pair (edit on v1 page 2, v2 page 3)": {
    left: lines(pageHeaderPair().left),
    right: lines(pageHeaderPair().right),
    expect: [
      { side: "left", page: 2, text: "100", kind: "removed", item: 6 },
      { side: "left", page: 2, text: "Total due: ", kind: "line", item: 6 },
      { side: "right", page: 3, text: "120", kind: "added", item: 6 },
    ],
  },
  "the page-header pair with a blank page before the insert": {
    left: lines(pageHeaderPair({ blank: true }).left),
    right: lines(pageHeaderPair({ blank: true }).right),
    expect: [
      { side: "left", page: 2, text: "100", kind: "removed", item: 6 },
      { side: "right", page: 4, text: "120", kind: "added", item: 6 },
    ],
  },
  "a duplicated line, the second copy edited": {
    left: lines([DUP_BEFORE]),
    right: lines([DUP_AFTER]),
    expect: [
      { side: "left", page: 1, text: "10", kind: "removed", item: 3 },
      { side: "right", page: 1, text: "12", kind: "added", item: 3 },
    ],
  },
  "a line removed and an unrelated line added (unpaired, filled whole)": {
    left: lines([[...body("keep", 4), "Clause seven is struck out entirely"]]),
    right: lines([
      [...body("keep", 4), "A brand new clause appears in its place"],
    ]),
    expect: [
      {
        side: "left",
        page: 1,
        text: "Clause seven is struck out entirely",
        kind: "removed",
        item: 4,
      },
      {
        side: "right",
        page: 1,
        text: "A brand new clause appears in its place",
        kind: "added",
        item: 4,
      },
    ],
  },
  "two columns drawn a column at a time": {
    left: drawn([{ draw: [...LEFT, ...RIGHT] }]),
    right: drawn([
      { draw: [...LEFT, ...edit(RIGHT, 2, "Right column line 3 revised")] },
    ]),
    expect: [
      { side: "right", page: 1, text: " revised", kind: "added", item: 8 },
    ],
  },
  "out of order: the title drawn after the body": {
    left: drawn([{ draw: TITLE_AFTER_BODY("First paragraph of body.") }]),
    right: drawn([{ draw: TITLE_AFTER_BODY("First paragraph of the body.") }]),
    outOfOrder: [
      { side: "left", page: 1 },
      { side: "right", page: 1 },
    ],
    expect: [
      { side: "right", page: 1, text: "the ", kind: "added", item: 2 },
      {
        side: "left",
        page: 1,
        text: "First paragraph of ",
        kind: "line",
        item: 2,
      },
    ],
  },
  "out of order with a duplicated line edited: flagged, not guessed": {
    left: drawn([{ draw: REORDERED_DUPLICATE("Total: 10") }]),
    right: drawn([{ draw: REORDERED_DUPLICATE("Total: 15") }]),
    outOfOrder: [
      { side: "left", page: 1 },
      { side: "right", page: 1 },
    ],
    flagged: [{ side: "left", page: 1, text: "Total: 10" }],
    // The edited copy on the second file is unique there ("Total: 15").
    expect: [{ side: "right", page: 1, text: "15", kind: "added", item: 0 }],
  },
  "a page turned by /Rotate 90": {
    left: drawn([{ rotate: 90, draw: column("Turned", 72, 700, 5) }]),
    right: drawn([
      {
        rotate: 90,
        draw: edit(column("Turned", 72, 700, 5), 1, "Turned line 2 changed"),
      },
    ]),
    expect: [
      { side: "right", page: 1, text: " changed", kind: "added", item: 1 },
    ],
  },
  "rotated text on the page (stream order kept)": {
    left: drawn([
      {
        draw: [
          { text: "A rotated margin note", x: 560, y: 200, rotate: 90 },
          ...column("Plain", 72, 700, 4),
        ],
      },
    ]),
    right: drawn([
      {
        draw: [
          { text: "A rotated margin note", x: 560, y: 200, rotate: 90 },
          ...edit(column("Plain", 72, 700, 4), 2, "Plain line 3 amended"),
        ],
      },
    ]),
    expect: [
      { side: "left", page: 1, text: "Plain line 3", kind: "line", item: 3 },
      { side: "right", page: 1, text: "amended", kind: "added", item: 3 },
    ],
  },
  "ignore case: a pair differing in case and a number": {
    left: lines([["Header Line", "TOTAL DUE: 100", "Footer text here"]]),
    right: lines([["header line", "Total Due: 120", "Footer text here"]]),
    options: { ignoreCase: true },
    expect: [
      { side: "left", page: 1, text: "100", kind: "removed", item: 1 },
      { side: "left", page: 1, text: "TOTAL DUE: ", kind: "line", item: 1 },
      { side: "right", page: 1, text: "Total Due: ", kind: "line", item: 1 },
      { side: "right", page: 1, text: "120", kind: "added", item: 1 },
    ],
  },
  "running headers set aside, an edit in the body": {
    left: lines([
      ["Acme Corp", ...body("p1", 5), "Page 1 of 2"],
      ["Acme Corp", ...body("p2", 5), "Page 2 of 2"],
    ]),
    right: lines([
      ["Acme Corp", ...body("p1", 5), "Page 1 of 2"],
      [
        "Acme Corp",
        ...body("p2", 3),
        "p2 body line 4 edited",
        "p2 body line 5",
        "Page 2 of 2",
      ],
    ]),
    options: { ignoreFurniture: true },
    expect: [
      { side: "right", page: 2, text: " edited", kind: "added", item: 4 },
    ],
  },
  "one change across a page break (a hunk on two pages)": {
    left: lines([body("first", 6), body("second", 6)]),
    right: lines([
      [...body("first", 5), "first body line 6 moved"],
      ["second body line 1 moved", ...body("second", 6).slice(1)],
    ]),
    expect: [
      { side: "right", page: 1, text: " moved", kind: "added", item: 5 },
      { side: "right", page: 2, text: " moved", kind: "added", item: 0 },
    ],
  },
  "a page with no selectable text in the middle": {
    left: lines([body("one", 4), [], body("three", 4)]),
    right: lines([
      body("one", 4),
      [],
      [...body("three", 3), "three body line 4 new"],
    ]),
    expect: [{ side: "right", page: 3, text: " new", kind: "added", item: 3 }],
  },
  "a page past the text-item cap: every change on it flagged": {
    left: async () => manyTextItemsPdf(VIEWER_MAX_TEXT_ITEMS + 1),
    right: async () => manyTextItemsPdf(VIEWER_MAX_TEXT_ITEMS + 150),
    capped: true,
  },
};

let runs: Map<string, ChainRun> | null = null;
async function all(): Promise<Map<string, ChainRun>> {
  if (runs) return runs;
  const out = new Map<string, ChainRun>();
  for (const [name, c] of Object.entries(CORPUS)) {
    out.set(
      name,
      await runCompareViewChain(await c.left(), await c.right(), c.options),
    );
  }
  runs = out;
  return out;
}

const PER_CASE_TIMEOUT = 120_000;

describe("Compare PDF's page marks, judged on real PDFs through the composed chain", () => {
  it(
    "health: the corpus is the size it claims, and its fixtures are what they claim",
    async () => {
      const names = Object.keys(CORPUS);
      expect(names.length).toBeGreaterThanOrEqual(12);
      expect(names.length).toBeLessThanOrEqual(40);
      const got = await all();
      for (const [name, c] of Object.entries(CORPUS)) {
        const run = got.get(name)!;
        // Every case compares different files, or it proves nothing.
        expect(run.result.verdict, name).toBe("different");
        for (const o of c.outOfOrder ?? []) {
          const p = run.pages.find(
            (x) => x.side === o.side && x.page === o.page,
          )!;
          const stream = streamLines(p.text.items).map((l) => l.norm);
          expect(stream, `${name}: stream order differs`).not.toEqual(
            p.readingLines,
          );
        }
        if (c.capped)
          expect(
            run.pages.some((p) => p.text.capped),
            name,
          ).toBe(true);
      }
    },
    PER_CASE_TIMEOUT,
  );

  it(
    "every placed line: segments read back, kinds fit the side, the line normalises to its text, and it sits on the items the fixture drew",
    async () => {
      let placed = 0;
      let checkedItems = 0;
      for (const [name, run] of await all()) {
        for (const p of run.pages) {
          for (const line of p.placement.lines) {
            placed += 1;
            const joined = line.segments
              .map((s) => rangeText(p.text, s.ranges))
              .join("");
            expect(
              joined.replace(/[\t ]+/g, " ").trim(),
              `${name} ${p.side} p${p.page}`,
            ).toBe(line.change.line.text);
            for (const s of line.segments) {
              expect(
                rangeText(p.text, s.ranges).replace(/[\t ]+/g, " "),
                `${name}: segment`,
              ).toBe(s.text.replace(/[\t ]+/g, " "));
              expect(
                p.side === "left" ? ["removed", "line"] : ["added", "line"],
                `${name}: kind`,
              ).toContain(s.kind);
              for (const r of s.ranges) expect(r.kind).toBe(s.kind);
            }
            // Independent of the placement: the items whose string IS the
            // line (one drawn line, one item).
            const items = line.segments.flatMap((s) =>
              s.ranges.map((r) => r.item),
            );
            const candidates = p.text.items.flatMap((it, i) =>
              it.str.replace(/[\t ]+/g, " ").trim() === line.change.line.text
                ? [i]
                : [],
            );
            expect(
              candidates.length,
              `${name}: one item per line`,
            ).toBeGreaterThan(0);
            for (const i of items) {
              expect(candidates, `${name}: lands on its own line`).toContain(i);
              checkedItems += 1;
            }
            // Unpaired: filled whole. Skipped by a bound: outline only.
            if (line.change.tokens === undefined)
              expect(new Set(line.segments.map((s) => s.kind))).toEqual(
                new Set([line.change.kind]),
              );
            if (line.change.tokens === null)
              expect(new Set(line.segments.map((s) => s.kind))).toEqual(
                new Set(["line"]),
              );
          }
        }
      }
      expect(placed).toBeGreaterThanOrEqual(20);
      expect(checkedItems).toBeGreaterThanOrEqual(placed);
    },
    PER_CASE_TIMEOUT,
  );

  it(
    "each case's marks are where its reader must see them, on the item computed from the fixture",
    async () => {
      const got = await all();
      let checked = 0;
      for (const [name, c] of Object.entries(CORPUS)) {
        const run = got.get(name)!;
        for (const e of c.expect ?? []) {
          const p = run.pages.find(
            (x) => x.side === e.side && x.page === e.page,
          )!;
          const drawnItem =
            e.item === undefined
              ? undefined
              : p.text.items.flatMap((it, i) => (it.str !== "" ? [i] : []))[
                  e.item
                ];
          const hit = p.placement.lines
            .flatMap((l) => l.segments)
            .filter(
              (s) =>
                s.kind === e.kind &&
                // Where a run of spaces falls (before or after a word) is
                // the word diff's choice; the words are the claim.
                rangeText(p.text, s.ranges).trim() === e.text.trim() &&
                (drawnItem === undefined ||
                  s.ranges.every((r) => r.item === drawnItem)),
            );
          expect(
            hit.length,
            `${name}: ${e.kind} "${e.text}" on ${e.side} page ${e.page}${e.item === undefined ? "" : ` item ${e.item}`}`,
          ).toBeGreaterThan(0);
          checked += 1;
        }
        for (const f of c.flagged ?? []) {
          const p = run.pages.find(
            (x) => x.side === f.side && x.page === f.page,
          )!;
          expect(
            p.placement.flagged.map((ch) => ch.line.text),
            `${name}: flagged`,
          ).toContain(f.text);
          expect(
            p.placement.lines.map((l) => l.change.line.text),
            `${name}: nothing drawn for a flagged line`,
          ).not.toContain(f.text);
        }
      }
      expect(checked).toBeGreaterThanOrEqual(20);
    },
    PER_CASE_TIMEOUT,
  );

  it(
    "a page past the item cap draws nothing and flags every change on it",
    async () => {
      const run = (await all()).get(
        "a page past the text-item cap: every change on it flagged",
      )!;
      const capped = run.pages.filter((p) => p.text.capped);
      expect(capped.length).toBeGreaterThan(0);
      for (const p of capped) {
        expect(p.placement.matches).toEqual([]);
        expect(p.placement.flagged.length).toBeGreaterThan(0);
      }
    },
    PER_CASE_TIMEOUT,
  );

  it(
    "floors: most changes are placed, some are flagged, and a reordered page is placed on",
    async () => {
      let total = 0;
      let placed = 0;
      let flagged = 0;
      let onReordered = 0;
      for (const [name, c] of Object.entries(CORPUS)) {
        const run = (await all()).get(name)!;
        for (const p of run.pages) {
          total += p.placement.lines.length + p.placement.flagged.length;
          placed += p.placement.lines.length;
          flagged += p.placement.flagged.length;
          if (c.outOfOrder?.some((o) => o.side === p.side && o.page === p.page))
            onReordered += p.placement.lines.length;
        }
      }
      // Capped pages flag by design; the floor is over the rest.
      const cappedFlags = [...(await all()).values()]
        .flatMap((r) => r.pages)
        .filter((p) => p.text.capped)
        .reduce((n, p) => n + p.placement.flagged.length, 0);
      expect(placed / (total - cappedFlags)).toBeGreaterThanOrEqual(0.8);
      expect(flagged).toBeGreaterThanOrEqual(1);
      expect(onReordered).toBeGreaterThanOrEqual(1);
    },
    PER_CASE_TIMEOUT,
  );
});

describe("a page's stream lines and its reading lines are one multiset (G2)", () => {
  /** Items no real PDF here yields (pdf.js turns a CR into a space). */
  const SYNTHETIC: Record<string, SearchItem[]> = {
    "CR and CRLF inside items": [
      { str: "First half\rsecond half", hasEOL: true },
      { str: "Third\r\nfourth" },
    ],
    "runs of spaces and tabs, blank lines": [
      { str: "  Total \t due:  100 ", hasEOL: true },
      { str: "   ", hasEOL: true },
      { str: "next" },
    ],
  };

  const readingOf = (items: SearchItem[]) =>
    normalizeComparableText(
      normalizeExtractedText(textItemsToPlainText(items)),
    );
  const sorted = (xs: readonly string[]) => [...xs].sort();

  it(
    "on every page of the corpus but the capped ones, and on the synthetic items",
    async () => {
      let pages = 0;
      for (const [name, run] of await all()) {
        for (const p of run.pages) {
          if (p.text.capped) continue;
          pages += 1;
          expect(
            sorted(streamLines(p.text.items).map((l) => l.norm)),
            `${name} ${p.side} p${p.page}`,
          ).toEqual(sorted(p.readingLines));
        }
      }
      expect(pages).toBeGreaterThanOrEqual(30);
      for (const [name, items] of Object.entries(SYNTHETIC))
        expect(sorted(streamLines(items).map((l) => l.norm)), name).toEqual(
          sorted(readingOf(items)),
        );
    },
    PER_CASE_TIMEOUT,
  );

  it("each stream line maps its normalised characters back to the raw text", () => {
    for (const items of Object.values(SYNTHETIC)) {
      const text = items.map((i) => i.str + (i.hasEOL ? "\n" : "")).join("");
      for (const l of streamLines(items)) {
        let read = "";
        for (let k = 0; k < l.norm.length; k++)
          read += text[l.rawFrom + l.map[k]!];
        expect(read.replace(/[\t ]/g, " ")).toBe(l.norm);
        expect(l.map.length).toBe(l.norm.length + 1);
      }
    }
  });
});
