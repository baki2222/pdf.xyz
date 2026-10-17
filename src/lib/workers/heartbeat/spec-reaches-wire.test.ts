// @vitest-environment node
/**
 * Every field the daemon supplies reaches the wire.
 *
 * ── THE FAILURE THIS EXISTS FOR ─────────────────────────────────────────────
 *
 * The build fingerprint shipped INERT. Measured on the running container:
 *
 * ```
 *   computeBuildFingerprint()   -> "9a5db1338ee3"     the value exists
 *   worker-daemon.ts:151        passes it             the daemon supplies it
 *   heartbeat/factory.ts        grep -c fingerprint -> 0     DROPPED HERE
 *   live heartbeat keys         v, role, release, mode, capabilities, at
 *   posture                     no build note at all
 * ```
 *
 * It computed, it was passed, and three separate hand-copies in a row —
 * `createHeartbeatPublisher`, `createRedisHeartbeatPublisher`, and
 * `buildHeartbeat` — each forwarded the fields they had been told about and
 * silently dropped the one they had not. The operator surface then said
 * nothing, which reads as "fine" rather than "this bound is not in force".
 *
 * ── WHY THE EXISTING GUARD DID NOT SEE IT ───────────────────────────────────
 *
 * `schema.test.ts` pins `serializeHeartbeat` ↔ `parseHeartbeat` over a DERIVED
 * key set, and both of those carry the field correctly. **The chain is four
 * hops and that guard covers the last one.** Verify the chain, not the units —
 * with the chain longer than the guard.
 *
 * It is also the adjacent-measurement shape: the seam that was easy to guard
 * sat next to the property, and guarding it got read as covering the property.
 * The property is not "the twins agree", it is *"a field the daemon supplies is
 * on the record a reader gets"*.
 *
 * ── AND TYPESCRIPT COULD NOT SEE IT EITHER ──────────────────────────────────
 *
 * Excess-property checking does NOT fire on spread properties. Written as
 * `publisher({ mode, fingerprint })` the daemon would not have compiled;
 * written as `publisher({ mode, ...(x !== undefined ? { fingerprint: x } : {}) })`
 * it compiles clean against a type that has no such field. That conditional
 * spread is the idiom this codebase uses for every optional field, so the type
 * system is structurally blind here and a runtime check is the only one left.
 *
 * ── THE SET IS DERIVED FROM A VALUE, NOT LISTED ─────────────────────────────
 *
 * A hand-listed set of fields would drift exactly as the three hand-copies did.
 * The spec below is built once, and the assertion walks ITS OWN keys — so a
 * field added to `HeartbeatPublishSpec` is covered the moment a daemon supplies
 * it, without anyone editing this file.
 */
import { describe, expect, it } from "vitest";
import {
  createHeartbeatPublisher,
  emptyCapabilities,
  WORKER_HEARTBEAT_ENV,
} from "./factory";
import { parseHeartbeat } from "./schema";
import type { RedisClient } from "../queue/redis-client";

/** A publish spec with every field set to something distinctive and legal. */
const SPEC = {
  mode: "loop",
  capabilities: {
    ...emptyCapabilities(),
    deepCompression: true,
    ocr: true,
    ocrLanguages: ["eng"],
    malwareScan: true,
    atomicQueue: true,
    chunkedTranslate: true,
    deliveryCap: true,
    // Set, not inherited: `emptyCapabilities()` says `false`, and a publisher
    // that wrote a constant `false` matched that and stayed green here.
    aiReadCap: true,
    pptxPresentationChain: true,
    pptxPictures: true,
  },
  release: "7.9.3",
  fingerprint: "9a5db1338ee3",
} as const;

/**
 * How each spec field must show up on the wire.
 *
 * `release` is COARSENED on the way through (`7.9.3` → `7.9`), so the check is
 * per-field rather than a deep equality — a transform is not a drop, and a
 * guard that could not tell them apart would either miss drops or forbid
 * transforms.
 */
const EXPECTED: Record<
  string,
  (published: Record<string, unknown>) => boolean
> = {
  mode: (p) => p.mode === "loop",
  // EVERY capability in the spec, derived from it rather than named. This
  // used to check `chunkedTranslate` and `deliveryCap` only — two of seven —
  // so a publisher that dropped any other capability stayed green here. The
  // spec sets each one to the opposite of its default, or a dropped value and
  // a defaulted one would read the same.
  capabilities: (p) => {
    const caps = p.capabilities as Record<string, unknown> | undefined;
    return Object.entries(SPEC.capabilities).every(
      ([key, value]) => JSON.stringify(caps?.[key]) === JSON.stringify(value),
    );
  },
  release: (p) => p.release === "7.9",
  fingerprint: (p) => p.fingerprint === "9a5db1338ee3",
};

