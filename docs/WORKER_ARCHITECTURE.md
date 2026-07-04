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
- **Guarded downloads (Phase 38).** Every fetch flows through the pure retrieval-access layer (`src/lib/workers/artifacts/access.ts`) before a byte is streamed. It validates the opaque handle shape, has the store report the artifact's lifecycle (`live`/`expired`/`deleted`/`absent` — a bounded delete tombstone distinguishes an explicit delete from an unknown handle), confirms the owning job completed, and — when the manifest gate recorded a content-free provenance manifest at publish (the shipped default) — re-validates that manifest against the actual bytes (recognized downloadable kind, coherent content-type, resolved retention class, matching byte count). A pass streams the bytes with safe, deterministic, **generated** headers: a canonical `Content-Type`, an `attachment` `Content-Disposition` whose filename is generated from the output kind/tool (never the stored/user name), `Content-Length`, `Cache-Control: private, no-store`, and `X-Content-Type-Options: nosniff`. A failure returns one of a closed set of content-free reasons (`malformed_handle`, `storage_unavailable`, `policy_unavailable`, `not_found`, `deleted`, `not_ready`, `expired`, `job_mismatch`, `missing_manifest`, `invalid_manifest`, `unsupported_kind`, `empty_artifact`) mapped to a safe status (`expired`/`deleted` → `410 gone`; `not_found`/`missing_manifest` → `404`; fail-closed infra → `503`) and no bytes. Every decision also derives a content-free retrieval receipt + metric (`retrieval-receipt.ts` / `retrieval-metrics.ts`), both emitted through OPTIONAL sinks that default to none. It is a bounded structural + lifecycle check only — **not authentication, not authorization**, malware scanning, sanitization, or a deletion proof: possession of the unguessable opaque handle is the capability, and the optional `?job=` binding is a caller-opted integrity cross-check (a false claim is `job_mismatch`/`403`), never access control. This local-dev route does not run in production — its storage-backed counterpart does (below).
- **Storage-backed retrieval (Phase 39).** The Phase 38 access layer is generalized behind a tiny `ArtifactRetrievalBackend` seam (`src/lib/workers/artifacts/retrieval.ts`): `capability()` reports the key-free storage readiness and `fetch(id)` resolves an opaque handle to a lifecycle-tagged `ArtifactRetrievalResult`, which a pure `decideRetrieval` folds onto the SAME `decideArtifactAccess` policy — so local-dev and storage-backed artifacts get byte-identical checks, headers, and denials. Two backends implement the seam: the developer store (`retrieval-local.ts`) and a **server-side bucket reader** (`retrieval-storage.ts`) that signs a short-lived GET, reads the artifact's bytes itself, and recovers the content-free manifest from signed object metadata (`x-amz-meta-artifact-manifest`) — no side table. The production route `GET /api/artifacts/:artifactId` (active only when object storage is configured) and the local-dev route both delegate to one shared helper (`src/app/api/artifacts/_lib/serve.ts`). Crucially the bytes are **proxied/streamed through this app server**, never a redirect: no signed object-store URL, bucket, key, endpoint, region, or signature is ever exposed to the client. A transient bucket read failure (5xx/network) is a retryable `storage_error` → `503 service_unavailable` (distinct from a not-configured `storage_unavailable`, also `503`); a bucket `404` is an honest `not_found`. When storage is absent/half-configured the backend is not `ready`, so the boundary denies `storage_unavailable` before any read — the honest no-config posture, no fake stream. The retrieval receipt + metric carry a bounded `provider` label (`local-dev`/`remote-configured`/`not-configured`), never a bucket name. A CDN or private-bucket access policy is **out of band** and not claimed here.
- **Delivery hardening (Phase 40).** After the access layer grants a handle and generates its headers, the same shared serve helper runs a second, pure gate (`src/lib/workers/artifacts/delivery.ts`, `decideDelivery`) over the byte delivery itself — so both routes are byte-identical here too. It verifies the emitted `Content-Length` against both the actual bytes and any upstream-provider-declared length (the bucket's `Content-Length`, parsed to a bounded count) so a truncated/over-declared object is refused, not streamed under a lying header; enforces a hard, fixed **1 GiB delivery ceiling** (a defensive backstop for the opt-in publish-time size cap); answers `HEAD` with the verified headers and **no body**; and takes an honest `Range` posture — this proxy serves whole buffered objects only, so it advertises `Accept-Ranges: none` and **ignores** a `Range` header (whole-file `200`), never a `206`/`416` or any resumable claim. The routes wire only `GET`/`HEAD`; every other verb gets a content-free `405` (no body) from the framework (which also auto-answers `OPTIONS` `204` + `Allow: GET, HEAD, OPTIONS`). Every delivery denial (`size_mismatch`/`oversize`/`stream_error`) folds to one content-free `503 service_unavailable`, and the whole path is wrapped so any unexpected error (a backend that threw, a body that could not be built) becomes that safe `503` — never a framework `500` with a stack, never a provider message, key, or URL. A parallel content-free `worker_artifact_delivery_total` metric + delivery receipt (receipt adds the bounded `method`/`range`) observe the second gate through the same default-off sinks. This is a byte-consistency + method/range safety check only — **not** authentication, resumable serving, or content scanning.
- **Storage-backed lifecycle/expiry enforcement (Phase 41).** A bucket cannot tell a live object from an expired-but-not-yet-reaped one — both answer a GET `200` until the bucket's lifecycle rule physically deletes the object, and lifecycle deletion is best-effort and coarse (often a daily sweep). Phase 39/40 therefore always served the `200`. Phase 41 closes that window for storage-backed retrieval: the worker signs the artifact's retention window as content-free object metadata (`x-amz-meta-artifact-lifecycle`, `storage/s3-lifecycle-metadata.ts` — the SAME `expiresAt` instant the client already holds, plus an optional deletion-tombstone marker the boundary honors but the shipped flow never writes), and the storage reader (`retrieval-storage.ts`) decodes that evidence and evaluates it against its clock (`artifacts/lifecycle.ts`, `evaluateArtifactLifecycle` → `live`/`expired`/`deleted`/`unknown`) **before the body is read** — so a logically-expired or tombstoned object is denied `410 Gone` and its bytes are never even buffered, mapping through the existing `expired`/`deleted` retrieval lifecycle (Phase 38's `410`). This is **app-level** enforcement, distinct from and additional to the bucket lifecycle deletion backstop. Honesty holds at the edges: an object with **no** usable evidence (a legacy object written before this phase, or storage that strips user-metadata) is `unknown` → served as before (never a fabricated deletion), with the bucket lifecycle rule as the eventual backstop surfacing as an honest `404`/`absent`; and an unreadable clock never fabricates `expired`. It is **not** proof the bytes were deleted (that stays the bucket's job and is honestly indistinguishable from never-existed once the object is gone) and **not** a claim about the bucket lifecycle policy's correctness (the app never inspects the bucket). A content-free `worker_artifact_expiry_total{state,provider}` metric + per-read drift receipt (`artifacts/expiry-metrics.ts` → `expiry-receipt.ts`, same default-off sink pattern) surface how often the bucket serves an object the app already considers gone (`state=expired`/`deleted` = lifecycle drift) versus one with no evidence (`state=unknown`). Local-dev keeps its in-process tombstones unchanged.
- **Storage-artifact cleanup verification (Phase 42).** Phase 41 *denies* an expired/tombstoned artifact at retrieval, but an app-level denial is not proof object storage *deleted the bytes* — the object can sit in the bucket answering a raw GET `200` until the executor's active delete-now removes it or the bucket lifecycle rule reaps it. Phase 42 adds a pure, offline **cleanup verifier** (`src/lib/workers/cleanup/`, CLI `pnpm worker:cleanup-check`) that proves, from CONTENT-FREE evidence an operator exports out-of-band (the app never calls the cloud, mirroring `--lifecycle-verify`), whether artifacts that should be gone are actually absent. It distinguishes the **four cleanup mechanisms the codebase deliberately keeps separate**: (1) *retrieval-time denial* (Phase 41 — access denied, bytes may remain); (2) *active app deletion* (the executor's delete-now → a `404`, attributed via a delete receipt → `absent-active`); (3) *bucket lifecycle backstop* (the reap → a `404` with no delete receipt → `absent-backstop`); (4) *cleanup verification* itself — this tool. Each evidence object (`{ presence: present|absent|error, expiresAtMs?, deleted?, activeDelete? }`) is re-evaluated through the SAME Phase 41 `evaluateArtifactLifecycle`, then classified to one bounded per-object state (`absent-active`/`absent-backstop`/`retrieval-denied`/`drift`/`live`/`unknown`/`unavailable`) and folded to one verdict — `verified` (every should-be-gone object confirmed absent), `drift` (still present past its retention window + a reap grace, default 48h), `unknown` (present-but-denied awaiting reap, no evidence, or nothing to verify), `unavailable` (a probe failed), or `not-configured`. Honesty is load-bearing: **absence is the only proof of cleanup** — a present-but-denied object is reported as cleanup *pending*, never fabricated into "deleted", so only a confirmed `404` yields `verified`; an unreadable clock or a tombstone with no deadline falls toward `retrieval-denied`, never a fabricated `drift`; and a `not-configured` provider short-circuits without inspecting evidence. It reads no bytes and it NEVER deletes — actual object deletion stays operator-owned and out of band. A content-free `worker_cleanup_verification_total{verdict,provider}` metric + a per-run receipt (default-off sinks) make the verdict observable. Exit codes map to the ops ladder (`0` verified / `1` usage / `2` unknown·unavailable·not-configured / `3` drift). Local-dev, storage-backed, and no-config behavior — and the Phase 41 retrieval-denial path — are unchanged.
- **Storage-artifact cleanup dry-run sweeper (Phase 42).** The complementary lens to the verifier above, and the piece that answers "what PRESENT objects should be swept?". Where the verifier evaluates a probe set of should-be-gone objects, the sweeper (`src/lib/workers/artifacts/cleanup/`, CLI `pnpm worker:artifact-cleanup`) evaluates an offline, content-free **inventory** of present object metadata (a projection of `aws s3api list-objects-v2` + `head-object`: bounded lifecycle/manifest/provider/kind enums + the decoded `{expiresAtMs,deleted}` evidence + coarse age/size buckets, never keys/names/bytes). It classifies each object into ONE bounded category by a deterministic precedence — `invalid-record`/`deleted-but-present` (breach) → `expired-but-present` (drift) → `storage-unavailable`/`missing-lifecycle`/`missing-manifest`/`unsupported-kind` (unknown) → `ok` — and folds the set to a verdict (`ok`/`unknown`/`drift`/`breach`) plus a content-free dry-run **plan** (a count + action per category: `retain`/`investigate`/`review`/`delete`). Lifecycle is re-derived through the SAME Phase 41 `evaluateArtifactLifecycle`, and a severity is escalated ONLY on positive evidence (a tombstone or a passed deadline) — absent/incomplete evidence stays `unknown`, never a fabricated cleanup recommendation, so a confident `ok` requires complete healthy metadata. It is a pure, node-free, CLOCK-injected leaf; it lists no real bucket and NEVER deletes. A content-free `worker_artifact_cleanup_total{category,severity}` metric + a per-run receipt (default-off sinks) make the sweep observable; exit codes are `0` clean / `1` usage / `2` unknown / `3` cleanup-recommended / `4` invalid·breached. Reading no bytes, it inherently upholds the Phase 41 "decide from metadata before any byte access" invariant.
- **Storage-artifact cleanup evidence exporter / projector (Phase 43).** The safe **input-side** bridge into the two Phase 42 tools. Those tools consume content-free documents, but building one from a raw provider capture was a manual redaction step; the projector (`src/lib/workers/cleanup/project/`, CLI `pnpm worker:cleanup-project`) automates it. It reads an operator's own out-of-band RAW export — an `aws s3api list-objects-v2` / `head-object` capture (native `Contents`/`ContentType`/`Metadata`/`LastModified` field names) or an already-normalized `generic` dump — and projects it into a bounded `--target=evidence` document (`{presence,expiresAtMs?,deleted?,activeDelete?}` for `worker:cleanup-check`) or `--target=inventory` document (bounded lifecycle/manifest/provider/kind enums + coarse age/size for `worker:artifact-cleanup`), keyed exactly as the downstream parser reads it so it pipes straight in. The transform is a privacy seam: it reads ONLY a bounded ALLOWLIST of fields off each raw object and emits ONLY bounded enums, coarse buckets, and the decoded `{expiresAtMs,deleted}` retention facts — decoding lifecycle/manifest blobs through the SAME strict codecs the retrieval boundary uses (a tampered blob collapses to "no evidence"), resolving presence from a status/`Error.Code`/`DeleteMarker` hint, mapping a content-type to a kind, and bucketing a raw `LastModified`/`ContentLength` then discarding it. Every other field is never read, so no object key, bucket, URL, endpoint, region, id, ETag, filename, or user-metadata can survive; dropped fields are tallied by a NAME-derived category (`locator`/`url`/`identity`/`integrity`/`metadata-blob`/`other`) for the embedded content-free receipt, their values never touched. It folds a run to a verdict — `projected` (usable records, no unsafe signal), `insufficient` (a metadata-thin export — honest "not enough to project"), or `unsafe` (a present-but-tombstoned object, or a structurally-invalid non-object entry, dropped never passed through) — with the exit ladder `0`/`1` usage/`2`/`4`. A content-free `worker_cleanup_projection_total{target,verdict}` metric + the per-run receipt (default-off sinks) make it observable. It is a pure, node-free leaf that makes NO cloud call, needs NO credentials, and deletes NOTHING — a redaction/normalization helper, explicitly **not** proof of deletion and **not** a cloud scanner.
- **Storage-artifact cleanup evidence operations integration (Phase 44).** Phases 42–43 shipped three offline tools; Phase 44 makes the cleanup evidence workflow easier and safer to *operate*, in two complementary halves that add no new cloud call, credential, or deletion. (1) A one-command **pipeline** (`src/lib/workers/cleanup/pipeline/`, CLI `pnpm worker:cleanup-pipeline`) composes the three tools: it reads a raw provider export **once**, projects it into both bounded shapes, and runs the absence verifier (`--target=evidence` → `runCleanupCheck`) and the dry-run sweeper (`--target=inventory` → `runArtifactCleanup`) in-process, then rolls the two arms' documented exit codes into ONE composite code by a **worst-wins** rule (`0` ok / `1` usage / `2` unknown / `3` drift / `4` breach). It is a node-free orchestrator over injected stage seams (so every branch is unit-tested without a spawn), and it **fails closed**: a bad flag or an unreadable/malformed export is a NON-ZERO `usage` result (fixing the Phase 43 scheduler notifier's fail-open, where a `usage` could fold to a silent `0`), a failed projection short-circuits its arm to the projection's own verdict rather than feeding untrusted evidence to a lens, and the raw export is projected away before either arm runs so no locator/identifier can reach the rolled-up document, its receipt, or a log. A content-free `worker_cleanup_pipeline_total{arm,severity}` metric + a per-run rolled-up receipt (default-off sinks) make the composite observable; the projector/verifier arms also emit their own `worker_cleanup_projection_total`/`worker_cleanup_verification_total` as they run. (2) A passive **posture monitor** (`src/lib/workers/cleanup-evidence/`) closes the ops loop the other direction: it reads the content-free report SUMMARIES a scheduled cleanup-check / artifact-cleanup job already wrote (via `PDFXYZ_CLEANUP_EVIDENCE_CHECK_REPORT` / `_SWEEP_REPORT`), applies a freshness threshold (default 26h), and folds them into a bounded ops **posture** (`disabled`/`healthy`/`stale`/`warning`/`critical`/`unknown`/`not-configured`/`invalid`) with a bounded reason, for the `/status` surface and `worker:ops-check`. It is a strict trust boundary — it accepts only recognized `pdfxyz.cleanup-check/1` / `pdfxyz.artifact-cleanup/1` summaries and REFUSES a raw evidence/inventory/provider export (a misconfiguration → `invalid`), never fabricates freshness from missing/stale evidence (→ `stale`, never a false OK), and surfaces the report's own paths ONLY to open the files, never into the posture, output, or a log. A content-free `worker_cleanup_evidence_posture{state,reason,provider}` gauge makes it observable; monitoring is `disabled` until a report path is configured. Both halves are pure/node-free at their core (the monitor's one `node:fs` seam lives in `./read`, so a route or CLI can import the node-free surface without pulling the filesystem), fake-tested (injected stages/env/clock, spy sinks, spawned-CLI smokes, hostile-input no-leak tests), and explicitly **not** deletion, authentication, malware/cloud scanning, byte-integrity, or a bucket-lifecycle-correctness claim. Deletion stays operator-owned and out of band. The Phase 41/42/43 tools, local-dev/storage-backed downloads, and the no-config posture are unchanged.
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
| Processor | `src/lib/workers/processor/` + `executor/` | processor registry + the execution loop that claims a job, reads inputs, dispatches a processor, and drives status | local-dev in-process + a unit-tested executor/daemon foundation; production worker image/daemon artifacts are shipped but deployment remains operator-owned |
| Operations observability | `src/lib/workers/observability/`, `src/lib/workers/heartbeat/`, `src/lib/workers/ops-check/`, `/api/worker/operations`, `src/components/status/operations-*.tsx` | content-free health/SLO snapshot, bounded metrics, optional provider-backed daemon heartbeat, one recommended next action, operator dashboard on `/status`, and an offline alert-evaluation CLI | **Phase 28 shipped** the snapshot/metrics; **Phase 29 shipped** the `/status` operator dashboard; **Phase 30 shipped** optional Redis-backed worker heartbeat liveness; **Phase 31 shipped** the `pnpm worker:ops-check` operator healthcheck — a pure alert policy over the snapshot (+ optional SLO window) that a cron/monitor/supervisor keys on, with a documented exit code and the same content-free posture attached to `/api/worker/operations` and rendered on `/status`. Web vantage reports `daemonObserved:true` only for a fresh heartbeat; disabled/stale/absent states never fake liveness and render client-authored copy only. |

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
for at-least-once redelivery instead of a false "gone". As of Phase 39 each artifact's
`JobArtifact.url` is this app's **opaque retrieval route** (`/api/artifacts/:id`), never a
signed object-store link: the route reads the bytes from the bucket server-side and streams
them through the guarded access boundary, so no bucket/key/signature reaches the client, and
`expiresAt` is the artifact's retention/lifecycle-deletion window (matching the local path),
not a signed-link TTL. The content-free provenance manifest is stamped as signed object
metadata (`x-amz-meta-artifact-manifest`) on the PUT so retrieval can re-validate it. Object
keys derive only from opaque ids — shared with the app provider (`storage/s3-keys.ts`) so the
worker's artifact key always matches the retrieval reader's key. Phase 18 adds a
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

`PUT /api/uploads/local/:fileId` and `GET /api/artifacts/local/:artifactId` are the developer transport that stands in for pre-signed object storage. They are **inert (`503 worker_not_configured`)** unless `PDFXYZ_WORKER_MODE=local-dev` is set. In production, **uploads** still go directly to the encrypted bucket via a signed, expiring PUT (bytes never touch the app server on the way in). **Outputs**, since Phase 39, are served *through* this app server by the storage-backed retrieval route (`GET /api/artifacts/:artifactId`), which reads the artifact bytes from the bucket server-side and streams them through the guarded access boundary — so the client never receives a signed object-store URL and no bucket/key/endpoint/signature is ever exposed.

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

## Operator healthcheck & alert evaluation (Phase 31)

Phase 31 closes the loop from "we emit content-free health data" to "a monitor can act
on it" — **without** a metrics backend or a pager. It has two pure, node-free halves and
a thin CLI shell, mirroring the daemon's own structure:

- **Alert policy** (`src/lib/workers/observability/alerts.ts`). `evaluateOperationsAlerts`
  maps a `WorkerOperationsSnapshot` (+ an optional `SloReport`) onto bounded
  **severities** (`ok`/`warn`/`critical`/`unknown`), **reasons**, and **actions**, all
  fixed enums with fixed, content-free copy authored in code. It re-uses the snapshot's
  own single `recommendedAction` as the report headline and fans the subsystems + SLO
  indicators + heartbeat verdict out into individual alerts, worst-first. It adds nothing
  that is not a bounded enum, so it never echoes a snapshot string.
- **CLI library** (`src/lib/workers/ops-check/`). `args.ts` parses flags; `collect.ts`
  composes the daemon's own runtime evidence (with heartbeat-driven, never self-asserted
  liveness — the honest `collectOperatorProbeSnapshot` web-liveness vantage); `ingest.ts`
  is the trust boundary that validates + **re-authors** a monitor-supplied snapshot (a
  bare snapshot, the `GET /api/worker/operations` body, or `{ operations, metrics }`),
  dropping any unrecognized field so an injected filename/key/secret can never survive;
  `render.ts` emits the stable `OpsCheckResult` (`schema: "pdfxyz.ops-check/1"`) as JSON,
  Prometheus gauges, or text; `run.ts` is the orchestrator over injected seams.
