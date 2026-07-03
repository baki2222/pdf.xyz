// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { LIFECYCLE_ENV } from "@/lib/workers/lifecycle";
import {
  buildHeartbeat,
  serializeHeartbeat,
  type WorkerHeartbeat,
} from "@/lib/workers/heartbeat";
import type { WorkerOperationsSnapshot } from "@/lib/workers/observability";
import { GET } from "./route";

async function json(res: Response): Promise<unknown> {
  return res.json();
}

describe("GET /api/worker/operations", () => {
  it("returns a content-free web-vantage operations snapshot in no-config mode", async () => {
    const body = await json(await GET());
    expect(body).toMatchObject({
      version: 1,
      vantage: "web",
      daemonObserved: false,
      drainable: false,
      recommendedAction: "configure-providers",
    });
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/\/tmp|s3:\/\/|https?:\/\/|SECRET|object-key|invoice\.pdf|OCRPROOF/i);
  });

  it("does not imply an out-of-band daemon is deployed even when providers are configured", async () => {
    const old = { ...process.env };
    try {
      process.env.PDFXYZ_STORAGE_PROVIDER = "s3";
      process.env.PDFXYZ_S3_ENDPOINT = "https://s3.example.com";
      process.env.PDFXYZ_S3_REGION = "auto";
      process.env.PDFXYZ_S3_BUCKET = "private-bucket";
      process.env.PDFXYZ_S3_ACCESS_KEY_ID = "AKIAEXAMPLE123";
      process.env.PDFXYZ_S3_SECRET_ACCESS_KEY = "secret-value";
      process.env.PDFXYZ_QUEUE_PROVIDER = "redis";
      process.env.PDFXYZ_REDIS_REST_URL = "https://redis.example.com";
      process.env.PDFXYZ_REDIS_REST_TOKEN = "redis-secret";

      const body = await json(await GET());
      expect(body).toMatchObject({
        vantage: "web",
        daemonObserved: false,
        drainable: true,
        recommendedAction: "declare-lifecycle",
      });
      expect(JSON.stringify(body)).not.toMatch(/private-bucket|redis\.example|secret-value|redis-secret/);
    } finally {
      process.env = old;
    }
  });
});

describe("GET /api/worker/operations — daemon liveness heartbeat (Phase 30)", () => {
  const OLD_ENV = { ...process.env };
  const OLD_FETCH = globalThis.fetch;

  afterEach(() => {
    process.env = { ...OLD_ENV };
    globalThis.fetch = OLD_FETCH;
  });

  /** A fully-green, heartbeat-enabled env so the verdict reaches the liveness residual. */
  const GREEN_HEARTBEAT_ENV: Record<string, string> = {
    PDFXYZ_STORAGE_PROVIDER: "s3",
    PDFXYZ_S3_ENDPOINT: "https://s3.example.com",
    PDFXYZ_S3_REGION: "auto",
    PDFXYZ_S3_BUCKET: "private-bucket",
    PDFXYZ_S3_ACCESS_KEY_ID: "AKIAEXAMPLE123",
    PDFXYZ_S3_SECRET_ACCESS_KEY: "secret-value",
    PDFXYZ_QUEUE_PROVIDER: "redis",
    PDFXYZ_REDIS_REST_URL: "https://redis.example.com",
    PDFXYZ_REDIS_REST_TOKEN: "redis-secret",
    [LIFECYCLE_ENV.provider]: "aws-s3",
    [LIFECYCLE_ENV.validated]: "true",
    PDFXYZ_WORKER_HEARTBEAT: "enabled",
  };

  /** Stub the broker GET so the route's heartbeat read resolves to `record` (or null). */
  function stubBrokerHeartbeat(record: WorkerHeartbeat | null): void {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      async json() {
        return { result: record ? serializeHeartbeat(record) : null };
      },
    })) as unknown as typeof fetch;
  }

  it("marks daemonObserved true when a fresh heartbeat is visible, staying content-free", async () => {
    Object.assign(process.env, GREEN_HEARTBEAT_ENV);
    stubBrokerHeartbeat(
      buildHeartbeat({
        mode: "loop",
        capabilities: { deepCompression: true, ocr: false, malwareScan: false, atomicQueue: true },
        at: Date.now(),
      }),
    );
    const body = (await json(await GET())) as WorkerOperationsSnapshot;
    expect(body.daemonObserved).toBe(true);
    expect(body.daemon.state).toBe("observed");
    expect(body.daemon.source).toBe("queue-broker");
    expect(body.recommendedAction).toBe("none");
    // The broker endpoint/token/bucket never reach the body.
    expect(JSON.stringify(body)).not.toMatch(
      /redis\.example|redis-secret|private-bucket|secret-value/,
    );
  });

  it("classifies a stale heartbeat as a warning, never observed", async () => {
    Object.assign(process.env, GREEN_HEARTBEAT_ENV);
    stubBrokerHeartbeat(
      buildHeartbeat({
        mode: "loop",
        capabilities: { deepCompression: false, ocr: false, malwareScan: false, atomicQueue: true },
        at: Date.now() - 10 * 60 * 1000, // 10 minutes old ⇒ far past the fresh window
      }),
    );
    const body = (await json(await GET())) as WorkerOperationsSnapshot;
    expect(body.daemonObserved).toBe(false);
    expect(body.daemon.state).toBe("stale");
    expect(body.recommendedAction).toBe("investigate-worker-liveness");
  });

  it("classifies an absent heartbeat as unknown (a warning), not observed", async () => {
    Object.assign(process.env, GREEN_HEARTBEAT_ENV);
    stubBrokerHeartbeat(null);
    const body = (await json(await GET())) as WorkerOperationsSnapshot;
    expect(body.daemonObserved).toBe(false);
    expect(body.daemon.state).toBe("unknown");
    expect(body.recommendedAction).toBe("investigate-worker-liveness");
  });

  it("does not touch the network when the heartbeat feature is not enabled", async () => {
    Object.assign(process.env, { ...GREEN_HEARTBEAT_ENV, PDFXYZ_WORKER_HEARTBEAT: "" });
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      throw new Error("the disabled reader must not fetch");
    }) as unknown as typeof fetch;
    const body = (await json(await GET())) as WorkerOperationsSnapshot;
    expect(fetched).toBe(false);
    expect(body.daemonObserved).toBe(false);
    expect(body.daemon.state).toBe("disabled");
  });
});
