import { describe, expect, it } from "vitest";
import { ingestOpsCheckResult, ingestPipelineSummary, NOT_CONFIGURED_PIPELINE } from "./ingest";
import { CLEANUP_EVIDENCE_DETAIL } from "../cleanup-evidence/types";
import { RECOMMENDED_ACTION_DETAIL } from "../observability/snapshot";

/** A minimal, valid `pdfxyz.ops-check/1` result, overridable per test. */
function opsResult(over: Record<string, unknown> = {}, snap: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: "pdfxyz.ops-check/1",
    generatedAt: "2020-01-01T00:00:00.000Z",
    source: "file",
    ok: true,
    severity: "ok",
    exitCode: 0,
    action: "none",
    actionDetail: "poisoned detail — must be re-authored",
    summary: "poisoned summary",
    liveness: { state: "observed", source: "queue-broker", lastSeen: "under-30s", severity: "ok", reason: "liveness-observed", action: "none", detail: "poison" },
    snapshot: {
      vantage: "worker",
      health: "ok",
      drainable: true,
      daemonObserved: true,
      subsystems: [
        { id: "storage", health: "ok" },
        { id: "lifecycle-verification", health: "ok" },
      ],
      proofs: { compressionDeep: "available", ocr: "available" },
      cleanupEvidence: { state: "healthy", reason: "cleanup_verified", provider: "remote-configured", freshness: "fresh" },
      lastLoop: null,
      ...snap,
    },
    slo: null,
    alerts: [],
    ...over,
  });
}

