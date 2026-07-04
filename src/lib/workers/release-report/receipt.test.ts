// @vitest-environment node
/**
 * Unit proofs for the release-report receipt (Phase 52): a flattened, content-free record of what the report
 * recommended, over how many usable sources, with how many blocking / insufficiency / advisory reasons.
 */

import { describe, expect, it } from "vitest";
import { buildReportReceipt } from "./receipt";
import { computeReportRecommendation } from "./rollup";
import { computeCoverage, reduceAuditSource, reduceBundleSource } from "./reduce";
import { RELEASE_REPORT_POLICY_ID, RELEASE_REPORT_POLICY_VERSION } from "./types";
import { failAudit, ingestSourcesFrom, NOW, passAudit, passBundle, warnBundle } from "./fixtures";

function receiptFor(objs: Parameters<typeof ingestSourcesFrom>[0], strict = false) {
  const i = ingestSourcesFrom(objs);
  const bundle = reduceBundleSource(i.bundle);
  const audit = reduceAuditSource(i.audit);
  const { rollup } = computeReportRecommendation({ bundle, audit }, strict);
  return buildReportReceipt(NOW, computeCoverage(bundle, audit), rollup);
}

describe("release-report receipt", () => {
  it("is a bounded, content-free record with a stable identity", () => {
    const r = receiptFor({ bundle: passBundle(), audit: passAudit() });
    expect(r).toEqual({
      category: "worker-release-report",
      policyId: RELEASE_REPORT_POLICY_ID,
      policyVersion: RELEASE_REPORT_POLICY_VERSION,
      at: NOW,
      recommendation: "promote-ready",
      exitCode: 0,
      sourcesUsable: 2,
      hasBundle: true,
      hasAudit: true,
      blocking: 0,
      insufficiencies: 0,
      advisories: 0,
      strict: false,
    });
  });

  it("counts blocking reasons on a fail", () => {
    const r = receiptFor({ bundle: passBundle(), audit: failAudit() });
    expect(r).toMatchObject({ recommendation: "hold-fail", exitCode: 4, blocking: 1 });
  });

  it("records the strict flag", () => {
    expect(receiptFor({ bundle: warnBundle() }, true).strict).toBe(true);
  });

  it("serializes to only primitive fields", () => {
    const r = receiptFor({ bundle: passBundle() });
    for (const v of Object.values(r)) expect(["string", "number", "boolean"]).toContain(typeof v);
  });
});
