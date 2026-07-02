# pdf.xyz Engine Roadmap

This document defines the current execution model for every PDF capability in `pdf.xyz`: what runs fully in the browser today, what needs a secure worker, and what belongs in AI-assisted services. The product promise is honesty: every tool must clearly state where work happens and whether files leave the device.

## Engine principles

- **Privacy by architecture first:** run common operations in-browser whenever the browser can do them reliably.
- **No fake processing:** if a browser library cannot truly compress, OCR, redact, or convert a document, the UI must say so and route to the correct future worker plan.
- **Deterministic outputs:** core tools must be testable with real PDFs and predictable output names.
- **Progressive enhancement:** page thumbnails, drag/reorder, and real previews improve UX but should never block the underlying PDF operation.
- **Worker isolation:** future server-side operations should use short-lived object storage, isolated queues, malware scanning, file-size limits, and automatic deletion.

## Live client-side tools

These tools currently run in the user's browser using `pdf-lib` and related browser APIs.

- `merge-pdf`: combine multiple PDFs into one output PDF.
- `split-pdf`: split by custom ranges, every N pages, or one PDF per page; multi-output results are zipped.
- `rotate-pdf`: rotate selected pages and download a new PDF.
- `remove-pages`: delete selected pages from a PDF.
- `extract-pages`: extract selected pages into a new PDF.
- `organize-pages`: reorder, rotate, duplicate, and delete pages before exporting.
- `compress-pdf`: honest in-browser optimization analyzer and lossless structural repack. It does **not** pretend to downsample images when that is not available client-side. Deep image compression is a **separate secure-worker path** (`src/lib/workers/compression/`), never conflated with this on-device analyzer.

## Live UX upgrades

- Reusable runner framework under `src/components/tools/runner/`.
- PDF-safe file validation and clearer errors.
- Output naming helpers.
- Page tiles with rotation state.
- Real thumbnail rendering utilities when browser support allows it; graceful fallback to lightweight page glyphs.

### Phase 5 editor depth (shipped)

- **Undo/redo** in Organize Pages, backed by a pure, unit-tested history reducer
  (`organize-history.ts`) with a bounded timeline and `Ctrl/⌘+Z` / `Ctrl/⌘+Shift+Z`
  shortcuts.
- **Keyboard reordering:** each organize tile has a focusable drag handle —
  Enter/Space to grab, arrow keys / Home / End to move, Escape to cancel — with
  live-region announcements for screen readers. uid-addressed moves keep it
  correct under key-repeat.
- **Selection helpers:** shared, tested `Select all` / `Clear` / `Invert` plus
  Shift-click (and Shift-Enter/Space) range selection across the extract, delete,
  and rotate runners (`selection.ts`).
- **Large-PDF thumbnails:** documents are parsed once into an on-demand renderer
  (`createThumbnailRenderer`); the first ~60 pages render eagerly and the rest
  render lazily as they scroll into view, bounding up-front work and peak memory.
  Object URLs and the pdfjs document are always released on unmount/source change.
- **Thumbnail status UI:** a reusable progress/`capped`/error component with
  honest fallback copy when previews can't render.
- **Merge validation:** encrypted/corrupt/oversized files are validated per file
  before merge and surfaced as a dismissible, per-file reason list rather than a
  single overwritten error; each staged file shows its page count.

## Secure worker tools

These require a backend/worker pipeline because high-quality results need native binaries, Office renderers, OCR engines, image recompression, sandboxing, or AI models.

- Office conversions: Word/Excel/PowerPoint to PDF and PDF to Office.
- High-quality compression: image downsampling, font subsetting, object deduplication, qpdf/ghostscript-style optimization. The engine and adapter contract exist (`src/lib/workers/compression/`); a native processor is wired for local-dev and pending for production.
- OCR PDF and searchable scan creation.
- HTML/webpage to PDF rendering.
- PDF/A conversion and compliance checks.
- Repair PDF.
- Redaction with irreversible content removal and audit metadata.
- Compare PDF with visual diff rendering.
- PDF forms detection and fillable-form creation.
- E-signature request workflows and identity/audit trails.

### Worker architecture plan

