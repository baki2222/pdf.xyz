/**
 * Node-free public surface of the secure-worker **operations evidence bundle** (Phase 45).
 *
 * The bundle composes an operator's own content-free tool summaries — the `pdfxyz.ops-check/1`
 * result and, optionally, the `pdfxyz.cleanup-pipeline/1` summary — into ONE stable, bounded
 * artifact for a support ticket, an incident handoff, a CI artifact, or a scheduled monitor
 * attachment. It is an AGGREGATOR of existing evidence: it makes no network call, reads no
 * provider export/secret/bucket, deletes nothing, and carries no locator, identifier, timestamp,
 * size, or byte. Everything here is pure and safe to import from a route, the CLI, or a test.
 */

export * from "./types";
export * from "./args";
export * from "./ingest";
export * from "./build";
export * from "./render";
export * from "./run";
export * from "./metrics";
