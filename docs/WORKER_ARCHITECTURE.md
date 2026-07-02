# Secure Worker Architecture

`pdf.xyz` is browser-first. The secure-worker system exists only for operations the browser cannot do honestly or reliably: OCR, Office conversion, deep compression, repair, PDF/A, visual compare, irreversible redaction, e-signature workflows, and AI-assisted document intelligence.

Phase 6 added the **contract layer** for those workers. Phase 7 adds the first real processing path: a mode-gated **worker adapter** and a developer-only **local compression worker**. Neither ever fakes success — when a real processor is unavailable, the API says so.

## Current implementation status

| Layer | Status |
| --- | --- |
| Typed contracts | Implemented in `src/lib/jobs/types.ts` |
| Capability mapping | Implemented in `src/lib/jobs/capabilities.ts` |
| Request validation | Implemented in `src/lib/jobs/validation.ts` |
| Development route stubs | Implemented under `src/app/api/uploads` and `src/app/api/jobs` |
| Tool-page worker preview | Implemented in `src/components/tools/worker-preview.tsx` |
| Worker mode + adapter selection | Implemented in `src/lib/workers/mode.ts` + `adapter.ts` |
| Compression engine (lossless + deep) | Implemented in `src/lib/workers/compression/` |
| Local-dev compression worker | Implemented in `src/lib/workers/local-dev.ts` (opt-in via `PDFXYZ_WORKER_MODE=local-dev`) |
| Worker status endpoint (presence-only) | Implemented in `src/app/api/worker/status/route.ts` + `src/lib/workers/status.ts` |
| Compress UI secure-worker integration | Implemented in `src/components/tools/runner/compress-runner.tsx` + `src/lib/workers/client.ts` |
| OCR job contract (options + result metadata) | Implemented in `src/lib/jobs/ocr.ts` |
| OCR capability mapping (presence-only) | Implemented in `src/lib/workers/ocr.ts` + `status.ts` |
| OCR tool-page secure-worker panel | Implemented in `src/components/tools/ocr-worker-panel.tsx` |
| OCR browser job client (contract-complete) | Implemented in `src/lib/workers/ocr-client.ts` |
| OCR native backend (OCRmyPDF/Tesseract) | Optional, **off by default** — `src/lib/workers/ocr-native{,-config}.ts` (Phase 23); see [`OCR_BACKEND.md`](./OCR_BACKEND.md) |
| Processor registry + contract | Implemented in `src/lib/workers/processor/` |
| Worker executor loop (claim → process → complete) | Implemented in `src/lib/workers/executor/` |
| Queue claim/lease/heartbeat (`ClaimableQueue`) | Implemented in `src/lib/workers/queue/` |
| S3/R2-compatible storage provider (production) | Implemented in `src/lib/workers/storage/s3*.ts` (opt-in via `PDFXYZ_STORAGE_PROVIDER=s3`) |
| Redis/Upstash queue provider (production) | Implemented in `src/lib/workers/queue/redis*.ts` (opt-in via `PDFXYZ_QUEUE_PROVIDER=redis`) |
| Atomic queue transitions (Lua compare-and-set) | Implemented in `src/lib/workers/queue/redis-scripts.ts` — every worker-owned transition is a server-side `EVAL` CAS on status + lease attempt (Phase 21) |
| Worker-side S3/R2 executor storage (byte I/O) | Implemented in `src/lib/workers/executor/s3-storage.ts` |
| Worker daemon runner (drains queue → executor → storage) | Implemented in `src/lib/workers/daemon/` + `scripts/worker-daemon.ts` (out-of-band; run via `pnpm worker:daemon`) |
| Native/lossless compression worker path (daemon completes `compress-pdf`) | Proven end-to-end over the S3 seam in `src/lib/workers/daemon/native-compression.integration.test.ts` — lossless always; deep with a native engine — plus a `compression_health` readiness distinct from drainability (Phase 17) |

The API route handlers stay thin: they validate shape, limits, MIME types, safe URL inputs, and tool eligibility, then **delegate to the worker adapter** selected for the current environment. By default the adapter answers honestly that no backend is configured; nothing is ever faked.

## Worker execution modes

`resolveWorkerMode()` (`src/lib/workers/mode.ts`) picks exactly one mode from the environment, reading only the *presence* of variables — never a secret value:

| Mode | When | API behavior |
| --- | --- | --- |
| `disabled` | default (no flags) | `503 worker_not_configured` |
| `remote-configured` | `PDFXYZ_WORKER_URL` + `PDFXYZ_STORAGE_BUCKET` + `PDFXYZ_JOB_QUEUE` all present | `501 not_implemented` (no pipeline shipped yet) |
| `local-dev` | `PDFXYZ_WORKER_MODE=local-dev` (explicit opt-in) | runs supported jobs in-process for real |

`getWorkerAdapter()` is the single seam the routes call. The local-dev implementation — and the Node built-ins it needs (`child_process`, `fs`) — is imported lazily, so the default and remote paths never load it.

## Local-dev compression worker (Phase 7)

Enabled only with `PDFXYZ_WORKER_MODE=local-dev`, this is a real, in-process worker for developing the compression pipeline end to end — reserve slot → upload → job → download — without object storage or a queue. It is **not** production infrastructure (in-memory, single-instance, lost on restart), but it is honest:

- **Two profiles.** `lossless` is a genuine structural repack via pdf-lib (always available). `deep` is image downsampling / re-encoding and genuinely requires a native engine — **Ghostscript, qpdf, or mutool**. The engine (`src/lib/workers/compression/engine.ts`) probes for these by *presence on PATH* and picks the first available.
- **No fake success.** If `deep` is requested and no native engine is installed, the job is recorded as **`failed`** with a typed `not_implemented` error and docs guidance — never a dummy “completed” file. Invalid PDFs fail as `unprocessable_entity`; engine crashes as a retryable `internal_error`.
- **Dev transport.** Bytes are uploaded to `PUT /api/uploads/local/:fileId` and outputs are fetched from `GET /api/artifacts/local/:artifactId`. Both endpoints are inert (`503`) unless local-dev mode is on, so the production build and e2e suite are unaffected.
- **Inputs are wiped after processing.** As soon as a job finishes — success *or* failure — the local worker deletes the input slot and its bytes (`DevWorkerStore.deleteSlot`), so an input is never held past its use. Upload slots are single-use: a second job referencing the same `fileId` honestly returns `not_found`. Outputs live on their own retention TTL and are dropped lazily once expired.
- **Separation of concerns.** This worker is deliberately distinct from the in-browser Compress analyzer (`src/lib/pdf/analyze.ts`), which only ever does lossless work on-device and never uploads.

### Discovering worker availability from the client

The browser can't read environment variables, so the Compress UI asks **`GET /api/worker/status`** (`src/lib/workers/status.ts`) whether a worker is actually available before offering the upload-backed path. The response is **presence-only** — the resolved mode plus, for compression, whether each profile can run and which native engines are installed (names only; never a path, version, or value). In `local-dev` mode the route performs a live PATH probe (lazily importing the Node-only native layer, exactly like the adapter); in every other mode it answers `disabled` / `remote-configured` with no capability.

The Compress tool page (`compress-runner.tsx`) always runs the on-device lossless analysis, then:

- **`disabled`** (default, production, e2e): shows the honest "not enabled in this environment" note. Nothing is uploaded.
- **`remote-configured`**: states a backend is configured but this build ships no pipeline yet.
- **`local-dev` with a native engine**: offers a real "Compress images on the worker" action that runs the full flow via `src/lib/workers/client.ts` (create session → upload → job → poll → download), clearly labeled **Local-dev worker · runs on this machine**.
- **`local-dev` without a native engine**: explains that no engine (Ghostscript/qpdf/mutool) is installed, so deep compression can't run here — without offering a button that would only fail.

To try it locally: run `PDFXYZ_WORKER_MODE=local-dev pnpm dev`, open `/tools/compress-pdf`, and add a PDF. With no native engine installed the page honestly says deep compression is unavailable (and a `deep` job via the API fails as `not_implemented`); a `{ "profile": "lossless" }` job via the API completes with a real, smaller PDF and a working download URL. Install Ghostscript/qpdf/mutool to enable the deep path and the in-page run button.

