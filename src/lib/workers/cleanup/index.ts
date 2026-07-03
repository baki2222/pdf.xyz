/**
 * Node-free public surface of the storage-artifact **cleanup-verification** layer (Phase 42)
 * — the brain behind `pnpm worker:cleanup-check`.
 *
 * It proves, from CONTENT-FREE evidence an operator exports out-of-band, whether storage
 * artifacts that should be gone are actually ABSENT (deleted or reaped) or only retrieval-denied.
 * It NEVER calls the cloud, and every value it produces is a bounded enum, a small count, or
 * authored prose. It is complementary to `../lifecycle/verify` (which checks the bucket's
 * lifecycle RULES) and to the Phase 41 retrieval boundary (which DENIES an expired/tombstoned
 * artifact at download): those govern policy and access; this verifies the EFFECT — that the
 * bytes are gone. Everything here is pure and node-free, so the Node entry
 * (`scripts/worker-cleanup-check.ts`) is a thin shell over these unit-tested modules.
 */

export * from "./types";
export * from "./verify";
export * from "./ingest";
export * from "./args";
export * from "./render";
export * from "./run";
export * from "./metrics";
export * from "./receipt";
