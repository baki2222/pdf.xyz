/**
 * Node-free public surface of the storage-artifact cleanup evidence **pipeline** layer
 * (Phase 44) — the brain behind `pnpm worker:cleanup-pipeline`.
 *
 * It composes the Phase 43 projector and the two Phase 42 cleanup lenses into ONE fail-closed,
 * read-only operator command: read a raw provider export once, project it away into the bounded
 * content-free shapes, run the absence verifier and the dry-run sweeper, and roll the two arms'
 * documented exit codes into a single composite result. It NEVER calls the cloud, needs no
 * credentials, and deletes nothing. Everything here is pure and node-free, so the Node entry
 * (`scripts/worker-cleanup-pipeline.ts`) is a thin shell over these unit-tested modules.
 */

export * from "./types";
export * from "./rollup";
export * from "./args";
export * from "./run";
export * from "./receipt";
export * from "./metrics";
