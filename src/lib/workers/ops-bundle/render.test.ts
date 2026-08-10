import { describe, expect, it } from "vitest";
import { renderOpsBundle } from "./render";
import { buildOpsBundle, buildUsageError } from "./build";
import { NOT_CONFIGURED_PIPELINE } from "./ingest";
import type { IngestedOperations } from "./ingest";

const INGESTED: IngestedOperations = {
  operations: {
    source: "ops-check",
    severity: "warn",
    health: "warn",
    vantage: "worker",
    drainable: true,
    daemonObserved: false,
    action: "verify-lifecycle",
    actionDetail: "Declare and verify a retention lifecycle policy.",
    liveness: {
      state: "stale",
      source: "queue-broker",
      lastSeen: "over-10m",
      severity: "warn",
      reason: "liveness-stale",
      action: "investigate-worker-liveness",
    },
    subsystems: [{ id: "lifecycle-verification", health: "warn" }],
    proofs: { compressionDeep: "available", ocr: "unavailable" },
    alerts: [
      {
        source: "lifecycle-verification",
        severity: "warn",
        reason: "lifecycle-unverified",
        action: "verify-lifecycle",
      },
    ],
    summary: "Operations are degraded.",
  },
  slo: {
    source: "ops-check",
    worst: "warn",
    evaluated: 4,
    total: 6,
    issues: [{ id: "queue_age", status: "warn" }],
    detail: "4 of 6 SLO indicators judged.",
  },
  cleanupEvidence: {
    source: "ops-check",
    state: "stale",
    reason: "report_stale",
    provider: "unknown",
    freshness: "stale",
    detail: "The report is stale.",
  },
  lifecycle: {
    source: "ops-check",
    verification: "warn",
    readiness: "warn",
    verdict: "unknown",
    drift: false,
    detail: "Lifecycle undeclared.",
  },
};

describe("renderOpsBundle — json", () => {
  it("is stable, pretty, newline-terminated, and round-trips", () => {
    const bundle = buildOpsBundle(
      "2026-07-03T00:00:00.000Z",
      INGESTED,
      NOT_CONFIGURED_PIPELINE,
    );
    const json = renderOpsBundle(bundle, "json");
    expect(json.endsWith("\n")).toBe(true);
    expect(JSON.parse(json)).toEqual(bundle);
  });
});

describe("renderOpsBundle — text", () => {
  const bundle = buildOpsBundle(
    "2026-07-03T00:00:00.000Z",
    INGESTED,
    NOT_CONFIGURED_PIPELINE,
  );
  const text = renderOpsBundle(bundle, "text");

  it("leads with the composite rollup and includes every section header", () => {
    expect(text).toMatch(/ROLLUP: WARN \(exit 3\)/);
    for (const h of [
      "OPERATIONS",
      "SLO",
      "CLEANUP EVIDENCE",
      "LIFECYCLE",
      "CLEANUP PIPELINE",
      "CAVEATS",
    ]) {
      expect(text).toContain(h);
    }
  });

  it("renders bounded posture tokens and the not-configured pipeline honestly", () => {
    expect(text).toContain(
      "liveness: stale (source queue-broker, last seen over-10m)",
    );
    expect(text).toContain("CLEANUP PIPELINE  [not-configured]");
  });

  it("prints all honesty caveats", () => {
    expect(text).toMatch(/not itself a new proof/);
    expect(text).toMatch(/not proof of byte deletion/);
    expect(text).toMatch(/made no network call/);
  });
});

describe("renderOpsBundle — usage error", () => {
  it("renders the bounded issue list in both formats", () => {
    const e = buildUsageError("2026-07-03T00:00:00.000Z", [
      "ops-check-input-malformed",
    ]);
    expect(JSON.parse(renderOpsBundle(e, "json"))).toEqual(e);
    const text = renderOpsBundle(e, "text");
    expect(text).toMatch(/USAGE ERROR \(exit 1\)/);
    expect(text).toContain("ops-check-input-malformed");
  });
});
