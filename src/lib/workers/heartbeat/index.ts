/**
 * Node-free public surface of the secure-worker **liveness heartbeat** (Phase 30).
 *
 * It lets an out-of-band worker daemon publish a bounded, content-free liveness
 * record to the shared job-queue broker, and lets the web app read it back to
 * classify liveness as observed / stale / unknown — closing the "is a worker
 * actually running?" gap the web vantage could never see before, without leaking
 * any infrastructure identifier or pretending a worker is alive on stale evidence.
 *
 * Safe to import from the `/api/worker/operations` route (the reader) and reused by
 * the Node-only daemon CLI (the publisher); it builds only on the node-free Redis
 * `fetch` transport and the node-free queue config, so it never pulls a Node
 * built-in or a hosted dependency of its own.
 */

export * from "./types";
export * from "./schema";
export * from "./redis";
export * from "./factory";
