// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveDaemonReadiness } from "../daemon/readiness";
import { LIFECYCLE_ENV } from "../lifecycle";
import { MALWARE_SCANNER_ENV } from "./scanner";
import {
  resolveDeploymentReadiness,
  type EngineHealthInput,
  type FacetId,
} from "./readiness";

// Shape-valid provider fixtures (never real credentials).
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

const DEEP: EngineHealthInput = { lossless: true, deep: true, engines: ["ghostscript"] };
const LOSSLESS_ONLY: EngineHealthInput = { lossless: true, deep: false, engines: [] };

function facet(env: Record<string, string>, id: FacetId, engine?: EngineHealthInput) {
  const daemon = resolveDaemonReadiness(env);
  const readiness = resolveDeploymentReadiness(daemon, env, { engine });
  return readiness.facets.find((f) => f.id === id)!;
}

describe("resolveDeploymentReadiness — posture", () => {
  it("is blocked when nothing is drainable", () => {
    const daemon = resolveDaemonReadiness({});
    const r = resolveDeploymentReadiness(daemon, {}, { engine: LOSSLESS_ONLY });
    expect(r.drainable).toBe(false);
    expect(r.posture).toBe("blocked");
    expect(r.detail).toMatch(/blocked/i);
  });

  it("is degraded when drainable but the lifecycle backstop is unknown", () => {
    const daemon = resolveDaemonReadiness(DRAINABLE_ENV);
    const r = resolveDeploymentReadiness(daemon, DRAINABLE_ENV, { engine: DEEP });
    expect(r.drainable).toBe(true);
    expect(r.posture).toBe("degraded");
  });

  it("is ready when drainable and the lifecycle backstop is validated", () => {
    const env = {
      ...DRAINABLE_ENV,
      [LIFECYCLE_ENV.provider]: "aws-s3",
      [LIFECYCLE_ENV.validated]: "true",
    };
    const daemon = resolveDaemonReadiness(env);
    const r = resolveDeploymentReadiness(daemon, env, { engine: DEEP });
    expect(r.posture).toBe("ready");
    expect(r.detail).toMatch(/ready/i);
  });
});

describe("resolveDeploymentReadiness — facets", () => {
  it("exposes all six facets in a stable order", () => {
    const daemon = resolveDaemonReadiness({});
    const r = resolveDeploymentReadiness(daemon, {}, { engine: LOSSLESS_ONLY });
    expect(r.facets.map((f) => f.id)).toEqual([
      "storage",
      "queue",
      "engine",
      "lifecycle",
      "malware-scan",
      "ocr",
    ]);
  });

  it("reports storage and queue not-configured when absent", () => {
    expect(facet({}, "storage").state).toBe("not-configured");
    expect(facet({}, "queue").state).toBe("not-configured");
  });

  it("reports storage and queue ready when configured", () => {
    expect(facet({ ...DRAINABLE_ENV }, "storage").state).toBe("ready");
    expect(facet({ ...DRAINABLE_ENV }, "queue").state).toBe("ready");
  });

  it("reports the engine facet from the injected health", () => {
    expect(facet({}, "engine", DEEP).state).toBe("ready");
    expect(facet({}, "engine", LOSSLESS_ONLY).state).toBe("degraded");
    // Unknown when the engine was not probed in this context.
    expect(facet({}, "engine").state).toBe("unknown");
  });

  it("maps the optional malware scanner's state to a facet, honestly", () => {
    // Nothing declared → not-configured & inactive.
    expect(facet({}, "malware-scan").state).toBe("not-configured");
    expect(resolveDeploymentReadiness(resolveDaemonReadiness({}), {}).malwareScan.active).toBe(
      false,
    );
    // A usable clamd endpoint → ready & ACTIVE (inputs are scanned).
    const configured = { [MALWARE_SCANNER_ENV]: "clamav://clamd.internal:3310" };
    expect(facet(configured, "malware-scan").state).toBe("ready");
    expect(
      resolveDeploymentReadiness(resolveDaemonReadiness(configured), configured).malwareScan
        .active,
    ).toBe(true);
    // Selected-but-misconfigured → degraded & inactive (a caveat, not a silent pass).
    expect(facet({ [MALWARE_SCANNER_ENV]: "clamav://" }, "malware-scan").state).toBe(
      "degraded",
    );
  });

  it("always reports OCR as not-implemented", () => {
    expect(facet({}, "ocr").state).toBe("not-implemented");
    expect(facet({ ...DRAINABLE_ENV }, "ocr").state).toBe("not-implemented");
  });
});

describe("resolveDeploymentReadiness — content-free", () => {
  it("never leaks a bucket, endpoint, secret, or variable name", () => {
    const daemon = resolveDaemonReadiness(DRAINABLE_ENV);
    const r = resolveDeploymentReadiness(daemon, DRAINABLE_ENV, { engine: DEEP });
    const serialized = JSON.stringify(r);
    for (const leak of [
      "pdfxyz-store",
      "redis.example.com",
      "s3.example.com",
      "redis-rest-token",
      "AKIA",
      "PDFXYZ_",
    ]) {
      expect(serialized).not.toContain(leak);
    }
  });
});