## OCR secure-worker foundation (Phase 11)

OCR is a **secure-worker-only** capability: turning a scan into a searchable PDF or a text sidecar needs a native OCR engine (OCRmyPDF/Tesseract) or a managed provider — the browser cannot do it honestly. Phase 11 builds the full contract, capability, UI, and testing foundation for OCR **without faking it**. No mode ships an OCR processing pipeline yet (the local-dev worker only compresses), so OCR reports as **unavailable in every environment this build runs in**, with a mode-specific reason. Nothing fabricates recognized text or a searchable PDF.

### OCR options contract (`src/lib/jobs/ocr.ts`)

`parseOcrOptions()` is the OCR analogue of `parseCompressionOptions`: a pure, dependency-free validator for the free-form `options` bag of an `ocr-pdf` job. It is what the future worker calls before touching a file, and what the tool UI runs so the on-screen summary always matches what would be submitted.

| Option | Rules |
| --- | --- |
| `languages` | A single code or an array of [ISO 639-2/T](https://en.wikipedia.org/wiki/ISO_639-2) codes from a curated allowlist (`eng`, `spa`, `fra`, `deu`, …). 1–4 entries, de-duplicated. An unknown code is **rejected**, never dropped. Defaults to `["eng"]`. |
| `outputMode` | `searchable-pdf` (invisible selectable text layer under the scan), `text` (a `.txt` sidecar), or `both`. Defaults to `searchable-pdf`. |
| `skipTextPages` | Boolean; skip pages that already carry a text layer (OCRmyPDF `--skip-text`) instead of re-recognizing them. Defaults to `false`. |

A completed OCR job attaches bounded, content-free metadata typed by `OcrResultMeta` and built by the pure `buildOcrResultMeta` (both in `src/lib/jobs/ocr.ts`): the engine family, validated languages, output mode, which artifact kinds were produced, a best-effort output **page count**, a text-sidecar **character count**, and an optional mean confidence. As of Phase 25 the native runner **measures and populates** these from the actual run (page count via pdf-lib, character count from the sidecar length) — never estimated. As of Phase 27 those counts are read from the artifacts **actually produced** — the page count from the produced searchable-PDF's bytes, never the input scan, and the character count from the produced sidecar — so the produced-kind flags and counts can't drift from the returned artifacts, and a missing/invalid searchable-PDF output **throws** rather than fabricating metadata (`src/lib/workers/ocr-native.test.ts`). Nulls are honest ("not determinable / not measured"), counts are bounded, and `meanConfidence` stays `null` because the native backend exposes none. No recognized text, filename, or path ever enters the metadata. **Phase 26 threads it onto the client-facing job record** as `Job.results.ocr` (namespaced container in `src/lib/jobs/results.ts`), returned verbatim by `GET /api/jobs/{id}`; every write is re-bounded by `sanitizeJobResults` (which also collapses the engine to the closed `ocrmypdf`/`tesseract`/`unknown` family set) and dropped again when the outputs are deleted. See [`OCR_BACKEND.md`](./OCR_BACKEND.md) → *Client-visible OCR metadata*.

### OCR capability (`src/lib/workers/ocr.ts`)

`buildOcrCapability(mode, engines?)` derives the client-safe `WorkerStatus.ocr` — `{ available, engine, languages, detail }` — from the resolved mode and the OCR engines a worker advertises (presence only, never a value). The status route **deliberately passes no OCR engines**, because no OCR pipeline ships, so `available` is `false` everywhere with an honest, mode-specific `detail`. The `engines`-driven branch (and `probeOcrEngines`) exist so the capability flips on correctly — and is unit-tested — the moment a real OCR processor is wired behind the adapter contract.

### OCR tool page (`src/components/tools/ocr-worker-panel.tsx`)

`/tools/ocr-pdf` renders a premium, OCR-specific secure-worker panel instead of the generic preview. It reads the live `/api/worker/status` endpoint (emitting the Phase 10 `worker_status_checked` event — mode + enabled only), lets the user configure a real request (languages, output, skip-text) validated by the shared `parseOcrOptions`, and shows the exact pipeline — encrypted upload → scan → isolated recognition → download → auto-delete. When OCR is unavailable it says so plainly and **mounts no uploader**; only when the endpoint honestly reports OCR available does it mount a file picker and run the documented flow via `runWorkerOcr` (`src/lib/workers/ocr-client.ts`), surfacing only real downloaded output or an honest failure.

### OCR native backend (Phase 23 — optional, off by default)

Phase 23 makes OCR a **real, optional** worker backend behind the same processor seam,
without faking it. The `OcrRunner` — an injected dependency of the OCR processor — is
implemented by the Node-only `src/lib/workers/ocr-native.ts`, which shells out to
**OCRmyPDF/Tesseract** with a fixed argv (no shell), a hard timeout, input/output byte
ceilings, an isolated temp dir with guaranteed cleanup, a structural PDF check on the
output, and fixed content-free errors. It is driven by the node-free
`ocr-native-config.ts` (env → bounded config), is **opt-in** (`PDFXYZ_OCR`, disabled
unless set), and is wired only by the out-of-band daemon runtime — never the web app or
the local-dev worker. With nothing configured, OCR stays honestly `not_implemented` and
`status.ocr.available` is `false`, so the tool page mounts no uploader; the moment an
operator enables it and installs an engine, the processor flips ready and `ocr-pdf`
jobs complete with real artifacts. The Phase 22 malware-scan gate runs **before** OCR.

Full operator guide — env knobs, deployment requirements, security envelope,
observability, and caveats — is in [`OCR_BACKEND.md`](./OCR_BACKEND.md). Phase 25
extends the runner to **populate `OcrResultMeta`** from the real run and adds a
deterministic in-container recognition proof (`pnpm worker:ocr-proof`, below); Phase 26
threads that bounded metadata into `Job.results.ocr` and the client-facing job API; Phase
27 adds an OCRmyPDF **searchable-PDF** proof (`pnpm worker:ocrmypdf-proof`, below)
alongside it. Still outstanding (documented there): the throw-based OCR failure mapping
is coarse-grained (a deterministic failure retries up to the attempt cap before failing
terminally).

## Provider seams

Phase 12 splits the production backend into three explicit providers behind the
worker adapter:

| Provider | Interface | Responsibility | Current production behavior |
| --- | --- | --- | --- |
| Object storage | `src/lib/workers/storage/` | signed upload slots, signed artifact downloads, delete-now receipts, retention metadata | **S3/R2-compatible provider shipped** when explicitly configured; disabled/remote-unimplemented otherwise returns typed failure |
| Queue | `src/lib/workers/queue/` | enqueue, idempotency, status, cancel, expire, job state transitions, claim/lease/heartbeat | **Redis/Upstash-compatible provider shipped** when explicitly configured; disabled/remote-unimplemented otherwise returns typed failure |
| Processor | `src/lib/workers/processor/` + `executor/` | processor registry + the execution loop that claims a job, reads inputs, dispatches a processor, and drives status | local-dev in-process + a unit-tested executor foundation; **no production worker daemon shipped** (a configured queue accepts jobs that stay `queued` until one is deployed) |

No client supplies object keys or filesystem paths. Opaque ids (`f_…`, `job_…`,
`art_…`) are minted server-side; production providers must map them to private
bucket keys internally. All download/upload URLs in the contract are signed and
expiring. `DELETE /api/jobs/:id` is the delete-now/cancel seam: it returns an
honest not-configured error with no backend, and local-dev cancels cancelable jobs
or expires completed jobs while removing artifact references.

## S3-compatible storage provider (Phase 14)

Phase 14 makes the **object-storage** provider production-real without claiming a
full remote worker is live. When `PDFXYZ_STORAGE_PROVIDER=s3` and the required
server-side S3/R2/MinIO variables are well-formed, the non-local-dev adapter mints
genuine AWS SigV4 presigned URLs using `src/lib/workers/storage/s3-signer.ts`
(`node:crypto`, no SDK dependency). The browser uploads/downloads directly to the
private bucket; the app server never proxies bytes or exposes credentials.

Required server-side variables (never `NEXT_PUBLIC_`): `PDFXYZ_S3_ENDPOINT`,
`PDFXYZ_S3_REGION`, `PDFXYZ_S3_BUCKET`, `PDFXYZ_S3_ACCESS_KEY_ID`, and
`PDFXYZ_S3_SECRET_ACCESS_KEY`. Optional: `PDFXYZ_S3_SESSION_TOKEN`,
`PDFXYZ_S3_FORCE_PATH_STYLE`, `PDFXYZ_S3_KEY_PREFIX`,
`PDFXYZ_S3_UPLOAD_TTL_SECONDS`, and `PDFXYZ_S3_DOWNLOAD_TTL_SECONDS`. The parser
validates presence/shape only; errors and status details name no values, and the
client-facing capability names no bucket, endpoint, region, account, key id, or
variable.

Security properties of the provider:

- Upload/download URLs are signed and short-lived (default 15 minutes, bounded by
  the SigV4 7-day ceiling).
- Keys are derived only from server-minted opaque ids under private namespaces
  (`inputs/…`, `artifacts/…`) plus an optional sanitized prefix; filenames never
  appear in keys.
- Oversized reservations fail before signing; malformed artifact ids are treated
  as unavailable/already-gone rather than signed as arbitrary paths.
- `deleteNow` executes a short-lived signed DELETE server-side and treats 404 as
  idempotent success.
- A configured S3 provider makes **storage** ready in `/api/worker/status`, while
  queue and processor readiness are decided independently.

## Redis/Upstash queue provider (Phase 15)

Phase 15 makes the **job-queue** provider production-real without claiming a
worker daemon is live. When `PDFXYZ_QUEUE_PROVIDER=redis` (or the alias
`upstash-redis`) and the required REST variables are well-formed, the
non-local-dev adapter records **real, server-minted `queued` jobs** in a shared
Redis broker over its HTTP REST API (Upstash Redis REST and compatible gateways),
via `src/lib/workers/queue/redis.ts` + `redis-client.ts`. Job state, idempotency
records, leases, attempts, and cancellation all live in Redis, so they survive a
process restart and are visible across replicas — the two things the in-process
dev queue can never offer.

Required server-side variables (never `NEXT_PUBLIC_`): `PDFXYZ_REDIS_REST_URL`
and `PDFXYZ_REDIS_REST_TOKEN`. Optional, all bounded: `PDFXYZ_QUEUE_KEY_PREFIX`
(default `pdfxyz`), `PDFXYZ_QUEUE_LEASE_SECONDS` (lease ceiling, default 300, 5–3600),
`PDFXYZ_QUEUE_MAX_ATTEMPTS` (dead-letter cap, default 5, 1–20), and
`PDFXYZ_QUEUE_JOB_TTL_SECONDS` (per-key retention TTL, default 86400, 300–604800).
The parser validates presence/shape only; errors and status details name no values,
and the client-facing capability names no endpoint, token, prefix, key, or variable.

What the provider implements (the full `ClaimableQueue` contract):

- **App-server operations** — `enqueue`/`submit` (server-minted opaque `job_…`
  id only), `lookupIdempotent`, `status`, `cancel`, `expire`. Every op returns a
  typed result: a missing job is a clean `not_found`, an illegal transition a
  `conflict`, and a broker that errors or is unreachable a typed `unavailable`
  (mapped to `500`, retryable) — never a fabricated job or status.
- **Worker-claim operations** — `claim` (atomic dequeue via `RPOP` of the FIFO
  ready list, plus a redelivery sweep of the ZSET of leased jobs whose atomic
  `ZREM` elects a single winner), `heartbeat`, `advance`, `complete`, `fail`
  (terminal or requeue), with per-job leases, an attempt counter, and a hard
  dead-letter cap so a job that keeps timing out cannot be redelivered forever.

Data model, all keys under the sanitized prefix: `…:job:{id}`, `…:spec:{id}`
(executor-facing inputs+options, never exposed to a client), `…:lease:{id}`,
`…:idem:{sha256}` (the client idempotency key is **hashed**, so the raw value never
becomes a broker key), `…:ready` (LIST), `…:active` (ZSET). No client ever supplies
a Redis key, stream name, or broker id.

**Honest limits — what Phase 15 does NOT do.** Phase 15 itself ships no worker, and
the web app never drains the queue (Phase 16 adds an **out-of-band** daemon for that,
below — the app runtime still never runs it). So when a queue is configured,
`POST /api/jobs` records a **`queued`** job (only when storage is *also* ready, since
inputs live in object storage) and returns `202 Accepted` — and that job stays
`queued` until a worker daemon is deployed and running against the queue. `getJob` honestly returns `queued`; nothing is ever
reported `completed` unless a real processor wrote artifacts. `/api/worker/status`
says so: with a queue configured but no worker, `providers.queue.ready` is `true`
while `providers.processor.ready` is `false` and its detail states jobs will queue
but not run yet. Concurrency-sensitive transitions are now atomic end to end (Phase 21): claim
commit, stale-lease redelivery, heartbeat, advance, terminal finalize, and requeue
run through frozen Redis `EVAL` scripts with explicit status and lease-attempt
preconditions. The executor threads the claim attempt fingerprint back into every
running-state write, so a stale daemon whose lease was reclaimed cannot heartbeat,
advance, complete, fail, or requeue the job. Providers that cannot run the atomic
scripts fail as typed `unavailable` instead of silently falling back to unsafe
read→write behavior. See DEPLOYMENT.md for how to configure it and OBSERVABILITY.md
for what to watch.

## Worker daemon runner (Phase 16)

Phase 16 makes the production worker process **real**: an out-of-band daemon
(`src/lib/workers/daemon/` + `scripts/worker-daemon.ts`) that drains the Phase 15
queue, reads/writes bytes through Phase 14 storage, and dispatches the Phase 13
processor registry. It is **opt-in and never started from the web app** — importing
the app spins up no worker; only `pnpm worker:daemon` does.

**What it wires.** `resolveWorkerRuntime(env)` builds a drainable `ClaimableQueue`
(the real Redis broker via the existing factory), a worker-side `ExecutorStorage`,
and a processor registry (with a live native-engine probe, so compression lossless is
always available while deep/OCR light up only with a real engine/runner), then
constructs `createWorkerExecutor(...)`. It returns an executor **only** when the queue
is drainable *and* storage is configured; otherwise it reports honestly why not, and
the CLI exits `2` (not configured) instead of pretending to process.

**Worker-side S3 storage** (`src/lib/workers/executor/s3-storage.ts`). The app-server
provider only *mints signed targets*; the deployed worker moves bytes itself with
genuine SigV4-signed GET/PUT/DELETE. A missing input object (S3 `404`) is an honest
`null` → terminal `not_found`; a transient failure throws so the job's lease expires
for at-least-once redelivery instead of a false "gone". Each artifact embeds a real
signed, expiring download URL (the client uses it verbatim), and object keys derive
only from opaque ids — shared with the app provider (`storage/s3-keys.ts`) so the
worker's artifact key always matches the app's download key. Phase 18 adds a
separate display-only naming channel: upload signing may include sanitized
`x-amz-meta-filename` metadata and queued job specs may include sanitized
`inputNames`, but neither channel participates in object keys, broker keys, signed
URL paths/queries, status payloads, telemetry, or logs. Worker artifacts now use
that metadata for `Content-Disposition`/download filenames when present, falling
back to content-type-derived names when absent.

**Run modes.** `pnpm worker:daemon [--once | --drain | --loop | --dry-run-status]`,
plus `--max-ticks`, `--idle-sleep-ms`, `--lease-ms`. `--once` runs a single job
(smoke test), `--drain` clears the backlog and exits, `--loop` (default) polls
forever, sleeping when idle, and `--dry-run-status` reports readiness and claims
nothing. A SIGINT/SIGTERM drains the current tick and exits cleanly. Logging is
**content-free structured JSON** — run mode, tick counters, an opaque job id/attempt,
and an error *code* only; never a filename, byte, object key, URL, option value, or
secret.

Still honest about limits: OCR (Phase 23) and deep compression remain
engine-dependent — both are optional native backends that light up only when an engine
is installed and (for OCR) explicitly enabled, and stay honestly `not_implemented`
otherwise. Whether a daemon is actually deployed and running is **out-of-band** —
`/api/worker/status` reports `daemon.drainable` (queue + storage configured, so a
worker *could* drain here) but never claims a worker is live, which the app cannot
observe.

### Native/lossless compression, proven end-to-end (Phase 17)

Phase 17 does not add new daemon machinery — it **proves** the one the earlier phases
built and adds a health distinction. `resolveWorkerRuntime` already wires the Phase 13
compression processor with a live native-engine probe (`nativeCompressionDeps()`), so a
deployed daemon completes real `compress-pdf` jobs end-to-end:

- **Lossless always completes** — a genuine pure-JS pdf-lib structural repack, no
  native dependency.
- **Deep completes when a native engine is installed** — the processor auto-detects
  Ghostscript / qpdf / mutool on the worker's `PATH` and runs the first available; with
  none installed, `deep` stays honestly `not_implemented` and only lossless runs.

This is now covered by an **integration + daemon smoke test** that drives the real stack
(`resolveWorkerRuntime` → `createWorkerDaemon` → `createWorkerExecutor` → compression
processor) reading and writing bytes through the **production** worker-side S3 seam
(`createS3ExecutorStorage`, over a stateful fake bucket), in both `--once` and `--drain`
modes (`src/lib/workers/daemon/native-compression.integration.test.ts`). A job reaches
`completed` **only after** real artifact bytes were read, processed, and written back to
the bucket; a `deep` job with no engine writes no artifact and never completes.

The daemon also reports a presence-only **compression-engine health**
(`WorkerRuntime.compression` → the CLI's `compression_health` line): `{ lossless: true,
deep, engines }`, **distinct from `daemon.drainable`**. Drainability is about queue +
storage; this is about whether *this worker image* can do deep compression. An operator
smoke-tests it with `pnpm worker:daemon --dry-run-status` (see DEPLOYMENT.md). Worker
outputs now use Phase 18 display-only filename metadata when present (for example
`invoice-compressed.pdf`) and fall back to content-type-derived names when absent.

### Container image & web/worker separation (Phase 19)

Phase 19 turns the "separate process" invariant into a build artifact. A multi-stage
[`Dockerfile`](../Dockerfile) shares a dependency + build stage but produces **two
independent final images**:

- **`web`** runs `pnpm start` (Next.js). It installs **no** native PDF or OCR engines and
  its layers never reference the worker daemon.
- **`worker`** runs `pnpm worker:daemon`. In one apt layer it installs **Ghostscript,
  qpdf, and `mupdf-tools`** for deep compression **and the OCR stack — `ocrmypdf`,
  `tesseract-ocr`, and `tesseract-ocr-eng`** (the OCR engines plus minimal English
  language data; `tesseract-ocr-eng` is listed explicitly because
  `--no-install-recommends` otherwise skips the language pack). It copies
  `src/`/`scripts/`/`tsconfig.json`/`node_modules` (the daemon runs via `tsx`) but
  **not** the web build (`.next`), and serves no HTTP.

This mirrors the code-level boundary the earlier phases built: the web app never imports
the Node-only daemon runtime (`daemon/runtime.ts`) or the native-compression subprocess
module (`compression/native.ts`) eagerly — both are reached only via lazy `import()` (the
`/status` route's engine probe) or the out-of-band CLI. Two kinds of static test enforce
this so it cannot silently regress:

- `src/deploy/import-boundary.test.ts` scans every non-test module under `src/` and fails
  if anything outside the three allowlisted Node-only files statically imports
  `compression/native`, `daemon/runtime`, or `node:child_process` (lazy `await import(...)`
  is allowed). It also asserts the eager `@/lib/workers` barrel pulls in no `node:` builtin.
- `src/deploy/artifacts.test.ts` parses the `Dockerfile` stages and asserts the separation
  (worker installs the engines and runs the daemon; web runs `pnpm start` with no engines
  and no `.next` in the worker image), that the compose/`.env` examples reference provider
  variables **by name only**, and that no artifact commits a real-looking secret or a
  `NEXT_PUBLIC_` provider value. Since Phase 24 it also pins the worker target's OCR
  packages (`ocrmypdf`, `tesseract-ocr`, `tesseract-ocr-eng`) and the web target's
  exclusion of all of them, plus the image smoke's presence-only, no-secret-echo hygiene
  and its wiring as `pnpm worker:image-smoke`.

Phase 24 adds a runtime counterpart to those static checks: an **image-level
native-engine + OCR smoke**, `pnpm worker:image-smoke` (`scripts/worker-image-smoke.sh`),
that runs *inside the built worker image* and needs no cloud, secret, or network. It is
the image sibling of the Docker-free `worker:smoke`: it verifies the deep-compression
binaries (`gs`/`qpdf`/`mutool`) and the OCR binaries (`tesseract`/`ocrmypdf`) are
installed, that English OCR language data is present (`tesseract --list-langs` lists
`eng`), and that opting into `PDFXYZ_OCR` flips the daemon's `ocr_health` to `ready:true`
and its `compression_health` to `deep:true` — every readout **presence-only** and
content-free (a name or flag, never a path), and the smoke **processes no document**. It
also pins daemon honesty: native engines being present never fakes drainability, so
`--dry-run-status` still exits `2` (not drainable) with no queue or storage wired. It only
ever runs the daemon in `--dry-run-status` (never the forever loop). Because it
deliberately **fails** where the engines are absent, it is image-only and is **not** part
of the Docker-free PR gate — it runs in the container workflow below.

Phase 25 adds a **behavior** proof to that same image: `pnpm worker:ocr-proof`
(`scripts/worker-ocr-proof.sh`) runs *inside the built worker image*, after the presence
smokes, and proves the packaged Tesseract baseline can actually **recognize** text. It
renders a tiny synthetic raster of a fixed sentinel with Ghostscript (a pure image, no
text layer), OCRs it to a searchable PDF + text sidecar, and asserts the normalized
sidecar contains the sentinel — genuine recognition on a generated, **non-user-document**
fixture. It needs no cloud/secret/queue/store/scanner, its output is presence-only and
content-free (never a path or the recognized text), and it always cleans up its temp dir.
Its whole plumbing (prerequisite exit `2`, enforced-sentinel exit `3`, cleanup) is proven
Docker-free with stub engines in `src/deploy/worker-ocr-proof.test.ts`.

Phase 27 adds the PDF→PDF counterpart to that same image, `pnpm worker:ocrmypdf-proof`
(`scripts/worker-ocrmypdf-proof.sh`), run after the recognition proof. It renders the
sentinel into an **image-only PDF** (Ghostscript's `pdfimage` device — no text layer),
confirms with `pdftotext` that the source yields no selectable text, runs the packaged
**OCRmyPDF** by fixed argv to add a text layer, and confirms with the same `pdftotext` that
the **output** yields the sentinel — proving image-only became genuinely **searchable**. Same
envelope (generated fixture, presence-only/content-free, self-cleaning); its plumbing is
pinned Docker-free with stub `gs`/`ocrmypdf`/`pdftotext` in
`src/deploy/worker-ocrmypdf-proof.test.ts`. (`pdftotext` from `poppler-utils` is packaged in
the worker image **only** as proof tooling — never on the OCR runtime path.) What these
proofs still do **not** establish: production OCR quality, non-English packs, or real
user-document traffic.

The Docker build itself is still **not exercised** in this repository's environment (no
Docker daemon); the images must be built and run in real worker infrastructure. What
covers that gap out-of-band is the GitHub **container workflow**
([`.github/workflows/container.yml`](../.github/workflows/container.yml)): it builds both
targets, runs `pnpm worker:smoke`, `pnpm worker:image-smoke`, the node-free
`pnpm worker:engines` preflight (with the production require-flags armed),
`pnpm worker:ocr-proof`, **and** `pnpm worker:ocrmypdf-proof` inside the worker image, and
asserts the worker image ships `gs`/`qpdf`/`mutool`/`tesseract`/`ocrmypdf` — plus
`pdftotext` (`poppler-utils`, proof tooling only) — while the web image ships **none**
(no secrets, no push) — so the image-level engine + recognition + searchable-PDF contract
is proven on GitHub Actions
even though the local repo still does not build images. (The workflow's shape is itself
pinned by `src/deploy/ci-workflow.test.ts`.) See DEPLOYMENT.md's "Phase 19 worker
container" section for the build and health-check commands.

## Processor registry & worker executor (Phase 13)

Phase 13 adds the **execution foundation**: the compute seam is now a typed
processor contract behind a registry, and there is a real, unit-tested loop that
claims a queued job and runs it. Neither adds a credential, a background service,
or any fake processing.

### Processor registry (`src/lib/workers/processor/`)

A {@link Processor} is the third provider contract (alongside storage and queue):
`supports(tool)`, `capability()` (presence-only readiness), and
`process(input) → { artifacts } | { error }`. It is pure and node-free — native
dependencies are injected — so it is reused unchanged by the synchronous local-dev
adapter and the async executor, and unit-tested without a binary.

- **Compression** (`compression.ts`) wraps the existing engine behind the
  contract; lossless is always available, deep still fails honestly with
  `not_implemented` when no native engine is installed. The local-dev adapter now
  dispatches through this exact processor, so the adapter and the executor cannot
  drift in how work runs or how failures are classified.
- **OCR** (`ocr.ts`) validates a request and then honestly returns
  `not_implemented` — this build ships **no OCR runner**. The native runner is an
  injected seam, so the capability flips on (and is unit-tested) the moment a real
  OCRmyPDF/Tesseract runner is wired; nothing fabricates recognized text.
- `ProcessorRegistry` maps a tool slug to its processor; a duplicate registration
  is a wiring error, not silent last-writer-wins.

### Worker executor (`src/lib/workers/executor/`)

`createWorkerExecutor({ queue, storage, registry })` is a **pure, dependency-injected
loop**, not a daemon: importing it starts no timer, thread, or background service.
One tick — `runOnce()` — claims the next job, reads its inputs, dispatches the
processor, writes artifacts, and drives the job to a terminal state; `drain()`
runs ticks until the queue is idle. It is unit-tested deterministically with a
fake clock and in-memory queue/storage. The Phase 16 daemon runner
(`scripts/worker-daemon.ts`) is what calls `runOnce()`/`drain()` out-of-band — the
app runtime never does.

Guarantees the executor upholds:

- **Honesty.** A job is `completed` only after real artifact bytes were written;
  every failure carries a typed `JobError`; an unroutable tool or a missing input
  fails honestly rather than producing a dummy file.
- **Retryable vs terminal.** A processor failure marked `retryable` is requeued
  (up to `maxAttempts`) rather than killed; a non-retryable failure is terminal.
- **Cancellation.** A job canceled while queued is never processed; a job canceled
  while running does not get resurrected into `completed` — the executor detects
  the conflict and **cleans up any artifacts it already wrote**.
- **Retention.** Inputs are wiped once a job reaches a terminal state; a retryable
  requeue is *not* terminal, so its inputs survive for the retry.
- **Privacy.** The optional structured log receives only opaque ids, the tool
  slug, an attempt number, and an error *code* — never bytes, filenames, object
  keys, temp paths, or option values.

### Malware-scan gate (`src/lib/workers/scanner/`, Phase 22)

The executor runs a typed **malware-scan gate** on a job's already-read inputs
**between** reading them and advancing to `processing`, so an infected upload is
blocked before any compute touches it. It is a provider seam like storage/queue/the
processor — pure data + a tiny `MalwareScanner` interface (`scan()` → a content-free
verdict, `capability()` → presence-only readiness), node-free, and injectable.

Phase 22 ships an **optional ClamAV/clamd backend** (`./clamav`) behind that seam —
it streams each input to a `clamd` daemon over INSTREAM and maps the reply to a
verdict — **plus the honest no-op** for when no scanner is configured. It is optional
by default: scanning is a real capability an operator turns on, exactly like storage
or the queue, never a silent assumption.

- **Configuration & states (presence-only).** With nothing set the gate is
  `not-configured` and the no-op runs. An operator opts in by pointing
  `PDFXYZ_MALWARE_SCANNER` at a clamd endpoint — `clamav://host[:port]` (default port
  3310) or `clamav+unix:///path` — with bounded `PDFXYZ_CLAMAV_TIMEOUT_MS` /
  `PDFXYZ_CLAMAV_MAX_BYTES` knobs. `resolveScannerReadiness` reports one of four
  honest, content-free states: `disabled` (explicitly `off`), `not-configured`,
  `ready` (a usable endpoint → **`active: true`**, inputs are actually scanned), or
  `unavailable` (selected but its endpoint is missing/malformed/unrecognized → cannot
  connect, still inactive). It never echoes the endpoint host, port, socket path, or
  value.
