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
  `both`), and `skipTextPages`; plus `OcrResultMeta` and the pure `buildOcrResultMeta`
  builder that types and constructs the bounded, content-free result metadata a real
  processor returns (populated from the actual run in Phase 25).
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
- ✅ Delivered in **Phase 23**: a real, optional OCRmyPDF/Tesseract processor behind
  the adapter contract with the same storage/queue/deletion guarantees as every other
  worker (see Phase 23 below). English packaging landed in **Phase 24**, result
  metadata was populated in **Phase 25**, and **Phase 26** surfaced that metadata into
  the client-facing job record (`Job.results.ocr`) and the job status API. ⏳ Remaining:
  additional (non-English) language packs.

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
  drift. OCR validates honestly and returns `not_implemented` when no runner is
  wired; as of Phase 23 a real, optional OCRmyPDF/Tesseract runner flips it on when
  enabled and installed on the worker.
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

✅ Phase 21 later hardens the Redis queue's race-sensitive state transitions with
atomic script execution and lease-attempt ownership checks. Remaining for production
(the worker process + worker-side byte I/O are delivered by Phase 16, below): malware
scanning in the scan phase, native `deep`/OCR runners, and lifecycle-enforced bucket
deletion.

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
lifecycle-enforced bucket deletion and real malware scanning, and native `deep`/OCR
runners behind the processor contract. Phase 21 covers the Redis queue atomicity
hardening pass.

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
image, lifecycle-enforced bucket deletion, malware scanning, and the OCR runner. Phase
21 covers the Redis queue atomicity hardening pass; **Phase 24** packages the native +
OCR engines into the worker image and proves them at the image level (presence-only).

### Phase 19 — worker deployment hardening + container smoke foundation (shipped)

The secure-worker stack is now shippable as real infrastructure, with the web app and
worker proven to stay separated.

- **Two-target container build** (`Dockerfile`): a shared build stage feeds two
  independent final images — `web` (Next.js `pnpm start`, no PDF engines) and `worker`
  (`pnpm worker:daemon` with Ghostscript/qpdf/mutool — and, as of **Phase 24**, the OCR
  stack: OCRmyPDF/Tesseract + English language data — no `.next`, no HTTP). Built by
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
  defaults stay safe (a bare env has zero violations). OCR is reported
  **not-implemented**; malware scanning is a presence-only facet that **Phase 22**
  turns into a real, optional scanner (`ready`/`active` once a clamd endpoint is
  configured — see below).

⏳ Still out-of-band (deliberately not faked): real secrets and a provisioned S3/R2
bucket + Redis/Upstash broker, the actual worker deployment and the Docker image build
itself (not exercised here — no Docker daemon in this environment), **applying** a
lifecycle policy to a live bucket (the tooling generates and validates it; the operator
applies it with the provider CLI — the app never calls the cloud), **deploying a clamd
scanner service** (Phase 22 ships the ClamAV scan gate — exercised by tests with a fake
transport — but running the clamd daemon is operator-owned), and the native `deep`/OCR
runners — whose engine binaries **Phase 24** bundles into the worker image and proves
present via CI (still no local Docker build).

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
  the web image. As of **Phase 24** it also runs `pnpm worker:image-smoke` inside the
  built worker image (the native-engine + OCR presence/readiness proof) and asserts the
  worker image ships `gs`/`qpdf`/`mutool`/`tesseract`/`ocrmypdf` while the web image
  ships none. Images build with `push: false` (validated, never published), so the
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

### Phase 21 — Redis queue atomicity + lease correctness (shipped)

The production Redis/Upstash queue no longer relies on unsafe read→write windows for
worker-owned state transitions. Race-sensitive operations now run through a small,
frozen Redis script layer (`src/lib/workers/queue/redis-scripts.ts`) with behavioral
coverage against the fake Redis transport and provider integration tests.

- **Atomic transition scripts**: claim commit, stale-lease redelivery, heartbeat,
  advance, terminal finalize, and requeue are applied by Redis `EVAL` with explicit
  status preconditions. A provider that cannot execute the scripts returns typed
  `unavailable` instead of silently downgrading to unsafe behavior.
- **Lease-attempt ownership**: every claim carries an attempt fingerprint. The
  executor passes that fingerprint into heartbeat/advance/complete/fail/requeue, so
  a worker whose lease expired and was reclaimed cannot resurrect, complete, or fail
  a job after another daemon owns it.
- **Pinned concurrency invariants**: tests cover single-winner claim/redelivery,
  holder-only heartbeat, terminal transition preconditions, requeue/dead-letter
  behavior, idempotent submit safety, and script payload stability — all through
  injected fake transports, never a real broker or secret.

⏳ Still out-of-band: a provisioned Redis/Upstash broker with real credentials,
applying lifecycle policies to object storage, and native OCR/deep engines in
deployed worker infrastructure. (Malware scanning becomes a real, optional gate in
Phase 22, below — running the clamd service stays operator-owned.)

### Phase 22 — malware-scan gate + optional ClamAV backend (shipped)

The secure-worker path now scans a job's inputs **before** any native processing,
behind a provider seam like storage/queue/the processor (`src/lib/workers/scanner/`).
It is **optional by default** — a real capability an operator turns on, never a silent
assumption — and content-free in every log, error, and status line.

- **Optional ClamAV/clamd backend** (`./clamav`): streams each input to a `clamd`
  daemon over the INSTREAM protocol (protocol-safe framing, no shell) and maps the
  reply to a verdict. Node-free — its socket is an injected `ClamavTransport`, so the
  client is unit-tested with a fake and never hits a real daemon or the network; only
  the Node socket transport (`./clamav-transport`) and the runtime resolver (`./node`)
  are Node-only. Enforces a strict per-scan timeout and a client-side max-bytes ceiling.
- **Honest states, presence-only**: `resolveScannerReadiness` reports `disabled`,
  `not-configured`, `ready` (a usable endpoint → `active: true`, inputs are scanned),
  or `unavailable` (selected but misconfigured/unrecognized → cannot connect, still
  inactive). Config is `PDFXYZ_MALWARE_SCANNER=clamav://host[:port]` (or
  `clamav+unix:///path`), with bounded `PDFXYZ_CLAMAV_TIMEOUT_MS` / `PDFXYZ_CLAMAV_MAX_BYTES`.
  Nothing echoes the endpoint host, port, path, or value.
- **Fail-closed verdicts** (executor gate): `infected` → blocked terminally before
  processing (`malware_detected`, no artifact, inputs wiped, a `scan_blocked` security
  log); `invalid` (unscannable — e.g. over the hard size limit) → blocked
  (`scan_invalid`) rather than processed unscanned; `error` (transient — clamd
  unreachable) → retryable `scan_unavailable`, never downgraded to clean; `clean` →
  `scan_clean`, then processing; `skipped` → proceed, honestly unscanned. Required-vs-
  optional is decided at the scanner boundary (required fails/retries, optional
  degrades to `skipped`); an `infected` detection blocks either way. clamd's reply is
  classified so the **signature name is dropped at the protocol layer**.
- **Guardrails**: `PDFXYZ_WORKER_REQUIRE_SCAN` (opt-in, **not** implied by strict — a
  lossless-only worker with no scanner is a legitimate production choice) fails `--check`
  (exit `4`) unless a usable endpoint is configured, and passes once it is; a
  selected-but-invalid or unrecognized scanner value is itself a fail-fast config error.

⏳ Still out-of-band (deliberately not faked): **running the clamd daemon** (deploy it
as a sidecar/service and point `PDFXYZ_MALWARE_SCANNER` at it — no test ever contacts a
real clamd), a provisioned broker/bucket + real secrets, applying lifecycle policies to
a live bucket, and the engine binaries the native `deep`/OCR runners shell out to.

### Phase 23 — OCR backend foundation (shipped)

OCR becomes a **real, optional** secure-worker backend behind the existing `OcrRunner`
seam — never faked, and **off by default**. The web app and the in-process local-dev
worker never run OCR; recognition happens only on the out-of-band daemon.

- **Node-only native runner** (`src/lib/workers/ocr-native.ts`): shells out to
  **OCRmyPDF** (preferred — PDF → searchable PDF + optional text sidecar) or
  **Tesseract** (images) with a **fixed argv array** (no shell, no interpolation), over
  worker-owned temp paths. Hard timeout, input/output byte ceilings, a structural PDF
  check on the searchable-PDF output, an isolated `mkdtemp` dir removed on **every** exit
  path, and single-document processing. Node-free otherwise: the subprocess/`fs`/PATH
  boundaries are injected seams, so every argv, bound, failure, and cleanup branch is
  unit-tested with **no real binary** (mirroring native compression).
- **Node-free config** (`src/lib/workers/ocr-native-config.ts`): `PDFXYZ_OCR` opt-in
  (disabled unless set), optional engine pin, allowlisted absolute binary overrides, and
  bounded timeout/size knobs. A malformed value degrades to fully *disabled* and names
  the offending **variable** only.
- **Honest processor + executor**: the OCR processor validates options, then delegates to
  the runner only when a runner **and** an engine are present; otherwise it fails
  `not_implemented`. A runner throw is caught and mapped to a typed, content-free
  `internal_error` — `process()` never throws, and no artifact is ever fabricated. The
  Phase 22 malware-scan gate runs **before** OCR. Recognized text lives **only** in the
  downloaded artifact — never a log, status field, or job record.
- **Readiness, status & guardrails**: the daemon emits an `ocr_health` line
  (`enabled`/`ready`/`engine`) and an `ocr` deployment facet distinguishing
  disabled / not-configured / unavailable (opted-in, no engine) / ready; the client
  `/api/worker/status` reports OCR presence-only (never available in-browser). Opt-in
  `PDFXYZ_WORKER_REQUIRE_OCR` (**not** implied by strict) fails `--check` (exit `4`)
  unless a ready engine is present, and a malformed `PDFXYZ_OCR*` value is a fail-fast
  `ocr_config_invalid` config error. Full operator guide: [`OCR_BACKEND.md`](./OCR_BACKEND.md).

✅ **Phase 24** (below) closes the packaging/proof gap for the **English baseline**:
the worker image now ships OCRmyPDF/Tesseract + English language data, and CI proves the
image-level engine contract — presence plus a ready readout, presence-only (no user
document is processed). ⏳ Still out-of-band (deliberately not faked): **additional
(non-English) language packs**, real end-to-end **user-document** OCR validation on a
running worker, and populating `OcrResultMeta` (pages/characters/confidence) from real
recognition output.

### Phase 24 — worker-image engine packaging + container proofs (shipped)

The worker image now actually **carries** the native engines the earlier phases wired —
deep compression and the English OCR baseline — and CI proves the image-level engine
contract without a local Docker build, a secret, or any user document. The proof is
**presence-only**: it shows the engines are installed and that the daemon reports them
ready, never that a real document was recognized.

- **One-layer engine install** (`Dockerfile`): the `worker` target installs, in a single
  apt layer, the deep-compression binaries (Ghostscript / qpdf / mupdf-tools) **and** the
  OCR stack (OCRmyPDF, Tesseract, and `tesseract-ocr-eng`). The English pack is listed
  explicitly because `--no-install-recommends` skips it. Tesseract is the guaranteed
  baseline (image → searchable PDF/text); OCRmyPDF is the PDF-first engine. The `web`
  target installs **none** of these.
- **Image smoke** (`scripts/worker-image-smoke.sh`, `pnpm worker:image-smoke`): runs
  **inside** the built worker image with no cloud, secret, or document. It verifies the
  deep-compression binaries (`gs`/`qpdf`/`mutool`) and OCR binaries (`tesseract` +
  `ocrmypdf`) are present, that English langdata is installed (`tesseract --list-langs`
  → `eng`), that native engines present still don't fake drainability (`--dry-run-status`
  exits `2` with nothing wired), and presence-only OCR readiness — opting in
  `PDFXYZ_OCR=on` flips `ocr_health` to `ready:true` and `compression_health` to
  `deep:true`, a content-free readout with no path. It is image-only (deliberately
  **fails** where engines are absent), so it is **not** in the Docker-free PR gate;
  `ci.yml` still runs only `pnpm worker:smoke`.
- **Engine preflight** (`scripts/worker-engines.sh`, `pnpm worker:engines`): a node-free
  `command -v` companion (no daemon, no Node — runs in a bare builder, an initContainer,
  or CI) that gates its exit code on the opt-in require-flags: `0` when every required
  engine family is present (or nothing is required), `3` when a required engine is missing.
  Container CI runs it **inside** the image with `PDFXYZ_WORKER_REQUIRE_OCR` +
  `PDFXYZ_WORKER_REQUIRE_DEEP_ENGINE` armed (must pass — the engines are packaged); the
  negative path (the same flags failing on a bare host) is proven Docker-free in
  `worker-engines.test.ts`.
- **Container CI proves the contract** (`.github/workflows/container.yml`): builds both
  targets, runs `pnpm worker:smoke`, `pnpm worker:image-smoke`, **and** `pnpm
  worker:engines` inside the worker image, and asserts the worker image ships
  `gs`/`qpdf`/`mutool`/`tesseract`/`ocrmypdf` while the web image ships none. No secrets,
  no push. Static tests (`artifacts.test.ts`, `ci-workflow.test.ts`, `worker-engines.test.ts`)
  pin all of it.
- **Still presence-only, still honest**: the smoke proves the engine is **installed** and
  that the daemon reports it **ready** — it does **not** OCR or otherwise process any user
  document. Recognition quality is not proven, and only the **English** pack ships.

⏳ Still out-of-band (deliberately not faked): **additional (non-English) language packs**,
real end-to-end **user-document** OCR validation on a running worker, and everything prior
phases still defer — real secrets and a provisioned bucket/broker, an applied lifecycle
policy, a running clamd service, and the actual worker **deployment** (the image is built
and smoked in CI, never published or run against real traffic here).

### Phase 25 — OCR result metadata + deterministic recognition proof (shipped)

Phase 24 packaged the engines and proved **presence**; the OCR metadata proof closes the
next honest OCR gap in two ways, without faking anything.

- **Populated result metadata** (`src/lib/jobs/ocr.ts`, `src/lib/workers/ocr-native.ts`):
  the native runner now measures a bounded, content-free `OcrResultMeta` from the actual
  run — engine family, validated languages, output mode, which artifact kinds were
  produced, a best-effort output **page count** (pdf-lib, bounded), and a text-sidecar
  **character count** — built by the pure `buildOcrResultMeta` and attached to the
  processor's success result (the same seam compression uses). `meanConfidence` stays
  `null` (the native backend exposes none — never invented); every count is clamped and
  schema-stable; nulls are honest; and **no recognized text, filename, or path** ever
  enters the metadata (asserted in `ocr-native.test.ts` and `jobs/ocr.test.ts`).
- **Deterministic recognition proof** (`scripts/worker-ocr-proof.sh`, `pnpm
  worker:ocr-proof`): a synthetic, non-user-document proof that the packaged **Tesseract
  baseline actually recognizes text**. Ghostscript renders a fixed sentinel to a raster (no
  text layer), Tesseract OCRs it to a searchable PDF + sidecar, and the normalized sidecar
  must contain the sentinel. Presence-only, content-free output; temp dir always cleaned up
  (EXIT trap); no cloud/secret/queue/store/scanner. It runs in the container workflow
  **after** `worker:engines`; its full plumbing (missing-engine exit `2`, enforced-sentinel
  exit `3`, cleanup) is proven Docker-free with stub engines in `worker-ocr-proof.test.ts`.

⏳ Still out-of-band at this phase: production OCR **quality**, **non-English** language
packs, and real **user-document**/traffic validation. (OCRmyPDF's PDF→searchable-PDF path
— named here as unproven — is proven on a synthetic fixture in **Phase 27**, below;
surfacing the populated metadata into the client-facing job record shipped in **Phase 26**,
below.)

### Phase 25 — lifecycle retention enforcement + deletion proof (shipped)

Closes the retention/deletion loop with two independent **proofs** — active deletion and
lifecycle-backstop verification — without ever faking a cloud call. It adds no processor;
it makes the existing delete-now and lifecycle backstop *provable and honest*.

- **Active-deletion proof** (`src/lib/workers/executor/executor.leak.test.ts`): an
  invariant sweep over **every** terminal path the executor can drive a claimed job to —
  completion, no-processor, an expired/missing input, a terminal processing failure, an
  OCR failure, the three malware-scan blocks (infected / unscannable / scan-unavailable),
  and cancellation mid-run — asserting **no input survives a terminal state and no
  artifact survives a failed/canceled one**. Only a successful job keeps its single
  artifact, with a bounded `expiresAt`; the complement is proven too (a retryable requeue
  preserves inputs for the retry).
- **Dry-run lifecycle verifier** (`src/lib/workers/lifecycle/verify.ts`,
  `pnpm worker:daemon --lifecycle-verify`): turns the bare `PDFXYZ_LIFECYCLE_VALIDATED`
  *assertion* into checked *evidence*. The operator exports the bucket's live lifecycle
  config out-of-band (`aws s3api get-bucket-lifecycle-configuration`; the app never reads
  the bucket) and the daemon structurally compares it to the policy it would generate —
  per-rule `satisfied`/`stricter`/`weaker`/`disabled`/`missing`, a `verified`/`drift`
  verdict, and a reconciliation plan. Exit `0` verified · `2` unknown (no `--observed`
  doc) · `4` drift/malformed. Matching is structural (prefix coverage + role field, not
  by id; shortest covering expiration wins, mirroring S3), so operator-named and
  whole-bucket rules verify correctly.
- **Honest states, content-free output**: with no observed document the verifier reports
  `unknown`, never a pass — the app never upgrades absence to success. The report carries
  only the app's own `pdfxyz-*` rule ids, a status/action enum, prose, and a **count** of
  unrelated observed rules; an observed rule's id, prefix, or day count is never echoed
  into the report or logs. New events `lifecycle_verify` / `lifecycle_verify_error`
  ([`OBSERVABILITY.md`](./OBSERVABILITY.md)).
- **Static proof**: committed, content-free example exports ([`docs/examples/lifecycle/`](examples/lifecycle/))
  pinned by `examples.test.ts`; the offline `pnpm worker:smoke` and the CLI exit-code
  contract (`cli.smoke.test.ts`) verify a matching export (`0`), a drifted export (`4`),
  and the no-document case (`2`) against the real daemon.

⏳ Still out-of-band (deliberately not faked): **applying** the lifecycle policy to a live
bucket and **exporting** its config for verification (the operator runs the provider CLI
for both; the app never calls the cloud), plus everything prior phases defer — real
secrets and a provisioned bucket/broker, a running clamd service, and the actual worker
**deployment**.

