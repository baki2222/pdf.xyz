# OCR backend (secure worker)

_Phase 23 — an **optional, real** OCR backend for the secure worker._

This document describes the OCR processing backend: exactly what it is, how to turn
it on, the security envelope it runs in, what it logs, and what remains a caveat. It
is the operator-facing companion to the OCR contract/UI foundation documented in
[`WORKER_ARCHITECTURE.md`](./WORKER_ARCHITECTURE.md).

## Honest state — read this first

- **OCR is OFF by default.** With nothing configured, an `ocr-pdf` job fails honestly
  with `not_implemented` and produces no artifact, `/api/worker/status` reports
  `ocr.available: false`, and the tool page mounts no uploader. This is true in every
  environment this build ships in unless an operator explicitly opts in (`PDFXYZ_OCR=on`)
  on a worker that has an engine installed — which the Phase 24 `worker` image now does
  by default (OCRmyPDF/Tesseract + English data), so on that image opting in is enough.
- **No faked OCR, ever.** The backend produces artifacts only from *actual*
  recognition by a native engine. Tests may inject a deterministic fake runner, but
  product copy and status never claim OCR is available unless a real backend is
  configured and present.
- **OCR runs only on the out-of-band worker daemon**, never in the web app or the
  in-process local-dev worker. Turning a scan into a searchable PDF needs a native
  engine, so it belongs on the secure worker only. The web bundle never imports the
  Node-only OCR runner (enforced by `src/deploy/import-boundary.test.ts`).

## Architecture

The OCR backend mirrors the native-compression seam exactly — a node-free contract,
a node-free config parser, and a Node-only subprocess runner, all dependency-injected:

| Piece | Module | Node? |
| --- | --- | --- |
| OCR options contract + validator | `src/lib/jobs/ocr.ts` | no |
| OCR **result-metadata** type + builder (`buildOcrResultMeta`) | `src/lib/jobs/ocr.ts` | no |
| OCR capability mapping (presence-only) | `src/lib/workers/ocr.ts` | no |
| OCR **processor** (contract → `Processor`, flattens meta) | `src/lib/workers/processor/ocr.ts` | no |
| OCR **native config** (env → bounded config) | `src/lib/workers/ocr-native-config.ts` | no |
| OCR **native runner** (OCRmyPDF/Tesseract, measures meta) | `src/lib/workers/ocr-native.ts` | **yes** |
| Daemon runtime wiring | `src/lib/workers/daemon/runtime.ts` | yes |

The `OcrRunner` is an injected dependency of the OCR processor. With none injected
the processor is honestly not ready (`not_implemented`); when the daemon runtime wires
`nativeOcrDeps(env)` it flips on **only** if OCR is enabled *and* an engine is present.
The processor never fabricates output and never throws — a runner failure is caught
and mapped to a typed, content-free error.

The job flow is unchanged from every other secure-worker tool: create upload session →
direct upload → create job → **malware scan gate (Phase 22)** → OCR → download → auto
-delete. The malware scan runs *before* OCR, so an infected input is blocked before any
recognition (proven in `src/lib/workers/ocr-backend.test.ts`).

## Enabling OCR

OCR is opt-in via environment variables (read only by the worker daemon — the web app
never reads them). **No value is ever logged or returned to a client.**

| Variable | Meaning | Default |
| --- | --- | --- |
| `PDFXYZ_OCR` | Master opt-in switch (`on`/`off`/`true`/`false`/`auto`). **Unset ⇒ disabled.** | disabled |
| `PDFXYZ_OCR_ENGINE` | Pin to one engine: `ocrmypdf` or `tesseract`. Unset ⇒ auto-detect (OCRmyPDF preferred). | auto |
| `PDFXYZ_OCR_OCRMYPDF_BIN` | Absolute path override for the `ocrmypdf` binary. | `ocrmypdf` on `PATH` |
| `PDFXYZ_OCR_TESSERACT_BIN` | Absolute path override for the `tesseract` binary. | `tesseract` on `PATH` |
| `PDFXYZ_OCR_TIMEOUT_MS` | Hard per-job subprocess timeout. Clamped to `[1000, 1800000]`. | `300000` (5 min) |
| `PDFXYZ_OCR_MAX_INPUT_BYTES` | Max input size accepted. Clamped to `[1024, 2 GiB]`. | `200 MiB` |
| `PDFXYZ_OCR_MAX_OUTPUT_BYTES` | Max output size accepted from the engine. Clamped to `[1024, 2 GiB]`. | `500 MiB` |
| `PDFXYZ_OCR_TMPDIR` | Base temp dir for isolated per-job dirs. Absolute, no traversal. | OS temp dir |

Turning `PDFXYZ_OCR=on` is necessary but **not sufficient**: OCR reports ready only
when a supported engine is actually installed. If enabled with no engine present, the
daemon reports OCR `not-configured` and `ocr-pdf` jobs still fail as `not_implemented`.