- **Node entry** (`scripts/worker-ops-check.ts`, `pnpm worker:ops-check`). A thin shell
  that reads argv/env, resolves the runtime, reads stdin/files, writes the output, and
  exits — with no untested behavior of its own (like `worker-daemon.ts`). Never imported
  by the web app.

Exit codes are the monitor contract — `0` ok, `1` usage/malformed, `2` unknown/no-data,
`3` warn, `4` critical — and are **distinct from the daemon's**. The same alert report is
attached to `GET /api/worker/operations` and rendered as the **Alert posture** callout on
`/status` (from bounded enums → client-authored copy, never a server string). What stays
out-of-band: a hosted timeseries store, the scheduler that runs the check, and the pager
that reacts to it. See [`OBSERVABILITY.md`](OBSERVABILITY.md#operator-healthcheck--alert-evaluation-phase-31).

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

### 6. Rate limits & the abuse guard

Abuse limits are part of the contract (`RATE_LIMITS` in `src/lib/jobs/types.ts`).
The **primary** enforcement point is, and remains, the edge/gateway (CDN / WAF /
API gateway) in front of the app — that is the only layer that can enforce a
global budget across every instance. The published per-client budgets:

- Upload sessions: **60 / hour / client**.
- Job creation: **60 / hour / client**.
- Status polling: **120 / minute / client** (polling is expected; keep it cheap).

Exceeding a limit returns `429 rate_limited` with a `Retry-After` header plus the
standard `RateLimit-*` trio (`RateLimit-Limit` = the policy budget,
`RateLimit-Remaining` = `0` on a deny, `RateLimit-Reset` = the same delta-seconds).
Every header value derives only from the policy and the clock — never the caller —
so a well-behaved client can self-throttle without any identifying detail crossing
the wire. Per-tool concurrency is additionally capped by the queue (section 3).
Static file limits (`JOB_LIMITS`) — 100 MB/file, 500 MB/session, 20 files — are
validated before any byte is uploaded.

#### In-app abuse guard (Phase 33, `src/lib/ratelimit`)

The app also ships a small, honest **in-app abuse guard** as defense-in-depth
behind the edge. It is a thin seam with typed per-action policies for every
public API route (`uploads.create`, `jobs.create`, `jobs.status`, `jobs.delete`,
`artifacts.fetch`, `worker.status`, `worker.operations`), a pluggable provider,
and a **content-free** decision output.

**It is disabled by default and fails open.** With no provider configured the
guard allows every request and reports `enforced: false`, so the default build,
the e2e suite, and every local-first browser tool behave exactly as before — the
honest "not configured" posture of the rest of the codebase. It is selected with
`PDFXYZ_RATE_LIMIT_PROVIDER`:

| Value | Behavior |
| --- | --- |
| unset / `disabled` | No enforcement. Every request allowed, `enforced: false`. |
| `local-memory` | The per-process in-memory limiter. Real, but **not distributed** (see caveat). |
| `redis` / `remote` / `edge` / `waf` / … | Selects a remote backend. If a deployment has registered one via `registerRateLimitProvider` (see below), the guard delegates to it and reports `provider: "remote"`, `enforced: true`. This build registers **none** by default, so the selection resolves to `remote-unimplemented` and **skips honestly** (allow, `enforced: false`) — it never fakes distributed enforcement. |

The remote backend is a **registration seam**, not a shipped client. A deployment
implements the async `RateLimitProvider` interface (`src/lib/ratelimit/provider.ts`)
over a real shared store (e.g. a Redis/Upstash-compatible client) and calls
`registerRateLimitProvider(...)` once from a Next.js `instrumentation.ts`
`register()` boot hook — no route or guard change needed. The backend is handed
the same opaque, salted-hash bucket token the in-memory limiter uses (never a raw
identity) and returns only a bounded verdict, so it is held to the identical
content-free, no-leak invariant. If it throws (e.g. the store is unreachable) the
guard fails **open** (allow, `enforced: false`), so a limiter outage can never take
the API down.

> **⚠️ Honest boundary — read before a high-traffic launch.** The `local-memory`
> limiter keeps its counters in a single process's heap. Behind N app instances
> each limits independently, so the effective budget is up to **N×** the
> configured number, and a restart resets every window. It is genuinely useful in
> dev/test and as a coarse single-instance backstop, but it is **not** a
> production distributed rate limiter. **Wire a real edge/WAF/rate-limit provider
> before a high-traffic launch** and treat the in-app guard as a secondary layer,
> not the control. To make the in-app guard itself distributed, configure the
> shipped Redis/Upstash backend (Phase 34, below) — no code change needed.

#### Distributed enforcement (Phase 34, `src/lib/ratelimit/redis.ts`)

Phase 34 fills the `remote` seam with a **shipped, production-grade distributed
provider** backed by the same node-free Redis/Upstash-REST transport the job queue
and the liveness heartbeat use (`createRedisClient`). Once configured it is
registered automatically from `src/instrumentation.ts` `register()` at server boot —
no route, guard, or code change — and the guard begins reporting `provider: "remote"`,
`enforced: true`: every web replica increments the **same** window counter, so a
policy's budget is shared across the fleet instead of multiplied by the replica count.

- **Atomic fixed-window, never a race-prone get-then-set.** Each check is ONE
  server-side Lua script (`EVAL`): `INCR` the window key, stamp the window TTL exactly
  once on the counter's creation (`PEXPIRE` when `count == 1`), then read the remaining
  TTL (`PTTL`) for the retry-after. Redis runs a script to completion with no
  interleaving, so two replicas incrementing at the same instant can never both read a
  stale count. As with the queue's `redis-scripts.ts`, the Upstash REST transport is
  stateless (each command is an independent HTTP request), so `EVAL` — not
  `WATCH`/`MULTI` — is the primitive that yields a genuine atomic increment over HTTP.
  The script body is a **constant**: the store key travels in `KEYS[1]` and the window
  in `ARGV[1]`; no policy id, key, or token is ever interpolated into the program text.
  Windows self-expire via the TTL, so the store never accumulates limiter keys.

- **Its own web-safe credentials — the web tier never gets a worker secret.** The
  guard runs on the **public web tier** (it is called by the API route handlers), so
  it reads its store from `PDFXYZ_RATE_LIMIT_REDIS_REST_URL` /
  `PDFXYZ_RATE_LIMIT_REDIS_REST_TOKEN` (and optional `PDFXYZ_RATE_LIMIT_KEY_PREFIX`).
  These are deliberately **distinct** from the queue's worker-only `PDFXYZ_REDIS_REST_*`,
  which — by a load-bearing deployment invariant (`deployment-blueprint.test.ts`) — must
  never land on the public web pod. You MAY point them at the same managed instance (same
  values, web-safe names); the limiter namespaces its keys under `{prefix}:ratelimit:…`
  so they never collide with queue keys. The credential *validation* is not duplicated:
  the URL-origin, token, and key-prefix checks are the exact shared primitives the queue
  config exports (`parseRedisRestOrigin`, `isValidRedisRestToken`, `sanitizeRedisKeyPrefix`).

- **Same opaque token, same no-leak invariant.** The provider is handed the same
  salted-hash bucket token the in-memory limiter uses (never a raw IP), composes it into
  a store key, and uses that key ONLY as a Redis key — never logged, returned, or placed
  in a decision. The token is captured in the client closure for the auth header and
  likewise never surfaced.

- **Fail-open by default, or opt-in fail-closed.** A genuine over-limit always returns
  a deliberate deny. On a store *error* (unreachable, non-2xx, command error, malformed
  reply) the provider degrades per `PDFXYZ_RATE_LIMIT_FAIL_MODE`: `open` (the default)
  **throws**, so the guard fails **open** (allow, `enforced: false`) — a limiter-store
  outage can never take the API down; `closed` returns a deliberate deny, so the guard
  answers `429` and sheds load rather than serve unthrottled while the store is down. It
  **never fabricates an allow** from an errored backend, and never fabricates enforcement.

- **Honest status, names only.** `resolveRateLimitStatus()` distinguishes five states —
  `disabled`, `local-memory`, `remote-missing-config` (remote selected but no valid store
  / no provider registered — skips honestly), `remote-configured` (valid store + provider
  registered — enforcing), and the runtime `remote-error-fail-open` (configured but the
  last request came back unenforced — the store is erroring and the guard is failing
  open). Diagnostics name environment **variables** only, never a value or endpoint.

**Client attribution is private and opt-in.** A limiter must bucket by some
client identity. The guard derives one only from the proxy forwarding header
(`x-forwarded-for` / `x-real-ip`) and only when `PDFXYZ_RATE_LIMIT_TRUST_PROXY`
is truthy — because that header is client-spoofable unless a trusted edge
overwrites it. Off (the default), every request keys into **one shared bucket**
(a coarse global throttle) rather than an attacker's rotating fake address. When
on, the address is immediately **salted-hashed** (per-process random salt) and
used only as an in-memory map key; the raw address is never retained, logged,
returned, or placed in a decision.

**The decision is content-free.** A `RateLimitDecision` carries only: `allowed`,
the `action`, the stable `policyId`, the `provider`, the `enforced` flag, an exact
`retryAfterSeconds` (derived purely from the window + clock), and a coarse
`retryAfterBucket`. It never carries an IP, user agent, filename, token, object
key, job id, env value, or request body — the same no-leak posture as
`/api/worker/status` and `/api/worker/operations`, which stay lightweight and
never expose request identity.

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

## Upload intake boundary (Phase 35)

Before an upload session is reserved or a job spec reaches the queue, the web API evaluates a typed intake policy (`src/lib/uploads/intake`). This boundary catches low-cost contradictions early: file-count caps, declared bytes, hostile filenames, supported upload families, MIME/extension coherence, and optional local-dev PDF envelope bytes. The queue still receives only validated opaque file IDs and tool specs; worker-side malware scanning, lifecycle deletion, processor validation, and PDF soundness checks remain separate stages and are never implied by an intake pass.

All intake rejections are content-free and stable (`invalid_upload_request`, `unsupported_file_type`, `too_many_files`, `file_too_large`, `request_too_large`, `malformed_pdf`). They are safe for logs/metrics because they carry only policy numbers, positional indices, and coarse enum reasons.

## File soundness and quarantine (Phase 36)

Worker execution now has an explicit soundness preflight that runs immediately after the storage retrieval and **before the scanner and any processor**, so a structurally-unsound or contract-mismatched input never reaches ClamAV, OCR, or compression. `resolveWorkerSoundness()` (in `src/lib/workers/soundness`) builds a bounded policy from `PDFXYZ_WORKER_SOUNDNESS*` names; `checkSoundness()` evaluates the retrieved bytes + the declared metadata already stored for the job; `buildSoundnessReceipt()` produces a content-free quarantine receipt, which the executor emits through its optional `onSoundnessReceipt` sink when the gate blocks an input. The executor fails the job with the terminal, non-retryable `unsound_input` error (coarse failure class `unsound`) before any processor runs, and wipes the rejected input via the same active-deletion path every terminal disposition uses — so lifecycle cleanup is preserved and no partial artifact is produced.

The bounded checks, cheapest-first, are: empty bytes, a per-job input-count ceiling, an optional hard max-byte ceiling, a declared-vs-fetched byte-count match (`size_mismatch`, only when the storage layer recovered a declared size — the local-dev store carries it from the reservation; an S3 deployment supplies it only if the object metadata records one, a forward-compatible extension), declared content-type/tool-family and content-type/extension coherence, and the bounded `%PDF-`/`%%EOF` envelope for PDF-expected inputs. The reason taxonomy is a closed enum (`missing_input`, `too_many_inputs`, `empty`, `file_too_large`, `size_mismatch`, `unsupported_family`, `metadata_mismatch`, `malformed_pdf`, `policy_unavailable`).

**"Quarantine" here is a receipt plus active deletion — it does NOT retain the unsafe file.** The default is always to delete: the rejected input bytes are wiped exactly like any other terminal failure, and the receipt keeps none of them alive. A receipt carries only a bounded reason enum, the stable policy id/version (`pdfxyz-worker-soundness` / `1`), a coarse size bucket, a small input count, the processor family, and a timestamp — never a filename, object key, signed URL, path, byte excerpt, OCR text, or secret. There is no opt-in operator byte-retaining quarantine store in this phase.

The gate is deliberately shallow: it validates envelope/metadata consistency, not security. Passing it only means the input cleared a bounded preflight. It does not prove malware-free content, PDF validity, sanitization, deep PDF parsing/repair, or recognisable text quality — those remain separate (malware scanning is the ClamAV gate; deep PDF sanitization/repair remains out-of-band and is not implemented).

## Artifact manifest and provenance validation (Phase 37)

Where the soundness gate proves an *input* is structurally sound before processing, the artifact-manifest gate proves an *output* has an unambiguous, well-formed **provenance** before publication. It runs after a processor succeeds and **before any bytes are persisted or a download is minted**, so a malformed or ambiguous output is never written to storage or exposed to a client. `resolveWorkerArtifactManifest()` (in `src/lib/workers/artifacts`) builds a bounded policy from `PDFXYZ_WORKER_ARTIFACT_*` names; `checkArtifacts()` validates the produced output set; `buildArtifactManifest()` projects each output into a content-free manifest, and `buildArtifactReceipt()` emits a content-free provenance receipt through the executor's optional `onArtifactReceipt` sink. On an `invalid` verdict the executor fails the job with the terminal, non-retryable `artifact_invalid` error (coarse failure class `artifact`) and wipes inputs via the same active-deletion path every terminal disposition uses — no partial artifact is produced, and lifecycle cleanup is preserved.

Each manifest records only structural provenance — the output **kind** (`pdf`, `text-sidecar`, `archive`, `image`), the normalized **content-type**, the **byte count** (the same figure the client already receives on its download record), the bounded **retention/lifecycle class** derived from the job's retention policy, the **tool slug**, the bounded **processor family**, and the stable policy id/version (`pdfxyz-worker-artifact-manifest` / `1`). It never carries a filename, object key, signed URL, job/user id, temp path, OCR text, scanner signature, or document byte. The set-level and per-output reason taxonomy is a closed enum (`no_artifacts`, `too_many_artifacts`, `empty_artifact`, `oversize_artifact`, `unknown_output_kind`, `content_type_mismatch`, `unsupported_content_type`, `missing_retention_class`, `provenance_incomplete`, `policy_unavailable`).

The producible-kind check ties each bounded processor family to the kinds it may legitimately emit (compression → `pdf`; OCR → `pdf` + `text-sidecar`; an unknown/future processor is left open across recognized kinds), so a tool cannot publish an ambiguous output. The retention class fails closed to `unknown` — and thus rejects — for a malformed/non-positive TTL or a policy claiming persistence beyond the job, so the privacy-by-default retention contract cannot be silently violated at publish time. The local-dev adapter runs the SAME gate synchronously before it stores an artifact, so the dev and async worker paths cannot drift on which outputs are publishable.

An opt-in `onArtifactReceipt` sink records a bounded lifecycle category — `generated` when a manifest is minted for a published set, `rejected` when the gate blocks a set before publication, and `cleaned` when a published set (and the transient manifest that described it) is deleted together on a late cancellation — so no provenance record outlives the artifacts it described. Like the soundness gate this is **structural metadata validation only**: passing it does not prove the document is malware-free, sanitized, correctly OCR'd, valid, or that lifecycle deletion has run — those remain separate, honestly-reported steps.

### Manifests are internal-only; five content-free channels, distinct audiences

The artifact manifest is **internal to the worker**. It is never persisted onto the client-facing `Job` record and is never returned by the job-status API. The executor uses it only to (a) *decide* whether to publish, (b) emit bounded `worker_artifact_manifest_total` **metrics**, and (c) emit content-free artifact **receipts** to an operator sink. What a client actually receives is unchanged by Phase 37: the per-download `JobArtifact` (filename, content-type, **byte count**, signed URL, `expiresAt`) it already got, plus — for OCR jobs only — the separate `results.ocr` metadata block. Adding Phase 37 widened no client surface. What remains **out-of-band** (never surfaced to client or operator in any Phase 37 output): the raw manifest object, filenames, object keys, signed-URL internals beyond the download record, temp paths, document/OCR text, and raw content hashes.

Five content-free channels now describe a job's lifecycle, and they are deliberately **not interchangeable** — keep their claims separate when reading logs, metrics, or receipts:

| Channel | When | Audience | What it asserts (and does **not**) |
| --- | --- | --- | --- |
| **Upload-intake validation** (Phase 35, `src/lib/uploads/intake`) | At the public boundary, on *declared* metadata, before any storage/queue work | Server (public routes) | The declared upload is within limits and a plausible family. Not proof the bytes match, are safe, or are a real PDF. |
| **Worker soundness / quarantine receipt** (Phase 36, `src/lib/workers/soundness`) | After the worker reads *input* bytes, before scanner/processor | Operator (receipt sink, metrics) | The input cleared a bounded envelope/metadata preflight. Not malware scanning, sanitization, repair, or a validity proof. |
| **Artifact manifest / provenance receipt** (Phase 37, `src/lib/workers/artifacts`) | After a processor produces *outputs*, before any byte is persisted | Operator (receipt sink, metrics) — **internal only** | The produced output set has an unambiguous, well-formed structural provenance and may be published. Not content-security, OCR-correctness, or a deletion guarantee. |
| **OCR result metadata** (`results.ocr`, Phase 26) | On a completed OCR job | **Client** (job-status API) | Bounded facts the OCR run reported (engine family, languages, page/character *counts*, which kinds were produced). Not the recognized text; not a manifest. |
| **Lifecycle deletion receipt** (Phase 25, `src/lib/workers/lifecycle`) | When retention expires and outputs are actively deleted | Operator (deletion proof) | Outputs were deleted per the retention contract. This — not the manifest — is the record of *deletion*. |

The manifest's `cleaned` receipt (a late cancellation dropping just-written outputs) and the Phase 25 lifecycle deletion receipt are distinct: the former proves a *transient* manifest never outlived the bytes it described in the one executor window that writes-then-deletes; the latter is the standing proof that retained outputs are eventually deleted. Because the manifest is never persisted, there is no manifest state for expiration/cancel to reconcile — a job that fails, is canceled, quarantined, or soundness-rejected simply has no manifest at all, so none can ever imply a phantom output exists.

## Operations evidence bundle (Phase 45)

The operations evidence bundle is an operator-only packaging layer over existing content-free outputs. `src/lib/workers/ops-bundle/` ingests a required `pdfxyz.ops-check/1` result and an optional `pdfxyz.cleanup-pipeline/1` summary, rebuilds bounded sections (operations, SLO, cleanup evidence, lifecycle, cleanup pipeline), computes the worst severity, and renders `pdfxyz.ops-bundle/1` JSON or text. The Node entry `scripts/worker-ops-bundle.ts` is the only filesystem seam: it reads stdin/files, optionally writes `--output`, and never exposes those paths in the bundle.

This layer adds no worker capability and makes no new proof. It does not call cloud APIs, inspect object storage, read raw provider exports, read document bytes, or delete anything. It exists so an operator can attach one safe artifact to an incident or support ticket instead of copying logs. The trust boundary copies no free-text input: paths, buckets, object keys, signed URLs, provider errors, filenames, user identifiers, env-like strings, document/OCR text, raw metadata, and byte snippets are dropped before rendering. The metric `worker_ops_bundle_total{severity}` reports only the final bounded severity.

## Release readiness gate (Phase 46)

The release readiness gate is a pre-promotion decision layer over the existing content-free signals. It is local/offline/read-only, fail-closed, and does not perform the promotion.

**`src/lib/workers/release-gate/` (`pnpm worker:release-gate`).** A catalog-driven runner (`checks` → `run` spawns each catalog entry → `rollup` → `render`/`receipt`/`metrics`) that RUNS the existing checks as subprocesses over committed fixtures and captures ONLY each one's process exit code, discarding every byte of its stdout/stderr — so it is structurally content-free (there is no untrusted string to reconstruct from at all; the internal fixture paths in the check catalog are never serialized). It folds the per-check `pass`/`warn`/`fail`/`unknown`/`skip` statuses into one `pass`/`warn`/`fail`/`unknown` verdict on the ops-aligned `0`/`1`/`2`/`3`/`4` ladder, with advisory (`warn`) vs blocking (`fail`) check severities and `--only`/`--skip` scoping by bounded check id. Emits `worker_release_gate_total{verdict}`.

The gate makes no cloud call, reads no provider export/secret/bucket, inspects no object bytes, and deletes/uploads/mutates nothing. It composes existing content-free evidence for a promotion decision; a `pass` verdict proves only what the gathered evidence proves.

## Release evidence artifact (Phase 47)

The release evidence artifact is an archival layer over the gate: it produces a stable, tamper-evident, content-free record to keep. It is local/offline/read-only, fail-closed, and does not perform the promotion.

**`src/lib/workers/release-artifact/` (`pnpm worker:release-artifact`).** A node-free core over injected seams (`git`/spawn/`node:crypto` hash/`fs`/clock), so the Node entry (`scripts/worker-release-artifact.ts`) is a thin shell. The flow: gather raw git facts → `git` reduces them to a bounded provenance (cleanliness enum, ref **class**, validated short commit hash — the raw branch name / remote URL is never copied) → `gate` ingests the `worker:release-gate` result (run internally or supplied) and `opsbundle` ingests an optional summary, both re-authored from closed enums → `build` folds the gate verdict (primary) with the cleanliness (a dirty tree escalates a clean `pass` to `warn`) into the rollup and assembles the `ReleaseArtifactBody` → `canonicalize` produces the deterministic key-sorted pre-image → `digest` computes the `sha256` integrity block over it (the digest lives OUTSIDE the body so it can cover it) → `render`/`receipt`/`metrics`. A `--verify` path re-reads a previously written artifact and recomputes the digest over its canonical body, failing closed (exit `4`) on a mismatch. The operator `--label` is validated + redaction-stable in both the parser and the runner. Emits `worker_release_artifact_total{verdict}`.

The artifact makes no cloud call, reads no provider export/secret/bucket, inspects no object bytes, and deletes/uploads/mutates nothing. It is evidence aggregation + integrity over content-free data — the digest is tamper-evidence, not a signature (no key, no attested identity) — and a `pass` verdict proves only what the archived gate evidence proves. An attached ops-bundle summary is runtime context and does not change the verdict.

## Release evidence index / retention manifest (Phase 48)

The release evidence index is a retention layer over the artifact: it ingests many artifacts, re-verifies their integrity, and produces one content-free retention manifest to keep. It is local/offline/read-only, fail-closed, and enforces nothing — it flags.

**`src/lib/workers/release-index/` (`pnpm worker:release-index`).** A node-free core over injected seams (`fs`/stdin/`node:crypto` hash/clock), so the Node entry (`scripts/worker-release-index.ts`) is a thin shell. The flow: gather raw artifact roots (each `--artifact`/`--file` file, or a JSON array/single object on stdin — a read/parse failure becomes ONE bounded `unreadable` input, never an abort or an echoed path) → `ingest` is the trust boundary: for each root it re-verifies the INTEGRITY DIGEST by recomputing the `sha256` over the artifact's canonical body (reusing the Phase 47 `canonicalize` + `digest`) and reduces every fact to a bounded enum, a boolean, a `semver`/`named`/`absent` label **class** (the raw label is never echoed), a coarse age **bucket** (`age`), or a short hex digest PREFIX — copying no free-text field → `build` sorts the artifacts newest-first (a total order: dated by descending instant, then recognized-but-undateable, then unreadable), assigns each a position + age bucket + retention flag, tallies the per-verdict and per-digest-status counts, derives the retention posture (over-count / over-age / stale from the injected clock), and assembles the `ReleaseIndex` → `rollup` folds it to the composite verdict (integrity first: any tampered/malformed digest → `invalid`; then retention → `warn`; an empty archive → `unknown`; else `ok`) → `render`/`receipt`/`metrics`. Emits `worker_release_index_total{verdict}`.

The index makes no cloud call, reads no provider export/secret/bucket, inspects no object bytes, and deletes/prunes/uploads/mutates nothing. It is content-free indexing + digest re-verification over already-content-free artifacts — the digest re-verification is tamper-evidence, not a signature — and the archived builds' own verdicts are tallied as counts, never re-judged. Retention bounds only FLAG over-retention/stale for an operator to act on out of band; the offline index prunes nothing. A fully node-free leaf plus a thin `node:*` entry, exactly like the rest of the worker CLIs.

**`src/lib/workers/release-policy/` (`pnpm worker:release-policy`).** A node-free core over injected seams (`fs`/stdin/`node:crypto` hash/clock), so the Node entry (`scripts/worker-release-policy.ts`) is a thin shell. The flow: gather the evidence — either a single `pdfxyz.release-index/1` root (from `--index=<path>` or stdin; a read/parse failure becomes an UNRECOGNIZED input, never an abort or an echoed path), or, in `--artifact` mode, one or more `pdfxyz.release-artifact/1` roots indexed IN-PROCESS via the Phase 48 `buildIndex` (re-verifying every digest through the injected hash) → `ingest` is the trust boundary: it validates the index against the `pdfxyz.release-index/1` shape and reduces it to bounded facts (the archive-health verdict, the small integer counts, the retention booleans, coarse age **buckets**, and the newest artifact's verdict), copying no free-text field, and it FAILS CLOSED on inconsistency — the counts must add up and the archive-health verdict RECOMPUTED from those counts (via the Phase 48 `computeRollup`) must equal the self-report, else the index is `usable = false` → `invalid-index` → `render`/`receipt`/`metrics` (a `--artifact` build skips validation — it is trusted because we built it) → `evaluate` runs the configured assertions over the facts into a canonical-ordered list of bounded violations (blocking vs warning severity, plus the always-on `index-tampered` for a valid-but-`invalid` archive) → `rollup` folds the ingest tri-state + the violations to the composite verdict (unrecognized → `unknown`; unusable → `fail`; a blocking violation → `fail`; an empty archive → `unknown`; a warning violation → `warn`; else `pass`) → `build` assembles the `ReleasePolicyResult` → `render`/`receipt`/`metrics`. Emits `worker_release_policy_total{verdict}`.

The policy makes no cloud call, reads no provider export/secret/bucket, inspects no object bytes, and deletes/prunes/uploads/mutates/promotes nothing. It is bounded policy EVALUATION over already-content-free evidence — it re-checks the index's internal consistency (tamper-evidence over the manifest's own numbers, not a signature) but does not itself re-hash artifacts unless given `--artifact`. A `pass` authorizes nothing; the deployment approval/promotion is operator-owned and out of band. A fully node-free leaf plus a thin `node:*` entry, exactly like the rest of the worker CLIs.

**`src/lib/workers/release-ci-bundle/` (`pnpm worker:release-ci-bundle`).** A node-free core over injected seams (`fs`/`node:crypto` hash/clock), so the Node entry (`scripts/worker-release-ci-bundle.ts`) is a thin shell. The flow: `run` reads whichever of the four supplied stage files (`--release-gate`/`--release-artifact`/`--release-index`/`--release-policy`; a missing path or a read/parse failure becomes an UNRECOGNIZED input, never an abort or an echoed path) → `ingest` is the trust boundary, one reducer per stage, each REUSING the tested upstream boundary: the gate reduces to its verdict + check counts; the artifact delegates to the Phase 48 `ingestArtifact` (re-verifying the integrity digest via the injected hash → `digestStatus`); the index delegates to the Phase 49 `ingestIndex` (recomputing the archive-health verdict from the index's own counts, `usable = false` on inconsistency) and additionally extracts the verified entries' bounded `{digestPrefix, verdict}` for the inclusion check; the policy re-derives its rollup verdict from its OWN recorded facts + assertions (reusing the Phase 49 `evaluatePolicy` + `computePolicyRollup`), `usable = false` if the re-derived verdict disagrees with the recorded one. Every reducer copies no free-text field and reduces to bounded enums / small integers / booleans → `build` maps each stage's native verdict onto the common severity ladder (index `ok→pass`/`invalid→fail`, the rest 1:1) and assembles the four stage summaries → `verify` evaluates the six closed consistency links (`artifact-digest`, `index-self-consistent`, `policy-self-consistent`, `gate-artifact-agreement`, `artifact-index-inclusion`, `index-policy-agreement`) to `ok`/`mismatch`/`skipped` → `rollup` folds the stage severities + the links: a stage `fail` or a link `mismatch` → `fail`; an unreadable/indeterminate stage or a chain with no archive-decision stage → `unknown`; a stage `warn` → `warn`; else `pass` (drivers emitted as a superset in canonical order) → `build` assembles the `ReleaseCiBundleResult` (stages, links, rollup, archive guidance, next action) → `render`/`receipt`/`metrics`. Emits `worker_release_ci_bundle_total{verdict}`.

The bundle makes no cloud call, reads no provider export/secret/bucket, inspects no object bytes, RUNS no stage itself, and deletes/prunes/uploads/mutates/promotes nothing. It is content-free COMPOSITION + consistency checking over already-content-free stage outputs — it re-verifies each stage against itself (tamper-evidence over each stage's own numbers, plus the artifact digest re-hash) and confirms the stages describe the SAME evidence, but proves nothing the stages do not already prove. A `pass` authorizes nothing; the deployment approval/promotion is operator-owned and out of band. A fully node-free leaf plus a thin `node:*` entry, exactly like the rest of the worker CLIs.

**`src/lib/workers/release-audit/` (`pnpm worker:release-audit`).** A node-free core over injected seams (`fs` reads + a clock, plus a stdin read), so the Node entry (`scripts/worker-release-audit.ts`) is a thin shell. The flow: `run` reads the `--baseline` + `--current` files (pair mode), or a `--bundle` list / a `--stdin` JSON array (history mode; a missing path, an empty file, a parse failure, or a non-array stdin becomes an UNRECOGNIZED input / an empty history, never an abort or an echoed path) → `ingest` is the trust boundary: it reconstructs each bundle's stages + consistency links and RE-RUNS the Phase 50 `computeBundleRollup` over them, marking the bundle `usable` only if the recorded rollup (verdict, exit code, decision stage, stage/inconsistency counts, drivers) equals the re-derived one — a hand-flipped `rollup.verdict` / lied decision stage / hidden inconsistency is caught as recognized-but-not-usable (a tamper); a wrong-schema input is not recognized. It copies no free-text field and reduces each bundle to bounded enums / small integers / booleans (`{present, severity}` per stage, a status per link, the archive verdict, advisory-signal counts) → `reduce` folds each ingested bundle into a bounded per-slot summary (posture rank + an authored headline; a not-supplied or not-usable slot gets safe defaults) → `compare` is the diff engine: over two usable bundles it evaluates the closed regression set (`verdict-worsened`, `consistency-broke`, `consistency-weakened`, `coverage-dropped`, `archive-decision-worsened`, `warnings-increased`) to `regressed`/`ok`/`skipped` with a resolved `block`/`unknown`/`warn`/`none` severity, plus the bounded signed deltas; a tampered/unreadable input anywhere in the supplied set fires `bundle-tampered`/`bundle-unreadable` and SKIPS the comparison → `rollup` folds the findings + the comparability: a blocking regression / tamper → `fail`; an unreadable bundle or a diff that could not run (`!comparable`) → `unknown`; a warn drift (unless `--allow-warn-regression`) → `warn`; else `pass` (drivers emitted as a superset in canonical order) → `build` assembles the `ReleaseAuditResult` (baseline/current summaries, the history distribution, the diff facts, the findings, the rollup, next action) → `render`/`receipt`/`metrics`. Emits `worker_release_audit_total{verdict}`.

The audit makes no cloud call, reads no provider export/secret/bucket, inspects no object bytes, RUNS no stage or bundle itself, and deletes/prunes/uploads/mutates/promotes nothing. It is content-free DIFF over already-content-free bundles — it re-validates each bundle against itself (tamper-evidence over the bundle's own numbers) and compares two postures, but proves nothing the bundles do not already prove. A `pass` means only that the current bundle did not regress versus the baseline; it authorizes nothing, and the deployment approval/promotion is operator-owned and out of band. A fully node-free leaf plus a thin `node:*` entry, exactly like the rest of the worker CLIs.

**`src/lib/workers/release-report/` (`pnpm worker:release-report`).** A node-free core over injected seams (`fs` reads + a clock, plus a stdin read), so the Node entry (`scripts/worker-release-report.ts`) is a thin shell. The flow: `run` reads the `--bundle` and/or `--audit` documents (each optional, at least one; a value of `-` reads that document from stdin; a missing path, an empty file, or a parse failure becomes an UNRECOGNIZED source, never an abort or an echoed path) → `ingest` is the trust boundary: the bundle REUSES the Phase 51 `ingestBundle` (re-running `computeBundleRollup` over the bundle's own stages + links), and the audit RE-RUNS the Phase 51 `computeAuditRollup` over the audit's own regression findings + policy, marking each `usable` only if its recorded rollup matches the re-derived one — a hand-flipped verdict / lied count on either is caught as recognized-but-not-usable (a tamper); a wrong-schema input is not recognized. It copies no free-text field and reduces each document to bounded enums / small integers / booleans → `reduce` folds each ingested source into a bounded per-source summary with a coverage state (`absent`/`unreadable`/`tampered`/`usable`) and a common-ladder severity (`ready`/`advisory`/`insufficient`/`blocking`; a not-usable source surfaces only its untrusted claimed verdict, no trusted facts), plus a coverage fold → `rollup` derives the closed set of fired rationale ids (`evidence-tampered`, `bundle-failed`, `audit-regressed`, `evidence-unreadable`, `bundle-uncertified`, `audit-inconclusive`, `coherence-missing`, `bundle-advisory`, `audit-drift`) and folds them with fail-closed precedence: any blocking → `hold-fail`; else any insufficiency (including **no supplied bundle** — a `promote-ready` requires a usable passing bundle) → `needs-evidence`; else any advisory → `hold-warning` (or `hold-fail` under `--strict`); else `promote-ready` → `build` derives the archive checklist + the ordered next-action checklist and assembles the `ReleaseReportResult` (coverage, sources, recommendation, rationale, archive, next actions) → `render`/`receipt`/`metrics`. Emits `worker_release_report_total{recommendation}`.

The report makes no cloud call, reads no provider export/secret/bucket, inspects no object bytes, RUNS no stage / bundle / audit itself, and deletes/prunes/uploads/mutates/promotes/approves nothing. It is content-free REPORTING over already-content-free composites — it re-validates each document against itself and folds them into one operator recommendation, but proves nothing the documents do not already prove. A `promote-ready` requires a usable bundle whose own verdict is `pass` (an audit-only run is `needs-evidence`); it authorizes nothing, and the deployment approval/promotion is operator-owned and out of band. A fully node-free leaf plus a thin `node:*` entry, exactly like the rest of the worker CLIs.

**`src/lib/workers/release-trend/` (`pnpm worker:release-trend`).** A node-free core over injected seams (`fs` reads + a clock, plus a stdin read), so the Node entry (`scripts/worker-release-trend.ts`) is a thin shell. It closes the governance-review loop over a bounded HISTORY of the Phase 52 operator reports. The flow: `run` reads the report history — repeated `--report`/`--file` files (chronological, oldest first / newest last) or a `--stdin` JSON array; a missing path, an empty file, or a parse failure becomes an UNRECOGNIZED report, never an abort or an echoed path → `ingest` is the trust boundary: it RE-RUNS the Phase 52 `computeReportRecommendation` over each report's OWN recorded sources (each source's bounded `state` + `verdict`) + its recorded `strict`, marking a report `usable` only if its recorded recommendation (recommendation, exit code, ready flag, counts, rationale set, strict-escalated flag) re-derives — a hand-flipped recommendation / lied count on a report is caught as recognized-but-not-usable (a tamper); a wrong-schema input is not recognized. It copies no free-text field, drops the report's own stamp, and reduces each report to bounded enums / small integers / booleans → `reduce` applies the `--max-reports` window cap (keeping the newest N, surfacing how many were dropped), reduces each considered report to a bounded point (position, coverage state `unreadable`/`tampered`/`usable`, trusted-or-claimed recommendation, common-ladder severity), and summarizes the window (counts by recommendation over the usable reports, newest / oldest usable recommendation, arc direction) → `rollup` derives the closed set of fired reason ids (`report-tampered`, `latest-hold-fail`, `repeated-hold-fail`, `latest-not-ready`, `report-unreadable`, `no-usable-reports`, `latest-needs-evidence`, `latest-hold-warning`, `repeated-hold-warning`, `trend-degraded`) and folds them with fail-closed precedence: any blocking → `failing`; else any insufficiency → `unknown`; else any advisory → `warning`; else `stable`. The NEWEST usable report is authoritative — a `hold-fail` tip fails the trend even within a tolerated `--max-hold-fail` threshold → `build` derives the ordered follow-up checklist and assembles the `ReleaseTrendResult` (policy, history, points, trend, reasons, follow-ups) → `render`/`receipt`/`metrics`. Emits `worker_release_trend_total{verdict}`.

The trend makes no cloud call, reads no provider export/secret/bucket, inspects no object bytes, RUNS no gate / bundle / audit / report itself, and deletes/prunes/uploads/mutates/promotes/approves nothing. It is content-free TREND REPORTING over already-content-free reports — it re-validates each report against itself and folds a bounded history of their recommendations into one governance verdict, but proves nothing the reports do not already prove. A `stable` trend requires a clean window (a promote-ready tip, no tamper, no breached threshold); it authorizes nothing, and the deployment approval/promotion is operator-owned and out of band. A fully node-free leaf plus a thin `node:*` entry, exactly like the rest of the worker CLIs.

**`src/lib/workers/release-governance/` (`pnpm worker:release-governance`).** A node-free core over injected seams (`fs` reads + a clock, plus a stdin read), so the Node entry (`scripts/worker-release-governance.ts`) is a thin shell. It closes the governance-review loop for a review WINDOW by composing the Phase 53 trend (PRIMARY) with the LATEST Phase 52 report and/or Phase 51 audit. The flow: `run` reads up to three documents — `--trend`/`--report`/`--audit` files (any value may be `-` for stdin, at most one; at least one required); a missing path, an empty file, or a parse failure becomes an UNRECOGNIZED source, never an abort or an echoed path → `ingest` is the trust boundary: the report source REUSES the Phase 53 `ingestReport` (re-derives the report's Phase 52 recommendation) and the audit source REUSES the Phase 52 `ingestAudit` (re-runs the Phase 51 rollup), while the trend source (new here) reconstructs the trend's own per-report POINTS and RE-RUNS the Phase 53 `reduceTrend` + `computeTrendRollup` over them, marking the trend `usable` only if the recorded history (point-derivable fields + window arithmetic) and verdict (verdict, exit code, reason set, counts, escalation flags) re-derive — a hand-flipped verdict / lied distribution / hidden point on the trend is caught as recognized-but-not-usable (a tamper); a wrong-schema input is not recognized. It copies no free-text field, drops each document's own stamp, and reduces each source to bounded enums / small integers / booleans → `reduce` maps each source to a bounded summary (coverage state `absent`/`unreadable`/`tampered`/`usable`, trusted-or-claimed posture, common-ladder severity) and computes the coverage → `rollup` derives the closed set of fired reason ids (trend `trend-tampered`/`trend-failing`/`trend-missing`/`trend-unreadable`/`trend-unknown`/`trend-warning`, report `report-tampered`/`report-hold-fail`/`report-needs-evidence`/`report-unreadable`/`report-missing`/`report-hold-warning`, audit `audit-tampered`/`audit-regressed`/`audit-inconclusive`/`audit-unreadable`/`audit-missing`/`audit-drift`, plus the `report-trend-mismatch` cross-check) and folds them with fail-closed precedence: any blocking → `blocked`; else any insufficiency → `incomplete`; else any advisory → `watch` (or `blocked` under `--strict-watch`); else `healthy`. The PRIMARY trend is required — a latest report / audit can only BLOCK or FLAG, never GRANT a healthy on its own (an absent / unusable trend is insufficient → `incomplete`) → `build` derives the archive checklist + the ordered follow-up assignment list and assembles the `ReleaseGovernanceResult` (policy, coverage, sources, governance, reasons, archive, follow-ups) → `render`/`receipt`/`metrics`. Emits `worker_release_governance_total{verdict}`.

The bundle makes no cloud call, reads no provider export/secret/bucket, inspects no object bytes, RUNS no gate / bundle / audit / report / trend itself, and deletes/prunes/uploads/mutates/promotes/approves nothing. It is content-free GOVERNANCE BUNDLING over already-content-free evidence summaries — it re-validates each document against itself and folds them into one governance verdict + archive/follow-up checklists, but proves nothing the documents do not already prove. A `healthy` window requires a usable, `stable` trend; it authorizes nothing, and the deployment approval/promotion is operator-owned and out of band. A fully node-free leaf plus a thin `node:*` entry, exactly like the rest of the worker CLIs.

## Release archive pack

`src/lib/workers/release-archive/` is the Phase 55 archive-indexing layer. It ingests the primary governance bundle and optional related evidence records, reuses earlier release-evidence validators, folds them into `archivable` / `archive-watch` / `archive-incomplete` / `archive-blocked`, and renders JSON/text without leaking paths, identifiers, raw labels/refs, digests, ingested timestamps, or document bytes. It is an offline/read-only index, not a worker daemon, storage copy, signer, or deployment promoter.

## Release restore drill

`src/lib/workers/release-restore-drill/` is the Phase 56 disaster-recovery layer. It anchors on a restored `pdfxyz.release-archive/1` pack and the underlying records an operator restored out of band, reconstructs the pack's own reduced records + re-runs the Phase 55 reducer to catch a tampered pack, re-validates each restored record through the existing content-free boundaries, and cross-checks each restored posture against the pack's recorded posture — folding them into `restore-verified` / `restore-drift` / `restore-incomplete` / `restore-failed` plus a content-free sha256 fingerprint of each restored input. It fetches nothing and is offline/read-only, not a storage retrieval, signer, cloud validator, or deployment promoter.

## Release publish / handoff pack

**`src/lib/workers/release-publish-pack/` (`pnpm worker:release-publish-pack`).** The Phase 57 external-handoff layer — a node-free core over injected seams (`fs` reads + a clock, plus a stdin read), so the Node entry (`scripts/worker-release-publish-pack.ts`) is a thin shell. It composes the content-free `pdfxyz.release-governance/1` bundle (PRIMARY) with the related `pdfxyz.release-archive/1`, `pdfxyz.release-restore-drill/1`, `pdfxyz.release-report/1`, and/or `pdfxyz.release-trend/1` into ONE share-safe manifest for a handoff to an external reviewer / approver / investor / incident responder. The flow: `run` reads up to five documents — `--governance`/`--archive`/`--restore-drill`/`--report`/`--trend` files (any value may be `-` for stdin, at most one; at least one required); a missing path, an empty file, or a parse failure becomes an UNRECOGNIZED source, never an abort or an echoed path → `ingest` is the trust boundary: four sources REUSE the shipped tested boundaries (`ingestGovernance` from Phase 55, `ingestRestoreArchive` from Phase 56, `ingestReport` from Phase 53, `ingestTrend` from Phase 54), while the restore-drill source (new here) reconstructs the drill's own reduced archive anchor + per-record restore checks and RE-RUNS the Phase 56 `computeRestoreCoverage` + `computeRestoreRollup` over them, marking the drill `usable` only if the recorded coverage + verdict (verdict, exit code, verified flag, reason set, counts, policy/escalation flags) re-derive — a hand-flipped verdict / lied coverage / hidden check is caught as recognized-but-not-usable (a tamper); a wrong-schema input is not recognized. Every reducer copies no free-text field, drops each document's own stamp, and reduces each source to bounded enums / small integers / booleans → `reduce` maps each source to a uniform bounded summary (coverage state `absent`/`unreadable`/`tampered`/`usable`, trusted-or-claimed native posture, common-ladder severity) and computes the coverage → `rollup` derives the closed set of fired reason ids (per source: `*-tampered`/`*-blocked`/`*-failed`/`*-hold-fail`/`*-failing` blocking, `*-missing`/`*-unreadable`/`*-incomplete`/`*-needs-evidence`/`*-unknown` insufficient, `*-watch`/`*-drift`/`*-hold-warning`/`*-warning` advisory) and folds them with fail-closed precedence: any blocking → `blocked`; else any insufficiency → `incomplete`; else any advisory → `review`; else `publishable`. The PRIMARY governance bundle is required — an archive/restore-drill/report/trend can only BLOCK or FLAG, never GRANT a `publishable` on its own (an absent/unusable governance is insufficient → `incomplete`); `--strict` escalates a `review` OR `incomplete` posture to `blocked`; the DISCLOSURE CLASSIFICATION (`share-safe`/`internal-review`/`blocked`) is a deterministic coarsening of the final verdict → `build` derives the ordered handoff checklist and assembles the `ReleasePublishPackResult` (coverage, sources, pack, disclosure, reasons, checklist, guidance, caveats) → `render`/`receipt`/`metrics`. It makes no cloud call, reads no provider export/secret/bucket, RUNS none of the tools it composes, and publishes/shares/sends/signs/approves/promotes/deletes/mutates nothing — it is content-free handoff PACKAGING that classifies the sharing decision; the operator performs the actual handoff out of band. Emits `worker_release_publish_pack_total{verdict}`.

## Release handoff acknowledgement receipt

**`src/lib/workers/release-ack/` (`pnpm worker:release-ack`).** The Phase 58 acknowledgement layer — a node-free core over injected seams (`fs` read + a clock, plus a stdin read), so the Node entry (`scripts/worker-release-ack.ts`) is a thin shell. It records a bounded operator ACKNOWLEDGEMENT of one content-free `pdfxyz.release-publish-pack/1` (the Phase 57 handoff pack). The flow: `run` reads one document — the required `--publish-pack`/`--pack` file (value may be `-` for stdin); a missing path, an empty file, or a parse failure becomes an UNRECOGNIZED pack, never an abort or an echoed path → `ingest` is the trust boundary: it reconstructs the pack's five reduced sources (each source's `state` + native verdict — the ATOM of a pack, since the pack reduced the upstream governance/archive/drill/report/trend documents away) + its policy and RE-RUNS the Phase 57 `computeCoverage` + `computePublishRollup` over them, marking the pack `usable` only if the recorded coverage + rollup (verdict, exit code, publishable flag, disclosure, reason set, counts, policy/escalation flags) re-derive — a hand-flipped verdict/disclosure, a lied coverage, an off-enum/off-position source, or a state that contradicts its own flags is caught as recognized-but-not-usable (a tamper); a wrong-schema input is not recognized. The reducer copies no free-text field, drops the pack's own stamp, and reduces the pack to bounded enums / small integers / booleans → `reduce` maps the pack to a bounded source summary (coverage state `absent`/`unreadable`/`tampered`/`usable`, trusted-or-claimed pack verdict/disclosure, source counts) and builds the bounded acknowledgement block from the validated decision + reviewer class + note class → `rollup` derives the closed set of fired reason ids (`pack-missing`/`pack-unreadable`/`pack-tampered` invalid; `pack-blocked`/`decision-needs-changes`/`decision-rejected` blocking; `pack-incomplete`/`decision-deferred` insufficient; `pack-review`/`decision-accepted-with-notes`/`note-followup` advisory) and folds them with fail-closed precedence: any invalid input → `invalid`; else any blocking → `rejected`; else any insufficiency → `deferred`; else any advisory → `acknowledged-with-followup`; else `acknowledged`. The input is PRIMARY — an untrustworthy pack is `invalid` regardless of the decision (never a vacuous pass); `--strict` escalates an `acknowledged-with-followup` OR `deferred` posture to `rejected` (only `accepted` over a `publishable` pack passes) → `build` derives the ordered next-action checklist and assembles the `ReleaseAckResult` (acknowledgement, source, ack, reasons, checklist, guidance, caveats) → `render`/`receipt`/`metrics`. It makes no cloud call, reads no provider export/secret/bucket, and signs/approves/publishes/promotes/notifies/deletes/mutates nothing — it is a content-free acknowledgement RECEIPT (the reviewer is a bounded class, never an identity); the operator obtains any required external signature/approval out of band. Emits `worker_release_ack_total{verdict}`.

## Release decision record ledger

**`src/lib/workers/release-decision/` (`pnpm worker:release-decision`).** The Phase 59 decision-record layer — a node-free core over injected seams (`fs` reads + a clock, plus a stdin read), so the Node entry (`scripts/worker-release-decision.ts`) is a thin shell. It composes ONE content-free `pdfxyz.release-publish-pack/1` (the Phase 57 handoff pack) + ONE `pdfxyz.release-ack/1` (the Phase 58 acknowledgement of it) into a single `pdfxyz.release-decision/1` ledger entry. The flow: `run` reads two documents — the required `--publish-pack`/`--pack` and `--ack`/`--acknowledgement` files (either value may be `-` for stdin, at most ONE); a missing path, an empty file, or a parse failure becomes an UNRECOGNIZED document, never an abort or an echoed path → `ingest` is the trust boundary: the pack REUSES the shipped Phase 58 `ingestPublishPack` verbatim, while the acknowledgement (new here) reconstructs its recorded source + acknowledgement and RE-RUNS the Phase 58 `computeAckRollup` over them, marking the ack `usable` only if the recorded rollup + the acknowledgement (re-derived via `buildAcknowledgement`) + the source invariants (`state === packState(...)`, and a usable source's disclosure is the verdict's canonical map) all re-derive — a hand-flipped verdict/decision, a lied `hasFollowup`, or an inconsistent coverage state is caught as a tamper; a wrong-schema input is not recognized. Each reducer copies no free-text field, drops each document's own stamp, and reduces each to bounded enums / small integers / booleans → `reduce` maps each document to a uniform bounded summary (coverage state `absent`/`unreadable`/`tampered`/`usable`, trusted-or-claimed posture, the acknowledgement's own verdict/decision/reviewer/note classes + the pack summary it recorded acknowledging) and computes the coherence CROSS-CHECK — only when BOTH documents are usable, it compares the acknowledgement's recorded source-pack summary (verdict/disclosure/source count) to the SUPPLIED pack's, yielding `match`/`mismatch`/`unknown` → `rollup` derives the closed set of fired reason ids (`pack-*`/`ack-*` missing/unreadable/tampered + `cross-check-mismatch` invalid; `pack-blocked`/`ack-rejected`/`ack-needs-changes` blocking; `pack-incomplete`/`ack-deferred` insufficient; `pack-review` (hold) + `ack-accepted-with-notes`/`ack-note-followup` (follow-up) advisory) and folds them with fail-closed precedence: any invalid input → `invalid`; else any blocking → `reject`; else any insufficiency → `insufficient`; else any advisory → `hold` (a review pack) or `proceed-with-followup`; else `proceed`. The pair is PRIMARY — an untrustworthy or incoherent pair is `invalid` regardless (never a vacuous pass); `--strict` escalates a `proceed-with-followup`/`hold`/`insufficient` posture to `reject` (only a clean `accepted` over a `publishable` pack proceeds) → `build` derives the ordered next-action checklist and assembles the `ReleaseDecisionResult` (publishPack, acknowledgement, crossCheck, decision, reasons, checklist, guidance, caveats) → `render`/`receipt`/`metrics`. It makes no cloud call, reads no provider export/secret/bucket, and signs/approves/publishes/promotes/deploys/notifies/deletes/mutates nothing — it is a content-free decision RECORD; the operator performs the actual promotion/deployment out of band. Emits `worker_release_decision_total{decision}`.

## Release decision ledger index

**`src/lib/workers/release-decision-index/` (`pnpm worker:release-decision-index`).** The Phase 60 decision-index layer — a node-free core over injected seams (`fs` reads + a clock, plus a stdin read), so the Node entry (`scripts/worker-release-decision-index.ts`) is a thin shell. It indexes a bounded BATCH of content-free `pdfxyz.release-decision/1` records (the Phase 59 ledger entries, one per release) into a single `pdfxyz.release-decision-index/1` review summary. The flow: `run` reads the batch — either repeated `--file`/`--decision` files (oldest first, newest last) or a `--stdin` payload (a JSON array, an NDJSON stream, or a single record); a missing path, an empty file, or a parse failure becomes an UNRECOGNIZED record, never an abort or an echoed path → `ingest` is the trust boundary: each record RECONSTRUCTS its recorded publish-pack / acknowledgement summaries (each reduced to bounded `state` + verdict / decision / note) + the cross-check status and RE-RUNS the Phase 59 `computeDecisionRollup` over them, marking the record `usable` only if `policy.strict` agrees with the recorded rollup and the recorded decision (decision, exit code, reason set, per-band counts, strict-escalation position) all re-derive — a hand-flipped decision, a lied count, a hidden reason, or a smuggled inconsistent policy is caught as a tamper; a wrong-schema input is not recognized. The stripped reconstruction is SAFE because that reducer reads only the pack `state`+`verdict`, the ack `state`+`decision`+`note`, the cross-check, and strict (verified against `release-decision/rollup.ts`). Each reducer copies no free-text field, drops each record's own stamp, and reduces each to bounded enums / small integers / booleans → `reduce` applies the `--max-records` window cap (keeping the newest N, surfacing how many older were dropped), maps each considered record to a bounded point (coverage state `unreadable`/`tampered`/`usable`, trusted-or-claimed decision, cross-check, severity), and summarizes the window into a bounded ledger (decision + cross-check distributions over the usable records, newest/oldest usable decision, and a single coarse `trendClass`) → `rollup` derives the closed set of fired reason ids (`record-unreadable`/`record-tampered` invalid; `decision-rejected`/`decision-invalid` blocking; `no-usable-records`/`decision-insufficient` insufficient; `decision-hold`/`decision-followup` advisory) and folds them with fail-closed precedence: any invalid input → `invalid`; else any blocking → `blocked`; else any insufficiency → `insufficient`; else any advisory → `watch`; else `stable`. An untrustworthy input (an unreadable/tampered record) is `invalid` regardless (never a vacuous stable); `--strict` escalates a `watch`/`insufficient` batch to `blocked` (only a batch whose every usable record is a clean `proceed` passes) → `build` derives the ordered next-action checklist and assembles the `ReleaseDecisionIndexResult` (ledger, points, index, reasons, checklist, guidance, caveats) → `render`/`receipt`/`metrics`. It makes no cloud call, reads no provider export/secret/bucket, and signs/approves/publishes/promotes/deploys/notifies/deletes/mutates nothing — it is a content-free ledger INDEX SUMMARY, not a legal audit log, a compliance attestation, an external approval/signature, an identity proof, or a deployment/promotion ledger. Emits `worker_release_decision_index_total{verdict}`.


## Release decision index trend

**`src/lib/workers/release-decision-trend/` (`pnpm worker:release-decision-trend`).** The Phase 61 decision-index-trend layer — a node-free core over injected seams (`fs` reads + a clock, plus a stdin read), so the Node entry (`scripts/worker-release-decision-trend.ts`) is a thin shell. It summarizes a bounded HISTORY of content-free `pdfxyz.release-decision-index/1` windows (the Phase 60 ledger-index summaries, one per review period) into a single `pdfxyz.release-decision-trend/1` governance summary. The flow: `run` reads the history — either repeated `--file`/`--window` files (oldest first, newest last) or a `--stdin` payload (a JSON array, an NDJSON stream, or a single window); a missing path, an empty file, or a parse failure becomes an UNRECOGNIZED window, never an abort or an echoed path → `ingest` is the trust boundary, and it re-validates each window TWICE: (B) it RE-RUNS the Phase 60 `computeIndexRollup` over the window's OWN recorded ledger counts + policy and requires the recorded `index` rollup (verdict, exit code, reason set, per-band counts, strict-escalation position) to re-derive; (A) it RE-RUNS the Phase 60 `reduceIndex` over the window's OWN per-record `points` sequence (reconstructed as ingested records) and requires the recorded ledger's post-cap counts (usable/unreadable/tampered, decision + cross-check distributions, newest/oldest, class) + the window arithmetic to re-derive — a hand-flipped index verdict is caught by (B), and a lied count consistent with it is caught by (A) against the sequence it summarizes; a window is `usable` only if BOTH re-derive. The stripped reconstruction is SAFE because `computeIndexRollup` reads only the ledger's unreadable/tampered/usable counts + decisionCounts + strict, and `reduceIndex` reads only each record's recognized/usable/decision + cross-check (verified against `release-decision-index/rollup.ts` + `release-decision-index/reduce.ts`). Each reducer copies no free-text field, drops each window's own stamp, and reduces each to bounded enums / small integers / booleans → `reduce` applies the `--max-windows` window cap (keeping the newest N, surfacing how many older were dropped), maps each considered window to a bounded point (coverage state `unreadable`/`tampered`/`usable`, trusted-or-claimed index verdict, severity, record count), and summarizes the history into a bounded summary (per-window index-verdict distribution + aggregate decision distribution over the usable windows, total record counts, newest/oldest usable verdict, an arc `direction` from ordered input positions, and a single coarse `trendClass`) → `rollup` derives the closed set of fired reason ids (`window-unreadable`/`window-tampered` invalid; `window-blocked`/`window-invalid`/`strict-nonclean` blocking; `no-usable-windows`/`only-insufficient` insufficient; `trend-degrading`/`window-watch`/`window-insufficient` advisory) and folds them with fail-closed precedence refined by the arc direction: any invalid input → `invalid`; else any blocking → `blocked`; else any insufficiency → `insufficient`; else a degrading arc → `degrading`, a recovery to a clean latest window → `improving`, a flat advisory history → `watch`, else `stable`. An untrustworthy input (an unreadable/tampered window) is `invalid` regardless (never a vacuous pass); `--strict` escalates any non-`stable` window to `blocked` (only an all-stable history passes) → `build` derives the ordered next-action checklist and assembles the `ReleaseDecisionTrendResult` (summary, points, trend, reasons, checklist, guidance, caveats) → `render`/`receipt`/`metrics`. It makes no cloud call, reads no provider export/secret/bucket, and signs/approves/publishes/promotes/deploys/notifies/deletes/mutates nothing — it is a content-free ledger-index TREND SUMMARY, not a legal audit log, a compliance attestation, an external approval/signature, an identity proof, or a deployment/promotion ledger. Emits `worker_release_decision_trend_total{verdict}`.
