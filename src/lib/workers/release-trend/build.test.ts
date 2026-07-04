/**
 * Unit proofs for the release-trend composer (Phase 53): it folds ingested reports into a stable, fully bounded
 * result — the metadata / policy / history / point sequence / verdict / reasons / follow-ups / caveats — and is
 * deterministic (same input + stamp + policy ⇒ byte-identical result).
 */

import { describe, expect, it } from "vitest";
import { buildFollowUps, buildTrendResult } from "./build";
import { ingestReportsFrom, makeTrend, NOW, notAReport, reportFor, tamperedReport } from "./fixtures";
import { defaultPolicy } from "./fixtures";
import {
  RELEASE_TREND_CAVEATS,
  RELEASE_TREND_GUIDANCE,
  RELEASE_TREND_POLICY_ID,
  RELEASE_TREND_SCHEMA,
} from "./types";

const pr = () => reportFor("promote-ready");
const hw = () => reportFor("hold-warning");
const hf = () => reportFor("hold-fail");

describe("buildTrendResult — shape + identity", () => {
  it("stamps the schema, metadata, policy, and authored caveats/guidance", () => {
    const result = makeTrend([pr(), pr()]);
    expect(result.schema).toBe(RELEASE_TREND_SCHEMA);
    expect(result.generatedAt).toBe(NOW);
    expect(result.metadata).toMatchObject({
      policyId: RELEASE_TREND_POLICY_ID,
      reportSchema: "pdfxyz.release-report/1",
    });
    expect(result.policy).toMatchObject({ maxReports: 20, maxHoldFail: 0, requireLatestReady: false });
    expect(result.caveats).toEqual(RELEASE_TREND_CAVEATS);
    expect(result.guidance).toEqual(RELEASE_TREND_GUIDANCE);
    expect(result.receipt.category).toBe("worker-release-trend");
  });

  it("emits one point per considered report, oldest → newest", () => {
    const result = makeTrend([hf(), hw(), pr()]);
    expect(result.points.map((p) => p.recommendation)).toEqual(["hold-fail", "hold-warning", "promote-ready"]);
    expect(result.points.map((p) => p.position)).toEqual([0, 1, 2]);
  });

  it("is deterministic — same input twice is byte-identical", () => {
    const a = buildTrendResult(NOW, ingestReportsFrom([pr(), hw(), hf()]), defaultPolicy());
    const b = buildTrendResult(NOW, ingestReportsFrom([pr(), hw(), hf()]), defaultPolicy());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("buildFollowUps — reason → follow-up mapping", () => {
  it("a clean stable trend recommends continue-monitoring then archive-trend", () => {
    expect(buildFollowUps([]).map((f) => f.id)).toEqual(["continue-monitoring", "archive-trend"]);
  });

  it("maps fired reasons to deduped follow-ups in canonical order, archive-trend last", () => {
    const ids = buildFollowUps(["report-tampered", "latest-hold-fail", "latest-hold-warning"]).map((f) => f.id);
    expect(ids).toEqual([
      "investigate-failing-trend",
      "recover-tampered-report",
      "review-warning-trend",
      "archive-trend",
    ]);
  });

  it("a needs-evidence tip asks to gate the latest release + supply history", () => {
    expect(buildFollowUps(["latest-needs-evidence"]).map((f) => f.id)).toEqual([
      "supply-report-history",
      "gate-latest-release",
      "archive-trend",
    ]);
  });
});

describe("buildTrendResult — the follow-up checklist matches the verdict", () => {
  it("a failing tamper trend lists recover-tampered-report", () => {
    const result = makeTrend([pr(), tamperedReport(), pr()]);
    expect(result.followUps.map((f) => f.id)).toContain("recover-tampered-report");
  });

  it("an insufficient trend lists supply-report-history", () => {
    const result = makeTrend([notAReport()]);
    expect(result.followUps.map((f) => f.id)).toContain("supply-report-history");
  });

  it("a stable trend lists continue-monitoring", () => {
    const result = makeTrend([pr(), pr()]);
    expect(result.followUps.map((f) => f.id)).toEqual(["continue-monitoring", "archive-trend"]);
  });
});
