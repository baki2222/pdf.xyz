# ops-check scheduler templates

Provider-neutral templates for running `pnpm worker:ops-check` on a schedule and
reacting to its exit code. They are **static examples, not a provisioned scheduler** —
copy them next to your deploy, adapt paths/user/cadence, and wire your own notifier.
`src/deploy/scheduler-templates.test.ts` pins their shape and the exit-code contract
(against the code's `OPS_CHECK_EXIT`), so a template can never silently drift.

## The exit-code contract (what every template keys on)

`worker:ops-check` returns a stable, documented code — the whole point is that a dumb
scheduler can act on it:

| Code | Meaning | Scheduler action |
| ---- | ------- | ---------------- |
| `0` | OK — healthy | nothing |
| `1` | **usage** — the *check itself* was misconfigured (bad flag / unreadable input) | **never page** — fix the check, not the worker |
| `2` | UNKNOWN — health could not be determined (no data) | alert |
| `3` | WARNING — a recommended fix is outstanding | alert |
| `4` | CRITICAL — a worker cannot run correctly, or an SLO breached | page |

The rule the templates encode: **alert on a non-zero, non-`1` exit.** `1` is a distinct
band so a broken monitor is never mistaken for a broken worker.

## Files

| File | Context | What it shows |
| ---- | ------- | ------------- |
| [`ops-check-notify.sh`](ops-check-notify.sh) | cron / systemd / supervisor | The canonical **inert** consumer: run the check, map the exit code to a severity, and show where a real pager/webhook would forward the content-free JSON. Posts nowhere unless you wire a webhook out-of-band. |
| [`ops-check.cron`](ops-check.cron) | `/etc/cron.d` | A crontab row that runs the wrapper every 5 min as an unprivileged user, with `MAILTO` for incident mail. |
| [`pdfxyz-ops-check.service`](pdfxyz-ops-check.service) | systemd | A hardened `oneshot` unit that runs the wrapper (`--runtime` on the worker host). |
| [`pdfxyz-ops-check.timer`](pdfxyz-ops-check.timer) | systemd | The timer that drives the service on a cadence (`Persistent=true` catches up a missed run). |

## Contexts

- **cron / systemd timer** — the two files above. Both delegate to `ops-check-notify.sh`,
  which owns the exit-code→action mapping in one place.
- **CI / manual operator shell** — no template needed; run it directly. A healthy fixture
  is a deterministic CI gate that asserts exit `0` without any worker or cloud:

  ```bash
  # CI gate — asserts exit 0 against a committed healthy fixture (offline, no Docker):
  pnpm worker:ops-check --file=docs/examples/observability/healthcheck/healthy.json

  # Operator shell — evaluate the live worker host, human-readable:
  pnpm worker:ops-check --runtime --text
  ```

- **container healthcheck / supervisor** — keep the container's own `HEALTHCHECK` the
  cheap presence-only probe (`pnpm worker:daemon --dry-run-status`, exit `0`/`2`); it must
  stay local and fast. Run `ops-check` from a **sidecar timer or supervisor**, not the
  per-container healthcheck, because it also reads the heartbeat/broker seam and folds in
  the alert policy. A supervisor (systemd, runit, an orchestrator liveness hook) invokes
  the same wrapper and reacts to the same exit ladder.

## Notifier / webhook honesty

The webhook is **inert and secret-free by default**: `PDFXYZ_OPSCHECK_WEBHOOK_URL` is
empty, and the `curl` POST is commented out. Set the URL out-of-band and uncomment the
POST to activate it. Forwarding is safe because `worker:ops-check --json` is **content-free
by construction** — bounded enums + policy-authored prose, with any ingested snapshot's
strings re-authored, never echoed. No filename, object key, endpoint, env-var name, or
secret can ride along. These templates implement **no real pager**; that (and the
timeseries backend) stays out-of-band, by design.
