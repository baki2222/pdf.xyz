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

## Live status surface

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
- **What runs where** — a static explainer of the four capabilities
  (`in-browser`, `hybrid`, `secure-worker`, `ai`) and whether each uploads files.

Reading the endpoint emits a `worker_status_checked` event (mode + enabled flag
only). The reusable UI primitives (`StatusBadge`, `RecoverableError`,
`AssuranceNote`) live in
[`src/components/status/status-ui.tsx`](../src/components/status/status-ui.tsx)
and are shared with the tool runners.

---

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
