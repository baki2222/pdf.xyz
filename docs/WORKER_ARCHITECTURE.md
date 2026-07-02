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
| Production processors / queues / storage | Planned, not enabled |

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
  "options": { "language": "eng" },
  "idempotencyKey": "ocr:scan:1"
}
```

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

### `GET /api/worker/status`

Presence-only capability probe for the client. Returns `{ mode, enabled, localDevOnly, detail, compress: { lossless, deep, engines } }`. It never reads or returns a secret — `engines` lists installed native binaries by *name* only. `no-store`; reflects live host state. See "Discovering worker availability from the client" above.

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

Live in-browser tools do not call these endpoints.

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

**Phase 7 progress toward this:** the local-dev worker already covers upload-session creation, upload transport, job creation, status polling, output download, post-job input wipe + retention/expiry, a presence-only client capability probe, an honest Compress UI integration, and tests for validation + job states + transport routes + a real happy-path processor (lossless) end-to-end through the route handlers. Remaining for production: direct-to-object-storage upload, a real queue, signed URLs, lifecycle-enforced deletion, an explicit signed "delete now", and a native `deep` processor behind the same adapter contract.
