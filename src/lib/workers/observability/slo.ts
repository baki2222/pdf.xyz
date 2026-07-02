/**
 * Pure **SLO helpers** — the calculations that turn a content-free
 * {@link WorkerMetricsSnapshot} into operational service-level indicators and a
 * pass/warn/breach verdict against configurable thresholds.
 *
 * These are the deterministic math the daemon CLI, a dashboard, or an alerting rule
 * uses to answer "is the worker healthy?" without any metrics backend: every helper
 * is a pure function of a snapshot (and optional thresholds), so each indicator and
 * every edge case (no data, all-skipped scans, an unprobed engine) is unit-testable
 * offline. Nothing here reads a clock, a network, or a secret.
 *
 * Design notes that keep the indicators HONEST:
 *  - Latency percentiles are histogram estimates: with only bucket bounds (`le`),
 *    p95/p99 resolve to the bucket UPPER BOUND that the percentile falls in, never a
 *    fabricated precise millisecond. `+Inf` means "slower than the largest bucket".
 *  - An optional, opt-in facet that is simply off (OCR/scanner not configured) is
 *    NOT a breach — mirroring the documented posture that `processor.ready:false`
 *    alone is expected, not an alert. Only a facet that is expected-and-degraded is.
 *  - An indicator with no observations returns `unknown`, never a flattering default.
 */

import type { LatencyLeLabel } from "./metrics";
import {
  QUEUE_DEPTH_BUCKETS,
  QUEUE_AGE_BUCKETS,
  type QueueDepthBucket,
  type QueueAgeBucket,
} from "./metrics";
import {
  gaugeValue,
  latencyBuckets,
  seriesFor,
  sumSeries,
  type WorkerMetricsSnapshot,
} from "./collector";

/** Every SLO indicator id. Bounded — the dashboard/alert examples reference these. */
export const SLO_IDS = [
  "job_success_rate",
  "job_success_rate_compress",
  "job_success_rate_ocr",
  "processor_latency_p95",
  "processor_latency_p99",
  "queue_depth",
  "queue_age",
  "retry_rate",
  "dead_letter_rate",
  "scanner_unavailable_rate",
  "engine_readiness",
  "lifecycle_drift",
] as const;
export type SloId = (typeof SLO_IDS)[number];

const SLO_ID_SET: ReadonlySet<string> = new Set(SLO_IDS);
export function isKnownSloId(id: unknown): id is SloId {
  return typeof id === "string" && SLO_ID_SET.has(id);
}

/** A single indicator's health. `unknown` = not enough data to judge. */
export type SloStatus = "ok" | "warn" | "breach" | "unknown";

/** A ratio indicator's components. `rate` is `null` when the denominator is 0. */
export interface RateIndicator {
  readonly rate: number | null;
  readonly numerator: number;
  readonly denominator: number;
}

/* ------------------------------------------------------------------ *
 *  Individual indicators
 * ------------------------------------------------------------------ */

/**
 * Job completion success rate from `worker_job_terminal_total`:
 * `completed / (completed + failed)`. Canceled jobs are user-initiated and excluded
 * from the reliability ratio. `rate` is `null` when nothing terminal was observed.
 */
export function jobSuccessRate(snapshot: WorkerMetricsSnapshot): RateIndicator {
  const completed = sumSeries(snapshot, "worker_job_terminal_total", {
    outcome: "completed",
  });
  const failed = sumSeries(snapshot, "worker_job_terminal_total", {
    outcome: "failed",
  });
  const denominator = completed + failed;
  return {
    numerator: completed,
    denominator,
    rate: denominator > 0 ? completed / denominator : null,
  };
}

/**
 * Per-processor-kind success rate from `worker_processor_total`:
 * `completed / (completed + failed)` for that kind. Requeued (intermediate) and
 * canceled (user) outcomes are excluded.
 */
export function processorSuccessRate(
  snapshot: WorkerMetricsSnapshot,
  processor: "compress" | "ocr" | "other",
): RateIndicator {
  const completed = sumSeries(snapshot, "worker_processor_total", {
    processor,
    outcome: "completed",
  });
  const failed = sumSeries(snapshot, "worker_processor_total", {
    processor,
    outcome: "failed",
  });
  const denominator = completed + failed;
  return {
    numerator: completed,
    denominator,
    rate: denominator > 0 ? completed / denominator : null,
  };
}

