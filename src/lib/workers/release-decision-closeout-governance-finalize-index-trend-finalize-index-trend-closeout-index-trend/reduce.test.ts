import { describe, expect, it } from "vitest";
import { computeTrendRollup, deriveTrendClass, directionOf, reduceTrend } from "./reduce";
import {
  blockedWindow,
  defaultPolicy,
  incompleteWindow,
  indexedWindow,
  ingestWindowsFrom,
  invalidWindow,
  notAWindow,
  openWindow,
  tamperedWindow,
} from "./fixtures";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexVerdict } from "./types";

/** Reduce + fold a list of window objects, returning the summary + rollup + reasons together. */
function fold(objs: readonly unknown[], policy = {}) {
  const summary = reduceTrend(ingestWindowsFrom(objs), defaultPolicy(policy).maxIndexes).summary;
  return { summary, ...computeTrendRollup(summary, defaultPolicy(policy)) };
}

describe("directionOf — the arc by index verdict rank", () => {
  it("is unknown with < 2 usable, stable when equal, improving/degrading/mixed by rank", () => {
    expect(directionOf([])).toBe("unknown");
    expect(directionOf(["indexed"])).toBe("unknown");
    expect(directionOf(["indexed", "indexed"])).toBe("stable");
    expect(directionOf(["index-open", "indexed"])).toBe("improving");
    expect(directionOf(["indexed", "index-blocked"])).toBe("degrading");
    expect(directionOf(["indexed", "index-open", "indexed"])).toBe("mixed");
  });
});

describe("deriveTrendClass — worst-present + arc classification (8-value)", () => {
  function counts(
    over: Partial<Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexVerdict, number>> = {},
  ): Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexVerdict, number> {
    return { indexed: 0, "index-open": 0, "index-incomplete": 0, "index-blocked": 0, "index-invalid": 0, ...over };
  }
  it("classes by the worst present signal + arc", () => {
    expect(deriveTrendClass(0, 0, 0, counts(), null, "unknown")).toBe("no-usable");
    expect(deriveTrendClass(2, 0, 0, counts({ indexed: 2 }), "indexed", "stable")).toBe("clean");
    expect(deriveTrendClass(1, 1, 0, counts({ indexed: 1 }), "indexed", "unknown")).toBe("invalid");
    expect(deriveTrendClass(1, 0, 1, counts({ indexed: 1 }), "indexed", "unknown")).toBe("invalid");
    expect(deriveTrendClass(1, 0, 0, counts({ "index-blocked": 1 }), "index-blocked", "unknown")).toBe("blocked");
    expect(deriveTrendClass(1, 0, 0, counts({ "index-invalid": 1 }), "index-invalid", "unknown")).toBe("blocked");
    expect(deriveTrendClass(1, 0, 0, counts({ "index-incomplete": 1 }), "index-incomplete", "unknown")).toBe(
      "insufficient",
    );
    expect(deriveTrendClass(1, 0, 0, counts({ "index-open": 1 }), "index-open", "unknown")).toBe("regressing");
    expect(deriveTrendClass(2, 0, 0, counts({ indexed: 1, "index-open": 1 }), "indexed", "improving")).toBe(
      "recovering",
    );
    expect(deriveTrendClass(3, 0, 0, counts({ indexed: 2, "index-open": 1 }), "indexed", "mixed")).toBe("watch");
  });
});