### Phase 26 — OCR result metadata surfaced to clients (shipped)

Phase 25 populated `OcrResultMeta` at the processor seam but left it there; the executor
dropped it at `queue.complete()`, so it never reached a client. Phase 26 closes that gap
end-to-end — safely, and without faking anything.

- **Job-record schema** (`src/lib/jobs/results.ts`): a namespaced, optional `Job.results`
  container (today only `results.ocr: OcrResultMeta`), present **only** on a completed job
  that produced the described output. A compression job never grows a `results` block; a
  failed/infected/not-enabled OCR job carries none; and the block is dropped alongside the
  artifacts when outputs are deleted (cancel/expire), so metadata never outlives its output.
- **One redaction boundary** (`sanitizeJobResults`): every write path — the async executor
  via both queue providers (`queue/local-dev.ts`, `queue/redis.ts`) and the synchronous
  local-dev adapter — funnels through it. It re-bounds the block through `buildOcrResultMeta`
  and collapses the engine to the closed client-facing family set (`normalizeOcrEngineFamily`
  → `ocrmypdf`/`tesseract`/`unknown`, exact-match so a version or fragment reads `unknown`),
  and drops a block with an out-of-contract `outputMode`. So even a buggy or hostile runner
  cannot land an unsafe value on a client-facing record.
- **API + UI**: `GET /api/jobs/:id` returns the safe metadata verbatim (the route is a
  pass-through of the sanitized `Job`), and the OCR tool panel renders a structural
  "Recognition summary" (pages · output kind · languages · character count) — never
  recognized text, and rows omit when a value is unknown.
- **Tests**: redaction/no-leak bounds (`jobs/results.test.ts`), completion carries metadata
  only on success and none on failure/block (`ocr-backend.test.ts`), the Redis persistence
  round-trip (`queue/redis.test.ts`), compression unaffected (`local-dev.test.ts`), and the
  UI summary's structural-only contract (`ocr-worker-panel.test.tsx`).

⏳ Still artifact-only / out-of-band (deliberately): the **recognized text** itself (it lives
only in the downloaded searchable-PDF/sidecar bytes — the record carries only its structural
description), `meanConfidence` (the native backend exposes none), and production OCR quality.

### Phase 27 — OCRmyPDF searchable-PDF proof + metadata fidelity (shipped)

Phase 25 proved the **Tesseract baseline** turns a raster into recognized text (image→PDF),
but explicitly left OCRmyPDF's **PDF→searchable-PDF** path unproven. Phase 27 closes exactly
that gap on a synthetic, non-user-document fixture — the honest next step — without faking
production quality.

- **Deterministic searchable-PDF proof** (`scripts/worker-ocrmypdf-proof.sh`, `pnpm
  worker:ocrmypdf-proof`): Ghostscript's `pdfimage` device renders a fixed sentinel into an
  **image-only PDF** (each page a raster — no text layer). `pdftotext` confirms the source
  yields **no** selectable sentinel text; the packaged **OCRmyPDF** is invoked by a **fixed
  argv** (the same option shape the native runner uses — `--language eng --output-type pdf
  --sidecar … --quiet in out`, no shell, worker-owned temp paths only) to add a text layer;
  and the **same** `pdftotext` then extracts the sentinel from the **output** PDF — proving
  image-only became genuinely **searchable**. Because the same tool extracts nothing from the
  input and the sentinel from the output, the hit is real OCR, not a structural fluke; the
  OCRmyPDF sidecar corroborates. Presence-only, content-free output (never a temp path,
  filename, or recognized text); temp dir always removed (EXIT trap); no
  cloud/secret/queue/store/scanner. It runs in the container workflow **after**
  `worker:ocr-proof`; its full plumbing — prerequisite-missing exit `2` (Ghostscript,
  OCRmyPDF, **or** `pdftotext`), each enforced check's exit `3`, and cleanup — is proven
  Docker-free with stub `gs`/`ocrmypdf`/`pdftotext` in `worker-ocrmypdf-proof.test.ts`.
- **Proof-only tooling, split-preserving** (`Dockerfile`): `pdftotext` (`poppler-utils`) is
  added to the **worker image only**, purely as proof tooling — it is **not** on the OCR
  runtime path. The `web` image ships none of the engines *or* `pdftotext`; the split is
  pinned by `artifacts.test.ts` and proven at the image level in the container workflow
  (`command -v pdftotext` succeeds in the worker image, fails in the web image).
- **Metadata fidelity** (`src/lib/workers/ocr-native.ts`): the native runner now derives the
  result metadata's produced-kind flags and page/character counts from the artifacts it
  **actually returns** — the searchable-PDF page count is measured from the produced PDF's
  bytes (never the input scan), and the sidecar character count from the produced sidecar —
  so the counts can never drift from the output, and a missing/invalid searchable PDF still
  fabricates nothing (the runner throws, no metadata). Asserted in `ocr-native.test.ts`.

⏳ Still out-of-band (deliberately not faked): production OCR **quality**, **non-English**
language packs, and real **user-document**/traffic validation on a running worker. The proof
establishes the packaged OCRmyPDF *path* works end-to-end on a generated fixture — not that
any real document OCRs well.

### Phase 28 — worker operations snapshot + content-free SLO metrics (shipped)

Phase 28 adds the operator-facing observability seam without weakening the privacy model.
It does **not** claim a daemon is deployed when the web app cannot observe one; it folds
already-safe readiness, guardrail, lifecycle, scanner/OCR/native-engine, and loop signals
into bounded health classes and coarse metrics.

- **Operations snapshot** (`src/lib/workers/observability/snapshot.ts`,
  `/api/worker/operations`): reports `version`, vantage (`web`/`worker`), drainability,
  `daemonObserved`, per-subsystem health, lifecycle-verification state, proof tri-states,
  and one `recommendedAction`. From the web vantage, native engines and out-of-band daemon
  liveness stay `unknown`; only the worker/daemon vantage can observe them.
- **Metrics/SLO seam** (`metrics.ts`, `collector.ts`, `slo.ts`): bounded metric names and
  enum labels only. Latency/depth/age are coarse buckets; Prometheus text output contains
  no filenames, object keys, URLs, bucket names, env values, scanner signatures, paths,
  or OCR text. SLO helpers return `unknown` for missing data rather than green defaults.
- **Daemon readout**: `worker:daemon --dry-run-status`, `--check`, and real run modes now
  emit `operations`, `metrics`, and `slo` JSON lines in addition to the existing
  readiness/guardrail lines. The lines are content-free and safe to scrape.
- **API surface**: `/api/worker/operations` is the operator snapshot counterpart to
  `/api/worker/status`; it is dynamic, node-runtime, and web-vantage honest. It does not
  return provider values or imply a separate worker is alive.

⏳ Still out-of-band (deliberately not faked): a real metrics backend (a timeseries store +
alerting pipeline), alerts wired to a pager, cross-process daemon heartbeats visible to the
web app, real production traffic SLO windows, and Docker/image execution on this host.

### Phase 29 — status operations dashboard for secure-worker health (shipped)

Phase 29 makes the Phase 28 operations snapshot legible to a human operator: the `/status`
page now renders `/api/worker/operations` as a premium **operator dashboard** beneath the
existing user-facing capability summary. No new backend and no new data — it is a safe
projection of the same content-free snapshot.

- **Dashboard UI** (`src/components/status/operations-dashboard.tsx` — the live-fetching
  shell; `operations-ui.tsx` — the RSC-safe presentational body): an overall health card
  (`ok`/`warn`/`blocked`/`unknown`), the single `recommendedAction` callout, a per-subsystem
  grid, lifecycle-verification + engine/OCR proof cards, a worker-vantage-only last-loop
  card, and an always-present daemon-observability caveat. Loading/error/retry are graceful;
  a fetch failure never dead-ends and is worded so it never reads as "the worker is down".
- **Safe client parsing** (`normalizeSnapshot`, the single choke point): narrows the
  response to bounded enums, booleans, and clamped integers, then maps them to
  **client-authored** copy. Unknown enum values degrade to a safe fallback and unknown
  subsystem ids are dropped, so an injected endpoint, object key, filename, signed URL,
  recognized text, port, path, or secret in any server field has nowhere to surface. Reading
  the snapshot emits a privacy-safe `worker_operations_checked` event (bounded enums only).
- **Honest boundaries**: from the web vantage `daemonObserved` stays `false` and the
  engine/OCR proofs stay `unknown`; the dashboard says so in plain language and points
  operators at the daemon's own logs / process supervisor. The dashboard shows health
  *posture*, not timeseries — live SLO **rates** (success %, p95 latency, dead-letter rate
  over a traffic window) still require the out-of-band metrics backend above.

⏳ Still out-of-band (unchanged): the metrics-backend timeseries and pager wiring; Phase 29
adds only the human-readable projection of the already-shipped snapshot.

### Phase 30 — optional worker heartbeat/liveness observation (shipped)

Phase 30 closes the last web-vantage liveness gap without faking a daemon. When an
operator explicitly enables `PDFXYZ_WORKER_HEARTBEAT` **and** the Redis/Upstash job-queue
broker is configured, the out-of-band worker daemon publishes one bounded heartbeat record
under the queue prefix. The web app reads that record through the same node-free broker
transport and sets `daemonObserved:true` only while the beat is fresh.

- **Provider seam** (`src/lib/workers/heartbeat/`): Redis-backed publisher/reader, disabled
  no-op default, bounded interval parsing, TTL/freshness windows, and defensive schema
  parsing. A missing backend or disabled flag performs no network call and returns the
  honest disabled state.
- **Content-free record**: fixed schema version, role enum, coarse mode enum, four boolean
  capabilities, optional coarse `major.minor` release, and a publish timestamp used only to
  derive a coarse age bucket. No host, PID, container id, endpoint, key, filename, path,
  OCR text, scanner signature, job id, or secret can be stored or surfaced.
- **Operations snapshot integration**: `daemon.state` is `observed` / `stale` / `unknown` /
  `disabled`; `daemonObserved` is true only for `observed`. Stale/unknown liveness yields
  `investigate-worker-liveness`; disabled keeps the previous “confirm out-of-band” posture.
- **Daemon integration**: real run modes publish at a bounded cadence and swallow heartbeat
  backend failures so liveness outages cannot corrupt jobs or crash processing.

⏳ Still out-of-band (deliberately not faked): provisioning the Redis broker, deploying the
worker, connecting a real process supervisor/alerts, and proving job success from a beat. A
heartbeat proves only that a daemon recently wrote the content-free liveness record.

### Phase 31 — operator healthcheck + alert evaluation (shipped)

Phase 31 turns the content-free operations evidence (snapshot + SLO metrics + heartbeat)
into a **decision a monitor keys on**, with no metrics backend and no pager. A pure alert
policy plus a CLI over it (`pnpm worker:ops-check`) evaluate the same evidence the daemon
already reports and exit with a documented code — the piece a cron job / uptime monitor /
process supervisor / CI gate runs.

- **Alert policy** (`src/lib/workers/observability/alerts.ts`): `evaluateOperationsAlerts`
  maps a `WorkerOperationsSnapshot` (+ optional `SloReport`) onto bounded severities
  (`ok`/`warn`/`critical`/`unknown`), reasons, and actions — all fixed enums with fixed,
  content-free copy authored in code. A stale/absent heartbeat is actionable only when
  observation is enabled; `unknown` never over-pages.
