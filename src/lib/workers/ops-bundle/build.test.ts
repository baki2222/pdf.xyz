import { describe, expect, it } from "vitest";
import {
  bundleSeverityForExit,
  buildOpsBundle,
  buildUsageError,
  computeRollup,
  OPS_BUNDLE_EXIT_FOR_SEVERITY,
  pipelineSectionExit,
} from "./build";
import { NOT_CONFIGURED_PIPELINE } from "./ingest";
import { OPS_BUNDLE_CAVEATS, OPS_BUNDLE_SCHEMA, type OpsBundlePipelineSection } from "./types";
import type { IngestedOperations } from "./ingest";
import type { AlertSeverity } from "../observability/alerts";

function ingested(severity: AlertSeverity): IngestedOperations {
  return {
    operations: {
      source: "ops-check",
      severity,
      health: "ok",
      vantage: "worker",
      drainable: true,
      daemonObserved: true,
      action: "none",
      actionDetail: "",
      liveness: { state: "observed", source: "self", lastSeen: null, severity: "ok", reason: "liveness-observed", action: "none" },
      subsystems: [],
      proofs: { compressionDeep: "unknown", ocr: "unknown" },
      alerts: [],
      summary: "",
    },
    slo: null,
    cleanupEvidence: { source: "ops-check", state: "disabled", reason: "no_report_configured", provider: "unknown", freshness: "unknown", detail: "" },
    lifecycle: { source: "ops-check", verification: "unknown", readiness: "unknown", verdict: "unknown", drift: false, detail: "" },
  };
}

function pipeline(severity: OpsBundlePipelineSection["severity"], source: OpsBundlePipelineSection["source"]): OpsBundlePipelineSection {
  return { source, severity, arms: [], detail: "" };
}

describe("bundleSeverityForExit", () => {
  it("maps every rung, clamping out-of-range up to critical", () => {
    expect(bundleSeverityForExit(0)).toBe("ok");
    expect(bundleSeverityForExit(1)).toBe("usage");
    expect(bundleSeverityForExit(2)).toBe("unknown");
    expect(bundleSeverityForExit(3)).toBe("warn");
    expect(bundleSeverityForExit(4)).toBe("critical");
    expect(bundleSeverityForExit(99)).toBe("critical");
  });
  it("round-trips with the severity→exit map", () => {
    for (const [sev, code] of Object.entries(OPS_BUNDLE_EXIT_FOR_SEVERITY)) {
      expect(bundleSeverityForExit(code)).toBe(sev);
    }
  });
});

describe("pipelineSectionExit", () => {
  it("treats an absent optional pipeline as ok (its absence is not a fault)", () => {
    expect(pipelineSectionExit(NOT_CONFIGURED_PIPELINE)).toBe(0);
  });
  it("treats an unreadable supplied pipeline as unknown", () => {
    expect(pipelineSectionExit(pipeline(null, "unreadable"))).toBe(2);
  });
  it("maps a supplied severity onto the shared ladder", () => {
    expect(pipelineSectionExit(pipeline("ok", "supplied"))).toBe(0);
    expect(pipelineSectionExit(pipeline("usage", "supplied"))).toBe(1);
    expect(pipelineSectionExit(pipeline("unknown", "supplied"))).toBe(2);
    expect(pipelineSectionExit(pipeline("drift", "supplied"))).toBe(3);
    expect(pipelineSectionExit(pipeline("breach", "supplied"))).toBe(4);
  });
});

describe("computeRollup — worst-wins over operations + pipeline", () => {
  it("is ok only when both are ok", () => {
    const r = computeRollup(ingested("ok"), pipeline("ok", "supplied"));
    expect(r).toMatchObject({ severity: "ok", exitCode: 0, ok: true });
  });
  it("lets a pipeline breach dominate a healthy operations result", () => {
    const r = computeRollup(ingested("ok"), pipeline("breach", "supplied"));
    expect(r).toMatchObject({ severity: "critical", exitCode: 4, ok: false });
  });
  it("lets a critical operations result dominate a clean pipeline", () => {
    const r = computeRollup(ingested("critical"), pipeline("ok", "supplied"));
    expect(r).toMatchObject({ severity: "critical", exitCode: 4 });
  });
  it("maps operations warn/unknown onto the shared ladder", () => {
    expect(computeRollup(ingested("warn"), NOT_CONFIGURED_PIPELINE).exitCode).toBe(3);
    expect(computeRollup(ingested("unknown"), NOT_CONFIGURED_PIPELINE).exitCode).toBe(2);
  });
  it("an unreadable pipeline escalates a healthy result to unknown", () => {
    expect(computeRollup(ingested("ok"), pipeline(null, "unreadable")).severity).toBe("unknown");
  });
});

describe("buildOpsBundle / buildUsageError", () => {
  it("assembles a stable, caveat-bearing bundle", () => {
    const b = buildOpsBundle("2026-07-03T00:00:00.000Z", ingested("ok"), NOT_CONFIGURED_PIPELINE);
    expect(b.schema).toBe(OPS_BUNDLE_SCHEMA);
    expect(b.generatedAt).toBe("2026-07-03T00:00:00.000Z");
    expect(b.caveats).toEqual(OPS_BUNDLE_CAVEATS);
    expect(Object.keys(b.sections)).toEqual(["operations", "slo", "cleanupEvidence", "lifecycle", "pipeline"]);
  });
  it("is deterministic for the same inputs", () => {
    const a = buildOpsBundle("t", ingested("warn"), NOT_CONFIGURED_PIPELINE);
    const b = buildOpsBundle("t", ingested("warn"), NOT_CONFIGURED_PIPELINE);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it("builds a usage error at exit 1", () => {
    const e = buildUsageError("t", ["ops-check-input-malformed"]);
    expect(e).toMatchObject({ ok: false, error: "usage", exitCode: 1, issues: ["ops-check-input-malformed"] });
  });
});
