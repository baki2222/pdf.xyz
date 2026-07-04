import { describe, expect, it } from "vitest";
import { computeTrendRollup } from "./rollup";
import { reduceTrend } from "./reduce";
import {
  blockedWindow,
  ingestWindowsFrom,
  insufficientWindow,
  invalidWindow,
  notADecisionIndex,
  stableWindow,
  tamperedWindow,
  watchWindow,
} from "./fixtures";
import { DEFAULT_MAX_WINDOWS, type ReleaseDecisionTrendPolicy } from "./types";

/** Fold a list of window objects into a trend rollup under an optional policy. */
function rollup(objs: unknown[], policy: Partial<ReleaseDecisionTrendPolicy> = {}) {
  const { summary } = reduceTrend(ingestWindowsFrom(objs), policy.maxWindows ?? DEFAULT_MAX_WINDOWS);
  return computeTrendRollup(summary, { maxWindows: DEFAULT_MAX_WINDOWS, strict: false, ...policy }).rollup;
}

describe("computeTrendRollup — clean history", () => {
  it("stable when every usable window is a clean stable index", () => {
    const r = rollup([stableWindow(), stableWindow()]);
    expect(r.verdict).toBe("stable");
    expect(r.exitCode).toBe(0);
    expect(r.clear).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it("improving when the latest window is stable over an earlier worse window", () => {
    const r = rollup([watchWindow(), stableWindow()]);
    expect(r.verdict).toBe("improving");
    expect(r.exitCode).toBe(0);
    expect(r.clear).toBe(true);
    expect(r.direction).toBe("improving");
  });
});

describe("computeTrendRollup — advisory / worsening history", () => {
  it("watch when a watch window is present and the arc is flat", () => {
    const r = rollup([watchWindow(), watchWindow()]);
    expect(r.verdict).toBe("watch");
    expect(r.exitCode).toBe(3);
    expect(r.reasons).toContain("window-watch");
  });

  it("degrading when the latest window is worse than the earliest", () => {
    const r = rollup([stableWindow(), watchWindow()]);
    expect(r.verdict).toBe("degrading");
    expect(r.exitCode).toBe(3);
    expect(r.reasons).toContain("trend-degrading");
  });

  it("a dip that recovers to stable is a flat watch, not improving", () => {
    expect(rollup([stableWindow(), watchWindow(), stableWindow()]).verdict).toBe("watch");
  });
});

describe("computeTrendRollup — insufficient history", () => {
  it("insufficient for zero usable windows", () => {
    const r = rollup([]);
    expect(r.verdict).toBe("insufficient");
    expect(r.exitCode).toBe(2);
    expect(r.reasons).toContain("no-usable-windows");
  });

  it("insufficient when every usable window is insufficient", () => {
    const r = rollup([insufficientWindow(), insufficientWindow()]);
    expect(r.verdict).toBe("insufficient");
    expect(r.reasons).toContain("only-insufficient");
  });
});

describe("computeTrendRollup — blocking / invalid history (fail closed)", () => {
  it("blocked when a window is a blocked index", () => {
    const r = rollup([stableWindow(), blockedWindow()]);
    expect(r.verdict).toBe("blocked");
    expect(r.exitCode).toBe(4);
    expect(r.reasons).toContain("window-blocked");
  });

  it("blocked when a window is an invalid index (an untrustworthy record in its batch)", () => {
    const r = rollup([stableWindow(), invalidWindow()]);
    expect(r.verdict).toBe("blocked");
    expect(r.reasons).toContain("window-invalid");
  });

  it("invalid (dominates) when a window is unreadable or tampered — never a vacuous pass", () => {
    expect(rollup([stableWindow(), notADecisionIndex()]).verdict).toBe("invalid");
    expect(rollup([stableWindow(), tamperedWindow()]).verdict).toBe("invalid");
    // Invalid input dominates even a blocked window.
    expect(rollup([blockedWindow(), tamperedWindow()]).verdict).toBe("invalid");
  });
});

describe("computeTrendRollup — --strict", () => {
  it("escalates any non-stable window to blocked, recording the base verdict", () => {
    const r = rollup([stableWindow(), watchWindow()], { strict: true });
    expect(r.verdict).toBe("blocked");
    expect(r.strictEscalated).toBe(true);
    expect(r.strictEscalatedFrom).toBe("degrading"); // [stable, watch] is degrading without strict
    expect(r.reasons).toContain("strict-nonclean");
  });

  it("leaves an all-stable history untouched", () => {
    const r = rollup([stableWindow(), stableWindow()], { strict: true });
    expect(r.verdict).toBe("stable");
    expect(r.strictEscalated).toBe(false);
  });

  it("does not mark a genuinely blocked window as a strict escalation", () => {
    const r = rollup([stableWindow(), blockedWindow()], { strict: true });
    expect(r.verdict).toBe("blocked");
    expect(r.strictEscalated).toBe(false); // the block came from a real blocked window, not the flag
  });
});
