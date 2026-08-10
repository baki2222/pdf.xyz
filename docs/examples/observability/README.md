# Worker observability examples

These are **provider-neutral dashboard and alert examples** for the secure-worker
metrics and SLOs shipped in Phase 28. They are static, content-free fixtures — every
file references only the bounded metric names and enum labels defined in the committed
metric schema (`src/lib/workers/observability/metrics.ts`). **None contains an endpoint,
host, port, bucket name, object key, Redis key, signed URL, filename, recognized text,
malware signature, secret, or any user data** — so they are safe to commit, print, and
adapt to whatever backend you run.

`src/lib/workers/observability/examples.test.ts` pins these files: it parses each one,
asserts every metric/label/SLO reference is on the schema allowlist, and asserts they
stay content-free — so an example can never silently drift from the code.

## What is real now

The secure-worker daemon emits **content-free metric samples** at the seams that
already produce content-free structured logs:

- **executor** — scan verdict category, processor kind + outcome, processor latency
  bucket, terminal outcome + failure class, retries, redeliveries, dead letters;
- **storage** (wrapped) — read/write/delete success / failure / missing categories;
- **daemon loop** — per-tick outcome, queue-claim result, per-run stop reason;
- **readiness** — one gauge per deployment facet + engine/gate capability presence;
- **lifecycle** — the `--lifecycle-verify` verdict and a count of the app's own
  drifted backstop rules.

There is **no bundled metrics backend and no network egress**. The collector holds the
samples in memory; the daemon prints a content-free `metrics` line (the aggregated
series) and an `slo` line (the evaluated indicators) at the end of a run, plus an
`operations` line (the point-in-time health snapshot). Ship those to your own pipeline,
or scrape the Prometheus text-exposition form. Bring your own sink — exactly like the
client telemetry layer.

## Files

| File                    | What it is                                                                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dashboard.json`        | A provider-neutral dashboard model: panels that reference metrics + label values structurally (not as backend-specific query strings), so any renderer can map them.                   |
| `alerts.json`           | One example alert rule per SLO indicator, with severities and human-readable thresholds mirroring `DEFAULT_SLO_THRESHOLDS`.                                                            |
| `alerts.prometheus.yml` | An illustrative Prometheus/OpenMetrics alerting-rules group using the exported metric names (the latency histogram is exported canonically, so `histogram_quantile()` works directly). |

## The metric catalog (all content-free)

| Metric                                | Kind      | Labels (bounded)           |
| ------------------------------------- | --------- | -------------------------- |
| `worker_run_total`                    | counter   | `mode`, `reason`           |
| `worker_tick_total`                   | counter   | `mode`, `outcome`          |
| `worker_claim_total`                  | counter   | `result`                   |
| `worker_redelivery_total`             | counter   | —                          |
| `worker_dead_letter_total`            | counter   | —                          |
| `worker_retry_total`                  | counter   | —                          |
| `worker_processor_total`              | counter   | `processor`, `outcome`     |
| `worker_processor_latency_seconds`    | histogram | `processor`, `le`          |
| `worker_scan_total`                   | counter   | `verdict`, `scanned`       |
| `worker_storage_ops_total`            | counter   | `op`, `result`             |
| `worker_queue_depth`                  | gauge     | `bucket` (operator-fed)    |
| `worker_queue_age_seconds`            | gauge     | `bucket` (operator-fed)    |
| `worker_readiness`                    | gauge     | `facet`, `state`           |
| `worker_engine_capability`            | gauge     | `capability`, `available`  |
| `worker_lifecycle_verification_total` | counter   | `verdict`                  |
| `worker_lifecycle_drift_rules`        | gauge     | —                          |
| `worker_job_terminal_total`           | counter   | `outcome`, `failure_class` |

Every label value is a fixed enum or a coarse bucket. Numeric dimensions (latency,
queue depth/age) are bucketed **at construction** — the raw measurement becomes a
bucket label and is discarded, so no raw duration/size ever becomes a field. Metric
values are only counts or a presence flag, never a raw measurement.

## SLO indicators

`evaluateSlos()` computes these over a window of collected samples, each classified
`ok` / `warn` / `breach` / `unknown` against tunable thresholds:

`job_success_rate`, `job_success_rate_compress`, `job_success_rate_ocr`,
`processor_latency_p95`, `processor_latency_p99`, `retry_rate`, `dead_letter_rate`,
`scanner_unavailable_rate`, `queue_depth`, `queue_age`, `engine_readiness`,
`lifecycle_drift`.

## Adapting to a real backend

- **Prometheus / OpenMetrics** — `renderPrometheus(snapshot)` emits the text-exposition
  format directly; the latency histogram is canonical (`_bucket` + `_count`), so
  `histogram_quantile()` works. Point a scrape or an OTel collector's prometheus
  receiver at it, then load `alerts.prometheus.yml`.
- **JSON / OpenTelemetry** — the daemon's `metrics` line is the aggregated series
  (`{ metric, kind, labels, value }[]`), a shape trivially mapped to OTel metric data
  points (counter → sum, gauge → gauge, histogram → the `le` buckets).
- **Anything else** — implement a `WorkerMetricSink` and hand it to the runtime/daemon;
  every call site stays unchanged.

Whatever you choose, the privacy contract holds: the daemon can only ever emit the
bounded names and enum labels above — never document content, a filename, an object
key, an endpoint, an environment-variable name, or a secret.
