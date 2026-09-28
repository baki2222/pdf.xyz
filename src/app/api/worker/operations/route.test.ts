// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LIFECYCLE_ENV } from "@/lib/workers/lifecycle";
import {
  buildHeartbeat,
  serializeHeartbeat,
  type WorkerHeartbeat,
} from "@/lib/workers/heartbeat";
import type { WorkerOperationsSnapshot } from "@/lib/workers/observability";
import { ADVERTISED_WORKER_CAPABILITIES } from "@/lib/workers/observability";
import type { HeartbeatCapabilities } from "@/lib/workers/heartbeat";
import { RATE_LIMIT_ENV, policyFor } from "@/lib/ratelimit";
import { RATE_LIMIT_REDIS_ENV } from "@/lib/ratelimit/redis-config";
import {
  enforceRateLimit,
  resetRateLimitGuardForTests,
  resetSelfBuiltProviderForTests,
  writeSpendProbe,
} from "@/lib/ratelimit/guard";
import { GET } from "./route";

async function json(res: Response): Promise<unknown> {
  return res.json();
}

/** Next always passes the request to a route handler; unit calls supply a bare one. */
function opsReq(): Request {
  return new Request("http://localhost/api/worker/operations");
}

/**
 * A worker that proves EVERY advertised capability — the "healthy image" these
 * fixtures mean when they say a fresh beat should read `ok`.
 *
 * Derived from the corpus, not written out. Written out, these fixtures said
 * `ocr: false, ocrLanguages: [], malwareScan: false` and still asserted an `ok`
 * posture, because until 2026-08-22 the subsystem only asked about
 * `chunkedTranslate` and `deliveryCap`. The fixture and the guard agreed with
 * each other and both were wrong about the same five capabilities.
 */
function provingCapabilities(): HeartbeatCapabilities {
  return Object.fromEntries(
    ADVERTISED_WORKER_CAPABILITIES.map((capability) => [
      capability.key,
      capability.key === "ocrLanguages" ? ["eng"] : true,
    ]),
  ) as unknown as HeartbeatCapabilities;
}

