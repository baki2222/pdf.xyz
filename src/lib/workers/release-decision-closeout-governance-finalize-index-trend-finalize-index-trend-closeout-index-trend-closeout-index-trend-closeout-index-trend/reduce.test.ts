import { describe, expect, it } from "vitest";
import { computeTrendRollup, deriveTrendClass, directionOf, reduceTrend } from "./reduce";
import {
  blockedWindow,
  defaultPolicy,
  incompleteWindow,
  allClosedWindow,
  ingestWindowsFrom,
  invalidWindow,
  notAWindow,
  openWindow,
  tamperedWindow,
} from "./fixtures";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict } from "./types";

/** Reduce + fold a list of window objects, returning the summary + rollup + reasons together. */
function fold(objs: readonly unknown[], policy = {}) {
  const summary = reduceTrend(ingestWindowsFrom(objs), defaultPolicy(policy).maxIndexes).summary;
  return { summary, ...computeTrendRollup(summary, defaultPolicy(policy)) };
}

describe("directionOf — the arc by index verdict rank", () => {
  it("is unknown with < 2 usable, stable when equal, improving/degrading/mixed by rank", () => {
    expect(directionOf([])).toBe("unknown");
    expect(directionOf(["all-closed"])).toBe("unknown");
    expect(directionOf(["all-closed", "all-closed"])).toBe("stable");
    expect(directionOf(["open", "all-closed"])).toBe("improving");
    expect(directionOf(["all-closed", "blocked"])).toBe("degrading");
    expect(directionOf(["all-closed", "open", "all-closed"])).toBe("mixed");
  });
});

describe("deriveTrendClass — worst-present + arc classification (8-value)", () => {
  function counts(
    over: Partial<Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict, number>> = {},
  ): Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict, number> {
    return { "all-closed": 0, "open": 0, "incomplete": 0, "blocked": 0, "invalid": 0, ...over };
  }
  it("classes by the worst present signal + arc", () => {
    expect(deriveTrendClass(0, 0, 0, counts(), null, "unknown")).toBe("no-usable");
    expect(deriveTrendClass(2, 0, 0, counts({ "all-closed": 2 }), "all-closed", "stable")).toBe("clean");
    expect(deriveTrendClass(1, 1, 0, counts({ "all-closed": 1 }), "all-closed", "unknown")).toBe("invalid");
    expect(deriveTrendClass(1, 0, 1, counts({ "all-closed": 1 }), "all-closed", "unknown")).toBe("invalid");
    expect(deriveTrendClass(1, 0, 0, counts({ "blocked": 1 }), "blocked", "unknown")).toBe("blocked");
    expect(deriveTrendClass(1, 0, 0, counts({ "invalid": 1 }), "invalid", "unknown")).toBe("blocked");
    expect(deriveTrendClass(1, 0, 0, counts({ "incomplete": 1 }), "incomplete", "unknown")).toBe(
      "insufficient",
    );
    expect(deriveTrendClass(1, 0, 0, counts({ "open": 1 }), "open", "unknown")).toBe("regressing");
    expect(deriveTrendClass(2, 0, 0, counts({ "all-closed": 1, "open": 1 }), "all-closed", "improving")).toBe(
      "recovering",
    );
    expect(deriveTrendClass(3, 0, 0, counts({ "all-closed": 2, "open": 1 }), "all-closed", "mixed")).toBe("watch");
  });
});

