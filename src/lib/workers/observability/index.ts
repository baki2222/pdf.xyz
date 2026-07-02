/**
 * Node-free public surface of the secure-worker **observability / SLO** layer
 * (Phase 28). It has two complementary halves, both content-free by construction and
 * safe to import from a route, the `/status` bundle, the worker daemon CLI, or tests
 * without pulling a Node built-in or touching a real metrics backend:
 *
 *  1. **Operations snapshot** (`./snapshot`) — a point-in-time health *projection*
 *     that folds the existing readiness/deployment/guardrail/lifecycle seams into one
 *     alert-oriented view: a per-subsystem {@link HealthClass}, engine/OCR proof
 *     tri-states, and a single recommended next action. Answers "is the stack healthy
 *     right now, and what is the one next thing to fix?". Backs `/api/worker/operations`.
 *
 *  2. **Metrics & SLO windows** (`./metrics`, `./collector`, `./derive`,
 *     `./instrument`, `./slo`) — a content-free, bounded metric schema the worker
 *     runtime *emits* (queue/tick/processor/scan/storage/lifecycle), an in-memory
 *     collector that folds samples into a serializable snapshot, a provider-neutral
 *     Prometheus/JSON export, and pure SLO calculations (success rate, p95/p99 latency,
 *     retry/dead-letter/scanner-unavailable rates, queue depth/age) over a *window* of
 *     processed work. Answers "over the jobs we ran, are we meeting our SLOs?".
 *
 * The one host-dependent input on either half (native-engine availability) is always
 * injected by the caller; nothing here reads or returns a secret, a filename, document
 * content, or a high-cardinality identifier.
 */

export * from "./snapshot";
export * from "./metrics";
export * from "./collector";
export * from "./derive";
export * from "./instrument";
export * from "./slo";
