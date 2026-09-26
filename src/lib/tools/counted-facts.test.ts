/**
 * Every count a tool page spells out is the length of the list it counts.
 *
 * Audited at 67e8d0f, production served "Eight element types, including text,
 * boxes, lines, images, and filled shapes" on /tools/edit-pdf, over an editor
 * whose ops are `text | rect | line | image` — four, with "filled" an option on
 * the box — and "Six annotation kinds" on /tools/annotate-pdf over a tool with
 * four. Looking for their siblings found a third: Sign PDF's "Five ways to make
 * a signature" counted the typed signature once per font style and named a
 * "print-and-scan style" the runner does not have (three sources: draw, type,
 * upload). All three were hand-typed into `tool-facts.ts`, under a header that
 * promises every figure there is derived from code.
 *
 * `page-numbers-formats.test.ts` had already fixed one of these, for one tool,
 * by naming it. This one DISCOVERS its subjects: it walks every tool's facts,
 * finds every spelled count, and requires each to carry the list it counts —
 * by IDENTITY one of the arrays in `@/lib/pdf/offered-kinds` that the runners
 * iterate, so a hand-typed copy of the list does not satisfy it either.
 *
 * Known bound, recorded rather than discovered: "one" is not treated as a count
 * ("one file per page", "in one pass" are not claims about a list), and a count
 * written in digits ("4 element types") is not matched — no shipped fact has
 * ever used that shape, and a pattern nothing exercises is decoration. Digits
 * on tool pages are the numbers census's job.
 */
import { describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import * as offered from "@/lib/pdf/offered-kinds";
import { toolFacts, type ToolFact } from "./tool-facts";

/**
 * An independent spelling of the words, on purpose: reusing `countWord` from
 * the module under test would let a broken table agree with itself.
 */
const VALUE: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};
const COUNT_WORD = new RegExp(`\\b(${Object.keys(VALUE).join("|")})\\b`, "gi");

function countsIn(text: string): number[] {
  return [...text.matchAll(COUNT_WORD)].map((m) => VALUE[m[1]!.toLowerCase()]!);
}

/** Every exported array in the offered-kinds leaf — the only legal `counts`. */
const OFFERED_LISTS: readonly unknown[] = Object.values(offered).filter(
  Array.isArray,
);

/** Every (tool, fact) pair on the site whose label or value spells a count. */
function countedFacts(): { slug: string; fact: ToolFact; counts: number[] }[] {
  return tools.flatMap((tool) =>
    toolFacts(tool.slug)
      .map((fact) => ({
        slug: tool.slug,
        fact,
        counts: countsIn(`${fact.label} ${fact.value}`),
      }))
      .filter((entry) => entry.counts.length > 0),
  );
}

describe("spelled counts on tool pages", () => {
  it("finds the counts it exists to police (health check on the discovered set)", () => {
    // split, sign, edit, create-forms and annotate all state one today.
    expect(countedFacts().length).toBeGreaterThanOrEqual(5);
    expect(OFFERED_LISTS.length).toBeGreaterThanOrEqual(5);
  });

  it("the detector catches every count the product shipped wrong (positive control)", () => {
    const shipped = [
      "Eight element types, including text, boxes, lines, images, and filled shapes.",
      "Six annotation kinds, including highlights, boxes, notes, and lines.",
      "Five ways to make a signature: draw it, type it, pick an image, use a script font, or print-and-scan style.",
    ];
    for (const sentence of shipped)
      expect(countsIn(sentence), sentence).not.toEqual([]);
  });

  it("each count is the length of a list the runner iterates — by identity, not a copy", () => {
    const offenders: string[] = [];
    for (const { slug, fact, counts } of countedFacts()) {
      const where = `${slug} "${fact.label}": ${fact.value}`;
      if (!fact.counts) {
        offenders.push(`${where} — spells a count but declares no list`);
        continue;
      }
      if (!OFFERED_LISTS.includes(fact.counts))
        offenders.push(`${where} — its list is not an offered-kinds array`);
      if (counts.length !== 1)
        offenders.push(`${where} — ${counts.length} counts in one fact`);
      else if (counts[0] !== fact.counts.length)
        offenders.push(
          `${where} — says ${counts[0]}, the list has ${fact.counts.length}`,
        );
    }
    expect(offenders).toEqual([]);
  });

  it("a fact that declares a list states its count (no silent `counts`)", () => {
    const orphaned = tools.flatMap((tool) =>
      toolFacts(tool.slug)
        .filter(
          (fact) =>
            fact.counts && countsIn(`${fact.label} ${fact.value}`).length === 0,
        )
        .map((fact) => `${tool.slug} "${fact.label}"`),
    );
    expect(orphaned).toEqual([]);
  });
});