describe("computeTrendRollup — the 7-verdict fold", () => {
  it("a coherent all-indexed history is stable (exit 0)", () => {
    const { rollup } = fold([allClosedWindow(), allClosedWindow()]);
    expect(rollup.verdict).toBe("stable");
    expect(rollup.exitCode).toBe(0);
    expect(rollup.clean).toBe(true);
    expect(rollup.reasons).toContain("history-coherent");
  });

  it("an improving arc to a clean latest is improving (exit 0)", () => {
    const { rollup, summary } = fold([openWindow(), allClosedWindow()]);
    expect(rollup.verdict).toBe("improving");
    expect(rollup.exitCode).toBe(0);
    expect(summary.direction).toBe("improving");
    expect(rollup.reasons).toContain("trend-improving");
  });

  it("an older open under a clean latest past the watch threshold is watch (exit 3), not stable", () => {
    const { rollup } = fold([allClosedWindow(), openWindow(), allClosedWindow()]);
    expect(rollup.verdict).toBe("watch");
    expect(rollup.exitCode).toBe(3);
    expect(rollup.reasons).toContain("open-threshold-exceeded");
  });

  it("a latest-open / degrading history is degrading (exit 3)", () => {
    const { rollup } = fold([allClosedWindow(), openWindow()]);
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
    const { rollup } = fold([allClosedWindow(), blockedWindow()]);
    expect(rollup.verdict).toBe("blocked");
    expect(rollup.exitCode).toBe(4);
    expect(rollup.reasons).toContain("latest-blocked");
  });

  it("an invalid usable window is blocked; distinct from a tampered / unreadable input", () => {
    const invalidUsable = fold([allClosedWindow(), invalidWindow()]);
    expect(invalidUsable.rollup.verdict).toBe("blocked");
    expect(invalidUsable.rollup.reasons).toContain("latest-blocked");

    const tampered = fold([allClosedWindow(), tamperedWindow()]);
    expect(tampered.rollup.verdict).toBe("invalid");
    expect(tampered.rollup.reasons).toContain("index-tampered");

    const unreadable = fold([allClosedWindow(), notAWindow()]);
    expect(unreadable.rollup.verdict).toBe("invalid");
    expect(unreadable.rollup.reasons).toContain("index-unreadable");
  });

  it("--strict-open escalates a watch / degrading trend to blocked and records the escalation", () => {
    expect(fold([allClosedWindow(), openWindow()]).rollup.verdict).toBe("degrading");
    const strict = fold([allClosedWindow(), openWindow()], { strictOpen: true });
    expect(strict.rollup.verdict).toBe("blocked");
    expect(strict.rollup.strictOpenEscalated).toBe(true);
    expect(strict.rollup.strictOpenEscalatedFrom).toBe("degrading");
    expect(strict.rollup.reasons).toContain("strict-open-escalation");
  });

  it("--strict-open does NOT escalate a real blocker, an invalid input, or a clean history", () => {
    expect(fold([allClosedWindow(), blockedWindow()], { strictOpen: true }).rollup.strictOpenEscalated).toBe(false);
    expect(fold([allClosedWindow(), tamperedWindow()], { strictOpen: true }).rollup.verdict).toBe("invalid");
    expect(fold([allClosedWindow(), allClosedWindow()], { strictOpen: true }).rollup.verdict).toBe("stable");
  }, 15_000);

  it("--require-latest-all-closed surfaces a reason when the latest is not indexed", () => {
    const { rollup } = fold([allClosedWindow(), openWindow()], { requireLatestAllClosed: true });
    expect(rollup.reasons).toContain("require-latest-miss");
    expect(rollup.requireLatestAllClosed).toBe(true);
    // A non-indexed latest can never be stable / improving.
    expect(["watch", "degrading", "insufficient", "blocked", "invalid"]).toContain(rollup.verdict);
  });

  it("the thresholds tolerate a bounded number of non-indexed OLDER windows under a clean latest", () => {
    // Default (zero) thresholds: any older open / blocked / incomplete escalates.
    expect(fold([allClosedWindow(), openWindow(), allClosedWindow()]).rollup.verdict).toBe("watch");
    // Raised thresholds tolerate them → stable.
    expect(fold([allClosedWindow(), openWindow(), allClosedWindow()], { maxOpen: 1 }).rollup.verdict).toBe("stable");
    expect(fold([allClosedWindow(), blockedWindow(), allClosedWindow()], { maxBlocked: 1 }).rollup.verdict).toBe("stable");
    expect(fold([incompleteWindow(), allClosedWindow()], { maxIncomplete: 1 }).rollup.verdict).toBe("improving");
  }, 15_000);

  it("the window cap keeps the newest N and surfaces the count dropped (never silent)", () => {
    const { summary } = fold([blockedWindow(), allClosedWindow(), allClosedWindow()], { maxIndexes: 2 });
    expect(summary.indexesSupplied).toBe(3);
    expect(summary.indexesConsidered).toBe(2);
    expect(summary.truncated).toBe(true);
    expect(summary.droppedOldest).toBe(1);
    expect(summary.indexVerdictCounts["blocked"]).toBe(0);
  });
});
