import { describe, expect, it } from "vitest";
import {
  findInItems,
  itemRangesFor,
  pageSearchText,
  type SearchItem,
} from "./viewer-search";

/**
 * `itemRangesFor` is the one way text offsets of a page become character
 * ranges inside its items: the search highlights through it, and Compare
 * PDF's page view marks its changed lines through it (S2, 2026-11-15). So
 * its PROPERTY is held here over generated pages, not a few examples: the
 * ranges, read back out of the items, are exactly the text between the two
 * offsets with the separators (the line break after an item that ends a
 * line) taken out, in order, never empty, never outside their item.
 */

/** A small deterministic generator, so a failure names a reproducible case. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const ALPHABET = ["a", "b", "Z", " ", "\t", "é", "1", "-"];

function page(rand: () => number): SearchItem[] {
  const n = 1 + Math.floor(rand() * 12);
  return Array.from({ length: n }, () => {
    const len = Math.floor(rand() * 6); // empty items happen in real pages
    let str = "";
    for (let i = 0; i < len; i++)
      str += ALPHABET[Math.floor(rand() * ALPHABET.length)];
    return rand() < 0.35 ? { str, hasEOL: true } : { str };
  });
}

/** The text from..to with every separator character taken out, by position. */
function expected(items: readonly SearchItem[], from: number, to: number) {
  const { starts } = pageSearchText(items);
  let out = "";
  items.forEach((item, i) => {
    const begin = starts[i]!;
    for (let c = 0; c < item.str.length; c++) {
      const at = begin + c;
      if (at >= from && at < to) out += item.str[c];
    }
  });
  return out;
}

interface Case {
  items: SearchItem[];
  from: number;
  to: number;
}

function cases(count: number): Case[] {
  const rand = rng(20261115);
  const out: Case[] = [];
  while (out.length < count) {
    const items = page(rand);
    const { text } = pageSearchText(items);
    const a = Math.floor(rand() * (text.length + 1));
    const b = Math.floor(rand() * (text.length + 1));
    out.push({ items, from: Math.min(a, b), to: Math.max(a, b) });
  }
  return out;
}

const CASES = cases(800);

describe("itemRangesFor: offsets of a page's text as ranges inside its items", () => {
  it("health: enough cases, ranges across three or more items, empty and full spans", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(500);
    const spans = CASES.map((c) =>
      itemRangesFor(c.items, pageSearchText(c.items).starts, c.from, c.to),
    );
    expect(spans.some((r) => r.length >= 3)).toBe(true);
    expect(CASES.some((c) => c.from === c.to)).toBe(true);
    expect(
      CASES.some(
        (c) => c.from === 0 && c.to === pageSearchText(c.items).text.length,
      ),
    ).toBe(true);
    // The generator makes separators: a property blind to them proves little.
    expect(CASES.some((c) => c.items.some((i) => i.hasEOL))).toBe(true);
  });

  it("the ranges read back as the text between the offsets, separators taken out", () => {
    for (const [n, c] of CASES.entries()) {
      const { starts } = pageSearchText(c.items);
      const ranges = itemRangesFor(c.items, starts, c.from, c.to);
      const read = ranges
        .map((r) => c.items[r.item]!.str.slice(r.start, r.end))
        .join("");
      expect(read, `case ${n}`).toBe(expected(c.items, c.from, c.to));
      for (const [k, r] of ranges.entries()) {
        expect(r.end, `case ${n}`).toBeGreaterThan(r.start);
        expect(r.start, `case ${n}`).toBeGreaterThanOrEqual(0);
        expect(r.end, `case ${n}`).toBeLessThanOrEqual(
          c.items[r.item]!.str.length,
        );
        if (k > 0)
          expect(r.item, `case ${n}`).toBeGreaterThan(ranges[k - 1]!.item);
      }
    }
  });

  it("the search maps its matches through the same function", () => {
    const items: SearchItem[] = [
      { str: "Total ", hasEOL: false },
      { str: "due:", hasEOL: true },
      { str: "100" },
    ];
    const { text, starts } = pageSearchText(items);
    const at = text.indexOf("due:\n100");
    expect(findInItems(items, /due:\s+100/g)).toEqual([
      itemRangesFor(items, starts, at, at + "due:\n100".length),
    ]);
  });
});
