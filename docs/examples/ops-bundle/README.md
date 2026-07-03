# Operations evidence bundle — example inputs (Phase 45)

Example **content-free tool summaries** for the incident-handoff aggregator
(`pnpm worker:ops-bundle`). Each is a real, bounded output an operator's own commands already
produce — never a raw provider export, secret, bucket, or byte:

- `ops-check-*.json` — a `pdfxyz.ops-check/1` result from `pnpm worker:ops-check --json`
  (readiness, liveness, subsystems, SLOs, cleanup-evidence, and lifecycle-verification posture,
  all as bounded enums). The `ops-check-healthy`, `-degraded`, `-critical`, and `-unknown`
  fixtures were generated from the committed `docs/examples/observability/healthcheck/*` snapshots.
- `pipeline-*.json` — a `pdfxyz.cleanup-pipeline/1` summary from `pnpm worker:cleanup-pipeline
  --json` (the composite `verify` + `sweep` posture). NOT a raw provider export.

> Every value in these fixtures — and in the bundle the aggregator renders from them — is a
> bounded enum, boolean, small count, or app-authored prose. There is no locator, object key,
> bucket, URL, endpoint, region, id, filename, timestamp, size, or byte. The bundle re-authors
> every field from the app's own maps (no-leak by reconstruction), so even a poisoned input
> string is dropped. `src/lib/workers/ops-bundle/examples.test.ts` runs every case through the
> real aggregator and asserts the documented rollup, and that no locator token survives; the
> hostile no-leak proof lives in `src/lib/workers/ops-bundle/privacy.test.ts`.

The bundle is an **AGGREGATOR** of existing content-free evidence. It is **not** proof of byte
deletion, **not** malware scanning, **not** authentication / authorization, and does **not**
validate cloud state: it makes **no** cloud call, reads **no** provider export/secret/bucket, and
deletes **nothing**.

Compose one — pipe the ops-check result straight in, and attach an optional pipeline summary:

```sh
# One-line incident handoff (worker host): ops-check piped straight into the bundle
pnpm worker:ops-check --runtime --json | pnpm worker:ops-bundle --text

# A CI artifact: compose a captured ops-check result + a cleanup-pipeline summary
pnpm worker:ops-bundle --ops-check=docs/examples/ops-bundle/ops-check-healthy.json \
  --pipeline=docs/examples/ops-bundle/pipeline-breach.json --json > bundle.json
```

## Fixtures and the composite rollup each pins

| Ops-check input | + pipeline input | Rollup | Exit | Why |
| --- | --- | --- | --- | --- |
| `ops-check-healthy.json` | — | `ok` | 0 | Every composed signal is healthy. |
| `ops-check-healthy.json` | `pipeline-clean.json` | `ok` | 0 | Both arms of the pipeline are clean too. |
| `ops-check-healthy.json` | `pipeline-unknown.json` | `unknown` | 2 | The pipeline could not prove cleanup this run; it escalates a healthy stack to indeterminate. |
| `ops-check-healthy.json` | `pipeline-breach.json` | `critical` | 4 | A pipeline breach (a should-be-gone object) dominates the rollup. |
| `ops-check-degraded.json` | — | `warn` | 3 | A recommended fix is outstanding (a stale heartbeat). |
| `ops-check-critical.json` | — | `critical` | 4 | A worker cannot run correctly (lifecycle drift). |
| `ops-check-unknown.json` | — | `unknown` | 2 | Worker health could not be determined (no config). |

The operations severity already folds readiness, liveness, every subsystem (including
cleanup-evidence and lifecycle-verification), and the SLO window, so the rollup adds only the
independent cleanup-pipeline signal. An absent `--pipeline` is honestly `not-configured` (never a
fault); an unreadable one is `unknown` (never a false OK). All fixtures pin `generatedAt` to a
fixed instant for determinism; the aggregator re-stamps its own `generatedAt` from the clock.

## Exit codes

| Code | Composite severity | Meaning |
| --- | --- | --- |
| 0 | `ok` | Every composed signal is healthy; no action needed. |
| 1 | `usage` | The CLI was misused, or the REQUIRED ops-check input was unreadable / malformed. |
| 2 | `unknown` | A composed signal is indeterminate (no data, or an unreadable optional input). |
| 3 | `warn` | A composed signal is degraded (a recommended fix is outstanding, or a drift). |
| 4 | `critical` | A composed signal is critical (a worker cannot run correctly, or a breach). |
