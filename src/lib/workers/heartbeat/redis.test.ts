// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createFakeRedis } from "../queue/redis-fake";
import type { RedisQueueConfig } from "../queue/redis-config";
import {
  createRedisHeartbeatPublisher,
  createRedisHeartbeatReader,
  heartbeatKey,
} from "./redis";
import { parseHeartbeat, ttlSecondsFor } from "./schema";
import type { HeartbeatCapabilities } from "./types";

const CONFIG: RedisQueueConfig = {
  baseUrl: "https://redis.example.com",
  token: "REDIS_SECRET_TOKEN_VALUE",
  keyPrefix: "pdfxyz",
  leaseCeilingMs: 300_000,
  maxAttempts: 5,
  jobTtlSeconds: 86_400,
};

const CAPS: HeartbeatCapabilities = {
  deepCompression: true,
  ocr: false,
  malwareScan: true,
  atomicQueue: true,
};

/** A mutable fake clock. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const INTERVAL = 10; // seconds → fresh window 30s, TTL 80s

describe("createRedisHeartbeatPublisher", () => {
  it("writes a single content-free heartbeat key with a TTL", async () => {
    const fake = createFakeRedis();
    const c = clock();
    const publisher = createRedisHeartbeatPublisher(
      CONFIG,
      INTERVAL,
      { mode: "loop", capabilities: CAPS, release: "1.2.3" },
      { client: fake, now: c.now },
    );

    const res = await publisher.beat();
    expect(res).toEqual({ published: true, reason: "published" });

    // Exactly one liveness key, namespaced under the queue prefix, no worker id.
    expect(fake.keys()).toEqual(["pdfxyz:heartbeat:secure-worker"]);
    expect(heartbeatKey(CONFIG.keyPrefix)).toBe("pdfxyz:heartbeat:secure-worker");

    // The write is a SET … EX <ttl> with the exact TTL derived from the interval.
    const set = fake.calls.find((cmd) => cmd[0] === "SET");
    expect(set).toBeDefined();
    expect(set?.[1]).toBe("pdfxyz:heartbeat:secure-worker");
    expect(set?.[3]).toBe("EX");
    expect(set?.[4]).toBe(String(ttlSecondsFor(INTERVAL)));

    // The stored value parses back to a valid, bounded heartbeat.
    const stored = parseHeartbeat(set?.[2]);
    expect(stored).toMatchObject({ v: 1, role: "secure-worker", mode: "loop", release: "1.2", capabilities: CAPS });

    // Nothing content-bearing leaks into the stored value: no token, endpoint, or id.
    const value = set?.[2] ?? "";
    for (const forbidden of ["REDIS_SECRET_TOKEN_VALUE", "redis.example.com", "https://", "1.2.3"]) {
      expect(value).not.toContain(forbidden);
    }
  });

  it("throttles to at most one write per interval, then beats again after it elapses", async () => {
    const fake = createFakeRedis();
    const c = clock();
    const publisher = createRedisHeartbeatPublisher(
      CONFIG,
      INTERVAL,
      { mode: "loop", capabilities: CAPS },
      { client: fake, now: c.now },
    );

    expect((await publisher.beat()).reason).toBe("published");
    c.advance(INTERVAL * 1000 - 1); // still within the interval
    expect((await publisher.beat()).reason).toBe("throttled");
    c.advance(1); // now the interval has elapsed
    expect((await publisher.beat()).reason).toBe("published");

    const sets = fake.calls.filter((cmd) => cmd[0] === "SET");
    expect(sets).toHaveLength(2);
  });

  it("tolerates a broker outage without throwing, reporting unavailable", async () => {
    const fake = createFakeRedis();
    fake.failing = true;
    const c = clock();
    const publisher = createRedisHeartbeatPublisher(
      CONFIG,
      INTERVAL,
      { mode: "drain", capabilities: CAPS },
      { client: fake, now: c.now },
    );
    const res = await publisher.beat();
    expect(res).toEqual({ published: false, reason: "unavailable" });
  });
});

describe("createRedisHeartbeatReader", () => {
  it("reads a freshly published heartbeat as observed", async () => {
    const fake = createFakeRedis();
    const c = clock();
    const publisher = createRedisHeartbeatPublisher(
      CONFIG,
      INTERVAL,
      { mode: "loop", capabilities: CAPS },
      { client: fake, now: c.now },
    );
    const reader = createRedisHeartbeatReader(CONFIG, INTERVAL, { client: fake, now: c.now });

    await publisher.beat();
    const live = await reader.read();
    expect(live.state).toBe("observed");
    expect(live.observed).toBe(true);
    expect(live.source).toBe("queue-broker");
    expect(live.mode).toBe("loop");
    expect(live.capabilities).toEqual(CAPS);
    expect(live.lastSeen).toBe("under-30s");
  });

  it("reads an aged heartbeat as stale once past the fresh window", async () => {
    const fake = createFakeRedis();
    const c = clock();
    const publisher = createRedisHeartbeatPublisher(
      CONFIG,
      INTERVAL,
      { mode: "loop", capabilities: CAPS },
      { client: fake, now: c.now },
    );
    const reader = createRedisHeartbeatReader(CONFIG, INTERVAL, { client: fake, now: c.now });

    await publisher.beat();
    c.advance(45_000); // > 30s fresh window (but the fake does not enforce the TTL)
    const live = await reader.read();
    expect(live.state).toBe("stale");
    expect(live.observed).toBe(false);
    expect(live.lastSeen).toBe("under-2m");
  });

  it("classifies a missing key (e.g. swept by TTL) as unknown", async () => {
    const fake = createFakeRedis();
    const reader = createRedisHeartbeatReader(CONFIG, INTERVAL, { client: fake, now: () => 5 });
    const live = await reader.read();
    expect(live.state).toBe("unknown");
    expect(live.observed).toBe(false);
    expect(live.lastSeen).toBeNull();
  });

  it("classifies a broker outage as unknown without throwing", async () => {
    const fake = createFakeRedis();
    fake.failing = true;
    const reader = createRedisHeartbeatReader(CONFIG, INTERVAL, { client: fake, now: () => 5 });
    const live = await reader.read();
    expect(live.state).toBe("unknown");
  });
});