describe("ingestOpsCheckResult — happy path", () => {
  it("extracts bounded sections from a valid result", () => {
    const r = ingestOpsCheckResult(opsResult());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.operations.severity).toBe("ok");
    expect(r.value.operations.health).toBe("ok");
    expect(r.value.operations.vantage).toBe("worker");
    expect(r.value.operations.drainable).toBe(true);
    expect(r.value.cleanupEvidence.state).toBe("healthy");
    expect(r.value.lifecycle.verdict).toBe("verified");
  });

  it("re-authors actionDetail and summary from app-owned maps (never the input strings)", () => {
    const r = ingestOpsCheckResult(opsResult({ action: "configure-storage" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.operations.actionDetail).toBe(RECOMMENDED_ACTION_DETAIL["configure-storage"]);
    expect(r.value.operations.actionDetail).not.toContain("poisoned");
    expect(r.value.operations.summary).not.toContain("poisoned");
  });

  it("re-authors cleanup-evidence detail from the reason map", () => {
    const r = ingestOpsCheckResult(opsResult({}, { cleanupEvidence: { state: "stale", reason: "report_stale", provider: "unknown", freshness: "stale" } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.cleanupEvidence.detail).toBe(CLEANUP_EVIDENCE_DETAIL["report_stale"]);
  });
});

describe("ingestOpsCheckResult — fatal (usage) cases", () => {
  it("rejects non-JSON", () => {
    expect(ingestOpsCheckResult("{not json")).toEqual({ ok: false, issues: ["ops-check-input-malformed"] });
  });
  it("rejects a non-object / array", () => {
    expect(ingestOpsCheckResult("[]")).toEqual({ ok: false, issues: ["ops-check-input-malformed"] });
    expect(ingestOpsCheckResult("42")).toEqual({ ok: false, issues: ["ops-check-input-malformed"] });
  });
  it("rejects the wrong schema", () => {
    expect(ingestOpsCheckResult(JSON.stringify({ schema: "pdfxyz.cleanup-check/1" }))).toEqual({
      ok: false,
      issues: ["ops-check-input-unrecognized"],
    });
  });
  it("rejects an ops-check usage-error envelope", () => {
    const usage = JSON.stringify({ schema: "pdfxyz.ops-check/1", error: "usage", exitCode: 1, issues: ["x"] });
    expect(ingestOpsCheckResult(usage)).toEqual({ ok: false, issues: ["ops-check-usage-error"] });
  });
  it("rejects a result with an invalid/missing severity or snapshot", () => {
    expect(ingestOpsCheckResult(opsResult({ severity: "bananas" }))).toEqual({ ok: false, issues: ["ops-check-input-invalid"] });
    expect(ingestOpsCheckResult(JSON.stringify({ schema: "pdfxyz.ops-check/1", severity: "ok" }))).toEqual({
      ok: false,
      issues: ["ops-check-input-invalid"],
    });
  });
});

describe("ingestOpsCheckResult — honest degradation & no fake liveness", () => {
  it("degrades unknown enum fields to safe defaults, keeping the section", () => {
    const r = ingestOpsCheckResult(opsResult({}, { health: "bananas", vantage: "mars", proofs: { compressionDeep: "x", ocr: "y" }, cleanupEvidence: {} }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.operations.health).toBe("unknown");
    expect(r.value.operations.vantage).toBe("worker");
    expect(r.value.operations.proofs).toEqual({ compressionDeep: "unknown", ocr: "unknown" });
    expect(r.value.cleanupEvidence.state).toBe("disabled");
  });

  it("recomputes daemonObserved from the liveness state, never trusting the input flag", () => {
    // Forged: daemonObserved:true but liveness is stale.
    const r = ingestOpsCheckResult(
      opsResult({ liveness: { state: "stale", source: "self", lastSeen: "over-10m", severity: "warn", reason: "liveness-stale", action: "investigate-worker-liveness" } }, { daemonObserved: true }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.operations.daemonObserved).toBe(false);
  });

  it("drops invalid subsystems/alerts entries and caps array lengths", () => {
    const manySubsystems = Array.from({ length: 100 }, () => ({ id: "storage", health: "ok" }));
    const r = ingestOpsCheckResult(
      opsResult({ alerts: [{ source: "nope", severity: "warn", reason: "x", action: "y" }, { source: "storage", severity: "warn", reason: "storage-unconfigured", action: "configure-storage" }] }, { subsystems: manySubsystems }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.operations.subsystems.length).toBeLessThanOrEqual(32);
    expect(r.value.operations.alerts).toHaveLength(1); // the invalid-source alert is dropped
    expect(r.value.operations.alerts[0]!.source).toBe("storage");
  });

  it("derives lifecycle drift from an alert, not a self-asserted verdict", () => {
    const r = ingestOpsCheckResult(
      opsResult({ alerts: [{ source: "lifecycle-verification", severity: "critical", reason: "lifecycle-drift", action: "reconcile-lifecycle-drift" }] }, { subsystems: [{ id: "lifecycle-verification", health: "blocked" }] }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.lifecycle.verdict).toBe("drift");
    expect(r.value.lifecycle.drift).toBe(true);
  });

  it("clamps SLO counts and keeps only bounded id+status issues", () => {
    const r = ingestOpsCheckResult(
      opsResult({ slo: { worst: "breach", evaluated: -5, total: 3.9, issues: [{ id: "queue_age", status: "breach", observed: "60m+ SECRET", threshold: "2-10m" }, { id: "nope", status: "warn" }] } }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok || !r.value.slo) return;
    expect(r.value.slo.worst).toBe("breach");
    expect(r.value.slo.evaluated).toBe(0);
    expect(r.value.slo.total).toBe(3);
    expect(r.value.slo.issues).toEqual([{ id: "queue_age", status: "breach" }]);
    expect(JSON.stringify(r.value.slo)).not.toContain("SECRET");
  });
});

describe("ingestPipelineSummary", () => {
  it("is not-configured for null input", () => {
    expect(ingestPipelineSummary(null)).toBe(NOT_CONFIGURED_PIPELINE);
  });
  it("is unreadable for non-JSON / wrong schema / missing severity", () => {
    expect(ingestPipelineSummary("{bad").source).toBe("unreadable");
    expect(ingestPipelineSummary(JSON.stringify({ schema: "other" })).source).toBe("unreadable");
    expect(ingestPipelineSummary(JSON.stringify({ schema: "pdfxyz.cleanup-pipeline/1" })).source).toBe("unreadable");
  });
  it("extracts a bounded severity + per-arm digest from a valid summary", () => {
    const s = ingestPipelineSummary(
      JSON.stringify({ schema: "pdfxyz.cleanup-pipeline/1", severity: "breach", arms: [{ arm: "verify", severity: "breach", projected: false }, { arm: "bogus", severity: "ok" }] }),
    );
    expect(s.source).toBe("supplied");
    expect(s.severity).toBe("breach");
    expect(s.arms).toEqual([{ arm: "verify", severity: "breach", projected: false }]);
  });
});
