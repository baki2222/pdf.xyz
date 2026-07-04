import { describe, expect, it } from "vitest";
import { buildArchive, buildFollowUps, buildGovernanceMetadata } from "./build";
import { reduceReportSource, reduceTrendSource, reduceAuditSource } from "./reduce";
import { ingestAuditSource, ingestReportSource, ingestTrend } from "./ingest";
import {
  failingTrend,
  makeGovernance,
  notADocument,
  passAudit,
  promoteReadyReport,
  stableTrend,
  NOW,
} from "./fixtures";
import {
  RELEASE_AUDIT_SCHEMA,
  RELEASE_GOVERNANCE_POLICY_ID,
  RELEASE_GOVERNANCE_SCHEMA,
  RELEASE_REPORT_SCHEMA,
  RELEASE_TREND_SCHEMA,
} from "./types";

describe("buildGovernanceResult — shape + determinism", () => {
  it("carries the schema, metadata (pinned upstream schemas), stamp, and three sources", () => {
    const r = makeGovernance({ trend: stableTrend(), report: promoteReadyReport(), audit: passAudit() });
    expect(r.schema).toBe(RELEASE_GOVERNANCE_SCHEMA);
    expect(r.generatedAt).toBe(NOW);
    expect(r.metadata).toEqual({
      schemaVersion: 1,
      policyId: RELEASE_GOVERNANCE_POLICY_ID,
      policyVersion: 1,
      trendSchema: RELEASE_TREND_SCHEMA,
      reportSchema: RELEASE_REPORT_SCHEMA,
      auditSchema: RELEASE_AUDIT_SCHEMA,
    });
    expect(r.sources.map((s) => s.id)).toEqual(["trend", "report", "audit"]);
  });

  it("is byte-identical for the same inputs (deterministic)", () => {
    const a = makeGovernance({ trend: stableTrend(), report: promoteReadyReport() });
    const b = makeGovernance({ trend: stableTrend(), report: promoteReadyReport() });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("the receipt mirrors the rollup + coverage", () => {
    const r = makeGovernance({ trend: failingTrend() });
    expect(r.receipt).toMatchObject({
      category: "worker-release-governance",
      verdict: "blocked",
      exitCode: 4,
      sourcesSupplied: 1,
      sourcesUsable: 1,
      hasTrend: true,
    });
  });
});

describe("buildGovernanceMetadata", () => {
  it("pins the three upstream schemas", () => {
    expect(buildGovernanceMetadata().trendSchema).toBe(RELEASE_TREND_SCHEMA);
    expect(buildGovernanceMetadata().reportSchema).toBe(RELEASE_REPORT_SCHEMA);
    expect(buildGovernanceMetadata().auditSchema).toBe(RELEASE_AUDIT_SCHEMA);
  });
});

describe("buildArchive", () => {
  const trend = (o: unknown | undefined) =>
    reduceTrendSource({ supplied: o !== undefined, ingested: ingestTrend(o) });
  const report = (o: unknown | undefined) =>
    reduceReportSource({ supplied: o !== undefined, ingested: ingestReportSource(o) });
  const audit = (o: unknown | undefined) =>
    reduceAuditSource({ supplied: o !== undefined, ingested: ingestAuditSource(o) });

  it("keeps each recognized document + always the governance bundle, in canonical order", () => {
    const a = buildArchive(trend(stableTrend()), report(promoteReadyReport()), audit(passAudit()));
    expect(a.items).toEqual(["release-trend", "latest-report", "latest-audit", "governance-bundle"]);
  });

  it("keeps a tampered (recognized) document but not an absent one", () => {
    const a = buildArchive(trend(stableTrend()), report(undefined), audit(undefined));
    expect(a.items).toEqual(["release-trend", "governance-bundle"]);
  });

  it("with no recognized document, only the bundle is archived (with the honest note)", () => {
    const a = buildArchive(trend(notADocument()), report(undefined), audit(undefined));
    expect(a.items).toEqual(["governance-bundle"]);
    expect(a.note).toMatch(/nothing to archive but this bundle/i);
  });
});

describe("buildFollowUps", () => {
  it("a clean healthy fold recommends continue-cadence then archive", () => {
    expect(buildFollowUps([]).map((f) => f.id)).toEqual([
      "continue-governance-cadence",
      "archive-governance-bundle",
    ]);
  });

  it("maps reasons to deduped, canonically-ordered assignments (+ trailing archive)", () => {
    const ids = buildFollowUps(["trend-failing", "report-hold-fail"]).map((f) => f.id);
    expect(ids).toEqual(["investigate-blocked-governance", "archive-governance-bundle"]);
  });

  it("a tamper assigns recover-tampered-evidence", () => {
    expect(buildFollowUps(["trend-tampered"]).map((f) => f.id)).toContain("recover-tampered-evidence");
  });
});
