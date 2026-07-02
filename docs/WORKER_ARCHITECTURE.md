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
- **Separation of concerns.** This worker is deliberately distinct from the in-browser Compress analyzer (`src/lib/pdf/analyze.ts`), which only ever does lossless work on-device and never uploads.

To try it locally: run `PDFXYZ_WORKER_MODE=local-dev pnpm dev`, `POST /api/uploads` for `compress-pdf`, `PUT` the file to the returned slot URL, then `POST /api/jobs`. With no native engine installed a `deep` job fails honestly; a `{ "profile": "lossless" }` job completes with a real, smaller PDF and a working download URL.

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

- input TTL: 60 minutes maximum
- output TTL: 60 minutes maximum
- `persistsAfterJob: false`

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

**Phase 7 progress toward this:** the local-dev worker already covers upload-session creation, upload transport, job creation, status polling, output download, retention/expiry, and tests for validation + job states + a real happy-path processor (lossless). Remaining for production: direct-to-object-storage upload, a real queue, signed URLs, lifecycle-enforced deletion, and a native `deep` processor behind the same adapter contract.
