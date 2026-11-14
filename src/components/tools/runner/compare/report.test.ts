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

/** A document of several pages, one array of lines per page. */
function pagedDoc(name: string, pages: string[][]): ComparablePdfText {
  const texts = pages.map((p) => p.join("\n"));
  const text = texts.join("\n\n");
  return {
    name,
    size: text.length,
    extracted: {
      pageCount: pages.length,
      pages: texts.map((t, i) => ({
        pageNumber: i + 1,
        text: t,
        characterCount: t.length,
      })),
      text,
      characterCount: text.length,
      hasText: true,
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

  /*
   * Until 2026-11-14 the Changes section said the bare "No selectable-text
   * differences found." under an option too, while its own header said the
   * text was identical only "with ignore case" (second review).
   */
  it("under an option, 'no differences' is qualified by it, with the lines set aside", () => {
    const cased = compareExtractedPdfText(
      doc("a.pdf", ["Total due"]),
      doc("b.pdf", ["TOTAL DUE"]),
      { ignoreCase: true },
    );
    expect(cased.report).toMatch(
      /^No selectable-text differences found \(ignoring case\)\.$/m,
    );
    expect(cased.report).not.toMatch(
      /^No selectable-text differences found\.$/m,
    );
    const paged = (total: number) =>
      pagedDoc(
        "x.pdf",
        [1, 2, 3].map((p) => [
          "Acme",
          `body ${p} one`,
          `body ${p} two`,
          `Page ${p} of ${total}`,
        ]),
      );
    const furniture = compareExtractedPdfText(paged(3), paged(4), {
      ignoreFurniture: true,
    });
    expect(furniture.report).toMatch(
      /^Options: ignore page headers and numbers \(3 lines set aside from the first PDF, 3 lines from the second\)$/m,
    );
    expect(furniture.report).toMatch(
      /^No selectable-text differences found \(ignoring page headers and numbers \(3 lines set aside from the first PDF, 3 lines from the second\)\)\.$/m,
    );
  });

  /*
   * Until 2026-11-14 every skipped pair was a "long line", though a pair is
   * also skipped once the comparison's shared marking budget is spent: 2,500
   * lines of 189 characters at most were reported as long (second review).
   */
  it("lines left unmarked are not all called long", () => {
    const long = Array.from({ length: 1_100 }, (_, i) => `w${i}`).join(" ");
    const result = compareExtractedPdfText(
      doc("a.pdf", ["Intro", long, "End"]),
      doc("b.pdf", ["Intro", `${long} tail`, "End"]),
    );
    expect(result.wordFallbacks).toBe(1);
    expect(result.report).toMatch(
      /^Word marks skipped for 1 line: too long to mark, or past the marking budget of a very large comparison\. They are listed without word marks\.$/m,
    );
    expect(result.report).not.toMatch(/long lines?$/m);
  });
});
