/**
 * Unit proofs for the release-trend reducer (Phase 53): it reduces each report to a bounded point, applies the
 * `--max-reports` window cap (never silently), and summarizes the window's recommendation distribution + arc
 * direction over the USABLE reports only.
 */

import { describe, expect, it } from "vitest";
import { applyWindow, pointState, recommendationRank, reduceReport, reduceTrend } from "./reduce";
import { ingestReportsFrom, notAReport, reportFor, tamperedReport } from "./fixtures";
import type { IngestedReport } from "./ingest";

describe("pointState", () => {
  it("maps recognized/usable flags to the bounded coverage state", () => {
    expect(pointState(false, false)).toBe("unreadable");
    expect(pointState(true, false)).toBe("tampered");
    expect(pointState(true, true)).toBe("usable");
  });
});

describe("recommendationRank", () => {
  it("orders promote-ready < hold-warning < needs-evidence < hold-fail", () => {
    expect(recommendationRank("promote-ready")).toBeLessThan(recommendationRank("hold-warning"));
    expect(recommendationRank("hold-warning")).toBeLessThan(recommendationRank("needs-evidence"));
    expect(recommendationRank("needs-evidence")).toBeLessThan(recommendationRank("hold-fail"));
  });
});

describe("reduceReport", () => {
  it("a usable report carries its trusted recommendation + severity", () => {
    const [ingested] = ingestReportsFrom([reportFor("hold-warning")]);
    const point = reduceReport(0, ingested as IngestedReport);
    expect(point).toMatchObject({ position: 0, state: "usable", recommendation: "hold-warning", severity: "advisory" });
  });

  it("a tampered report surfaces its claim but no trusted severity", () => {
    const [ingested] = ingestReportsFrom([tamperedReport()]);
    const point = reduceReport(3, ingested as IngestedReport);
    expect(point).toMatchObject({ position: 3, state: "tampered", severity: null });
    expect(point.recommendation).toBe("hold-fail"); // the surfaced claim
  });

  it("an unreadable report has no recommendation or severity", () => {
    const [ingested] = ingestReportsFrom([notAReport()]);
    const point = reduceReport(0, ingested as IngestedReport);
    expect(point).toMatchObject({ state: "unreadable", recommendation: null, severity: null });
  });
});

describe("applyWindow", () => {
  const mk = (n: number): IngestedReport[] =>
    ingestReportsFrom(Array.from({ length: n }, () => reportFor("promote-ready")));

  it("keeps all reports when under the cap", () => {
    const w = applyWindow(mk(3), 5);
    expect(w).toMatchObject({ reportsSupplied: 3, truncated: false, droppedOldest: 0 });
    expect(w.considered).toHaveLength(3);
  });

  it("keeps the NEWEST N and surfaces how many were dropped", () => {
    const list = mk(5);
    const w = applyWindow(list, 2);
    expect(w).toMatchObject({ reportsSupplied: 5, truncated: true, droppedOldest: 3 });
    expect(w.considered).toHaveLength(2);
    expect(w.considered[0]).toBe(list[3]); // newest 2 = indices 3,4
    expect(w.considered[1]).toBe(list[4]);
  });

  it("a zero / invalid cap considers nothing (an empty window)", () => {
    expect(applyWindow(mk(3), 0).considered).toHaveLength(0);
    expect(applyWindow(mk(3), -1).considered).toHaveLength(0);
    expect(applyWindow(mk(3), 0).droppedOldest).toBe(3);
  });
});

describe("reduceTrend — history summary", () => {
  it("counts usable reports by recommendation and picks newest / oldest", () => {
    const objs = [reportFor("hold-fail"), reportFor("hold-warning"), reportFor("promote-ready")];
    const { history } = reduceTrend(ingestReportsFrom(objs), 20);
    expect(history.reportsUsable).toBe(3);
    expect(history.counts).toEqual({ "promote-ready": 1, "hold-warning": 1, "needs-evidence": 0, "hold-fail": 1 });
    expect(history.oldest).toBe("hold-fail");
    expect(history.newest).toBe("promote-ready");
    expect(history.direction).toBe("improving"); // hold-fail (rank 3) → promote-ready (rank 0)
  });

  it("tallies unreadable + tampered separately and excludes them from the usable distribution", () => {
    const objs = [notAReport(), tamperedReport(), reportFor("promote-ready")];
    const { history } = reduceTrend(ingestReportsFrom(objs), 20);
    expect(history).toMatchObject({ reportsUsable: 1, reportsUnreadable: 1, reportsTampered: 1 });
    expect(history.newest).toBe("promote-ready");
    expect(history.direction).toBe("n/a"); // only one usable → no arc
  });

  it("direction is degrading when posture worsens and flat when unchanged", () => {
    const worsen = reduceTrend(ingestReportsFrom([reportFor("promote-ready"), reportFor("hold-fail")]), 20);
    expect(worsen.history.direction).toBe("degrading");
    const flat = reduceTrend(ingestReportsFrom([reportFor("hold-warning"), reportFor("hold-warning")]), 20);
    expect(flat.history.direction).toBe("flat");
  });

  it("surfaces the window truncation in the history summary", () => {
    const objs = Array.from({ length: 4 }, () => reportFor("promote-ready"));
    const { history, points } = reduceTrend(ingestReportsFrom(objs), 2);
    expect(history).toMatchObject({ reportsSupplied: 4, reportsConsidered: 2, truncated: true, droppedOldest: 2 });
    expect(points).toHaveLength(2);
    expect(points.map((p) => p.position)).toEqual([0, 1]); // positions re-based within the window
  });
});
