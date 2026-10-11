// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ageBucket,
  buildHeartbeat,
  classifyLiveness,
  coarseRelease,
  disabledLiveness,
  freshWindowMsFor,
  parseHeartbeat,
  serializeHeartbeat,
  ttlSecondsFor,
} from "./schema";
import {
  WORKER_HEARTBEAT_SCHEMA_VERSION,
  type HeartbeatCapabilities,
} from "./types";
import { emptyCapabilities } from "./factory";

const CAPS: HeartbeatCapabilities = {
  deepCompression: true,
  ocr: false,
  ocrLanguages: [],
  malwareScan: true,
  atomicQueue: true,
  chunkedTranslate: true,
  deliveryCap: true,
  aiReadCap: true,
  pptxPresentationChain: true,
  pptxPictures: true,
};

describe("coarseRelease", () => {
  it("keeps only major.minor and drops high-cardinality build ids", () => {
    expect(coarseRelease("1.2.3")).toBe("1.2");
    expect(coarseRelease("v2.10.0-rc.1")).toBe("2.10");
    expect(coarseRelease("0.0.0-canary.abc123")).toBe("0.0");
  });

  it("drops absent or unparseable versions rather than storing junk", () => {
    expect(coarseRelease(undefined)).toBeUndefined();
    expect(coarseRelease("")).toBeUndefined();
    expect(coarseRelease("nightly")).toBeUndefined();
    expect(coarseRelease("1")).toBeUndefined(); // no minor
    expect(coarseRelease("99999.1")).toBeUndefined(); // implausible major width
  });
});

