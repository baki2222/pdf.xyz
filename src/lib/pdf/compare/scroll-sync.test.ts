import { describe, expect, it } from "vitest";
import type { ExtractedPdfText } from "../text";
import { compareExtractedPdfText } from "@/components/tools/runner/compare/compare-result";
import { body, pageHeaderPair, type PageLines } from "@/tests/compare-fixtures";
import {
  buildSyncMap,
  mapLR,
  mapRL,
  syncMapOf,
  syncPoints,
  SYNC_ANCHORS_PER_PAGE,
  type SyncMap,
} from "./scroll-sync";

/**
 * Scroll both files together: a position in the first file (page index plus
 * how far down the page) maps to the position in the second that shows the
 * same unchanged text, through anchors on unchanged lines. The anchors are
 * line RANKS mapped to page fractions, not geometry, so the map is an
 * approximation; what is held here is its SHAPE: monotone, onto both
 * files' whole length, the identity for one file against itself, a round
 * trip, and the page-header pair's inserted page skipped.
 */

function extracted(pages: readonly PageLines[]): ExtractedPdfText {
  const texts = pages.map((p) => p.join("\n"));
  const text = texts.filter(Boolean).join("\n\n");
  return {
    pageCount: pages.length,
    pages: texts.map((t, i) => ({
      pageNumber: i + 1,
      text: t,
      characterCount: t.length,
    })),
    text,
    characterCount: text.length,
    hasText: text.trim().length > 0,
  };
}

function compare(left: readonly PageLines[], right: readonly PageLines[]) {
  return compareExtractedPdfText(
    { name: "a.pdf", size: 1, extracted: extracted(left) },
    { name: "b.pdf", size: 1, extracted: extracted(right) },
  );
}

function rng(seed: number) {
  // Spread neighbouring seeds apart: an LCG's first draw is nearly linear
  // in its seed.
  let s = Math.imul(seed + 1, 2654435761) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A random document and a random revision of it: edits, inserts, deletes, page breaks moved. */
function script(rand: () => number, n: number) {
  const pages = 1 + Math.floor(rand() * 5);
  const left: string[][] = Array.from({ length: pages }, () => []);
  const right: string[][] = [[]];
  let line = 0;
  for (let p = 0; p < pages; p++) {
    const count = 1 + Math.floor(rand() * 12);
    for (let i = 0; i < count; i++) {
      const text = `s${n} line ${line++}`;
      left[p]!.push(text);
      const roll = rand();
      if (roll < 0.1) continue;
      right.at(-1)!.push(roll < 0.2 ? `${text} edited` : text);
      if (roll > 0.92) right.at(-1)!.push(`s${n} inserted ${line}`);
      if (rand() < 0.08) right.push([]);
    }
    if (rand() < 0.7) right.push([]);
  }
  return { left, right: right.length ? right : [[]] };
}

function monotone(m: SyncMap, numL: number, steps = 97): boolean {
  let last = -Infinity;
  for (let k = 0; k <= steps; k++) {
    const v = mapLR(m, (numL * k) / steps);
    if (!Number.isFinite(v) || v < last - 1e-9) return false;
    last = v;
  }
  return true;
}

const SCRIPTS = Array.from({ length: 240 }, (_, n) => script(rng(n + 7), n));

describe("scroll sync: a monotone map between the two files' reading positions", () => {
  it("health: enough scripts, of several pages, with unchanged lines to anchor on", () => {
    expect(SCRIPTS.length).toBeGreaterThanOrEqual(200);
    const results = SCRIPTS.map((s) => compare(s.left, s.right));
    expect(
      results.filter((r) => r.verdict === "different").length,
    ).toBeGreaterThan(150);
    expect(SCRIPTS.filter((s) => s.left.length >= 3).length).toBeGreaterThan(
      50,
    );
    expect(
      results.filter((r) => syncPoints(r).length >= 5).length,
    ).toBeGreaterThan(150);
  });

  it("is monotone, onto [0, pages] at both ends, and round-trips, on every script", () => {
    for (const [n, s] of SCRIPTS.entries()) {
      const r = compare(s.left, s.right);
      const m = syncMapOf(r, s.left.length, s.right.length);
      expect(monotone(m, s.left.length), `script ${n}`).toBe(true);
      expect(mapLR(m, 0), `script ${n}`).toBe(0);
      expect(mapLR(m, s.left.length), `script ${n}`).toBe(s.right.length);
      expect(mapRL(m, s.right.length), `script ${n}`).toBe(s.left.length);
      for (const u of [0.25, 0.5, s.left.length * 0.7]) {
        const v = mapLR(m, u);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(s.right.length);
        expect(mapRL(m, v), `script ${n} round trip`).toBeCloseTo(u, 6);
      }
      // Bounded: no more than the stated anchors per page of the first file.
      expect(m.l.length).toBeLessThanOrEqual(
        s.left.length * SYNC_ANCHORS_PER_PAGE + 2,
      );
    }
  });

  it("is the identity for a file against itself", () => {
    const pages = [body("a", 7), body("b", 3), body("c", 11)];
    const m = syncMapOf(compare(pages, pages), 3, 3);
    for (const u of [0, 0.1, 0.5, 1, 1.37, 2.2, 2.99, 3])
      expect(mapLR(m, u)).toBeCloseTo(u, 9);
  });

  it("the page-header pair: page 2 of the first file maps into page 3 of the second", () => {
    const { left, right } = pageHeaderPair();
    const m = syncMapOf(compare(left, right), left.length, right.length);
    for (const f of [0.1, 0.5, 0.9]) {
      const v = mapLR(m, 1 + f);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThan(3);
    }
    // Page 1 is page 1 on both.
    expect(mapLR(m, 0.5)).toBeLessThan(1);
  });

  it("any anchor list, in any order, becomes a monotone map", () => {
    const rand = rng(99);
    for (let n = 0; n < 200; n++) {
      const numL = 1 + Math.floor(rand() * 6);
      const numR = 1 + Math.floor(rand() * 6);
      const points: [number, number][] = Array.from(
        { length: Math.floor(rand() * 30) },
        () => [rand() * numL, rand() * numR],
      );
      const m = buildSyncMap(points, numL, numR);
      expect(monotone(m, numL), `list ${n}`).toBe(true);
      expect(mapLR(m, numL)).toBe(numR);
    }
  });
});