- **The shipped no-op is honest.** `notConfiguredScanner` is wired for every
  non-`ready` state; it inspects nothing and returns `skipped` — **never `clean`** —
  so an unscanned input is never reported as scanned. A `skipped` verdict emits **no**
  log event, so an unscanned job is byte-identical to having no gate; the node-free
  `createMalwareScanner` only ever wires the no-op or an injected provider, so a
  client bundle or unit test never pulls a socket in.
- **Verdict handling** (the executor gate, exercised by the ClamAV client, an
  injected fake, and unit tests): `infected` → the job fails **terminally and
  non-retryably** with error code `malware_detected`, **before** `processing`, so
  **no artifact is ever produced**, inputs wiped, a `scan_blocked` log event fires for
  security monitoring; `invalid` (the input can never be scanned — e.g. it exceeds the
  hard size limit) → **fail closed**, blocked terminally with code `scan_invalid`
  (same `scan_blocked` event) rather than processed unscanned; `error` (a transient
  scan failure — clamd unreachable/timed out) → a **retryable** `scan_unavailable`
  failure (requeue up to `maxAttempts`, then terminal), never downgraded to clean;
  `clean` → a `scan_clean` log event, then processing proceeds; `skipped` → proceed,
  honestly unscanned.
- **Required vs optional (fail-closed vs fail-open) lives at the scanner boundary.**
  An `infected` detection ALWAYS blocks. For a scanner that can't reach a verdict
  (unreachable/oversize), a **required** scanner returns `error`/`invalid` (fail or
  retry, never bypass) while an **optional** one degrades to `skipped` (proceed,
  honestly not-scanned) — so the executor policy (`error` retries, `skipped`
  proceeds) stays simple and provider-agnostic.
