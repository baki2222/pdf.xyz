/**
 * Node-free public surface of the secure-worker **release evidence artifact** (Phase 47).
 *
 * The artifact archives the offline `worker:release-gate` result (run internally or supplied) with
 * bounded git/release provenance, and computes an INTEGRITY DIGEST (sha256 over the canonical body)
 * so a CI job / incident handoff / deployment-approval record can archive a stable, tamper-evident,
 * content-free release evidence artifact. It is evidence AGGREGATION + INTEGRITY over content-free
 * data: it makes no network call, reads no provider export/secret/bucket, deletes nothing, and
 * carries no locator, identifier, size, path, or byte — not signing, auth, cloud validation, deletion
 * proof, or the promotion itself. Everything here is pure and safe to import from the CLI entry or a
 * test; the actual git spawning, subprocess run, filesystem reads, and `node:crypto` hash live behind
 * the entry's injected {@link ReleaseArtifactProvider} seam.
 */

export * from "./types";
export * from "./args";
export * from "./git";
export * from "./gate";
export * from "./opsbundle";
export * from "./canonicalize";
export * from "./digest";
export * from "./build";
export * from "./receipt";
export * from "./render";
export * from "./run";
export * from "./metrics";
