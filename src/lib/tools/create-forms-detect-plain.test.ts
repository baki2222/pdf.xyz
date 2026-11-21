/**
 * DETECTION_RULES' plain words never claim the finder is complete.
 *
 * They are served inside "It looks for <plain>, <plain> and <plain>, and
 * suggests ..." (create-forms-detect-copy.test.ts derives that list). That
 * guard's over-claim shapes want a finding verb ("finds", "detects") before
 * "every ... field", and the list's verb is "looks for": so S5's review
 * round 1 changed header-cell's plain words to "every fillable field on the
 * page" (mutant CG6) and only S5's own test, which pins those words
 * exactly, turned red. This file holds the property for EVERY rule, the
 * ones to come included: a shape is named, never a quantity.
 *
 * House rule 1, both ways: every claim below is caught by some pattern,
 * and every pattern catches some claim (the corpus), and no rule's plain
 * words are caught (the subject). The subject's size is bounded, so a list
 * that emptied could not pass by having nothing to say.
 */
import { describe, expect, it } from "vitest";
import { DETECTION_RULES } from "@/lib/pdf/form-detect";

/** Shapes of a completeness claim inside a list of what is looked for. */
const COMPLETE: Record<string, RegExp> = {
  quantifier: /\b(?:every|all|each|any)\b/i,
  whole: /\b(?:whole|entire|complete(?:ly)?|full set)\b/i,
};

/** Plain words that would claim completeness, each caught by a shape. */
const CLAIMS = [
  // Mutant CG6 of review round 1, verbatim.
  "every fillable field on the page",
  "all blank lines",
  "each empty box",
  "any table cell",
  "the whole form's blanks",
  "the complete set of fields",
];

const caught = (s: string) =>
  Object.entries(COMPLETE)
    .filter(([, re]) => re.test(s))
    .map(([k]) => k);

describe("DETECTION_RULES' plain words name shapes, never a quantity", () => {
  it("corpus: every claim is caught, and every shape catches a claim", () => {
    for (const c of CLAIMS) expect(caught(c), c).not.toEqual([]);
    for (const k of Object.keys(COMPLETE))
      expect(
        CLAIMS.filter((c) => COMPLETE[k]!.test(c)),
        k,
      ).not.toEqual([]);
  });

  it("subject: no rule's plain words are caught (and the rules are all there)", () => {
    // 8 rules at S5; a list that shrank to nothing would pass vacuously.
    expect(DETECTION_RULES.length).toBeGreaterThanOrEqual(8);
    for (const r of DETECTION_RULES)
      expect(caught(r.plain), `${r.id}: ${r.plain}`).toEqual([]);
  });
});