- **Content-free by construction.** clamd's reply is classified to a kind at the
  protocol layer, which **drops the signature name**; the scanner's `detail` is a
  fixed sentence and is deliberately **never** propagated into the `JobError` or the
  logs. Verdicts, log events, and the `scanner_health` readiness line carry no
  filename, signature, endpoint, host, port, byte, or value.
- **Operator control.** `PDFXYZ_WORKER_REQUIRE_SCAN` arms the opt-in `require-scan`
  guardrail: `--check` fails fast (exit `4`) when scanning is required but not active,
  and **passes** once a usable clamd endpoint is configured. A selected-but-invalid
  or unrecognized scanner value is itself a guardrail error (`scan_selected_but_invalid`
  / `scan_provider_unrecognized`) so a typo can't silently disable scanning. It is
  **not** folded into `PDFXYZ_WORKER_STRICT` — a lossless-only worker with no scanner
  is a legitimate production choice — so strict stays passable without a scanner. The
  daemon's `--dry-run-status` reports a presence-only `scanner_health`
  (`{ active, provider, detail }`).

Node boundary: the ClamAV client (`./clamav`) is node-free (its socket is an injected
`ClamavTransport`); only the real Node socket transport (`./clamav-transport`) and the
runtime resolver (`./node`, `resolveWorkerScanner`) are Node-only, imported by the
worker runtime alone — so the eager scanner barrel never pulls a socket into a bundle.

