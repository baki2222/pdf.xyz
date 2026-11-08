import { describe, expect, test } from "vitest";
import { runBounded } from "./bounded";

// PS-04: Form XObjects nested 2,000 (and 20,000) deep blew the stack in the
// page copier (ForeignAwareCopier recursed copyRef -> copy -> copyStream ->
// copyDict -> copy, about 8 frames per nesting level), so merge, extract,
// split, organize and split-half showed the user "Maximum call stack size
// exceeded". The copier now follows references from a work list, so the
// depth of a chain costs no stack at all, and the copy is COMPLETE: the
// output still reaches every form in the chain (not a refusal, and not a
// truncated copy that would draw nothing).
//
// Each case runs in a child process with the default main-thread stack: the
// overflow does not reproduce at 2,000 under vitest's 4 MB worker stack.
const CHILD = "src/tests/hostile/ps04-deep-forms.child.ts";

const ENTRIES = [
  "extract",
  "merge",
  "mergeAlternate",
  "split",
  "organize",
  "splitHalf",
] as const;

describe("PS-04: deep Form XObject chains copy without recursion", () => {
  for (const entry of ENTRIES) {
    test(`PS-04: ${entry} copies a 2,000-deep chain whole`, async () => {
      const r = await runBounded(CHILD, ["H08.forms2000", entry], 60_000);
      expect(r).toMatchObject({
        kind: "settled",
        value: { ok: true, chain: 2000 },
      });
    }, 70_000);
  }

  // The 20,000-deep fixture is the one that failed even under a 4 MB stack.
  for (const entry of ["extract", "merge"] as const) {
    test(`PS-04: ${entry} copies a 20,000-deep chain whole`, async () => {
      const r = await runBounded(CHILD, ["H08.forms20000", entry], 120_000);
      expect(r).toMatchObject({
        kind: "settled",
        value: { ok: true, chain: 20_000 },
      });
    }, 130_000);
  }
});
