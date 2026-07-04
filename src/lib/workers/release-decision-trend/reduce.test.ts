import { describe, expect, it } from "vitest";
import { directionOf, reduceTrend } from "./reduce";
import {
  blockedWindow,
  holdWindow,
  ingestWindowsFrom,
  insufficientWindow,
  notADecisionIndex,
  stableWindow,
  tamperedWindow,
  watchWindow,
} from "./fixtures";
import { DEFAULT_MAX_WINDOWS } from "./types";

/** Reduce a list of window objects (oldest → newest) under an optional cap. */
function reduce(objs: unknown[], maxWindows = DEFAULT_MAX_WINDOWS) {
  return reduceTrend(ingestWindowsFrom(objs), maxWindows);
}

describe("directionOf — arc over usable window verdict ranks", () => {
  it("is unknown with fewer than two usable windows", () => {
    expect(directionOf([])).toBe("unknown");
    expect(directionOf(["stable"])).toBe("unknown");
  });

  it("classifies improving / flat / degrading by rank", () => {
    expect(directionOf(["watch", "stable"])).toBe("improving");
    expect(directionOf(["stable", "watch"])).toBe("degrading");
    expect(directionOf(["watch", "watch"])).toBe("flat");
    expect(directionOf(["stable", "blocked"])).toBe("degrading");
  });
});

describe("reduceTrend — points + summary", () => {
  it("emits one point per considered window, oldest → newest, with severity + record count", () => {
    const { points } = reduce([stableWindow(), watchWindow()]);
    expect(points.map((p) => p.position)).toEqual([0, 1]);
    expect(points[0]).toMatchObject({ state: "usable", verdict: "stable", severity: "ready", recordsConsidered: 2 });
    expect(points[1]).toMatchObject({ state: "usable", verdict: "watch", severity: "advisory" });
  });

  it("tallies per-window verdict counts + aggregate decision counts over usable windows only", () => {
    const { summary } = reduce([stableWindow(), watchWindow(), blockedWindow()]);
    expect(summary.windowsUsable).toBe(3);
    expect(summary.windowVerdictCounts).toMatchObject({ stable: 1, watch: 1, blocked: 1, insufficient: 0, invalid: 0 });
    // proceed appears in every window; followup in the watch window; reject in the blocked window.
    expect(summary.decisionCounts.proceed).toBeGreaterThan(0);
    expect(summary.decisionCounts["proceed-with-followup"]).toBe(1);
    expect(summary.decisionCounts.reject).toBe(1);
    expect(summary.totalRecords).toBe(6);
  });

  it("counts unreadable / tampered windows and excludes them from the usable tallies", () => {
    const { summary } = reduce([stableWindow(), notADecisionIndex(), tamperedWindow()]);
    expect(summary.windowsUnreadable).toBe(1);
    expect(summary.windowsTampered).toBe(1);
    expect(summary.windowsUsable).toBe(1);
    expect(summary.newest).toBe("stable");
  });

  it("records newest / oldest usable verdict + direction", () => {
    const { summary } = reduce([watchWindow(), stableWindow()]);
    expect(summary.oldest).toBe("watch");
    expect(summary.newest).toBe("stable");
    expect(summary.direction).toBe("improving");
  });
});

describe("reduceTrend — window cap", () => {
  it("keeps the newest N and surfaces how many older windows were dropped (never silent)", () => {
    const { summary, points } = reduce([blockedWindow(), stableWindow(), stableWindow()], 2);
    expect(summary.windowsSupplied).toBe(3);
    expect(summary.windowsConsidered).toBe(2);
    expect(summary.truncated).toBe(true);
    expect(summary.droppedOldest).toBe(1);
    expect(points.length).toBe(2);
    // The oldest (blocked) window was dropped; only the two stable windows remain.
    expect(summary.windowVerdictCounts.blocked).toBe(0);
    expect(summary.windowVerdictCounts.stable).toBe(2);
  });
});

describe("reduceTrend — trend class (coarse descriptor)", () => {
  it("all-clear when every window is a clean stable index", () => {
    expect(reduce([stableWindow(), stableWindow()]).summary.trendClass).toBe("all-clear");
  });

  it("invalid-input dominates when any window is unreadable / tampered", () => {
    expect(reduce([stableWindow(), tamperedWindow()]).summary.trendClass).toBe("invalid-input");
  });

  it("rejection-present when a window is blocked / invalid", () => {
    expect(reduce([stableWindow(), blockedWindow()]).summary.trendClass).toBe("rejection-present");
  });

  it("insufficient-evidence when every usable window is insufficient", () => {
    expect(reduce([insufficientWindow(), insufficientWindow()]).summary.trendClass).toBe("insufficient-evidence");
  });

  it("hold-rising when hold decisions increase across the sequence", () => {
    // oldest window: 0 holds; newest window: a hold decision → hold pressure rose.
    expect(reduce([stableWindow(), holdWindow()]).summary.trendClass).toBe("hold-rising");
  });

  it("improving when the arc recovers without rising hold / followup pressure", () => {
    // holdWindow (oldest) → stableWindow (newest): direction improving, holds did NOT rise (1 → 0).
    expect(reduce([holdWindow(), stableWindow()]).summary.trendClass).toBe("improving");
  });
});