- **CLI** (`src/lib/workers/ops-check/`, `scripts/worker-ops-check.ts`): sources
  `--runtime` / `--web` / `--stdin` / `--file`; formats `--json` / `--prometheus` /
  `--text`; a paranoid ingest path that re-authors a monitor-supplied snapshot so no
  injected filename/key/secret survives. Exit codes `0` ok / `1` usage / `2` unknown /
  `3` warn / `4` critical (distinct from the daemon's).
- **Route + `/status` integration**: the same content-free alert report is attached to
  `GET /api/worker/operations` and rendered as an **Alert posture** callout, mapped from
  bounded enums to client-authored copy.
- **Examples**: runnable, content-free fixtures for each verdict under
  `docs/examples/observability/healthcheck/`, pinned by `ops-check/examples.test.ts`.

⏳ Still out-of-band (deliberately not faked): a hosted timeseries/metrics backend, the
scheduler that runs the check, and the notifier/pager that reacts to its exit code.
ops-check is local evaluation — it stores no history and pages no one.

### Phase 32 — deployment blueprints + ops-check scheduler templates (shipped)

Phase 32 packages the worker/observability stack into validated, provider-neutral
deployment templates under [`docs/examples/deployment`](examples/deployment): Docker
Compose, systemd worker + ops-check timer units, Kubernetes web/worker/CronJob manifests,
and a GitHub Actions fixture gate for `worker:ops-check`. A dependency-free validator
(`pnpm deploy:examples:check`) plus static tests assert that examples are placeholder-only,
content-free, do not expose worker secrets to the web tier, and do not mask healthcheck
failures.

⏳ Still out-of-band: real Docker/Kubernetes execution in this environment, cloud
provisioning, real secrets, DNS/TLS, broker/storage credentials, scanner signature
operations, and any hosted pager/timeseries backend. The examples show where those pieces
plug in; they do not provision or fake them.

### Phase 33 — public-API abuse guard + rate limiting (shipped)

Phase 33 adds an honest, provider-neutral **abuse guard** (`src/lib/ratelimit`) in front
of every public API route: typed per-action policies (`uploads.create`, `jobs.create`,
`jobs.status`, `jobs.delete`, `artifacts.fetch`, `worker.status`, `worker.operations`),
a privacy-safe salted-hash client key that never retains a raw address, and a
**content-free** decision. On deny it returns `429 rate_limited` with `Retry-After` +
`RateLimit-*` headers whose values derive only from the policy and clock. It is **off by
default and fails open** (`PDFXYZ_RATE_LIMIT_PROVIDER` unset ⇒ every request allowed,
`enforced: false`), so the default build, e2e, and local-first tools are byte-for-byte
unchanged. `local-memory` enables a real but per-process limiter; a **registration seam**
(`registerRateLimitProvider`, wired from a Next.js `instrumentation.ts` boot hook) lets a
deployment plug a Redis/edge-backed distributed provider (`provider: "remote"`) without
touching a route. Offline tests (fakes only) pin the limiter math, policies, route
allow/429 paths, the provider seam, and the no-leak contract under hostile
headers/paths/bodies.

✅ Phase 34 below closes the distributed-provider gap. `local-memory` remains a
single-instance backstop, not a global budget; the edge/WAF/CDN rate-limit rule remains
the first operator-owned control for high-traffic launches.

### Phase 34 — distributed Redis-compatible rate-limit provider (shipped)

Phase 34 implements the Phase 33 provider seam with a real optional Redis/Upstash-REST
backend, while preserving the same content-free response contract and no-config honesty.

- **Distributed provider** (`src/lib/ratelimit/redis.ts`): an atomic fixed-window `EVAL`
  script performs `INCR` + first-hit `PEXPIRE` + `PTTL` in one operation, avoiding
  race-prone get-then-set increments. Keys are bounded by TTL and include only the
  application prefix, a fixed `rl` namespace, policy id, window id, and the salted opaque
  client bucket token — never raw IPs, headers, filenames, URLs, object keys, env values,
  user payloads, or secrets.
- **Web-safe configuration** (`src/lib/ratelimit/redis-config.ts`, `src/instrumentation.ts`):
  `PDFXYZ_RATE_LIMIT_PROVIDER=redis|upstash|remote` plus
  `PDFXYZ_RATE_LIMIT_REDIS_REST_URL` / `PDFXYZ_RATE_LIMIT_REDIS_REST_TOKEN` auto-registers
  the provider at boot. These names are deliberately distinct from the worker queue's
  `PDFXYZ_REDIS_REST_*` credentials, so the public web pod does not need worker-only
  queue/heartbeat secrets. Missing config resolves to `remote-unimplemented` and skips
  honestly; default builds still do no network work.
- **Failure semantics**: provider errors degrade by `PDFXYZ_RATE_LIMIT_FAIL_MODE` — `open`
  (default) allows with `enforced:false`; `closed` returns the same bounded `429` contract.
  Route responses and telemetry expose only provider/status enums, decisions, policy ids,
  and retry buckets.
- **Tests**: fake Redis clients pin the exact script shape, TTL/window reset behavior,
  concurrent increment semantics, fail-open/fail-closed paths, instrumentation registration,
  route-level distributed `429`, and the no-leak contract. No test requires a real Redis,
  S3, ClamAV, OCR engine, Docker daemon, or external service.

⏳ Still out-of-band: production tuning, traffic-specific budgets, and the upstream
edge/WAF/CDN policy. The Redis provider is application-layer distributed enforcement; it
is not a substitute for perimeter abuse controls.

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

## Phase 35 — upload intake guardrails

Status: shipped. The secure-worker upload boundary now rejects obvious bad intake before storage/queue work while preserving browser-local tools and no-config honesty. The layer is intentionally not a PDF parser, malware scanner, or content sanitizer; deeper validation remains on the worker roadmap and must run under worker resource limits. Future production phases can add richer per-tool intake policies and worker-side file soundness scoring without changing the stable content-free error envelope introduced here.

## Phase 36 — worker file-soundness quarantine

Status: shipped. The worker now performs a bounded soundness/quarantine preflight before scanner and processor stages. This closes the gap between Phase 35 declaration-time intake and actual retrieved bytes, while keeping claims honest: soundness is not scanning, sanitization, repair, or deep validation. Future phases can add richer worker-side PDF soundness scoring and sandboxed parsers, but those must remain separately reported from this shallow preflight.

## Phase 37 — artifact manifest and provenance validation

Status: shipped. The worker now validates every processor output through a bounded artifact-manifest gate after the transform succeeds and before any bytes are persisted or a download is minted, so a processor can no longer publish an empty, oversized, unknown-kind, mistyped, unproducible, or retention-less output. Each published output has a typed, content-free manifest recording its provenance (kind, content-type, byte count, retention class, tool slug, processor family) with no filename, key, URL, id, or document content. This closes the gap between "a processor returned bytes" and "a client can download an artifact", while keeping claims honest: a manifest/provenance pass is structural metadata validation, not malware scanning, sanitization, OCR-correctness, or a lifecycle-deletion guarantee. Future phases can add richer output validation (e.g. verifying a produced PDF re-parses, or that an archive's members are well-formed) but those must remain separately reported from this shallow provenance check.

## Phase 38 — artifact retrieval/download access guardrails

Status: shipped. Phase 37 validated outputs at *publication*; Phase 38 hardens the *retrieval* boundary. Every published output now records its content-free provenance manifest alongside its bytes (threaded through both the synchronous local-dev adapter and the async executor's `writeArtifact` seam), and the client-facing download route (`GET /api/artifacts/local/:artifactId`, local-dev only) delegates to a pure retrieval-access layer (`src/lib/workers/artifacts/access.ts`) before streaming a byte. It validates the opaque handle shape, reports the artifact's lifecycle (live/expired/deleted/absent — a bounded delete tombstone tells an explicit delete from an unknown handle), confirms the owning job completed, and re-validates the recorded manifest against the actual stored bytes; a pass streams with safe, **generated** headers (canonical `Content-Type`, an `attachment` `Content-Disposition` named from the output kind/tool rather than any stored/user filename, `Content-Length`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`), and a failure returns one of a closed set of content-free reasons (`malformed_handle`, `storage_unavailable`, `policy_unavailable`, `not_found`, `deleted`, `not_ready`, `expired`, `job_mismatch`, `missing_manifest`, `invalid_manifest`, `unsupported_kind`, `empty_artifact`) mapped to a safe status (provably-gone `expired`/`deleted` → `410`, fail-closed infra → `503`) with no bytes. A content-free `worker_artifact_retrieval_total{outcome,reason,kind}` metric and a per-attempt retrieval receipt (both through injectable sinks that default to no-op/none) make the decisions observable and auditable. Claims stay honest: retrieval eligibility is a bounded structural + lifecycle check, **not authentication, not authorization**, malware scanning, sanitization, provenance beyond the recorded manifest, or a deletion guarantee — possession of the unguessable opaque handle is the capability, and the optional `?job=` binding is a caller-opted integrity cross-check (`job_mismatch`/`403`), never access control; an output published with the manifest gate disabled still downloads via intrinsic checks and is never reported as provenance-validated. The local-dev route stays inert (`503`) outside local-dev; the production counterpart is Phase 39's storage-backed route.

## Phase 39 — storage-backed artifact retrieval seam

Status: shipped. Phase 38 guarded the *local-dev* download against an in-process store; Phase 39 generalizes the *source* so a configured object bucket gets byte-identical access checks, headers, and denials. A tiny internal seam (`src/lib/workers/artifacts/retrieval.ts`) defines an `ArtifactRetrievalBackend` (`capability()` + `fetch(id) → ArtifactRetrievalResult`) and a pure `decideRetrieval` that maps a backend's lifecycle-tagged result onto the same Phase 38 `decideArtifactAccess` policy. Two backends implement it: the developer store (`retrieval-local.ts`, unchanged behavior) and a storage-backed reader (`retrieval-storage.ts`) that signs a short-lived GET, reads the artifact's bytes **server-side** through the shared key derivation + SigV4 signer, and recovers the content-free provenance manifest from signed object metadata (`x-amz-meta-artifact-manifest`, `storage/s3-manifest-metadata.ts`) — no side table. Both funnel through one shared route helper (`src/app/api/artifacts/_lib/serve.ts`); the new production route `GET /api/artifacts/:artifactId` streams the bucket bytes through THIS app server, so **no signed object-store URL is ever exposed to the client** and nothing about the bucket, key, endpoint, region, or signature leaves the server (the proxy/stream posture, not a redirect). The worker's `writeArtifact` now embeds that opaque route as each `JobArtifact.url` (never a signed link) and stamps the manifest as signed metadata on the PUT. The retrieval taxonomy gains one reason: a transient bucket failure (5xx/network) is a retryable `storage_error` → `503 service_unavailable`, deliberately distinct from a not-configured backend's `storage_unavailable` (also `503`, but "no backend at all") — a genuine `404` stays an honest `not_found` (a bucket does not tombstone, so expired/deleted/never-existed are indistinguishable there), and a transient failure is never downgraded to a false not-found. The content-free retrieval metric + receipt gain a bounded `provider` label (`local-dev` / `remote-configured` / `not-configured`) so observability can split local-dev from storage-backed retrieval, still with no handle, key, bucket, or URL. Honest no-config is preserved: when storage is absent or half-configured the backend is not `ready`, so the access layer denies `storage_unavailable` (`503`) before any read, and no fake stream is ever produced. Everything is fake-tested — a scripted object transport + the env-resolved/override backend seam — so no test touches real S3. Out of band and explicitly **not** claimed: a CDN or private-bucket access policy, bucket-side auth, and any remote job/metadata store beyond the object read itself; those remain operator-owned, and this build ships the seam + the S3 read path, not a running remote worker.

## Phase 40 — artifact download delivery hardening

Status: shipped. Phase 39 made storage-backed artifacts *retrievable*; Phase 40 makes the *delivery* of the bytes robust and explicit. Where the access layer answers "may this handle be served, and with what headers", a distinct second pure gate (`src/lib/workers/artifacts/delivery.ts`, `decideDelivery`) answers "are those bytes safe to deliver as those headers claim" — applied identically on both routes through the one shared serve helper, and unit-tested in isolation like the access policy it wraps. The hardening: **(1)** the emitted `Content-Length` is re-asserted from the actual bytes and cross-checked against both the access decision's length and any upstream-provider-declared length (a bucket's `Content-Length` response header, parsed by `retrieval-storage.ts` into a bounded byte count and threaded as `reportedLength`); a truncated/over-declared/desynced object is refused (`size_mismatch`), never streamed under a header that lies about its size. **(2)** A hard, fixed **1 GiB delivery ceiling** fails an artifact larger than any real output closed (`oversize`) rather than buffering and streaming it through the app server — a defensive backstop for the opt-in, off-by-default publish-time `PDFXYZ_WORKER_ARTIFACT_MAX_BYTES` cap. **(3)** Deterministic `GET`/`HEAD`: `HEAD` returns byte-identical headers (including the verified `Content-Length`) with no body; the routes wire only `GET`/`HEAD`, and every other verb gets a content-free `405` (no body) from the framework (which also auto-answers `OPTIONS` `204` + `Allow: GET, HEAD, OPTIONS`). **(4)** An honest `Range` posture — this boundary proxies whole buffered objects and does not implement partial/resumable delivery, so it advertises `Accept-Ranges: none` and *ignores* a `Range` header (whole-file `200`), never a fabricated `206`/`416` or any resumable claim. Every delivery denial folds to one content-free `503 service_unavailable`, and the whole serve path is wrapped so any unexpected error (a backend that threw, a body that could not be built) becomes that safe `503` (`stream_error`) rather than a framework `500` with a stack — never a provider message, object key, URL, path, or byte; because the object is fully buffered before the `200` is constructed, a read failure is always a pre-stream content-free denial, never a truncated body under a `200`. A parallel content-free `worker_artifact_delivery_total{outcome,reason,kind,provider}` metric + a per-attempt delivery receipt (which adds the bounded `method`/`range`) observe the second gate through the same injectable, default-off sinks. Everything is fake-tested (scripted transport, backend override, spy sinks); local-dev, storage-backed, and no-config behavior are unchanged, and the default no-config e2e is untouched. Honest scope: a delivery pass is a byte-consistency + method/range safety check only — **not** authentication, authorization, resumable range serving, content scanning, or zero-copy streaming; none of those is claimed.

## Phase 41 — storage-backed artifact lifecycle/expiry enforcement

Status: shipped. Phase 39/40 made storage-backed artifacts retrievable and their byte delivery robust, but left one honest gap: an object store does **not** tombstone, so a bucket answers a GET with `200` for an artifact whose app retention window has already passed, right up until the bucket's own lifecycle rule physically reaps it — a best-effort, coarse, often-daily sweep. The local-dev store already closes this with an in-process expiry stamp (it distinguishes `live`/`expired`/`deleted`/`absent`); Phase 41 is the storage-backed counterpart, making lifecycle **first-class** for object storage. The worker now signs the artifact's retention window as content-free object metadata (`x-amz-meta-artifact-lifecycle`, `storage/s3-lifecycle-metadata.ts`) on the artifact PUT — the SAME `expiresAt` instant the client already holds, encoded as a bounded epoch-ms integer plus an optional deletion-tombstone marker (the boundary honors a tombstone but the shipped active-deletion flow is a bucket `DELETE` → `404`, so it is parsed/enforced, never fabricated). The codec is content-free by construction (a coarse instant + a presence flag — never a filename, key, URL, bucket, id, or byte) and its decoder is strict and total (a malformed/oversized/tampered value collapses to "no evidence"). On the download GET the storage reader (`retrieval-storage.ts`) decodes that evidence and a pure evaluator (`artifacts/lifecycle.ts`, `evaluateArtifactLifecycle` → `live`/`expired`/`deleted`/`unknown`, precedence tombstone > expiry > live) evaluates it against the reader's clock **before the response body is read** — so a logically-expired or tombstoned object is denied `410 Gone`, mapping through the existing Phase 38 `expired`/`deleted` retrieval lifecycle, and its bytes are never even buffered. This is **app-level retrieval-time enforcement**, deliberately distinct from — and additional to — both the bucket lifecycle-deletion backstop and any active delete-now the executor performs. The honesty rules are load-bearing: a present object with **no** usable evidence (a legacy object predating this phase, or storage that strips user-metadata) is `unknown` → served exactly as before (the manifest/intrinsic checks and the shipped `requireManifest:false` policy still govern it), never over-claimed as deleted/expired, with the bucket lifecycle rule as the eventual backstop (surfacing later as an honest `404`/`not_found`); an unreadable clock never fabricates `expired`; and because the metadata is signed a client cannot alter it. A new content-free `worker_artifact_expiry_total{state,provider}` metric + a per-read **drift receipt** (`artifacts/expiry-metrics.ts` → `expiry-receipt.ts`, same injectable default-off sinks) make the "bucket still serving a gone object" drift signal (`state=expired`/`deleted`) and the "no lifecycle metadata" coverage signal (`state=unknown`) observable — two bounded labels only, never an object detail. Everything is fake-tested (scripted transport, synthetic signed metadata, spy sinks); no test touches real S3. Out of band and explicitly **not** claimed: proof the bytes were deleted (once an object is gone, expired/deleted/never-existed collapse to an indistinguishable `not_found` — the honest object-store semantic), verification of the bucket lifecycle policy's correctness (the app never inspects the bucket — that stays operator-declared via the lifecycle readiness seam / `worker_lifecycle_verification_total`), legal-hold/retention compliance, audit-log export, private-bucket access policy, and CDN cache purge.

## Phase 42 — storage-artifact cleanup verification

Status: shipped. Phase 41 *denies* an expired or tombstoned artifact at retrieval — `410 Gone`, before a byte is served — but an app-level denial is not the same claim as "object storage deleted the bytes". The object can sit in the bucket answering a raw GET `200` until either the executor's active delete-now removes it or the bucket's coarse lifecycle rule reaps it. Phase 42 adds the honest-evidence rung above that denial: a pure, offline **cleanup verifier** (`src/lib/workers/cleanup/`) and its operator CLI `pnpm worker:cleanup-check` that prove, from CONTENT-FREE evidence, *whether an artifact that should be gone is actually absent* — and by which mechanism — versus only retrieval-denied. It is the effect-verification complement to two existing seams: `--lifecycle-verify` checks that the bucket lifecycle **rules** are configured (`worker_lifecycle_verification_total`); the executor's `executor.leak.test` proves **active deletion** happens on terminal paths; and this proves those actually **resulted in absence**. Like the lifecycle-config verifier, the app **never calls the cloud** (that would need a provider API call this build deliberately does not make): the operator exports content-free cleanup evidence out-of-band with their own credentials — a per-object `{ presence: present|absent|error, expiresAtMs?, deleted?, activeDelete? }`, the SAME coarse retention facts the app already stamps on the object, never a key, bucket, URL, or byte — and pipes it in. The verifier re-evaluates each object through the SAME Phase 41 `evaluateArtifactLifecycle` (so "is it expired/tombstoned?" is answered exactly as the retrieval boundary answers it) and fuses that with the observed presence to resolve one bounded per-object state: `absent-active` (a `404` a delete-now receipt attributes to active app deletion), `absent-backstop` (a `404` with no receipt — the lifecycle reap, or an indistinguishable never-existed handle), `retrieval-denied` (present-but-denied, within a reap grace — denial working, byte cleanup pending), `drift` (present past its retention window + grace — the backstop has not reaped it), `live` (present within its window — not a cleanup target), `unknown` (present but no lifecycle evidence), or `unavailable` (the probe failed). These fold to one verdict — `verified` (every should-be-gone object confirmed absent, and at least one is), `drift`, `unknown`, `unavailable`, or `not-configured` — with the ops exit ladder (`0` verified / `1` usage / `2` unknown·unavailable·not-configured / `3` drift, a warning a monitor gates on). The honesty invariants mirror the rest of the worker layer and are load-bearing: **absence is the only proof of cleanup** — a present-but-denied object is reported as *pending*, never fabricated into a deletion, so only a confirmed `404` yields `verified`; an unreadable clock, a placeholder deadline, or a tombstone with no expiry falls toward `retrieval-denied`, never a fabricated `drift`; a `not-configured` deployment short-circuits to `not-configured` without inspecting evidence (never upgraded to a success); and the tool **reads no bytes and NEVER deletes** (removal stays operator-owned and out of band). The ingest parser is a paranoid trust boundary: it reads ONLY the four bounded fields and drops every other field, so a hostile `objectKey`/`bucket`/`signedUrl`/`providerMessage`/OCR string riding along in the document can never reach the verdict, a receipt, a metric, or a log — a privacy test drives the full pipeline with exactly such a document and asserts nothing survives, and a redaction-stability test proves every `verdict`×`provider` metric label passes the shared redactor unchanged so `sanitizeMetric` never silently drops a sample. A content-free `worker_cleanup_verification_total{verdict,provider}` metric + a per-run receipt (`cleanup/metrics.ts` → `receipt.ts`, same injectable default-off sinks) make the verdict observable. Everything is fake-tested — injected evidence + injected clock/provider seams, spy sinks, a spawned-CLI smoke, and a regression guard that re-asserts the Phase 41 "deny before byte reads" invariant the verifier premises on — so no test touches real S3. Out of band and explicitly **not** claimed: the verifier is not itself a deletion (it verifies, it does not act), not a live bucket scan (it evaluates the operator's exported evidence), not a claim about the bucket lifecycle policy's correctness, and not legal-hold/audit-export/CDN-purge compliance — all still operator-owned.

Phase 42 pairs that verifier with a second, complementary lens — a pure, offline **dry-run sweeper** (`src/lib/workers/artifacts/cleanup/`, CLI `pnpm worker:artifact-cleanup`). Where the verifier evaluates a probe set of should-be-gone objects and answers "is it *absent*?", the sweeper evaluates an offline **inventory** of PRESENT object metadata (a projection of `aws s3api list-objects-v2` + `head-object`) and answers "what present objects should be *swept*?". Each record — bounded lifecycle/manifest/provider/kind enums plus the decoded `{expiresAtMs,deleted}` retention evidence and coarse age/size buckets — is classified into ONE bounded category by a deterministic precedence: `invalid-record` and `deleted-but-present` (breach) → `expired-but-present` (drift) → `storage-unavailable`, `missing-lifecycle`, `missing-manifest`, `unsupported-kind` (unknown, "not enough evidence") → `ok`. Lifecycle is re-derived through the SAME Phase 41 `evaluateArtifactLifecycle`, and — mirroring the verifier's honesty — a severity is escalated ONLY on positive evidence (a tombstone or a passed deadline); absent/incomplete evidence stays `unknown`, never a fabricated cleanup recommendation, so a confident `ok` verdict requires complete, healthy metadata. The set folds to a verdict (`ok`/`unknown`/`drift`/`breach`) and an optional content-free dry-run **plan** (a count + action per category: `retain`/`investigate`/`review`/`delete`), with the exit ladder the parent phase spec pins — `0` clean / `1` usage / `2` unknown / `3` cleanup-recommended / `4` invalid·breached. A content-free `worker_artifact_cleanup_total{category,severity}` metric (`deriveArtifactCleanupMetrics`, one per-category counter per non-empty category) + a per-run receipt make the sweep observable. It is a node-free, CLOCK-injected leaf; it lists no real bucket, reads no bytes, and NEVER deletes. Everything is fake-tested — a defensively-parsed synthetic inventory, a fixed-clock evaluator, a spawned-CLI smoke over committed content-free fixtures (`docs/examples/artifacts/cleanup/`), and a no-leak test that drives the full pipeline with hostile object keys/URLs/OCR strings and asserts nothing survives. Reading no bytes, the sweeper inherently upholds the Phase 41 "decide from metadata before any byte access" invariant.

## Phase 43 — storage-artifact cleanup evidence exporter / projector

Status: shipped. Phase 42 gave operators two offline verifiers, but both consume **content-free** documents an operator still had to build by hand from a raw provider capture — a dangerous manual redaction step (one pasted object key, bucket, or signed URL and the "content-free" input is anything but). Phase 43 closes that input-side gap with a pure, offline **cleanup evidence exporter / projector** (`src/lib/workers/cleanup/project/`, CLI `pnpm worker:cleanup-project`) that automates the redaction.

## Phase 44 — storage-artifact cleanup evidence operations integration

Status: shipped. Phases 42–43 gave operators three offline tools (verifier, sweeper, projector); Phase 44 makes the cleanup evidence workflow easier and safer to *operate*, in two complementary halves that add no new cloud call, credential, or deletion — deletion stays operator-owned and out of band throughout.

The active half is a one-command **pipeline** (`src/lib/workers/cleanup/pipeline/`, CLI `pnpm worker:cleanup-pipeline`). Wiring the three tools by hand (`project --target=evidence | cleanup-check`, `project --target=inventory | artifact-cleanup`) is fiddly and easy to get fail-open — the Phase 43 scheduler notifier re-projected the export three times and, because POSIX `sh` gives no `pipefail`, could let a projector `usage` fold to a silent `0`. The pipeline reads the raw export **once**, projects it away into both bounded shapes, runs the absence verifier and the dry-run sweeper **in-process**, and rolls the two arms' documented exit codes into ONE composite code by a **worst-wins** rule: `0` ok / `1` usage / `2` unknown / `3` drift / `4` breach — the exact union of the sub-tools' ladders. It is a node-free orchestrator over three injected stage seams (a projector, an absence verifier, a dry-run sweeper), so every branch — each arm, the short-circuit when a projection fails, the rollup, the receipt/metric emission, both output formats — is unit-tested without a spawn, a filesystem, or a cloud. Honesty is load-bearing and deliberately stricter than the notifier it supersedes: it **fails closed** (a bad flag, or an unreadable/malformed export, is a NON-ZERO `usage` result, never a silent clean pass), a failed projection SHORT-CIRCUITS its arm to the projection's own verdict (`insufficient`/`unsafe`) rather than feeding untrusted evidence to a lens, an off-ladder downstream code folds to the `usage` band (never `0`), and — because it only ever forwards the projector's already-content-free output to a lens and never the raw export — no object key, bucket, URL, endpoint, region, id, or filename can survive into the rolled-up document, its embedded receipt, a metric, or a log. A content-free `worker_cleanup_pipeline_total{arm,severity}` metric + a per-run rolled-up receipt (default-off sinks) make the composite observable, and the projector/verifier arms still emit their own `worker_cleanup_projection_total`/`worker_cleanup_verification_total` as they run, so a dashboard sees both the composite severity and the per-stage detail. It `--apply`/`--delete`-rejects like the tools it composes, and ships with deployment templates — a simplified `cleanup-pipeline-notify.sh` wrapper (one command, map the single exit code to a severity, re-raise) and a GitHub Actions fixture that pins each composite exit code over the committed content-free fixtures.

The passive half is a cleanup evidence **posture monitor** (`src/lib/workers/cleanup-evidence/`) that closes the ops loop the other direction: instead of running the tools, it reads the content-free report SUMMARIES a scheduled cleanup-check / artifact-cleanup job already wrote (configured out-of-band via `PDFXYZ_CLEANUP_EVIDENCE_CHECK_REPORT` / `_SWEEP_REPORT`), applies a freshness threshold (default 26h, tolerating a daily cadence plus jitter), and folds them into a single bounded ops **posture** — `disabled` (no report configured, the honest default), `healthy` (a fresh report proves `verified` / a clean sweep), `stale` (present but past the freshness window, or missing), `warning` (fresh `drift`), `critical` (fresh `breach`), `unknown` (fresh but inconclusive), `not-configured` (fresh, but the report declares no object storage), or `invalid` (unreadable/malformed, or a raw export pointed at by mistake) — each with a bounded reason and authored content-free detail, for the `/status` surface and `worker:ops-check`. It is a strict trust boundary: it accepts ONLY the recognized `pdfxyz.cleanup-check/1` / `pdfxyz.artifact-cleanup/1` summaries and REFUSES a raw evidence/inventory/provider export (a misconfiguration and a privacy risk → `invalid`), never fabricates a healthy freshness claim from missing/stale/timestamp-less evidence (→ `stale`, never a false OK), and uses the operator's configured report paths ONLY to open the files — they are never surfaced into the posture, output, logs, or errors. Its core is node-free and content-free (the one host-dependent seam, actually reading the files, lives in `./read` behind `node:fs`, so a route or dashboard can import the node-free surface without pulling the filesystem); a content-free `worker_cleanup_evidence_posture{state,reason,provider}` gauge makes the posture observable, disabled until a report path is set.

Both halves are fake-tested — injected stages/env/clock seams, spy sinks, spawned-CLI smokes over committed content-free fixtures, and hostile-input no-leak tests that drive object keys / buckets / signed URLs / OCR strings / secrets through the full path and assert nothing survives. Neither half calls the cloud, reads a byte, needs a credential, or deletes anything; they are explicitly **not** deletion, authentication/authorization, malware or cloud scanning, byte-integrity, or a bucket-lifecycle-correctness claim — only, respectively, a fail-closed composition and a content-free posture read over evidence the operator already produced. The Phase 41/42/43 tools, browser-local tools, local-dev and storage-backed downloads, and the no-config posture are all unchanged. It takes an operator's own out-of-band RAW export — an `aws s3api list-objects-v2` / `head-object` capture (native `Contents`/`ContentType`/`ContentLength`/`LastModified`/`Metadata` field names, `--source=aws-s3`) or an already-normalized dump (`--source=generic`) — and projects it into a bounded, content-free `--target=evidence` document (the `{presence,expiresAtMs?,deleted?,activeDelete?}` shape `worker:cleanup-check` reads) or `--target=inventory` document (the bounded lifecycle/manifest/provider/kind + coarse age/size shape `worker:artifact-cleanup` reads), keyed exactly as the downstream parser expects so it pipes straight in — `pnpm worker:cleanup-project --target=inventory --file=raw.json | pnpm worker:artifact-cleanup --stdin`. The transform is the whole point and it is a **privacy seam**: a raw export is dense with locators and identifiers the rest of the worker layer must never see — object keys, bucket names, signed URLs, endpoints, regions, account ids, ETags, filenames, arbitrary user-metadata, byte snippets — and the projector reads ONLY a bounded ALLOWLIST of fields off each raw object, emitting ONLY bounded enums, coarse buckets, and the SAME coarse retention facts the app already stamps. It resolves a coarse presence from a status code / `Error.Code` (a `NoSuchKey` → `absent`, a `5xx`/`SlowDown` → `error`) / `DeleteMarker` hint; decodes the `{expiresAtMs,deleted}` lifecycle and the manifest through the SAME strict codecs the retrieval boundary uses (a tampered blob collapses to "no evidence", never a guess); maps a content-type to a bounded output kind; and buckets a raw `LastModified`/`ContentLength` into a coarse age/size enum, discarding the raw number. Every other field is **never read**, so no hostile value can survive into the projected document, its embedded receipt, a downstream tool, a metric, or a log; dropped fields are tallied by a NAME-derived category (`locator`/`url`/`identity`/`integrity`/`metadata-blob`/`other`) for the receipt, their values never touched. Honesty mirrors the Phase 42 verifiers and is load-bearing: it projects only what it can positively read — a metadata-thin export degrades to the `insufficient` verdict (never a fabricated success), and a present object carrying a deletion tombstone (or a structurally-invalid non-object entry, dropped never passed through) is surfaced as the `unsafe` verdict — folding to `projected`/`insufficient`/`unsafe` with the exit ladder `0` projected / `1` usage / `2` insufficient / `4` unsafe. A content-free `worker_cleanup_projection_total{target,verdict}` metric + a per-run receipt (`cleanup/project/metrics.ts` → `receipt.ts`, same injectable default-off sinks) make each projection observable; both labels are redaction-stable so `sanitizeMetric` never silently drops a sample. Everything is fake-tested — the transform over synthetic AWS/generic captures with injected clock and spy sinks, a privacy test that drives a maximally-hostile AWS entry (key, bucket, presigned URL, endpoint, region, account id, ETag, version id, user id, email, IP, bearer token, OCR text, byte snippet, env secret, manifest string fields) and asserts nothing — nor a raw size/instant — survives, a spawned-CLI smoke over committed content-free example captures (`docs/examples/cleanup-project/`, whose `EXAMPLE-…` placeholder locators are asserted stripped), and end-to-end pipe tests that feed a real projection into the real `worker:cleanup-check` and `worker:artifact-cleanup` binaries — so no test touches real S3. It makes NO cloud call, needs NO credentials, and deletes NOTHING. Out of band and explicitly **not** claimed: it is a redaction/normalization helper, not proof of deletion, not malware scanning, not a cloud scanner, and it makes no authentication/authorization/provenance claim — it only reshapes an export the operator already produced. The Phase 41/42 behavior, local-dev tombstones, storage-backed downloads, and the no-config posture are all unchanged.

## Phase 45 — content-free operations evidence bundle

Status: shipped. Phase 45 packages the already-safe worker operations signals into one content-free incident/support artifact. The new `pnpm worker:ops-bundle` CLI composes a required `pdfxyz.ops-check/1` JSON result and an optional `pdfxyz.cleanup-pipeline/1` summary into a stable `pdfxyz.ops-bundle/1` document with a single rollup severity/exit code (`0` ok, `1` usage, `2` unknown, `3` warning, `4` critical). It can read from stdin or `--operations-file`/`--ops-check`, optionally include `--pipeline`, render JSON/text, and write `--output` without embedding that destination path. The bundle is an aggregator only: it makes no cloud call, reads no raw provider export, inspects no object bytes, and deletes nothing. Its trust boundary reconstructs the bundle from bounded enums/counts/proof states, dropping hostile paths, object keys, buckets, signed URLs, provider details, filenames, env-like values, document/OCR text, and byte snippets. A content-free `worker_ops_bundle_total{severity}` metric and committed scheduler/Kubernetes/GitHub Actions examples make the bundle usable as a CI/support artifact. It does not replace the cleanup verifier/sweeper/projector/pipeline, retrieval-time expiry enforcement, bucket lifecycle verification, or operator-owned real deletion/listing; it only packages their existing content-free summaries.

## Phase 46 — worker release readiness gate

Status: shipped. Phase 46 closes the *promotion* loop: before an operator promotes a worker build or declares production readiness, they can run ONE local, offline, read-only release gate that evaluates the existing content-free readiness signals and fails closed when it cannot honestly certify a promotion. It answers the question — "is this build/config ready to promote from the evidence available here?":

- **`pnpm worker:release-gate`** (`src/lib/workers/release-gate/`) RUNS the existing checks itself as subprocesses (deploy-examples, worker-smoke, worker-engines, ops-check/ops-bundle over committed fixtures, cleanup-pipeline, lifecycle-verify) and reads ONLY each one's process exit code — discarding every byte of stdout/stderr, so it is structurally content-free — then folds them into one `pass`/`warn`/`fail`/`unknown` verdict on the ops-aligned ladder `0`/`1`/`2`/`3`/`4`. Advisory checks (`warn`) never hard-block; blocking checks (`fail`) do. `--only`/`--skip` scope the run by bounded check id. Best for a single-host pre-deploy sweep with no setup. Emits `worker_release_gate_total{verdict}`.

It is local, offline, and read-only: it does not call the cloud, read a provider export/secret/bucket, inspect object bytes, or delete/upload/mutate anything, and it does not perform the promotion itself. It carries authored honesty caveats.

The gate does not replace the tools it composes or the operator-owned out-of-band steps. It is not the ops evidence bundle (Phase 45, a support/audit handoff artifact), not the ops-check/status runtime posture (Phase 31+), not the cleanup pipeline/projector/verifier/sweeper (Phases 42–44), not retrieval-time expiry enforcement (Phase 41), not the bucket lifecycle policy verifier/backstop, and — critically — not real cloud listing/deletion/promotion, CDN purge, legal-retention compliance, or bucket lifecycle correctness. A `pass` verdict certifies only that the evidence gathered HERE shows no blocker; out-of-band concerns (real load, data migration, legal retention, provider quotas, secrets management) remain operator-owned. The committed CI example lives at `docs/examples/deployment/github-actions/release-gate-fixture.yml`.

## Phase 47 — worker release evidence artifact

Status: shipped. Phase 47 closes the *archival* loop: after the gate has run, an operator can archive its result as a stable, tamper-evident, content-free record that a CI job, an incident handoff, or a deployment-approval workflow keeps. It answers the question — "what evidence did this build carry when it was promoted, and can anyone confirm the archived record was not altered?":

- **`pnpm worker:release-artifact`** (`src/lib/workers/release-artifact/`) archives the `worker:release-gate` result (run internally, or supplied via `--release-gate=<file>`) with bounded git/release provenance and an INTEGRITY DIGEST (`sha256` over the canonical body — the `pdfxyz-sorted-keys/1` scheme), producing a stable `pdfxyz.release-artifact/1` record. The archived gate verdict is primary; the one signal it adds is this build's working-tree cleanliness — a `dirty` tree escalates a clean `pass` to `warn` and never downgrades a `fail`/`unknown`. It records a cleanliness enum, a ref **class** (never the raw branch/remote), a validated short commit hash, and an optional validated `--label`; `--no-vcs` suppresses git facts; an optional `--ops-bundle` summary is archived as context only (it does not change the verdict). `--verify=<file>` recomputes + confirms the digest offline (a mismatch is exit `4`). Folds to `pass`/`warn`/`fail`/`unknown` on the ladder `0`/`1`/`2`/`3`/`4`. Emits `worker_release_artifact_total{verdict}`.

It is local, offline, and read-only: it does not call the cloud, read a provider export/secret/bucket, inspect object bytes, or delete/upload/mutate anything, and it does not perform the promotion. It carries authored honesty caveats.

The artifact is evidence AGGREGATION + INTEGRITY over content-free data. It is not a cryptographic signature (no key, no attested identity — the digest is tamper-evidence only), not the release gate itself (Phase 46), not the ops evidence bundle (Phase 45), not retrieval-time expiry enforcement or the cleanup tools (Phases 41–44), and — critically — not real cloud validation, byte deletion, malware scanning, authentication/authorization, or the promotion. A `pass` certifies only that the evidence gathered HERE shows no blocker; out-of-band concerns (real load, data migration, legal retention, provider quotas, secrets management) remain operator-owned. The committed CI example lives at `docs/examples/deployment/github-actions/release-artifact-fixture.yml`; example inputs live under `docs/examples/release-artifact/`.

## Phase 48 — worker release evidence index / retention manifest

Status: shipped. Phase 48 closes the *retention* loop: once release evidence artifacts (Phase 47) accumulate across a CI history, a release train, or an incident timeline, an operator can index them into one content-free retention manifest that RE-VERIFIES their integrity and tracks how much history is retained. It answers a different question than any single artifact — "across every archived artifact, is the archive INTACT (does every digest still verify), how much history is retained, and is any of it over-retention or stale?":

- **`pnpm worker:release-index`** (`src/lib/workers/release-index/`) ingests one or more `pdfxyz.release-artifact/1` files (repeated `--artifact`/`--file`, or a JSON array on stdin), re-verifies each one's INTEGRITY DIGEST (recomputing the `sha256` over its canonical body — the same `pdfxyz-sorted-keys/1` pre-image), and folds them into a stable `pdfxyz.release-index/1` manifest: a rollup verdict, per-verdict and per-digest-status counts, a bounded newest/oldest age span, a retention posture (over-count / over-age / stale), and a bounded per-artifact summary (verdict, digest prefix, git cleanliness/ref-class/commit-present, label **class**, gate verdict, ops-bundle presence). The rollup keys on ARCHIVE HEALTH — integrity first, then retention: any tampered/malformed digest forces `invalid`, a retention concern or a skipped non-artifact input is `warn`, an empty archive is `unknown`, and a clean, within-retention archive is `ok`. The archived builds' own verdicts are TALLIED as counts (an `ok` archive can still contain a `fail` in history), never re-judged. Retention bounds (`--max-artifacts`/`--max-age-days`) FLAG over-retention/stale but the index prunes nothing. Folds to `ok`/`warn`/`unknown`/`invalid` on the ladder `0`/`1`/`2`/`3`/`4`. Emits `worker_release_index_total{verdict}`.

It is local, offline, and read-only: it does not call the cloud, read a provider export/secret/bucket, inspect object bytes, or delete/prune/upload/mutate anything, and it does not perform the promotion. It carries authored honesty caveats.

The index is content-free INDEXING + digest verification over already-content-free artifacts. It is not storage retention ENFORCEMENT (it flags, it never prunes), not a cryptographic signature (no key, no attested identity — the digest re-verification is tamper-evidence only), not the release evidence artifact itself (Phase 47), not the release gate (Phase 46), and — critically — not real cloud/storage retention validation, byte deletion, malware scanning, authentication/authorization, or the promotion. An `ok` certifies only that the archive is intact + within retention on THIS host; out-of-band concerns (real cloud/storage retention, object deletion, legal holds, storage cost, provider quotas) remain operator-owned. The committed CI example lives at `docs/examples/deployment/github-actions/release-index-fixture.yml`; example inputs + a sample manifest live under `docs/examples/release-index/`.

### Release evidence policy assertions (Phase 49)

- **`pnpm worker:release-policy`** (`src/lib/workers/release-policy/`) evaluates a small, explicit set of bounded operator thresholds against a `pdfxyz.release-index/1` manifest (`--index=<path>`, or a release-index on stdin) — or against an in-process index of one or more `pdfxyz.release-artifact/1` files (`--artifact=<path>`, repeated, which re-verifies every digest as it builds the index) — and emits a stable `pdfxyz.release-policy/1` result: the rollup verdict, the evaluated policy, bounded violation ids with counts + remediation, and an exit code. Blocking assertions (`--require-clean`, `--require-latest-ok`, `--max-invalid=N`, `--max-fail=N`, `--min-artifacts=N`, `--max-artifacts=N`, `--max-age-bucket=<bucket>`) escalate to `fail`; warning-only ones (`--max-warn=N`, `--max-skipped=N`, `--forbid-over-retention`) escalate at most to `warn`. It fails CLOSED: an unreadable / not-an-index input and an empty archive are `unknown` (exit `2`), and a malformed / internally inconsistent index, or a valid index that reports a tampered artifact, is `fail` (exit `4`) regardless of flags — the archive-health verdict is RECOMPUTED from the index's own counts (via the Phase 48 rollup) so a flipped `rollup.verdict` cannot smuggle a tampered archive past the gate. Folds to `pass`/`warn`/`unknown`/`fail` on the ladder `0`/`1`/`2`/`3`/`4`. Emits `worker_release_policy_total{verdict}`.

It is local, offline, and read-only: it does not call the cloud, read a provider export/secret/bucket, inspect object bytes, or delete/prune/upload/mutate/promote anything. It carries authored honesty caveats.

The policy is bounded EVALUATION over already-content-free evidence. It is not a new evidence rung, not a cryptographic signature, not the release evidence index itself (Phase 48), not the release evidence artifact (Phase 47), not the release gate (Phase 46), and — critically — not real cloud validation, storage retention ENFORCEMENT, byte deletion, malware scanning, authentication/authorization, or the deployment approval/promotion. A `pass` certifies only that the archive met the operator's explicit policy on THIS host; out-of-band concerns (real cloud retention, legal holds, signing, provisioning, provider quotas, the promotion itself) remain operator-owned. The committed CI workflow example lives at `docs/examples/deployment/github-actions/release-policy-fixture.yml`; example index fixtures live under `docs/examples/release-policy/`.

### Release evidence CI bundle (Phase 50)

- **`pnpm worker:release-ci-bundle`** (`src/lib/workers/release-ci-bundle/`) composes whichever of the content-free release-evidence stage outputs a release job produced — a `pdfxyz.worker-release-gate/1` (`--release-gate`), a `pdfxyz.release-artifact/1` (`--release-artifact`), a `pdfxyz.release-index/1` (`--release-index`), and/or a `pdfxyz.release-policy/1` (`--release-policy`) — into one stable `pdfxyz.release-ci-bundle/1` result: per-stage summaries, the six cross-stage + self-consistency links, a rollup verdict, which stage outputs to archive, the next safe operator action, and an exit code. It answers **“What did the release evidence chain decide end-to-end, do the stages AGREE, and what is the next safe action?”** Supply at least one stage (usage exit `1` otherwise); for a certifiable bundle include at least an index or a policy.
- It reduces each stage to bounded facts through a per-stage trust boundary that REUSES the tested upstream reducers (the artifact digest re-verify, the index self-consistency recompute, the policy verdict re-derive), then evaluates six BLOCKING links: `artifact-digest`, `index-self-consistent`, `policy-self-consistent`, `gate-artifact-agreement`, `artifact-index-inclusion`, `index-policy-agreement`. It fails CLOSED: a stage `fail` (a failed build / invalid archive / blocking policy violation) OR any link `mismatch` (two stages describing different evidence — a tamper or a stale/mixed input) is `fail` (exit `4`); an unreadable / indeterminate stage, or a chain with no archive-decision stage (index/policy), is `unknown` (exit `2`); an advisory stage verdict is `warn` (exit `3`). Folds to `pass`/`warn`/`unknown`/`fail` on the ladder `0`/`1`/`2`/`3`/`4`. Emits `worker_release_ci_bundle_total{verdict}`.

It is local, offline, and read-only: it does not call the cloud, read a provider export/secret/bucket, inspect object bytes, RUN any stage itself, or delete/prune/upload/mutate/promote anything. It carries authored honesty caveats.

The bundle is content-free COMPOSITION + consistency checking over already-content-free evidence. It is not a new evidence rung, not a cryptographic signature, not the release evidence policy (Phase 49), index (Phase 48), artifact (Phase 47), or gate (Phase 46) themselves, and — critically — not real cloud validation, storage retention ENFORCEMENT, byte deletion, malware scanning, authentication/authorization, or the deployment approval/promotion. It PROVES nothing the composed stages do not already prove; it re-verifies they cohere. A `pass` certifies only that the stages supplied were coherent on THIS host; out-of-band concerns (real cloud retention, legal holds, signing, provisioning, provider quotas, the promotion itself) remain operator-owned. The committed CI workflow example lives at `docs/examples/deployment/github-actions/release-ci-bundle-fixture.yml`; example stage fixtures live under `docs/examples/release-ci-bundle/`.

This closes the release-evidence chain: **gate** (promote?) → **artifact** (archive it) → **index** (retain many) → **policy** (acceptable?) → **CI bundle** (compose + verify the whole chain for handoff).

### Release evidence audit / diff (Phase 51)

- **`pnpm worker:release-audit`** (`src/lib/workers/release-audit/`) ingests two (or a history of) content-free `pdfxyz.release-ci-bundle/1` bundles — a `--baseline` and a `--current` (pair mode), or a chronological `--bundle` list / a `--stdin` JSON array (history mode) — RE-VALIDATES each bundle against ITSELF, DIFFS their bounded postures, and folds the differences into one stable `pdfxyz.release-audit/1` result: per-slot summaries, the regression findings, a rollup verdict, an exit code, and the next safe operator action. It answers **“did this release's evidence posture REGRESS versus a baseline/history, and what is the next safe action?”** Bounded policy knobs: `--allow-warn-regression`, `--max-new-warnings=N`, `--fail-on-unknown`.
- Each bundle is UNTRUSTED: the audit reduces it through a trust boundary that copies no free-text field and re-derives the bundle's Phase 50 rollup from the bundle's OWN stages + consistency links (REUSING the upstream `computeBundleRollup`), marking it `usable` only if the recorded rollup matches the re-derived one. It fails CLOSED: a recognized-but-self-inconsistent (tampered) bundle OR a blocking regression (`verdict-worsened` to `fail`, `consistency-broke`, `archive-decision-worsened` to a blocking state) is `fail` (exit `4`); an unreadable bundle or too little comparable history is `unknown` (exit `2`, never a vacuous pass); an advisory drift (`consistency-weakened`, `coverage-dropped`, `warnings-increased`, a softening `verdict-worsened`) is `warn` (exit `3`). Folds to `pass`/`warn`/`unknown`/`fail` on the ladder `0`/`1`/`2`/`3`/`4`. Emits `worker_release_audit_total{verdict}`.

The audit is content-free DIFF over already-content-free evidence, closing the loop OVER TIME. It is not a new evidence rung, not a cryptographic signature (the re-derivation is tamper-evidence over content-free data, not an attested identity), not the CI bundle (Phase 50), policy (Phase 49), index (Phase 48), artifact (Phase 47), or gate (Phase 46) themselves, and — critically — not real cloud validation, storage retention ENFORCEMENT, byte deletion, malware scanning, authentication/authorization, or the deployment approval/promotion. It PROVES nothing the compared bundles do not already prove; it re-validates each and diffs their postures. A `pass` means only that the current bundle did not regress versus the baseline supplied on THIS host — NOT that the current bundle is itself acceptable (gate it on its own too); out-of-band concerns (real cloud retention, legal holds, signing, provisioning, the promotion itself) remain operator-owned. The committed CI workflow example lives at `docs/examples/deployment/github-actions/release-audit-fixture.yml`; example baseline/current bundle fixtures live under `docs/examples/release-audit/`.

The audit closes the loop over time: **gate** → **artifact** → **index** → **policy** → **CI bundle** (per build) → **audit** (compare a build's bundle against a baseline/history; fail on regression).

### Release evidence operator report (Phase 52)

- **`pnpm worker:release-report`** (`src/lib/workers/release-report/`) ingests a content-free `pdfxyz.release-ci-bundle/1` (`--bundle`) and/or a `pdfxyz.release-audit/1` (`--audit`; either may be `-` for stdin), RE-VALIDATES each against ITSELF, and folds them into one stable `pdfxyz.release-report/1` result: the evidence coverage, per-source summaries, a final recommendation, the bounded rationale, an archive checklist, and an ordered next-action checklist. It answers **“what should the operator DO now, based only on the content-free release evidence — is this release promote-ready, should it be held, or is the evidence insufficient?”** One policy knob: `--strict` (treat an advisory-only concern as a blocking hold).
- Each document is UNTRUSTED: the report reduces it through a trust boundary that copies no free-text field and re-derives the bundle's Phase 50 rollup (via `computeBundleRollup`) and the audit's Phase 51 rollup (via `computeAuditRollup`) from each document's OWN facts, marking it `usable` only if the recorded rollup matches the re-derived one. It fails CLOSED with a bounded precedence: a tamper / a failed bundle / a blocking audit regression is `hold-fail` (exit `4`); an unreadable or indeterminate document, or **no usable bundle at all** (an audit-only run), is `needs-evidence` (exit `2`); an advisory bundle warn / audit drift is `hold-warning` (exit `3`); a usable bundle that PASSED with no regression is `promote-ready` (exit `0`). Folds to `promote-ready`/`hold-warning`/`needs-evidence`/`hold-fail` on the ladder `0`/`1`/`2`/`3`/`4`. Emits `worker_release_report_total{recommendation}`.

The report is content-free REPORTING over already-content-free evidence, closing the operator-handoff loop. It is not a new evidence rung, not a cryptographic signature (the re-derivation is tamper-evidence over content-free data, not an attested identity), not the audit (Phase 51), CI bundle (Phase 50), policy (Phase 49), index (Phase 48), artifact (Phase 47), or gate (Phase 46) themselves, and — critically — not real cloud validation, storage retention ENFORCEMENT, byte deletion, malware scanning, authentication/authorization, deployment APPROVAL, or the deployment PROMOTION. It PROVES nothing the composed documents do not already prove; it re-validates each and folds them into one recommendation. **A `promote-ready` requires a usable bundle whose own verdict is `pass`** — an audit alone (which only reports *no regression*) is `needs-evidence`, never a promote; out-of-band concerns (real cloud retention, legal holds, signing, provisioning, approval, the promotion itself) remain operator-owned. The committed CI workflow example lives at `docs/examples/deployment/github-actions/release-report-fixture.yml`; example bundle/audit fixtures live under `docs/examples/release-report/`.

### Release evidence trend summary (Phase 53)

- **`pnpm worker:release-trend`** (`src/lib/workers/release-trend/`) ingests a bounded HISTORY of content-free `pdfxyz.release-report/1` operator reports (repeated `--report`/`--file`, oldest first / newest last, or a `--stdin` JSON array), RE-VALIDATES each against ITSELF (re-deriving its Phase 52 recommendation from its own recorded sources + strict flag, so a hand-flipped recommendation is caught as a tamper), and folds them into one stable `pdfxyz.release-trend/1` result: the recommendation distribution, a per-report posture sequence, a final trend verdict, the bounded reasons, and an ordered follow-up checklist. It answers **“how has release evidence posture changed over the recent report history, and what bounded operator follow-up is warranted?”** Bounded policy knobs: `--max-reports=N` (window cap), `--max-hold-warning=N` / `--max-hold-fail=N` (history tolerance), `--require-latest-ready` (demand a promote-ready tip).
- Each report is UNTRUSTED: the trend reduces it through a trust boundary that copies no free-text field, drops the report's own stamp, and re-derives the report's recommendation, marking it `usable` only if the record re-derives. The verdict folds fail-closed — any blocking (a tampered report, a hold-fail tip, a breached hold-fail threshold, a required not-ready tip) → `failing`; else any insufficiency (an unreadable report, an empty history, a needs-evidence tip) → `unknown`; else any advisory → `warning`; else `stable`. The NEWEST usable report is authoritative — a hold-fail tip fails the trend even within a tolerated threshold.

The trend is content-free TREND REPORTING over already-content-free reports, closing the governance-review loop. It is not a new evidence rung, not a cryptographic signature (the re-derivation is tamper-evidence over content-free data, not an attested identity), not the report (Phase 52), audit (Phase 51), CI bundle (Phase 50), policy (Phase 49), index (Phase 48), artifact (Phase 47), or gate (Phase 46) themselves, and — critically — not real cloud validation, storage retention ENFORCEMENT, byte deletion, malware scanning, authentication/authorization, deployment APPROVAL, or the deployment PROMOTION. It PROVES nothing the reports do not already prove; it re-validates each and summarizes a bounded history of their recommendations. **A `stable` trend requires a clean window** (a promote-ready tip, no tamper, no breached threshold) — a thin or untrusted history is `unknown`/`failing`, never a fabricated stable; out-of-band concerns (real cloud retention, legal holds, signing, provisioning, approval, the promotion itself) remain operator-owned. The committed CI workflow example lives at `docs/examples/deployment/github-actions/release-trend-fixture.yml`; example report fixtures live under `docs/examples/release-trend/`.

The trend closes the governance-review loop: **gate** → **artifact** → **index** → **policy** → **CI bundle** → **audit** → **report** (compose the bundle + optional audit into ONE operator recommendation: promote-ready, hold, or needs-evidence) → **trend** (summarize a bounded history of those reports into ONE governance verdict: stable, warning, unknown, or failing).

### Release evidence governance bundle (Phase 54)

- **`pnpm worker:release-governance`** (`src/lib/workers/release-governance/`) composes a content-free `pdfxyz.release-trend/1` window summary (the PRIMARY signal, `--trend`) plus, optionally, the latest `pdfxyz.release-report/1` (`--report`) and/or `pdfxyz.release-audit/1` (`--audit`; any value may be `-` for stdin, at most one; at least one document required), RE-VALIDATES each against ITSELF (re-deriving the trend's Phase 53 verdict from its own per-report points, the report's Phase 52 recommendation, and the audit's Phase 51 rollup, so a hand-flipped verdict is caught as a tamper), CROSS-CHECKS the latest report against the trend's own newest report, and folds them into one stable `pdfxyz.release-governance/1` result: the evidence coverage, per-source summaries, a governance verdict, the bounded reasons, an archive checklist, and an ordered follow-up assignment list. It answers **“what is the governance posture for this review window, what bounded evidence should be archived, and what follow-up should be assigned?”** Bounded policy knobs: `--require-report` / `--require-audit` (make either latest document mandatory), `--strict-watch` (escalate an advisory watch to blocked).

The governance bundle closes the review-window loop over the whole chain. It is content-free GOVERNANCE BUNDLING over already-content-free evidence summaries, composing the window-level trend with the latest point-in-time report / audit for a weekly / monthly governance review. It is not a new evidence rung, not a cryptographic signature (the re-derivation is tamper-evidence over content-free data, not an attested identity), not the trend (Phase 53), report (Phase 52), audit (Phase 51), CI bundle (Phase 50), policy (Phase 49), index (Phase 48), artifact (Phase 47), or gate (Phase 46) themselves, and — critically — not real cloud validation, storage retention ENFORCEMENT, byte deletion, malware scanning, authentication/authorization, deployment APPROVAL, or the deployment PROMOTION. It PROVES nothing the documents do not already prove; it re-validates each and folds them into one governance verdict + archive / follow-up checklists. **A `healthy` window requires a usable, `stable` trend** (the PRIMARY signal) — the latest report / audit can only BLOCK or FLAG, never GRANT a healthy on its own, so a trend-absent / unusable run is `incomplete`, never a fabricated healthy; out-of-band concerns (real cloud retention, legal holds, signing, provisioning, approval, the promotion itself) remain operator-owned. The committed CI workflow example lives at `docs/examples/deployment/github-actions/release-governance-fixture.yml`; example fixtures live under `docs/examples/release-governance/`.

The chain now closes the review-window loop: **gate** → **artifact** → **index** → **policy** → **CI bundle** → **audit** → **report** → **trend** → **governance** (compose the trend + latest report / audit into ONE governance verdict for a review window: healthy, watch, incomplete, or blocked).

## Phase 55 — release evidence archive pack

The worker release-evidence chain now includes `worker:release-archive`, a content-free manifest over governance plus related trend/report/audit/bundle records for periodic review archival. Remaining out-of-band work is real retention/storage policy, external signing/attestation, approval workflows, and deployment promotion; the archive pack intentionally does none of those.

## Phase 56 — release evidence restore drill

Status: shipped. The chain now includes `worker:release-restore-drill`, a scheduled disaster-recovery / review drill that RESTORES an archived `pdfxyz.release-archive/1` pack (and the underlying records it indexed, restored out of band) and proves they can be re-validated and trusted — re-deriving the pack's own rollup (a hand-flip is caught as a tamper), cross-checking each restored record's posture against what the pack recorded, and folding them into `restore-verified` / `restore-drift` / `restore-incomplete` / `restore-failed` plus a content-free sha256 fingerprint of each restored input. It fetches nothing and authorizes nothing; a `restore-verified` is DR evidence, not storage retrieval, signing, cloud validation, deployment approval/promotion, or an unzip of raw files.

## Phase 57 — release evidence publish / handoff pack

Status: shipped. Phase 57 closes the *external handoff* loop. When an operator must hand a release-evidence package to someone OUTSIDE the release loop — an external reviewer, an internal approver, an investor/partner, or an incident responder — they can compose ONE local, offline, read-only manifest that says whether the package is safe to share, with whom, and what to include. It answers the question — "is this release-evidence package safe to hand off, with what disclosure classification, and what bounded evidence should it include?":

- **`pnpm worker:release-publish-pack`** (`src/lib/workers/release-publish-pack/`) ingests the `pdfxyz.release-governance/1` bundle (the PRIMARY summary judgment) plus, optionally, the related `pdfxyz.release-archive/1`, `pdfxyz.release-restore-drill/1`, `pdfxyz.release-report/1`, and/or `pdfxyz.release-trend/1`, RE-VALIDATES each against itself (reusing the Phase 55 `ingestGovernance`, the Phase 56 `ingestRestoreArchive`, the Phase 53 `ingestReport`, the Phase 54 `ingestTrend`, and a NEW re-run of the Phase 56 `computeRestoreCoverage` + `computeRestoreRollup` for the restore drill — so a hand-flipped verdict/posture/recommendation is caught as a tamper), and folds them into one `pdfxyz.release-publish-pack/1` manifest: a publish verdict (`publishable`/`review`/`incomplete`/`blocked` on the ladder `0`/`3`/`2`/`4`), a DISCLOSURE CLASSIFICATION (`share-safe`/`internal-review`/`blocked`), a handoff checklist, and honesty caveats. The PRIMARY governance bundle is REQUIRED for a `publishable`/share-safe pack (an archive/restore-drill/report/trend can only BLOCK or FLAG, never GRANT — a governance-absent run is honestly `incomplete`, never a vacuous share-safe pack). `--require-archive`/`--require-restore-drill` make proof-of-archival/proof-of-recoverability mandatory; `--strict` escalates any non-`publishable` posture to `blocked`. Emits `worker_release_publish_pack_total{verdict}`.

The publish pack is content-free HANDOFF PACKAGING over evidence summaries: it re-validates each document against itself, classifies the sharing decision, and assembles a checklist — but it NEVER actually publishes, shares, sends, signs, approves, or promotes anything (the operator performs the handoff out of band), and it proves nothing the documents do not already prove. A `share-safe` classification is a recommendation over the content-free evidence on THIS host — not a signature, an approval, legal/compliance sign-off, an NDA, an access grant, release promotion, cloud validation, or deletion. The committed CI example lives at `docs/examples/deployment/github-actions/release-publish-pack-fixture.yml`; example inputs live under `docs/examples/release-publish-pack/`.

## Phase 58 — release evidence handoff acknowledgement receipt

Status: shipped. Phase 58 closes the *acknowledgement* loop. After a publish / handoff pack is handed off (or received), an operator needs a local, content-free RECORD that the package was reviewed / received and what bounded decision was chosen — the counterpart to a return receipt. It answers the question — "this publish pack was reviewed/received; what bounded outcome was chosen, and what happens next?":

- **`pnpm worker:release-ack`** (`src/lib/workers/release-ack/`) ingests one `pdfxyz.release-publish-pack/1` (the Phase 57 handoff pack), RE-VALIDATES it against itself (it reconstructs the pack's five reduced sources + policy and RE-RUNS the Phase 57 `computeCoverage` + `computePublishRollup` over them — so a hand-flipped verdict/disclosure, a lied coverage, or an off-enum/off-position source is caught as a tamper), applies the required `--decision` (`accepted`/`accepted-with-notes`/`needs-changes`/`rejected`/`deferred`) plus optional bounded `--reviewer` and `--note` CLASSES (never a raw identity or free text), and folds them into one `pdfxyz.release-ack/1` receipt: an acknowledgement verdict (`acknowledged`/`acknowledged-with-followup`/`deferred`/`rejected`/`invalid` on the ladder `0`/`3`/`2`/`4`/`4`), a bounded source summary (the pack's own verdict/disclosure/source counts), the recorded decision, and a next-action checklist. The input is PRIMARY — `acknowledged` REQUIRES an `accepted` decision over a usable `publishable`/share-safe pack with no note, and a missing/unreadable/tampered pack is `invalid` (never a vacuous pass). `--strict` escalates any follow-up/deferral to `rejected` (only a clean acceptance passes). Emits `worker_release_ack_total{verdict}`.

The acknowledgement is a content-free RECEIPT: it records THAT an operator acknowledged a content-free pack and WHAT bounded decision they chose — but it NEVER signs, approves, publishes, promotes, or notifies anything (the operator obtains any required external signature/approval out of band), and it proves nothing the pack does not already prove. The reviewer is a bounded CLASS (a role), never an identity; an `acknowledged` verdict is a recorded acceptance of a share-safe pack on THIS host — not an external signature, an approval, an identity attestation, legal/compliance sign-off, an NDA, an access grant, or a release promotion. The committed CI example lives at `docs/examples/deployment/github-actions/release-handoff-ack-fixture.yml`; example publish-pack inputs live under `docs/examples/release-handoff-ack/`.

## Phase 59 — release decision record ledger

Status: shipped. Phase 59 closes the *decision* loop. A publish pack says whether the evidence is safe to hand off; an acknowledgement records that a reviewer/operator reviewed/received it and what stance they chose — but the final, filed DECISION is still implicit. It answers the question — "given this publish pack and this acknowledgement of it, what is the recorded decision — proceed, proceed with a follow-up, hold, reject, or is the evidence insufficient?":

- **`pnpm worker:release-decision`** (`src/lib/workers/release-decision/`) ingests one `pdfxyz.release-publish-pack/1` (Phase 57) + one `pdfxyz.release-ack/1` (Phase 58), RE-VALIDATES each against itself (the pack reuses the Phase 58 boundary; the acknowledgement re-runs the Phase 58 `computeAckRollup` — so a hand-flipped verdict/disclosure/decision is caught as a tamper), CROSS-CHECKS that the acknowledgement's recorded source-pack summary (verdict/disclosure/source count) matches the SUPPLIED pack, and folds them into one `pdfxyz.release-decision/1` record: a bounded decision (`proceed`/`proceed-with-followup`/`hold`/`reject`/`insufficient`/`invalid` on the ladder `0`/`3`/`3`/`4`/`2`/`4`), per-source summaries, the cross-check status (`match`/`mismatch`/`unknown`), and a next-action checklist. The pair is PRIMARY — `proceed` REQUIRES a usable `publishable`/share-safe pack acknowledged by a clean `accepted` decision with a `match` cross-check, and a missing/unreadable/tampered document or a cross-check mismatch is `invalid` (never a vacuous pass). `--strict` escalates any follow-up/hold/insufficiency to `reject` (only a clean proceed passes). Emits `worker_release_decision_total{decision}`.

The decision is a content-free RECORD: it records the composite decision posture over two content-free documents — but it NEVER signs, approves, publishes, promotes, deploys, or notifies anything (the operator performs the actual promotion/deployment out of band), and it proves nothing the documents do not already prove. A `proceed` decision is a recorded posture on THIS host — not an external signature, an approval, an identity attestation, legal/compliance sign-off, an NDA, an access grant, or an actual deployment/promotion. The committed CI example lives at `docs/examples/deployment/github-actions/release-decision-record-fixture.yml`; example pack + acknowledgement inputs live under `docs/examples/release-decision-record/`.

## Phase 60 — release decision ledger index

Status: shipped. Phase 60 closes the *review* loop over the decision ledger. Phase 59 files ONE decision record per release; over a sprint / month, a team accumulates many, and a reviewer needs to see the batch at once. It answers the question — "over the batch of release decisions on this host, what did they decide, is anything blocking / inconclusive / untrustworthy, and what bounded follow-up is warranted?":

- **`pnpm worker:release-decision-index`** (`src/lib/workers/release-decision-index/`) ingests a bounded BATCH of `pdfxyz.release-decision/1` records (Phase 59; repeated `--file`/`--decision`, oldest first / newest last, or a `--stdin` JSON array / NDJSON stream / single record), RE-VALIDATES each against itself (re-deriving its Phase 59 decision from its own recorded publish-pack/acknowledgement summaries + cross-check + strict via `computeDecisionRollup` — so a hand-flipped decision is caught as a tamper), and folds them into one `pdfxyz.release-decision-index/1` summary: the decision distribution (`proceed`/`proceed-with-followup`/`hold`/`reject`/`insufficient`/`invalid` counts), per-source cross-check posture counts, a per-record posture sequence, an index verdict (`stable`/`watch`/`insufficient`/`blocked`/`invalid` on the ladder `0`/`3`/`2`/`4`/`4`), a trend class (`all-clear`/`followup-present`/`hold-present`/`rejection-present`/`insufficient-evidence`/`invalid-input`), and a next-action checklist. A `stable` index REQUIRES a clean batch (every usable record a clean `proceed`, no tampered/unreadable record); an unreadable/tampered record is `invalid` (it dominates — never a vacuous stable), a `reject`/`invalid` decision is `blocked`, an `insufficient` decision or zero usable records is `insufficient`, and a `proceed-with-followup`/`hold` decision is `watch`. `--max-records=N` caps the newest N records (older records are dropped, the count surfaced); `--strict` escalates any advisory/insufficiency to `blocked`. Emits `worker_release_decision_index_total{verdict}`.

The index is a content-free ledger INDEX SUMMARY: it summarizes a batch of the content-free decision records supplied and re-validates each one's self-consistency — but it NEVER signs, approves, publishes, promotes, deploys, or notifies anything, and it proves nothing the records do not already prove. It is explicitly NOT a legal audit log, a compliance attestation, an external approval/signature, an identity proof, or a deployment/promotion ledger — keep each of those in its own dedicated system; its re-derivation is tamper-evidence over content-free data, not a cryptographic signature (there is no signing key and no attested identity). The committed CI example lives at `docs/examples/deployment/github-actions/release-decision-index-fixture.yml`; example decision-record inputs live under `docs/examples/release-decision-index/`.


## Phase 61 — release decision index trend

Status: shipped. Phase 61 closes the *governance* loop over the decision-index ledger. Phase 60 files ONE ledger-index summary per review period; over a quarter / year, a team accumulates many, and a governance reviewer needs to see whether the decisions are improving, stable, or degrading. It answers the question — "over the recent history of release-decision ledger windows on this host, are the decisions improving, stable, or degrading, is anything blocking / inconclusive / untrustworthy, and what bounded follow-up is warranted?":

- **`pnpm worker:release-decision-trend`** (`src/lib/workers/release-decision-trend/`) ingests a bounded HISTORY of `pdfxyz.release-decision-index/1` windows (Phase 60; repeated `--file`/`--window`, oldest first / newest last, or a `--stdin` JSON array / NDJSON stream / single window), RE-VALIDATES each against itself TWICE (re-deriving its Phase 60 index verdict from its own ledger counts via `computeIndexRollup`, AND re-checking those counts against the window's own per-record sequence + window arithmetic via `reduceIndex` — so a hand-flipped index, or a lied count consistent with it, is caught as a tamper), and folds them into one `pdfxyz.release-decision-trend/1` summary: the per-window index-verdict distribution (`stable`/`watch`/`insufficient`/`blocked`/`invalid` counts), the aggregate decision distribution (`proceed`/…/`invalid` counts), a per-window posture sequence, an arc direction (`improving`/`flat`/`degrading`/`unknown`, from ordered input positions — never a timestamp), a trend class (`all-clear`/`improving`/`stable-watch`/`followup-rising`/`hold-rising`/`rejection-present`/`insufficient-evidence`/`invalid-input`), a trend verdict (`improving`/`stable`/`watch`/`degrading`/`insufficient`/`blocked`/`invalid` on the ladder `0`/`0`/`3`/`3`/`2`/`4`/`4`), and a next-action checklist. A `stable` trend REQUIRES a clean history (every usable window a clean `stable` index, no tampered/unreadable window), and `improving` additionally a clean latest window over an earlier worse one; a worsening arc is `degrading` and a flat advisory history is `watch`; an only-`insufficient` history or zero usable windows is `insufficient`; a `blocked`/`invalid` window is `blocked`; an unreadable/tampered window is `invalid` (it dominates — never a vacuous pass). `--max-windows=N` caps the newest N windows (default 26; older windows are dropped, the count surfaced); `--strict` escalates any non-stable window to `blocked`. Emits `worker_release_decision_trend_total{verdict}`.

The trend is a content-free ledger-index TREND SUMMARY: it summarizes a history of the content-free decision-index windows supplied and re-validates each one's self-consistency — but it NEVER signs, approves, publishes, promotes, deploys, or notifies anything, and it proves nothing the windows do not already prove. It is explicitly NOT a legal audit log, a compliance attestation, an external approval/signature, an identity proof, or a deployment/promotion ledger — keep each of those in its own dedicated system; its re-derivation is tamper-evidence over content-free data, not a cryptographic signature (there is no signing key and no attested identity, and a fully self-consistent fabricated window is out of its scope). The committed CI example lives at `docs/examples/deployment/github-actions/release-decision-trend-fixture.yml`; example decision-index window inputs live under `docs/examples/release-decision-trend/`.

## Phase 62 — release decision trend action plan

Status: shipped. Phase 62 turns the governance TREND into an operator's next move. Phase 61 answers "are the decisions improving, stable, or degrading?"; a reviewer then needs a bounded, honest answer to "so what do I do next, and how urgently?" — without the summarizer pretending to be approval or compliance. It answers the question — "given this content-free decision-trend summary, what bounded follow-up plan should an operator run next, and at what urgency?":

- **`pnpm worker:release-decision-action-plan`** (`src/lib/workers/release-decision-action-plan/`) ingests ONE `pdfxyz.release-decision-trend/1` summary (Phase 61; `--trend`/`--file`, or a `--stdin` JSON document), RE-VALIDATES it against itself TWICE (re-deriving its Phase 61 trend verdict from its own window-verdict summary via `computeTrendRollup`, AND re-checking that summary against the trend's own per-window posture sequence + window arithmetic via `directionOf` — so a hand-flipped trend verdict, or a lied window distribution consistent with it, is caught as a tamper), and translates its bounded verdict into one `pdfxyz.release-decision-action-plan/1` plan: a plan verdict (`clear`/`monitor`/`investigate`/`block-release`/`invalid`), an urgency (`none`/`low`/`medium`/`high`/`critical`), an action class (`none`/`monitor-next-window`/`review-followups`/`stabilize-regression`/`block-and-reconcile`/`restore-evidence`/`reject-input`), the surfaced source trend verdict/class/arc, and an ordered next-action checklist (stable ids + allowlisted labels + bounded urgency/expectation enums + a boolean). A `clear` plan REQUIRES a usable trend whose OWN verdict is a clean `stable` history; an `improving` trend is a benign `monitor` (exit 0), a `watch`/`degrading` trend a follow-up `monitor` (exit 3), an `insufficient` trend `investigate` (exit 2), a `blocked`/`invalid` trend `block-release` (exit 4), and an unreadable/tampered trend input `invalid`/`reject-input` (exit 4 — it dominates, never a vacuous clear plan). `--max-actions=N` caps the checklist to the highest-priority N (default 8, hard max 20; the count dropped is surfaced); `--strict` escalates any non-clear plan to `block-release` but never fabricates approval for a clear trend. Emits `worker_release_decision_action_plan_total{verdict}`.

The plan is a content-free operational follow-up plan: it translates one content-free trend into bounded operator follow-up and re-validates its self-consistency — but it NEVER signs, approves, publishes, promotes, deploys, or notifies anything, and it proves nothing the trend does not already prove. It is explicitly NOT a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log — keep each of those in its own dedicated system; its re-derivation is tamper-evidence over content-free data, not a cryptographic signature (there is no signing key and no attested identity, and a fully self-consistent fabricated trend is out of its scope). The committed CI example lives at `docs/examples/deployment/github-actions/release-decision-action-plan-fixture.yml`; example trend inputs live under `docs/examples/release-decision-action-plan/`.

- **`pnpm worker:release-decision-action-receipt`** (`src/lib/workers/release-decision-action-receipt/`) ingests ONE `pdfxyz.release-decision-action-plan/1` follow-up plan (Phase 62; `--plan`/`--file`, or a `--stdin` JSON document) plus bounded operator acknowledgement flags, RE-VALIDATES it against itself (reconstructing its Phase 62 bounded decision from the source-trend details the plan recorded and re-running the Phase 62 `computeActionPlan` reducer — so a hand-flipped plan verdict / action class / exit code is caught as a tamper), and records whether the plan's required follow-ups were acknowledged in one `pdfxyz.release-decision-action-receipt/1` receipt: a receipt verdict (`completed`/`incomplete`/`followup-open`/`blocked` on the ladder `0`/`2`/`3`/`4`), the resolved plan class (`clear`/`monitor`/`investigate`/`block`), a bounded acknowledgement checklist (required / supplied / missing / contradictory), and bounded reasons. A `completed` receipt REQUIRES a usable plan AND its class's required acknowledgements (`--ack-plan` for every class, plus `--ack-followups` + a class ack — `--ack-monitor`/`--ack-investigation`/`--ack-block` — for the rest); a missing/unreadable plan is `incomplete` (exit 2), a tampered plan / an unacknowledged `block` plan / a contradictory acknowledgement / a `--strict-open` escalation is `blocked` (exit 4), and an open advisory follow-up (monitor/investigate) is `followup-open` (exit 3). The acknowledgements are booleans only (no note or actor name); `--strict-open` escalates any open follow-up to `blocked`. Emits `worker_release_decision_action_receipt_total{verdict}`.

The receipt is a content-free operational execution receipt: it records whether an operator's bounded acknowledgements closed out one content-free plan and re-validates the plan's self-consistency — but it NEVER signs, approves, publishes, promotes, deploys, or notifies anything, and it proves nothing the plan does not already prove. It is explicitly NOT a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log — keep each of those in its own dedicated system; its re-derivation is tamper-evidence over content-free data, not a cryptographic signature (there is no signing key and no attested identity, and a fully self-consistent fabricated plan is out of its scope). The committed CI example lives at `docs/examples/deployment/github-actions/release-decision-action-receipt-fixture.yml`; example plan inputs live under `docs/examples/release-decision-action-receipt/`.

## Phase 64 — release decision closeout bundle

Status: shipped. Phase 64 closes the decision governance chain. Phases 59–63 built the chain one rung at a time — decision record → ledger index → index trend → action plan → execution receipt — and a governance reviewer at the end of a review period needs ONE bounded answer to "is this whole chain done?" without re-reading five documents. It answers the question — "given this content-free execution receipt (and the related records already on hand), is the release decision governance chain closed out, still open, incomplete, or blocked?":

- **`pnpm worker:release-decision-closeout`** (`src/lib/workers/release-decision-closeout/`) ingests ONE `pdfxyz.release-decision-action-receipt/1` execution receipt (Phase 63; `--receipt`/`--file`, or a `--stdin` JSON document; REQUIRED) plus OPTIONAL related records already on hand — the `pdfxyz.release-decision-action-plan/1` plan (`--plan`), the `pdfxyz.release-decision-trend/1` trend (`--trend`), and the `pdfxyz.release-decision/1` / `pdfxyz.release-decision-index/1` ledger records (`--decision` / `--index`) — RE-VALIDATES the primary receipt against itself (reconstructing its Phase 63 bounded decision from the source facets it recorded and re-running the Phase 63 `computeReceipt` reducer — so a hand-flipped receipt verdict / ack coverage / exit code is caught as a tamper), CROSS-CHECKS each supplied related record against what the receipt recorded (the supplied plan / trend must AGREE with the plan / source-trend verdict the receipt recorded; the decision / index records fold their OWN bounded posture as a source-chain signal), and composes them into one `pdfxyz.release-decision-closeout/1` record: a closeout verdict (`closed`/`closeout-incomplete`/`closeout-open`/`closeout-blocked` on the ladder `0`/`2`/`3`/`4`), the primary receipt's state + verdict, a bounded related-record checklist (kind + state + signal), and bounded reasons. A `closed` closeout REQUIRES a usable primary receipt whose OWN verdict is `completed` AND every supplied related record coherent; a missing/unreadable primary receipt or a missing required record (`--require-plan`/`--require-trend`/`--require-decision`/`--require-index`) is `closeout-incomplete` (exit 2), a tampered/`blocked` receipt / a contradictory cross-check record / a tampered related record / a blocked source chain / a `--strict-open` escalation is `closeout-blocked` (exit 4), and a `followup-open` receipt or an advisory decision / index record is `closeout-open` (exit 3). It accepts no free-form note or actor name; `--strict-open` escalates any open closeout to `closeout-blocked`. Emits `worker_release_decision_closeout_total{verdict}`.

The closeout is a content-free operational closeout SUMMARY: it composes previously produced content-free records and re-validates the primary receipt's self-consistency + the chain's cross-record coherence — but it NEVER signs, approves, publishes, promotes, deploys, or notifies anything, and it proves nothing the records do not already prove. It is explicitly NOT a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log — keep each of those in its own dedicated system; its re-derivation is tamper-evidence over content-free data, not a cryptographic signature (there is no signing key and no attested identity, and a set of fully self-consistent fabricated records is out of its scope). The committed CI example lives at `docs/examples/deployment/github-actions/release-decision-closeout-fixture.yml`; example receipt + related-record inputs live under `docs/examples/release-decision-closeout/`.

## Phase 65 — release decision closeout index

Status: shipped. Phase 65 closes the *review* loop over the closeout ledger. Phase 64 files ONE `pdfxyz.release-decision-closeout/1` closeout per release; over a sprint / quarter a governance reviewer needs ONE bounded answer to "are we consistently closing releases out, or is the recent history slipping?" without re-reading every closeout. It answers the question — "across the recent release decision closeouts, are we consistently closed, or is the latest / recent history open, incomplete, or blocked?":

- **`pnpm worker:release-decision-closeout-index`** (`src/lib/workers/release-decision-closeout-index/`) ingests a bounded HISTORY of `pdfxyz.release-decision-closeout/1` records (Phase 64; repeated `--file`/`--closeout`, oldest first / newest last, or a `--stdin` JSON array / NDJSON stream / single closeout), RE-VALIDATES each closeout against itself (re-deriving its Phase 64 closeout rollup from its own recorded receipt-source facets + per-kind related-record signals + policy, mirroring the Phase 64 `computeCloseout` reducer — so a hand-flipped closeout verdict / exit / rollup, or a flipped decision/index/trend cross-check signal, is caught as a tamper), and folds them into one `pdfxyz.release-decision-closeout-index/1` record: an index verdict (`indexed`/`index-incomplete`/`index-open`/`index-blocked` on the ladder `0`/`2`/`3`/`4`), the closeout-verdict distribution, the latest / oldest closeout verdict, a per-record posture sequence, a trend class, bounded reasons, and a next-action checklist. It is LATEST-FOCUSED: the newest usable closeout drives the verdict, and bounded history thresholds (`--max-open`/`--max-incomplete`/`--max-blocked`, each default `0`) tolerate a bounded number of non-closed closeouts before the accumulation escalates (the latest is never tolerated by a threshold). An `indexed` index REQUIRES a coherent history (the latest usable closeout `closed`, no tampered/unreadable closeout, counts within thresholds); a `closeout-open` latest / breach is `index-open` (exit 3), a `closeout-incomplete` latest / breach / unreadable closeout / zero usable closeouts is `index-incomplete` (exit 2), and a tampered closeout / `closeout-blocked` latest / breach / `--strict-open` escalation is `index-blocked` (exit 4, it dominates — never a vacuous indexed). `--max-closeouts=N` bounds the window; it accepts no free-form note or actor name. Emits `worker_release_decision_closeout_index_total{verdict}`.

The closeout index is a content-free closeout-ledger INDEX SUMMARY: it ingests previously produced content-free closeout records and re-validates each one's self-consistency — but it NEVER signs, approves, publishes, promotes, deploys, or notifies anything, and it proves nothing the closeouts do not already prove. It is explicitly NOT a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log — keep each of those in its own dedicated system; its re-derivation is tamper-evidence over content-free data, not a cryptographic signature (there is no signing key and no attested identity, and a set of fully self-consistent fabricated records is out of its scope). The committed CI example lives at `docs/examples/deployment/github-actions/release-decision-closeout-index-fixture.yml`; example closeout-record inputs live under `docs/examples/release-decision-closeout-index/`.

## Phase 66 — release decision closeout index trend

Status: shipped. Phase 66 closes the *governance review* loop over the closeout-index ledger. Phase 65 files ONE `pdfxyz.release-decision-closeout-index/1` review summary per review period; over a quarter / year a governance reviewer needs ONE bounded answer to "are the recent review periods trending consistently closed, or is the posture slipping?" without re-reading every index. It answers the question — "over the recent closeout-index windows, are the release closeouts trending stable / improving, watching, incomplete, or blocked, and what follow-up is warranted?":

- **`pnpm worker:release-decision-closeout-index-trend`** (`src/lib/workers/release-decision-closeout-index-trend/`) ingests a bounded HISTORY of `pdfxyz.release-decision-closeout-index/1` windows (Phase 65; repeated `--file`/`--index`, oldest first / newest last, or a `--stdin` JSON array / NDJSON stream / single window), RE-VALIDATES each window against itself (re-deriving its Phase 65 index verdict from its own recorded ledger via `computeCloseoutIndexRollup`, and re-checking those counts against the window's own per-record sequence + window arithmetic via `reduceIndex` — so a hand-flipped index, or a lied count consistent with it, is caught as a tamper), and folds them into one `pdfxyz.release-decision-closeout-index-trend/1` record: a trend verdict (`trend-stable`/`trend-incomplete`/`trend-watch`/`trend-blocked` on the ladder `0`/`2`/`3`/`4`), the per-window index-verdict distribution, the aggregate closeout distribution, a per-window posture sequence, an arc direction (from ordered input positions, never a timestamp), a trend class, bounded reasons, and a next-action checklist. It is LATEST-FOCUSED: the newest usable window's own index verdict drives the verdict, and bounded history thresholds (`--max-watch`/`--max-incomplete`/`--max-blocked`, each default `0`) tolerate a bounded number of non-`indexed` windows before the accumulation escalates (the latest is never tolerated by a threshold), while a worsening arc raises a watch. A `trend-stable` trend REQUIRES a coherent history (the latest usable window `indexed`, no tampered/unreadable window, counts within thresholds, a non-degrading arc); an `index-open` latest / breach or a degrading arc is `trend-watch` (exit 3), an `index-incomplete` latest / breach / unreadable window / zero usable windows is `trend-incomplete` (exit 2), and a tampered window / `index-blocked` latest / breach / `--strict-watch` escalation is `trend-blocked` (exit 4, it dominates — never a vacuous trend-stable). `--max-indexes=N` bounds the window; it accepts no free-form note or actor name. Emits `worker_release_decision_closeout_index_trend_total{verdict}`.

The closeout-index trend is a content-free closeout-index TREND SUMMARY: it ingests previously produced content-free closeout-index windows and re-validates each one's self-consistency — but it NEVER signs, approves, publishes, promotes, deploys, or notifies anything, and it proves nothing the windows do not already prove. It is explicitly NOT a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log — keep each of those in its own dedicated system; its re-derivation is tamper-evidence over content-free data, not a cryptographic signature (there is no signing key and no attested identity, and a set of fully self-consistent fabricated windows is out of its scope). The committed CI example lives at `docs/examples/deployment/github-actions/release-decision-closeout-index-trend-fixture.yml`; example closeout-index-window inputs live under `docs/examples/release-decision-closeout-index-trend/`.

## Phase 67 — release decision closeout trend action plan

Status: shipped. Phase 67 turns the Phase 66 governance trend into the release team's next move. Phase 66 folds a bounded HISTORY of closeout-index windows into ONE `pdfxyz.release-decision-closeout-index-trend/1` verdict; a periodic governance review then needs ONE bounded answer to "given this trend, what follow-up posture should we take, and how urgently?" without re-reading the windows. It answers the question — "given this content-free closeout-index trend, what bounded follow-up posture should the release team take next, and at what urgency?":

- **`pnpm worker:release-decision-closeout-action-plan`** (`src/lib/workers/release-decision-closeout-action-plan/`) ingests ONE `pdfxyz.release-decision-closeout-index-trend/1` summary (Phase 66; `--trend`/`--file`, or `--stdin`), RE-VALIDATES it against itself (re-deriving its Phase 66 trend verdict from its own recorded per-window summary via `computeTrendRollup`, and re-checking that summary against the trend's own per-window posture sequence + window arithmetic via `directionOf` / `deriveTrendClass` — so a hand-flipped trend verdict, or a lied window distribution consistent with it, is caught as a tamper), and folds it into one `pdfxyz.release-decision-closeout-action-plan/1` record: a plan verdict (`clear`/`investigate`/`monitor`/`block-release` on the ladder `0`/`2`/`3`/`4`), an urgency (`none`→`critical`), a coarse action class (`none`/`complete-evidence`/`monitor-followups`/`block-and-reconcile`/`reject-input`), the surfaced source trend verdict / class / arc / latest index posture, bounded reasons, and an ordered next-action checklist. It FAILS CLOSED: a `trend-stable` history is a `clear` plan (exit 0, routine monitoring only); a `trend-incomplete` history is `investigate` (exit 2); a `trend-watch` / degrading history is a follow-up `monitor` (exit 3); a `trend-blocked` history, an unreadable / tampered trend INPUT, or a `--strict-watch` escalation is `block-release` (exit 4, it dominates — never a vacuous clear plan). `--strict-watch` escalates a `monitor` plan to `block-release` — a hard "consistently closed or block" gate — but never fabricates approval for a stable trend; it accepts no free-form note or actor name. Emits `worker_release_decision_closeout_action_plan_total{verdict}`.

The closeout action plan is a content-free operational FOLLOW-UP PLAN: it ingests one previously produced content-free trend and re-validates its self-consistency — but it NEVER signs, approves, publishes, promotes, deploys, or notifies anything, and it proves nothing the trend does not already prove; it TRANSLATES the trend's bounded verdict into a bounded operator follow-up posture. It is explicitly NOT a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log — keep each of those in its own dedicated system; its re-derivation is tamper-evidence over content-free data, not a cryptographic signature (there is no signing key and no attested identity, and a fully self-consistent fabricated trend is out of its scope). The committed CI example lives at `docs/examples/deployment/github-actions/release-decision-closeout-action-plan-fixture.yml`; example closeout-index-trend inputs live under `docs/examples/release-decision-closeout-action-plan/`.

## Phase 68 — release decision closeout action-plan execution receipt

Status: shipped. Phase 68 closes the governance loop the Phase 67 plan opened. Phase 67 translates a closeout-index trend into ONE `pdfxyz.release-decision-closeout-action-plan/1` follow-up plan; a governance review then needs ONE bounded answer to "did the release team actually acknowledge / execute that plan's follow-ups?" without re-reading the trend or naming who did it. It answers the question — "given this content-free closeout follow-up plan and the operator's bounded acknowledgements, were the plan's required follow-ups closed out for the release governance record?":

- **`pnpm worker:release-decision-closeout-action-receipt`** (`src/lib/workers/release-decision-closeout-action-receipt/`) ingests ONE `pdfxyz.release-decision-closeout-action-plan/1` plan (Phase 67; `--plan`/`--file`, or `--stdin`) plus bounded operator acknowledgement flags, RE-VALIDATES it against itself (reconstructing its Phase 67 bounded decision from the source-trend details the plan recorded and re-running the Phase 67 `computeCloseoutActionPlan` reducer — so a hand-flipped plan verdict / action class / exit code is caught as a tamper), folds the plan's coarse CLASS (`clear`/`investigate`/`monitor`/`block`) against the acknowledgements it requires, and emits one `pdfxyz.release-decision-closeout-action-receipt/1` record: a receipt verdict (`completed`/`incomplete`/`followup-open`/`blocked` on the ladder `0`/`2`/`3`/`4`), the resolved plan class, a bounded acknowledgement checklist (required / supplied / missing / contradictory), bounded reasons, and a content-free receipt. It FAILS CLOSED: a `completed` receipt REQUIRES a usable plan AND its class's required acknowledgements (`--ack-plan` for every class, plus `--ack-executed` + a class ack — `--ack-monitor` / `--ack-investigation` / `--ack-block` — for the rest); a missing / unreadable / tampered plan, a `block` plan not acknowledged as held-blocked, a contradictory acknowledgement, or a `--strict-open` escalation is `blocked` (exit 4); a missing required acknowledgement for a `clear` / `investigate` plan is `incomplete` (exit 2); a `monitor` plan reviewed but whose follow-up is still open / not fully executed is `followup-open` (exit 3). The acknowledgements are BOOLEANS ONLY — no free-form note or actor name. Emits `worker_release_decision_closeout_action_receipt_total{verdict}`.

The closeout action-plan execution receipt is a content-free operational EXECUTION RECEIPT: it ingests one previously produced content-free plan plus bounded acknowledgement flags and re-validates the plan's self-consistency — but it NEVER signs, approves, publishes, promotes, deploys, or notifies anything, it authorizes and proves nothing, and it attests no person's identity; it RECORDS whether the plan's bounded follow-ups were acknowledged / executed. It is explicitly NOT a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log — keep each of those in its own dedicated system; its re-derivation is tamper-evidence over content-free data, not a cryptographic signature (there is no signing key and no attested identity, and a fully self-consistent fabricated plan is out of its scope). The committed CI example lives at `docs/examples/deployment/github-actions/release-decision-closeout-action-receipt-fixture.yml`; example closeout-action-plan inputs live under `docs/examples/release-decision-closeout-action-receipt/`.

## Phase 69 — release decision closeout governance bundle

Status: shipped. Phase 69 closes the whole closeout chain into one governance record. Phases 64–68 built the chain rung by rung — the closeout bundle, its index, the index trend, the trend action plan, and the plan's execution receipt; a governance review then needs ONE bounded answer to "is this closeout governance chain fully closed, or is something still open / incomplete / blocked?" over the whole chain at once, without re-reading each rung or naming who reviewed it. It answers the question — "given the required content-free closeout action-plan execution receipt (plus, optionally, the related records it was built from), is this release decision closeout governance chain fully CLOSED, OPEN, INCOMPLETE, or BLOCKED?":

- **`pnpm worker:release-decision-closeout-governance`** (`src/lib/workers/release-decision-closeout-governance/`) ingests a REQUIRED `pdfxyz.release-decision-closeout-action-receipt/1` primary receipt (Phase 68; `--receipt`/`--file`, or `--stdin`) plus, optionally, the related records it was built from (`--plan` Phase 67, `--trend` Phase 66, `--index` Phase 65, `--closeout` Phase 64), RE-VALIDATES each against itself (the primary receipt by reconstructing its Phase 68 plan-ingest + re-running `computeReceipt`; the related records by the Phase 64–68 `ingest*` boundaries — so a hand-flipped verdict is caught as a tamper), CROSS-CHECKS the supplied plan / trend against the plan verdict / source-trend verdict the receipt recorded, folds every supplied source-chain record's own bounded posture, and emits one `pdfxyz.release-decision-closeout-governance/1` record: a governance verdict (`closed`/`governance-incomplete`/`governance-open`/`governance-blocked` on the ladder `0`/`2`/`3`/`4`), a primary-receipt summary, a related-record checklist (kind / required / state / relation signal / verdict), an archive checklist, an ordered follow-up assignment list, bounded reasons, and a content-free receipt. It FAILS CLOSED: a `closed` bundle REQUIRES a usable primary receipt whose OWN verdict is `completed` AND every supplied related record coherent; a tampered / `blocked` primary receipt, a contradictory plan / trend, a tampered related record, a blocked source chain, or a `--strict-open` escalation is `governance-blocked` (exit 4); a missing / unreadable / incomplete primary receipt, a required-but-missing (`--require-plan` / `--require-trend` / `--require-index` / `--require-closeout`) record, or an inconclusive source chain is `governance-incomplete` (exit 2); a `followup-open` receipt or an advisory source chain is `governance-open` (exit 3). It accepts NO free-form note or actor name — only the record inputs, the `--require-<kind>` flags, and `--strict-open`. Emits `worker_release_decision_closeout_governance_total{verdict}`.

The closeout governance bundle is a content-free operational GOVERNANCE BUNDLE: it ingests one previously produced content-free execution receipt (required) plus optional related closeout-chain records, re-validates each one's self-consistency, and cross-checks the chain — but it NEVER signs, approves, publishes, promotes, deploys, or notifies anything, it authorizes and proves nothing, and it attests no person's identity; it RECORDS whether the chain reads as coherently closed. It is explicitly NOT a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log — keep each of those in its own dedicated system; its re-derivation is tamper-evidence over content-free data, not a cryptographic signature (there is no signing key and no attested identity, and a set of fully self-consistent fabricated records is out of its scope — the cross-checks compare bounded verdict enums, catching a swapped / edited record, not a fully-consistent forgery). The committed CI example lives at `docs/examples/deployment/github-actions/release-decision-closeout-governance-fixture.yml`; example primary-receipt + related-record inputs live under `docs/examples/release-decision-closeout-governance/`.

- **`pnpm worker:release-decision-closeout-governance-index`** (`src/lib/workers/release-decision-closeout-governance-index/`) indexes a bounded HISTORY of content-free `pdfxyz.release-decision-closeout-governance/1` governance bundles (Phase 69; repeated `--file`/`--governance`, oldest first / newest last, or a `--stdin` JSON array / NDJSON stream / single bundle) into one `pdfxyz.release-decision-closeout-governance-index/1` review summary. It RE-VALIDATES each bundle against itself (re-deriving its Phase 69 governance rollup from the bundle's own recorded primary-receipt source facets + per-kind related-record signals + policy, mirroring the Phase 69 `computeGovernance` reducer — so a hand-flipped governance verdict / exit / rollup, or a flipped cross-check / posture signal, is caught as a tamper), and folds them into the governance-verdict distribution (`closed`/`governance-incomplete`/`governance-open`/`governance-blocked` counts), the latest / oldest governance verdict, a per-record posture sequence, a trend class (`all-closed`/`open-present`/`incomplete-present`/`blocked-present`/`tampered-present`/`no-usable`), an index verdict (`indexed`/`index-incomplete`/`index-open`/`index-blocked` on the ladder `0`/`2`/`3`/`4`), bounded reasons, and an ordered next-action checklist. It is LATEST-FOCUSED: the newest usable bundle drives the verdict, and bounded history thresholds (`--max-open` / `--max-incomplete` / `--max-blocked`, each default `0`; `--max-governance` caps the newest-N window) tolerate a bounded number of non-closed bundles before the accumulation escalates (the latest is never tolerated by a threshold). It FAILS CLOSED: an `indexed` index REQUIRES a coherent history (the latest usable bundle `closed`, no tampered / unreadable bundle, counts within thresholds); a tampered bundle, a `governance-blocked` latest / threshold breach, or a `--strict-open` escalation is `index-blocked` (exit 4); an unreadable bundle, a `governance-incomplete` latest / threshold breach, or zero usable bundles is `index-incomplete` (exit 2); a `governance-open` latest / threshold breach is `index-open` (exit 3). It accepts NO free-form note or actor name — only the bundle inputs, the window / threshold knobs, and `--strict-open`. Emits `worker_release_decision_closeout_governance_index_total{verdict}`.

The closeout governance index is a content-free governance-history INDEX SUMMARY: it ingests a bounded history of previously produced content-free governance bundles, re-validates each one's self-consistency, and folds their governance verdicts into one review verdict + follow-up checklist — but it NEVER signs, approves, publishes, promotes, deploys, or notifies anything, it authorizes and proves nothing, and it attests no person's identity; it RECORDS whether the recent governance reads as consistently closed. It is explicitly NOT a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log — keep each of those in its own dedicated system; its re-derivation is tamper-evidence over content-free data, not a cryptographic signature (there is no signing key and no attested identity, and a set of fully self-consistent fabricated bundles is out of its scope). The committed CI example lives at `docs/examples/deployment/github-actions/release-decision-closeout-governance-index-fixture.yml`; example governance-bundle inputs live under `docs/examples/release-decision-closeout-governance-index/`.

- **`pnpm worker:release-decision-closeout-governance-index-trend`** (`src/lib/workers/release-decision-closeout-governance-index-trend/`) summarizes a bounded HISTORY of content-free `pdfxyz.release-decision-closeout-governance-index/1` windows (Phase 70; repeated `--file`/`--index`, oldest first / newest last, or a `--stdin` JSON array / NDJSON stream / single window) into one `pdfxyz.release-decision-closeout-governance-index-trend/1` trend summary. It RE-VALIDATES each window against itself (re-deriving its Phase 70 index verdict from the window's own recorded ledger + latest via the Phase 70 rollup fold, AND re-reducing the window's own per-record posture sequence via the Phase 70 reduce fold and requiring the recorded ledger's post-cap counts + window arithmetic to re-derive — so a hand-flipped index verdict, or a lied count consistent with it, is caught as a tamper), and folds them into the per-window index-verdict distribution (`indexed`/`index-incomplete`/`index-open`/`index-blocked` counts), the aggregate governance distribution (`closed`/`governance-incomplete`/`governance-open`/`governance-blocked` counts), a per-window posture sequence, an arc direction (`improving`/`flat`/`degrading`/`unknown`), a trend class (`all-indexed`/`watch-present`/`incomplete-present`/`blocked-present`/`tampered-present`/`no-usable`), a trend verdict (`trend-stable`/`trend-incomplete`/`trend-watch`/`trend-blocked` on the ladder `0`/`2`/`3`/`4`), bounded reasons, and an ordered next-action checklist. It is LATEST-FOCUSED: the newest usable window drives the verdict, bounded history thresholds (`--max-open` / `--max-incomplete` / `--max-blocked`, each default `0`; `--max-indexes` caps the newest-N window) tolerate a bounded number of non-`indexed` windows before the accumulation escalates (the latest is never tolerated by a threshold), and a worsening arc raises a watch. It FAILS CLOSED: a `trend-stable` trend REQUIRES a coherent history (the latest usable window `indexed`, no tampered / unreadable window, counts within thresholds, a non-degrading arc); a tampered window, an `index-blocked` latest / threshold breach, or a `--strict-watch` escalation is `trend-blocked` (exit 4); an unreadable window, an `index-incomplete` latest / threshold breach, or zero usable windows is `trend-incomplete` (exit 2); an `index-open` latest / threshold breach or a degrading arc is `trend-watch` (exit 3). It accepts NO free-form note or actor name — only the window inputs, the window / threshold knobs, and `--strict-watch`. Emits `worker_release_decision_closeout_governance_index_trend_total{verdict}`.

The closeout governance index trend is a content-free governance-index TREND SUMMARY: it ingests a bounded history of previously produced content-free governance-index windows, re-validates each one's self-consistency, and folds their index verdicts into one trend verdict + follow-up checklist — but it NEVER signs, approves, publishes, promotes, deploys, or notifies anything, it authorizes and proves nothing, and it attests no person's identity; it RECORDS whether the recent governance-index posture trended consistently closed. It is explicitly NOT a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log — keep each of those in its own dedicated system; its re-derivation is tamper-evidence over content-free data, not a cryptographic signature (there is no signing key and no attested identity, and a set of fully self-consistent fabricated windows is out of its scope). The committed CI example lives at `docs/examples/deployment/github-actions/release-decision-closeout-governance-index-trend-fixture.yml`; example governance-index window inputs live under `docs/examples/release-decision-closeout-governance-index-trend/`.

- **`pnpm worker:release-decision-closeout-governance-action-plan`** (`src/lib/workers/release-decision-closeout-governance-action-plan/`) ingests ONE content-free `pdfxyz.release-decision-closeout-governance-index-trend/1` summary (Phase 71; `--trend`/`--file`, or `--stdin`) and translates its bounded verdict into one `pdfxyz.release-decision-closeout-governance-action-plan/1` operator follow-up plan. It RE-VALIDATES the trend against itself (re-deriving its Phase 71 trend verdict from the trend's own recorded per-window summary via the Phase 71 `computeTrendRollup` fold, AND re-checking that summary against the trend's own per-window posture sequence + window arithmetic via the Phase 71 `directionOf` / `deriveTrendClass` reducers — so a hand-flipped trend verdict, or a lied window distribution consistent with it, is caught as a tamper), and folds it into a plan verdict (`clear`/`investigate`/`monitor`/`block-release` on the ladder `0`/`2`/`3`/`4`), an urgency (`none`/`low`/`medium`/`high`/`critical`), an action class (`none`/`complete-evidence`/`monitor-followups`/`block-and-reconcile`/`reject-input`), the surfaced source trend verdict / class / arc / latest governance-index posture, an ordered next-action checklist (each a stable id + an allowlisted label + bounded urgency / expectation enums), bounded reasons, and a content-free receipt. It FAILS CLOSED: a `clear` plan REQUIRES a usable trend whose OWN verdict is a coherent `trend-stable`; a `trend-blocked` history, an unreadable / tampered trend input, or a `--strict-watch` escalation is `block-release` (exit 4, never a vacuous clear plan); a `trend-incomplete` history is `investigate` (exit 2); a `trend-watch` / degrading history is a follow-up `monitor` (exit 3). It accepts NO free-form note or actor name — only the ONE trend input and `--strict-watch`. Emits `worker_release_decision_closeout_governance_action_plan_total{verdict}`.

The closeout governance action plan is a content-free operational FOLLOW-UP PLAN: it ingests one previously produced content-free governance-index trend, re-validates its self-consistency, and translates its verdict into one bounded operator follow-up plan + next-action checklist — but it NEVER signs, approves, publishes, promotes, deploys, or notifies anything, it authorizes and proves nothing, and it attests no person's identity; it TRANSLATES the trend's already content-free verdict into a bounded follow-up posture. It is explicitly NOT a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log — keep each of those in its own dedicated system; its re-derivation is tamper-evidence over content-free data, not a cryptographic signature (there is no signing key and no attested identity, and a fully self-consistent fabricated trend is out of its scope). The committed CI example lives at `docs/examples/deployment/github-actions/release-decision-closeout-governance-action-plan-fixture.yml`; example governance-index trend inputs live under `docs/examples/release-decision-closeout-governance-action-plan/`.

- **`pnpm worker:release-decision-closeout-governance-action-receipt`** (`src/lib/workers/release-decision-closeout-governance-action-receipt/`) ingests ONE `pdfxyz.release-decision-closeout-governance-action-plan/1` plan (Phase 72; `--plan`/`--file`, or `--stdin`) plus bounded operator acknowledgement flags, RE-VALIDATES it against itself (reconstructing its Phase 72 bounded decision from the source-trend details the plan recorded and re-running the Phase 72 `computeGovernanceActionPlan` reducer — so a hand-flipped plan verdict / action class / exit code is caught as a tamper), folds the plan's coarse CLASS (`clear`/`investigate`/`monitor`/`block`) against the acknowledgements it requires, and emits one `pdfxyz.release-decision-closeout-governance-action-receipt/1` record: a receipt verdict (`completed`/`incomplete`/`followup-open`/`blocked` on the ladder `0`/`2`/`3`/`4`), the resolved plan class, a bounded acknowledgement checklist (required / supplied / missing / contradictory), bounded reasons, and a content-free receipt. It FAILS CLOSED: a `completed` receipt REQUIRES a usable plan AND its class's required acknowledgements (`--ack-plan` for every class, plus `--ack-executed` + a class ack — `--ack-monitor` / `--ack-investigation` / `--ack-block` — for the rest); a missing / unreadable / tampered plan, a `block` plan not acknowledged as held-blocked, a contradictory acknowledgement, or a `--strict-open` escalation is `blocked` (exit 4); a missing required acknowledgement for a `clear` / `investigate` plan is `incomplete` (exit 2); a `monitor` plan reviewed but whose follow-up is still open / not fully executed is `followup-open` (exit 3). The acknowledgements are BOOLEANS ONLY — no free-form note or actor name. Emits `worker_release_decision_closeout_governance_action_receipt_total{verdict}`.

- **`pnpm worker:release-decision-closeout-governance-finalize`** (`src/lib/workers/release-decision-closeout-governance-finalize/`) composes a REQUIRED `pdfxyz.release-decision-closeout-governance-action-receipt/1` primary receipt (Phase 73; `--receipt`/`--file`, or `--stdin`) plus, optionally, the related records it was built from (`--plan` a `…-governance-action-plan/1`, `--trend` a `…-governance-index-trend/1`, `--index` a `…-governance-index/1`, `--governance` a `…-governance/1`), RE-VALIDATES each against itself (reconstructing the receipt's Phase 73 decision from the source facets it recorded and re-running the Phase 73 `computeReceipt`, and re-running each related record through the tested Phase 69–72 boundary that already consumes it — so a hand-flipped verdict / ack coverage / exit code is caught as a tamper), CROSS-CHECKS the supplied plan / trend against what the receipt recorded (a mismatch is a contradiction), folds every supplied source-chain record's own bounded posture, and emits one `pdfxyz.release-decision-closeout-governance-finalize/1` record: a finalization verdict (`finalized`/`finalize-incomplete`/`finalize-open`/`finalize-blocked` on the ladder `0`/`2`/`3`/`4`), a per-source posture, a related-record checklist, an archive checklist, a bounded follow-up assignment list, and a content-free receipt. It FAILS CLOSED: a `finalized` bundle REQUIRES a usable primary receipt whose OWN verdict is `completed` AND every supplied related record coherent; a missing / unreadable primary receipt, a required-but-missing related record (`--require-plan`/`--require-trend`/`--require-index`/`--require-governance`), an `incomplete` receipt, or an inconclusive source chain is `finalize-incomplete` (exit 2); a `followup-open` receipt or an advisory source chain is `finalize-open` (exit 3); a tampered / `blocked` receipt, a contradictory / tampered related record, a blocked source chain, or a `--strict-open` escalation is `finalize-blocked` (exit 4). Emits `worker_release_decision_closeout_governance_finalize_total{verdict}`.
- **`pnpm worker:release-decision-closeout-governance-finalize-index`** (`src/lib/workers/release-decision-closeout-governance-finalize-index/`) indexes a bounded HISTORY of `pdfxyz.release-decision-closeout-governance-finalize/1` finalization bundles (Phase 74; repeated `--finalization`/`--file`, or `--stdin` for a JSON array / NDJSON / single bundle, oldest first / newest last), RE-VALIDATES each against itself (re-deriving its Phase 74 finalization rollup from its own recorded primary-receipt `source` facets + per-kind `related[]` state / signal + policy, mirroring the Phase 74 `computeGovernanceFinalize` reducer — so a hand-flipped finalization verdict / exit / rollup, or a flipped cross-check / posture signal, is caught as a tamper), and folds their verdicts into one `pdfxyz.release-decision-closeout-governance-finalize-index/1` record: an index verdict (`indexed`/`index-open`/`index-incomplete`/`index-blocked`/`index-invalid` on the ladder `0`/`3`/`2`/`4`/`4`), a coverage summary (supplied / considered / usable / unreadable / tampered / dropped), the finalization-verdict distribution, a bounded summary of the newest usable finalization, a per-record posture sequence, bounded reasons, and an ordered next-action checklist. It is LATEST-FOCUSED and FAILS CLOSED: any tampered OR unreadable bundle is `index-invalid` (the TOP precedence — an untrustworthy input is never counted as usable); a `finalize-blocked` latest / any blocked bundle, or a `--strict-open` escalation, is `index-blocked`; a `finalize-incomplete` latest / `--max-incomplete` breach, a `--require-latest-finalized` miss, or zero usable bundles is `index-incomplete`; a `finalize-open` latest / `--max-open` breach is `index-open`; a coherent finalized history is `indexed`. `--max-finalizations=N` (default 26, hard max 104) caps the newest N bundles and surfaces the dropped count. Emits `worker_release_decision_closeout_governance_finalize_index_total{verdict}`.

- **`pnpm worker:release-decision-closeout-governance-finalize-index-trend`** (`src/lib/workers/release-decision-closeout-governance-finalize-index-trend/`) summarizes a bounded HISTORY of `pdfxyz.release-decision-closeout-governance-finalize-index/1` finalize-index windows (Phase 75; repeated `--index`/`--file`, or `--stdin` for a JSON array / NDJSON / single window, oldest first / newest last), RE-VALIDATES each against itself (re-deriving its Phase 75 index verdict from its own recorded coverage + distribution + policy, mirroring the Phase 75 `computeFinalizeIndexRollup` reducer, AND re-checking those counts against the window's own per-record sequence + window arithmetic — so a hand-flipped index verdict, or a lied count consistent with it, is caught as a tamper), and folds their verdicts into one `pdfxyz.release-decision-closeout-governance-finalize-index-trend/1` record: a trend verdict (`improving`/`stable`/`watch`/`degrading`/`insufficient`/`blocked`/`invalid` on the ladder `0`/`0`/`3`/`3`/`2`/`4`/`4`), a coverage summary (supplied / considered / usable / unreadable / tampered / dropped), the per-window index-verdict distribution, the aggregate finalization distribution, a bounded summary of the newest usable window, a per-window posture sequence, an arc direction (`improving`/`stable`/`degrading`/`mixed`/`unknown`) + trend class (`clean`/`recovering`/`regressing`/`blocked`/`insufficient`/`invalid`), bounded reasons, and an ordered next-action list. It is LATEST-FOCUSED and FAILS CLOSED: any tampered OR unreadable window is `invalid` (the TOP precedence — an untrustworthy input is never counted as usable); an `index-blocked` / `index-invalid` usable window, or a `--strict-open` escalation, is `blocked`; zero usable windows, an `index-incomplete` latest, or an only-incomplete history is `insufficient`; an `index-open` latest or a degrading arc is `degrading`; an older open / incomplete under a clean latest is `watch`; a recovering arc to a clean latest is `improving`; a coherent all-`indexed` history is `stable`. `--max-windows=N` (default 26, hard max 104) caps the newest N windows and surfaces the dropped count; `--require-latest-indexed` demands an `indexed` latest. Emits `worker_release_decision_closeout_governance_finalize_index_trend_total{verdict}`.
- **`pnpm worker:release-decision-closeout-governance-finalize-index-trend-action-plan`** (`src/lib/workers/release-decision-closeout-governance-finalize-index-trend-action-plan/`) ingests ONE `pdfxyz.release-decision-closeout-governance-finalize-index-trend/1` trend (Phase 76; `--trend`/`--file`, or `--stdin`), RE-VALIDATES it against itself (reconstructing its OWN summary from its recorded coverage + window distribution + arc blocks, re-deriving its Phase 76 verdict via `computeTrendRollup`, AND re-checking that summary against the trend's own per-window posture sequence + window arithmetic — so a hand-flipped trend verdict, or a lied distribution consistent with it, is caught as a tamper), and translates its bounded verdict into one `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-plan/1` operator follow-up plan: a plan verdict (`clear`/`monitor`/`investigate`/`block-release`/`invalid` on the ladder `0`/`3`/`2`/`4`/`4`), an urgency (`routine`/`soon`/`high`/`immediate`), an action class, the surfaced source trend verdict / class / arc / latest finalize-index posture, an ordered next-action checklist (`plan`) + a compact `nextActions` id list, bounded reasons, and a content-free receipt. It FAILS CLOSED: an unreadable / tampered trend INPUT is `invalid` (the TOP precedence, never weakened by a policy knob); a `blocked` or `invalid`-history trend is `block-release`; an `insufficient` trend is `investigate`; a `watch` / `degrading` trend is `monitor`; a `stable` / `improving` trend is `clear`. `--strict-watch` escalates a `monitor` plan to `block-release`; `--require-clean` escalates every non-clear plan to `block-release`. Emits `worker_release_decision_closeout_governance_finalize_index_trend_action_plan_total{verdict}`.

The closeout governance action-plan execution receipt is a content-free operational EXECUTION RECEIPT: it ingests one previously produced content-free governance plan plus bounded acknowledgement flags and re-validates the plan's self-consistency — but it NEVER signs, approves, publishes, promotes, deploys, or notifies anything, it authorizes and proves nothing, and it attests no person's identity; it RECORDS whether the plan's bounded follow-ups were acknowledged / executed. It is explicitly NOT a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log — keep each of those in its own dedicated system; its re-derivation is tamper-evidence over content-free data, not a cryptographic signature (there is no signing key and no attested identity, and a fully self-consistent fabricated plan is out of its scope). The committed CI example lives at `docs/examples/deployment/github-actions/release-decision-closeout-governance-action-receipt-fixture.yml`; example governance-action-plan inputs live under `docs/examples/release-decision-closeout-governance-action-receipt/`.

The closeout governance finalization bundle is a content-free operational GOVERNANCE FINALIZATION bundle: it composes previously produced content-free governance-chain records and re-validates each one's self-consistency + chain coherence — but it NEVER signs, approves, publishes, promotes, deploys, or notifies anything, it authorizes and proves nothing, and it attests no person's identity; it RECORDS whether the chain reads as coherently finalized. It is explicitly NOT a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log — keep each of those in its own dedicated system; its re-derivation + cross-checks are tamper-evidence over content-free data, not a cryptographic signature (there is no signing key and no attested identity, and a fully self-consistent fabricated record is out of its scope). The committed CI example lives at `docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-fixture.yml`; example primary-receipt + related-record inputs live under `docs/examples/release-decision-closeout-governance-finalize/`.

The closeout governance finalize index is a content-free operational finalization-history INDEX SUMMARY: it ingests a bounded history of previously produced content-free finalization bundles and re-validates each one's self-consistency — but it NEVER signs, approves, publishes, promotes, deploys, or notifies anything, it runs no gate / index / decision / trend / plan / receipt / closeout / governance / finalize itself, it authorizes and proves nothing, and it attests no person's identity; it RECORDS whether the recent finalization history reads as consistently finalized. It is explicitly NOT a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log — keep each of those in its own dedicated system; its re-derivation is tamper-evidence over content-free data, not a cryptographic signature (there is no signing key and no attested identity, and a set of fully self-consistent fabricated records is out of its scope). The committed CI example lives at `docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-fixture.yml`; example finalization-bundle inputs live under `docs/examples/release-decision-closeout-governance-finalize-index/`.

The closeout governance finalize index trend is a content-free operational finalization-index TREND SUMMARY: it ingests a bounded history of previously produced content-free finalize-index windows and re-validates each one's self-consistency — but it NEVER signs, approves, publishes, promotes, deploys, or notifies anything, it runs no gate / index / decision / trend / plan / receipt / closeout / governance / finalize itself, it authorizes and proves nothing, and it attests no person's identity; it RECORDS whether the recent finalization-index history is improving, stable, watch-worthy, degrading, insufficient, blocked, or untrustworthy. It is explicitly NOT a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log — keep each of those in its own dedicated system; its re-derivation is tamper-evidence over content-free data, not a cryptographic signature (there is no signing key and no attested identity, and a set of fully self-consistent fabricated windows is out of its scope). The committed CI example lives at `docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-fixture.yml`; example finalize-index-window inputs live under `docs/examples/release-decision-closeout-governance-finalize-index-trend/`.

The closeout governance finalize index trend action plan is a content-free operational FOLLOW-UP PLAN: it ingests ONE previously produced content-free finalize-index trend and re-validates its self-consistency — but it NEVER signs, approves, publishes, promotes, deploys, or notifies anything, it runs no gate / index / decision / trend / finalize / governance / closeout itself, it authorizes and proves nothing, and it attests no person's identity; it TRANSLATES the trend's bounded verdict into a bounded operator follow-up plan + urgency + next-action checklist, and RECOMMENDS what to do next (it never claims an action was executed). It is explicitly NOT a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log — keep each of those in its own dedicated system; its re-derivation is tamper-evidence over content-free data, not a cryptographic signature (there is no signing key and no attested identity, and a fully self-consistent fabricated trend is out of its scope). The committed CI example lives at `docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-action-plan-fixture.yml`; example finalize-index-trend inputs live under `docs/examples/release-decision-closeout-governance-finalize-index-trend-action-plan/`.