/** Captures the payload the publisher would write, without a broker. */
function capturingClient(): { client: RedisClient; written: string[] } {
  const written: string[] = [];
  const client = {
    async command(args: readonly (string | number)[]) {
      if (
        String(args[0]).toUpperCase() === "SET" &&
        typeof args[2] === "string"
      ) {
        written.push(args[2]);
      }
      return { ok: true as const, value: "OK" };
    },
    async pipeline() {
      return { ok: true as const, value: [] };
    },
  } as unknown as RedisClient;
  return { client, written };
}

const ENABLED_ENV = {
  [WORKER_HEARTBEAT_ENV.enabled]: "1",
  PDFXYZ_QUEUE_PROVIDER: "redis",
  PDFXYZ_REDIS_REST_URL: "https://redis.example.com",
  PDFXYZ_REDIS_REST_TOKEN: "redis-rest-token-1234",
} as const;

async function publishOnce(): Promise<Record<string, unknown>> {
  const { client, written } = capturingClient();
  const publisher = createHeartbeatPublisher(ENABLED_ENV, {
    ...SPEC,
    deps: { client },
  });
  const result = await publisher.beat();
  expect(
    result.published,
    `the publisher did not write at all (${result.reason}) — this check would ` +
      "then pass over an empty payload, which is the strongest possible pass",
  ).toBe(true);
  expect(written, "nothing was written to the broker").toHaveLength(1);

  const parsed = parseHeartbeat(written[0]!);
  expect(parsed, "the published record does not parse").not.toBeNull();
  return JSON.parse(written[0]!) as Record<string, unknown>;
}

describe("the publish spec reaches the wire", () => {
  it("carries every field the daemon supplies", async () => {
    const published = await publishOnce();

    const fields = Object.keys(SPEC);
    // BOUND THE CORPUS: a spec that lost its fields would make the loop below
    // assert nothing and report a clean pass.
    expect(
      fields.length,
      "the publish spec is implausibly small — the fixture, not the code, is what failed",
    ).toBeGreaterThanOrEqual(4);

    for (const field of fields) {
      const check = EXPECTED[field];
      expect(
        check,
        `${field} is a spec field with no expectation here. Add one — an ` +
          "unchecked field is exactly how the build fingerprint shipped inert.",
      ).toBeDefined();
      expect(
        check!(published),
        `${field} did not reach the wire. Some hop between the daemon and the ` +
          "broker rebuilt the record field by field and dropped it — the value " +
          "is computed, passed, and thrown away without a word, and the " +
          "operator surface then says nothing, which reads as fine.",
      ).toBe(true);
    }
  });

  it("HEALTH CHECK: the payload is a real record, not an empty object", async () => {
    // `Object.keys(SPEC)` passing over `{}` would be vacuous for any check that
    // only asserted absence. This asserts the published record has the shape a
    // reader depends on.
    const published = await publishOnce();
    expect(published.v).toBe(1);
    expect(published.role).toBe("secure-worker");
    expect(typeof published.at).toBe("number");
  });

  it("HEALTH CHECK: every capability in the spec is set away from its default", () => {
    // A capability left at `emptyCapabilities()`'s value cannot tell a
    // publisher that carried it from one that wrote the default — `aiReadCap`
    // sat at `false` here, and a serializer hard-coding `false` stayed green.
    // Derived from the defaults, so a capability added later is held to it.
    const defaults = emptyCapabilities() as unknown as Record<string, unknown>;
    const spec = SPEC.capabilities as unknown as Record<string, unknown>;
    const keys = Object.keys(defaults);
    expect(keys.length).toBeGreaterThanOrEqual(9);
    const unset = keys.filter(
      (key) => JSON.stringify(spec[key]) === JSON.stringify(defaults[key]),
    );
    expect(unset, "set these in SPEC to a non-default value").toEqual([]);
  });

  it("CONTROL: a field the daemon does NOT supply is absent, not invented", async () => {
    // The other direction. A publisher that filled in defaults would make the
    // check above pass while reporting capabilities no worker claimed — and an
    // absent fingerprint has to stay absent, because that absence is what the
    // operator surface reads as "this bound is not in force".
    const { client, written } = capturingClient();
    const { fingerprint: _dropped, ...withoutFingerprint } = SPEC;
    const publisher = createHeartbeatPublisher(ENABLED_ENV, {
      ...withoutFingerprint,
      deps: { client },
    });
    await publisher.beat();

    const published = JSON.parse(written[0]!) as Record<string, unknown>;
    expect(published.fingerprint).toBeUndefined();
    expect(published.mode).toBe("loop");
  });
});