/** The numeric seconds a `le` label denotes (`+Inf` → `Infinity`). */
export function leSeconds(le: LatencyLeLabel): number {
  return le === "+Inf" ? Number.POSITIVE_INFINITY : Number.parseFloat(le);
}

/** A latency-quantile estimate: the bucket bound the percentile falls in. */
export interface LatencyQuantile {
  /** The `le` bucket bound, or `null` when there were no observations. */
  readonly le: LatencyLeLabel | null;
  /** The same bound as seconds (`Infinity` for `+Inf`), or `null` when no data. */
  readonly seconds: number | null;
  /** Total observations the estimate is over. */
  readonly samples: number;
}

/**
 * Estimate a latency quantile from the `worker_processor_latency_seconds` histogram
 * (optionally for one processor kind). Prometheus-style: walk the `le` buckets in
 * order and return the first whose CUMULATIVE share reaches `q`. The result is a
 * bucket UPPER BOUND, not an interpolated value — honest about the histogram's
 * resolution. `q` is clamped to (0, 1].
 */
export function latencyQuantile(
  snapshot: WorkerMetricsSnapshot,
  q: number,
  processor?: "compress" | "ocr" | "other",
): LatencyQuantile {
  const buckets = latencyBuckets(snapshot, processor);
  const total = buckets.reduce((n, b) => n + b.count, 0);
  if (total === 0) return { le: null, seconds: null, samples: 0 };
  const clamped = Math.min(1, Math.max(Number.EPSILON, q));
  const target = clamped * total;
  let cumulative = 0;
  for (const bucket of buckets) {
    cumulative += bucket.count;
    if (cumulative >= target) {
      return { le: bucket.le, seconds: leSeconds(bucket.le), samples: total };
    }
  }
  const last = buckets[buckets.length - 1]!;
  return { le: last.le, seconds: leSeconds(last.le), samples: total };
}

/**
 * Retry rate: `requeues / (completed + failed + requeues)` — the share of processing
 * attempts that were returned to the queue for another try. `rate` is `null` when no
 * attempts were observed.
 */
export function retryRate(snapshot: WorkerMetricsSnapshot): RateIndicator {
  const retries = sumSeries(snapshot, "worker_retry_total");
  const completed = sumSeries(snapshot, "worker_job_terminal_total", {
    outcome: "completed",
  });
  const failed = sumSeries(snapshot, "worker_job_terminal_total", {
    outcome: "failed",
  });
  const denominator = completed + failed + retries;
  return {
    numerator: retries,
    denominator,
    rate: denominator > 0 ? retries / denominator : null,
  };
}

/**
 * Dead-letter rate: `dead_letters / (completed + failed)` — the share of finished
 * jobs that failed terminally only because their retries were exhausted.
 */
export function deadLetterRate(snapshot: WorkerMetricsSnapshot): RateIndicator {
  const dead = sumSeries(snapshot, "worker_dead_letter_total");
  const completed = sumSeries(snapshot, "worker_job_terminal_total", {
    outcome: "completed",
  });
  const failed = sumSeries(snapshot, "worker_job_terminal_total", {
    outcome: "failed",
  });
  const denominator = completed + failed;
  return {
    numerator: dead,
    denominator,
    rate: denominator > 0 ? dead / denominator : null,
  };
}

/**
 * Scanner-unavailable rate: `error / (clean + infected + error + invalid)` — the
 * share of ENGAGED scans that could not complete. `skipped` verdicts (no scanner
 * ran) are excluded, so a deployment with no scanner reports `null` (not 0), never
 * implying a healthy scanner that does not exist.
 */
export function scannerUnavailableRate(
  snapshot: WorkerMetricsSnapshot,
): RateIndicator {
  const engaged = ["clean", "infected", "error", "invalid"] as const;
  const denominator = engaged.reduce(
    (n, verdict) => n + sumSeries(snapshot, "worker_scan_total", { verdict }),
    0,
  );
  const errors = sumSeries(snapshot, "worker_scan_total", { verdict: "error" });
  return {
    numerator: errors,
    denominator,
    rate: denominator > 0 ? errors / denominator : null,
  };
}

