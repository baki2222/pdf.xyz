# pdf.xyz

**Every PDF tool. Private by design.**

A modern, fast, privacy-first PDF platform. Most tools run entirely in your
browser — your files never leave your device — and the heavier operations are
routed to clearly-labeled secure workers (rather than faked client-side).

![CI](https://github.com/baki2222/pdf.xyz/actions/workflows/ci.yml/badge.svg)

- **Stack:** Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS v4
- **PDF engine:** `pdf-lib` (transform) + `pdfjs-dist` (render) — all in-browser
- **Testing:** Vitest (unit) · Playwright (e2e smoke)

---

## Project status

This is a production-grade **foundation** with a growing set of genuinely
working tools. We are deliberately honest in the UI and here about what is live
versus planned — no fake processing.

| Area | Status |
| --- | --- |
| Product site, tool catalog (50 tools), workspace, SEO, a11y | ✅ Live |
| Real in-browser tools: merge, split, rotate, delete/extract/organize pages | ✅ Live |
| Compress (in-browser size analyzer + lossless structural repack) | ✅ Live |
| Page thumbnails & visual page board (pdfjs) | ✅ Live |
| Editor depth: undo/redo, keyboard reordering, range selection, lazy large-PDF thumbnails, per-file merge validation | ✅ Live |
| Local-first workspace: multi-file staging, local PDF page counts, file-aware tool suggestions, browser-only handoff, batch launch | ✅ Live (local session only) |
| Production hardening: CSP/security headers, robots, sitemap, manifest, OG image, JSON-LD | ✅ Live |
| Client resilience & observability: error/not-found/loading boundaries, reusable error boundary, privacy-safe error + Web Vitals telemetry (inert unless an endpoint is set) | ✅ Live |
| Secure-worker contract + adapter, presence-only status probe, honest Compress UI integration | ✅ Live |
| Deep compression worker (Ghostscript/qpdf/mutool) — real, runnable via `PDFXYZ_WORKER_MODE=local-dev` | 🧪 Local-dev |
| OCR foundation: options/capability contract, honest OCR tool page + `/status` row, browser job client | ✅ Live (foundation) |
| Production storage + queue providers: S3/R2-compatible signed upload/download/delete storage, Redis/Upstash-compatible durable queue, per-provider `/status` readiness, honest `DELETE /api/jobs/:id` | ✅ Live (provider foundations) |
| Out-of-band worker daemon runner: `pnpm worker:daemon` drains the queue → executor → worker-side S3/R2 byte I/O and **completes real `compress-pdf` jobs** (lossless always; deep when a native engine is installed) — proven end-to-end over the S3 seam — with `--once`/`--drain`/`--dry-run-status` modes, useful sanitized output filenames, a `compression_health` deep-engine smoke signal, content-free logs, and a `daemon` `/status` readiness | ✅ Live (runner) |
| Worker deployment hardening: retention→lifecycle **policy generation/validation** (AWS S3/R2/MinIO/generic), composed **deployment readiness/posture** + honest not-implemented facets, and production **guardrails** that fail fast (exit `4`) on unsafe config — via `--dry-run-status` / `--check` / `--lifecycle-policy`; content-free, offline, no cloud calls | ✅ Live (ops tooling) |
| Redis queue atomicity + lease correctness: worker-owned transitions (claim commit, stale-lease redelivery, heartbeat, advance, finalize, requeue) run through frozen Redis `EVAL` compare-and-set scripts with status + lease-attempt preconditions, so a stolen/expired lease cannot resurrect or corrupt a job; a broker without atomic scripts fails as typed `unavailable`, and strict mode / `PDFXYZ_QUEUE_REQUIRE_ATOMIC` refuse a non-atomic queue | ✅ Live (queue hardening) |
| Malware-scan gate (Phase 22): an **optional ClamAV/clamd** scanner streams each input over INSTREAM and scans it **before** processing — an infected or unscannable upload is blocked terminally (no artifact, inputs wiped), a transient scan failure retries, and with nothing configured the honest no-op scans nothing and never reports a file as scanned. Presence-only readiness (`disabled`/`not-configured`/`ready`/`unavailable`), content-free logs/status, and an opt-in `PDFXYZ_WORKER_REQUIRE_SCAN` guardrail that fails `--check` (exit `4`) unless a usable endpoint is configured | ✅ Live (optional backend; run clamd as a sidecar) |
| OCR backend (Phase 23): an **optional, real** OCR **processor** on the out-of-band worker — shells out to **OCRmyPDF/Tesseract** with a fixed argv (no shell), hard timeout + byte ceilings, isolated temp with guaranteed cleanup, and a structural PDF check, producing a searchable PDF and/or text sidecar from **actual** recognition. **Off by default** (`PDFXYZ_OCR`): with nothing configured, `ocr-pdf` fails honestly as `not_implemented`, `status.ocr.available` is `false`, and the tool page mounts no uploader. The malware scan runs **before** OCR; recognized text lives only in the downloaded artifact and never leaks into logs/status/errors; presence-only readiness (`disabled`/`not-configured`/`unavailable`/`ready`) with an opt-in `PDFXYZ_WORKER_REQUIRE_OCR` guardrail. See [`docs/OCR_BACKEND.md`](docs/OCR_BACKEND.md) | ✅ Live (optional backend; the Phase 24 worker image ships the engine) |
| Worker image engine packaging + container proofs (Phase 24): the `worker` image now installs the native stack it advertises — Ghostscript/qpdf/mutool **and** OCRmyPDF/Tesseract + minimal English language data (`tesseract-ocr-eng`) — while the `web` image ships none. Two in-image smokes prove it with no cloud/secret/document: `pnpm worker:image-smoke` (compression + OCR binaries and English langdata present; `PDFXYZ_OCR=on` flips `ocr_health`→`ready`/`compression_health`→`deep`; native engines never fake drainability — `--dry-run-status` still exits `2`) and the node-free `pnpm worker:engines` preflight (production require-flags satisfied because the engines are present). Both run inside the built image on GitHub Actions; static tests pin the packages, the web↔worker split, the CI steps, and the smokes' presence-only, no-secret-echo hygiene. Docker isn't run locally — proof is those static tests + the container workflow | ✅ Live (image packaging + CI proof) |
| Secure-worker tools: Office ⇄ PDF, repair, PDF/A, compare, deep compression, irreversible redaction, e-sign | 🔜 Planned (production) |
| AI tools: chat, summarize, translate, extract | 🔜 Planned |

Every tool page states exactly where it runs (in-browser / secure worker /
hybrid / AI). Tools without a live engine render a polished,
implementation-ready overview instead of pretending to process files. See
[`docs/ENGINE_ROADMAP.md`](docs/ENGINE_ROADMAP.md) for the full plan and
[`docs/SECURITY.md`](docs/SECURITY.md) for the privacy model.

The `/workspace` hub stages files locally for the current browser tab only — it
never uploads them, page counts are parsed on-device, and only tool preferences
(never file names) persist. For supported in-browser tools, workspace launch now
uses a browser-only IndexedDB handoff: files are stored under an opaque,
single-use, short-lived local token and preloaded on the tool page, then the URL
parameter is consumed/removed. No server sees those bytes.

---

## Getting started

Requires **Node ≥ 20** and **pnpm** (pinned via the `packageManager` field).

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

No environment variables are required to run the app today — every live tool is
client-side. Client error/Web-Vitals telemetry is **opt-in**: it stays inert
unless you set `NEXT_PUBLIC_TELEMETRY_ENDPOINT`, and even then it only ever emits
redacted payloads (never file names, contents, or hand-off tokens). See
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the env policy and toggles, and
[`docs/SECURITY.md`](docs/SECURITY.md) for the telemetry privacy model.

### Optional: local-dev compression worker

The secure worker is off by default and the API answers `503 worker_not_configured`.
To exercise the real server-side compression flow on your own machine:

```bash
PDFXYZ_WORKER_MODE=local-dev pnpm dev
```

Open `/tools/compress-pdf` and add a PDF. The **lossless** path (pdf-lib) always
works; the **deep** image-downsampling path needs a native engine on your
`PATH` — install **Ghostscript, qpdf, or mutool** to enable it. Without one, the
tool honestly says deep compression is unavailable and the API records a
`not_implemented` job rather than faking a file. This mode is developer-only
(in-memory, single-instance) and never used in production — see
[`docs/WORKER_ARCHITECTURE.md`](docs/WORKER_ARCHITECTURE.md).

---

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the dev server |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm worker:daemon` | Run the out-of-band secure-worker daemon (`--once` / `--drain` / `--dry-run-status` / `--check` / `--lifecycle-policy`) — see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) |
| `pnpm worker:daemon:status` | Presence-only worker readiness probe (`--dry-run-status`); exits `0` drainable / `2` not configured. Used by the container health check |
| `pnpm worker:smoke` | No-config honesty smoke: asserts the daemon refuses to fake work (exit `2`), rejects bad flags (exit `1`), reports clean guardrails (exit `0`), and fails fast on a dangerous config (exit `4`) — no secrets or network. Also run inside the built worker image in CI |
| `pnpm worker:image-smoke` | Image-level native-engine + OCR proof — run inside the **built worker image** in CI: the deep-compression + OCR binaries and English OCR data are installed, `PDFXYZ_OCR=on` flips `ocr_health`→`ready`, and native engines never fake drainability. Presence-only; no cloud/secret/document |
| `pnpm worker:engines` | Node-free `command -v` engine preflight (`0` ok / `1` usage / `3` a required engine is missing). Honors the opt-in require-flags; runs anywhere, in or out of the image. Presence-only, content-free |
| `pnpm typecheck` | `tsc --noEmit` (strict) |
| `pnpm lint` | ESLint (flat config, `eslint-config-next`) |
| `pnpm test` | Unit tests (Vitest, run once) |
| `pnpm test:watch` | Unit tests in watch mode |
| `pnpm test:e2e` | Playwright smoke tests against a production build |
| `pnpm test:e2e:install` | Install the Chromium browser Playwright needs |
| `pnpm qa` | `typecheck` → `lint` → `test` → `build` (the pre-push gate) |
| `pnpm format` / `pnpm format:check` | Prettier write / check |

First-time e2e run:

```bash
pnpm test:e2e:install   # downloads Chromium (once)
pnpm build            # create production build
pnpm test:e2e         # boots `next start`, runs the smoke suite
```

---

## Architecture

```
src/
  app/                     App Router pages + metadata routes
    layout.tsx             Root layout, global metadata, landmarks
    page.tsx               Homepage (+ Organization/WebSite/WebApp/FAQ JSON-LD)
    tools/                 /tools catalog and /tools/[slug] tool pages
    workspace/             Private staging workspace (noindex)
    robots.ts sitemap.ts manifest.ts   Generated at build time
    icon.svg               Favicon / PWA icon
    opengraph-image.tsx    OG/Twitter share image (next/og + bundled font)
  components/
    layout/ sections/ ui/  Site chrome + landing sections + primitives
    tools/runner/          Client-side tool runners (merge/split/rotate/…)
    seo/json-ld.tsx        <script type="application/ld+json"> renderer
    upload/                Drag-and-drop staging zone
  lib/
    tools/                 Catalog, categories, processing metadata (source of truth)
    pdf/                   Engine (pdf-lib), renderer (pdfjs), registry of live runners
    seo.ts site.ts         Metadata builders + brand config
    structured-data.ts     schema.org builders
    faq.ts                 FAQ content shared by the section + FAQ JSON-LD
  assets/fonts/            Fonts used only to render the OG image at build time
e2e/                       Playwright smoke tests + fixtures
```

**Catalog-driven:** adding a `Tool` to `src/lib/tools/catalog.ts` automatically
wires the homepage grid, `/tools`, the dynamic `/tools/[slug]` page, search,
and the sitemap. Registering a slug in `src/lib/pdf/registry.ts` (plus a case in
the runner dispatcher) upgrades that page from overview to a live runner.

**Security headers / CSP** live in `next.config.mjs` (applied on every response,
dev-relaxed) and are asserted by the Playwright suite. Details in
[`docs/SECURITY.md`](docs/SECURITY.md).

---

## Deployment

Target host is **Vercel** on the **pdf.xyz** domain. Full setup, env policy, and
the preview → production workflow are in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

The secure worker is a **separate process**, never a Vercel function on the
request path. A multi-stage [`Dockerfile`](Dockerfile) exposes two independent
targets — `web` (the site, `pnpm start`) and `worker` (the daemon with
Ghostscript/qpdf/mutool **and** the OCRmyPDF/Tesseract OCR stack, `pnpm
worker:daemon`) — with an example
[`docker-compose.worker.yml`](docker-compose.worker.yml) and
[`.env.worker.example`](.env.worker.example) (placeholder names only, no secrets):

```bash
docker build --target worker -t pdfxyz-worker:local .   # deep-compression + OCR engines + daemon
docker build --target web    -t pdfxyz-web:local .       # site only, no engines
```

The image build is **not exercised in this repo's environment** (no Docker daemon
here); CI builds both targets on GitHub Actions
([`.github/workflows/container.yml`](.github/workflows/container.yml)) and, inside
the built worker image, runs the no-config honesty smoke (`pnpm worker:smoke`) plus
the native-engine + OCR proofs — `pnpm worker:image-smoke` and the node-free `pnpm
worker:engines` preflight — which confirm the packaged deep-compression and OCR
engines are present and report ready (presence-only, no document processed). The
Dockerfile/compose/CI invariants are pinned by static tests (`src/deploy/`). For a
full two-service production rollout — responsibilities, env by service, image
promotion, smoke, and rollback — see the [**production runbook**](docs/RUNBOOK.md);
the worker container checklist is in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## License

Proprietary — © pdf.xyz. All rights reserved.
