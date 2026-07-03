/**
 * Node-free public surface of the secure-worker **release evidence index / retention manifest**
 * (Phase 48).
 *
 * The index ingests many content-free `pdfxyz.release-artifact/1` files (a CI history, a release
 * train, an incident timeline), RE-VERIFIES each one's integrity digest, and folds their bounded
 * facts into ONE stable, content-free retention manifest: a rollup verdict, per-verdict and
 * per-digest-status counts, a bounded newest/oldest age span, a retention posture (over-count,
 * over-age, stale), and a bounded per-artifact summary. It is local content-free INDEXING + digest
 * verification: it makes no network call, reads no secret/bucket/object, and deletes/prunes/uploads/
 * mutates nothing — not storage retention enforcement, signing, auth, cloud validation, or promotion.
 * Everything here is pure and safe to import from the CLI entry or a test; the actual filesystem/stdin
 * reads and the `node:crypto` hash live behind the entry's injected {@link ReleaseIndexProvider} seam.
 */

export * from "./types";
export * from "./age";
export * from "./args";
export * from "./ingest";
export * from "./rollup";
export * from "./build";
export * from "./receipt";
export * from "./render";
export * from "./run";
export * from "./metrics";
