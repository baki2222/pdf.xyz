// @vitest-environment node
/**
 * Unit proofs for the pipeline rollup arithmetic: every stage exit code maps to the right
 * bounded severity, off-ladder codes fail closed (never `ok`/`0`), and the composite is the
 * worst (highest) arm code — including `usage`, so a misused run is never a silent pass.
 */
import { describe, expect, it } from "vitest";
import { clampExit, rollupExit, severityForExit } from "./rollup";
import { PIPELINE_EXIT, PIPELINE_SEVERITIES } from "./types";

describe("severityForExit", () => {
  it("maps the known ladder 1:1", () => {
    expect(severityForExit(0)).toBe("ok");
    expect(severityForExit(2)).toBe("unknown");
    expect(severityForExit(3)).toBe("drift");
    expect(severityForExit(4)).toBe("breach");
  });

  it("folds usage (1) and any off-ladder code to the non-zero usage band", () => {
    expect(severityForExit(1)).toBe("usage");
    expect(severityForExit(5)).toBe("usage");
    expect(severityForExit(-1)).toBe("usage");
    expect(severityForExit(2.5)).toBe("usage");
    expect(severityForExit(Number.NaN)).toBe("usage");
  });

  it("only ever returns a bounded severity", () => {
    for (const code of [-2, 0, 1, 2, 3, 4, 5, 99, Number.POSITIVE_INFINITY]) {
      expect(PIPELINE_SEVERITIES).toContain(severityForExit(code));
    }
  });
});

describe("clampExit", () => {
  it("passes a valid ladder code through", () => {
    for (const c of [0, 1, 2, 3, 4]) expect(clampExit(c)).toBe(c);
  });

  it("folds an out-of-range / non-integer code to the usage band (fail closed, never 0)", () => {
    expect(clampExit(5)).toBe(PIPELINE_EXIT.USAGE);
    expect(clampExit(-1)).toBe(PIPELINE_EXIT.USAGE);
    expect(clampExit(2.5)).toBe(PIPELINE_EXIT.USAGE);
    expect(clampExit(Number.NaN)).toBe(PIPELINE_EXIT.USAGE);
  });
});

describe("rollupExit — worst (highest) code wins", () => {
  it("is OK only when every arm is OK", () => {
    expect(rollupExit([0, 0])).toBe(0);
  });

  it("takes the maximum across the ladder", () => {
    expect(rollupExit([0, 2])).toBe(2); // ok + unknown
    expect(rollupExit([0, 3])).toBe(3); // ok + drift
    expect(rollupExit([2, 4])).toBe(4); // unknown + breach
    expect(rollupExit([3, 4])).toBe(4); // drift + breach
  });

  it("counts usage into the maximum — an all-usage run is 1, never a silent 0", () => {
    expect(rollupExit([1, 1])).toBe(1);
    expect(rollupExit([0, 1])).toBe(1);
  });

  it("lets a real danger outrank a usage in the other arm", () => {
    expect(rollupExit([1, 4])).toBe(4); // usage + breach → breach
    expect(rollupExit([1, 3])).toBe(3); // usage + drift → drift
  });

  it("clamps an off-ladder arm code to usage before rolling up", () => {
    expect(rollupExit([0, 7])).toBe(1); // 7 → usage
    expect(rollupExit([7, 4])).toBe(4); // 7 → usage, breach still wins
  });

  it("an empty set is OK (nothing ran, nothing failed)", () => {
    expect(rollupExit([])).toBe(0);
  });
});
