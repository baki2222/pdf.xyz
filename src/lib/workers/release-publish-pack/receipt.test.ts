import { describe, expect, it } from "vitest";
import { buildPublishPackReceipt } from "./receipt";
import { computeCoverage, reduceGovernanceSource } from "./reduce";
import { computePublishRollup } from "./rollup";
import { ingestGovernanceSource } from "./ingest";
import { healthyGovernance, blockedGovernance, NOW } from "./fixtures";
import {
  RELEASE_PUBLISH_PACK_POLICY_ID,
  RELEASE_PUBLISH_PACK_POLICY_VERSION,
  type ReleasePublishPackSource,
} from "./types";

const POLICY = { requireArchive: false, requireRestoreDrill: false, strict: false };

/** Build a receipt over a single governance source of a given document. */
function receiptOf(doc: unknown) {
  const governance = reduceGovernanceSource({ supplied: true, ingested: ingestGovernanceSource(doc) });
  const absent = (id: ReleasePublishPackSource["id"]): ReleasePublishPackSource => ({
    id,
    state: "absent",
    supplied: false,
    recognized: false,
    usable: false,
    verdict: null,
    severity: null,
    detail: "",
  });
  const archive = absent("archive");
  const restoreDrill = absent("restore-drill");
  const report = absent("report");
  const trend = absent("trend");
  const coverage = computeCoverage(governance, archive, restoreDrill, report, trend);
  const { rollup } = computePublishRollup({ governance, archive, restoreDrill, report, trend }, POLICY);
  return buildPublishPackReceipt(NOW, coverage, rollup);
}

describe("buildPublishPackReceipt — verdict + disclosure + source count only", () => {
  it("flattens the verdict, disclosure, exit, and source counts (no per-source detail)", () => {
    const receipt = receiptOf(healthyGovernance());
    expect(receipt).toEqual({
      category: "worker-release-publish-pack",
      policyId: RELEASE_PUBLISH_PACK_POLICY_ID,
      policyVersion: RELEASE_PUBLISH_PACK_POLICY_VERSION,
      at: NOW,
      verdict: "publishable",
      exitCode: 0,
      disclosure: "share-safe",
      sourcesSupplied: 1,
      sourcesUsable: 1,
    });
  });

  it("records a blocked verdict + blocked disclosure for a blocked governance", () => {
    const receipt = receiptOf(blockedGovernance());
    expect(receipt.verdict).toBe("blocked");
    expect(receipt.disclosure).toBe("blocked");
    expect(receipt.exitCode).toBe(4);
  });

  it("carries only bounded keys (no locator / prose fields)", () => {
    const keys = Object.keys(receiptOf(healthyGovernance())).sort();
    expect(keys).toEqual(
      [
        "at",
        "category",
        "disclosure",
        "exitCode",
        "policyId",
        "policyVersion",
        "sourcesSupplied",
        "sourcesUsable",
        "verdict",
      ].sort(),
    );
  });
});
