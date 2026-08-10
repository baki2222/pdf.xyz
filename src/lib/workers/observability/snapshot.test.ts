// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveDaemonReadiness } from "../daemon/readiness";
import { resolveDeploymentReadiness } from "../deploy";
import { LIFECYCLE_ENV } from "../lifecycle";
import type { HeartbeatLiveness } from "../heartbeat";
import {
  collectRuntimeOperationsSnapshot,
  collectWebOperationsSnapshot,
  engineHealthFromTools,
  rateLimitPostureForCode,
  type CleanupEvidencePosture,
  type RuntimeSnapshotSource,
  type SnapshotRateLimitCode,
} from "./index";

/** Build a content-free {@link HeartbeatLiveness} fixture for a given state. */
function liveness(
  state: HeartbeatLiveness["state"],
  extra: Partial<HeartbeatLiveness> = {},
): HeartbeatLiveness {
  return {
    state,
    observed: state === "observed",
    source: state === "disabled" ? "none" : "queue-broker",
    lastSeen: null,
    mode: null,
    capabilities: null,
    detail: "content-free-liveness-detail",
    ...extra,
  };
}

const DRAINABLE_ENV = {
  PDFXYZ_STORAGE_PROVIDER: "s3",
  PDFXYZ_S3_ENDPOINT: "https://s3.example.com",
  PDFXYZ_S3_REGION: "auto",
  PDFXYZ_S3_BUCKET: "pdfxyz-store",
  PDFXYZ_S3_ACCESS_KEY_ID: "AKIAEXAMPLE123",
  PDFXYZ_S3_SECRET_ACCESS_KEY: "s3-secret-value-1234567890",
  PDFXYZ_QUEUE_PROVIDER: "redis",
  PDFXYZ_REDIS_REST_URL: "https://redis.example.com",
  PDFXYZ_REDIS_REST_TOKEN: "redis-rest-token-1234",
} as const;

