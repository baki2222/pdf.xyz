/**
 * Public surface of the secure-worker **liveness heartbeat** (Phase 30).
 *
 * It lets an out-of-band worker daemon publish a bounded, content-free liveness
 * record to the shared job-queue broker, and lets the web app read it back to
 * classify liveness as observed / stale / unknown — closing the "is a worker
 * actually running?" gap the web vantage could never see before, without leaking
 * any infrastructure identifier or pretending a worker is alive on stale evidence.
 *
 * Safe to import from the `/api/worker/operations` route (the reader) and reused by
 * the Node-only daemon CLI (the publisher) — both SERVER tiers. It is not safe
 * from a client bundle, and the sentence here used to claim it "never pulls a
 * Node built-in": `./schema` imports `FINGERPRINT_PATTERN` from
 * `../build-fingerprint`, which reads `node:crypto`, `node:fs` and `node:path`.
 *
 * A client tier that wants the capability key set takes the leaf
 * `./capabilities` directly; this barrel is not the door for it.
 */

export * from "./types";
export * from "./schema";
export * from "./redis";
export * from "./factory";