1. **Upload session service**
   - Creates short-lived upload URLs and job IDs.
   - Enforces file count, size, type, and abuse limits.

2. **Object storage**
   - Encrypted bucket with lifecycle deletion.
   - Default deletion target: minutes to hours, not days.

3. **Job queue**
   - Tool-specific queue names and concurrency limits.
   - Status endpoint for progress, errors, and download links.

4. **Sandboxed processors**
   - LibreOffice for Office conversions.
   - Ghostscript/qpdf/mutool for compression, repair, PDF/A, and structural work.
   - OCRmyPDF/Tesseract or managed OCR for searchable scans.
   - Playwright/Chromium for HTML and webpage capture.

5. **Security controls**
   - Malware scanning before processing.
   - No arbitrary file paths in outputs.
   - Per-job temporary directories.
   - Network egress restrictions for processors except webpage-to-PDF jobs.
   - Strict logging policy: no file contents in logs.

## AI-assisted tools

AI features must be explicitly opt-in and should display model/data handling clearly.

- Summarize PDF.
- Chat with PDF.
- Translate PDF.
- Extract tables intelligently.
- Classify/rename documents.
- Redaction suggestions.
- Form-field suggestions.

### AI architecture plan

- Extract text client-side where feasible; server-side OCR fallback for scans.
- Chunk and embed documents only after user consent.
- Keep AI output separate from deterministic PDF transformations.
- Support deletion of indexed document data.
- Add clear UI labels: “AI worker” and “file content is processed by AI.”

## Near-term implementation phases

### Phase 4 — deployment and product hardening

- Deploy preview to Vercel or equivalent.
- Add environment-safe production configuration.
- Add Playwright smoke tests for homepage and core supported tools.
- Add basic analytics events that do not include document contents.
- Add security headers and CSP review.

### Phase 5 — thumbnails and visual editor depth ✅

- ✅ Improve thumbnail performance for large PDFs — eager cap + lazy, in-view,
  on-demand page rendering (parse once, render per page). Windowed/virtualized
  scrolling remains a future refinement for extreme page counts.
- ✅ Rendered thumbnails for merge multi-file previews (per-file cover images).
- ✅ Keyboard controls for page selection and ordering.
- ✅ Undo/redo for organize pages.
- ✅ Per-file validation of encrypted/corrupt PDFs before merge, with clear
  per-file errors.

### Phase 6 — secure worker contracts ✅

- ✅ Added typed upload/job/status/artifact/error contracts under `src/lib/jobs/`.
- ✅ Added strict dependency-free validation for worker requests, including safe filename rules, MIME allowlists, opaque file/job ids, size limits, idempotency keys, and public-URL SSRF guards.
- ✅ Added development contract route stubs under `src/app/api/uploads` and `src/app/api/jobs/*`. These validate requests and return explicit “worker backend not configured” responses; they do **not** fake processing.
- ✅ Added secure-worker preview UI for worker/AI/hybrid tool pages with expected inputs, outputs, retention, lifecycle stages, and “not yet enabled” status.
- ✅ Documented queue/storage/sandbox/retention/security details in `docs/WORKER_ARCHITECTURE.md`.

### Phase 7 — first real secure worker (in progress)

- ✅ Added a mode-gated **worker adapter** (`src/lib/workers/`) that the API routes
  delegate to. Modes are presence-only: `disabled` (default → `503`),
  `remote-configured` (backend vars present → `501`), and `local-dev`
  (`PDFXYZ_WORKER_MODE=local-dev` → real in-process processing).
- ✅ Added a high-quality **compression engine** with an honest `lossless` (pdf-lib,
  always available) vs `deep` (native Ghostscript/qpdf/mutool, probed on PATH)
  split. Deep compression without a native engine fails honestly as a typed
  `not_implemented` job — never a dummy completed file.
- ✅ Wired a developer-only **local compression worker** running the full flow —
  reserve slot → upload → job → download — in process, with unit tests for
  adapter selection, engine planning, and every failure mode, plus route-handler
  tests for the transport endpoints and an end-to-end lossless run through the
  real handlers.
- ✅ **Inputs are wiped as soon as processing finishes** (single-use upload slots);
  outputs live on their own retention TTL and drop lazily once expired.