### Storage seams: worker I/O vs app-server ops

The executor reads inputs and writes artifacts through its own
{@link ExecutorStorage} seam (`readInput`/`writeArtifact`/`deleteInput`/`deleteArtifact`).
This is deliberately distinct from the app-server `StorageProvider`
(reserve/delete only, never streams bytes): in production the **worker** touches
the encrypted bucket directly, while the **app server** never does. Modeling them
as two seams keeps the app-server contract clean and gives the executor exactly
the byte I/O it needs.

### Queue evolution: `ClaimableQueue`

`ClaimableQueue extends QueueProvider` with `submit` (record a queued job plus its
inputs/options), `claim` (atomically pick the oldest queued job — or redeliver one
whose lease expired — and lease it), `heartbeat`, `advance`, `complete`, and
`fail` (terminal or requeue). This is **backward-compatible by construction**: the
base `QueueProvider` and every app-server route that uses it are untouched; only a
broker a worker drains implements the richer interface. The state machine
(`state.ts`) gains explicit **redelivery** edges (`scanning/processing → queued`)
so an at-least-once queue's behavior is modeled honestly rather than hidden.
Lease + attempt bookkeeping lives beside the job record, never on the
client-facing `Job`.

### Remote mode is still honest

`remote-configured` ships **no** executor: `/api/worker/status` reports
`processor.executor.mode: "not-implemented"`, and no job is claimed or dispatched.
Wiring a real broker/storage/worker behind these contracts is the remaining
production step — see the checklist in [`DEPLOYMENT.md`](./DEPLOYMENT.md).