/** The observed queue-depth bucket gauge, or `null` when never observed. */
export function observedQueueDepthBucket(
  snapshot: WorkerMetricsSnapshot,
): QueueDepthBucket | null {
  const series = seriesFor(snapshot, "worker_queue_depth");
  const bucket = series[series.length - 1]?.labels.bucket;
  return (bucket as QueueDepthBucket | undefined) ?? null;
}

/** The observed queue-age bucket gauge, or `null` when never observed. */
export function observedQueueAgeBucket(
  snapshot: WorkerMetricsSnapshot,
): QueueAgeBucket | null {
  const series = seriesFor(snapshot, "worker_queue_age_seconds");
  const bucket = series[series.length - 1]?.labels.bucket;
  return (bucket as QueueAgeBucket | undefined) ?? null;
}

/**
 * Presence-only engine-readiness health from `worker_engine_capability`. Reports
 * whether deep compression is available (`compression_deep`), treating an unprobed
 * capability as `unknown`. Optional facets (OCR/scanner) being off are deliberately
 * NOT a failure here — only the always-expected compression engine is judged.
 */
export function engineReadiness(snapshot: WorkerMetricsSnapshot): {
  status: SloStatus;
  deep: boolean | null;
} {
  const series = seriesFor(snapshot, "worker_engine_capability", {
    capability: "compression_deep",
  });
  if (series.length === 0) return { status: "unknown", deep: null };
  const deep = series.some((s) => s.labels.available === "true");
  // Lossless repack is always available; lacking a native deep engine is a
  // documented degraded state (deep jobs fail honestly), not a hard breach.
  return { status: deep ? "ok" : "warn", deep };
}

/**
 * Lifecycle-drift health from `worker_lifecycle_verification_total` and
 * `worker_lifecycle_drift_rules`. `verified` with zero drifted rules → ok; any
 * `drift` (or a positive drift count) → breach; `unknown`/`malformed` → unknown.
 */
export function lifecycleDrift(snapshot: WorkerMetricsSnapshot): {
  status: SloStatus;
  driftedRules: number;
} {
  const drifted = gaugeValue(snapshot, "worker_lifecycle_drift_rules");
  const drift = sumSeries(snapshot, "worker_lifecycle_verification_total", {
    verdict: "drift",
  });
  const verified = sumSeries(snapshot, "worker_lifecycle_verification_total", {
    verdict: "verified",
  });
  if (drift > 0 || drifted > 0) return { status: "breach", driftedRules: drifted };
  if (verified > 0) return { status: "ok", driftedRules: 0 };
  return { status: "unknown", driftedRules: 0 };
}

/* ------------------------------------------------------------------ *
 *  Thresholds + the composed evaluation
 * ------------------------------------------------------------------ */

/** A two-tier threshold: crossing `warn` warns, crossing `breach` breaches. */
export interface Threshold {
  readonly warn: number;
  readonly breach: number;
}

/** Bucket-ordinal thresholds for the queue gauges. */
export interface QueueThresholds {
  readonly depth: { readonly warn: QueueDepthBucket; readonly breach: QueueDepthBucket };
  readonly age: { readonly warn: QueueAgeBucket; readonly breach: QueueAgeBucket };
}

/** The full, tunable SLO threshold set. */
export interface SloThresholds {
  readonly jobSuccessRate: Threshold;
  readonly latencyP95Seconds: Threshold;
  readonly latencyP99Seconds: Threshold;
  readonly retryRate: Threshold;
  readonly deadLetterRate: Threshold;
  readonly scannerUnavailableRate: Threshold;
  readonly queue: QueueThresholds;
}

/**
 * Sensible default thresholds for a privacy-first PDF worker. They are a STARTING
 * POINT an operator tunes to their traffic — documented in `docs/OBSERVABILITY.md`
 * and mirrored by the committed alert-rule examples.
 */
export const DEFAULT_SLO_THRESHOLDS: SloThresholds = {
  jobSuccessRate: { warn: 0.99, breach: 0.95 },
  latencyP95Seconds: { warn: 10, breach: 30 },
  latencyP99Seconds: { warn: 30, breach: 60 },
  retryRate: { warn: 0.1, breach: 0.25 },
  deadLetterRate: { warn: 0.01, breach: 0.05 },
  scannerUnavailableRate: { warn: 0.01, breach: 0.05 },
  queue: {
    depth: { warn: "51-200", breach: "1000+" },
    age: { warn: "2-10m", breach: "60m+" },
  },
};