describe("buildHeartbeat / serialize / parse", () => {
  it("assembles only the bounded schema fields", () => {
    const hb = buildHeartbeat({
      mode: "loop",
      capabilities: CAPS,
      release: "3.4.5",
      at: 1000,
    });
    expect(hb).toEqual({
      v: WORKER_HEARTBEAT_SCHEMA_VERSION,
      role: "secure-worker",
      release: "3.4",
      mode: "loop",
      capabilities: CAPS,
      at: 1000,
    });
  });

  it("coerces capability fields to strict booleans and ignores extras", () => {
    const hb = buildHeartbeat({
      mode: "drain",
      // A hostile/loose capabilities object: truthy non-booleans and an injected key.
      capabilities: {
        deepCompression: 1 as unknown as boolean,
        ocr: "yes" as unknown as boolean,
        malwareScan: true,
        atomicQueue: false,
        chunkedTranslate: true,
        deliveryCap: true,
        secretEndpoint: "https://evil.example.com",
      } as unknown as HeartbeatCapabilities,
      at: 5,
    });
    expect(hb.capabilities).toEqual({
      deepCompression: false, // only literal true is true
      ocr: false,
      ocrLanguages: [],
      malwareScan: true,
      atomicQueue: false,
      chunkedTranslate: true,
      deliveryCap: true,
      aiReadCap: false,
      pptxPresentationChain: false,
      pptxPictures: false,
    });
    expect(JSON.stringify(hb)).not.toContain("evil.example.com");
    expect(JSON.stringify(hb)).not.toContain("secretEndpoint");
  });

  it("round-trips through serialize + parse", () => {
    const hb = buildHeartbeat({ mode: "once", capabilities: CAPS, at: 42 });
    const parsed = parseHeartbeat(serializeHeartbeat(hb));
    expect(parsed).toEqual(hb);
  });

  it("round-trips EVERY capability, with the key set derived from the type", () => {
    /**
     * `serializeHeartbeat` and `capabilitiesOf` are TWINS, written out field by
     * field in two places. A capability added to one and forgotten in the other
     * is dropped in flight, and the web tier then reads the default — which for
     * a boolean is `false`, so the worker looks LESS capable than it is and
     * nobody is alarmed by a capability going quiet.
     *
     * The test above cannot catch that in general. It compares one hand-built
     * fixture, so it only notices a dropped field when that fixture happens to
     * set the field to something other than its default. The next capability
     * whose fixture value is `false` would sail through.
     *
     * So the key set is DERIVED from `emptyCapabilities()` and every value is
     * flipped away from its default before the trip. A field the serializer
     * forgets comes back as the default, which is now the one value it must
     * not be.
     */
    const defaults = emptyCapabilities() as unknown as Record<string, unknown>;
    const keys = Object.keys(defaults);

    // BOUND THE CORPUS: an empty or collapsed key list would make the loop
    // below assert nothing and report the strongest possible pass.
    expect(
      keys.length,
      "the capability set is implausibly small — the corpus, not the code, is what failed",
    ).toBeGreaterThanOrEqual(7);

    const flipped = Object.fromEntries(
      keys.map((key) => [
        key,
        Array.isArray(defaults[key]) ? ["eng"] : !defaults[key],
      ]),
    ) as unknown as HeartbeatCapabilities;

    const trip = parseHeartbeat(
      serializeHeartbeat(
        buildHeartbeat({ mode: "once", capabilities: flipped, at: 42 }),
      ),
    );
    expect(trip, "the heartbeat did not parse at all").not.toBeNull();

    const got = trip!.capabilities as unknown as Record<string, unknown>;
    for (const key of keys) {
      expect(
        got[key],
        `capabilities.${key} did not survive serialize → parse. One of the two ` +
          "twins does not name it, so a worker publishing it is read as not " +
          "having it — and a capability that goes quiet raises no alarm.",
      ).toEqual((flipped as unknown as Record<string, unknown>)[key]);
    }
  });

  it("rejects records that fail the bounded schema", () => {
    expect(parseHeartbeat("not json")).toBeNull();
    expect(parseHeartbeat(null)).toBeNull();
    expect(parseHeartbeat(42)).toBeNull();
    expect(parseHeartbeat([1, 2, 3])).toBeNull();
    expect(
      parseHeartbeat({ v: 999, role: "secure-worker", mode: "loop", at: 1 }),
    ).toBeNull();
    expect(
      parseHeartbeat({ v: 1, role: "attacker", mode: "loop", at: 1 }),
    ).toBeNull();
    expect(
      parseHeartbeat({ v: 1, role: "secure-worker", mode: "rm-rf", at: 1 }),
    ).toBeNull();
    expect(
      parseHeartbeat({ v: 1, role: "secure-worker", mode: "loop", at: "soon" }),
    ).toBeNull();
    expect(
      parseHeartbeat({
        v: 1,
        role: "secure-worker",
        mode: "loop",
        at: Infinity,
      }),
    ).toBeNull();
  });

  it("drops injected/hostile fields, surviving only the known bounded schema", () => {
    const hostile = {
      v: 1,
      role: "secure-worker",
      release: "1.2.3",
      mode: "loop",
      at: 1234,
      capabilities: {
        deepCompression: true,
        ocr: false,
        malwareScan: false,
        atomicQueue: true,
        chunkedTranslate: true,
        deliveryCap: true,
        aiReadCap: true,
      },
      // Everything below is injected and must not survive.
      host: "worker-07.internal.example.com",
      pid: 4242,
      containerId: "c0ffee",
      ip: "10.0.0.5",
      port: 6379,
      path: "/var/run/worker.sock",
      redisKey: "pdfxyz:job:secret",
      objectKey: "uploads/invoice.pdf",
      token: "REDIS_SECRET_TOKEN_VALUE",
      workerId: "instance-abcdef",
    };
    const parsed = parseHeartbeat(hostile);
    expect(parsed).toEqual({
      v: 1,
      role: "secure-worker",
      release: "1.2",
      mode: "loop",
      capabilities: {
        deepCompression: true,
        ocr: false,
        ocrLanguages: [],
        malwareScan: false,
        atomicQueue: true,
        chunkedTranslate: true,
        deliveryCap: true,
        aiReadCap: true,
        pptxPresentationChain: false,
        pptxPictures: false,
      },
      at: 1234,
    });
    const json = JSON.stringify(parsed);
    for (const forbidden of [
      "worker-07",
      "internal.example.com",
      "4242",
      "c0ffee",
      "10.0.0.5",
      "6379",
      "/var/run",
      "pdfxyz:job",
      "invoice.pdf",
      "REDIS_SECRET_TOKEN_VALUE",
      "instance-abcdef",
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });
});

describe("ageBucket", () => {
  it("maps ages to coarse buckets", () => {
    expect(ageBucket(0)).toBe("under-30s");
    expect(ageBucket(29_999)).toBe("under-30s");
    expect(ageBucket(30_000)).toBe("under-2m");
    expect(ageBucket(119_999)).toBe("under-2m");
    expect(ageBucket(120_000)).toBe("under-10m");
    expect(ageBucket(599_999)).toBe("under-10m");
    expect(ageBucket(600_000)).toBe("over-10m");
    expect(ageBucket(9_999_999)).toBe("over-10m");
  });
});

describe("window derivations", () => {
  it("keeps the TTL strictly beyond the fresh window so a 'stale' band exists", () => {
    for (const interval of [5, 15, 60, 300]) {
      const freshMs = freshWindowMsFor(interval);
      const ttlMs = ttlSecondsFor(interval) * 1000;
      expect(ttlMs).toBeGreaterThan(freshMs);
    }
  });
});

describe("classifyLiveness", () => {
  const freshWindowMs = freshWindowMsFor(10); // 30s

  it("classifies a missing record as unknown (never fabricated observed)", () => {
    const live = classifyLiveness(null, {
      now: 1_000_000,
      freshWindowMs,
      source: "queue-broker",
    });
    expect(live).toMatchObject({
      state: "unknown",
      observed: false,
      source: "queue-broker",
      lastSeen: null,
      mode: null,
      capabilities: null,
    });
  });

  it("classifies a recent record as observed with a coarse bucket + passthrough fields", () => {
    const at = 1_000_000;
    const record = buildHeartbeat({ mode: "loop", capabilities: CAPS, at });
    const live = classifyLiveness(record, {
      now: at + 5_000,
      freshWindowMs,
      source: "queue-broker",
    });
    expect(live.state).toBe("observed");
    expect(live.observed).toBe(true);
    expect(live.lastSeen).toBe("under-30s");
    expect(live.mode).toBe("loop");
    expect(live.capabilities).toEqual(CAPS);
  });

  it("treats age exactly at the fresh window as observed, and just beyond as stale", () => {
    const at = 2_000_000;
    const record = buildHeartbeat({ mode: "drain", capabilities: CAPS, at });
    expect(
      classifyLiveness(record, {
        now: at + freshWindowMs,
        freshWindowMs,
        source: "queue-broker",
      }).state,
    ).toBe("observed");
    const stale = classifyLiveness(record, {
      now: at + freshWindowMs + 1,
      freshWindowMs,
      source: "queue-broker",
    });
    expect(stale.state).toBe("stale");
    expect(stale.observed).toBe(false);
    expect(stale.lastSeen).toBe("under-2m");
  });

  it("clamps a reader clock that lags the writer, staying conservative", () => {
    const at = 5_000_000;
    const record = buildHeartbeat({ mode: "loop", capabilities: CAPS, at });
    // now < at (skew): age clamps to 0 → observed, never a negative/garbage bucket.
    const live = classifyLiveness(record, {
      now: at - 10_000,
      freshWindowMs,
      source: "queue-broker",
    });
    expect(live.state).toBe("observed");
    expect(live.lastSeen).toBe("under-30s");
  });
});

describe("disabledLiveness", () => {
  it("is a neutral, non-observed default", () => {
    expect(disabledLiveness()).toMatchObject({
      state: "disabled",
      observed: false,
      source: "none",
      lastSeen: null,
      mode: null,
      capabilities: null,
    });
    expect(disabledLiveness("queue-broker").source).toBe("queue-broker");
  });
});