### Requiring OCR in production

OCR is optional, so `PDFXYZ_WORKER_STRICT` alone never demands it (a worker that does
not offer OCR is a legitimate deployment — same posture as `require deep engine` and
`require scan`). An operator who *ships* OCR arms it explicitly:

| Variable | Effect |
| --- | --- |
| `PDFXYZ_WORKER_REQUIRE_OCR` | Require a **ready** OCR backend. `--check`/startup fail fast (exit 4, `require_ocr_unmet`) if OCR is disabled, not opted in, or opted in with no engine installed — rather than accepting `ocr-pdf` jobs that would only fail. |

Independently, a **malformed** `PDFXYZ_OCR*` value (unknown enable token, unknown
engine pin, unsafe binary path, out-of-bounds limit) is always surfaced as a
guardrail error (`ocr_config_invalid`) — a typo can't silently disable OCR. A bare
environment (OCR unset) is clean and produces no OCR guardrail.

Confirm the wiring without processing anything:

```sh
pnpm worker:daemon --dry-run-status   # look for the `processor` line with id "ocr"
```

- OCR off → `processor { id: "ocr", ready: false, detail: "OCR isn't enabled…" }`
- OCR on, engine present → `processor { id: "ocr", ready: true, detail: "OCR ready on ocrmypdf…" }`
- OCR on, no engine → `processor { id: "ocr", ready: false, detail: "OCR is enabled, but no OCR engine … is installed…" }`

The daemon also emits a dedicated **`ocr_health`** line — `{ enabled, engine, ready,
detail }` — that fuses the config opt-in (`enabled`) with the runtime engine probe
(`ready`), so an operator can distinguish all four honest states at a glance:

| `ocr_health` | State |
| --- | --- |
| `enabled: false` | **disabled / not-configured** (the safe default) |
| `enabled: true`, `ready: false` | **unavailable** (opted in, but no engine installed) |
| `enabled: true`, `ready: true` | **ready** (a real engine can run OCR now) |

The composed deployment readout also carries an `ocr` facet with the matching state
(`ready` / `not-configured` / `not-implemented`). All of it is content-free — the
engine *family* name and prose only, never a path, binary, language, or value.

## Deployment requirements

To genuinely complete OCR jobs, the worker needs:

1. A drainable queue + object storage (the standard daemon requirement — OCR does not
   change this).
2. **A native OCR engine installed on the worker.** The Phase 24 `worker` Docker image
   now **ships this stack by default** — [OCRmyPDF](https://ocrmypdf.readthedocs.io/)
   plus Tesseract and the minimal English language data (`tesseract-ocr-eng`) — so on
   that image nothing extra is needed to run English OCR. OCRmyPDF is the real PDF-OCR
   tool; it wraps Tesseract and Ghostscript and adds an invisible text layer to the
   original pages. If you build your own image or host, install the same packages, e.g.
   on Debian/Ubuntu:

   ```sh
   apt-get install -y ocrmypdf tesseract-ocr tesseract-ocr-eng \
     tesseract-ocr-spa tesseract-ocr-fra   # …and any extra language packs you enable
   ```

3. `PDFXYZ_OCR=on` in the daemon's environment. (`PDFXYZ_OCR=on` is necessary but not
   sufficient — an engine must also be installed, which on the shipped worker image it
   already is.)

Tesseract alone (`PDFXYZ_OCR_ENGINE=tesseract`) is supported for **image** inputs
(PNG/JPEG); it cannot OCR a PDF directly. Prefer OCRmyPDF for the PDF-first flow — both
are on the worker image, and auto-detect prefers OCRmyPDF.

**Language packs.** The worker image ships **English only** (`tesseract-ocr-eng`). The
advertised language allowlist lives in `src/lib/jobs/ocr.ts`; only install/enable packs
you actually ship — add the matching `tesseract-ocr-<lang>` package (and extend the
allowlist alongside it, never ahead of it) for any language beyond English.

### Image-level proof (no cloud, no document)

The worker image's engine contract is proven two ways in the container workflow
([`.github/workflows/container.yml`](../.github/workflows/container.yml)), both running
inside the freshly built image with nothing wired and processing no document:

- **`pnpm worker:image-smoke`** — asserts the deep-compression and OCR binaries and the
  English language data are installed, that opting in with `PDFXYZ_OCR=on` flips the
  daemon's `ocr_health` to `ready: true` (and `compression_health` to `deep: true`), and
  that native engines never fake drainability (`--dry-run-status` still exits `2` with no
  queue/storage). It reads readiness **presence-only** from the content-free health lines
  — no path, binary, language, or value is echoed.