/** Classify a "higher is better" ratio (e.g. success rate). */
function classifyHigherIsBetter(value: number, t: Threshold): SloStatus {
  if (value >= t.warn) return "ok";
  if (value >= t.breach) return "warn";
  return "breach";
}

/** Classify a "lower is better" value (e.g. latency seconds, error rate). */
function classifyLowerIsBetter(value: number, t: Threshold): SloStatus {
  if (value <= t.warn) return "ok";
  if (value <= t.breach) return "warn";
  return "breach";
}

/** Ordinal position of a bucket in its ordered vocabulary (`-1` if absent). */
function ordinal<T extends string>(bucket: T, order: readonly T[]): number {
  return order.indexOf(bucket);
}

/** Classify a bucket gauge against ordered warn/breach bucket thresholds. */
function classifyBucket<T extends string>(
  observed: T,
  order: readonly T[],
  warn: T,
  breach: T,
): SloStatus {
  const o = ordinal(observed, order);
  if (o < 0) return "unknown";
  if (o >= ordinal(breach, order)) return "breach";
  if (o >= ordinal(warn, order)) return "warn";
  return "ok";
}

/** One indicator's evaluated result. `observed`/`threshold` are human, content-free. */
export interface SloEvaluation {
  readonly id: SloId;
  readonly status: SloStatus;
  /** Human-readable observed value (e.g. `"99.3%"`, `"≤10s"`, `"11-50"`). */
  readonly observed: string;
  /** Human-readable threshold the status was judged against. */
  readonly threshold: string;
  /** One-line, content-free explanation of what the indicator means. */
  readonly detail: string;
}

/** The composed SLO report over a snapshot. */
export interface SloReport {
  readonly slos: SloEvaluation[];
  /** The worst status across all judged (non-`unknown`) indicators. */
  readonly worst: SloStatus;
}

const pct = (rate: number): string => `${(rate * 100).toFixed(2)}%`;

/** Fold an individual status into the running worst (unknown never worsens). */
function worse(current: SloStatus, next: SloStatus): SloStatus {
  const rank: Record<SloStatus, number> = { ok: 0, unknown: 0, warn: 1, breach: 2 };
  return rank[next] > rank[current] ? next : current;
}

/**
 * Evaluate every SLO indicator over a snapshot against `thresholds`, returning a
 * per-indicator status plus the worst overall. Pure and deterministic. An indicator
 * with insufficient data is reported `unknown` and does not worsen the overall.
 */
