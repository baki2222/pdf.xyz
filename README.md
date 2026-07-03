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
| OCR metadata + deterministic recognition proof (Phase 25): a successful OCR job attaches **bounded, content-free** metadata (`OcrResultMeta` — engine family, validated languages, output mode, produced artifact kinds, output **page count**, sidecar **character count**), measured from the actual run — no recognized text, path, or fabricated value (`meanConfidence` stays `null`; nulls are honest). And `pnpm worker:ocr-proof` proves the packaged Tesseract baseline actually **recognizes** text: Ghostscript renders a synthetic sentinel raster, Tesseract OCRs it to a searchable PDF + sidecar, and the sidecar must contain the sentinel — a non-user-document proof, presence-only/content-free, self-cleaning, run in the container workflow after the presence smokes. Docker-free tests pin the metadata bounds/no-leak and the script hygiene | ✅ Live (metadata populated; synthetic recognition proven in CI) |
| OCR metadata surfaced to the client (Phase 26): the bounded `OcrResultMeta` a completed OCR job produces is now threaded onto the client-facing **job record** (`Job.results.ocr`) and returned by `GET /api/jobs/:id`, so the OCR tool shows a structural **"Recognition summary"** (pages · output kind · languages · character count) — never recognized text. One redaction boundary (`sanitizeJobResults`) re-bounds every write and collapses the engine to the closed `ocrmypdf`/`tesseract`/`unknown` family set, so no path/version/key/URL/secret can ride in; `results` is written only on a genuinely completed job and dropped with the artifacts on cancel/expire. A compression or failed/blocked job never grows a `results` block. The recognized text itself stays **download-only** in the artifact | ✅ Live (metadata on job record + API + UI summary) |
| OCRmyPDF searchable-PDF proof + metadata fidelity (Phase 27): `pnpm worker:ocrmypdf-proof` proves the packaged **OCRmyPDF** path turns an **image-only PDF** (Ghostscript `pdfimage`) into a genuinely **searchable** PDF — it confirms with `pdftotext` that the source yields no selectable text, OCRs it by fixed argv, then confirms the **output** yields the sentinel (image-only → searchable), corroborated by the sidecar. Runs inside the built worker image in CI after the recognition proof; `pdftotext` (`poppler-utils`) is worker-image-only, **proof-only** tooling (never on the OCR runtime path; the web image ships none). The native runner now measures the metadata from the **produced** artifacts — the searchable-PDF page count comes from the produced PDF's bytes (never the input), so the produced-kind flags/counts can't drift and a missing output fabricates nothing. Docker-free tests pin the proof hygiene, the worker↔web split, and the searchable-PDF metadata fidelity. Still out-of-band: production OCR **quality**, **non-English** packs, real **user** documents | ✅ Live (searchable-PDF proven in CI; metadata fidelity tightened) |
| Worker observability + SLOs (Phase 28): the out-of-band worker now emits **content-free** operational metrics and SLOs alongside its structured logs. A bounded metric schema (`worker_run_total`, `worker_tick_total`, `worker_processor_total`/`_latency_seconds`, `worker_scan_total`, `worker_storage_ops_total`, `worker_readiness`, `worker_engine_capability`, lifecycle + job-terminal counters) is emitted at the executor/daemon/storage seams — every label is a fixed enum or coarse bucket (latency/depth/age bucketed **at construction**), never a filename, key, endpoint, env value, signature, OCR text, or job/user id, enforced by a `sanitizeMetric` allowlist. Pure SLO helpers (`evaluateSlos`) compute job success rate, p95/p99 latency (honest histogram-bucket estimates), retry/dead-letter/scanner-unavailable rates, and queue/engine/lifecycle health — `unknown` on missing data, never a green default. `GET /api/worker/operations` returns a web-vantage health snapshot (one recommended next action, honest `daemonObserved:false`); `worker:daemon --dry-run-status`/`--check`/run modes emit content-free `operations`/`metrics`/`slo` JSON lines. Provider-neutral dashboard/alert examples ([`docs/examples/observability/`](docs/examples/observability/)) plus a canonical Prometheus text export (`renderPrometheus`) adapt it to any backend — no hosted dependency, no egress. Offline tests pin the schema/label bounds, SLO math, no-leakage, runtime emission, and the examples | ✅ Live (content-free metrics/SLOs; bring your own backend) |
| Worker heartbeat/liveness (Phase 30): an optional `PDFXYZ_WORKER_HEARTBEAT` seam lets an out-of-band daemon publish a bounded content-free heartbeat to the configured Redis/Upstash job-queue broker. `/api/worker/operations` reads it back through a node-free provider and sets `daemonObserved:true` only for a fresh beat; stale beats trigger `investigate-worker-liveness`, missing beats are `unknown`, and disabled remains the honest default. The record contains only fixed enums, booleans, a coarse `major.minor` release, and a timestamp used solely to derive a coarse age bucket — never hostnames, PIDs, container IDs, endpoints, keys, filenames, OCR text, scanner signatures, or secrets | ✅ Live (optional heartbeat; no fake liveness) |
| Deployment blueprints + ops-check scheduler templates (Phase 32): provider-neutral examples under [`docs/examples/deployment/`](docs/examples/deployment/) cover Docker Compose, Kubernetes, systemd daemon/timer units, cron, and a GitHub Actions fixture gate for `worker:ops-check`. They are **static blueprints**, not a live deployment: real cloud resources, secrets, DNS/TLS, Docker/Kubernetes execution, and pagers remain operator-owned. `pnpm deploy:examples:check` plus static tests validate placeholders, command semantics, and no-secret/no-endpoint leakage without needing Docker or a cluster | ✅ Live (validated templates; operator-owned infra) |
| Worker operations dashboard on `/status` (Phase 29): the `/status` page now renders the content-free `/api/worker/operations` snapshot as an **operator dashboard** beneath the user capability summary — an overall **health class** (`ok`/`warn`/`blocked`/`unknown`), the single **recommended next action**, a per-subsystem grid, lifecycle-verification + engine/OCR proof cards, and (worker-vantage only) a last-loop card, with graceful loading/error/retry. A hardened client parser (`normalizeSnapshot`) narrows the response to **bounded enums, booleans, and clamped integers** mapped to **client-authored copy**, so an injected endpoint, object key, filename, signed URL, recognized text, or secret in any server field has nowhere to surface. From the web vantage `daemonObserved` is `true` **only** when Phase 30 heartbeat observation is explicitly enabled and a fresh provider-backed heartbeat is visible; disabled/stale/absent heartbeats stay honest (`false` with disabled/stale/unknown copy), so the dashboard never invents daemon liveness. Reading the snapshot emits a privacy-safe `worker_operations_checked` event (bounded enums only). Docker-free tests pin the healthy/degraded/unknown/disabled/liveness states, the failure+retry flow, content-free rendering, and a11y basics | ✅ Live (operator dashboard on `/status`) |
| Operator healthcheck + alert evaluation (Phase 31): `pnpm worker:ops-check` folds the content-free operations snapshot (+ an optional SLO metric window) and the Phase 30 heartbeat into a **single alert verdict + exit code** a cron job / uptime monitor / process supervisor / CI gate keys on — no metrics backend, no pager. A pure alert policy (`evaluateOperationsAlerts`) maps the snapshot onto bounded severities (`ok`/`warn`/`critical`/`unknown`), reasons, and actions — all fixed enums with code-authored copy. Sources `--runtime`/`--web`/`--stdin`/`--file`, formats `--json`/`--prometheus`/`--text`, and a paranoid ingest path that re-authors a monitor-supplied snapshot so an injected filename/key/endpoint/secret can never survive. Exit codes `0` ok / `1` usage / `2` unknown / `3` warn / `4` critical. The same content-free posture is attached to `GET /api/worker/operations` and rendered as an **Alert posture** callout on `/status`. Runnable fixtures ([`docs/examples/observability/healthcheck/`](docs/examples/observability/healthcheck/)) + offline tests pin every verdict, exit code, and the no-leak contract | ✅ Live (offline alert evaluation; bring your own scheduler + pager) |
| Public-API abuse guard + rate limiting (Phase 33): a small in-app guard (`src/lib/ratelimit`) puts typed per-action policies in front of every public API route (`uploads.create`, `jobs.create`, `jobs.status`, `jobs.delete`, `artifacts.fetch`, `worker.status`, `worker.operations`). On deny it returns `429 rate_limited` with a `Retry-After` header and a **content-free** body. It is **off by default and fails open** — with no provider set every request is allowed (`enforced:false`), so the default build, e2e, and local-first browser tools are byte-for-byte unchanged. `PDFXYZ_RATE_LIMIT_PROVIDER=local-memory` enables a real **per-process** in-memory limiter; a remote name (`redis`/`upstash`) activates the shipped **distributed** provider (Phase 34) — a Redis/Upstash-REST store with an **atomic fixed-window `EVAL`** (`INCR`+`PEXPIRE`+`PTTL`, never a race-prone get-then-set), auto-registered at boot from `src/instrumentation.ts` on its own web-safe `PDFXYZ_RATE_LIMIT_REDIS_REST_*` credentials (kept distinct from the worker-only queue names so the public web pod carries no worker secret), reporting `remote`/enforced across every instance — or, with no store wired, resolves to `remote-unimplemented` and **skips honestly**, never faking distributed enforcement. On a store error it degrades per `PDFXYZ_RATE_LIMIT_FAIL_MODE` (`open` default ⇒ allow; `closed` ⇒ `429`). Decisions carry only allow/deny, policy id, provider, `enforced`, and an exact + coarse-bucketed retry-after — never an IP, UA, filename, token, key, job id, env value, or body; the store sees only an opaque salted-hash bucket token; client attribution (`PDFXYZ_RATE_LIMIT_TRUST_PROXY`, off by default) is salted-hashed and never retained. **Honest caveat: `local-memory` is not distributed enforcement** (behind N instances the budget is N×; a restart resets windows) — select the `redis`/`upstash` provider (or a real edge/WAF) before a high-traffic launch. Offline tests pin the limiter math, the atomic script + op... [truncated]
| Upload intake guardrails (Phase 35): secure-worker upload sessions and job creation now pass through a typed, content-free intake layer (`src/lib/uploads/intake`) **before** storage or queue work. The guard rejects too many files, declared over-size files/requests, hostile/path-like filenames, unsupported or MIME/extension-mismatched types, and — when explicitly opted in — local-dev PDF bytes missing bounded `%PDF-` / `%%EOF` markers. Order is deterministic (abuse guard → intake → tool validation); defaults mirror `JOB_LIMITS`, so browser/local-first tools and no-config secure-worker honesty are byte-for-byte unchanged. Errors use stable codes (`invalid_upload_request`, `unsupported_file_type`, `too_many_files`, `file_too_large`, `request_too_large`, `malformed_pdf`) and never echo filenames, object keys, signed URLs, request bodies, or bytes. Structural byte sniffing is deliberately **not** malware scanning or PDF sanitization; worker-side scanning/soundness checks remain separate. Offline tests pin the policy parsing, family allowlist, bounded PDF sniff, route codes, and the no-leak contract | ✅ Live (content-free upload boundary) |
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
| `pnpm worker:ops-check` | Operator healthcheck (Phase 31): evaluate the content-free operations posture (+ optional SLO window) into an alert verdict a monitor keys on. Sources `--runtime`/`--web`/`--stdin`/`--file`; formats `--json`/`--prometheus`/`--text`; exits `0` ok / `1` usage / `2` unknown / `3` warn / `4` critical — see [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md#operator-healthcheck--alert-evaluation-phase-31) |
| `pnpm worker:cleanup-check` | Storage-artifact cleanup verifier (Phase 42): prove, from content-free evidence exported out-of-band, whether artifacts that should be gone are actually **absent** (active delete-now vs bucket lifecycle backstop) or only retrieval-denied. Sources `--stdin`/`--file` (default: report env posture); formats `--json`/`--prometheus`/`--text`; `--grace-hours=N` (default 48); exits `0` verified / `1` usage / `2` unknown·unavailable·not-configured / `3` drift — see [`docs/RUNBOOK.md`](docs/RUNBOOK.md) |
| `pnpm worker:artifact-cleanup` | Storage-artifact cleanup **dry-run sweeper** (Phase 42): categorize an offline, content-free inventory of PRESENT object metadata into `expired-but-present`/`deleted-but-present`/`missing-lifecycle`/`missing-manifest`/`unsupported-kind`/`storage-unavailable`/`ok`, with an optional content-free cleanup plan (counts + actions only). Sources `--stdin`/`--file`; formats `--json`/`--text` (`--plan`/`--breakdown`/`--metrics`); exits `0` clean / `1` usage / `2` unknown / `3` cleanup-recommended / `4` invalid·breached. Dry-run only — never lists a real bucket, never deletes — see [`docs/RUNBOOK.md`](docs/RUNBOOK.md) |
| `pnpm worker:cleanup-project` | Cleanup evidence **exporter / projector** (Phase 43): the safe bridge into the two tools above. Projects your own out-of-band raw provider export (`aws s3api list-objects-v2`/`head-object`, or a normalized dump) into a content-free `--target=evidence` (for `worker:cleanup-check`) or `--target=inventory` (for `worker:artifact-cleanup`) document, reading ONLY a bounded allowlist and **dropping every** object key/bucket/URL/endpoint/id/ETag/filename/user-metadata. A redaction/normalization helper — **not** proof of deletion, **not** a cloud scanner: it makes no cloud call and deletes nothing. Sources `--stdin`/`--file`; `--source=aws-s3|generic`; embeds a content-free receipt; exits `0` projected / `1` usage / `2` insufficient / `4` unsafe — see [`docs/RUNBOOK.md`](docs/RUNBOOK.md) |
| `pnpm worker:cleanup-pipeline` | Cleanup evidence **pipeline** (Phase 44): the one fail-closed command that composes the three tools above. Reads your out-of-band raw export **once**, projects it into both shapes, runs the absence verifier **and** the dry-run sweeper internally, and rolls the two arms into ONE composite exit code. Read-only, no cloud call, deletes nothing. Sources `--stdin`/`--file`; `--source=aws-s3\|generic`; `--grace-hours=N`; formats `--json`/`--text`; embeds a content-free receipt; exits `0` ok / `1` usage / `2` unknown / `3` drift / `4` breach — see [`docs/RUNBOOK.md`](docs/RUNBOOK.md) |
| `pnpm worker:ops-bundle` | Operations evidence bundle (Phase 45): compose an existing content-free `worker:ops-check --json` result plus an optional `worker:cleanup-pipeline --json` summary into one safe `pdfxyz.ops-bundle/1` support/incident artifact. Reads `--stdin` or `--operations-file`/`--ops-check`, optional `--pipeline`, formats `--json`/`--text`, optional `--output`/`--pretty`; exits `0` ok / `1` usage / `2` unknown / `3` warn / `4` critical. Aggregator only: no cloud call, no raw provider export, no deletion, no paths/object IDs in output. |
| `pnpm worker:smoke` | No-config honesty smoke: asserts the daemon refuses to fake work (exit `2`), rejects bad flags (exit `1`), reports clean guardrails (exit `0`), and fails fast on a dangerous config (exit `4`) — no secrets or network. Also run inside the built worker image in CI |
| `pnpm worker:image-smoke` | Image-level native-engine + OCR proof — run inside the **built worker image** in CI: the deep-compression + OCR binaries and English OCR data are installed, `PDFXYZ_OCR=on` flips `ocr_health`→`ready`, and native engines never fake drainability. Presence-only; no cloud/secret/document |
| `pnpm worker:engines` | Node-free `command -v` engine preflight (`0` ok / `1` usage / `3` a required engine is missing). Honors the opt-in require-flags; runs anywhere, in or out of the image. Presence-only, content-free |
| `pnpm worker:ocr-proof` | Deterministic OCR **recognition** proof (Phase 25): gs renders a synthetic sentinel raster, Tesseract OCRs it, the sidecar must contain the sentinel. `0` pass / `2` engine missing / `3` proof failed. Presence-only, content-free, self-cleaning; run inside the **built worker image** in CI. No document/cloud/secret |
| `pnpm worker:ocrmypdf-proof` | Deterministic OCRmyPDF **searchable-PDF** proof (Phase 27): gs's `pdfimage` builds an image-only PDF, `pdftotext` confirms it has no selectable text, OCRmyPDF adds a text layer, and `pdftotext` confirms the **output** is searchable (+ sidecar). `0` pass / `2` tool missing (gs/ocrmypdf/pdftotext) / `3` proof failed. Presence-only, content-free, self-cleaning; run inside the **built worker image** in CI. No document/cloud/secret |
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

| Worker file-soundness quarantine gate (Phase 36): after the worker retrieves bytes but before malware scanning and processors, `src/lib/workers/soundness` runs a bounded structural + metadata-consistency preflight. It rejects empty inputs, too many inputs, optional size ceilings, declared-size mismatches, unsupported/mismatched families, and PDF-expected bytes missing `%PDF-` (plus optional `%%EOF`). Rejections produce a content-free quarantine receipt and `unsound` failure class; no processor runs, no artifacts/text are produced, and logs/metrics carry only stable reason codes and buckets. This is **not** malware scanning, sanitization, repair, OCR validation, or proof that a PDF is safe/valid. | ✅ Live (worker preflight, content-free quarantine) |
| Worker artifact-manifest / provenance gate (Phase 37): after a processor produces outputs but before any bytes are persisted or a download is minted, `src/lib/workers/artifacts` validates each output's structural provenance. It rejects zero outputs, over-count/over-size outputs, empty bytes, unknown output kinds, content-type/extension mismatches, kinds a tool may not produce, and jobs with no resolvable retention class. Rejections produce a content-free rejection receipt and `artifact` failure class (`artifact_invalid`); no artifact is written, and each published output carries a typed manifest (kind/content-type/byte-count/retention-class/tool/processor) with no filename, key, URL, id, or content. This is **not** malware scanning, sanitization, OCR-correctness, or a lifecycle-deletion guarantee. | ✅ Live (worker output provenance, content-free) |
| Artifact retrieval/download guardrails (Phase 38): every published output records its content-free manifest alongside its bytes, and the local-dev download route (`GET /api/artifacts/local/:artifactId`) delegates to a pure retrieval-access layer (`src/lib/workers/artifacts/access.ts`) before streaming a byte. It checks handle shape, lifecycle (live/expired/deleted/absent), job completion, and re-validates the recorded manifest against the actual bytes; a pass streams with safe, **generated** headers (canonical `Content-Type`; an `attachment` `Content-Disposition` named from the output kind/tool, never the stored/user filename; `Content-Length`; `Cache-Control: private, no-store`; `X-Content-Type-Options: nosniff`), a failure returns a closed set of content-free reasons (`not_found`/`deleted`/`expired`→`404`/`410`, `invalid_manifest`, `unsupported_kind`, …) with no bytes. A bounded `worker_artifact_retrieval_total` metric + per-attempt receipt (both opt-in sinks) make decisions observable. **No auth**: possession of the opaque handle is the capability; the optional `?job=` binding is an integrity cross-check, not access control. Not authentication, authorization, scanning, sanitization, or a deletion proof. | ✅ Live (retrieval boundary, content-free) |
| Storage-backed artifact retrieval (Phase 39): the Phase 38 access boundary is generalized behind an `ArtifactRetrievalBackend` seam so a configured object bucket gets byte-identical checks. The production route (`GET /api/artifacts/:artifactId`) reads artifact bytes from the bucket **server-side** (signed GET) and streams them through the same shared boundary as local-dev — **no signed object-store URL is ever exposed to the client** (proxy/stream, not redirect); the content-free provenance manifest rides the object as signed metadata (`x-amz-meta-artifact-manifest`) and is re-validated on download. A transient bucket failure is a retryable `storage_error`→`503 service_unavailable`, distinct from a not-configured `storage_unavailable`; a bucket `404` is an honest `not_found`. The retrieval metric + receipt gain a bounded `provider` label (`local-dev`/`remote-configured`/`not-configured`). No S3 needed to test (scripted transport + backend override). No CDN/private-bucket policy is claimed. | ✅ Live (server-side proxy, content-free) |
| Download delivery hardening (Phase 40): after access is granted, a second pure gate (`src/lib/workers/artifacts/delivery.ts`) verifies the byte delivery before streaming, on both routes. It re-asserts `Content-Length` from the actual bytes and cross-checks it against the access decision and any upstream-declared length (`size_mismatch`→`503`, never a truncated body under a lying header); enforces a fixed **1 GiB** delivery ceiling (`oversize`→`503`, a backstop for the opt-in publish-time cap); answers `HEAD` with the verified headers and no body; and takes an honest `Range` posture — whole buffered objects only, so `Accept-Ranges: none` and a `Range` header is *ignored* (whole-file `200`), never a `206`/`416` or resumable claim. Non-`GET`/`HEAD` verbs get a content-free `405` (no body) from the framework. Any unexpected error closes to a safe `503` (`stream_error`), never a framework `500`/stack or a provider message/key/URL. A parallel content-free `worker_artifact_delivery_total` metric + delivery receipt (adds bounded `method`/`range`) observe it. Not authentication, resumable serving, or content scanning. | ✅ Live (delivery gate, content-free) |
| Storage-backed lifecycle/expiry enforcement (Phase 41): a bucket does **not** tombstone, so it serves a `200` for an artifact past its retention window until the bucket's lifecycle rule reaps it. The worker signs the retention window as content-free object metadata (`x-amz-meta-artifact-lifecycle` — the same `expiresAt` the client holds, plus an optional tombstone marker); the storage reader evaluates it against its clock (`artifacts/lifecycle.ts`) **before the body is read** and denies a logically-expired/tombstoned object `410 Gone`, bytes never buffered. **App-level retrieval-time enforcement**, additional to the bucket lifecycle-deletion backstop — an object with no evidence (`unknown`) is served honestly (never over-claimed as gone), an unreadable clock never fabricates `expired`, and it is **not** proof of deletion. A content-free `worker_artifact_expiry_total{state,provider}` metric + drift receipt surface `expired`/`deleted` (drift) vs `unknown` (no metadata). Local-dev tombstones unchanged. No S3 needed to test (synthetic signed metadata). Bucket lifecycle correctness, legal retention, audit export, private-bucket policy, CDN purge remain out of band. | ✅ Live (retrieval-time expiry, content-free) |
| Storage-artifact cleanup verification (Phase 42): Phase 41 *denies* a gone artifact at retrieval, but that is not proof the bucket *deleted the bytes*. `pnpm worker:cleanup-check` proves — from content-free evidence exported out-of-band (the app never calls the cloud) — whether artifacts that should be gone are actually **absent** (and by which mechanism) or only retrieval-denied. It separates the four cleanup facts the platform keeps distinct: *retrieval-time denial* (Phase 41, access only), *active app deletion* (delete-now → `absent-active`), *bucket lifecycle backstop* (reap → `absent-backstop`), and *cleanup verification* (this tool). Per-object states `absent-active`/`absent-backstop`/`retrieval-denied`/`drift`/`live`/`unknown`/`unavailable` fold to a verdict `verified`/`drift`/`unknown`/`unavailable`/`not-configured`. **Absence is the only proof of cleanup**: a present-but-denied object is reported as pending, never fabricated into "deleted"; a `not-configured` deployment stays honestly inert; it reads no bytes and NEVER deletes. Content-free `worker_cleanup_verification_total{verdict,provider}` metric + receipt; exit `0` verified / `1` usage / `2` unknown / `3` drift. No S3 needed to test (injected evidence). | ✅ Live (content-free cleanup evidence; operator-owned deletion) |
| Storage-artifact cleanup **dry-run sweeper** (Phase 42): the complementary lens to the verifier above. Where the verifier proves should-be-gone objects are *absent*, the sweeper (`pnpm worker:artifact-cleanup`) categorizes an offline, content-free **inventory** of PRESENT object metadata into `expired-but-present`/`deleted-but-present`/`missing-lifecycle`/`missing-manifest`/`unsupported-kind`/`storage-unavailable`/`ok` and emits an optional dry-run cleanup **plan** (counts + actions only). It re-derives lifecycle through the same Phase 41 `evaluateArtifactLifecycle`, escalates a severity only on POSITIVE evidence (a tombstone or a passed deadline; absent evidence stays `unknown`), and NEVER lists a real bucket or deletes anything. Content-free `worker_artifact_cleanup_total{category,severity}` metric + receipt; exit `0` clean / `1` usage / `2` unknown / `3` cleanup-recommended / `4` invalid·breached. No S3 needed to test. | ✅ Live (dry-run sweeper, content-free) |
| Cleanup evidence **exporter / projector** (Phase 43): Phase 42 gave operators two offline verifiers but no safe way to *produce* their content-free inputs from a raw provider capture. `pnpm worker:cleanup-project` is that bridge — it projects an out-of-band `aws s3api list-objects-v2`/`head-object` capture (or a normalized dump) into a `--target=evidence` or `--target=inventory` document the Phase 42 tools ingest, piped straight in. It reads ONLY a bounded allowlist (a coarse presence, the decoded `{expiresAtMs,deleted}` evidence, a decoded manifest/kind, coarse age/size) and **drops every** locator/identifier (object keys, buckets, signed URLs, endpoints, regions, account ids, ETags, filenames, user-metadata), tallying drops by category (`locator`/`url`/`identity`/`integrity`/`metadata-blob`) in an embedded content-free receipt. A **redaction/normalization helper** — not proof of deletion, not malware scanning, not a cloud scanner, no auth/provenance claim: it makes no cloud call and deletes nothing. A tampered lifecycle/manifest blob collapses to "no evidence"; a present-but-tombstoned object surfaces as `unsafe`. Content-free `worker_cleanup_projection_total{target,verdict}` metric + receipt; exit `0` projected / `1` usage / `2` insufficient / `4` unsafe. No S3 needed to test (fake-only). | ✅ Live (offline projector, content-free) |
| Cleanup evidence **pipeline** (Phase 44): Phases 42–43 gave operators three offline tools; wiring them by hand (project → verify, project → sweep) is fiddly and easy to get fail-open. `pnpm worker:cleanup-pipeline` composes them into ONE fail-closed command — it reads a raw export **once**, projects it away, runs both the absence verifier and the dry-run sweeper in-process, and rolls the two arms into a single documented exit code (`0` ok / `1` usage / `2` unknown / `3` drift / `4` breach; the worst arm wins, and a usage/unreadable-export is a NON-ZERO fail-closed result, never a silent `0`). Read-only, no cloud call, deletes nothing; the raw export is projected away before either arm runs, so no locator/identifier survives. Content-free `worker_cleanup_pipeline_total{arm,severity}` metric + rolled-up receipt; deployment templates (`cleanup-pipeline-notify.sh`, a CI fixture) included. Not deletion, auth, scanning, or provenance. | ✅ Live (one-command pipeline, content-free) |
| Cleanup evidence **posture monitor** (Phase 44): the passive complement to the pipeline. `src/lib/workers/cleanup-evidence` reads the content-free report SUMMARIES a scheduled cleanup-check / artifact-cleanup job already wrote (via `PDFXYZ_CLEANUP_EVIDENCE_CHECK_REPORT` / `_SWEEP_REPORT`) and folds them — with a freshness threshold — into a bounded ops **posture** (`disabled`/`healthy`/`stale`/`warning`/`critical`/`unknown`/`not-configured`/`invalid`) for the `/status` dashboard and `worker:ops-check`. It refuses a raw export (a misconfiguration → `invalid`), never fabricates freshness from missing/stale evidence (→ `stale`, never a false OK), and reads no bytes, no cloud, no secret. Content-free `worker_cleanup_evidence_posture{state,reason,provider}` gauge. Monitoring is OFF (`disabled`) until a report path is configured. Not deletion, scanning, or a cloud call. | ✅ Live (posture monitor, content-free) |