- **`pnpm worker:engines`** — a node-free `command -v` preflight, run with the production
  require-flags armed (`PDFXYZ_WORKER_REQUIRE_OCR`, `PDFXYZ_WORKER_REQUIRE_DEEP_ENGINE`);
  it must exit `0` **because** the image genuinely ships the engines. Its negative path —
  the same flags failing on a bare host — is proven Docker-free in
  `src/deploy/worker-engines.test.ts`.
- **`pnpm worker:ocr-proof`** (Phase 25) — the deterministic **recognition** proof. After
  presence is established, it generates a tiny synthetic raster of a fixed sentinel word
  with Ghostscript (a pure image, **no** text layer), OCRs it with the packaged Tesseract
  baseline to a searchable PDF + text sidecar, and asserts the sidecar — normalized to
  letters/digits — **contains the sentinel**. That is real recognition end-to-end, not a
  structural fluke. It uses **no** user document, cloud service, secret, queue, store, or
  scanner; its output is presence-only and content-free (it never prints a temp path or the
  recognized text); and it always removes its temp dir on success, failure, or signal. It
  runs in the container workflow *after* `worker:engines`. Its whole plumbing — the
  prerequisite-missing exit `2`, the enforced-sentinel exit `3`, and the temp cleanup — is
  proven Docker-free with stub engines in `src/deploy/worker-ocr-proof.test.ts`.

Docker is not available in this repository's environment, so the images are **not** built
here; these smokes run on GitHub Actions, and the Dockerfile/CI invariants are pinned
by `src/deploy/artifacts.test.ts` and `src/deploy/ci-workflow.test.ts`.

**What the synthetic proof does and does not establish.** It proves the packaged Tesseract
baseline can turn a generated raster of known text into a searchable PDF + text sidecar and
recognize the expected sentinel — a genuine, deterministic recognition path on a
non-user-document fixture. It does **not** prove production OCR *quality*, OCRmyPDF's
PDF→searchable-PDF path, any non-English language pack, or anything about real user
documents/traffic. Those remain out-of-band validation on a running worker.

## Security envelope

The native runner (`ocr-native.ts`) is the only OCR module that touches Node built-ins,
and it is bounded on every axis — the same hardening as native compression:

- **Opt-in + kill switch.** OCR shells out to a subprocess, so it never runs without
  an explicit `PDFXYZ_OCR` opt-in; a malformed config degrades to fully *disabled*
  rather than half-on.
- **No shell, ever.** The engine is invoked with a fixed **argv array** via
  `execFile` — no shell, no string-concatenated command line, no interpolation. Input,
  output, and sidecar paths are worker-owned temp paths (never a user-supplied path),
  so a filename or option can never be reinterpreted as a flag or shell syntax.
- **Binary allowlist.** A binary override is accepted only as a safe **absolute path**
  for one of the two known engines (validated for no `..`, no shell metacharacters);
  otherwise the fixed command name is auto-detected on `PATH` (presence only, never
  executed during detection).
- **Bounded resources.** Hard subprocess **timeout**, hard **input** and **output**
  byte ceilings (all clamped to fixed maxima), and a structural PDF check on the
  searchable-PDF output before it is accepted as an artifact.
- **Isolated temp + guaranteed cleanup.** Each job writes into a fresh `mkdtemp` dir;
  the dir is removed on **every** exit path — success, engine failure, or timeout.
- **Single document.** OCR runs over exactly one input file; a multi-file request is
  rejected.
- **Fail-closed honesty.** A runner failure (unreadable input, engine crash, timeout,
  oversized/invalid output, empty output) becomes a typed job failure with no
  artifact — never a fabricated searchable PDF or invented text.

### Content-free logs & errors

Nothing OCR-related ever leaks a filename, object key, URL, byte content, command
line, binary path, **recognized OCR text**, or secret:

- The native runner throws **fixed, content-free** messages; the processor maps any
  throw to `internal_error` with a fixed client message (the raw error text is
  discarded).
- The executor and daemon log only opaque ids, the tool slug, an attempt number, and
  an error **code** — the same content-free structured logging as every other job.
- The recognized text lives **only** in the artifact bytes the user downloads; it is
  never logged, echoed in status, or placed in a job record. This is asserted directly
  in `ocr-backend.test.ts` (a sentinel string in the text sidecar must not appear in
  the job record or any log event).

## Result metadata (Phase 25)

A successful OCR job now attaches **safe, bounded, structural metadata** to its result,
derived from the *actual* run — never estimated or fabricated. The shape is
`OcrResultMeta` (`src/lib/jobs/ocr.ts`), built by the pure `buildOcrResultMeta` and
measured by the native runner; the processor flattens it onto the content-free
`ProcessorMeta` seam it already carries for compression.

