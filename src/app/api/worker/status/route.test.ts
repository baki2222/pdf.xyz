// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REQUIRED_WORKER_ENV } from "@/lib/jobs";
import { WORKER_MODE_ENV } from "@/lib/workers";
import { S3_ENV } from "@/lib/workers/storage/s3-config";
import { GET } from "./route";

const s3Vars = Object.values(S3_ENV);

function clearEnv() {
  for (const name of REQUIRED_WORKER_ENV) delete process.env[name];
  for (const name of s3Vars) delete process.env[name];
  delete process.env[WORKER_MODE_ENV];
}

function configureS3() {
  process.env[S3_ENV.provider] = "s3";
  process.env[S3_ENV.endpoint] = "https://s3.us-east-1.amazonaws.com";
  process.env[S3_ENV.region] = "us-east-1";
  process.env[S3_ENV.bucket] = "pdfxyz-prod";
  process.env[S3_ENV.accessKeyId] = "AKIAEXAMPLE0000000";
  process.env[S3_ENV.secretAccessKey] = "s3cr3tEXAMPLEkeyValue00000000000000000000";
}

beforeEach(clearEnv);
afterEach(clearEnv);

describe("GET /api/worker/status", () => {
  it("reports disabled with no capability by default", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.mode).toBe("disabled");
    expect(body.enabled).toBe(false);
    expect(body.compress).toEqual({ lossless: false, deep: false, engines: [] });
    // OCR is never probed by the route, so it is honestly unavailable.
    expect(body.ocr.available).toBe(false);
    expect(body.ocr.engine).toBeNull();
    expect(body.ocr.languages).toEqual([]);
    // Every pipeline provider reports honestly not-configured, and nothing in
    // the response ever names an infrastructure variable.
    expect(body.providers.storage.ready).toBe(false);
    expect(body.providers.queue.ready).toBe(false);
    expect(body.providers.processor.ready).toBe(false);
    // Executor readiness is presence-only and honestly "none" when disabled.
    expect(body.providers.processor.executor.mode).toBe("none");
    expect(body.providers.processor.executor.ready).toBe(false);
    expect(JSON.stringify(body)).not.toContain("PDFXYZ_");
  });

  it("reports remote-configured when backend vars are present", async () => {
    for (const name of REQUIRED_WORKER_ENV) process.env[name] = "set";
    const res = await GET();
    const body = await res.json();
    expect(body.mode).toBe("remote-configured");
    expect(body.enabled).toBe(false);
  });

  it("reports storage ready — separately from queue/processor — when S3 is configured", async () => {
    configureS3();
    const res = await GET();
    const body = await res.json();
    // Only storage is wired: it reports ready while queue/processor do not.
    expect(body.providers.storage.ready).toBe(true);
    expect(body.providers.storage.configured).toBe(true);
    expect(body.providers.storage.provider).toBe("s3");
    expect(body.providers.queue.ready).toBe(false);
    expect(body.providers.processor.ready).toBe(false);
    // Never leaks a bucket, endpoint, region, key id, secret, or variable name.
    const serialized = JSON.stringify(body);
    for (const leak of [
      "pdfxyz-prod",
      "amazonaws.com",
      "us-east-1",
      "AKIAEXAMPLE0000000",
      "s3cr3t",
      "PDFXYZ_",
    ]) {
      expect(serialized).not.toContain(leak);
    }
  });

  it("reports local-dev as enabled with real lossless when opted in", async () => {
    process.env[WORKER_MODE_ENV] = "local-dev";
    const res = await GET();
    const body = await res.json();
    expect(body.mode).toBe("local-dev");
    expect(body.enabled).toBe(true);
    expect(body.localDevOnly).toBe(true);
    expect(body.compress.lossless).toBe(true);
    // Deep reflects a real PATH probe on this host — a boolean either way.
    expect(typeof body.compress.deep).toBe("boolean");
    expect(Array.isArray(body.compress.engines)).toBe(true);
    // The local-dev worker ships no OCR processor, so OCR stays unavailable.
    expect(body.ocr.available).toBe(false);
  });
});