## Contract endpoints

### `POST /api/uploads`

Creates short-lived upload slots for a worker-capable file-input tool.

Request shape:

```json
{
  "tool": "ocr-pdf",
  "files": [
    {
      "filename": "scan.pdf",
      "contentType": "application/pdf",
      "bytes": 1048576
    }
  ]
}
```

The validator rejects:

- unknown tool slugs
- in-browser tools such as `merge-pdf`
- path traversal or path separators in filenames
- invalid MIME types
- unsupported MIME types for the selected tool
- too many files or oversized files
- URL-only tools such as `webpage-to-pdf`

### `POST /api/jobs`

Creates a job for a worker-capable tool once files have been uploaded, or directly for URL-input tools.

File-input example:

```json
{
  "tool": "ocr-pdf",
  "inputs": ["f_1234567890"],
  "options": { "languages": ["eng"], "outputMode": "searchable-pdf" },
  "idempotencyKey": "ocr:scan:1"
}
```

OCR `options` are validated by `parseOcrOptions` (`src/lib/jobs/ocr.ts`); see "OCR secure-worker foundation" above for the full rules.

URL-input example:

```json
{
  "tool": "webpage-to-pdf",
  "options": { "url": "https://example.com/report" }
}
```

The URL validator blocks localhost, private IPv4 ranges, link-local/cloud metadata ranges, embedded credentials, non-http(s) protocols, and internal/local hostnames. Production workers must also enforce network egress rules; this edge validator is defense-in-depth, not the only SSRF protection.

### `GET /api/jobs/:id`

Returns typed job status once a real backend exists. Stub behavior is explicit and safe: invalid ids are rejected, and unknown jobs are reported without leaking implementation details.

### `DELETE /api/jobs/:id`

The honest delete-now / cancel control — the user's "stop and delete my data" action. It validates the id, then delegates to the adapter's `cancelJob`. With no backend it answers `503 worker_not_configured` (there is nothing to cancel or delete) and never fabricates a `canceled` job. The local-dev adapter resolves it through the queue + storage providers: an in-flight job transitions to `canceled` (queue `cancel`), a `completed` job transitions to `expired` with its artifact bytes removed via storage `deleteNow` (an early, explicit "delete now"), and an already-terminal job is an idempotent no-op. Transitions are guarded by the queue state machine (`src/lib/workers/queue/state.ts`).

### `GET /api/worker/status`

Presence-only capability probe for the client. Returns `{ mode, enabled, localDevOnly, detail, compress: { lossless, deep, engines }, ocr: { available, engine, languages, detail }, providers: { storage, queue, processor } }`. It never reads or returns a secret — `engines` and `ocr.engine` list native binaries by *name* only, and each `providers` entry reports only its `ready`/`configured` readiness plus a client-safe `detail` (never a bucket, queue, key, path, or variable name). The `providers.processor` entry additionally carries `executor: { mode, ready, detail }` (Phase 13) — a presence-only view of the execution loop (`in-process` / `not-implemented` / `none`), never naming a broker or worker URL. Since Phase 14, storage readiness may report `provider: "s3"` and `ready: true` when S3-compatible storage is fully configured; since Phase 15, queue readiness may likewise report `provider: "redis"`, `ready: true`, `configured: true` when a Redis/Upstash broker is fully configured — independently of storage. The processor stays honestly not ready (no worker daemon ships); when a queue is configured its `detail`/`executor` state that jobs are accepted but stay queued until a worker is deployed. The route never probes an OCR engine (no OCR pipeline ships), so `ocr.available` is `false` in every environment with an honest, mode-specific `ocr.detail`. `no-store`; reflects live host state. See "Discovering worker availability from the client" and "Provider seams" above.

### Local-dev transport (dev only)

`PUT /api/uploads/local/:fileId` and `GET /api/artifacts/local/:artifactId` are the developer transport that stands in for pre-signed object storage. They are **inert (`503 worker_not_configured`)** unless `PDFXYZ_WORKER_MODE=local-dev` is set. A production deployment uploads directly to an encrypted bucket and serves outputs from signed, expiring URLs — never through the app server.

## Job lifecycle

```text
create upload session
  → direct encrypted upload
  → create job
  → queued
  → malware scan
  → isolated processing
  → signed download
  → automatic deletion
```

Job states are defined by `JobStatus`:

- `queued`
- `scanning`
- `processing`
- `completed`
- `failed`
- `expired`
- `canceled`

Terminal states are encoded in `TERMINAL_STATUSES`, and `isDownloadReady()` centralizes the download readiness rule.

## Retention model

`DEFAULT_RETENTION` currently defines the contract:

- input TTL: 60 minutes maximum (upper bound; see below — inputs are wiped much sooner)
- output TTL: 60 minutes maximum
- `persistsAfterJob: false`

**Delete semantics.**

- **Inputs** are wiped **as soon as processing finishes** (success or failure), not merely at the TTL. The TTL is only a backstop for a slot that was reserved but never turned into a job. Upload slots are single-use. The local-dev worker implements this literally (`DevWorkerStore.deleteSlot` on every job); production storage must do the same via lifecycle rules plus explicit post-job deletion.
- **Outputs** stay downloadable until their output TTL, then auto-delete. The local-dev store drops expired outputs lazily on read; production must enforce this with a storage lifecycle policy independent of application code. A production build should also expose an explicit signed "delete now" for an artifact; the local-dev store keeps outputs only in memory and loses them on restart, so it relies on the TTL + lazy drop.

Production storage must enforce lifecycle deletion independently of application code. UI copy should continue to say: files are uploaded only for secure-worker/AI tools, inputs are wiped after processing, and outputs expire automatically.

**Active-deletion proof.** The executor's active delete-now is proven, not asserted:
`src/lib/workers/executor/executor.leak.test.ts` sweeps *every* terminal path the
executor can drive a claimed job to — completion, no-processor, an expired/missing
input, a terminal processing failure, an OCR failure, the three malware-scan blocks
(infected / unscannable / scan-unavailable), and cancellation mid-run — and asserts
the invariant that **no input survives a terminal state and no artifact survives a
failed/canceled one**. Only a *successful* job retains its single artifact, and only
with a bounded `expiresAt` (the output TTL). The complement is proven too: a
*retryable* requeue is not terminal, so its inputs are preserved for the retry. The
lifecycle backstop below is the independent net if this active path ever fails; the
Phase 25 `--lifecycle-verify` seam lets an operator confirm that net is actually in
force on the bucket.

## Lifecycle policy tooling, deployment readiness & guardrails (Phase 19)

Phase 19 hardens the *operational safety* of deploying the daemon, without adding a
processor. It supplies three node-free, content-free capabilities the operator CLI
surfaces (`src/lib/workers/lifecycle/` and `src/lib/workers/deploy/`). None of it
makes a live cloud call — everything is presence/shape-only and testable offline.

