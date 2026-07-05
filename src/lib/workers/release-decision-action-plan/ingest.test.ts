import { describe, expect, it } from "vitest";
import {
  blockedTrend,
  improvingTrend,
  insufficientTrend,
  invalidTrend,
  notATrend,
  stableTrend,
  tamperTrendSummary,
  tamperTrendVerdict,
  watchTrend,
} from "./fixtures";
import { ingestTrend } from "./ingest";

describe("release-decision-action-plan ingest — trust boundary", () => {
  it("marks a self-consistent trend usable and re-derives its trusted facts", () => {
    const ingested = ingestTrend(stableTrend());
    expect(ingested.recognized).toBe(true);
    expect(ingested.usable).toBe(true);
    expect(ingested.verdict).toBe("stable");
    expect(ingested.facts).not.toBeNull();
    expect(ingested.facts?.verdict).toBe("stable");
    expect(ingested.facts?.trendClass).toBe("all-clear");
    expect(ingested.facts?.direction).toBe("flat");
    expect(ingested.facts?.windowsUsable).toBe(3);
  });

  it("surfaces each usable trend's own verdict + class + arc", () => {
    expect(ingestTrend(improvingTrend()).facts?.verdict).toBe("improving");
    expect(ingestTrend(watchTrend()).facts?.verdict).toBe("watch");
    expect(ingestTrend(insufficientTrend()).facts?.verdict).toBe("insufficient");
    expect(ingestTrend(blockedTrend()).facts?.verdict).toBe("blocked");
    // A trend whose OWN verdict is `invalid` (a tampered window in its history) is still a usable, self-consistent
    // trend — the plan will treat it as block-release, not reject-input.
    const inv = ingestTrend(invalidTrend());
    expect(inv.usable).toBe(true);
    expect(inv.facts?.verdict).toBe("invalid");
  });

  it("rejects a non-trend document as unreadable (recognized = false)", () => {
    const ingested = ingestTrend(notATrend());
    expect(ingested.recognized).toBe(false);
    expect(ingested.usable).toBe(false);
    expect(ingested.verdict).toBeNull();
    expect(ingested.facts).toBeNull();
  });

  it("rejects non-objects as unreadable", () => {
    for (const bad of [null, 42, "trend", [stableTrend()], true]) {
      expect(ingestTrend(bad).recognized).toBe(false);
    }
  });

  it("catches a hand-flipped trend verdict as a tamper (CHECK-B)", () => {
    const tampered = tamperTrendVerdict(stableTrend(), "blocked");
    const ingested = ingestTrend(tampered);
    expect(ingested.recognized).toBe(true);
    expect(ingested.usable).toBe(false);
    // The untrusted CLAIM is surfaced so the plan can show what was asserted, but facts stay null.
    expect(ingested.verdict).toBe("blocked");
    expect(ingested.facts).toBeNull();
  });

  it("catches a lied window-verdict count that does not match the sequence (CHECK-A)", () => {
    // Inflating windowVerdictCounts.stable does NOT flip the re-derived verdict, so CHECK-B still passes — only CHECK-A
    // (re-deriving the distribution from the posture sequence) catches it.
    const tampered = tamperTrendSummary(stableTrend());
    const ingested = ingestTrend(tampered);
    expect(ingested.recognized).toBe(true);
    expect(ingested.usable).toBe(false);
    expect(ingested.facts).toBeNull();
  });

  it("catches a smuggled policy.strict inconsistent with the recorded rollup", () => {
    const clone = JSON.parse(JSON.stringify(stableTrend())) as Record<string, unknown> & {
      policy: { strict: boolean };
    };
    clone.policy.strict = true; // the rollup recorded strict=false
    expect(ingestTrend(clone).usable).toBe(false);
  });

  it("rejects a missing / malformed rollup, summary, or points block", () => {
    const dropTrend = JSON.parse(JSON.stringify(stableTrend())) as Record<string, unknown>;
    delete dropTrend.trend;
    expect(ingestTrend(dropTrend).usable).toBe(false);

    const dropSummary = JSON.parse(JSON.stringify(stableTrend())) as Record<string, unknown>;
    delete dropSummary.summary;
    expect(ingestTrend(dropSummary).usable).toBe(false);

    const dropPoints = JSON.parse(JSON.stringify(stableTrend())) as Record<string, unknown>;
    delete dropPoints.points;
    expect(ingestTrend(dropPoints).usable).toBe(false);
  });

  it("rejects a point whose severity does not re-derive from its verdict", () => {
    const clone = JSON.parse(JSON.stringify(stableTrend())) as Record<string, unknown> & {
      points: { state: string; severity: string }[];
    };
    // A usable stable point's severity is `ready`; corrupt it to `blocking`.
    clone.points[0]!.severity = "blocking";
    expect(ingestTrend(clone).usable).toBe(false);
  });
});
