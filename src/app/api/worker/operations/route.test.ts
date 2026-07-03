// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LIFECYCLE_ENV } from "@/lib/workers/lifecycle";
import {
  buildHeartbeat,
  serializeHeartbeat,
  type WorkerHeartbeat,
} from "@/lib/workers/heartbeat";
import type { WorkerOperationsSnapshot } from "@/lib/workers/observability";
import { RATE_LIMIT_ENV, policyFor } from "@/lib/ratelimit";
import { enforceRateLimit, resetRateLimitGuardForTests } from "@/lib/ratelimit/guard";
import { GET } from "./route";

async function json(res: Response): Promise<unknown> {
  return res.json();
}

/** Next always passes the request to a route handler; unit calls supply a bare one. */
function opsReq(): Request {
  return new Request("http://localhost/api/worker/operations");
}

describe("GET /api/worker/operations", () => {
  it("returns a content-free web-vantage operations snapshot in no-config mode", async () => {
    const body = await json(await GET(opsReq()));
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

      const body = await json(await GET(opsReq()));
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
    const body = (await json(await GET(opsReq()))) as WorkerOperationsSnapshot;
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
    const body = (await json(await GET(opsReq()))) as WorkerOperationsSnapshot;
    expect(body.daemonObserved).toBe(false);
    expect(body.daemon.state).toBe("stale");
    expect(body.recommendedAction).toBe("investigate-worker-liveness");
  });

  it("classifies an absent heartbeat as unknown (a warning), not observed", async () => {
    Object.assign(process.env, GREEN_HEARTBEAT_ENV);
    stubBrokerHeartbeat(null);
    const body = (await json(await GET(opsReq()))) as WorkerOperationsSnapshot;
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
    const body = (await json(await GET(opsReq()))) as WorkerOperationsSnapshot;
    expect(fetched).toBe(false);
    expect(body.daemonObserved).toBe(false);
    expect(body.daemon.state).toBe("disabled");
  });
});

describe("GET /api/worker/operations — attached alert posture (Phase 31)", () => {
  const ALERT_SEVERITIES = ["ok", "warn", "critical", "unknown"];

  it("attaches a content-free alert report keyed on a bounded severity", async () => {
    const body = (await json(await GET(opsReq()))) as { alerts?: Record<string, unknown> };
    expect(body.alerts).toBeDefined();
    const report = body.alerts!;
    expect(ALERT_SEVERITIES).toContain(report.severity);
    expect(Array.isArray(report.alerts)).toBe(true);
    // Every contributing alert carries only bounded enums for source/severity/reason.
    for (const alert of report.alerts as Array<Record<string, unknown>>) {
      expect(ALERT_SEVERITIES).toContain(alert.severity);
      expect(typeof alert.reason).toBe("string");
      expect(typeof alert.source).toBe("string");
    }
  });

  it("the no-config posture is critical (no worker can run) and leaks nothing", async () => {
    const body = (await json(await GET(opsReq()))) as { alerts?: { severity?: string } };
    // No queue/storage in the base env ⇒ not drainable ⇒ a monitor would page.
    expect(body.alerts?.severity).toBe("critical");
    const text = JSON.stringify(body);
    expect(text).not.toMatch(
      /\/tmp|s3:\/\/|https?:\/\/|SECRET|object-key|invoice\.pdf|OCRPROOF/i,
    );
  });

  it("a configured, heartbeat-enabled stack with a fresh beat reports an ok posture", async () => {
    const old = { ...process.env };
    const oldFetch = globalThis.fetch;
    try {
      Object.assign(process.env, {
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
      });
      globalThis.fetch = (async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            result: serializeHeartbeat(
              buildHeartbeat({
                mode: "loop",
                capabilities: {
                  deepCompression: true,
                  ocr: false,
                  malwareScan: false,
                  atomicQueue: true,
                },
                at: Date.now(),
              }),
            ),
          };
        },
      })) as unknown as typeof fetch;
      const body = (await json(await GET(opsReq()))) as { alerts?: { severity?: string } };
      expect(body.alerts?.severity).toBe("ok");
    } finally {
      process.env = old;
      globalThis.fetch = oldFetch;
    }
  });
});

describe("GET /api/worker/operations — abuse guard", () => {
  beforeEach(() => {
    resetRateLimitGuardForTests();
    process.env[RATE_LIMIT_ENV.provider] = "local-memory";
  });
  afterEach(() => {
    resetRateLimitGuardForTests();
    delete process.env[RATE_LIMIT_ENV.provider];
    delete process.env[RATE_LIMIT_ENV.trustForwardedFor];
  });

  it("still serves the content-free snapshot when a request is passed, without exposing identity", async () => {
    process.env[RATE_LIMIT_ENV.trustForwardedFor] = "on";
    const res = await GET(
      new Request("http://localhost/api/worker/operations", {
        headers: { "x-forwarded-for": "203.0.113.88" },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as WorkerOperationsSnapshot;
    // The ops snapshot is unchanged (still web-vantage) and never carries the caller.
    expect(body.vantage).toBe("web");
    expect(JSON.stringify(body)).not.toContain("203.0.113.88");
  });

  it("returns a lightweight 429 (no snapshot work) once the scrape budget is spent", async () => {
    const policy = policyFor("worker.operations");
    const bare = new Request("http://localhost/api/worker/operations");
    for (let i = 0; i < policy.limit; i++) await enforceRateLimit("worker.operations", bare);

    const denied = await GET(bare);
    expect(denied.status).toBe(429);
    expect((await denied.json()).error.code).toBe("rate_limited");
    expect(Number(denied.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
