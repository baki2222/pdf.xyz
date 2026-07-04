import { afterEach, describe, expect, it } from "vitest";
import { recordReleaseAudit, resetReleaseAuditSink, setReleaseAuditSink } from "./metrics";
import { RELEASE_AUDIT_VERDICTS } from "./types";
import { sanitizeMetric, type WorkerMetricSample } from "../observability/metrics";

afterEach(() => resetReleaseAuditSink());

describe("release-audit metrics", () => {
  it("emits one bounded, schema-valid sample per verdict", () => {
    for (const verdict of RELEASE_AUDIT_VERDICTS) {
      const samples: WorkerMetricSample[] = [];
      setReleaseAuditSink((s) => samples.push(s));
      recordReleaseAudit(verdict);
      expect(samples).toHaveLength(1);
      const s = samples[0]!;
      expect(s.metric).toBe("worker_release_audit_total");
      expect(s.kind).toBe("counter");
      expect(s.labels).toEqual({ verdict });
      expect(s.value).toBe(1);
      // The sample survives the defense-in-depth sanitizer (a real collector would accept it).
      expect(sanitizeMetric(s)).not.toBeNull();
    }
  });

  it("defaults to a no-op sink (no throw when unset)", () => {
    resetReleaseAuditSink();
    expect(() => recordReleaseAudit("pass")).not.toThrow();
  });

  it("every verdict label is redaction-stable (survives sanitize unchanged)", () => {
    for (const verdict of RELEASE_AUDIT_VERDICTS) {
      const cleaned = sanitizeMetric({
        metric: "worker_release_audit_total",
        kind: "counter",
        labels: { verdict },
        value: 1,
      });
      expect(cleaned?.labels.verdict, verdict).toBe(verdict);
    }
  });
});
