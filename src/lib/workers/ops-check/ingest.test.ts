// @vitest-environment node
/**
 * Ingest-parser proofs (Phase 31). This module is the CLI's trust boundary, so the
 * load-bearing properties are: a valid snapshot survives (enums preserved), an envelope
 * is unwrapped, malformed input fails to bounded issue codes (never a throw), and — the
 * honesty rule — NO string from an untrusted snapshot is ever echoed. Every prose field
 * is re-authored, `daemonObserved` is recomputed, counts are bounded, and off-schema
 * metric series are dropped by the shared sanitizer.
 */
import { describe, expect, it } from "vitest";
import {
  normalizeMetrics,
  normalizeOperationsSnapshot,
  parseIngestedOperations,
} from "./ingest";
import { collectWebOperationsSnapshot } from "../observability/snapshot";
import { engineCapabilityMetric } from "../observability/metrics";

const SECRET = "s3://leaky-bucket/customer-tax-return.pdf?sig=deadbeef";

/** A minimal, valid operations snapshot object (as JSON would deserialize it). */
function validSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    vantage: "worker",
    mode: "remote-configured",
    drainable: true,
    daemonObserved: true,
    daemon: { state: "observed", source: "queue-broker", lastSeen: "under-30s", mode: "loop" },
    health: "ok",
    recommendedAction: "none",
    subsystems: [
      { id: "storage", health: "ok" },
      { id: "queue", health: "ok" },
    ],
    proofs: { compressionDeep: "available", ocr: "unavailable" },
    lifecycleVerification: { verdict: "verified", health: "ok" },
    lastLoop: null,
    ...overrides,
  };
}

