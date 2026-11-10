import { describe, expect, test } from "vitest";
import { KidsCounter } from "./pdf-scan-kids";

/**
 * The page-tree counter the board's walk bound rests on (`pdfjs-guard`,
 * PDFJS_BOARD_MAX_WALK). The composed chain — real files through pdf.js — is
 * held in src/tests/hostile/pdfjs-board-pages.test.ts; these hold the lexing
 * each of those fixtures relies on, and that a chunk boundary changes nothing.
 */
const bytes = (s: string) => Uint8Array.from(Buffer.from(s, "latin1"));

function count(text: string, chunk = 0) {
  const c = new KidsCounter();
  const b = bytes(text);
  if (chunk <= 0) c.feed(b);
  else
    for (let i = 0; i < b.length; i += chunk) c.feed(b.subarray(i, i + chunk));
  c.reset();
  return {
    entries: c.entries,
    nodes: c.nodes,
    indirect: Object.fromEntries(c.indirect),
    unbounded: c.unbounded,
  };
}

const CASES: [string, string, { entries: number; nodes: number }][] = [
  ["references", "<< /Kids [3 0 R 4 0 R 5 0 R] >>", { entries: 3, nodes: 1 }],
  ["no space before [", "<</Kids[3 0 R]>>", { entries: 1, nodes: 1 }],
  [
    "repeats each count",
    "/Kids [3 0 R 3 0 R 3 0 R 3 0 R]",
    { entries: 4, nodes: 1 },
  ],
  // pdf.js pushes every element, not only references.
  [
    "any element",
    "/Kids [1 2 3 null /N (s) <ab> [1] << >>]",
    { entries: 9, nodes: 1 },
  ],
  [
    "a ] in a string",
    "/Kids [3 0 R (]) 3 0 R 3 0 R]",
    { entries: 4, nodes: 1 },
  ],
  [
    "nested and escaped parens",
    "/Kids [(a(b)c\\)]) 3 0 R]",
    { entries: 2, nodes: 1 },
  ],
  ["a ] in a comment", "/Kids [3 0 R % ]\n 3 0 R]", { entries: 2, nodes: 1 }],
  ["a > in a hex string", "/Kids [<5d> 3 0 R]", { entries: 2, nodes: 1 }],
  // pdf.js reads `>>` inside an array as an element, not as a close.
  [">> in an array", "/Kids [3 0 R >> 3 0 R]", { entries: 3, nodes: 1 }],
  [
    "] in a dictionary is ignored",
    "/Kids [<< /A ] >> 3 0 R]",
    { entries: 2, nodes: 1 },
  ],
  // An inline /Pages node in a /Kids array: its own /Kids pushed as well.
  [
    "inline node",
    "/Kids [<< /Type /Pages /Kids [4 0 R 5 0 R] >> 3 0 R]",
    { entries: 4, nodes: 2 },
  ],
  ["escaped key", "/Ki#64s [3 0 R 4 0 R]", { entries: 2, nodes: 1 }],
  ["another key", "/Kid [3 0 R] /Kidss [3 0 R]", { entries: 0, nodes: 0 }],
  [
    "two arrays",
    "/Kids [3 0 R] /X 1 /Kids [4 0 R 5 0 R]",
    { entries: 3, nodes: 2 },
  ],
];

describe("KidsCounter counts what pdf.js pushes", () => {
  test.each(CASES)("%s", (_, text, want) => {
    expect(count(text)).toMatchObject(want);
  });

  test.each(CASES)("%s: the same fed one byte at a time", (_, text, want) => {
    expect(count(text, 1)).toMatchObject(want);
  });

  test("a lone reference is an array held elsewhere, counted per key", () => {
    expect(count("/Kids 12 0 R /Kids 12 0 R /Kids 7 0 R")).toMatchObject({
      nodes: 3,
      indirect: { 12: 2, 7: 1 },
    });
    expect(count("/Kids [<< /Kids 9 0 R >>]", 1)).toMatchObject({
      entries: 1,
      nodes: 2,
      indirect: { 9: 1 },
    });
  });

  test("a value that is neither an array nor a reference is no node", () => {
    expect(count("/Kids null /Kids 5 /Kids /Name")).toMatchObject({
      entries: 0,
      nodes: 0,
    });
  });

  test("an array still open when the text ends is counted as far as it was read", () => {
    expect(count("/Kids [3 0 R 3 0 R 3 0")).toMatchObject({ entries: 4 });
  });

  test("nesting past its depth is unbounded, not a short count", () => {
    expect(count(`/Kids [${"[".repeat(2000)}`).unbounded).toBe(true);
    expect(count(`/Kids [${"[".repeat(10)}]]]]]]]]]]]`).unbounded).toBe(false);
  });

  test("arrayElementsAt reads one array object and stops at its close", () => {
    const b = bytes("[3 0 R (]) 4 0 R] /Kids [9 0 R 9 0 R]");
    expect(KidsCounter.arrayElementsAt(b, 0, b.length)).toBe(3);
  });

  test("positive control: a large padded root counts every element", () => {
    const pad = " 3 0 R".repeat(100_000);
    expect(count(`/Kids [3 0 R${pad}]`).entries).toBe(100_001);
    expect(count(`/Kids [3 0 R${pad}]`, 4096).entries).toBe(100_001);
  });
});
