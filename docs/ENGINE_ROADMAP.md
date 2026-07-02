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
- `compress-pdf`: honest in-browser optimization analyzer and lossless structural repack. It does **not** pretend to downsample images when that is not available client-side.

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
- High-quality compression: image downsampling, font subsetting, object deduplication, qpdf/ghostscript-style optimization.
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

### Phase 6 — secure worker MVP

- Implement upload/job/status/download API contract.
- Ship first worker-backed tool: high-quality compression or OCR.
- Add automatic file deletion and public privacy proof points.

### Phase 7 — account and workspace

- Anonymous local workspace first.
- Optional account sync later.
- Saved workflows and batch processing.
- Team workspaces only after core consumer tools are excellent.

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
