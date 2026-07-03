/**
 * Node-free public surface of the secure-worker **release readiness gate** (Phase 46).
 *
 * The gate RUNS the existing offline, content-free worker checks as subprocesses, reads ONLY each
 * one's exit code (never a byte of its output), and folds them into ONE stable PASS/WARN/FAIL
 * release-readiness report to run before promoting a worker build. It is a PRE-DEPLOY EVIDENCE gate:
 * it makes no network call, reads no provider export/secret/bucket, deletes nothing, and carries no
 * locator, identifier, timestamp, size, path, or byte. Everything here is pure and safe to import
 * from the CLI entry or a test; the actual subprocess spawning lives behind the entry's injected
 * {@link ReleaseGateProvider} seam.
 */

export * from "./types";
export * from "./checks";
export * from "./args";
export * from "./rollup";
export * from "./receipt";
export * from "./render";
export * from "./run";
export * from "./metrics";
