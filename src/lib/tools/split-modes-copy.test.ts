/**
 * Split PDF's page counts its modes in words ("in one of six ways") and
 * lists them by name in the intro and the "choose a mode" step. Nothing held
 * either to SPLIT_MODES: when the seventh mode ("Odd and even pages", audit
 * split-pdf#6, 2026-11-07) arrived, every copy guard stayed green over a page
 * that still said six. This holds the count and the list to the runner's own
 * table, in both directions: every mode is named, and the number is the
 * table's length.
 */
import { describe, expect, it } from "vitest";
import { SPLIT_MODES, SPLIT_MODE_LABEL } from "@/lib/pdf/offered-kinds";
import { getToolBySlug } from "@/lib/tools";
import { pageIntro, pageSteps, stepText } from "@/lib/tools/page-copy";
import { guides } from "@/lib/guides/catalog";

const WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

const tool = getToolBySlug("split-pdf")!;
const intro = pageIntro(tool).join(" ");
const steps = pageSteps(tool).map(stepText);

describe("Split PDF's copy counts and names every split mode", () => {
  it("the subjects exist (health)", () => {
    expect(tool).toBeTruthy();
    expect(SPLIT_MODES.length).toBeGreaterThanOrEqual(6);
    expect(intro.length).toBeGreaterThan(200);
  });

  it("the intro's count is the number of modes the runner offers", () => {
    const stated = [...intro.matchAll(/\bin one of (\w+) ways\b/gi)].map((m) =>
      m[1]!.toLowerCase(),
    );
    expect(stated, "the intro states a count").toHaveLength(1);
    expect(stated[0]).toBe(WORDS[SPLIT_MODES.length]);
  });

  it("the split guide's count is the same number", () => {
    const guide = guides.find((g) => g.slug === "how-to-split-a-pdf");
    expect(guide, "the split guide exists").toBeTruthy();
    const text = guide!.sections.flatMap((s) => s.body).join(" ");
    const stated = [...text.matchAll(/\boffers (\w+) ways\b/gi)].map((m) =>
      m[1]!.toLowerCase(),
    );
    expect(stated, "the guide states a count").toHaveLength(1);
    expect(stated[0]).toBe(WORDS[SPLIT_MODES.length]);
    expect(text).toContain(SPLIT_MODE_LABEL.oddEven.toLowerCase());
  });

  it("the intro and the choose step name every mode", () => {
    const choose = steps.find((s) => /How to split/.test(s));
    expect(choose, "a step names the How to split control").toBeTruthy();
    for (const mode of SPLIT_MODES) {
      expect(intro, `intro names ${mode}`).toContain(SPLIT_MODE_LABEL[mode]);
      expect(choose, `step names ${mode}`).toContain(SPLIT_MODE_LABEL[mode]);
    }
  });

  it("control: a count one off, or a missing name, is caught", () => {
    expect(WORDS[SPLIT_MODES.length - 1]).not.toBe(WORDS[SPLIT_MODES.length]);
    const without = intro.replace(SPLIT_MODE_LABEL.oddEven, "");
    expect(without).not.toContain(SPLIT_MODE_LABEL.oddEven);
  });
});