- ✅ Added a presence-only **worker status endpoint** (`GET /api/worker/status`) so
  the client can discover availability without reading secrets, and **integrated
  the Compress tool UI**: on-device lossless analysis always, plus the
  secure-worker deep path where configured — labeled honestly (including
  "local-dev only" and "no native engine installed").
- ⏳ Remaining for production: direct-to-storage uploads, queue-backed execution,
  signed downloads, lifecycle-enforced deletion, an explicit signed "delete now",
  and a native `deep` processor deployed behind the same adapter contract. OCR is
  next: its contract, capability mapping, UX, and browser client shipped in
  **Phase 11** (below); only the native processor remains.

### Phase 8 — account and workspace

Direction: anonymous local workspace first, optional account sync later, saved
workflows and batch processing next, and team workspaces only after core
consumer tools are excellent.

#### Local-first batch workspace (shipped)

The `/workspace` route is a browser-only staging hub — a "professional batch
hub" feel without ever leaving the device. All logic lives in a pure,
unit-tested model under `src/lib/workspace/` (classify · reducer · storage ·
suggestions), wired to React by `src/app/workspace/use-workspace.ts`.

- **Local-only staging.** Files are staged as *metadata* in browser memory. Raw
  bytes are never uploaded and never persisted; drag-drop or browse, per-file
  remove, and clear-all all operate in-tab. Empty/oversized files are rejected
  with a specific reason (100 MB in-browser ceiling).
- **File-aware cards.** Each staged file shows a family glyph, a type label, its
  size, and — for PDFs — a **page count parsed locally in the browser**
  (`src/lib/pdf/page-count.ts`, `pdf-lib` via dynamic import; best-effort, null
  on failure, never uploaded). A per-type breakdown summarizes the mix.
- **Smart suggestions.** `suggestTools` turns the staged file mix into ranked,
  honest next steps (e.g. 2+ PDFs → Merge; images → JPG/PNG→PDF), validated
  against the real catalog so it never suggests a tool that doesn't exist.
- **Batch queue + handoff.** Choose one tool, queue staged files, and get an
  *honest* status: `ready` (live in-browser tool), `single` (one-file runner),
  `worker-disabled` (secure-worker tool not enabled in this environment), or
  `unavailable` — derived from tool capability, never faked. Ready live tools
  use a browser-only handoff: files are written to origin-private IndexedDB,
  opened with `/tools/<slug>?handoff=<id>`, claimed exactly once, and then the
  URL token is stripped.
- **Name-free persistence.** Only tool preferences and a tool-oriented activity
  log persist (versioned, migrated, guarded `localStorage`). File names and sizes
  stay in memory/IndexedDB only for the active handoff TTL; activity logs never
  store file names or bytes.

**Current limitation (stated honestly in the UI):** workspace launch preloads
files into the first live tool. It is not yet a multi-step unattended automation
engine: batch launch/prep opens a real supported runner, and worker-backed batch
runs still require the secure-worker production backend.

### Phase 10 — production polish, resilience & observability (shipped)