describe("worker operations snapshot", () => {
  it("reports blocked no-config state from the web without faking daemon liveness", () => {
    const snapshot = collectWebOperationsSnapshot({});
    expect(snapshot.vantage).toBe("web");
    expect(snapshot.daemonObserved).toBe(false);
    expect(snapshot.drainable).toBe(false);
    expect(snapshot.health).toBe("blocked");
    expect(snapshot.recommendedAction).toBe("configure-providers");
    expect(snapshot.proofs).toEqual({
      compressionDeep: "unknown",
      ocr: "unknown",
    });
    expect(snapshot.subsystems.map((s) => s.id)).toContain("daemon-loop");
  });

  it("keeps configured web snapshots honest: drainable is not deployed-daemon liveness", () => {
    const snapshot = collectWebOperationsSnapshot({
      ...DRAINABLE_ENV,
      [LIFECYCLE_ENV.provider]: "aws-s3",
      [LIFECYCLE_ENV.validated]: "true",
    });
    expect(snapshot.drainable).toBe(true);
    expect(snapshot.daemonObserved).toBe(false);
    expect(snapshot.recommendedAction).toBe("confirm-worker-deployment");
    expect(snapshot.proofs.compressionDeep).toBe("unknown");
    expect(snapshot.proofs.ocr).toBe("unknown");
  });

  it("uses worker-vantage evidence for engine proofs, lifecycle verification, and loop outcomes", () => {
    const readiness = resolveDaemonReadiness({
      ...DRAINABLE_ENV,
      [LIFECYCLE_ENV.provider]: "aws-s3",
      [LIFECYCLE_ENV.validated]: "true",
    });
    const deployment = resolveDeploymentReadiness(
      readiness,
      {
        ...DRAINABLE_ENV,
        [LIFECYCLE_ENV.provider]: "aws-s3",
        [LIFECYCLE_ENV.validated]: "true",
      },
      {
        engine: { lossless: true, deep: true, engines: ["ghostscript"] },
        ocr: {
          ready: true,
          detail: "OCR is available.",
        },
      },
    );
    const runtime: RuntimeSnapshotSource = {
      readiness,
      deployment,
      ocr: { enabled: true },
      guardrails: { ok: true, strict: false, violations: [] },
    };
    const snapshot = collectRuntimeOperationsSnapshot(runtime, {
      lifecycleVerification: { verdict: "verified" },
      lastLoop: {
        mode: "once",
        reason: "drained",
        ticks: 1,
        completed: 1,
        failed: 0,
        requeued: 0,
        canceled: 0,
        idle: 0,
        errors: 0,
      },
    });

    expect(snapshot.vantage).toBe("worker");
    expect(snapshot.daemonObserved).toBe(true);
    expect(snapshot.proofs.compressionDeep).toBe("available");
    expect(snapshot.proofs.ocr).toBe("available");
    expect(snapshot.lifecycleVerification.verdict).toBe("verified");
    expect(snapshot.lastLoop?.health).toBe("ok");
  });

  it("serializes without secrets, endpoints, paths, object keys, filenames, or OCR text", () => {
    const snapshot = collectWebOperationsSnapshot({
      ...DRAINABLE_ENV,
      PDFXYZ_S3_BUCKET: "secret-bucket-name",
      PDFXYZ_REDIS_REST_URL: "https://redis.example.com/secret",
      PDFXYZ_REDIS_REST_TOKEN: "REDIS_SECRET_TOKEN_VALUE",
    });
    const json = JSON.stringify(snapshot);
    for (const forbidden of [
      "secret-bucket-name",
      "redis.example.com",
      "REDIS_SECRET_TOKEN_VALUE",
      "/tmp/",
      "s3://",
      "object-key",
      "invoice.pdf",
      "OCRPROOF",
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it("derives host engine health only from bounded tool booleans", () => {
    expect(engineHealthFromTools(undefined)).toBeUndefined();
    expect(
      engineHealthFromTools({ ghostscript: true, qpdf: false, mutool: false }),
    ).toEqual({ lossless: true, deep: true, engines: ["ghostscript"] });
  });
});

describe("worker operations snapshot — daemon liveness (Phase 30)", () => {
  // A fully-green web env: drainable + a validated lifecycle backstop, so the verdict
  // reaches the liveness residual (step 9) rather than an earlier caveat.
  const GREEN_ENV = {
    ...DRAINABLE_ENV,
    [LIFECYCLE_ENV.provider]: "aws-s3",
    [LIFECYCLE_ENV.validated]: "true",
  };

  it("marks daemonObserved true and clears the residual on a fresh heartbeat", () => {
    const snap = collectWebOperationsSnapshot(GREEN_ENV, {
      daemonLiveness: liveness("observed", {
        observed: true,
        lastSeen: "under-30s",
        mode: "loop",
      }),
    });
    expect(snap.daemonObserved).toBe(true);
    expect(snap.health).toBe("ok");
    expect(snap.recommendedAction).toBe("none");
    expect(snap.daemon).toMatchObject({
      state: "observed",
      source: "queue-broker",
      lastSeen: "under-30s",
      mode: "loop",
    });
  });

  it("treats a stale heartbeat as an actionable warning, never observed", () => {
    const snap = collectWebOperationsSnapshot(GREEN_ENV, {
      daemonLiveness: liveness("stale", { lastSeen: "under-2m", mode: "loop" }),
    });
    expect(snap.daemonObserved).toBe(false);
    expect(snap.health).toBe("warn");
    expect(snap.recommendedAction).toBe("investigate-worker-liveness");
    expect(snap.daemon.state).toBe("stale");
  });

  it("treats an unknown (enabled, no beat) heartbeat as an actionable warning", () => {
    const snap = collectWebOperationsSnapshot(GREEN_ENV, {
      daemonLiveness: liveness("unknown"),
    });
    expect(snap.daemonObserved).toBe(false);
    expect(snap.recommendedAction).toBe("investigate-worker-liveness");
    expect(snap.daemon.state).toBe("unknown");
  });

  it("keeps the honest 'confirm a worker' residual when observation is disabled", () => {
    const snap = collectWebOperationsSnapshot(GREEN_ENV, {
      daemonLiveness: liveness("disabled"),
    });
    expect(snap.daemonObserved).toBe(false);
    expect(snap.recommendedAction).toBe("confirm-worker-deployment");
    expect(snap.daemon.state).toBe("disabled");
  });

  it("defaults to the disabled residual when no liveness is supplied", () => {
    const snap = collectWebOperationsSnapshot(GREEN_ENV);
    expect(snap.daemonObserved).toBe(false);
    expect(snap.daemon.state).toBe("disabled");
    expect(snap.recommendedAction).toBe("confirm-worker-deployment");
  });

  it("observes its own liveness on the worker vantage (source self)", () => {
    const readiness = resolveDaemonReadiness(GREEN_ENV);
    const deployment = resolveDeploymentReadiness(readiness, GREEN_ENV, {
      engine: { lossless: true, deep: true, engines: ["ghostscript"] },
    });
    const runtime: RuntimeSnapshotSource = {
      readiness,
      deployment,
      ocr: { enabled: false },
      guardrails: { ok: true, strict: false, violations: [] },
    };
    const snap = collectRuntimeOperationsSnapshot(runtime);
    expect(snap.daemonObserved).toBe(true);
    expect(snap.daemon).toMatchObject({ state: "observed", source: "self" });
  });

  it("never lets a hostile heartbeat detail carry an identifier into the snapshot", () => {
    // The snapshot authors its own daemon.detail, so even a hostile reader detail is
    // discarded rather than surfaced.
    const snap = collectWebOperationsSnapshot(GREEN_ENV, {
      daemonLiveness: liveness("observed", {
        observed: true,
        detail:
          "https://redis.example.com:6379 s3://secret-bucket/leak.pdf AKIASECRET",
      }),
    });
    const json = JSON.stringify(snap.daemon);
    for (const forbidden of [
      "redis.example.com",
      ":6379",
      "s3://",
      "secret-bucket",
      "leak.pdf",
      "AKIASECRET",
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });
});

describe("worker operations snapshot — cleanup evidence (Phase 44)", () => {
  const posture = (
    state: CleanupEvidencePosture["state"],
    over: Partial<CleanupEvidencePosture> = {},
  ): CleanupEvidencePosture => ({
    state,
    reason: "cleanup_verified",
    provider: "remote-configured",
    freshness: "fresh",
    age: "1-24h",
    reportKind: "cleanup-check",
    detail: "authored elsewhere",
    ...over,
  });

  it("defaults to a disabled posture + an unknown cleanup-evidence subsystem", () => {
    const snap = collectWebOperationsSnapshot({});
    expect(snap.cleanupEvidence.state).toBe("disabled");
    expect(
      snap.subsystems.find((s) => s.id === "cleanup-evidence")?.health,
    ).toBe("unknown");
  });

  it("derives the subsystem health from the supplied posture state", () => {
    const matrix: Array<[CleanupEvidencePosture["state"], string]> = [
      ["healthy", "ok"],
      ["stale", "warn"],
      ["warning", "warn"],
      ["critical", "blocked"],
      ["invalid", "blocked"],
      ["unknown", "unknown"],
      ["not-configured", "unknown"],
    ];
    for (const [state, health] of matrix) {
      const snap = collectWebOperationsSnapshot(
        {},
        { cleanupEvidence: posture(state) },
      );
      expect(snap.cleanupEvidence.state, state).toBe(state);
      expect(
        snap.subsystems.find((s) => s.id === "cleanup-evidence")?.health,
        state,
      ).toBe(health);
    }
  });

  it("carries the posture on the worker vantage too", () => {
    const runtime: RuntimeSnapshotSource = {
      readiness: resolveDaemonReadiness(DRAINABLE_ENV),
      deployment: resolveDeploymentReadiness(
        resolveDaemonReadiness(DRAINABLE_ENV),
        DRAINABLE_ENV,
        {},
      ),
      ocr: { enabled: false },
      guardrails: { ok: true, strict: false, violations: [] },
    };
    const snap = collectRuntimeOperationsSnapshot(runtime, {
      cleanupEvidence: posture("warning", { reason: "cleanup_drift" }),
    });
    expect(snap.cleanupEvidence.reason).toBe("cleanup_drift");
    expect(
      snap.subsystems.find((s) => s.id === "cleanup-evidence")?.health,
    ).toBe("warn");
  });
});

describe("worker operations snapshot — abuse-guard rate-limit posture", () => {
  const rateLimitSub = (snap: {
    subsystems: { id: string; health: string }[];
  }) => snap.subsystems.find((s) => s.id === "rate-limit");

  it("the web collector resolves the posture itself: the quiet default reads disabled/ok", () => {
    const snap = collectWebOperationsSnapshot({});
    expect(snap.rateLimit.code).toBe("disabled");
    expect(snap.rateLimit.enforced).toBe(false);
    expect(rateLimitSub(snap)?.health).toBe("ok");
  });

  it("a valid remote store reads remote-configured/ok from the web env", () => {
    const snap = collectWebOperationsSnapshot({
      ...DRAINABLE_ENV,
      PDFXYZ_RATE_LIMIT_PROVIDER: "redis",
      PDFXYZ_RATE_LIMIT_REDIS_REST_URL: "https://example-store.upstash.io",
      PDFXYZ_RATE_LIMIT_REDIS_REST_TOKEN: "A".repeat(48),
      // Per-client enforcement needs trusted identity too; without it the same
      // store reads `remote-configured-shared` (one bucket for everyone).
      PDFXYZ_RATE_LIMIT_TRUST_PROXY: "true",
      PDFXYZ_RATE_LIMIT_KEY_SALT: "test-shared-salt",
    });
    expect(snap.rateLimit.code).toBe("remote-configured");
    expect(snap.rateLimit.enforced).toBe(true);
    expect(snap.rateLimit.distributed).toBe(true);
    expect(rateLimitSub(snap)?.health).toBe("ok");
  });

  it("a selected provider with no valid store is the alertable warn (configured, not enforcing)", () => {
    const snap = collectWebOperationsSnapshot({
      ...DRAINABLE_ENV,
      PDFXYZ_RATE_LIMIT_PROVIDER: "redis",
    });
    expect(snap.rateLimit.code).toBe("remote-missing-config");
    expect(snap.rateLimit.enforced).toBe(false);
    expect(rateLimitSub(snap)?.health).toBe("warn");
  });

  it("a caller-supplied decision-refined posture (the route's fail-open) wins over the static read", () => {
    const snap = collectWebOperationsSnapshot(
      {
        ...DRAINABLE_ENV,
        PDFXYZ_RATE_LIMIT_PROVIDER: "redis",
        PDFXYZ_RATE_LIMIT_REDIS_REST_URL: "https://example-store.upstash.io",
        PDFXYZ_RATE_LIMIT_REDIS_REST_TOKEN: "A".repeat(48),
      },
      { rateLimit: rateLimitPostureForCode("remote-error-fail-open") },
    );
    expect(snap.rateLimit.code).toBe("remote-error-fail-open");
    expect(snap.rateLimit.enforced).toBe(false);
    expect(snap.rateLimit.distributed).toBe(true);
    expect(rateLimitSub(snap)?.health).toBe("warn");
  });

  it("maps every posture code to its documented health class", () => {
    const matrix: Array<[SnapshotRateLimitCode, string]> = [
      ["disabled", "ok"],
      ["local-memory", "ok"],
      ["remote-configured", "ok"],
      ["remote-missing-config", "warn"],
      ["remote-error-fail-open", "warn"],
      ["unknown", "unknown"],
    ];
    for (const [code, health] of matrix) {
      const snap = collectWebOperationsSnapshot(
        {},
        { rateLimit: rateLimitPostureForCode(code) },
      );
      expect(snap.rateLimit.code, code).toBe(code);
      expect(rateLimitSub(snap)?.health, code).toBe(health);
    }
  });

  it("the worker vantage carries the honest unknown — never 'disabled' on no evidence", () => {
    const runtime: RuntimeSnapshotSource = {
      readiness: resolveDaemonReadiness(DRAINABLE_ENV),
      deployment: resolveDeploymentReadiness(
        resolveDaemonReadiness(DRAINABLE_ENV),
        DRAINABLE_ENV,
        {},
      ),
      ocr: { enabled: false },
      guardrails: { ok: true, strict: false, violations: [] },
    };
    const snap = collectRuntimeOperationsSnapshot(runtime);
    expect(snap.rateLimit.code).toBe("unknown");
    expect(rateLimitSub(snap)?.health).toBe("unknown");
  });

  it("never carries an environment variable name — unlike the ratelimit layer's own status", () => {
    // The raw `RateLimitStatus` names env VARIABLES in `envVars`; the snapshot bans
    // variable names, so the posture must be the reduced projection.
    const snap = collectWebOperationsSnapshot({
      PDFXYZ_RATE_LIMIT_PROVIDER: "redis",
    });
    const text = JSON.stringify(snap);
    expect(text).not.toContain("PDFXYZ_RATE_LIMIT");
    expect(text).not.toContain("envVars");
  });
});