### Retention → lifecycle backstop (`src/lib/workers/lifecycle/`)

The retention model above is enforced primarily by the app (active delete-now on
job completion, artifact expiry). A storage **lifecycle policy** is the independent
*backstop* that guarantees an upper bound even if active deletion never runs. This
tooling turns the configured retention into that policy:

- `retention.ts` — parses `PDFXYZ_RETENTION_*` overrides (input/artifact TTL minutes,
  multipart-abort hours, noncurrent-version days) for **presence and shape only**,
  with hard privacy ceilings (≤ 7 days). A malformed/over-ceiling override fails
  closed to the safe `DEFAULT_RETENTION_SETTINGS` (= the app-wide `DEFAULT_RETENTION`)
  and is surfaced as a guardrail, never silently applied.
- `policy.ts` — a **provider-agnostic** `LifecyclePolicy` model plus
  `buildLifecyclePolicy()` and `validateLifecyclePolicy()`. S3-compatible lifecycle
  expiration is *day-granular*, so a sub-day retention window (60 min) is rounded
  **up** to a 1-day backstop — the backstop can never delete an object the app still
  treats as live. Rules cover input-object expiration, artifact expiration,
  incomplete-multipart abort, and (for versioned buckets) noncurrent-version and
  expired-delete-marker cleanup. Rules target **structural prefixes only** (`inputs/`,
  `artifacts/`, matching `s3-keys.ts`) — never a bucket, endpoint, or key.
- `render.ts` — renders the model for `aws-s3`, `cloudflare-r2` (expiration +
  multipart subset; R2 has no versioning), `minio` (`mc ilm import`), or `generic`
  JSON. Every document is content-free and applies to a `<bucket>` the operator
  names on the provider CLI — the bucket is never baked into the document.
- `config.ts` — presence-only lifecycle **readiness**. The app can't inspect a live
  bucket's lifecycle without a cloud call, so this is operator-*declared*:
  `unknown` (nothing declared) → `declared` (`PDFXYZ_LIFECYCLE_PROVIDER` set) →
  `validated` (`PDFXYZ_LIFECYCLE_VALIDATED=true`, the operator asserts it is applied
  and verified). It never claims rules are in force just because a variable is set.
- `verify.ts` (Phase 25) — a **dry-run verifier** that turns the bare `validated`
  *assertion* into checkable *evidence*. `parseObservedLifecycle()` normalizes a
  lifecycle configuration the operator exports from the bucket out-of-band (the S3
  `{ Rules }` shape from `aws s3api get-bucket-lifecycle-configuration`, or the
  agnostic `generic` render), and `verifyLifecyclePolicy()` compares it to the policy
  the app *would* generate — per-rule `satisfied` / `stricter` / `weaker` / `disabled`
  / `missing`, an overall `verified`/`drift` verdict, and a reconciliation plan.
  Matching is **structural, not by id** (an observed rule governs a generated one when
  it covers the same prefix and carries that role's field, so operator-named rules and
  whole-bucket rules verify correctly; when several rules cover a prefix the shortest
  expiration wins, mirroring S3). It is node-free and **makes no cloud call** — the app
  never reads the bucket; the operator supplies the exported document. Output is
  content-free: only the app's own `pdfxyz-*` rule ids, a status/action enum, prose,
  and a count of unrelated observed rules — never an observed rule's id, prefix, or
  value.

This makes the retention-enforcement ladder explicit and honest:
**generated** (the tooling builds a content-free policy) → **applied** (the operator
runs the provider CLI against the bucket; the app never calls the cloud) →
**verified** (the operator exports the live config and `--lifecycle-verify` structurally
confirms the generated backstop is in force) → **declared** (`PDFXYZ_LIFECYCLE_VALIDATED=true`
asserts that state to the readiness facet). `verified` is *evidence* the daemon checked;
`declared` is the operator's assertion. Neither is the app calling the cloud.

### Composed deployment readiness (`src/lib/workers/deploy/readiness.ts`)

`resolveDeploymentReadiness()` folds six presence-only facets into one posture
(`ready` / `degraded` / `blocked`) the daemon prints on `--dry-run-status`:

| Facet | Green when | Notes |
| --- | --- | --- |
| storage | S3/R2 configured | a worker can read inputs / write artifacts |
| queue | claimable broker configured | a worker can claim/complete |
| engine | native engine installed (injected probe) | lossless always; deep needs a binary |
| lifecycle | operator-declared `validated` | else `degraded`/`unknown` — never assumed |
| malware-scan | optional ClamAV clamd endpoint configured (`ready`) | `not-configured`/`disabled` when off; `unavailable` (degraded) if selected-but-misconfigured |
| ocr | **never** — not implemented in this build | reuses the OCR capability detail |

