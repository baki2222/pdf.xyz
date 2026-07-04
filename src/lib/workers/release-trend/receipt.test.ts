/**
 * Unit proofs for the release-trend receipt (Phase 53): a flattened, content-free record — bounded enums, small
 * integers, a stable policy id, and the run's own stamp only — that mirrors the composite verdict + coverage.
 */

import { describe, expect, it } from "vitest";
import { buildTrendReceipt } from "./receipt";
import { makeTrend, NOW, reportFor } from "./fixtures";
import { RELEASE_TREND_POLICY_VERSION } from "./types";

const pr = () => reportFor("promote-ready");
const hf = () => reportFor("hold-fail");

describe("buildTrendReceipt", () => {
  it("mirrors the composite verdict + coverage into a flat, bounded record", () => {
    const result = makeTrend([pr(), hf()]);
    const r = buildTrendReceipt(NOW, result.policy, result.history, result.trend);
    expect(r).toEqual({
      category: "worker-release-trend",
      policyId: "pdfxyz-worker-release-trend",
      policyVersion: RELEASE_TREND_POLICY_VERSION,
      at: NOW,
      verdict: result.trend.verdict,
      exitCode: result.trend.exitCode,
      reportsSupplied: result.history.reportsSupplied,
      reportsConsidered: result.history.reportsConsidered,
      reportsUsable: result.history.reportsUsable,
      newest: result.history.newest,
      oldest: result.history.oldest,
      blocking: result.trend.blocking,
      insufficiencies: result.trend.insufficiencies,
      advisories: result.trend.advisories,
      requireLatestReady: result.trend.requireLatestReady,
    });
  });

  it("carries only JSON scalars (no nested objects / arrays — safe to forward verbatim)", () => {
    const { receipt } = makeTrend([pr(), pr()]);
    for (const value of Object.values(receipt)) {
      expect(["string", "number", "boolean", "object"]).toContain(typeof value);
      if (typeof value === "object") expect(value).toBeNull(); // only newest/oldest may be null
    }
  });
});
