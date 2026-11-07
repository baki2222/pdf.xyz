// @vitest-environment node
/**
 * PDF to Word's guides send a reader with a scan to PDF to Word's own OCR
 * switch, and one guide answers "scanned PDF to Word" in its title.
 *
 * Audit search-demand#5 (2026-11-06): since 2026-10-24 PDF to Word runs OCR
 * in the same job when “Recognise text in scans (OCR)” (WORD_OCR_LABEL) is
 * ticked. Yet the general PDF to Word guide still told a reader with a scan
 * to run the OCR PDF tool first, in a section and again in its FAQ, and no
 * guide but the Bangla one targeted "scanned PDF to Word" / "OCR PDF to
 * Word", a search family the tool already serves.
 *
 * The set is DISCOVERED: every guide whose primary tool is pdf-to-word. Each
 * that mentions a scan must name the switch, and none may route a scan
 * through "OCR PDF … first" — the two-step flow the 2026-10-24 change
 * removed. The pre-fix sentence is kept as the control.
 */
import { describe, expect, it } from "vitest";
import { WORD_OCR_LABEL } from "@/lib/jobs/pdf-office-export";
import { guides } from "./catalog";
import type { Guide } from "./types";

/** Every string a reader of the guide sees, joined. */
function textOf(g: Guide): string {
  return [
    g.title,
    g.description,
    ...g.intro,
    ...g.steps,
    ...g.sections.flatMap((s) => [s.heading, ...s.body]),
    ...g.faq.flatMap((f) => [f.question, f.answer]),
  ].join("\n");
}

/**
 * A sentence that tells the reader to run or use OCR PDF before converting.
 * Bounded by ";" as well as ".", so the Bangla guide's "OCR PDF takes it as
 * it is; for a Word file, turn the photo into a PDF first" is not read as one.
 */
const OCR_FIRST = /\b(run|use)\b[^.;]*\bOCR PDF\b[^.;]*\bfirst\b/i;

/** What is wrong with one PDF to Word guide's scan advice. */
function scanAdviceProblems(text: string): string[] {
  const problems: string[] = [];
  if (/\bscan/i.test(text) && !text.includes(WORD_OCR_LABEL))
    problems.push(`mentions scans but never names “${WORD_OCR_LABEL}”`);
  const first = text.split(/(?<=\.)\s/).filter((s) => OCR_FIRST.test(s));
  for (const s of first) problems.push(`routes a scan through OCR PDF: ${s}`);
  return problems;
}

describe("PDF to Word guides and scans", () => {
  const wordGuides = guides.filter((g) => g.tools[0] === "pdf-to-word");

  it("finds the PDF to Word guides (health check)", () => {
    expect(wordGuides.length).toBeGreaterThanOrEqual(2);
  });

  it("catches the advice this audit found (positive control)", () => {
    expect(
      scanAdviceProblems(
        "If your PDF is a scan, run it through the OCR PDF tool first, which recognizes the text.",
      ),
    ).toHaveLength(2);
  });

  it.each(wordGuides.map((g) => [g.slug, g]))(
    "%s sends a scan to the OCR switch",
    (_slug, g) => {
      expect(scanAdviceProblems(textOf(g as Guide))).toEqual([]);
    },
  );

  it("a guide answers 'scanned PDF to Word' in its title and steps", () => {
    const scanned = wordGuides.filter((g) => /\bscanned\b/i.test(g.title));
    // The Bangla guide is about a language; this asks for the general one.
    const general = scanned.filter((g) => !/bangla|bengali/i.test(g.title));
    expect(general.map((g) => g.slug)).toHaveLength(1);
    expect(general[0]!.steps.join("\n")).toContain(WORD_OCR_LABEL);
  });
});
