# Observability — Product Analytics & Live Status

pdf.xyz is a browser-first, privacy-first product: files are processed on the
device and are never uploaded for the in-browser tools. Observability must never
weaken that promise. This document covers the **product-analytics** seam and the
user-facing **live status** surface.

It is a companion to two neighbouring docs:

- Error and Web-Vitals reporting (the diagnostics seam) — see the "Client
  telemetry" sections of [`SECURITY.md`](./SECURITY.md) and
  [`DEPLOYMENT.md`](./DEPLOYMENT.md).
- The secure-worker contract and the `GET /api/worker/status` endpoint — see
  [`WORKER_ARCHITECTURE.md`](./WORKER_ARCHITECTURE.md).

> **One rule above all:** no telemetry payload — product event, error, or metric
> — may ever carry file bytes, a file **name**, document text, a raw URL whose
> query can embed a handoff token, or a user/device identifier. This is enforced
> structurally (see [Privacy by construction](#privacy-by-construction)), not by
> asking callers to be careful.

---

## Product analytics events

Product events answer questions like _"which tools get used?"_ and _"do people
reach the secure-worker path?"_ without ever identifying a document or a person.

Source: [`src/lib/telemetry/`](../src/lib/telemetry/)

- `events.ts` — the typed `ProductEvent` schema + builder helpers.
- `buckets.ts` — coarse `countBucket` / `sizeBucket` / `durationBucket` helpers.
- `track.ts` — the `track()` transport and the swappable sink.
- `redact.ts` — the deep redaction scrubber applied to every payload.

### The event schema

`track()` accepts exactly a `ProductEvent` (a discriminated union keyed by
`name`), so adding an event or a field is a type-checked, reviewable change — not
a free-form string. The events today:

| Event                        | Fields (all privacy-safe)                                     |
| ---------------------------- | ------------------------------------------------------------- |
| `tool_viewed`                | `toolSlug` (route id), `capability`                           |
| `tool_completed`             | `toolSlug`, `capability`, `inputCount`, `outputSize?`, `duration?` |
| `tool_failed`                | `toolSlug`, `capability`, `reason` (coarse category)          |
| `workspace_handoff_created`  | `toolSlug`, `mode`, `fileCount`                               |
| `worker_status_checked`      | `mode`, `enabled`                                             |
| `worker_operations_checked`  | `mode`, `health` (SLO class), `recommendedAction`, `drainable`, `daemonObserved` |
| `worker_contract_hit`        | `capability`, `ok`, `code?` (contract/job error code)         |

Every field is one of: a **public route slug**, a **fixed enum**, a **boolean**,
or a **coarse bucket label**. No field is a filename, a raw byte count, a raw
duration, page text, a raw URL, or an identifier.

### Privacy by construction

Three layers keep the schema honest:

1. **Type constraints.** `ProductEvent` only permits the fields above. A filename
   or raw size has nowhere to go.
2. **Coarse bucketing at the edge.** Numeric dimensions are converted to coarse
   labels _at the point of construction_ via the builder helpers
   (`toolCompletedEvent`, `handoffCreatedEvent`), so a raw measurement never even
   becomes an event field. The buckets are low-cardinality:

   | Helper             | Example tiers                                                    |
   | ------------------ | ---------------------------------------------------------------- |
   | `countBucket`      | `0`, `1`, `2-5`, `6-20`, `21-50`, `50+`                          |
   | `sizeBucket`       | `<100KB`, `100KB-1MB`, `1-10MB`, `10-50MB`, `50-100MB`, `100MB+` |
   | `durationBucket`   | `<250ms`, `250ms-1s`, `1-5s`, `5-30s`, `30s+`                    |

   Non-finite or negative inputs bucket to `unknown` — a bad measurement can
   never masquerade as a real value.
3. **Redaction as defense in depth.** Before any payload reaches a sink, `track()`
   runs it through `redactValue` (from `redact.ts`), which strips handoff tokens
   (`h_…`), `data:`/`blob:` URLs, query strings from `http(s)` URLs, and
   filename-shaped tokens, and drops known-sensitive keys. So even a careless
   future field cannot leak. Unknown event names are dropped outright.

These are unit-tested in `buckets.test.ts`, `events.test.ts`, `track.test.ts`
(and the scrubber in `redact.test.ts`).

### The transport is off by default

`track()` hands validated, redacted events to a **sink**. The default sink is
chosen by environment:

- **development** → logs to the console under a `[telemetry]` prefix (so events
  are visible while building locally).
- **production and test** → a **no-op**. Nothing is sent anywhere.

There is **no third-party SDK** and **no network call** in this module. It is
inert in production until a deployment explicitly wires a destination.

### Wiring a real destination later

A first-party endpoint (or the same beacon transport the error reporter uses) can
be attached once, with no change to any call site:

```ts
import { configureTelemetry } from "@/lib/telemetry/track";

// e.g. in a top-level client component, gated on a NEXT_PUBLIC_* flag:
configureTelemetry((event) => {
  navigator.sendBeacon("/api/collect", JSON.stringify(event));
});
```

The sink only ever receives payloads that have already passed name validation
and deep redaction, so it never has to re-sanitize.

### Emitting an event

Use `track()` directly for enum/boolean events, or a builder for events with
numeric dimensions (so raw numbers are bucketed before they become fields):

```ts
import {
  track,
  toolCompletedEvent,
  handoffCreatedEvent,
} from "@/lib/telemetry/track";

// A page view (client effect):
track({ name: "tool_viewed", toolSlug: "merge-pdf", capability: "in-browser" });

// A completed run — raw numbers in, coarse buckets out:
track(
  toolCompletedEvent({
    toolSlug: "compress-pdf",
    capability: "in-browser",
    inputCount: files.length,
    outputBytes: result.byteLength,
    elapsedMs: elapsed,
  }),
);

// A workspace → tool handoff:
track(handoffCreatedEvent({ toolSlug, mode, fileCount: files.length }));
```

`worker_status_checked` is already emitted by the live status surface below.

---

## Phase 32 scheduler templates

Phase 32 packages the Phase 31 healthcheck into deployable scheduler examples under
[`docs/examples/deployment`](examples/deployment): cron/systemd wrappers, a Kubernetes
CronJob, and a GitHub Actions fixture gate. Every template uses the documented
`worker:ops-check` exit ladder (`0` ok, `1` usage, `2` unknown, `3` warning, `4`
critical) and preserves the alerting rule: page/notify on `2`–`4`, fix the monitor on
`1`. The examples are inert until an operator wires a real notifier or cluster alert.

Run `pnpm deploy:examples:check` to validate that the templates remain placeholder-only,
content-free, and free of committed endpoints/secrets.

## Worker status surfaces

### `GET /api/worker/status`

The honest, **presence-only** view of the worker layer. The browser can't read
server env vars, so the UI asks this endpoint what the active worker can actually
do right now. It reports the resolved mode and (for compression) capability
**only** — never a secret, a path, or a variable value. See
[`WORKER_ARCHITECTURE.md`](./WORKER_ARCHITECTURE.md) for the full contract.

### The `/status` page

[`src/app/status/page.tsx`](../src/app/status/page.tsx) is a user-facing page
that summarizes **what runs where in this environment**:

- **In-browser tools** — the tools with a real on-device runner today. Always
  available; files never leave the browser.
- **Secure worker** — read **live** from `/api/worker/status`. Shows the honest
  detail for the current mode (`disabled` / `remote-configured` / `local-dev`).
  A fetch failure is a recoverable error (with a retry), never a dead end.
- **Heartbeat liveness (Phase 30)** — if `PDFXYZ_WORKER_HEARTBEAT` is explicitly
  enabled and the Redis/Upstash queue broker is configured, the daemon publishes a
  bounded heartbeat record and `/api/worker/operations` can report
  `daemonObserved:true` while that beat is fresh. Disabled remains neutral; stale or
  absent beats are warnings, not fabricated “alive” states.
- **What runs where** — a static explainer of the four capabilities
  (`in-browser`, `hybrid`, `secure-worker`, `ai`) and whether each uploads files.

Reading the endpoints emits a `worker_status_checked` event (mode + enabled flag)
and a `worker_operations_checked` event (mode + overall health class + recommended
action + `drainable`/`daemonObserved` booleans) — bounded enums only, never a count
or identifier. The reusable UI primitives (`StatusBadge`, `RecoverableError`,
`AssuranceNote`) live in
[`src/components/status/status-ui.tsx`](../src/components/status/status-ui.tsx)
and are shared with the tool runners.

---

## Worker operations snapshot + SLO metrics (Phase 28)

Phase 28 adds a dedicated operator surface in addition to the user-facing worker status
endpoint:

- `GET /api/worker/operations` returns a **web-vantage** `WorkerOperationsSnapshot`:
  `version`, `vantage`, `mode`, `drainable`, `daemonObserved`, overall `health`, one
  `recommendedAction`, per-subsystem health, engine/OCR proof tri-states, lifecycle
  verification state, and the last loop outcome when collected from a worker. From the
  web app, `daemonObserved:false` and worker-image engine proofs are `unknown`; the app
  never pretends a separate daemon is deployed.
- `worker:daemon --dry-run-status`, `--check`, and real run modes emit content-free
  `operations`, `metrics`, and `slo` JSON lines. The daemon-vantage snapshot can include
  host probes and last-loop counters because it runs in the worker process.
- Metrics are fixed-name, low-cardinality samples (`worker_run_total`,
  `worker_processor_total`, `worker_processor_latency_seconds`, `worker_storage_ops_total`,
  `worker_readiness`, `worker_engine_capability`, lifecycle counters, etc.). Labels are
  bounded enums only; latency/depth/age are coarse buckets. No metric label can contain a
  filename, object key, URL, endpoint, bucket name, env value, command path, scanner
  signature, OCR text, or job/user id.
- SLO reports are pure calculations over a metric snapshot. Missing observations return
  `unknown`; latency percentiles are bucket upper bounds (for example `≤2.5s`), not
  invented exact timings.

### The operations dashboard (Phase 29)

The `/status` page renders the `/api/worker/operations` snapshot as an operator-facing
dashboard beneath the user capability summary — the same worker stack, projected into
SLO health classes and a single next action. It lives in
[`src/components/status/operations-dashboard.tsx`](../src/components/status/operations-dashboard.tsx)
(the live-fetching shell) and
[`src/components/status/operations-ui.tsx`](../src/components/status/operations-ui.tsx)
(the presentational body), and shows:

- an **overall health card** (the `ok`/`warn`/`blocked`/`unknown` class a pager reads,
  plus the vantage, mode, and drainability facts);
- the single **recommended next action** callout;
- a **subsystem grid** using the bounded health classes;
- the **lifecycle verification** rung and the **engine/OCR proof** tri-states (honestly
  `unknown` from the web);
- a **last-worker-loop** card when the snapshot is worker-vantage (absent from the web);
- **Daemon honesty** — without Phase 30 heartbeat configured, the web-vantage
  `daemonObserved` remains `false`; with heartbeat configured, it becomes `true` only for a
  fresh provider-backed beat. The dashboard states plainly that disabled/stale/absent
  heartbeat states mean liveness is not confirmed, while a fresh heartbeat proves only a
  recent daemon write — not job success.

Two honesty rules make the UI safe to point at any environment: it renders **only from
the bounded enums** (health classes, the recommended-action enum, subsystem ids, proof
tri-states, the lifecycle verdict) mapped to **client-authored copy** — never a
server-provided free-form string — so a malformed or hostile response cannot surface an
endpoint, object key, filename, or secret; and a fetch failure is a recoverable error
with a retry that explicitly does **not** claim a worker is down. Loading/error/retry
states are graceful, and the user-facing capability summary above is never blocked by
the operations fetch.

**Interpreting the states.** `ok` (green) means everything observable from this vantage is
healthy; `warn` (amber) means a recommended fix is outstanding but a worker can still run;
`blocked` (red) means a worker cannot run correctly here until the recommended action is
taken; `unknown` (grey) means *not observable from this vantage / not declared* — it is
never a green default and never implies failure. A `disabled` worker mode resolves to the
same honest `blocked` "configure the queue and storage" verdict — nothing is faked. The
dashboard reports **health posture, not timeseries**: live SLO **rates** (job success rate,
p95/p99 latency, retry/dead-letter/scanner-unavailable rates over a traffic window) come
from the worker's in-memory metrics collector and its `slo`/`metrics` JSON lines, and
surfacing them anywhere other than the daemon's own logs still requires the
**bring-your-own metrics backend** described above — the web `/status` page never
fabricates them.

Suggested alerts:

| Signal | Alert posture |
|---|---|
| `operations.health=blocked` | page/operator action required before workers can drain |
| `recommendedAction=fix-guardrail` | deployment should not start; inspect `worker:daemon --check` codes |
| `lifecycleVerification.verdict=drift` | retention backstop is not enforced as generated |
| SLO `dead_letter_rate=breach` or `retry_rate=breach` | queue/processor reliability incident |
| SLO `scanner_unavailable_rate=breach` when scanner required | fail-closed scan dependency incident |

### Export & examples (bring your own backend)

There is **no bundled metrics backend and no egress**. The collector holds samples in
memory; ship the daemon's `metrics`/`slo`/`operations` JSON lines to your own pipeline,
or scrape the Prometheus text-exposition form produced by `renderPrometheus(snapshot)`
(the processor-latency histogram is emitted canonically as `_bucket` + `_count`, so
`histogram_quantile()` works directly). To point metrics somewhere else, implement a
`WorkerMetricSink` and hand it to the runtime/daemon — no call site changes.

Provider-neutral, content-free examples live in
[`docs/examples/observability/`](examples/observability/): a `dashboard.json` model, a
per-SLO `alerts.json`, and an illustrative Prometheus `alerts.prometheus.yml`. A static
test (`observability/examples.test.ts`) pins every example to the metric schema — every
metric, label, and SLO id it references must be on the allowlist — and asserts it stays
content-free, so an example can never drift from the code.

## Operator healthcheck & alert evaluation (Phase 31)

The snapshot + SLO layers above answer "is the stack healthy?" as *data*. Phase 31 adds
the piece that turns that data into a **decision a monitor keys on**, with no metrics
backend and no pager: a pure alert policy (`src/lib/workers/observability/alerts.ts`) and
a CLI over it (`pnpm worker:ops-check`, `scripts/worker-ops-check.ts`).

### What it does

`evaluateOperationsAlerts(snapshot, sloReport?)` maps a content-free
`WorkerOperationsSnapshot` — plus, when a metric window is available, an `SloReport` —
onto bounded **severities**, **reasons**, and **actions**:

- **severity** — `ok` / `warn` / `critical` / `unknown` (the coarse projection of the
  finer snapshot `HealthClass` and SLO `SloStatus`; a blocker or an SLO breach is
  `critical`, `unknown` never over-pages);
- **reason** — a fixed enum (`not-drainable`, `scanner-unavailable`, `lifecycle-drift`,
  `liveness-stale`, `slo-breach`, …), so a rule can match on the reason, not free text;
- **action** — a fixed enum with fixed, content-free copy authored in code
  (`install-ocr-engine`, `investigate-backlog`, `reconcile-lifecycle-drift`, …).

Honesty rules carry straight through from the snapshot: a stale/absent heartbeat is
actionable **only** when liveness observation is enabled (a `disabled` seam stays a
neutral "confirm a worker out-of-band"), and an `unknown` overall class surfaces as
`unknown` (never a flattering `ok`).

### The command

```sh
pnpm worker:ops-check                # on the worker host: full runtime evidence + heartbeat
pnpm worker:ops-check --web          # on a monitor host: config-only web-vantage + heartbeat
curl -s "$APP/api/worker/operations" | pnpm worker:ops-check --stdin   # evaluate a scraped snapshot
pnpm worker:ops-check --file=snapshot.json --prometheus                # gauges for a scrape
```

Sources are mutually exclusive (`--runtime` default, `--web`, `--stdin`, `--file=<path>`);
formats are `--json` (default), `--prometheus`, `--text`. An ingested snapshot may be a
bare snapshot, the `GET /api/worker/operations` body, or `{ operations, metrics }` (a
`metrics` series enables the full SLO indicators; a bare snapshot evaluates the
config/liveness posture only).

### Exit codes (the monitor contract)

Higher is worse; `1` is a distinct "the check itself was misused" band, so a
misconfigured monitor is never mistaken for a (un)healthy worker. **These are the
ops-check codes and differ from the daemon's** (`worker:daemon`, documented in the
runbook).

| Code | Meaning |
| ---- | ------- |
| `0` | OK — everything observable is healthy |
| `1` | usage — a bad flag, or unreadable/malformed input |
| `2` | UNKNOWN — worker health could not be determined (no data) |
| `3` | WARNING — a recommended fix is outstanding (a worker can still run) |
| `4` | CRITICAL — a worker cannot run correctly, or an SLO breached |

### Safe output contract

The JSON result (`schema: "pdfxyz.ops-check/1"`) is content-free **by construction**:
every field is a bounded enum, a boolean, a small integer count, or prose authored by the
alert policy / SLO helpers. On the ingest path the parser (`ops-check/ingest.ts`) is the
trust boundary — it validates each field against a bounded allowlist and **re-authors all
prose from the app's own maps**, so a hand-crafted snapshot carrying a filename, object
key, endpoint, or secret in a `detail` field can never reach the output; the offending
string is simply dropped. It never contacts a cloud service unless the existing heartbeat
seam is configured (the same disabled-by-default broker read the route uses).

### Wiring it to a monitor

It is **local evaluation, not a pager**. Point your scheduler + notifier at the exit code:

- **cron** — `*/5 * * * * cd /app && pnpm -s worker:ops-check --web || notify "$?"`;
- **uptime / healthcheck service** — run the container's `worker:ops-check` and alert on a
  non-zero, non-1 exit;
- **process supervisor** — a periodic liveness probe;
- **CI gate** — `pnpm worker:ops-check --file=fixture.json` to assert a posture in tests;
- **Prometheus** — `--prometheus` emits `pdfxyz_ops_check_severity` and per-subsystem
  gauges (all bounded-enum labels) alongside the existing metric series.

Runnable, content-free fixtures (healthy → ok, stale heartbeat → warn, lifecycle drift →
critical, scanner spike → critical, no-config dev → unknown) live in
[`docs/examples/observability/healthcheck/`](examples/observability/healthcheck/) and are
pinned by `ops-check/examples.test.ts`.

### On `/status` and the route

`GET /api/worker/operations` now attaches the same content-free `alerts` report, and the
`/status` operations dashboard renders it as an **Alert posture** callout (severity +
contributing reasons, mapped to client-authored copy — never a server string). It is the
verdict a monitor would report, shown in the UI.

### Still out-of-band

This does not store history, draw a timeseries, or notify anyone. A hosted metrics
backend and a real pager remain your infrastructure's job — ops-check only produces the
bounded verdict + exit code they consume.

## Production readiness checklist (observability)

- [ ] **Product analytics is inert by default.** With no sink configured,
      `track()` is a no-op in production — verified by `track.test.ts`.
- [ ] **If a sink is wired**, confirm it only receives redacted payloads (it
      does — redaction happens before the sink) and that its endpoint origin is
      added to the CSP `connect-src` (same-origin paths are already covered by
      `'self'`).
- [ ] **`/status` is reachable and honest.** The footer "Status" link points to
      `/status`; the page reports `disabled` in an environment with no worker,
      and never over-promises a capability.
- [ ] **`/api/worker/status` leaks nothing.** Presence-only response; no secret,
      path, or variable value. Covered by its route test and an e2e assertion.
- [ ] **No raw values in events.** Sizes/counts/durations are bucketed; the
      redactor is the backstop. Covered by unit tests.
- [ ] **Error/Web-Vitals reporting** (the sibling seam) is configured per
      [`DEPLOYMENT.md`](./DEPLOYMENT.md) — off unless an endpoint is set.

---

## Invariants

- Adding or changing a product event is a **type-checked** change to
  `ProductEvent`; a name must also be added to `EVENT_NAMES` for `track()` to
  accept it.
- `track()` **never throws** — a telemetry failure must never take down a render
  or a tool run.
- Redaction is **pure and idempotent**, so every rule is deterministically
  unit-testable.
- The default build (and the e2e suite that exercises it) is **completely quiet**:
  no beacons, no console noise, no cross-origin requests.

## Worker provider status fields

`/api/worker/status` includes presence-only readiness for `storage`, `queue`, and `processor`. These fields are safe to expose: they report provider class/capability and readiness, never variable names, secret values, bucket names, queue names, object keys, file names, or paths. With Phase 14, `storage.provider` may be `s3` and `ready: true` when S3/R2-compatible storage is fully configured; that still does **not** expose endpoint, region, bucket, prefix, key id, or any `PDFXYZ_*` variable. With Phase 15, `queue.provider` may likewise be `redis` with `ready: true`/`configured: true` when a Redis/Upstash broker is fully configured — independently of storage — and it exposes no endpoint, token, prefix, key name, or variable. The web app never processes jobs itself, so in every non-dev mode `processor.ready` stays `false` — that alone is expected, not an alert. With Phase 16, a separate `daemon` field reports the out-of-band worker daemon's readiness: `drainable` (queue + storage both configured, so a deployed worker *could* drain here), `queueConfigured`/`storageConfigured`, and `runsInThisProcess` (always `false` — the app can never observe whether a worker is actually running). It exposes no endpoint, token, prefix, key, or variable. **What is worth alerting on** is the queue backlog: `daemon.drainable: true` while queued jobs are not decreasing for a sustained period means the queue and storage are wired but no worker daemon is actually draining them (deploy or restart it). Telemetry should record only coarse mode/readiness booleans if these fields are wired into events. The `processor.executor` field (Phase 13) is the same shape of promise: it reports the execution-loop mode (`in-process` / `not-implemented` / `none`) and a client-safe detail, never a broker name or worker URL.

## Worker executor logs (Phase 13)

The worker executor (`src/lib/workers/executor/`) accepts an optional structured
log sink — `log(event)` — that is **content-free by construction**, the operational
counterpart of the product-analytics rule above. Each `ExecutorLogEvent` carries
only:

- `event` — a fixed enum (`claimed`, `scanning`, `scan_clean`, `scan_blocked`,
  `processing`, `completed`, `failed`, `requeued`, `canceled`, `no_processor`,
  `input_missing`);
- `jobId` — an opaque, server-minted id (`job_…`);
- `tool` — the public tool slug;
- `attempt` — the delivery attempt number;
- `errorCode?` — a coarse, typed error *code* (never a message with detail).

It **never** receives file bytes, a file **name**, an object key, a temp path, an
option value, or document text — the same invariant the product-analytics and
telemetry seams enforce. The Phase 16 daemon (`pnpm worker:daemon`) forwards these
events straight to stdout as structured JSON (queue depth from `claimed` vs terminal
counts, failure rate by `tool` + `errorCode`, redelivery rate from `requeued`)
without any additional scrubbing, and adds its own equally content-free
`DaemonLogEvent` layer — a run `mode`, a `tick` counter, the per-tick `outcome`, an
opaque `jobId`/`attempt`, an error *code*, a `sleepMs` back-off, and a terminal
`reason` — plus a final run `summary` of counters (completed / failed / requeued /
canceled / idle / errors). Nothing in either layer carries a secret, byte, key, URL,
or filename, so the daemon's stdout can be shipped verbatim to a log sink. Phase 18
filename metadata remains outside observability: sanitized display names may shape a
user's download prompt, but they never enter status payloads, telemetry events, or
executor/daemon log events. The `WORKER_ARCHITECTURE.md`
"Observability" plan (structured logs keyed by `jobId`, metrics, tracing per job)
is exactly what these events feed.

At startup (and on `--dry-run-status`) the daemon also emits a content-free
`compression_health` readiness line — `{ lossless: true, deep, engines }` — **distinct
from `readiness.drainable`** (Phase 17). Drainability answers "is a queue + storage
wired so this worker can claim and complete jobs at all?"; `compression_health.deep`
answers the orthogonal "will `deep` image compression actually run on THIS worker
image, or only the always-available lossless repack?". A worker can be drainable yet
lossless-only because no native engine is installed. `engines` lists the detected
engines by **binary name only** (no path, version, or value), so an operator can alert
on "drainable but `deep: false`" when deep compression is expected. It is as content-
free as every other line and ships to the log sink as-is. Phase 24's `pnpm
worker:image-smoke` reads exactly this line **inside the built worker image** to prove
the packaged deep-compression engine is reported present there, not merely installed
on disk.

## Malware-scan gate logs (Phase 22)

The executor runs a **malware-scan gate** on a job's inputs before it advances to
processing (`src/lib/workers/scanner/`). Phase 22 ships an **optional ClamAV/clamd**
backend behind it, off by default. With no scanner configured the wired no-op inspects
nothing and returns `skipped` — the job proceeds and **no log event is emitted for the
skip**, so a job that goes straight `claimed → scanning → processing` is transparently
signalling "not scanned". When a scanner IS active (a configured clamd endpoint or an
injected provider), two events appear:

- `scan_clean` — a scanner actually inspected the bytes and passed; logged **before**
  `processing`, so its presence is the audit proof that an input was scanned, and its
  absence is the honest signal that it was not.
- `scan_blocked` — the gate blocked an input **before** processing (non-retryable,
  **no artifact written**): either a detected threat (error code `malware_detected`)
  or an input the scanner cannot scan and never will — e.g. it exceeds the hard size
  limit (error code `scan_invalid`, a deliberate **fail-closed** so nothing is
  processed unscanned). A high-signal **security** event worth alerting on: a nonzero
  `scan_blocked` rate on a worker with an active scanner means real detections (or a
  size-limit misconfiguration) — investigate.

A scan that could not complete (clamd unreachable/timed out for a *required* scanner)
reuses `requeued`/`failed` with the `scan_unavailable` error code — retryable, never
downgraded to "clean" (an *optional* scanner degrades to `skipped` instead). None of
these carry a filename, a scanner **signature name**, an endpoint, a byte, or a value:
clamd's reply is classified so the signature is dropped at the protocol layer, and the
scanner's own `detail` is deliberately **not** propagated into the job error or the
log — the client-facing error is a fixed, content-free message.

At startup (and on `--dry-run-status`) the daemon emits a content-free `scanner_health`
line — `{ active, provider, detail }` — alongside `compression_health`. `active` is
`true` only when a scanner (ClamAV) is configured with a usable endpoint; `provider`
distinguishes `not-configured` (nothing declared), `disabled` (explicitly off),
`unavailable` (selected but its endpoint is missing/malformed — inactive), and
`clamav` (active), without ever exposing the endpoint host, port, socket path, or the
variable name. Alert on `active: false` (or `provider: unavailable`) on a worker you
intend to be scanning; `not-configured`/`disabled` on a worker that isn't meant to
scan is the honest baseline, not an incident.

The daemon likewise emits a content-free **`ocr_health`** line (Phase 23) —
`{ enabled, engine, ready, detail }` — alongside `compression_health`/`scanner_health`.
It fuses the config opt-in (`enabled`, from `PDFXYZ_OCR`) with the runtime engine probe
(`ready`), so the four honest OCR states are unambiguous: `enabled: false` ⇒
disabled/not-configured (the safe default); `enabled: true, ready: false` ⇒ *unavailable*
(opted in, but no OCRmyPDF/Tesseract installed); `enabled: true, ready: true` ⇒ *ready*.
`engine` is the pinned engine *family* name (or `null` for auto-detect), never a path,
binary, language, or value. Recognized text never appears here (or anywhere in the log
stream) — it lives only in the downloaded artifact. Alert on `enabled: true, ready:
false` on a worker you intend to run OCR (the engine isn't installed); `enabled: false`
on a worker that isn't meant to do OCR is the honest baseline, not an incident.

## Container health check (Phase 19)

The worker image's `HEALTHCHECK` (and the `docker-compose.worker.yml` example) runs
`pnpm worker:daemon --dry-run-status`, whose **exit code is the health signal**: `0`
when the queue *and* storage are configured (drainable), `2` when they are not. The
probe claims no job and processes nothing; it emits the same content-free `readiness`
and `compression_health` lines described above and then exits. So an orchestrator's
liveness/readiness gate is driven entirely by presence-only signals — never a secret,
key, or value. `pnpm worker:daemon:status` is the identical probe as a package script,
and `pnpm worker:smoke` is the offline, no-config honesty check (exit-code contract:
`0`/`1`/`2`/`4`) suitable for CI — the Phase 20 container workflow re-runs this same
smoke **inside the built worker image**. Phase 24 adds a companion image check to
that same workflow: `pnpm worker:image-smoke` also runs **inside the built worker
image** as an image-level native-engine + OCR presence/readiness proof — it confirms
the packaged deep-compression and OCR engines are installed and that opting in with
`PDFXYZ_OCR` flips the daemon's `ocr_health` to `ready: true` (and
`compression_health` to `deep: true`), reading that verdict **presence-only** from the
content-free `ocr_health`/`compression_health` log lines (no path, secret, or value)
and processing no document. Where `worker:smoke` proves the offline, no-config
exit-code contract, `worker:image-smoke` is its image counterpart — proof the
packaged engines report ready, never that any document was recognized. Phase 25 adds a
**behavior** counterpart to that same workflow, `pnpm worker:ocr-proof`, which runs
inside the built worker image *after* the presence checks: it OCRs a generated sentinel
raster with the Tesseract baseline and asserts the sidecar contains the sentinel —
genuine recognition on a synthetic, non-user-document fixture. Its output is likewise
presence-only and content-free (it never prints a temp path or the recognized text), and
it always cleans up its temp dir. Phase 27 adds the PDF→PDF counterpart to that same
workflow, `pnpm worker:ocrmypdf-proof`, run **inside the built worker image** after the
recognition proof: it builds a synthetic **image-only** PDF (Ghostscript's `pdfimage`
device — no text layer), confirms with `pdftotext` that the source yields no selectable
text, runs the packaged OCRmyPDF, and confirms with the same `pdftotext` that the
**output** yields the sentinel — proving image-only became genuinely **searchable**,
again presence-only, content-free (never a path or the recognized text), and
self-cleaning. Alert on a worker that reports `2` when it is
expected to be drainable, exactly as you would alert on `drainable: true` with a
non-draining backlog.

Phase 26 makes a completed OCR job's **result metadata** observable to a client via the
job status API: `GET /api/jobs/:id` now returns `results.ocr` — the engine family
(one of the closed set `ocrmypdf`/`tesseract`/`unknown`), validated languages, output
mode, produced artifact kinds, and page/character **counts**. Like every other job field
it is presence-only and content-free: it carries no recognized text, filename, object
key, signed URL, temp path, or secret, and it is written only on a genuinely completed
job and dropped when the outputs are deleted. There is still **no OCR-specific executor
log field** — the per-job log line remains `claimed → scanning → [scan_clean] →
processing → completed` with an error *code* only — so no recognition detail can leak
through the log stream; the structural metadata lives on the job record alone.

## Deployment readiness & guardrail events (Phase 19)

`--dry-run-status` and `--check` extend the daemon's content-free log stream with the
composed deployment picture. All fields are presence-only — booleans, typed states,
and generic prose — with **no** variable name, value, path, object key, or signed URL.

| `event` | Fields | Meaning |
| --- | --- | --- |
| `deployment_readiness` | `posture` (`ready`\|`degraded`\|`blocked`), `drainable`, `detail` | Overall posture. `blocked` = not drainable; `ready` = drainable + validated lifecycle; else `degraded`. |
| `facet` | `id`, `state`, `detail` | One per facet: `storage`, `queue`, `engine`, `lifecycle`, `malware-scan`, `ocr`. `state` ∈ `ready`\|`degraded`\|`not-configured`\|`not-implemented`\|`unknown`. |
| `guardrails` | `ok`, `strict`, `errors`, `warnings` | Guardrail summary. `ok:false` ⇒ the daemon exits `4` before claiming work. |
| `guardrail` | `code`, `severity`, `message` | One per violation. `code` is typed; `message` is content-free and names no variable. |
| `lifecycle_policy` | `provider`, `versioned`, `filename`, `applyHint`, `derivedFrom`, `ruleCount`, `notes`, `document` | Emitted by `--lifecycle-policy`. `document` is the content-free policy JSON; `applyHint` uses a `<bucket>` placeholder. |
| `lifecycle_policy_error` | `reason` (`retention_invalid`\|`policy_invalid`) | Generation refused (exit `1`) rather than emitting from silent defaults. |
| `lifecycle_verify` | `configured`, `verdict` (`verified`\|`drift`\|`unknown`), `provider`, `versioned`, `declaredReadiness`, and (when `configured`) `checks[]`, `plan[]`, `unmatchedObservedRules`, `summary` | Emitted by `--lifecycle-verify`. `verdict` ⇒ exit `0` verified · `2` unknown (no `--observed` doc) · `4` drift. `checks[].ruleId` are the app's own `pdfxyz-*` ids; `status` ∈ `satisfied`\|`stricter`\|`weaker`\|`disabled`\|`missing`; `plan[].action` ∈ `create`\|`update`\|`review`. `unmatchedObservedRules` is a **count** — no observed rule id, prefix, or value is echoed. |
| `lifecycle_verify_error` | `reason` (`retention_invalid`\|`policy_invalid`\|`observed_unreadable`\|`observed_too_large`\|`observed_malformed`), optional `issues[]` (parse codes) | `--lifecycle-verify` refused (exit `1` for retention/policy, `4` for an unreadable/oversized/malformed observed document). Names no path or document content. |

**What to watch.** The `malware-scan` facet is `not-configured`/`disabled` until an
operator configures the optional ClamAV backend, and the `ocr` facet is
`not-implemented`/`not-configured` until an operator opts into the optional OCR backend
(Phase 23) — honest baselines, not incidents. Once a scanner is configured, watch for the
facet reporting `degraded`/`unavailable` (a misconfigured endpoint) on a worker you
intend to scan; once OCR is enabled, watch the `ocr_health` line for `ready: false` (the
engine isn't installed) on a worker you intend to run OCR. The malware-scan guardrails
are the opt-in `require_scan_unmet` (armed by `PDFXYZ_WORKER_REQUIRE_SCAN`; fails
`--check` with exit `4` when scanning is required but not active — an intentional refusal
to run unscanned) plus `scan_selected_but_invalid` / `scan_provider_unrecognized` (a
misconfigured or unknown scanner value, so a typo can't silently disable scanning). The
OCR guardrails mirror them: the opt-in `require_ocr_unmet` (armed by
`PDFXYZ_WORKER_REQUIRE_OCR`; exit `4` when a ready OCR engine is required but absent)
plus `ocr_config_invalid` (a malformed `PDFXYZ_OCR*` value, so a typo can't silently
disable OCR). Neither require flag is folded into `PDFXYZ_WORKER_STRICT` — a worker that
does not scan or OCR is a legitimate production choice. A `lifecycle` facet of `unknown` on a drainable worker is
the expected "no backstop declared yet" state; alert if a production worker you intend
to be `ready` reports
`degraded`. If you wire `--lifecycle-verify` into CI or a scheduled check, a
`lifecycle_verify` `verdict` of `drift` (exit `4`) is the actionable signal that the
bucket no longer enforces the generated backstop — inspect `plan[]` for the `create`/
`update` actions needed to reconcile it; `unknown` (exit `2`) just means no exported
document was supplied that run. A non-empty `guardrails.errors` on a worker that fails to start (exit `4`)
is the fail-fast signal — inspect the `guardrail` `code`s (never a leaked value) to see
which provider/setting is misconfigured.

## Redis queue atomicity signals (Phase 21)

The Redis/Upstash provider's worker transitions are now atomic (`EVAL` scripts with
status and lease-attempt preconditions). Normal stale-worker races surface as existing
content-free queue outcomes: stale heartbeats/advances/finalizers return typed
`conflict`, while broker/script failures return typed `unavailable` and should be
alerted like any other Redis outage. No log/status line includes a Redis URL, token,
key prefix, object key, filename, or payload. Operationally, alert on:

- a spike in retryable `unavailable` queue errors (broker outage or unsupported
  atomic script execution);
- elevated requeue/redelivery counts (workers are losing leases or timing out);
- dead-letter growth after the configured max attempts.

## Abuse guard rate-limit signals (Phase 33)

The public-API abuse guard (`src/lib/ratelimit`) **emits no product-analytics
event of its own** — a server-side limiter has no business calling the client
telemetry reporter. Instead it produces a **content-free decision** an operator can
fold into ordinary server logs or an edge metric without any redaction step. Every
field on a `RateLimitDecision` is a fixed enum, a stable policy id, or an integer
derived purely from the policy window + clock:

| Dimension          | Values                                                              |
| ------------------ | ------------------------------------------------------------------- |
| `action`           | the guarded route capability (e.g. `jobs.create`)                   |
| `policyId`         | the stable policy label that fired                                  |
| `provider`         | `disabled` \| `local-memory` \| `remote` \| `remote-unimplemented`  |
| `enforced`         | boolean — `false` for every fail-open / not-configured allow        |
| `allowed`          | boolean                                                             |
| `retryAfterBucket` | coarse wait bucket (`none`/`<10s`/`10-60s`/`1-5m`/`5-15m`/`15m+`)    |

None of these is an IP, user agent, filename, token, object key, job id, env value,
or request body — the same no-leak posture as `/api/worker/status` and
`/api/worker/operations`. On deny the same values back the `Retry-After` and
`RateLimit-*` response headers. Operationally, if you log the decision, alert on a
sustained rise in denied (`allowed: false`) decisions per `action`/`policyId`, and
treat a jump in `enforced: false` **while a provider is configured** as a limiter
outage (the guard is failing open — see docs/SECURITY.md). The guard itself keeps no
counters beyond the live in-memory windows and exposes no metrics endpoint; the
timeseries backend remains bring-your-own.

### Distributed provider status (Phase 34)

The shipped distributed provider (`src/lib/ratelimit/redis.ts`) adds a **content-free
status taxonomy** for confirming that cross-instance enforcement is actually running.
`resolveRateLimitStatus()` (and `statusForDecision()` for the runtime case) reports one
of five bounded codes — diagnostics name environment **variables** only, never a value
or endpoint:

| Status code | Meaning | Enforcing? |
| --- | --- | --- |
| `disabled` | No provider selected (the default). | no |
| `local-memory` | Per-process dev limiter — real, not distributed. | yes (per process) |
| `remote-missing-config` | Remote selected, but no valid store / no provider registered — skips honestly. | no |
| `remote-configured` | Remote selected, store valid, provider registered — distributed enforcement. | yes (distributed) |
| `remote-error-fail-open` | Configured, but the last request came back unenforced — the store is erroring and the guard is failing **open**. | no (alert!) |

Confirming and monitoring, without any secret ever crossing the wire:

- **At boot**, `src/instrumentation.ts` logs one content-free line — e.g.
  `[pdf.xyz] rate-limit provider: remote-configured` — only when a provider is selected
  (a default deployment stays silent). Scrape it to confirm the resolved status.
- **In a runbook one-liner**, print the resolved status without contacting the store:
  ```sh
  node -e "import('@/lib/ratelimit').then(m => console.log(m.resolveRateLimitStatus().code))"
  ```
- **End-to-end**, hammer a cheap guarded endpoint past its budget and watch for `429`s
  with a `Retry-After` header (proves enforcement is live across the instances a load
  balancer fans out to):
  ```sh
  for i in $(seq 1 200); do curl -s -o /dev/null -w "%{http_code}\n" \
    https://<your-host>/api/worker/status; done | sort | uniq -c
  ```
- **Alert** on a sustained `remote-error-fail-open` (fail-open: not enforcing) or, when
  `PDFXYZ_RATE_LIMIT_FAIL_MODE=closed`, on a `429` spike on the guarded actions (a
  fail-closed store outage sheds load as denials rather than surfacing as fail-open).

## Upload intake metrics and alerts

Phase 35 intake rejections are safe to count by stable code (`invalid_upload_request`, `unsupported_file_type`, `too_many_files`, `file_too_large`, `request_too_large`, `malformed_pdf`) and optional positional index/limit buckets. Do not attach filenames, object keys, signed URLs, request bodies, content bytes, scanner signatures, or raw client identity. A spike in `file_too_large` or `request_too_large` usually indicates client-side declaration drift or a limit change; a spike in `malformed_pdf` means optional envelope sniffing is rejecting files and does not prove malware or sanitization outcomes.

## Worker soundness metrics

Phase 36 adds content-free soundness signals. Count `worker_soundness_total` by low-cardinality verdict/reason/check-size buckets only; never attach filenames, object keys, signed URLs, job IDs, scanner signatures, byte samples, or document text. `unsound` is an executor failure class that indicates the worker preflight blocked processor execution. Alert on sustained `unsound` spikes by reason, especially `size_mismatch` (metadata/storage drift) and `malformed_pdf` (clients sending non-PDF bytes to PDF tools), but avoid claiming malware or sanitization outcomes from this metric.

## Worker artifact-manifest metrics

Phase 37 adds content-free artifact-manifest signals. `worker_artifact_manifest_total` counts each produced output by four bounded enum labels only — `verdict` (`valid`/`invalid`/`skipped`), `reason` (the closed manifest reason taxonomy), `kind` (`pdf`/`text-sidecar`/`archive`/`image`/`unknown`), and `processor` (`compress`/`ocr`/`other`); never a filename, object key, signed URL, job ID, byte sample, or document text. `artifact` is an executor failure class that indicates the manifest gate blocked publication of a processor's outputs (the job fails with `artifact_invalid` and no artifact is written). Alert on sustained `invalid` spikes by reason — `empty_artifact`/`no_artifacts` (a processor producing degenerate output), `content_type_mismatch`/`unsupported_content_type` (a tool emitting the wrong kind), or `missing_retention_class` (retention-policy drift) — but this metric is structural provenance validation only; do not read malware, sanitization, OCR-correctness, or deletion outcomes from it. The optional artifact receipt carries a bounded `category` (`generated`/`rejected`/`cleaned`) plus the same coarse buckets, never content.

Phase 38 adds a content-free **retrieval-decision** signal for the client-facing download boundary, extended by Phase 39 with a storage-provider dimension. `worker_artifact_retrieval_total` counts each download decision by four bounded enum labels only — `outcome` (`served`/`denied`), `reason` (the closed retrieval-access taxonomy: `ok`, `malformed_handle`, `storage_unavailable`, `storage_error`, `policy_unavailable`, `not_found`, `deleted`, `not_ready`, `expired`, `job_mismatch`, `missing_manifest`, `invalid_manifest`, `unsupported_kind`, `empty_artifact`), `kind` (the served output kind, or `unknown` for a denial), and — as of Phase 39 — `provider` (`local-dev` / `remote-configured` / `not-configured`, so a dashboard can split local-dev from storage-backed retrieval); never a handle, filename, object key, bucket name, signed URL, job ID, byte count, or document text. Because the download route is a web endpoint rather than part of the DI'd executor, it emits through an injectable sink (`src/lib/workers/artifacts/retrieval-metrics.ts`) that DEFAULTS to a no-op — the honest "not collected" — so a deployment opts in by pointing it at a collector. A parallel per-attempt **retrieval receipt** (`src/lib/workers/artifacts/retrieval-receipt.ts`) carries the same bounded outcome/reason/kind/provider plus the stable policy id/version to an OPTIONAL operator observer (default none) for an audit trail — never content. Alert on sustained `denied` spikes by reason: `invalid_manifest` (a provenance/byte desync between the manifest and stored bytes), `expired`/`deleted` (clients retrying past the retention window or after an explicit delete), `unsupported_kind` (a producer emitting an unrecognized kind), or — on the `remote-configured` provider — `storage_error` (transient bucket read failures: a retryable `503`, distinct from `storage_unavailable`'s "no backend at all", so a sustained `storage_error{provider="remote-configured"}` spike means the bucket is reachable-but-flaky, not misconfigured). This is a bounded structural + lifecycle eligibility signal only; do not read authentication, authorization, malware, sanitization, or deletion outcomes from it — the boundary has no auth model (`job_mismatch` is a caller-opted `?job=` integrity mismatch, not an access-control verdict).

Phase 40 adds a **second** content-free download signal, `worker_artifact_delivery_total`, for the *delivery* gate that runs after access is granted (`src/lib/workers/artifacts/delivery-metrics.ts` → `delivery-receipt.ts`, same injectable sink pattern, default no-op/none). The access metric above answers "was the handle granted"; this one answers "given access, were the bytes then safely delivered". Same four bounded enum labels — `outcome` (`delivered`/`denied`), `reason` (the closed delivery taxonomy: `ok`, `size_mismatch`, `oversize`, `stream_error`), `kind`, and `provider` — never a handle, key, bucket, URL, byte range, size, or byte. The per-attempt **delivery receipt** additionally records the bounded HTTP `method` (`GET`/`HEAD`) and `range` disposition (`none`/`ignored` — a whole-file serve of a request that carried a `Range` this proxy does not honor), so "how are clients probing this endpoint — `HEAD` checks, range requests we do not serve" is auditable without any high-cardinality value. Alert on sustained `denied` spikes by reason: `size_mismatch` (the emitted `Content-Length` could not be verified against the stored bytes or an upstream provider's declared length — a truncated/over-declared/desynced object, refused rather than streamed under a lying header), `oversize` (an artifact past the fixed 1 GiB delivery ceiling — normally impossible, so investigate a tampered or pathological object), or `stream_error` (an unexpected serve failure — a backend that threw or a body that could not be built, caught and closed to a safe `503` rather than a framework `500`). Every delivery denial is a single client-facing `503 service_unavailable`; the precise reason lives only here and in the receipt. Like the access signal this is a bounded byte-consistency + method/range check only — **not** authentication, resumable serving, or content scanning. (Unsupported HTTP methods are refused a content-free `405` before any delivery decision is reached, so they do not appear in this metric.)
