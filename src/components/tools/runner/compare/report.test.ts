import { describe, expect, it } from "vitest";
import type { ComparablePdfText } from "@/lib/pdf/compare-pdf";
import { CONTEXT } from "@/lib/pdf/compare/hunks";
import { compareExtractedPdfText } from "./compare-result";

function doc(name: string, lines: string[]): ComparablePdfText {
  const text = lines.join("\n");
  return {
    name,
    size: text.length,
    extracted: {
      pageCount: 1,
      pages: [{ pageNumber: 1, text, characterCount: text.length }],
      text,
      characterCount: text.length,
      hasText: text.trim().length > 0,
    },
  };
}

/** The lines under "Changes:", hunk by hunk. */
function hunksOf(report: string): string[][] {
  const body = report.slice(report.indexOf("\nChanges:\n") + 10);
  return body
    .split(/\n\n(?=@@ )/)
    .map((h) => h.split("\n"))
    .filter((h) => h[0]!.startsWith("@@ "));
}

const kind = (line: string) => line.slice(0, 2);

describe("the report lists only changes, with bounded context", () => {
  const base = Array.from({ length: 60 }, (_, i) => `Clause ${i + 1} stands`);
  // Changes at distances that straddle the merge rule: two close together
  // (merged), one far away (its own hunk), one at the very end.
  const next = [...base];
  next[5] = "Clause 6 [-was-] {+changed+} here";
  next[8] = "Clause 9 amended";
  next[30] = "Clause 31 amended";
  next.push("Clause 61 added");
  const result = compareExtractedPdfText(
    doc("a.pdf", base),
    doc("b.pdf", next),
  );
  const hunks = hunksOf(result.report);

  it("health: the report has the hunks the edits make", () => {
    expect(hunks.length).toBe(3);
    expect(result.summary.changedLines).toBe(7);
    expect(result.report).not.toContain("Diff:");
    expect(result.report).toContain(
      "Only changes are listed, with 2 lines of context and the page they sit on in each file.",
    );
  });

  it("'+ ' and '- ' lines carry the line text verbatim, brackets and all", () => {
    const plus = hunks
      .flat()
      .filter((l) => kind(l) === "+ ")
      .map((l) => l.slice(2));
    const minus = hunks
      .flat()
      .filter((l) => kind(l) === "- ")
      .map((l) => l.slice(2));
    expect(plus).toEqual([
      "Clause 6 [-was-] {+changed+} here",
      "Clause 9 amended",
      "Clause 31 amended",
      "Clause 61 added",
    ]);
    expect(minus).toEqual([
      "Clause 6 stands",
      "Clause 9 stands",
      "Clause 31 stands",
    ]);
  });

  it("a word-marked pair gets one '~ ' line after its '+ ' line", () => {
    const flat = hunks.flat();
    const at = flat.indexOf("+ Clause 31 amended");
    expect(flat[at + 1]).toBe("~ Clause 31 [-stands-]{+amended+}");
    const money = compareExtractedPdfText(
      doc("a.pdf", ["Total due: 100"]),
      doc("b.pdf", ["Total due: 120"]),
    );
    expect(money.report).toMatch(/^~ Total due: \[-100-\]\{\+120\+\}$/m);
  });

  it(`no hunk has more than ${CONTEXT} context lines at either end, or a run over ${2 * CONTEXT} inside`, () => {
    for (const hunk of hunks) {
      const lines = hunk.slice(1).filter((l) => kind(l) !== "~ ");
      const runs: number[] = [];
      let run = 0;
      for (const line of lines) {
        if (kind(line) === "  ") run += 1;
        else {
          runs.push(run);
          run = 0;
        }
      }
      runs.push(run);
      expect(runs[0], hunk[0]).toBeLessThanOrEqual(CONTEXT);
      expect(runs.at(-1), hunk[0]).toBeLessThanOrEqual(CONTEXT);
      for (const inner of runs.slice(1, -1))
        expect(inner, hunk[0]).toBeLessThanOrEqual(2 * CONTEXT);
    }
    // Positive control: the first hunk merged two edits across an inner run.
    const first = hunks[0]!.slice(1).filter((l) => kind(l) !== "~ ");
    expect(first.filter((l) => kind(l) === "- ")).toHaveLength(2);
  });

  it("identical text still says so in so many words", () => {
    const same = compareExtractedPdfText(
      doc("a.pdf", base),
      doc("b.pdf", base),
    );
    expect(same.report).toMatch(/^No selectable-text differences found\.$/m);
    expect(same.report).toMatch(/^Options: none$/m);
    expect(same.report).not.toMatch(/^@@ /m);
  });

  it("an option is stated, and 'identical' is qualified by it", () => {
    const cased = compareExtractedPdfText(
      doc("a.pdf", ["Total due"]),
      doc("b.pdf", ["TOTAL DUE"]),
      { ignoreCase: true },
    );
    expect(cased.report).toMatch(/^Options: ignore case$/m);
    expect(cased.report).toMatch(
      /^Selectable text identical: yes \(with ignore case\)$/m,
    );
  });
});
