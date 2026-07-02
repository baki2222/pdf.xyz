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
| OCR native processor (searchable PDF / text) | Planned, not enabled |
| Processor registry + contract | Implemented in `src/lib/workers/processor/` |
| Worker executor loop (claim → process → complete) | Implemented in `src/lib/workers/executor/` |
| Queue claim/lease/heartbeat (`ClaimableQueue`) | Implemented in `src/lib/workers/queue/` |
| S3/R2-compatible storage provider (production) | Implemented in `src/lib/workers/storage/s3*.ts` (opt-in via `PDFXYZ_STORAGE_PROVIDER=s3`) |
| Redis/Upstash queue provider (production) | Implemented in `src/lib/workers/queue/redis*.ts` (opt-in via `PDFXYZ_QUEUE_PROVIDER=redis`) |
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

A completed OCR job's shape is typed by `OcrResultMeta` / `OcrPageResult` (engine, languages, pages processed/skipped, characters recognized, mean confidence, which artifacts were produced). These describe what a real processor fills in — this module never estimates or fakes them.

### OCR capability (`src/lib/workers/ocr.ts`)

`buildOcrCapability(mode, engines?)` derives the client-safe `WorkerStatus.ocr` — `{ available, engine, languages, detail }` — from the resolved mode and the OCR engines a worker advertises (presence only, never a value). The status route **deliberately passes no OCR engines**, because no OCR pipeline ships, so `available` is `false` everywhere with an honest, mode-specific `detail`. The `engines`-driven branch (and `probeOcrEngines`) exist so the capability flips on correctly — and is unit-tested — the moment a real OCR processor is wired behind the adapter contract.

### OCR tool page (`src/components/tools/ocr-worker-panel.tsx`)

`/tools/ocr-pdf` renders a premium, OCR-specific secure-worker panel instead of the generic preview. It reads the live `/api/worker/status` endpoint (emitting the Phase 10 `worker_status_checked` event — mode + enabled only), lets the user configure a real request (languages, output, skip-text) validated by the shared `parseOcrOptions`, and shows the exact pipeline — encrypted upload → scan → isolated recognition → download → auto-delete. When OCR is unavailable it says so plainly and **mounts no uploader**; only when the endpoint honestly reports OCR available does it mount a file picker and run the documented flow via `runWorkerOcr` (`src/lib/workers/ocr-client.ts`), surfacing only real downloaded output or an honest failure.

### Future OCR processor requirements

A production OCR processor, deployed behind the same adapter contract, must: run **OCRmyPDF/Tesseract or a managed OCR provider** in a sandboxed, no-egress job; ship the language packs advertised by the capability; produce a searchable PDF (invisible text layer) and/or a text sidecar per `outputMode`; honor `skipTextPages`; and return `OcrResultMeta` from actual recognition. Inputs are wiped right after processing and outputs auto-delete on their TTL, exactly like every other job.

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
but not run yet. Concurrency is correct-by-atomic-primitive (RPOP/ZREM), but the
read→write window on state transitions is last-writer-wins guarded by the state
machine; a production hardening step would move those to a Lua/`WATCH` critical
section. See DEPLOYMENT.md for how to configure it and OBSERVABILITY.md for what to
watch.

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

Still honest about limits: OCR and deep compression remain engine-dependent (the
daemon changes nothing there), and whether a daemon is actually deployed and running
is **out-of-band** — `/api/worker/status` reports `daemon.drainable` (queue + storage
configured, so a worker *could* drain here) but never claims a worker is live, which
the app cannot observe.

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

- **`web`** runs `pnpm start` (Next.js). It installs **no** native PDF engines and its
  layers never reference the worker daemon.
- **`worker`** runs `pnpm worker:daemon`. It installs **Ghostscript, qpdf, and
  `mupdf-tools`** for deep compression and copies `src/`/`scripts/`/`tsconfig.json`/
  `node_modules` (the daemon runs via `tsx`) but **not** the web build (`.next`), and
  serves no HTTP.

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
  `NEXT_PUBLIC_` provider value.

