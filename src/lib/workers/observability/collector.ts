/**
 * The in-memory **metrics collector** — the injectable sink the worker path emits
 * {@link WorkerMetricSample}s into, and the aggregator that folds them into a
 * serializable, content-free {@link WorkerMetricsSnapshot} for the SLO helpers, the
 * daemon CLI's `metrics_snapshot` line, and a provider-neutral export.
 *
 * It is the observability analogue of the client telemetry `configureTelemetry`
 * sink: a call site is handed a {@link WorkerMetricSink} and never knows or cares
 * where metrics go. This collector is the default, dependency-free destination —
 * it holds counts in a `Map` and produces a snapshot on demand. A deployment that
 * runs a real metrics backend can either point the sink at its own exporter or
 * scrape {@link renderPrometheus} output; nothing about the emitting code changes.
 *
 * Pure and node-free (no clock, no I/O): the snapshot is deterministic given the
 * samples recorded, so aggregation and every rollup are unit-testable. Every sample
 * is run through {@link sanitizeMetric} on the way in, so an off-schema or
 * content-bearing sample can never enter the aggregate — the collector is a second
 * enforcement point after the typed builders.
 */

import {
  sanitizeMetric,
  type MetricKind,
  type WorkerMetricName,
  type WorkerMetricSample,
  type ProcessorKind,
  type LatencyLeLabel,
  LATENCY_LE_LABELS,
} from "./metrics";

/** A destination for worker metric samples. Receives only validated, sane samples. */
export type WorkerMetricSink = (sample: WorkerMetricSample) => void;

/** Discards every sample. The honest default when observability is not collected. */
export const NOOP_METRIC_SINK: WorkerMetricSink = () => {};

/** One aggregated series: a metric + its exact label set + the folded value. */
export interface MetricSeries {
  metric: WorkerMetricName;
  kind: MetricKind;
  labels: Readonly<Record<string, string>>;
  value: number;
}

/** A point-in-time, serializable, content-free view of everything collected. */
export interface WorkerMetricsSnapshot {
  /** Every series, sorted deterministically (by metric, then canonical labels). */
  readonly series: readonly MetricSeries[];
}

/** The collector surface: a sink to emit into, plus snapshot/reset. */
export interface WorkerMetricsCollector {
  /** The sink to hand to the executor/daemon/CLI; validates + folds each sample. */
  readonly sink: WorkerMetricSink;
  /** Emit a sample directly (equivalent to calling `sink`). */
  record(sample: WorkerMetricSample): void;
  /** A deterministic, content-free snapshot of the current aggregate. */
  snapshot(): WorkerMetricsSnapshot;
  /** Clear all state (test isolation). */
  reset(): void;
}

