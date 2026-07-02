// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveDaemonReadiness } from "./readiness";

// Minimal, well-formed provider env fixtures (shape-valid; never real credentials).
const S3_SECRET = "s3-secret-value-1234";
const REDIS_TOKEN = "redis-rest-token-1234";

const S3_ENV = {
  PDFXYZ_STORAGE_PROVIDER: "s3",
  PDFXYZ_S3_ENDPOINT: "https://s3.example.com",
  PDFXYZ_S3_REGION: "auto",
  PDFXYZ_S3_BUCKET: "pdfxyz-inputs",
  PDFXYZ_S3_ACCESS_KEY_ID: "AKIAEXAMPLE123",
  PDFXYZ_S3_SECRET_ACCESS_KEY: S3_SECRET,
} as const;

const REDIS_ENV = {
  PDFXYZ_QUEUE_PROVIDER: "redis",
  PDFXYZ_REDIS_REST_URL: "https://redis.example.com",
  PDFXYZ_REDIS_REST_TOKEN: REDIS_TOKEN,
} as const;

describe("resolveDaemonReadiness", () => {
  it("reports nothing configured on an empty environment", () => {
    const r = resolveDaemonReadiness({});
    expect(r).toMatchObject({
      mode: "disabled",
      queueConfigured: false,
      storageConfigured: false,
      drainable: false,
      runsInThisProcess: false,
    });
    expect(r.detail).toMatch(/no worker daemon can run/i);
  });

  it("is not drainable with only storage configured", () => {
    const r = resolveDaemonReadiness({ ...S3_ENV });
    expect(r.storageConfigured).toBe(true);
    expect(r.queueConfigured).toBe(false);
    expect(r.drainable).toBe(false);
    expect(r.detail).toMatch(/nothing to drain/i);
  });

  it("is not drainable with only the queue configured", () => {
    const r = resolveDaemonReadiness({ ...REDIS_ENV });
    expect(r.queueConfigured).toBe(true);
    expect(r.storageConfigured).toBe(false);
    expect(r.drainable).toBe(false);
    expect(r.detail).toMatch(/nowhere to read inputs/i);
  });

  it("is drainable only when both queue and storage are configured", () => {
    const r = resolveDaemonReadiness({ ...S3_ENV, ...REDIS_ENV });
    expect(r).toMatchObject({
      queueConfigured: true,
      storageConfigured: true,
      drainable: true,
      runsInThisProcess: false,
    });
    expect(r.detail).toMatch(/can claim, run, and complete/i);
  });

  it("explains the local-dev nuance and never claims to run in-process", () => {
    const r = resolveDaemonReadiness({
      ...S3_ENV,
      ...REDIS_ENV,
      PDFXYZ_WORKER_MODE: "local-dev",
    });
    expect(r.mode).toBe("local-dev");
    expect(r.runsInThisProcess).toBe(false);
    expect(r.detail).toMatch(/in-process worker/i);
  });

  it("never leaks a secret value into the detail", () => {
    const r = resolveDaemonReadiness({ ...S3_ENV, ...REDIS_ENV });
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain(S3_SECRET);
    expect(serialized).not.toContain(REDIS_TOKEN);
    expect(serialized).not.toContain("pdfxyz-inputs"); // no bucket name
    expect(serialized).not.toContain("redis.example.com"); // no endpoint
  });
});
