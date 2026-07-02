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
  environment this build ships in unless an operator explicitly opts in **and**
  installs an engine.
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
| OCR capability mapping (presence-only) | `src/lib/workers/ocr.ts` | no |
| OCR **processor** (contract → `Processor`) | `src/lib/workers/processor/ocr.ts` | no |
| OCR **native config** (env → bounded config) | `src/lib/workers/ocr-native-config.ts` | no |
| OCR **native runner** (OCRmyPDF/Tesseract) | `src/lib/workers/ocr-native.ts` | **yes** |
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

To genuinely complete OCR jobs, the worker image/host must have:

1. A drainable queue + object storage (the standard daemon requirement — OCR does not
   change this).
2. **[OCRmyPDF](https://ocrmypdf.readthedocs.io/) installed** (recommended). OCRmyPDF
   is the real PDF-OCR tool; it wraps Tesseract and Ghostscript and adds an invisible
   text layer to the original pages. Install it and the language packs you advertise,
   e.g. on Debian/Ubuntu:

   ```sh
   apt-get install -y ocrmypdf tesseract-ocr \
     tesseract-ocr-eng tesseract-ocr-spa tesseract-ocr-fra   # …and the packs you enable
   ```

3. `PDFXYZ_OCR=on` in the daemon's environment.

Tesseract alone (`PDFXYZ_OCR_ENGINE=tesseract`) is supported for **image** inputs
(PNG/JPEG); it cannot OCR a PDF directly. Prefer OCRmyPDF for the PDF-first flow.

**Language packs.** The advertised language allowlist lives in `src/lib/jobs/ocr.ts`.
Only install/enable packs you actually ship — extend the allowlist alongside the packs,
never ahead of them.

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

- **This repository cannot exercise a real engine.** OCRmyPDF/Tesseract are not
  installed here, so the native path is proven via injected fakes (deterministic
  runner + injected `exec`/`fs`/PATH seams) plus the CLI status/check smoke — exactly
  as native compression is. Every argv, temp-lifecycle, bound, failure, and
  cleanup branch is unit-tested without a binary. Real end-to-end recognition must be
  validated on an image/host that has the engine installed.
- **Retryable failures are coarse.** The `OcrRunner` seam is throw-based, so the
  processor treats any runner failure as a retryable `internal_error`; a *deterministic*
  failure (e.g. a corrupt input) therefore exhausts the attempt cap before failing
  terminally. A future refinement can give the runner a discriminated result (like the
  compression engine's) for precise `not_implemented` / `payload_too_large` /
  `unprocessable_entity` classification.
- **Result metadata.** `OcrResultMeta` (pages processed, characters, confidence) is
  defined in the contract but not yet populated by the native runner — the runner
  returns validated artifacts only, never estimated stats. Populating it from real
  recognition output is future work.
- **Determinism.** OCRmyPDF embeds timestamps, so native output is not byte-stable;
  only the injected fake runner used in tests is deterministic.
