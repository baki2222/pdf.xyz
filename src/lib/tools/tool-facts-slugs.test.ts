// @vitest-environment node
/**
 * Every key in `tool-facts.ts`'s FACTS table names a real tool.
 *
 * `FACTS` is a `Record<string, …>` and `tools` is `Tool[]` with `slug: string`,
 * so a typo'd or renamed key ("rotate-pfd") compiles: `toolFacts("rotate-pdf")`
 * then returns `[]` and the tool page silently drops its facts section. The
 * export `FACTS_SLUGS` carried a docblock saying it existed "so tests can pin
 * the scoped set" — and until this file, no test imported it. A comment is not
 * a guard.
 *
 * Typing the keys cannot close this either: `(typeof tools)[number]["slug"]`
 * is `string`. So the relationship is checked here, against the catalogue, with
 * a floor on the set (an empty set passes `⊆` vacuously) and a mutated copy
 * run through the same predicate as the positive control. That the facts then
 * REACH the page is checked on the served markup in `tool-faq-substance.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import { FACTS_SLUGS, toolFacts } from "./tool-facts";

/** Keys that name no tool in the catalogue. */
function orphans(keys: readonly string[]): string[] {
  const slugs = new Set(tools.map((t) => t.slug));
  return keys.filter((key) => !slugs.has(key));
}

describe("FACTS keys", () => {
  it("the set is plausibly sized (health check)", () => {
    // 21 tools carry authored facts today; a collapse to a handful is a broken
    // table, not a pass.
    expect(FACTS_SLUGS.length, FACTS_SLUGS.join(", ")).toBeGreaterThanOrEqual(
      15,
    );
    expect(new Set(FACTS_SLUGS).size).toBe(FACTS_SLUGS.length);
  });

  it("every key names a tool in the catalogue", () => {
    expect(orphans(FACTS_SLUGS), "these keys name no tool").toEqual([]);
  });

  it("the predicate catches a typo'd key and passes a real one (controls)", () => {
    expect(orphans([...FACTS_SLUGS, "rotate-pfd"])).toContain("rotate-pfd");
    expect(orphans(["rotate-pdf"])).toEqual([]);
  });

  it("every key's facts are what the page's accessor returns", () => {
    for (const slug of FACTS_SLUGS)
      expect(toolFacts(slug).length, slug).toBeGreaterThan(0);
  });
});
