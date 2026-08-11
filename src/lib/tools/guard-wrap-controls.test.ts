// @vitest-environment node
/**
 * A wrapped banned phrase is caught — proven with each guard's OWN patterns.
 *
 * A phrase search has a hole at every wrap point. Found first in a
 * `grep "circuit breaker"` that returned two copies where there were three
 * (`ratelimit/policy.ts` wraps between the two words), then in our own
 * `ai-allowance-copy` scan, and then measured in `transmission-honesty` and
 * `marketing-honesty`: their banned phrases sat in a walked file split across a
 * line and both suites reported **12 passed, 0 failed**.
 *
 * `flattenForPhraseSearch` closes it, and this file is the evidence that it does
 * — for the patterns that are actually shipped, not for a regex re-typed here.
 * `FORBIDDEN` is imported from the transmission guard itself, so if that list
 * changes, this control follows it. A control that re-derives the rule proves
 * only that the author can repeat themselves.
 *
 * WHAT THIS DOES NOT COVER, stated rather than left to be discovered:
 *
 *  1. **The guards' own assembly.** This exercises the real patterns, the real
 *     flattener and the real corpus, but composes them here rather than running
 *     the four suites. An earlier version DID spawn them as child processes;
 *     it was removed because `execFileSync("npx.cmd", …)` exits `status: null`
 *     with no output under Windows vitest, so the control counted "the runner
 *     could not start" as "the guard caught it" — a measuring instrument that
 *     treats its own failure as a positive result. What exposed it was a health
 *     check asserting the guards pass on an UNMODIFIED tree; the two health
 *     checks kept below ("still catches the unwrapped phrase", "does not fire on
 *     innocent text") exist for the same reason.
 *  2. **Phrases broken by interpolation or a variable.** `` `does not ${verb}
 *     the document` `` still walks past every one of these guards, because after
 *     flattening the source still reads `does not ${verb} the document`. Not
 *     closed here: closing it means evaluating template expressions, which is a
 *     different tool from a text scan, and the failure it would catch requires
 *     someone to build a user-facing claim out of runtime parts — which nothing
 *     in this codebase does today. Written down so the next person meets it as a
 *     known bound rather than a surprise.
 */
import { describe, expect, it } from "vitest";
import { flattenForPhraseSearch } from "./copy-surface";
import { FORBIDDEN } from "./transmission-honesty.test";

/** Marketing's own promise patterns, as that guard spells them. */
const LAYOUT_PROMISES = [
  /keeping its layout/i,
  /keeps? the layout/i,
  /preserv\w* (?:the )?(?:original )?layout/i,
  /same layout/i,
];

const hits = (patterns: RegExp[], source: string) =>
  patterns.filter((p) => p.test(source)).length;

/**
 * The two shapes, as they appear ON DISK — and they are genuinely different.
 *
 * `escaped` holds a backslash and an `n`, not whitespace, so collapsing
 * whitespace alone never touches it. That distinction is not academic: the
 * author's first reproduction of this defect used `escaped` while believing it
 * was a source line break, and the fix looked correct against a mechanism it did
 * not address. Both are pinned, and the "before" is asserted as well as the
 * "after", because a fix can otherwise appear to work on the wrong thing.
 */
const WRAPPED = {
  /** prettier splitting a long literal across lines at 80 columns. */
  concatenated: '"A follow-up does " +\n  "not resend the whole document."',
  /** An escaped break INSIDE the literal — two characters, not whitespace. */
  escaped: '"A follow-up does\\n  not resend the whole document."',
};

describe("the transmission guard's own patterns, through a wrap", () => {
  it("misses both wrapped forms WITHOUT flattening", () => {
    // The defect, pinned. If this ever starts passing, the patterns changed
    // shape and the rest of this file is measuring something else.
    for (const [shape, source] of Object.entries(WRAPPED)) {
      expect(hits([...FORBIDDEN], source), `${shape} was already caught`).toBe(
        0,
      );
    }
  });

  it("catches both wrapped forms WITH flattening", () => {
    for (const [shape, source] of Object.entries(WRAPPED)) {
      expect(
        hits([...FORBIDDEN], flattenForPhraseSearch(source)),
        `a claim this guard bans survived as ${shape} — the privacy page made ` +
          "exactly this claim once, and the engine resent the document anyway",
      ).toBeGreaterThan(0);
    }
  });

  it("still catches the unwrapped phrase, so flattening did not narrow it", () => {
    // The health check on the fix itself: a flattener that broke the ordinary
    // case would trade one hole for another.
    const plain = '"A follow-up does not resend the whole document."';
    expect(hits([...FORBIDDEN], plain)).toBeGreaterThan(0);
    expect(hits([...FORBIDDEN], flattenForPhraseSearch(plain))).toBeGreaterThan(
      0,
    );
  });

  it("does not fire on innocent text, flattened or not", () => {
    // Over-breadth check. Flattening joins lines, so it can create adjacencies
    // that did not exist in the source; this asserts it does not manufacture a
    // match out of two unrelated neighbours.
    const innocent =
      '"The document is sent once per run." +\n  "Ask anything."';
    expect(hits([...FORBIDDEN], flattenForPhraseSearch(innocent))).toBe(
      hits([...FORBIDDEN], innocent),
    );
  });
});

describe("the marketing guard's own patterns, through a wrap", () => {
  const wrapped = '"A translation keeping\\n  its layout is produced."';

  it("misses the wrapped promise without flattening and catches it with", () => {
    expect(hits(LAYOUT_PROMISES, wrapped)).toBe(0);
    expect(
      hits(LAYOUT_PROMISES, flattenForPhraseSearch(wrapped)),
      "a layout-preserving promise survived a line break; the translate engine " +
        "produces text, not a re-typeset PDF",
    ).toBeGreaterThan(0);
  });
});
