// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveDaemonReadiness } from "../daemon/readiness";
import { resolveDeploymentReadiness } from "../deploy";
import { LIFECYCLE_ENV } from "../lifecycle";
import {
  collectRuntimeOperationsSnapshot,
  collectWebOperationsSnapshot,
  engineHealthFromTools,
  type RuntimeSnapshotSource,
} from "./index";

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
    expect(snapshot.proofs).toEqual({ compressionDeep: "unknown", ocr: "unknown" });
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
      { ...DRAINABLE_ENV, [LIFECYCLE_ENV.provider]: "aws-s3", [LIFECYCLE_ENV.validated]: "true" },
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