export function evaluateSlos(
  snapshot: WorkerMetricsSnapshot,
  thresholds: SloThresholds = DEFAULT_SLO_THRESHOLDS,
): SloReport {
  const slos: SloEvaluation[] = [];

  const rate = (
    id: SloId,
    indicator: RateIndicator,
    t: Threshold,
    higherIsBetter: boolean,
    detail: string,
  ): void => {
    if (indicator.rate === null) {
      slos.push({ id, status: "unknown", observed: "no data", threshold: "—", detail });
      return;
    }
    const status = higherIsBetter
      ? classifyHigherIsBetter(indicator.rate, t)
      : classifyLowerIsBetter(indicator.rate, t);
    slos.push({
      id,
      status,
      observed: pct(indicator.rate),
      threshold: higherIsBetter
        ? `warn <${pct(t.warn)}, breach <${pct(t.breach)}`
        : `warn >${pct(t.warn)}, breach >${pct(t.breach)}`,
      detail,
    });
  };

  rate(
    "job_success_rate",
    jobSuccessRate(snapshot),
    thresholds.jobSuccessRate,
    true,
    "Terminal job completion rate: completed / (completed + failed).",
  );
  rate(
    "job_success_rate_compress",
    processorSuccessRate(snapshot, "compress"),
    thresholds.jobSuccessRate,
    true,
    "Compression processor success rate.",
  );
  rate(
    "job_success_rate_ocr",
    processorSuccessRate(snapshot, "ocr"),
    thresholds.jobSuccessRate,
    true,
    "OCR processor success rate.",
  );

  for (const [id, q, t] of [
    ["processor_latency_p95", 0.95, thresholds.latencyP95Seconds],
    ["processor_latency_p99", 0.99, thresholds.latencyP99Seconds],
  ] as const) {
    const est = latencyQuantile(snapshot, q);
    if (est.seconds === null) {
      slos.push({
        id,
        status: "unknown",
        observed: "no data",
        threshold: `warn >${t.warn}s, breach >${t.breach}s`,
        detail: "Processor wall-clock latency (histogram bucket upper-bound estimate).",
      });
    } else {
      slos.push({
        id,
        status: classifyLowerIsBetter(est.seconds, t),
        observed: est.le === "+Inf" ? ">120s" : `≤${est.le}s`,
        threshold: `warn >${t.warn}s, breach >${t.breach}s`,
        detail: "Processor wall-clock latency (histogram bucket upper-bound estimate).",
      });
    }
  }

  rate(
    "retry_rate",
    retryRate(snapshot),
    thresholds.retryRate,
    false,
    "Share of processing attempts requeued for another try.",
  );
  rate(
    "dead_letter_rate",
    deadLetterRate(snapshot),
    thresholds.deadLetterRate,
    false,
    "Share of finished jobs that failed after exhausting retries.",
  );
  rate(
    "scanner_unavailable_rate",
    scannerUnavailableRate(snapshot),
    thresholds.scannerUnavailableRate,
    false,
    "Share of engaged malware scans that could not complete (scanner unreachable).",
  );

  const depthBucket = observedQueueDepthBucket(snapshot);
  slos.push(
    depthBucket === null
      ? {
          id: "queue_depth",
          status: "unknown",
          observed: "no data",
          threshold: `warn ≥${thresholds.queue.depth.warn}, breach ≥${thresholds.queue.depth.breach}`,
          detail: "Runnable queue depth (operator-observed; bucketed).",
        }
      : {
          id: "queue_depth",
          status: classifyBucket(
            depthBucket,
            QUEUE_DEPTH_BUCKETS,
            thresholds.queue.depth.warn,
            thresholds.queue.depth.breach,
          ),
          observed: depthBucket,
          threshold: `warn ≥${thresholds.queue.depth.warn}, breach ≥${thresholds.queue.depth.breach}`,
          detail: "Runnable queue depth (operator-observed; bucketed).",
        },
  );

  const ageBucket = observedQueueAgeBucket(snapshot);
  slos.push(
    ageBucket === null
      ? {
          id: "queue_age",
          status: "unknown",
          observed: "no data",
          threshold: `warn ≥${thresholds.queue.age.warn}, breach ≥${thresholds.queue.age.breach}`,
          detail: "Age of the oldest runnable job (operator-observed; bucketed).",
        }
      : {
          id: "queue_age",
          status: classifyBucket(
            ageBucket,
            QUEUE_AGE_BUCKETS,
            thresholds.queue.age.warn,
            thresholds.queue.age.breach,
          ),
          observed: ageBucket,
          threshold: `warn ≥${thresholds.queue.age.warn}, breach ≥${thresholds.queue.age.breach}`,
          detail: "Age of the oldest runnable job (operator-observed; bucketed).",
        },
  );

  const engine = engineReadiness(snapshot);
  slos.push({
    id: "engine_readiness",
    status: engine.status,
    observed:
      engine.deep === null ? "unprobed" : engine.deep ? "deep ready" : "lossless-only",
    threshold: "deep engine present",
    detail:
      "Compression engine health: lossless repack is always available; deep image compression needs a native engine (its absence is degraded, not a breach).",
  });

  const drift = lifecycleDrift(snapshot);
  slos.push({
    id: "lifecycle_drift",
    status: drift.status,
    observed:
      drift.status === "unknown"
        ? "not verified"
        : drift.status === "ok"
          ? "verified"
          : `${drift.driftedRules} drifted rule(s)`,
    threshold: "verified, 0 drifted rules",
    detail:
      "Retention/lifecycle backstop verification: drift means objects could outlive the privacy ceiling.",
  });

  const worst = slos.reduce<SloStatus>((acc, s) => worse(acc, s.status), "ok");
  return { slos, worst };
}