describe("normalizeOperationsSnapshot — valid input", () => {
  it("preserves the load-bearing enums and recomputes daemonObserved", () => {
    const r = normalizeOperationsSnapshot(validSnapshot());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.health).toBe("ok");
    expect(r.snapshot.recommendedAction).toBe("none");
    expect(r.snapshot.daemon.state).toBe("observed");
    expect(r.snapshot.daemon.source).toBe("queue-broker");
    expect(r.snapshot.daemon.lastSeen).toBe("under-30s");
    expect(r.snapshot.daemonObserved).toBe(true);
    expect(r.snapshot.subsystems.map((s) => s.id)).toEqual(["storage", "queue"]);
    expect(r.snapshot.proofs).toEqual({ compressionDeep: "available", ocr: "unavailable" });
    expect(r.snapshot.version).toBe(1);
  });

  it("round-trips a real web snapshot through JSON with enums intact", () => {
    const original = collectWebOperationsSnapshot({});
    const r = normalizeOperationsSnapshot(JSON.parse(JSON.stringify(original)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.health).toBe(original.health);
    expect(r.snapshot.recommendedAction).toBe(original.recommendedAction);
    expect(r.snapshot.daemon.state).toBe(original.daemon.state);
    expect(r.snapshot.subsystems.map((s) => s.id).sort()).toEqual(
      original.subsystems.map((s) => s.id).sort(),
    );
  });

  it("never trusts a forged daemonObserved on a stale record", () => {
    const r = normalizeOperationsSnapshot(
      validSnapshot({
        daemonObserved: true,
        daemon: { state: "stale", source: "queue-broker" },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.daemon.state).toBe("stale");
    expect(r.snapshot.daemonObserved).toBe(false);
  });

  it("drops unknown/duplicate subsystem ids and out-of-enum sub-fields", () => {
    const r = normalizeOperationsSnapshot(
      validSnapshot({
        vantage: "not-a-vantage",
        daemon: { state: "disabled", source: "not-a-source", lastSeen: "eons", mode: "nope" },
        proofs: { compressionDeep: "totally", ocr: "unavailable" },
        subsystems: [
          { id: "storage", health: "warn" },
          { id: "storage", health: "ok" }, // duplicate → dropped
          { id: "not-a-subsystem", health: "ok" }, // unknown → dropped
          { id: "ocr", health: "not-a-health" }, // bad health → dropped
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.vantage).toBe("web"); // defaulted, not echoed
    expect(r.snapshot.daemon.source).toBe("none"); // defaulted
    expect(r.snapshot.daemon.lastSeen).toBeNull();
    expect(r.snapshot.daemon.mode).toBeNull();
    expect(r.snapshot.proofs.compressionDeep).toBe("unknown"); // defaulted
    expect(r.snapshot.subsystems.map((s) => s.id)).toEqual(["storage"]);
    expect(r.snapshot.subsystems[0]?.health).toBe("warn");
  });

  it("bounds loop counters and drops a malformed loop", () => {
    const good = normalizeOperationsSnapshot(
      validSnapshot({
        lastLoop: {
          mode: "drain",
          reason: "drained",
          ticks: 5,
          completed: -3, // clamped to 0
          failed: Number.NaN, // clamped to 0
          requeued: 1,
          canceled: 0,
          idle: 2,
          errors: 0,
          health: "ok",
        },
      }),
    );
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.snapshot.lastLoop?.completed).toBe(0);
      expect(good.snapshot.lastLoop?.failed).toBe(0);
      expect(good.snapshot.lastLoop?.ticks).toBe(5);
    }

    const bad = normalizeOperationsSnapshot(
      validSnapshot({ lastLoop: { mode: "not-a-mode", reason: "drained", health: "ok" } }),
    );
    expect(bad.ok).toBe(true);
    if (bad.ok) expect(bad.snapshot.lastLoop).toBeNull();
  });
});

describe("normalizeOperationsSnapshot — fatal input", () => {
  it("rejects a non-object", () => {
    const r = normalizeOperationsSnapshot(42);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toContain("snapshot-not-an-object");
  });

  it("rejects a snapshot missing the load-bearing fields", () => {
    const r = normalizeOperationsSnapshot({ subsystems: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toContain("invalid-or-missing-health");
      expect(r.issues).toContain("invalid-or-missing-recommended-action");
      expect(r.issues).toContain("invalid-or-missing-daemon-liveness");
    }
  });

  it("rejects out-of-enum load-bearing values", () => {
    const r = normalizeOperationsSnapshot(
      validSnapshot({ health: "green", recommendedAction: "reboot-everything" }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toContain("invalid-or-missing-health");
      expect(r.issues).toContain("invalid-or-missing-recommended-action");
    }
  });
});

describe("parseIngestedOperations — envelopes + text", () => {
  it("parses a bare snapshot", () => {
    const r = parseIngestedOperations(JSON.stringify(validSnapshot()));
    expect(r.ok).toBe(true);
  });

  it("unwraps the GET /api/worker/operations envelope ({ data })", () => {
    const r = parseIngestedOperations(JSON.stringify({ ok: true, data: validSnapshot() }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.snapshot.health).toBe("ok");
  });

  it("unwraps { operations, metrics } and sanitizes the metric series", () => {
    const envelope = {
      operations: validSnapshot(),
      metrics: { series: [engineCapabilityMetric("compression_deep", true)] },
    };
    const r = parseIngestedOperations(JSON.stringify(envelope));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.metrics).not.toBeNull();
      expect(r.value.metrics?.series.length).toBeGreaterThan(0);
    }
  });

  it("returns bounded issue codes for invalid JSON — never throws", () => {
    const r = parseIngestedOperations("{not json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toEqual(["invalid-json"]);
  });

  it("returns an issue for a non-object JSON root", () => {
    const r = parseIngestedOperations("[1,2,3]");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toContain("input-not-an-object");
  });
});

describe("normalizeMetrics — sanitization", () => {
  it("accepts a valid series and drops off-schema entries", () => {
    const snap = normalizeMetrics({
      series: [
        engineCapabilityMetric("compression_deep", true),
        { metric: "totally_made_up", kind: "gauge", labels: {}, value: 1 },
      ],
    });
    expect(snap).not.toBeNull();
    expect(snap?.series.length).toBe(1);
  });

  it("returns null for an empty or missing series", () => {
    expect(normalizeMetrics({ series: [] })).toBeNull();
    expect(normalizeMetrics({})).toBeNull();
    expect(normalizeMetrics(null)).toBeNull();
  });

  it("drops a content-bearing label value rather than aggregating it", () => {
    const snap = normalizeMetrics({
      series: [{ metric: "worker_engine_capability", kind: "gauge", labels: { capability: SECRET, available: "true" }, value: 1 }],
    });
    // The label value is not in the closed enum, so the sample is rejected entirely.
    expect(snap).toBeNull();
  });
});

describe("no-leak sanitization — end to end", () => {
  it("never echoes any content-bearing string from an ingested snapshot", () => {
    const poisoned = validSnapshot({
      // Content-bearing prose in every string field a naive parser might echo.
      detail: SECRET,
      recommendedActionDetail: SECRET,
      daemon: {
        state: "stale",
        source: "queue-broker",
        lastSeen: "over-10m",
        mode: "loop",
        detail: SECRET,
      },
      subsystems: [
        { id: "storage", health: "warn", label: SECRET, detail: SECRET },
        { id: "malware-scan", health: "warn", label: SECRET, detail: SECRET },
      ],
      lifecycleVerification: { verdict: "drift", health: "warn", detail: SECRET },
      // A hostile extra field that must simply be ignored.
      hostileExtra: SECRET,
    });
    const r = parseIngestedOperations(JSON.stringify(poisoned));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const serialized = JSON.stringify(r.value.snapshot);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("hostileExtra");
    // The validated enums still made it through.
    expect(r.value.snapshot.daemon.state).toBe("stale");
    expect(r.value.snapshot.subsystems.map((s) => s.id)).toEqual(["storage", "malware-scan"]);
  });
});
