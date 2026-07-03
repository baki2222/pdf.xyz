/**
 * Public barrel for the Phase 43 storage-artifact cleanup **evidence exporter / projector**.
 *
 * Pure, node-free, content-free: a bounded projection transform (`./project`) over a
 * defensively-parsed raw provider export, a closed vocabulary (`./types`), the CLI arg parser
 * (`./args`), the orchestrator (`./run`), an optional per-run receipt observer seam
 * (`./receipt`), and the run-level metric counter seam (`./metrics`). This layer NEVER calls
 * the cloud, needs no credentials, and deletes nothing — it only projects an out-of-band export
 * into the two Phase 42 bounded shapes, dropping every locator and identifier. The Node entry
 * (`scripts/worker-cleanup-project.ts`) is a thin shell over these unit-tested modules.
 */

export * from "./types";
export * from "./project";
export * from "./args";
export * from "./run";
export * from "./receipt";
export * from "./metrics";
