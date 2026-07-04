// @vitest-environment node
/**
 * Unit proofs for the release-report composer (Phase 52): the full result shape, the archive checklist, the
 * ordered next-action checklist, and the metadata / receipt. Determinism: the same ingested state + stamp +
 * strict flag produce a byte-identical result.
 */

import { describe, expect, it } from "vitest";
import { buildArchive, buildNextActions, buildReportResult } from "./build";
import { reduceAuditSource, reduceBundleSource } from "./reduce";
import {
  RELEASE_REPORT_ACTION_IDS,
  RELEASE_REPORT_POLICY_ID,
  RELEASE_REPORT_SCHEMA,
  RELEASE_AUDIT_SCHEMA,
  RELEASE_CI_BUNDLE_SCHEMA,
} from "./types";
import {
  failBundle,
  ingestSourcesFrom,
  makeReport,
  NOW,
  notADocument,
  passAudit,
  passBundle,
  warnAudit,
} from "./fixtures";

describe("release-report build — result shape", () => {
  it("emits a stable, pinned, content-free result", () => {
    const r = makeReport({ bundle: passBundle(), audit: passAudit() });
    expect(r.schema).toBe(RELEASE_REPORT_SCHEMA);
    expect(r.generatedAt).toBe(NOW);
    expect(r.metadata).toMatchObject({
      policyId: RELEASE_REPORT_POLICY_ID,
      bundleSchema: RELEASE_CI_BUNDLE_SCHEMA,
      auditSchema: RELEASE_AUDIT_SCHEMA,
    });
    expect(r.sources.map((s) => s.id)).toEqual(["bundle", "audit"]); // canonical order
    expect(r.recommendation.recommendation).toBe("promote-ready");
  });

  it("is deterministic (byte-identical for the same inputs + stamp)", () => {
    const a = buildReportResult(NOW, ingestSourcesFrom({ bundle: passBundle(), audit: warnAudit() }), false);
    const b = buildReportResult(NOW, ingestSourcesFrom({ bundle: passBundle(), audit: warnAudit() }), false);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("records the strict flag through to the recommendation + receipt", () => {
    const r = makeReport({ bundle: passBundle(), audit: warnAudit() }, true);
    expect(r.recommendation.strict).toBe(true);
    expect(r.receipt.strict).toBe(true);
    expect(r.recommendation.strictEscalated).toBe(true);
  });
});

describe("release-report build — archive checklist", () => {
  it("keeps a recognized bundle + audit + always the report", () => {
    const arc = buildArchive(
      reduceBundleSource(ingestSourcesFrom({ bundle: passBundle() }).bundle),
      reduceAuditSource(ingestSourcesFrom({ audit: passAudit() }).audit),
    );
    expect(arc.items).toEqual(["release-ci-bundle", "release-audit", "operator-report"]);
  });

  it("drops an unreadable document from the checklist but always keeps the report", () => {
    const arc = buildArchive(
      reduceBundleSource(ingestSourcesFrom({ bundle: notADocument() }).bundle),
      reduceAuditSource(ingestSourcesFrom({}).audit),
    );
    expect(arc.items).toEqual(["operator-report"]);
    expect(arc.note).toMatch(/nothing to archive but this report/i);
  });
});

describe("release-report build — next-action checklist", () => {
  it("a clean promote-ready recommends promote-out-of-band then archive", () => {
    expect(buildNextActions([]).map((a) => a.id)).toEqual(["promote-out-of-band", "archive-report"]);
  });

  it("actions are ordered canonically, deduped, and always end with archive-report", () => {
    const actions = buildNextActions(["bundle-advisory", "audit-drift"]).map((a) => a.id);
    expect(actions).toEqual(["review-advisory", "record-accepted-drift", "archive-report"]); // deduped review-advisory
    const canonicalIndex = (id: string) => RELEASE_REPORT_ACTION_IDS.indexOf(id as never);
    expect(actions).toEqual([...actions].sort((a, b) => canonicalIndex(a) - canonicalIndex(b)));
  });

  it("a blocking failure recommends investigating the blocker", () => {
    const r = makeReport({ bundle: failBundle() });
    expect(r.nextActions.map((a) => a.id)).toEqual(["investigate-blocker", "archive-report"]);
  });

  it("every action carries an authored detail", () => {
    const r = makeReport({ bundle: passBundle() });
    for (const a of r.nextActions) expect(a.detail.length).toBeGreaterThan(0);
  });
});

describe("release-report build — receipt", () => {
  it("flattens the coverage + recommendation into a content-free receipt", () => {
    const r = makeReport({ bundle: passBundle(), audit: passAudit() });
    expect(r.receipt).toMatchObject({
      category: "worker-release-report",
      recommendation: "promote-ready",
      exitCode: 0,
      sourcesUsable: 2,
      hasBundle: true,
      hasAudit: true,
    });
  });
});
