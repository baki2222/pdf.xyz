import { describe, expect, it } from "vitest";
import type { Op } from "./diff";
import { CONTEXT, buildHunks } from "./hunks";

/**
 * Where two changes share a hunk (review of audit compare-pdf#4,
 * 2026-11-14). The docblock said "closer than 2 × CONTEXT" while the code
 * merged at exactly 2 × CONTEXT, and no test told the two apart: mutating
 * the merge to `<` left every compare test green. This pins the boundary
 * from both sides.
 */

/** A change, `gap` unchanged lines, another change. */
function twoChanges(gap: number): Op[] {
  const ops: Op[] = [];
  let a = 0;
  let b = 0;
  const same = () => ops.push({ k: "same", a: a++, b: b++ });
  const change = () => {
    ops.push({ k: "removed", a: a++ });
    ops.push({ k: "added", b: b++ });
  };
  for (let i = 0; i < CONTEXT + 1; i += 1) same();
  change();
  for (let i = 0; i < gap; i += 1) same();
  change();
  for (let i = 0; i < CONTEXT + 1; i += 1) same();
  return ops;
}

const hunksOf = (ops: Op[]) =>
  buildHunks(
    ops,
    () => 1,
    () => 1,
  );

describe("hunks: changes at most 2 × CONTEXT unchanged lines apart share one", () => {
  it(`health: CONTEXT is ${CONTEXT}, and the builder makes the gap it is asked for`, () => {
    expect(CONTEXT).toBe(2);
    const ops = twoChanges(7);
    const at = ops
      .map((op, i) => (op.k === "same" ? -1 : i))
      .filter((i) => i >= 0);
    expect(at[2]! - at[1]! - 1).toBe(7);
  });

  it(`a gap of exactly 2 × CONTEXT (${2 * CONTEXT}) is one hunk, with every gap line printed once`, () => {
    const hunks = hunksOf(twoChanges(2 * CONTEXT));
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.ops.filter((op) => op.k === "same")).toHaveLength(
      2 * CONTEXT + 2 * CONTEXT,
    );
  });

  it(`a gap of 2 × CONTEXT + 1 is two hunks, and no context line is printed twice`, () => {
    const ops = twoChanges(2 * CONTEXT + 1);
    const hunks = hunksOf(ops);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]!.aEnd).toBeLessThanOrEqual(hunks[1]!.aStart);
  });
});