The Docker build itself was **not exercised** in this repository's environment (no Docker
daemon); the images must be built and run in real worker infrastructure. See
DEPLOYMENT.md's "Phase 19 worker container" section for the build and health-check
commands.

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

### Composed deployment readiness (`src/lib/workers/deploy/readiness.ts`)

`resolveDeploymentReadiness()` folds six presence-only facets into one posture
(`ready` / `degraded` / `blocked`) the daemon prints on `--dry-run-status`:

| Facet | Green when | Notes |
| --- | --- | --- |
| storage | S3/R2 configured | a worker can read inputs / write artifacts |
| queue | claimable broker configured | a worker can claim/complete |
| engine | native engine installed (injected probe) | lossless always; deep needs a binary |
| lifecycle | operator-declared `validated` | else `degraded`/`unknown` — never assumed |
| malware-scan | **never** — not implemented in this build | reports inactive, honestly |
| ocr | **never** — not implemented in this build | reuses the OCR capability detail |

`blocked` = not drainable (can't run at all); `ready` = drainable **and** a validated
lifecycle backstop; otherwise `degraded`. Malware/OCR being not-implemented is the
honest baseline and does not by itself degrade the posture.

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

- Malware scanning before processing.
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
- Automatic deletion verified by lifecycle policy.
- Tests for validation, job states, and one happy-path processor.
- Security review for input validation, egress, file handling, and logging.

**Phase 7 progress toward this:** the local-dev worker already covers upload-session creation, upload transport, job creation, status polling, output download, post-job input wipe + retention/expiry, a presence-only client capability probe, an honest Compress UI integration, and tests for validation + job states + transport routes + a real happy-path processor (lossless) end-to-end through the route handlers.

**Phase 13 progress toward this:** the compute seam is now a typed **processor registry** and a real, unit-tested **executor loop** (claim → read inputs → dispatch processor → write artifacts → complete/fail), with a backward-compatible `ClaimableQueue` (claim/lease/heartbeat/redelivery) and a worker-side `ExecutorStorage` seam. It proves queue-backed job state progression (`queued → scanning → processing → completed/failed`), retryable-vs-terminal failure handling, cancellation while queued/running, and artifact cleanup on failure — deterministically, with no daemon in the app runtime.

**Phase 14 progress toward this:** the **storage adapter** is now real — a configured S3/R2/MinIO backend mints genuine signed upload/download URLs and executes signed deletes (direct-to-storage upload + signed output download, two of the checklist items above).

**Phase 15 progress toward this:** the **queue adapter** is now real — a configured Redis/Upstash broker gives genuine queue-backed job creation, status polling, cancel/expire, and idempotency, plus the worker-claim surface (claim/lease/heartbeat/retry/dead-letter) a daemon would call. Upload-session creation, direct-to-storage upload, queue-backed job creation, status polling, and signed output download are therefore all covered by shipped adapters. Remaining for production: a sandboxed **worker daemon** that actually runs `drain()` on an interval (nothing drains the queue yet, so a configured deployment holds jobs `queued`), lifecycle-enforced deletion policies on the bucket, malware scanning in the scan phase, native `deep`/OCR runners behind the processor contract, and a hardening pass to move the queue's read→write state transitions into a Lua/`WATCH` critical section.

**Phase 16 progress toward this:** the **worker daemon runner** is now real — an out-of-band CLI (`pnpm worker:daemon`, `src/lib/workers/daemon/`) that wires the real queue + a worker-side S3/R2 `ExecutorStorage` (genuine signed byte I/O) + the processor registry into `createWorkerExecutor(...)` and runs `runOnce()`/`drain()` with `--once`/`--drain`/`--loop`/`--dry-run-status` modes, cooperative shutdown, and content-free logging. A deployment can now genuinely drain a configured queue and complete real (lossless-compression) jobs. What remains is operational, not architectural: **deploy** this daemon in sandboxed worker infrastructure (the app still never runs it) with lifecycle-enforced bucket deletion and malware scanning in the scan phase; wire native `deep`/OCR runners behind the processor contract (still honestly `not_implemented` without them); thread the original input filename through object metadata / the job spec (worker outputs currently use a content-type-derived name); and move the queue's read→write transitions into a Lua/`WATCH` critical section.
