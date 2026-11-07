// @vitest-environment node
/**
 * A tool with the OCR switch has a setting, so its pages may not say it has
 * none (2026-11-08, review of audit extract-tables#3).
 *
 * Extract Tables gained "Recognise text in scans (OCR)", a language picker
 * and three page boxes. Its tool page was reworded ("Table detection itself
 * takes no options; turning on OCR only adds a text layer…"), but its guide,
 * edited and re-dated in the same change, still said "There are no settings
 * to choose." in its intro and "There are no options: every page is read."
 * in an FAQ. Both are kept below as the corpus.
 *
 * The set is DISCOVERED: every guide whose primary tool runs OCR first
 * (`OFFICE_OCR_TOOLS` plus Extract Tables, whose processor always runs the
 * shared OCR-first step), and those tools' own pages. A scoped sentence
 * ("table detection itself has no settings") is allowed; a sentence saying
 * the tool as a whole has none is not.
 */
import { describe, expect, it } from "vitest";
import { OFFICE_OCR_TOOLS } from "@/lib/jobs/office-export-ocr";
import { WORD_OCR_LABEL } from "@/lib/jobs/pdf-office-export";
import { getToolContent } from "@/lib/tools/content";
import { guides } from "./catalog";
import type { Guide } from "./types";

const OCR_FIRST_TOOLS: readonly string[] = [
  ...OFFICE_OCR_TOOLS,
  "extract-tables",
];

/**
 * A claim that there is nothing to set. Each alternative catches a sentence
 * the product has shipped (see CORPUS), in both directions.
 */
const NO_SETTINGS =
  /\bthere are no (settings|options)\b|\bno (settings|options) (at all|to choose)\b/i;

/** Sentences the product shipped, each of which NO_SETTINGS must catch. */
const CORPUS = [
  // how-to-extract-tables-from-a-pdf, intro, until 2026-11-08
  "There are no settings to choose.",
  // how-to-extract-tables-from-a-pdf, FAQ, until 2026-11-08
  "No. There are no options: every page is read.",
  // how-to-convert-excel-to-pdf (true there: that tool has no settings)
  "The converter gets your file and no settings at all.",
];

/** The rewordings, which scope the claim and must pass. */
const ALLOWED = [
  "Table detection itself has no settings: the only control is the OCR switch.",
  "Table detection itself takes no options; turning on OCR only adds a text layer before it runs.",
  "There is no page choice: every page is read.",
];

function guideText(g: Guide): string[] {
  return [
    g.title,
    g.description,
    ...g.intro,
    ...g.steps,
    ...g.sections.flatMap((s) => [s.heading, ...s.body]),
    ...g.faq.flatMap((f) => [f.question, f.answer]),
  ];
}

/** Every string leaf of a value. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object")
    return Object.values(value).flatMap(strings);
  return [];
}

function sentences(texts: string[]): string[] {
  return texts.flatMap((t) => t.split(/(?<=[.!?])\s+/));
}

describe("a tool with the OCR switch never says it has no settings", () => {
  const subjects = guides.filter((g) =>
    OCR_FIRST_TOOLS.includes(g.tools[0] ?? ""),
  );

  it("health check: finds a guide and a tool page for each OCR-first tool", () => {
    for (const tool of OCR_FIRST_TOOLS) {
      expect(subjects.some((g) => g.tools[0] === tool)).toBe(true);
      expect(getToolContent(tool)).toBeDefined();
    }
  });

  it("the pattern catches every corpus sentence and passes the rewordings", () => {
    for (const s of CORPUS) expect(s).toMatch(NO_SETTINGS);
    for (const s of ALLOWED) expect(s).not.toMatch(NO_SETTINGS);
  });

  it("positive control: the pattern still catches a shipped sentence in the catalog", () => {
    const all = sentences(guides.flatMap(guideText));
    expect(all.filter((s) => NO_SETTINGS.test(s)).length).toBeGreaterThan(0);
  });

  it("no OCR-first guide or tool page claims there is nothing to set", () => {
    const found = [
      ...subjects.flatMap((g) =>
        sentences(guideText(g))
          .filter((s) => NO_SETTINGS.test(s))
          .map((s) => `${g.slug}: ${s}`),
      ),
      ...OCR_FIRST_TOOLS.flatMap((tool) =>
        sentences(strings(getToolContent(tool)))
          .filter((s) => NO_SETTINGS.test(s))
          .map((s) => `tools/${tool}: ${s}`),
      ),
    ];
    expect(found).toEqual([]);
  });
});

/**
 * Extract Tables' meta description (review, 2026-11-08) read "Extract tables
 * from a text-based PDF … Scans are read with OCR.": it limited the tool to
 * text-based PDFs, then said scans work, and never said OCR is opt-in. It
 * must now offer the switch as something the reader turns on, and not limit
 * the tool to text-based PDFs.
 */
describe("Extract Tables' meta description offers OCR as a choice", () => {
  const description = getToolContent("extract-tables")?.metaDescription ?? "";

  it("health check: the description exists", () => {
    expect(description.length).toBeGreaterThan(40);
  });

  it("says the reader ticks the OCR switch for a scan, and does not limit itself to text-based PDFs", () => {
    expect(description).toContain(`Tick “${WORD_OCR_LABEL}” to read a scan`);
    expect(description).not.toMatch(/text-based/i);
  });
});
