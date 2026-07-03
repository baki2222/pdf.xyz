/**
 * Node-free public surface of the secure-worker **release evidence CI bundle** (Phase 50).
 *
 * The bundle composes whichever of the content-free release-evidence stage outputs (a
 * `pdfxyz.worker-release-gate/1`, `pdfxyz.release-artifact/1`, `pdfxyz.release-index/1`, and/or
 * `pdfxyz.release-policy/1`) a release job produced, re-verifies their internal + cross-stage
 * consistency, and emits one stable, content-free `pdfxyz.release-ci-bundle/1` result: per-stage
 * summaries, the consistency links, a rollup verdict, which stage outputs to archive, the next safe
 * operator action, and an exit code. It is local content-free bundling + consistency checking over
 * evidence: it makes no network call, reads no secret/bucket/object, runs no stage itself, and
 * deletes/prunes/uploads/promotes/mutates nothing — not signing, auth, cloud validation, storage
 * retention enforcement, or deployment promotion. Everything here is pure and safe to import from the
 * CLI entry or a test; the actual filesystem reads and the `node:crypto` hash live behind the entry's
 * injected {@link ReleaseCiBundleProvider} seam.
 */

export * from "./types";
export * from "./args";
export * from "./ingest";
export * from "./verify";
export * from "./rollup";
export * from "./receipt";
export * from "./build";
export * from "./render";
export * from "./run";
export * from "./metrics";
