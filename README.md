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
| OCR foundation: options/capability contract, honest OCR tool page + `/status` row, browser job client (no processor yet) | ✅ Live (foundation) |
| Secure-worker tools: Office ⇄ PDF, repair, PDF/A, compare, deep compression, irreversible redaction, e-sign, + the OCR **processor** | 🔜 Planned (production) |
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

## License

Proprietary — © pdf.xyz. All rights reserved.
