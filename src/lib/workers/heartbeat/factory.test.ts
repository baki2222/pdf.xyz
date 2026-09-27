// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createFakeRedis } from "../queue/redis-fake";
import {
  createHeartbeatPublisher,
  createHeartbeatReader,
  emptyCapabilities,
  isHeartbeatEnabled,
  readWorkerHeartbeatLiveness,
  resolveHeartbeat,
  resolveHeartbeatIntervalSeconds,
} from "./factory";
import { buildHeartbeat, serializeHeartbeat } from "./schema";
import { heartbeatKey } from "./redis";

const REDIS_ENV = {
  PDFXYZ_QUEUE_PROVIDER: "redis",
  PDFXYZ_REDIS_REST_URL: "https://redis.example.com",
  PDFXYZ_REDIS_REST_TOKEN: "redis-rest-token-1234",
} as const;

const ENABLED_ENV = {
  ...REDIS_ENV,
  PDFXYZ_WORKER_HEARTBEAT: "enabled",
} as const;

describe("isHeartbeatEnabled", () => {
  it("recognizes the truthy activation values only", () => {
    for (const v of ["1", "true", "yes", "on", "enabled", "ENABLED", "On"]) {
      expect(isHeartbeatEnabled({ PDFXYZ_WORKER_HEARTBEAT: v })).toBe(true);
    }
    for (const v of [
      "",
      "0",
      "false",
      "off",
      "no",
      undefined as unknown as string,
    ]) {
      expect(isHeartbeatEnabled({ PDFXYZ_WORKER_HEARTBEAT: v })).toBe(false);
    }
  });
});

describe("resolveHeartbeatIntervalSeconds", () => {
  it("defaults when unset and honors a bounded value", () => {
    expect(resolveHeartbeatIntervalSeconds({}).intervalSeconds).toBe(15);
    expect(
      resolveHeartbeatIntervalSeconds({
        PDFXYZ_WORKER_HEARTBEAT_INTERVAL_SECONDS: "30",
      }).intervalSeconds,
    ).toBe(30);
  });

  it("falls back to the default and reports a malformed value by name only", () => {
    const bad = resolveHeartbeatIntervalSeconds({
      PDFXYZ_WORKER_HEARTBEAT_INTERVAL_SECONDS: "abc",
    });
    expect(bad.intervalSeconds).toBe(15);
    expect(bad.issue?.field).toBe("PDFXYZ_WORKER_HEARTBEAT_INTERVAL_SECONDS");
    const tooBig = resolveHeartbeatIntervalSeconds({
      PDFXYZ_WORKER_HEARTBEAT_INTERVAL_SECONDS: "99999",
    });
    expect(tooBig.intervalSeconds).toBe(15);
    expect(tooBig.issue).toBeDefined();
  });
});

describe("resolveHeartbeat — double gate", () => {
  it("is disabled when the flag is off, even with a configured broker", () => {
    const r = resolveHeartbeat(REDIS_ENV);
    expect(r.enabled).toBe(false);
    expect(r.source).toBe("none");
    expect(r.redis).not.toBeNull(); // the broker parsed, but the feature is off
  });

  it("is disabled when enabled but no compatible backend is configured", () => {
    const r = resolveHeartbeat({ PDFXYZ_WORKER_HEARTBEAT: "enabled" });
    expect(r.enabled).toBe(false);
    expect(r.source).toBe("none");
    expect(r.redis).toBeNull();
  });

  it("is enabled only when the flag is on AND a broker is configured", () => {
    const r = resolveHeartbeat(ENABLED_ENV);
    expect(r.enabled).toBe(true);
    expect(r.source).toBe("queue-broker");
    expect(r.redis).not.toBeNull();
  });
});

describe("createHeartbeatPublisher", () => {
  it("returns a disabled no-op publisher when not enabled (no network)", async () => {
    const publisher = createHeartbeatPublisher(REDIS_ENV, {
      mode: "loop",
      capabilities: emptyCapabilities(),
    });
    expect(publisher.capability.enabled).toBe(false);
    expect(await publisher.beat()).toEqual({
      published: false,
      reason: "disabled",
    });
  });

  it("returns a real publisher when enabled + configured", async () => {
    const fake = createFakeRedis();
    const publisher = createHeartbeatPublisher(ENABLED_ENV, {
      mode: "loop",
      capabilities: {
        deepCompression: true,
        ocr: true,
        ocrLanguages: [],
        malwareScan: false,
        atomicQueue: true,
        chunkedTranslate: true,
        deliveryCap: true,
        pptxPresentationChain: true,
      },
      deps: { client: fake, now: () => 1_000 },
    });
    expect(publisher.capability.enabled).toBe(true);
    expect(publisher.capability.source).toBe("queue-broker");
    expect((await publisher.beat()).published).toBe(true);
    expect(fake.keys()).toContain(heartbeatKey("pdfxyz"));
  });
});

describe("createHeartbeatReader / readWorkerHeartbeatLiveness", () => {
  it("returns a disabled reader (neutral liveness, no network) when not enabled", async () => {
    const reader = createHeartbeatReader(REDIS_ENV);
    expect(reader.capability.enabled).toBe(false);
    const live = await reader.read();
    expect(live.state).toBe("disabled");
    expect(live.observed).toBe(false);
  });

  it("reads a fresh heartbeat as observed when enabled + configured", async () => {
    const fake = createFakeRedis();
    // Seed the fake with a fresh record at the reader's clock time.
    const now = 2_000_000;
    await fake.command([
      "SET",
      heartbeatKey("pdfxyz"),
      serializeHeartbeat(
        buildHeartbeat({
          mode: "drain",
          capabilities: {
            deepCompression: false,
            ocr: false,
            ocrLanguages: [],
            malwareScan: false,
            atomicQueue: true,
            chunkedTranslate: true,
            deliveryCap: true,
            pptxPresentationChain: true,
          },
          at: now,
        }),
      ),
    ]);
    const live = await readWorkerHeartbeatLiveness(ENABLED_ENV, {
      client: fake,
      now: () => now + 3_000,
    });
    expect(live.state).toBe("observed");
    expect(live.observed).toBe(true);
    expect(live.mode).toBe("drain");
  });
});