describe("GET /api/worker/operations", () => {
  it("returns a content-free web-vantage operations snapshot in no-config mode", async () => {
    const body = await json(await GET(opsReq()));
    expect(body).toMatchObject({
      version: 2,
      vantage: "web",
      daemonObserved: false,
      drainable: false,
      recommendedAction: "configure-providers",
    });
    const text = JSON.stringify(body);
    expect(text).not.toMatch(
      /\/tmp|s3:\/\/|https?:\/\/|SECRET|object-key|invoice\.pdf|OCRPROOF/i,
    );
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
      expect(JSON.stringify(body)).not.toMatch(
        /private-bucket|redis\.example|secret-value|redis-secret/,
      );
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
  /**
   * A stack with everything wired — INCLUDING a limiter, since the AI spend
   * ceiling became its own subsystem. "Green" now means total AI cost is
   * demonstrably bounded too, so a fixture that omitted the limiter would be
   * asserting an ok posture over a genuinely unbounded one.
   *
   * `local-memory` rather than the remote limiter on purpose: it needs no
   * `fetch`, so it cannot collide with the broker stub these tests install.
   */
  const GREEN_HEARTBEAT_ENV: Record<string, string> = {
    PDFXYZ_RATE_LIMIT_PROVIDER: "local-memory",
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
    // The worker's half of the two-tier proof; without it the spend ceiling
    // honestly reports `tiers-unproven` and the action stops being `none`.
    await writeSpendProbe(process.env);
    stubBrokerHeartbeat(
      buildHeartbeat({
        mode: "loop",
        capabilities: provingCapabilities(),
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
        capabilities: {
          deepCompression: false,
          ocr: false,
          ocrLanguages: [],
          malwareScan: false,
          atomicQueue: true,
          chunkedTranslate: true,
          deliveryCap: true,
          aiReadCap: true,
        },
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
    Object.assign(process.env, {
      ...GREEN_HEARTBEAT_ENV,
      PDFXYZ_WORKER_HEARTBEAT: "",
    });
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
    const body = (await json(await GET(opsReq()))) as {
      alerts?: Record<string, unknown>;
    };
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
    const body = (await json(await GET(opsReq()))) as {
      alerts?: { severity?: string };
    };
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
        // See GREEN_HEARTBEAT_ENV: an ok posture now requires a bounded, and
        // demonstrably shared, AI spend ceiling.
        PDFXYZ_RATE_LIMIT_PROVIDER: "local-memory",
      });
      // Stand in for the worker: without a probe write the web tier honestly
      // reports that the two tiers cannot be shown to share one budget, which
      // is a warn — and correctly so.
      await writeSpendProbe(process.env);
      globalThis.fetch = (async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            result: serializeHeartbeat(
              buildHeartbeat({
                mode: "loop",
                capabilities: provingCapabilities(),
                at: Date.now(),
              }),
            ),
          };
        },
      })) as unknown as typeof fetch;
      const body = (await json(await GET(opsReq()))) as {
        alerts?: { severity?: string };
      };
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
    delete process.env[RATE_LIMIT_ENV.clientIpHeader];
  });

  it("still serves the content-free snapshot when a request is passed, without exposing identity", async () => {
    process.env[RATE_LIMIT_ENV.trustForwardedFor] = "on";
    process.env[RATE_LIMIT_ENV.clientIpHeader] = "cf-connecting-ip";
    const res = await GET(
      new Request("http://localhost/api/worker/operations", {
        headers: { "cf-connecting-ip": "203.0.113.88" },
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
    for (let i = 0; i < policy.limit; i++)
      await enforceRateLimit("worker.operations", bare);

    const denied = await GET(bare);
    expect(denied.status).toBe(429);
    expect((await denied.json()).error.code).toBe("rate_limited");
    expect(Number(denied.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("GET /api/worker/operations — the rate-limit posture reaches the alert report", () => {
  const OLD_ENV = { ...process.env };
  const OLD_FETCH = globalThis.fetch;

  /**
   * A fully-green stack WITHOUT the heartbeat feature, so no non-rate-limit code path
   * touches `fetch` and every non-rate-limit subsystem is quiet. Any warn the alert
   * report carries in these cases can therefore come only from the abuse guard.
   */
  const GREEN_ENV: Record<string, string> = {
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
  };

  /**
   * A deployment enforcing PER CLIENT — a store AND trusted identity. The trust
   * flag was missing here (and in two other fixtures that carried this same
   * comment word for word) while all three called themselves "correctly
   * configured": the same incomplete definition production had.
   */
  const LIMITER_ENV: Record<string, string> = {
    [RATE_LIMIT_ENV.provider]: "redis",
    [RATE_LIMIT_REDIS_ENV.restUrl]: "https://example-store.upstash.io",
    [RATE_LIMIT_REDIS_ENV.restToken]: "A".repeat(48),
    [RATE_LIMIT_ENV.trustForwardedFor]: "true",
    [RATE_LIMIT_ENV.clientIpHeader]: "cf-connecting-ip",
    [RATE_LIMIT_ENV.keySalt]: "test-shared-salt",
  };

  type AlertEntry = {
    source?: string;
    severity?: string;
    reason?: string;
    action?: string;
  };
  type OpsBody = {
    rateLimit?: { code?: string; enforced?: boolean };
    alerts?: { severity?: string; alerts?: AlertEntry[] };
  };

  beforeEach(() => {
    resetRateLimitGuardForTests();
    resetSelfBuiltProviderForTests();
  });
  afterEach(() => {
    process.env = { ...OLD_ENV };
    globalThis.fetch = OLD_FETCH;
    resetRateLimitGuardForTests();
    resetSelfBuiltProviderForTests();
  });

  it("a configured store failing OPEN raises a warn alert, not just a raw field", async () => {
    Object.assign(process.env, GREEN_ENV, LIMITER_ENV);
    // The store is configured and unreachable: every transport call fails, so the
    // guard fails open. Nothing else in this env fetches (heartbeat is off).
    globalThis.fetch = (async () => {
      throw new Error("store unreachable");
    }) as unknown as typeof fetch;

    const body = (await json(await GET(opsReq()))) as OpsBody;

    // The raw posture (published since #54) tells the truth…
    expect(body.rateLimit?.code).toBe("remote-error-fail-open");
    expect(body.rateLimit?.enforced).toBe(false);
    // …and the ALERT REPORT — what the dashboard renders and what a monitor keyed on
    // `alerts` (or the ops-check exit code) actually reads — must now say it too.
    expect(body.alerts?.severity).toBe("warn");
    expect(body.alerts?.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "rate-limit",
          severity: "warn",
          reason: "rate-limit-fail-open",
        }),
      ]),
    );
    // The store endpoint and token never reach the body.
    expect(JSON.stringify(body)).not.toMatch(/example-store\.upstash\.io|AAAA/);
  });

  it("a selected provider with an incomplete store config raises the misconfigured alert", async () => {
    Object.assign(process.env, GREEN_ENV, {
      [RATE_LIMIT_ENV.provider]: "redis", // …but no store URL/token: nothing enforces
    });

    const body = (await json(await GET(opsReq()))) as OpsBody;

    expect(body.rateLimit?.code).toBe("remote-missing-config");
    expect(body.alerts?.severity).toBe("warn");
    expect(body.alerts?.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "rate-limit",
          severity: "warn",
          reason: "rate-limit-misconfigured",
        }),
      ]),
    );
  });

  it("an enforcing distributed limiter stays quiet", async () => {
    Object.assign(process.env, GREEN_ENV, LIMITER_ENV);
    // A healthy store: the atomic fixed-window EVAL returns { count, pttlMs }.
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      async json() {
        return { result: [1, 60_000] };
      },
    })) as unknown as typeof fetch;

    const body = (await json(await GET(opsReq()))) as OpsBody;

    expect(body.rateLimit?.code).toBe("remote-configured");
    expect(body.rateLimit?.enforced).toBe(true);
    expect(body.alerts?.severity).toBe("ok");
    expect(body.alerts?.alerts ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "rate-limit" }),
      ]),
    );
  });

  it("the deliberate off-state (the default) stays quiet — on the RATE-LIMIT row", async () => {
    // AMENDED when the AI spend ceiling got its own posture, and the amendment
    // is the interesting part. This used to assert a globally-`ok` severity,
    // which conflated two claims: "the abuse guard is quiet when off by choice"
    // (still true, and what this test is for) and "nothing else warns" (never
    // what it meant).
    //
    // A deployment with no limiter selected now also reports `ai-spend:
    // unenforced`, because total AI cost is genuinely unbounded there and the
    // ceiling cannot tell "off by choice" apart from "this tier lost its
    // limiter while the other kept one" — production's exact bug, mirrored. The
    // narrowed assertions below pin the property this test actually owns.
    Object.assign(process.env, GREEN_ENV); // no rate-limit provider selected

    const body = (await json(await GET(opsReq()))) as OpsBody;

    expect(body.rateLimit?.code).toBe("disabled");
    expect(body.alerts?.alerts ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "rate-limit" }),
      ]),
    );
    // The abuse guard contributes no alert; the spend ceiling is a separate
    // subsystem answering a separate question, and it is allowed to speak.
    const sources = (body.alerts?.alerts ?? []).map((a) => a.source);
    expect(sources).not.toContain("rate-limit");
  });
});
