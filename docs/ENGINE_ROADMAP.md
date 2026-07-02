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
