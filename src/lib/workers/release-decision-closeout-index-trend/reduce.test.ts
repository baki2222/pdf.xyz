import { describe, expect, it } from "vitest";
import { computeTrendRollup, deriveTrendClass, directionOf, reduceTrend } from "./reduce";
import {
  blockedIndex,
  defaultPolicy,
  incompleteIndex,
  indexedIndex,
  ingestIndexesFrom,
  notAnIndex,
  openIndex,
  tamperedIndex,
} from "./fixtures";

/** Reduce + fold a list of window objects to the composite rollup under the given policy. */
function fold(objs: unknown[], policy = {}) {
  const { summary } = reduceTrend(ingestIndexesFrom(objs), defaultPolicy(policy).maxIndexes);
  return { summary, ...computeTrendRollup(summary, defaultPolicy(policy)) };
}

describe("directionOf — the arc by index verdict rank", () => {
  it("is unknown with < 2 usable, flat when equal, improving/degrading by rank", () => {
    expect(directionOf([])).toBe("unknown");
    expect(directionOf(["indexed"])).toBe("unknown");
    expect(directionOf(["indexed", "indexed"])).toBe("flat");
    expect(directionOf(["index-open", "indexed"])).toBe("improving");
    expect(directionOf(["indexed", "index-blocked"])).toBe("degrading");
  });
});

describe("deriveTrendClass — worst-present classification", () => {
  const counts = (over: Partial<Record<string, number>> = {}) => ({
    indexed: 0,
    "index-incomplete": 0,
    "index-open": 0,
    "index-blocked": 0,
    ...over,
  });
  it("classes by the worst present signal", () => {
    expect(deriveTrendClass(0, 0, 0, counts())).toBe("no-usable");
    expect(deriveTrendClass(2, 0, 0, counts({ indexed: 2 }))).toBe("all-indexed");
    expect(deriveTrendClass(1, 1, 0, counts({ indexed: 1 }))).toBe("incomplete-present"); // an unreadable window
    expect(deriveTrendClass(1, 0, 0, counts({ "index-open": 1 }))).toBe("watch-present");
    expect(deriveTrendClass(1, 0, 0, counts({ "index-blocked": 1 }))).toBe("blocked-present");
    expect(deriveTrendClass(1, 0, 1, counts({ indexed: 1 }))).toBe("tampered-present");
  });
});

describe("computeTrendRollup — verdict / exit ladder", () => {
  it("a coherent all-indexed history is trend-stable (exit 0)", () => {
    const { rollup } = fold([indexedIndex(), indexedIndex()]);
    expect(rollup.verdict).toBe("trend-stable");
    expect(rollup.exitCode).toBe(0);
    expect(rollup.stable).toBe(true);
    expect(rollup.reasons).toContain("history-coherent");
  });

  it("a flat incomplete history is trend-incomplete (exit 2), never a vacuous stable", () => {
    const { rollup } = fold([incompleteIndex(), incompleteIndex()]);
    expect(rollup.verdict).toBe("trend-incomplete");
    expect(rollup.exitCode).toBe(2);
    expect(rollup.reasons).toContain("latest-incomplete");
  });

  it("an empty history is trend-incomplete (no-indexes), never trend-stable", () => {
    const { rollup } = fold([]);
    expect(rollup.verdict).toBe("trend-incomplete");
    expect(rollup.reasons).toContain("no-indexes");
  });

  it("a latest-open / degrading history is trend-watch (exit 3)", () => {
    const { rollup } = fold([indexedIndex(), openIndex()]);
    expect(rollup.verdict).toBe("trend-watch");
    expect(rollup.exitCode).toBe(3);
    expect(rollup.reasons).toContain("latest-open");
    expect(rollup.reasons).toContain("trend-degrading");
    expect(rollup.direction).toBe("degrading");
  });

  it("a latest-blocked history is trend-blocked (exit 4)", () => {
    const { rollup } = fold([indexedIndex(), blockedIndex()]);
    expect(rollup.verdict).toBe("trend-blocked");
    expect(rollup.exitCode).toBe(4);
    expect(rollup.reasons).toContain("latest-blocked");
  });

  it("a tampered window is trend-blocked; an unreadable decoy is trend-incomplete", () => {
    expect(fold([indexedIndex(), tamperedIndex()]).rollup.verdict).toBe("trend-blocked");
    expect(fold([indexedIndex(), tamperedIndex()]).rollup.reasons).toContain("index-tampered");
    const decoy = fold([indexedIndex(), notAnIndex()]);
    expect(decoy.rollup.verdict).toBe("trend-incomplete");
    expect(decoy.rollup.reasons).toContain("index-unreadable");
  });

  it("an improving history that recovers to a tolerated-clean latest is trend-stable", () => {
    // oldest incomplete → newest indexed, tolerate the one incomplete: improving + stable.
    const { rollup, summary } = fold([incompleteIndex(), indexedIndex()], { maxIncomplete: 1 });
    expect(rollup.verdict).toBe("trend-stable");
    expect(summary.direction).toBe("improving");
    expect(rollup.reasons).toContain("trend-improving");
  });

  it("thresholds tolerate a bounded backlog until the count is exceeded", () => {
    // two older opens, latest indexed. Default max-watch=0 → escalates; tolerate 2 → stable.
    const hist = [openIndex(), openIndex(), indexedIndex()];
    expect(fold(hist, { maxWatch: 9, maxIncomplete: 9 }).rollup.verdict).not.toBe("trend-watch"); // improving+stable
    expect(fold(hist).rollup.verdict).toBe("trend-watch"); // max-watch=0 → watch-threshold-exceeded
    expect(fold(hist).rollup.reasons).toContain("watch-threshold-exceeded");
  });

  it("--strict-watch escalates a watch trend to blocked and records the escalation", () => {
    const base = fold([indexedIndex(), openIndex()]);
    expect(base.rollup.verdict).toBe("trend-watch");
    const strict = fold([indexedIndex(), openIndex()], { strictWatch: true });
    expect(strict.rollup.verdict).toBe("trend-blocked");
    expect(strict.rollup.strictWatchEscalated).toBe(true);
    expect(strict.rollup.strictWatchEscalatedFrom).toBe("trend-watch");
    expect(strict.rollup.reasons).toContain("strict-watch-escalation");
  });

  it("--strict-watch does NOT escalate a real blocker or a clean history", () => {
    expect(fold([indexedIndex(), blockedIndex()], { strictWatch: true }).rollup.strictWatchEscalated).toBe(
      false,
    );
    expect(fold([indexedIndex(), indexedIndex()], { strictWatch: true }).rollup.verdict).toBe("trend-stable");
  });

  it("the window cap keeps the newest N and surfaces the count dropped (never silent)", () => {
    const { summary } = fold([blockedIndex(), indexedIndex(), indexedIndex()], { maxIndexes: 2 });
    expect(summary.indexesSupplied).toBe(3);
    expect(summary.indexesConsidered).toBe(2);
    expect(summary.truncated).toBe(true);
    expect(summary.droppedOldest).toBe(1);
    expect(summary.indexVerdictCounts["index-blocked"]).toBe(0); // the oldest blocked window was dropped
  });
});
