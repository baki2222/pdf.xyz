import { describe, expect, it } from "vitest";
import {
  COMPARE_VERDICTS,
  CompareTooLargeError,
  MAX_DIFF_CELLS,
  compareExtractedPdfText,
  compareOutputName,
  diffLines,
  type ComparablePdfText,
  type CompareVerdict,
} from "./compare-pdf";

function doc(name: string, text: string, pageCount = 1): ComparablePdfText {
  return {
    name,
    size: new TextEncoder().encode(text).byteLength,
    extracted: {
      pageCount,
      pages: [{ pageNumber: 1, text, characterCount: text.length }],
      text,
      characterCount: text.length,
      hasText: text.trim().length > 0,
    },
  };
}

/** `count` distinct lines, each carrying `tag` so two corpora never share one. */
function lines(tag: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${tag} line ${i}`);
}

function kinds(diff: { kind: string }[]) {
  return {
    same: diff.filter((l) => l.kind === "same").length,
    added: diff.filter((l) => l.kind === "added").length,
    removed: diff.filter((l) => l.kind === "removed").length,
  };
}

describe("compare-pdf", () => {
  it("computes added/removed/common line diffs", () => {
    expect(diffLines("A\nB\nC", "A\nB2\nC\nD")).toEqual([
      { kind: "same", text: "A" },
      { kind: "removed", text: "B" },
      { kind: "added", text: "B2" },
      { kind: "same", text: "C" },
      { kind: "added", text: "D" },
    ]);
  });

  it("summarizes identical selectable text", () => {
    const result = compareExtractedPdfText(
      doc("old.pdf", "Same\nText"),
      doc("new.pdf", "Same\nText"),
    );
    expect(result.verdict).toBe("identical");
    expect(result.identicalText).toBe(true);
    expect(result.summary.changedLines).toBe(0);
    expect(result.summary.addedLines).toBe(0);
    expect(result.summary.removedLines).toBe(0);
  });

  it("summarizes page, size, and text differences", () => {
    const result = compareExtractedPdfText(
      doc("old.pdf", "A\nB\nC", 1),
      doc("new.pdf", "A\nB2\nC\nD", 2),
    );
    expect(result.verdict).toBe("different");
    expect(result.identicalText).toBe(false);
    expect(result.hasComparableText).toBe(true);
    expect(result.pageDelta).toBe(1);
    expect(result.sizeDelta).toBeGreaterThan(0);
    expect(result.summary.addedLines).toBe(2);
    expect(result.summary.removedLines).toBe(1);
    expect(result.summary.changedLines).toBe(3);
    expect(result.report).toContain("Comparable text: yes");
    expect(result.report).toContain("Selectable text identical: no");
    expect(result.report).toMatch(/^\+ D$/m);
  });

  /*
   * HISTORY. This test used to be the only one covering scanned input, and it
   * pinned the defect: it asserted `identicalText === false` and
   * `changedLines === 0` and never looked at what the user was TOLD. The runner
   * turned exactly that result into "Differences found" under a green check,
   * and the report said "Selectable text identical: no" — a claim that two blank
   * scans differ, with no evidence either way. It now asserts the verdict and
   * the report a reader downloads.
   */
  it("stays honest when neither PDF has selectable text", () => {
    const result = compareExtractedPdfText(
      doc("scan-a.pdf", ""),
      doc("scan-b.pdf", ""),
    );
    expect(result.verdict).toBe("no-text");
    expect(result.hasComparableText).toBe(false);
    // Two blank scans are not "identical" either: there is no evidence.
    expect(result.identicalText).toBe(false);
    expect(result.summary.changedLines).toBe(0);
    expect(result.diff).toEqual([]);
    expect(result.report).not.toMatch(/^Selectable text identical: (yes|no)$/m);
    expect(result.report).toContain("Selectable text identical: not compared");
    expect(result.report).not.toContain("Comparable text: yes");
    expect(result.report).toMatch(/OCR/);
  });

  /*
   * One scanned side used to be diffed against the other side's text: `||`
   * where `&&` was meant, so a signed scan compared with the Word export it was
   * printed from came back as every line removed or added, under
   * "Comparable text: yes".
   */
  it.each([
    ["left", "left-no-text"],
    ["right", "right-no-text"],
  ] as const)(
    "does not diff when only the %s PDF has no selectable text",
    (side, verdict) => {
      const text = "Clause 1\nClause 2\nClause 3";
      const scanned = doc("signed-scan.pdf", "");
      const born = doc("contract.pdf", text);
      const result =
        side === "left"
          ? compareExtractedPdfText(scanned, born)
          : compareExtractedPdfText(born, scanned);

      expect(result.verdict).toBe(verdict);
      expect(result.hasComparableText).toBe(false);
      expect(result.identicalText).toBe(false);
      expect(result.leftHasText).toBe(side !== "left");
      expect(result.rightHasText).toBe(side !== "right");
      expect(result.summary.changedLines).toBe(0);
      expect(result.diff).toEqual([]);

      // The downloaded report names the scanned file and says what to do,
      // and does not print the other file's text as a diff.
      expect(result.report).toContain("signed-scan.pdf has no selectable text");
      expect(result.report).toMatch(/OCR/);
      expect(result.report).not.toContain("Comparable text: yes");
      expect(result.report).not.toMatch(/^[+-] Clause/m);
    },
  );

  it("every verdict the type declares is produced by some input, and every input lands on a declared verdict", () => {
    const corpus: [ComparablePdfText, ComparablePdfText][] = [
      [doc("a.pdf", "x"), doc("b.pdf", "x")],
      [doc("a.pdf", "x"), doc("b.pdf", "y")],
      [doc("a.pdf", ""), doc("b.pdf", "")],
      [doc("a.pdf", ""), doc("b.pdf", "y")],
      [doc("a.pdf", "x"), doc("b.pdf", "")],
    ];
    const seen = new Set<CompareVerdict>(
      corpus.map(([l, r]) => compareExtractedPdfText(l, r).verdict),
    );
    // Health check: the declared list is not empty, so ⊆ is not vacuous.
    expect(COMPARE_VERDICTS.length).toBeGreaterThanOrEqual(5);
    expect([...seen].sort()).toEqual([...COMPARE_VERDICTS].sort());
  });

  it("names comparison report downloads", () => {
    expect(compareOutputName("draft.pdf", "final.pdf")).toBe(
      "draft-vs-final-comparison.txt",
    );
  });
});

/*
 * The line diff used to allocate a full (n+1)×(m+1) table of JS arrays on the
 * main thread: measured at 801 MB for 10k × 10k lines, quadratic from there, so
 * two versions of a long contract froze and then killed the tab with no
 * message. These tests are deterministic — no wall-clock or heap assertions.
 */
describe("compare-pdf — size", () => {
  it("diffs two 50,000-line near-identical versions (the tool's main use) exactly", () => {
    const base = lines("doc", 50_000);
    const next = [...base];
    next[10] = "doc line 10 — amended";
    next.splice(25_000, 1); // delete one line
    next.splice(40_000, 0, "inserted clause"); // insert one line

    const diff = diffLines(base.join("\n"), next.join("\n"));
    // Old table: 50,001² cells ≈ 2.5 billion — it never finished.
    expect(kinds(diff)).toEqual({ same: 49_998, added: 2, removed: 2 });
    expect(diff.filter((l) => l.kind !== "same")).toEqual([
      { kind: "removed", text: "doc line 10" },
      { kind: "added", text: "doc line 10 — amended" },
      { kind: "removed", text: "doc line 25000" },
      { kind: "added", text: "inserted clause" },
    ]);
  });

  // Derived from the bound, so moving MAX_DIFF_CELLS moves both cases with it.
  const side = Math.floor(Math.sqrt(MAX_DIFF_CELLS));
  const under = side - 1; // (under + 1)² ≤ MAX_DIFF_CELLS
  const over = side + 1; // (over + 1)² > MAX_DIFF_CELLS

  it("health: the under/over pair straddles the bound", () => {
    expect((under + 1) ** 2).toBeLessThanOrEqual(MAX_DIFF_CELLS);
    expect((over + 1) ** 2).toBeGreaterThan(MAX_DIFF_CELLS);
    // A bound so small it refuses ordinary documents would pass the throw
    // test below for the wrong reason.
    expect(under).toBeGreaterThanOrEqual(2_000);
  });

  it("refuses, with a named error, two unrelated documents over the bound", () => {
    const run = () =>
      diffLines(
        lines("left", over).join("\n"),
        lines("right", over).join("\n"),
      );
    expect(run).toThrow(CompareTooLargeError);
    expect(run).toThrow(/too many places to compare/i);
  });

  it("the error reaches a caller of compareExtractedPdfText", () => {
    expect(() =>
      compareExtractedPdfText(
        doc("a.pdf", lines("left", over).join("\n")),
        doc("b.pdf", lines("right", over).join("\n")),
      ),
    ).toThrow(CompareTooLargeError);
  });

  it("control: two unrelated documents just under the bound still diff completely", () => {
    const diff = diffLines(
      lines("left", under).join("\n"),
      lines("right", under).join("\n"),
    );
    expect(kinds(diff)).toEqual({ same: 0, added: under, removed: under });
  });

  it("edits scattered through a paginated document with a repeated footer are found exactly", () => {
    // 1,200 pages of 45 lines, each ending in the same two footer lines — so
    // the footer is NOT unique and cannot anchor anything; the body lines can.
    const base: string[] = [];
    for (let p = 0; p < 1_200; p += 1) {
      for (let l = 0; l < 43; l += 1) base.push(`p${p} body ${l}`);
      base.push("Confidential — do not distribute", "Acme Corp contract");
    }
    const next = base.map((line) =>
      line === "p3 body 7" || line === "p1100 body 20"
        ? `${line} (amended)`
        : line,
    );
    expect(base.length).toBe(54_000);

    const diff = diffLines(base.join("\n"), next.join("\n"));
    expect(kinds(diff)).toEqual({ same: 53_998, added: 2, removed: 2 });
    expect(diff.filter((l) => l.kind !== "same")).toEqual([
      { kind: "removed", text: "p3 body 7" },
      { kind: "added", text: "p3 body 7 (amended)" },
      { kind: "removed", text: "p1100 body 20" },
      { kind: "added", text: "p1100 body 20 (amended)" },
    ]);
  });

  it("on random edits over the table bound, the script rebuilds both documents", () => {
    // Seeded, so a failure reproduces. Lines repeat (a 40-word vocabulary per
    // line slot) so anchors are sparse, and edits land anywhere.
    let seed = 0x9e3779b9;
    const rand = (n: number) => {
      seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
      return seed % n;
    };
    for (let round = 0; round < 3; round += 1) {
      const base = Array.from({ length: 8_000 }, (_, i) =>
        rand(4) === 0 ? `common ${rand(40)}` : `line ${i}`,
      );
      const next: string[] = [];
      for (const line of base) {
        const roll = rand(100);
        if (roll === 0) continue; // delete
        if (roll === 1) next.push(`inserted ${rand(1_000)}`);
        next.push(roll === 2 ? `${line} edited` : line);
      }
      // Health: this must take the anchored path, not one table.
      expect((base.length + 1) * (next.length + 1)).toBeGreaterThan(
        MAX_DIFF_CELLS,
      );

      const diff = diffLines(base.join("\n"), next.join("\n"));
      expect(diff.filter((l) => l.kind !== "added").map((l) => l.text)).toEqual(
        base,
      );
      expect(
        diff.filter((l) => l.kind !== "removed").map((l) => l.text),
      ).toEqual(next);
      // And it is a diff, not "remove everything, add everything".
      expect(kinds(diff).same).toBeGreaterThan(base.length * 0.9);
    }
  });

  it("no LCS table larger than MAX_DIFF_CELLS is ever allocated", () => {
    // diffLines' docblock claims this; a comment is not a guard. The table is
    // the only Uint16Array/Uint32Array it builds, so record every one.
    const sizes: number[] = [];
    const real = { u16: globalThis.Uint16Array, u32: globalThis.Uint32Array };
    class U16 extends real.u16 {
      constructor(length: number) {
        super(length);
        sizes.push(length);
      }
    }
    class U32 extends real.u32 {
      constructor(length: number) {
        super(length);
        sizes.push(length);
      }
    }
    globalThis.Uint16Array = U16 as unknown as Uint16ArrayConstructor;
    globalThis.Uint32Array = U32 as unknown as Uint32ArrayConstructor;
    try {
      const side = Math.floor(Math.sqrt(MAX_DIFF_CELLS));
      // Positive control: one stretch just under the bound builds one table.
      diffLines(
        lines("left", side - 1).join("\n"),
        lines("right", side - 1).join("\n"),
      );
      // A document far over the bound, with edits spread through it.
      const base = lines("doc", 30_000);
      const next = base.map((l, i) => (i % 997 === 0 ? `${l} edited` : l));
      diffLines(base.join("\n"), next.join("\n"));
      expect(() =>
        diffLines(
          lines("left", side + 1).join("\n"),
          lines("right", side + 1).join("\n"),
        ),
      ).toThrow(CompareTooLargeError);
    } finally {
      globalThis.Uint16Array = real.u16;
      globalThis.Uint32Array = real.u32;
    }
    // Health: the recorder saw the tables (the control's one is near the bound).
    expect(sizes.length).toBeGreaterThan(1);
    expect(Math.max(...sizes)).toBeGreaterThan(MAX_DIFF_CELLS * 0.99);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(MAX_DIFF_CELLS);
  });

  it("an appended 200,000-line tail is reported line by line, not refused", () => {
    // One side of the middle is empty, so no table is needed at all — and the
    // lines are appended without spreading 200k arguments into one call.
    const head = lines("head", 10);
    const tail = lines("tail", 200_000);
    const diff = diffLines(head.join("\n"), [...head, ...tail].join("\n"));
    expect(kinds(diff)).toEqual({ same: 10, added: 200_000, removed: 0 });
  });

  it("control: a shared prefix and suffix do not count toward the bound", () => {
    const shared = lines("shared", 100_000);
    const diff = diffLines(
      [...shared.slice(0, 50_000), "L", ...shared.slice(50_000)].join("\n"),
      [...shared.slice(0, 50_000), "R", ...shared.slice(50_000)].join("\n"),
    );
    expect(kinds(diff)).toEqual({ same: 100_000, added: 1, removed: 1 });
    expect(diff[50_000]).toEqual({ kind: "removed", text: "L" });
    expect(diff[50_001]).toEqual({ kind: "added", text: "R" });
  });
});