| Field | Meaning | When `null` |
| --- | --- | --- |
| `engine` | Engine family that ran (short token, e.g. `ocrmypdf`) | never (sanitized to a safe token) |
| `languages` | Validated, de-duplicated recognition languages (allowlist codes only) | never (may be empty) |
| `outputMode` | What was requested/produced (`searchable-pdf`/`text`/`both`) | never |
| `producedSearchablePdf` / `producedTextSidecar` | Which artifact kinds were produced | never |
| `pageCount` | Structural page count of the produced searchable PDF (best-effort, pdf-lib) | no PDF produced, unparseable, or above the 64 MiB parse ceiling |
| `textCharacters` | Character **count** of the produced text sidecar | no sidecar, or above the 32 MiB measure ceiling |
| `meanConfidence` | Mean recognition confidence in `[0, 1]` **only if a backend safely reports it** | always for the native backend (it exposes none) |

The honesty rules the builder enforces:

- **No recognized text, ever.** Counts are counts — the character count is the sidecar's
  length, never its contents. `pageCount` is a structural page count of the *output* PDF.
  Nothing in the metadata is a filename, object key, signed URL, temp path, command path,
  or secret. This is asserted directly (`JSON.stringify(meta)` must not contain the
  recognized text) in `ocr-native.test.ts`.
- **Missing is allowed; fabricated is not.** A value that can't be safely determined is
  `null` — a null page count is honest, an invented one is forbidden. `meanConfidence`
  stays `null` because OCRmyPDF/Tesseract expose no safe document-level confidence here; we
  never invent one.
- **Bounded & schema-stable.** Counts are coerced to non-negative integers and clamped to
  fixed maxima; the field set never varies by engine or option; the language set is filtered
  to the allowlist and capped. Metadata extraction is itself bounded — a very large PDF or
  sidecar reports `null` ("not measured") rather than paying unbounded cost.

Metadata rides on the processor's success result (the same seam compression uses). It is
safe to log, persist, or return — but note the executor does **not** currently thread it
into the job record, so it is not yet surfaced to a client; wiring that through is future
work, and the safety guarantees above are what make it safe to do so.

## Observability

- **Readiness:** `pnpm worker:daemon --dry-run-status` emits a `processor` line for
  `ocr` (`ready` + content-free `detail`), an `ocr_health` line (`enabled`/`ready`/
  `engine`), and an `ocr` facet in the deployment readout. OCR never blocks
  drainability; it affects the exit code only when an operator opts into the
  `require-ocr` guardrail or ships a malformed `PDFXYZ_OCR*` config (see *Requiring OCR
  in production* above).
- **Per-job:** a completed OCR job logs `claimed → scanning → [scan_clean] → processing
  → completed`; a failure logs the terminal event with an error **code** only. There is
  no OCR-specific log field — by design, so no recognition detail can leak.
- **Failure codes** a client may see: `not_implemented` (OCR not enabled / no engine),
  `unprocessable_entity` (bad languages/options), `malware_detected` / `scan_invalid`
  (blocked by the scan gate), `internal_error` (engine failed — retryable, bounded by
  the attempt cap).

## Caveats & roadmap

- **Synthetic recognition is proven; production quality is not.** Phase 25 adds a
  deterministic recognition proof (`worker:ocr-proof`, run in the container workflow inside
  the built image) that turns a generated raster of a known sentinel into a searchable PDF +
  sidecar and verifies the sentinel is recognized — genuine OCR on a non-user-document
  fixture. This repository's own environment has **no Docker daemon and no engine
  installed**, so that proof runs on GitHub Actions, and the native runner is *also* proven
  here via injected fakes (deterministic runner + injected `exec`/`fs`/PATH/`countPages`
  seams) — every argv, temp-lifecycle, bound, failure, metadata, and cleanup branch
  unit-tested without a binary. What none of this establishes: production OCR **quality**,
  OCRmyPDF's PDF→searchable-PDF path, non-English language packs, or real user
  documents/traffic. Those remain out-of-band validation on a running worker.
- **Result metadata is populated but not yet surfaced to clients.** The native runner now
  measures a bounded `OcrResultMeta` (see *Result metadata* above) and the processor
  attaches it to its success result, but the executor does not thread it into the job
  record, so it is not returned to a client yet. Doing so is future work; the metadata's
  content-free, bounded guarantees are what make it safe.
- **Retryable failures are coarse.** The `OcrRunner` seam is throw-based, so the
  processor treats any runner failure as a retryable `internal_error`; a *deterministic*
  failure (e.g. a corrupt input) therefore exhausts the attempt cap before failing
  terminally. A future refinement can give the runner a discriminated result (like the
  compression engine's) for precise `not_implemented` / `payload_too_large` /
  `unprocessable_entity` classification.
- **Determinism.** OCRmyPDF embeds timestamps, so native output is not byte-stable;
  only the injected fake runner used in tests and the synthetic proof's structural/sentinel
  checks are deterministic.