Hardening the shipped surface so it feels safer, faster, and production-operable
— without faking any monitoring. All of it is inert by default and honest about
what is (and isn't) wired.

- **App-wide resilience.** Added App Router `error`, `global-error`, and
  `loading` boundaries plus a reusable client `ErrorBoundary`
  (`src/components/telemetry/error-boundary.tsx`) wrapping the heavy in-browser
  tool runner, so one component's failure shows a localized, retryable fallback
  instead of a blank page. User-facing copy never exposes raw error internals.
- **Privacy-safe telemetry (opt-in, no-op by default).** A small client reporter
  (`src/lib/telemetry/`) sends redacted error + Web-Vitals reports **only** when
  `NEXT_PUBLIC_TELEMETRY_ENDPOINT` is set. Presence-only config mirrors the
  worker-backend pattern; with nothing set there is no beacon, no Web-Vitals
  listener, and no CSP change. There is **no** invented backend — bring your own
  sink. See [`docs/SECURITY.md`](SECURITY.md).
- **Redaction as a primitive.** Reusable, unit-tested helpers scrub file names,
  file contents, hand-off tokens, `data:`/`blob:` URLs, and URL query strings
  from every payload, and reduce any URL to origin+path — enforced in the pure
  report builders, not left to call sites.
- **Hand-off cleanup & reliability.** Expired hand-offs are now swept on
  workspace open (not just tool mount); the URL-token read/strip logic is
  extracted to a pure, unit-tested module (`src/lib/handoff/url.ts`) that removes
  the token while preserving sibling params; and a workspace **Clear session**
  control wipes staged files, remembered preferences, activity, and any pending
  hand-off bytes — all on-device.
- **Performance & a11y polish.** Split the workspace tool-summary builder so the
  catalog / jobs / registry graph stays out of the client bundle
  (`summary.ts` vs. `presenter.ts`); added `aria-live` status regions for
  hand-off and batch outcomes.

### Phase 11 — OCR secure-worker foundation (shipped)

The next secure-worker capability, built **honestly** end-to-end without a native
processor yet. No mode ships OCR, so it is reported unavailable everywhere with a
mode-specific reason — no fake searchable PDFs or invented text.

- **OCR options contract** (`src/lib/jobs/ocr.ts`): a pure, unit-tested
  `parseOcrOptions` validating recognition languages (curated ISO 639-2/T
  allowlist, 1–4, de-duplicated), output mode (`searchable-pdf` / `text` /
  `both`), and `skipTextPages`; plus `OcrResultMeta` / `OcrPageResult` typing what
  a real processor returns.
- **Presence-only OCR capability** (`src/lib/workers/ocr.ts`): `buildOcrCapability`
  extends `WorkerStatus` with an `ocr` field carrying its own honest `detail`. The
  status route never probes an OCR engine, so `ocr.available` is `false` in every
  environment; the `engines`-driven and `probeOcrEngines` paths are ready and
  tested for the day a real engine is wired.
- **Premium OCR tool page** (`src/components/tools/ocr-worker-panel.tsx`): an
  OCR-specific secure-worker flow with live capability check, real recognition
  settings validated by the shared contract, the full upload→scan→recognize→
  download→delete pipeline, and **no uploader** unless OCR is honestly available.
  A contract-complete browser client (`src/lib/workers/ocr-client.ts`) drives the
  real documented job flow when it is.
- **Honest status surface**: the `/status` page shows an explicit OCR capability
  row read live from the endpoint, and the OCR page reuses the Phase 10
  `worker_status_checked` telemetry event (mode + enabled only).
- ⏳ Remaining for production: an OCRmyPDF/Tesseract (or managed) processor behind
  the adapter contract, with language packs, per-page confidence, and the same
  storage/queue/deletion guarantees as every other worker.

### Phase 12 — worker storage + queue foundation (shipped)

The worker backend is now decomposed into explicit provider contracts rather than
route-level stubs. This makes the production cutover concrete without adding any
cloud credentials or fake processing.

- **Object storage provider contract** (`src/lib/workers/storage/`): typed upload
  reservations, signed download reservations, delete-now receipts, TTL metadata,
  disabled/remote-unimplemented/local-dev provider ids, and provider capabilities.
  Disabled/remote providers can only return typed failures; they cannot mint a
  usable upload or download URL.
- **Queue provider contract** (`src/lib/workers/queue/`): typed enqueue,
  idempotency lookup, status, cancel, expire, and a pure job state-machine. The
  local-dev queue is in-process and deterministic; the remote skeleton remains
  honest until a real broker adapter is wired.
- **Adapter integration**: the local-dev worker now composes storage + queue +
  processor seams. Upload targets and artifact downloads flow through storage;
  job records and delete-now/cancel/expire flow through queue. Existing disabled
  and remote-configured public responses are preserved.
- **Delete-now path**: `DELETE /api/jobs/:id` is the signed delete/cancel control.
  With no backend it returns the same honest not-configured response; in local-dev
  it cancels cancelable jobs or expires completed jobs and removes artifact
  references.
- **Status readiness**: `/api/worker/status` now includes provider readiness for
  storage, queue, and processor so the UI can say which production piece is
  missing without exposing env variable names or values.

⏳ Remaining for production: implement a real storage provider (S3/R2/GCS), a real
queue provider (SQS/PubSub/Redis/etc.), worker claim/execution loops, object
lifecycle policies, and signed authenticated delete requests in front of the
same contracts.

### Phase 13 — worker executor foundation (shipped)

The compute seam behind the adapter is now a typed **processor registry** plus a
real, unit-tested **execution loop** — the missing "worker claim/execution loop"
from Phase 12 — without adding any credential, background service, or fake
processing.

- **Processor registry & contract** (`src/lib/workers/processor/`): a pure,
  node-free `Processor` interface (`supports` / `capability` / `process`) with a
  registry that routes a tool slug to its processor. Compression and OCR are both
  registered behind it; the local-dev adapter dispatches through the *same*
  compression processor the executor runs, so the sync and async paths can't
  drift. OCR validates honestly and returns `not_implemented` (no runner ships);
  it flips on the moment a real OCRmyPDF/Tesseract runner is injected.
- **Worker executor** (`src/lib/workers/executor/`): `createWorkerExecutor(...)` is
  a dependency-injected loop, **not a daemon** — it starts no timer or thread.
  `runOnce()` claims a job, reads inputs via an `ExecutorStorage` seam, dispatches
  the processor, writes artifacts, and drives the job to a terminal state;
  `drain()` runs until idle. Deterministically unit-tested for success, terminal
  failure, retryable requeue-then-succeed, retry exhaustion, cancellation while
  queued and while running, missing inputs, and artifact cleanup on cancel.
- **`ClaimableQueue`** (`src/lib/workers/queue/`): a backward-compatible extension
  of the queue contract adding `submit`/`claim`/`heartbeat`/`advance`/`complete`/
  `fail`, lease + attempt bookkeeping, and explicit redelivery edges in the state
  machine — the base `QueueProvider` and its routes are untouched.
- **Status**: `/api/worker/status` now reports `providers.processor.executor`
  (presence-only: `in-process` / `not-implemented` / `none`), never naming a
  broker or worker URL.

⏳ Remaining for production: real queue/worker adapters behind these contracts (a
sandboxed worker process running `drain()` on an interval), lifecycle-enforced
bucket policies, malware scanning in the scan phase, and native `deep`/OCR
runners behind the processor contract.

### Phase 14 — S3/R2-compatible storage provider foundation (shipped)

The object-storage seam is now production-shaped and can mint real presigned URLs
for S3-compatible storage without claiming that the full remote worker pipeline is
live.

- **S3-compatible provider** (`src/lib/workers/storage/s3.ts`): when explicitly
  selected with `PDFXYZ_STORAGE_PROVIDER=s3` and valid server-side config, the
  adapter returns genuine SigV4 signed PUT/GET URLs for uploads/downloads and
  executes signed DELETE for delete-now. No AWS SDK dependency is required; the
  signer is a deterministic `node:crypto` implementation tested against AWS's
  published SigV4 vector.
- **Safe keys and ids**: bucket keys are derived only from server-minted opaque ids
  under `inputs/` and `artifacts/` plus an optional sanitized prefix. Filenames,
  user paths, and arbitrary object keys never enter a signed URL path.
- **Bounded TTLs and size checks**: upload/download TTLs default to 15 minutes and
  are bounded by SigV4's 7-day limit; oversized upload reservations fail before a
  URL is signed.
- **Presence-only readiness**: `/api/worker/status` can report storage ready while
  queue/processor remain not ready. The response never names bucket, endpoint,
  region, key id, prefix, variable names, or secret values.
- **Still honest**: with no S3 config (or malformed config), behavior falls back to
  the existing disabled/remote-unimplemented typed failures. Jobs still do not run
  remotely until a real queue adapter and sandboxed worker process are deployed.

⏳ Remaining for production: real queue/broker adapter, worker-side bucket byte I/O
adapter for `ExecutorStorage`, malware scanning, native compression/OCR runners,
and a deployed out-of-band worker process.

### Phase 15 — Redis/Upstash queue provider foundation (shipped)

The job-queue seam is now production-shaped and backs real job state with a shared
Redis broker — the "real queue/broker adapter" that Phases 12–14 kept deferring —
without claiming a worker daemon is live.

- **Redis/Upstash provider** (`src/lib/workers/queue/redis.ts` + `redis-client.ts`):
  when explicitly selected with `PDFXYZ_QUEUE_PROVIDER=redis` and valid server-side
  config, the adapter records real `queued` jobs over the Redis HTTP REST API and
  implements the full `ClaimableQueue` — enqueue/submit, idempotency, status,
  cancel, expire, and claim/heartbeat/advance/complete/fail with leases, an attempt
  counter, redelivery, and a dead-letter cap. No native Redis client dependency; the
  transport is a small typed REST client with an injectable `fetch`.
- **Safe keys and ids**: every broker key is `<prefix>:<namespace>:<server-minted
  id>`; the client idempotency key is SHA-256 hashed, never embedded. No client ever
  supplies a Redis key, stream name, or broker id, and commands are JSON argument
  arrays (no RESP string interpolation).
- **Bounded settings**: sanitized key prefix, lease-duration ceiling, dead-letter
  attempt cap, and a per-key retention TTL, each validated within strict bounds.
- **Independent, presence-only readiness**: `/api/worker/status` can report the
  queue ready (`provider: "redis"`) independently of storage, exposing no endpoint,
  token, prefix, key, or variable. A transport outage is a typed `unavailable`
  (HTTP 500), never a fabricated job.
- **Still honest — no fake processing**: a created job is enqueued only when storage
  is *also* ready and returns `202` in the `queued` state; because **no worker
  daemon ships**, it stays queued until one is deployed, and the status endpoint
  says exactly that. Nothing is reported `completed` unless a real processor writes
  artifacts.

⏳ Remaining for production (the worker process + worker-side byte I/O are delivered
by Phase 16, below): malware scanning in the scan phase, native `deep`/OCR runners,
lifecycle-enforced bucket deletion, and a hardening pass to move the queue's read→
write state transitions into a Lua/`WATCH` critical section.

### Phase 16 — worker daemon/runner foundation (shipped)

The out-of-band worker process the queue/storage phases kept deferring is now real:
an opt-in daemon that drains the queue and runs the executor, without faking any
native processing.

- **Daemon runner + CLI** (`src/lib/workers/daemon/` + `scripts/worker-daemon.ts`,
  `pnpm worker:daemon`): `resolveWorkerRuntime(env)` wires a drainable `ClaimableQueue`
  + a worker-side `ExecutorStorage` + the processor registry into
  `createWorkerExecutor(...)`; an injectable loop runs `--once`/`--drain`/`--loop`
  with tick caps, an idle-poll sleep, cooperative SIGINT/SIGTERM shutdown, and a
  `--dry-run-status` readiness report. It is never imported by the web app.
- **Worker-side S3/R2 byte I/O** (`src/lib/workers/executor/s3-storage.ts`): the
  deployed worker reads input objects and writes artifact objects itself with genuine
  SigV4-signed GET/PUT/DELETE. A missing object is an honest terminal `not_found`; a
  transient failure is retried via lease expiry; each artifact embeds a real signed
  download URL, and object keys are shared with the app provider so the two can never
  drift.
- **Honest by construction**: exits `2` when not configured to run, fails an
  unrunnable job with `not_implemented` (OCR, or `deep` with no native engine) rather
  than fabricating a completion, and logs only content-free structured events. The
  web `/status` gains a `daemon` readiness that reports drainability without ever
  claiming a worker is actually deployed.

⏳ Remaining for production: **deploying** the daemon in sandboxed worker infra with
lifecycle-enforced bucket deletion and real malware scanning, native `deep`/OCR
runners behind the processor contract, and the queue's Lua/`WATCH` hardening pass.

### Phase 17 — native compression worker path, proven end-to-end (shipped)

The compression worker path the earlier phases wired is now **proven** to complete real
jobs out-of-band, without weakening any honesty boundary.

- **End-to-end integration + daemon smoke proof**
  (`src/lib/workers/daemon/native-compression.integration.test.ts`): a queued
  `compress-pdf` job is driven through the real stack — `resolveWorkerRuntime` →
  `createWorkerDaemon` (`--once`/`--drain`) → `createWorkerExecutor` → the compression
  processor — reading and writing bytes through the **production** worker-side S3 seam
  (`createS3ExecutorStorage`, over a stateful fake bucket). A job reaches `completed`
  **only after** real artifact bytes were read, processed, and written back; `lossless`
  always completes, `deep` completes through a deterministic injected native runner, and
  `deep` with no engine writes no artifact and fails honestly (`not_implemented`).
- **Compression-engine health, distinct from drainability**: `WorkerRuntime.compression`
  (surfaced as the daemon's `compression_health` line) reports presence-only
  `{ lossless: true, deep, engines }`, so an operator can smoke-test whether *this worker
  image* will do deep compression (`pnpm worker:daemon --dry-run-status`) separately from
  whether the queue + storage are drainable. Engines are named by binary name only.
- **Still honest**: `deep` remains genuinely engine-dependent (install Ghostscript / qpdf
  / mutool on the worker host); with none, only lossless runs. Worker outputs use
  sanitized display-only filename metadata when the client provided it, and otherwise
  fall back to deterministic content-type-derived names. The in-browser Compress
  analyzer is unchanged and never uploads.

### Phase 18 — worker filename metadata and artifact naming (shipped)

The secure-worker path now keeps useful output names without weakening the privacy
model.

- **Sanitized display names** (`src/lib/jobs/filenames.ts`): filenames are stripped
  of path components, controls, bidi/zero-width characters, unsafe separators, and
  header-injection vectors, then length-bounded. The sanitizer preserves a safe PDF
  extension when appropriate and falls back deterministically when metadata is absent.
- **Dual metadata channel**: S3/R2 uploads may include a signed
  `x-amz-meta-filename` header, while job specs may carry sanitized `inputNames`.
  The executor overlays these display names when it builds processor input metadata.
  They are values only — never object keys, Redis keys, URL paths/queries, status
  payloads, telemetry fields, or log fields.
- **Worker artifact names**: compression outputs now use names such as
  `invoice-compressed.pdf` when metadata is available; local-dev and production S3
  paths share the same sanitizer and fallback behavior.

⏳ Remaining for production: **deploying** the daemon with a native engine in the worker
image, lifecycle-enforced bucket deletion, malware scanning, the OCR runner, and the
queue's Lua/`WATCH` hardening pass.

### Phase 19 — worker deployment hardening + container smoke foundation (shipped)

The secure-worker stack is now shippable as real infrastructure, with the web app and
worker proven to stay separated.

- **Two-target container build** (`Dockerfile`): a shared build stage feeds two
  independent final images — `web` (Next.js `pnpm start`, no PDF engines) and `worker`
  (`pnpm worker:daemon` with Ghostscript/qpdf/mutool, no `.next`, no HTTP). Built by
  target: `docker build --target worker .` / `--target web .`.
- **Deployment artifacts**: `.dockerignore` (keeps `.env*`, `.claude-*.md`, `.git`, and
  tests out of every layer), an example `docker-compose.worker.yml` and
  `.env.worker.example` with placeholder variable **names** only, and
  `scripts/worker-smoke.sh` (`pnpm worker:smoke`).
- **No-config, CI-safe smoke**: `pnpm worker:smoke` and the new CLI test spawn the real
  daemon and pin the honest exit-code contract (`--help` → 0; `--dry-run-status` /
  `--once` / `--drain` → 2; bad or conflicting flags → 1). The container `HEALTHCHECK`
  reuses `--dry-run-status` (`pnpm worker:daemon:status`).
- **Enforced boundaries**: `src/deploy/import-boundary.test.ts` fails if a web bundle
  eagerly imports the Node-only daemon runtime or native-compression module (lazy
  `await import()` stays allowed); `src/deploy/artifacts.test.ts` pins the Dockerfile's
  web ↔ worker separation and fails on any committed real-looking secret or
  `NEXT_PUBLIC_` provider value.
- **Lifecycle/retention policy tooling** (`src/lib/workers/lifecycle/`): turns the
  configured retention into a provider-agnostic lifecycle **backstop** and renders it
  for AWS S3 / Cloudflare R2 / MinIO / generic, via `pnpm worker:daemon
  --lifecycle-policy`. Day-granular expiration is rounded *up* from the minute TTL so it
  can never delete a live object; retention overrides validate to a ≤ 7-day privacy
  ceiling; documents are content-free (structural prefixes + day counts, a `<bucket>`
  placeholder — no bucket/endpoint/credential).
- **Deployment readiness + guardrails** (`src/lib/workers/deploy/`): `--dry-run-status`
  reports a composed posture (`ready`/`degraded`/`blocked`) over six presence-only
  facets (storage, queue, engine, lifecycle, malware-scan, ocr); `--check` (and every
  run mode) evaluates production guardrails and **fails fast** (exit `4`) on a
  dangerous/invalid config — a *selected-but-invalid* provider is an error, not a silent
  fallback. `PDFXYZ_WORKER_STRICT` / `…_REQUIRE_*` enforce production requirements;
  defaults stay safe (a bare env has zero violations). Malware scanning and OCR are
  reported **not-implemented**, never active.

⏳ Still out-of-band (deliberately not faked): real secrets and a provisioned S3/R2
bucket + Redis/Upstash broker, the actual worker deployment and the Docker image build
itself (not exercised here — no Docker daemon in this environment), **applying** a
lifecycle policy to a live bucket (the tooling generates and validates it; the operator
applies it with the provider CLI — the app never calls the cloud), **malware scanning**,
and the native `deep`/OCR runners.

### Phase 20 — container CI + deployment-security gates (shipped)

The container model and the worker's honesty contract are now **always-on CI
checks**, so every PR proves the web/worker split and the no-config refusal without
needing a single cloud secret.

- **Container workflow** (`.github/workflows/container.yml`): a first-class CI job
  that builds **both** Dockerfile targets on GitHub Actions (the real `docker build`
  this repo's environment can't run), then, inside the built **worker** image with
  nothing configured, runs `pnpm worker:smoke`, asserts the readiness probe reports
  not-configured (exit `2`), and proves the split at the image level — the native
  engines (`gs`/`qpdf`/`mutool`) exist in the worker image and are **absent** from
  the web image. Images build with `push: false` (validated, never published), so the
  workflow references **no** repository secret.
- **Docker-free gate** (`.github/workflows/ci.yml`): the JS CI job also runs
  `pnpm worker:smoke`, gating the daemon's full exit-code contract (clean `0`,
  not-configured `2`, usage `1`, fail-fast guardrail `4`) on every PR even where
  Docker is unavailable — so the honesty contract is proven twice, with and without a
  container.
- **Static invariants extended** (`src/deploy/`): `artifacts.test.ts` and the new
  `ci-workflow.test.ts` pin the Dockerfile/compose/workflow shape — two independent
  targets, the worker `HEALTHCHECK` is the presence-only `--dry-run-status` probe
  while the default `CMD` drains, `.dockerignore` excludes every secret/test/build
  artifact, the smoke covers exit `0/1/2/4` and never the bare loop, both workflows
  build both targets and smoke the worker image, and **no** committed artifact or
  workflow carries a real-looking secret or a `NEXT_PUBLIC_` provider value.
- **Operator runbook** (`docs/RUNBOOK.md`): the durable two-service procedure —
  responsibilities, env by service (placeholders only), build/publish/promote-by-
  digest, the no-secret smoke procedure, and rollback.

⏳ Unchanged and still out-of-band (deliberately not faked): the actual image
**publish/promotion** to a registry (CI validates but never pushes), a provisioned
S3/R2 bucket + Redis/Upstash broker and real secrets, **applying** a lifecycle
policy to a live bucket, **malware scanning**, and the native `deep`/OCR runners.

## Definition of production-ready per tool

A tool is production-ready only when it has:

- Clear processing location label: In-browser, Secure worker, Hybrid, or AI.
- File validation and helpful errors.
- Progress/loading states.
- Deterministic output names.
- Download success path.
- Tests for core transformation logic.
- Accessibility checks for interactive controls.
- Honest limitations documented in UI or docs.
