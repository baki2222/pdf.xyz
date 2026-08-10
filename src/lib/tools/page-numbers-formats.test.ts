/**
 * The stated formats are the offered formats.
 *
 * The page-numbers facts entry read "Three numbering formats: …" while the
 * runner offered FOUR presets plus a free-form template field — a count copied
 * from neighbouring prose instead of from the code, which then became the
 * source for a meta description that shipped the same wrong number to search
 * results and to WebApplication JSON-LD. Prose sourced from prose drifts; this
 * pins the fact to the list it describes, so adding or renaming a preset fails
 * here instead of quietly making the page wrong.
 */
import { describe, expect, it } from "vitest";
import { FORMAT_PRESETS } from "@/components/tools/runner/page-numbers-runner";
import { toolFacts } from "./tool-facts";

const formatsFact = () => {
  const fact = toolFacts("page-numbers").find((f) => f.label === "Formats");
  if (!fact) throw new Error("page-numbers no longer states a Formats fact");
  return fact.value;
};

describe("the page-numbers formats fact matches the runner", () => {
  it("names every preset the runner offers, and no others", () => {
    // Compare QUOTED tokens as a set, not by substring: the "1" preset's label
    // is a substring of every other label, so a containment check could never
    // fail for it — an assertion that cannot fail is not a guard.
    const norm = (s: string) => s.replace(/[–—-]/g, "-").replace(/\s+/g, " ").trim();
    const quoted = [...formatsFact().matchAll(/[“"]([^“”"]+)[”"]/g)].map((m) => norm(m[1]!));
    expect(
      quoted.slice().sort(),
      "the stated preset formats and the runner's FORMAT_PRESETS have diverged",
    ).toEqual(FORMAT_PRESETS.map((p) => norm(p.label)).sort());
  });

  it("does not state a count that the preset list can outgrow", () => {
    const stated = formatsFact().toLowerCase();
    for (const word of ["one", "two", "three", "four", "five", "six"]) {
      expect(
        stated,
        `the formats fact spells a count ("${word}"), which drifts the moment a preset is added — name the presets instead`,
      ).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
  });

  it("says the format can also be written by hand", () => {
    // The free-form field is a real capability the old entry omitted entirely.
    expect(formatsFact()).toMatch(/\{n\}/);
  });
});
