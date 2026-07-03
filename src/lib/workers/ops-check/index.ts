/**
 * Node-free public surface of the operator **healthcheck / alerting** layer (Phase 31)
 * — the brain behind `pnpm worker:ops-check`.
 *
 * It composes the existing content-free seams into a single, monitor-friendly verdict:
 * the alert policy ({@link ../observability/alerts}) maps a
 * {@link ../observability/snapshot.WorkerOperationsSnapshot} + an SLO report to bounded
 * severities/reasons/actions; the ingest parser validates a monitor-supplied snapshot
 * without ever echoing it; the collector composes the daemon's own runtime evidence
 * with heartbeat-driven (never self-asserted) liveness; and the renderers emit stable
 * JSON, Prometheus gauges, or a short text summary. Everything here is pure and
 * node-free, so the Node entry (`scripts/worker-ops-check.ts`) is a thin, untested-only
 * shell over these unit-tested modules.
 */

export * from "./args";
export * from "./collect";
export * from "./ingest";
export * from "./render";
export * from "./run";