/** Canonical, collision-free string for a bounded label set (keys sorted). */
function labelKey(labels: Readonly<Record<string, string>>): string {
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}=${labels[k]}`).join(",");
}

/**
 * Build a fresh collector. Counters and histograms accumulate (sum of values);
 * gauges are last-writer-wins for a given label set (so re-observing a facet's
 * readiness or the queue depth updates rather than sums). Both are keyed by
 * metric + canonical labels, so distinct label sets are independent series.
 */
export function createWorkerMetricsCollector(): WorkerMetricsCollector {
  // key → aggregated series. Insertion holds the metric/kind/labels; value folds.
  const store = new Map<string, MetricSeries>();

  function record(raw: WorkerMetricSample): void {
    const sample = sanitizeMetric(raw);
    if (!sample) return; // off-schema / content-bearing → dropped, never aggregated
    const key = `${sample.metric}\u0000${labelKey(sample.labels)}`;
    const existing = store.get(key);
    if (!existing) {
      store.set(key, {
        metric: sample.metric,
        kind: sample.kind,
        labels: { ...sample.labels },
        value: sample.value,
      });
      return;
    }
    // Gauges reflect the latest observation; counters/histograms accumulate.
    existing.value =
      sample.kind === "gauge" ? sample.value : existing.value + sample.value;
  }

  function snapshot(): WorkerMetricsSnapshot {
    const series = [...store.values()].sort((a, b) => {
      if (a.metric !== b.metric) return a.metric < b.metric ? -1 : 1;
      const la = labelKey(a.labels);
      const lb = labelKey(b.labels);
      return la < lb ? -1 : la > lb ? 1 : 0;
    });
    return { series };
  }

  return {
    sink: record,
    record,
    snapshot,
    reset: () => store.clear(),
  };
}

/* ------------------------------------------------------------------ *
 *  Pure query helpers over a snapshot (shared by the SLO helpers)
 * ------------------------------------------------------------------ */

/** Series of `metric` whose labels contain every key/value in `match`. */
export function seriesFor(
  snapshot: WorkerMetricsSnapshot,
  metric: WorkerMetricName,
  match: Readonly<Record<string, string>> = {},
): MetricSeries[] {
  return snapshot.series.filter(
    (s) =>
      s.metric === metric &&
      Object.entries(match).every(([k, v]) => s.labels[k] === v),
  );
}

/** Sum of the values of every series of `metric` matching `match`. */
export function sumSeries(
  snapshot: WorkerMetricsSnapshot,
  metric: WorkerMetricName,
  match: Readonly<Record<string, string>> = {},
): number {
  return seriesFor(snapshot, metric, match).reduce((n, s) => n + s.value, 0);
}

/** The latest value of a single-series gauge (`0` when unobserved). */
export function gaugeValue(
  snapshot: WorkerMetricsSnapshot,
  metric: WorkerMetricName,
  match: Readonly<Record<string, string>> = {},
): number {
  const series = seriesFor(snapshot, metric, match);
  return series.length > 0 ? series[series.length - 1]!.value : 0;
}

/**
 * The per-`le` observation counts of `worker_processor_latency_seconds` for one
 * processor kind (or all kinds summed when omitted), ordered by bucket bound with
 * `+Inf` last — the shape a histogram-quantile estimate consumes.
 */
export function latencyBuckets(
  snapshot: WorkerMetricsSnapshot,
  processor?: ProcessorKind,
): { le: LatencyLeLabel; count: number }[] {
  const match: Record<string, string> = processor ? { processor } : {};
  return LATENCY_LE_LABELS.map((le) => ({
    le,
    count: sumSeries(snapshot, "worker_processor_latency_seconds", {
      ...match,
      le,
    }),
  }));
}

/* ------------------------------------------------------------------ *
 *  Provider-neutral export
 * ------------------------------------------------------------------ */

/** Escape a Prometheus label value (only `\` and `"` matter for bounded enums). */
function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Render a single `name{k="v",...} value` line, labels sorted for determinism. */
function renderLine(
  name: string,
  labels: Readonly<Record<string, string>>,
  value: number,
): string {
  const pairs = Object.keys(labels)
    .sort()
    .map((k) => `${k}="${escapeLabel(labels[k]!)}"`)
    .join(",");
  return `${name}${pairs ? `{${pairs}}` : ""} ${value}`;
}

const LATENCY_METRIC = "worker_processor_latency_seconds";

/**
 * Render a snapshot as Prometheus text-exposition format — the simplest way to feed
 * the shipped, provider-neutral metrics into a real backend (a Prometheus/OpenMetrics
 * scrape, an OTel collector's prometheus receiver, etc.).
 *
 * Counters and gauges render as one line each. The processor-latency histogram is
 * emitted in CANONICAL Prometheus form — cumulative `_bucket` series per processor
 * (ascending `le`, `+Inf` last) plus a `_count` — so `histogram_quantile()` works
 * directly on the scrape. Output is content-free by construction (only the bounded
 * metric names and enum labels the snapshot already holds) and deterministic (series
 * are pre-sorted), so it is testable.
 */
export function renderPrometheus(snapshot: WorkerMetricsSnapshot): string {
  const lines: string[] = [];

  // Every non-latency series is a flat line.
  for (const s of snapshot.series) {
    if (s.metric === LATENCY_METRIC) continue;
    lines.push(renderLine(s.metric, s.labels, s.value));
  }

  // Fold the latency observations into per-processor bucket counts.
  const byProcessor = new Map<string, Map<string, number>>();
  for (const s of snapshot.series) {
    if (s.metric !== LATENCY_METRIC) continue;
    const processor = s.labels.processor ?? "";
    const le = s.labels.le ?? "+Inf";
    const buckets = byProcessor.get(processor) ?? new Map<string, number>();
    buckets.set(le, (buckets.get(le) ?? 0) + s.value);
    byProcessor.set(processor, buckets);
  }
  // Emit cumulative `_bucket` (ascending `le`) + `_count` per processor — canonical
  // Prometheus histogram exposition, so a quantile query needs no reshaping.
  for (const [processor, buckets] of [...byProcessor.entries()].sort()) {
    let cumulative = 0;
    for (const le of LATENCY_LE_LABELS) {
      cumulative += buckets.get(le) ?? 0;
      lines.push(
        renderLine(`${LATENCY_METRIC}_bucket`, { processor, le }, cumulative),
      );
    }
    lines.push(
      renderLine(`${LATENCY_METRIC}_count`, { processor }, cumulative),
    );
  }

  return lines.join("\n");
}