`blocked` = not drainable (can't run at all); `ready` = drainable **and** a validated
lifecycle backstop; otherwise `degraded`. OCR being not-implemented, and malware
scanning being `not-configured` when no scanner is wired, are honest baselines and do
not by themselves degrade the posture.

### Production guardrails (`src/lib/workers/deploy/guardrails.ts`)

`evaluateGuardrails()` turns dangerous or silently-broken configuration into typed,
content-free violations. Config-integrity checks are **always** errors (a *selected*
provider must be valid, so a typo can't silently fall back to "not configured"):
selected-but-invalid or unrecognized storage/queue provider, malformed native
compression, malformed lifecycle declaration, out-of-bounds retention. Opt-in
production requirements escalate on demand: `PDFXYZ_WORKER_REQUIRE_DEEP_ENGINE`
(deep enabled but no engine → error), and `PDFXYZ_WORKER_STRICT` /
`PDFXYZ_WORKER_REQUIRE_DRAINABLE` / `PDFXYZ_WORKER_REQUIRE_LIFECYCLE`. Strict requires
a runnable worker **and** a validated lifecycle backstop but still allows a
lossless-only deployment. Defaults stay safe: a bare environment produces **zero**
violations. The daemon fails fast (exit `4`) on any error before claiming work; the
violation `message` names no variable or value (offending names live in a separate
`fields` array used only for diagnostics, never printed by the CLI).

See the operator runbook in [`DEPLOYMENT.md`](DEPLOYMENT.md) for the exact commands.

## Production worker plan

### 1. Upload/session service

- Mint single-use upload slots.
- Use pre-signed URLs scoped to one file and one session.
- Enforce file count, file size, total size, MIME, and abuse limits before upload.
- Do not pass uploaded bytes through the Next.js app server.

### 2. Encrypted object storage

- Store inputs and outputs in a private encrypted bucket.
- Partition by job/session id.
- Deny public listing.
- Add lifecycle rules that delete both inputs and outputs automatically.

### 3. Queue

- Use separate queues per processor class:
  - `pdf-structure`
  - `office-conversion`
  - `ocr`
  - `html-render`
  - `ai-document`
- Apply concurrency and memory limits per queue.
- Emit status changes and progress events.

### 4. Sandboxed processors

Each job runs in an isolated temporary directory/container. Recommended processors:

- LibreOffice for Office ↔ PDF conversion.
- OCRmyPDF/Tesseract or a managed OCR provider for searchable scans.
- qpdf/mutool/Ghostscript for repair, PDF/A, and deep compression.
- Playwright/Chromium for webpage/HTML capture.
- Purpose-built redaction pipeline that permanently removes content, not just overlays boxes.

### 5. Security controls

- Malware scanning before processing — **shipped (Phase 22)** as the executor scan
  gate with an optional ClamAV/clamd backend; blocks infected/unscannable inputs
  before any compute, off unless a clamd endpoint is configured.
- No document contents in logs.
- Strict timeout and memory limits.
- No arbitrary file paths in requests or outputs.
- Network egress disabled by default; webpage-to-PDF is the only exception and still requires SSRF guards.
- Signed, expiring download URLs.
- Idempotency keys for retry-safe job creation.

### 6. Rate limits

Abuse limits are part of the contract (`RATE_LIMITS` in `src/lib/jobs/types.ts`)
and are enforced at the edge/gateway, not in application code:

- Upload sessions: **60 / hour / client**.
- Job creation: **60 / hour / client**.
- Status polling: **120 / minute / client** (polling is expected; keep it cheap).

A client is keyed by API token when present, otherwise by IP + coarse
fingerprint. Exceeding a limit returns `429 rate_limited` with a `Retry-After`
header. Per-tool concurrency is additionally capped by the queue (section 3).
Static file limits (`JOB_LIMITS`) — 100 MB/file, 500 MB/session, 20 files —
are validated before any byte is uploaded.

### 7. Observability

Operability without ever logging document contents:

- **Structured logs** keyed by `jobId` / `sessionId` — status transitions,
  timings, error codes, scan verdicts. Never filenames' contents, never bytes,
  never option values that could carry PII (e.g. URLs are logged host-only).
- **Metrics**: queue depth and age, job duration and progress, failure rate by
  tool and error code, malware-scan hit rate, storage bytes in flight, and
  deletion lag (outputs still present past their TTL — should be ~0).
- **Tracing**: one trace per job, spanning upload → scan → process → delete, so
  latency regressions are attributable to a stage.
- **Audit trail**: irreversible actions (redaction, e-signature) record a
  tamper-evident, content-free audit record retained separately from inputs.
- **Alerting**: page on deletion lag > 0, scan-service unavailability, queue age
  over SLO, and error-rate spikes.
- **Log retention** is short and access-controlled; logs never outlive their
  operational need and are excluded from the document retention path entirely.

## UI contract

Secure-worker and AI tool pages render a contract preview instead of a fake uploader. The preview shows:

- processing mode
- expected inputs and outputs
- pipeline stages
- file limits
- retention window
- “not yet enabled” status

`/tools/ocr-pdf` goes further with a dedicated, OCR-specific panel (`ocr-worker-panel.tsx`): the same honest pipeline and retention, plus real recognition settings (languages, output mode, skip-text) validated by the shared contract, a live capability check, and an uploader that appears **only** if the status endpoint reports OCR available. Live in-browser tools do not call these endpoints.

## Definition of done for first real worker

A worker-backed tool is production-ready only when it has:

- Upload session creation.
- Direct-to-storage upload.
- Queue-backed job creation.
- Status polling.
- Signed output download.
- Automatic deletion — proven active on every terminal executor path
  (`executor.leak.test.ts`) and verifiable against the bucket's live lifecycle config
  out-of-band (`--lifecycle-verify`, Phase 25).
- Tests for validation, job states, and one happy-path processor.
- Security review for input validation, egress, file handling, and logging.

**Phase 7 progress toward this:** the local-dev worker already covers upload-session creation, upload transport, job creation, status polling, output download, post-job input wipe + retention/expiry, a presence-only client capability probe, an honest Compress UI integration, and tests for validation + job states + transport routes + a real happy-path processor (lossless) end-to-end through the route handlers.

**Phase 13 progress toward this:** the compute seam is now a typed **processor registry** and a real, unit-tested **executor loop** (claim → read inputs → dispatch processor → write artifacts → complete/fail), with a backward-compatible `ClaimableQueue` (claim/lease/heartbeat/redelivery) and a worker-side `ExecutorStorage` seam. It proves queue-backed job state progression (`queued → scanning → processing → completed/failed`), retryable-vs-terminal failure handling, cancellation while queued/running, and artifact cleanup on failure — deterministically, with no daemon in the app runtime.

**Phase 14 progress toward this:** the **storage adapter** is now real — a configured S3/R2/MinIO backend mints genuine signed upload/download URLs and executes signed deletes (direct-to-storage upload + signed output download, two of the checklist items above).

**Phase 15 progress toward this:** the **queue adapter** is now real — a configured Redis/Upstash broker gives genuine queue-backed job creation, status polling, cancel/expire, and idempotency, plus the worker-claim surface (claim/lease/heartbeat/retry/dead-letter) a daemon would call. Upload-session creation, direct-to-storage upload, queue-backed job creation, status polling, and signed output download are therefore all covered by shipped adapters. Remaining for production: a sandboxed **worker daemon** that actually runs `drain()` on an interval (nothing drains the queue yet, so a configured deployment holds jobs `queued`), lifecycle-enforced deletion policies on the bucket, malware scanning in the scan phase, native `deep`/OCR runners behind the processor contract, and a hardening pass to move the queue's read→write state transitions into a Lua/`WATCH` critical section.

**Phase 16 progress toward this:** the **worker daemon runner** is now real — an out-of-band CLI (`pnpm worker:daemon`, `src/lib/workers/daemon/`) that wires the real queue + a worker-side S3/R2 `ExecutorStorage` (genuine signed byte I/O) + the processor registry into `createWorkerExecutor(...)` and runs `runOnce()`/`drain()` with `--once`/`--drain`/`--loop`/`--dry-run-status` modes, cooperative shutdown, and content-free logging. A deployment can now genuinely drain a configured queue and complete real (lossless-compression) jobs. What remains is operational, not architectural: **deploy** this daemon in sandboxed worker infrastructure (the app still never runs it) with lifecycle-enforced bucket deletion and malware scanning in the scan phase; wire native `deep`/OCR runners behind the processor contract (still honestly `not_implemented` without them); thread the original input filename through object metadata / the job spec (worker outputs currently use a content-type-derived name); and move the queue's read→write transitions into a Lua/`WATCH` critical section.

**Phase 21 progress toward this:** the last item above — the queue's read→write transition window — is now **closed**. Every worker-owned state transition (the claim commit, stale-lease redelivery, heartbeat, advance, terminal complete/fail, requeue) runs as a single server-side Lua `EVAL` compare-and-set (`src/lib/workers/queue/redis-scripts.ts`) that re-reads the authoritative job/lease, re-validates the expected status **and** the claim's attempt fingerprint, and only then writes — so the check and the write are one atomic step, not a last-writer-wins race. (`WATCH`/`MULTI` is not viable here: the Upstash Redis REST transport is stateless, with no persistent connection to hold a watch across requests; `EVAL` is the atomic primitive that transport does support.) The executor threads each claim's attempt back through its transitions, so a daemon whose lease was reclaimed cannot heartbeat, complete, fail, or requeue the job another worker now owns; `cancel`/`expire` remain status-guarded (no lease) and race a running completion deterministically. A provider that cannot execute the scripts returns a typed `unavailable` rather than silently degrading, and `PDFXYZ_QUEUE_REQUIRE_ATOMIC` (implied by `PDFXYZ_WORKER_STRICT`) fails a deployment fast when atomic transitions cannot be guaranteed. Still out-of-band and unchanged: deploying the daemon with real broker/storage credentials, lifecycle-enforced bucket deletion, and native `deep`/OCR runners.

**Phase 22 progress toward this:** the **malware-scan gate** — "Malware scanning before processing" from the security-controls list — is now real. The executor runs a typed scan gate on a job's inputs **before** advancing to `processing` (`src/lib/workers/scanner/`), and Phase 22 ships an **optional ClamAV/clamd** backend behind it (streams each input over INSTREAM; `./clamav` node-free, its socket behind an injected transport). It is off by default (the honest no-op runs — nothing is scanned, nothing is *reported* as scanned); an operator turns it on with `PDFXYZ_MALWARE_SCANNER=clamav://host[:port]` (or `clamav+unix:///path`) plus bounded `PDFXYZ_CLAMAV_*` knobs. An `infected` verdict blocks the job terminally (`malware_detected`) before any processing so no artifact is produced; an unscannable/oversize input fails closed (`scan_invalid`); a transient clamd failure is retryable (`scan_unavailable`) for a required scanner or degrades to `skipped` for an optional one; `clean` proceeds. Readiness (`disabled`/`not-configured`/`ready`/`unavailable`), a `scanner_health` line, and guardrails (`require-scan`, `scan_selected_but_invalid`, `scan_provider_unrecognized`) are all presence-only and content-free — the clamd signature name is dropped at the protocol layer and never reaches a log or error. Still out-of-band and unchanged: deploying the daemon (and a clamd sidecar) with real credentials, lifecycle-enforced bucket deletion, and native `deep`/OCR runners.
