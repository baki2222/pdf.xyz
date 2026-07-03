/**
 * Node-free public surface of the secure-worker **release evidence policy assertions** (Phase 49).
 *
 * The policy evaluates a content-free `pdfxyz.release-index/1` manifest (or an in-process index of
 * `pdfxyz.release-artifact/1` files) against a small, explicit set of operator thresholds and emits one
 * stable, content-free `pdfxyz.release-policy/1` result: a rollup verdict, the evaluated policy,
 * bounded violation ids with counts + remediation, and an exit code. It is local bounded policy
 * EVALUATION over content-free evidence: it makes no network call, reads no secret/bucket/object, and
 * deletes/prunes/uploads/promotes/mutates nothing — not signing, auth, cloud validation, storage
 * retention enforcement, or deployment promotion. Everything here is pure and safe to import from the
 * CLI entry or a test; the actual filesystem/stdin reads and the `node:crypto` hash live behind the
 * entry's injected {@link ReleasePolicyProvider} seam.
 */

export * from "./types";
export * from "./args";
export * from "./ingest";
export * from "./evaluate";
export * from "./rollup";
export * from "./receipt";
export * from "./build";
export * from "./render";
export * from "./run";
export * from "./metrics";
