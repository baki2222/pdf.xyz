# Operator healthcheck examples (Phase 31)

These are **provider-neutral, content-free fixtures** for the operator healthcheck
CLI shipped in Phase 31 (`pnpm worker:ops-check`). Each file is exactly what a monitor
would pipe into the CLI's ingest path — a sanitized operations snapshot (the shape
`GET /api/worker/operations` and the daemon's `operations` log line emit), optionally
bundled with a content-free `metrics` series (the daemon's `metrics` log line) so the
SLO indicators can be evaluated too.

Feed any of them to the CLI to see the alert verdict and exit code:

```sh
pnpm worker:ops-check --file=docs/examples/observability/healthcheck/lifecycle-drift.json
# …or over stdin, exactly as a monitor would after scraping the endpoint:
cat docs/examples/observability/healthcheck/stale-heartbeat.json | pnpm worker:ops-check --stdin
```

Every file references **only bounded enums** — a `HealthClass`, a `DaemonLivenessState`,
a `SnapshotSubsystemId`, a `RecommendedAction`, a metric name + enum label. **None
contains an endpoint, host, port, bucket name, object key, Redis key, signed URL,
filename, recognized text, malware signature, secret, or any user data**, so they are
safe to commit, print, and adapt. The CLI never echoes an ingested string anyway: it
validates every field against a bounded allowlist and re-authors all prose from the
app's own maps (see `src/lib/workers/ops-check/ingest.ts`), so even a hand-crafted
snapshot carrying a secret in a `detail` field cannot reach the output.

`src/lib/workers/ops-check/examples.test.ts` pins these files: it runs each one through
the real CLI orchestrator and asserts the documented severity + exit code, and asserts
the rendered output stays content-free.

## The fixtures

| File | Scenario | Severity | Exit code |
| ---- | -------- | -------- | --------- |
| `healthy.json` | Fully green stack; a fresh liveness heartbeat is visible. | `ok` | `0` |
| `stale-heartbeat.json` | Everything configured, but the worker's heartbeat is older than the freshness window (observation is enabled). | `warn` | `3` |
| `lifecycle-drift.json` | A verified retention-backstop drift: the snapshot flags it and the `metrics` series carries the drifted-rule count, so the SLO breaches. | `critical` | `4` |
| `scanner-unavailable-spike.json` | A malware scanner is selected but a spike of engaged scans could not complete (`worker_scan_total{verdict=error}` dominates), so the scanner-unavailable SLO breaches. | `critical` | `4` |
| `no-config-development.json` | A development / disabled-mode context where nothing is configured and no worker is observable, so health is genuinely indeterminate. | `unknown` | `2` |
| `rate-limit-fail-open.json` | Everything else is healthy, but the configured distributed rate limiter's store is failing and the guard is failing OPEN (`rateLimit.code: "remote-error-fail-open"`) — traffic passes unthrottled, so the abuse guard raises the documented alert. | `warn` | `3` |

## Exit-code contract

The CLI's exit code is the piece a cron job, uptime monitor, CI gate, or process
supervisor keys on. The operational ladder is monotonic in severity; `1` is a distinct
"the check itself was misused" band, so a misconfigured monitor is never mistaken for a
(un)healthy worker:

| Code | Meaning |
| ---- | ------- |
| `0` | OK — everything observable is healthy |
| `1` | usage — a bad flag, or unreadable/malformed input |
| `2` | UNKNOWN — worker health could not be determined (no data) |
| `3` | WARNING — a recommended fix is outstanding (a worker can still run) |
| `4` | CRITICAL — a worker cannot run correctly here, or an SLO breached |

## On the honest "unknown" (development)

`no-config-development.json` deliberately evaluates to `unknown` (exit `2`), never a
flattering `ok` and never a false-alarm `critical`. In a development context — or on a
monitor that cannot observe any worker configuration — the honest answer is "I cannot
determine worker health here." A **production** monitor that DOES expect a worker will
instead see a `blocked`/`critical` verdict when providers are unconfigured (that is what
a live `--web` run produces against a truly empty environment), because there "no worker
configured" is a real problem. The healthcheck never invents health it cannot observe.

## What is still out-of-band

This CLI is **local evaluation**, not a metrics backend or a pager. It reads the same
content-free evidence the daemon already produces and turns it into a stable verdict +
exit code; it does not store history, draw a timeseries, or notify anyone. Your monitor
still supplies the scheduling (cron / uptime service / supervisor) and the notification
(email / chat / on-call). See `docs/OBSERVABILITY.md` and `docs/RUNBOOK.md` for wiring.