describe("computeTrendRollup — the 7-verdict fold", () => {
  it("a coherent all-indexed history is stable (exit 0)", () => {
    const { rollup } = fold([indexedWindow(), indexedWindow()]);
    expect(rollup.verdict).toBe("stable");
    expect(rollup.exitCode).toBe(0);
    expect(rollup.clean).toBe(true);
    expect(rollup.reasons).toContain("history-coherent");
  });

  it("an improving arc to a clean latest is improving (exit 0)", () => {
    const { rollup, summary } = fold([openWindow(), indexedWindow()]);
    expect(rollup.verdict).toBe("improving");
    expect(rollup.exitCode).toBe(0);
    expect(summary.direction).toBe("improving");
    expect(rollup.reasons).toContain("trend-improving");
  });

  it("an older open under a clean latest past the watch threshold is watch (exit 3), not stable", () => {
    const { rollup } = fold([indexedWindow(), openWindow(), indexedWindow()]);
    expect(rollup.verdict).toBe("watch");
    expect(rollup.exitCode).toBe(3);
    expect(rollup.reasons).toContain("watch-threshold-exceeded");
  });

  it("a latest-open / degrading history is degrading (exit 3)", () => {
    const { rollup } = fold([indexedWindow(), openWindow()]);
    expect(rollup.verdict).toBe("degrading");
    expect(rollup.exitCode).toBe(3);
    expect(rollup.reasons).toContain("latest-open");
    expect(rollup.reasons).toContain("trend-degrading");
    expect(rollup.direction).toBe("degrading");
  });

  it("a flat incomplete history is insufficient (exit 2), never a vacuous stable", () => {
    const { rollup } = fold([incompleteWindow(), incompleteWindow()]);
    expect(rollup.verdict).toBe("insufficient");
    expect(rollup.exitCode).toBe(2);
    expect(rollup.reasons).toContain("latest-incomplete");
    expect(rollup.reasons).toContain("incomplete-threshold-exceeded");
  });

  it("an empty history is insufficient (no-indexes), never stable", () => {
    const { rollup } = fold([]);
    expect(rollup.verdict).toBe("insufficient");
    expect(rollup.reasons).toContain("no-indexes");
  });

  it("a latest-blocked history is blocked (exit 4)", () => {
    const { rollup } = fold([indexedWindow(), blockedWindow()]);
    expect(rollup.verdict).toBe("blocked");
    expect(rollup.exitCode).toBe(4);
    expect(rollup.reasons).toContain("latest-blocked");
  });

  it("an index-invalid usable window is blocked; distinct from a tampered / unreadable input", () => {
    const invalidUsable = fold([indexedWindow(), invalidWindow()]);
    expect(invalidUsable.rollup.verdict).toBe("blocked");
    expect(invalidUsable.rollup.reasons).toContain("latest-blocked");

    const tampered = fold([indexedWindow(), tamperedWindow()]);
    expect(tampered.rollup.verdict).toBe("invalid");
    expect(tampered.rollup.reasons).toContain("index-tampered");

    const unreadable = fold([indexedWindow(), notAWindow()]);
    expect(unreadable.rollup.verdict).toBe("invalid");
    expect(unreadable.rollup.reasons).toContain("index-unreadable");
  });

  it("--strict-watch escalates a watch / degrading trend to blocked and records the escalation", () => {
    expect(fold([indexedWindow(), openWindow()]).rollup.verdict).toBe("degrading");
    const strict = fold([indexedWindow(), openWindow()], { strictWatch: true });
    expect(strict.rollup.verdict).toBe("blocked");
    expect(strict.rollup.strictWatchEscalated).toBe(true);
    expect(strict.rollup.strictWatchEscalatedFrom).toBe("degrading");
    expect(strict.rollup.reasons).toContain("strict-watch-escalation");
  });

  it("--strict-watch does NOT escalate a real blocker, an invalid input, or a clean history", () => {
    expect(fold([indexedWindow(), blockedWindow()], { strictWatch: true }).rollup.strictWatchEscalated).toBe(false);
    expect(fold([indexedWindow(), tamperedWindow()], { strictWatch: true }).rollup.verdict).toBe("invalid");
    expect(fold([indexedWindow(), indexedWindow()], { strictWatch: true }).rollup.verdict).toBe("stable");
  }, 15_000);

  it("--require-latest-indexed surfaces a reason when the latest is not indexed", () => {
    const { rollup } = fold([indexedWindow(), openWindow()], { requireLatestIndexed: true });
    expect(rollup.reasons).toContain("require-latest-miss");
    expect(rollup.requireLatestIndexed).toBe(true);
    // A non-indexed latest can never be stable / improving.
    expect(["watch", "degrading", "insufficient", "blocked", "invalid"]).toContain(rollup.verdict);
  });

  it("the thresholds tolerate a bounded number of non-indexed OLDER windows under a clean latest", () => {
    // Default (zero) thresholds: any older open / blocked / incomplete escalates.
    expect(fold([indexedWindow(), openWindow(), indexedWindow()]).rollup.verdict).toBe("watch");
    // Raised thresholds tolerate them → stable.
    expect(fold([indexedWindow(), openWindow(), indexedWindow()], { maxWatch: 1 }).rollup.verdict).toBe("stable");
    expect(fold([indexedWindow(), blockedWindow(), indexedWindow()], { maxBlocked: 1 }).rollup.verdict).toBe("stable");
    expect(fold([incompleteWindow(), indexedWindow()], { maxIncomplete: 1 }).rollup.verdict).toBe("improving");
  }, 15_000);

  it("the window cap keeps the newest N and surfaces the count dropped (never silent)", () => {
    const { summary } = fold([blockedWindow(), indexedWindow(), indexedWindow()], { maxIndexes: 2 });
    expect(summary.indexesSupplied).toBe(3);
    expect(summary.indexesConsidered).toBe(2);
    expect(summary.truncated).toBe(true);
    expect(summary.droppedOldest).toBe(1);
    expect(summary.indexVerdictCounts["index-blocked"]).toBe(0);
  });
});
