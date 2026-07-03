# Deployment

pdf.xyz deploys to **Vercel** and serves from the **pdf.xyz** domain. This guide
covers first-time setup, the environment policy, and the day-to-day
preview → production workflow.

> The app is a standard Next.js App Router project. Nothing here requires
> secrets today — every live tool runs in the browser.

---

## 1. Prerequisites

- A Vercel account with access to the target team.
- The GitHub repo connected to Vercel (`baki2222/pdf.xyz`).
- Node ≥ 20 and pnpm locally (pnpm is pinned via `packageManager` in
  `package.json`, so Vercel and CI use the same version).

## 2. Create the Vercel project

1. **New Project → Import** the GitHub repository.
2. Framework preset: **Next.js** (auto-detected).
3. Build & install commands: taken from [`vercel.json`](../vercel.json) —
   - Install: `pnpm install --frozen-lockfile`
   - Build: `pnpm build`
4. Node.js version: **20.x or 22.x** (Project → Settings → General).
5. Leave the output/root defaults; there is no custom output directory.

`vercel.json` also sets sensible CDN cache headers for `robots.txt`,
`sitemap.xml`, and the manifest. All **security headers and the CSP** are
defined in `next.config.mjs` so they apply identically in local `next start`,
preview, and production.

## 3. Environment variables

**Policy: never commit secrets, and never read `.env*` files into the client.**

- `.env`, `.env.local`, and `.env*.local` are git-ignored (see `.gitignore`).
- **Today:** no environment variables are required. The whole app builds and
  runs without any.
- **Secure-worker storage (optional, Phase 14):** object storage can be wired
  independently of the queue/processor by setting server-only S3-compatible
  variables in Vercel. This enables real signed upload/download URL minting.
- **Secure-worker queue (optional, Phase 15):** the job queue can be wired
  independently of storage/processor by setting server-only Redis/Upstash REST
  variables. This enables real queue-backed job creation, status, cancel/expire,
  and idempotency. **A configured queue accepts jobs, but nothing runs them until
  the Phase 16 worker daemon (`pnpm worker:daemon`) is deployed and running against
  it** — a created job stays `queued`, and the status endpoint says so. Never claim
  remote processing is live on this basis alone.
- **When remaining secure workers / AI land:** add their keys in
  **Vercel → Project → Settings → Environment Variables**, scoped to the right
  environment (Production / Preview / Development). Server-only secrets must
  **not** be prefixed `NEXT_PUBLIC_` (that prefix exposes a value to the
  browser). Keep worker/AI credentials server-side only.
- **OCR (and every secure-worker tool) is disabled by default.** `/tools/ocr-pdf`
  reads `GET /api/worker/status` and honestly reports OCR unavailable in the browser;
  no scan is uploaded and no text is fabricated. Phase 23 ships a **real, optional** OCR
  backend (OCRmyPDF/Tesseract) that runs on the **out-of-band worker daemon** — never
  the web app — and is **off by default**: enable it on the worker with `PDFXYZ_OCR=on`
  and install an engine (see [`docs/OCR_BACKEND.md`](../docs/OCR_BACKEND.md)). Its
  config is **worker-side only — never `NEXT_PUBLIC_`**, names not values. See
  [`docs/WORKER_ARCHITECTURE.md`](../docs/WORKER_ARCHITECTURE.md).

### Optional: S3/R2-compatible secure-worker storage

Set these only in server-side environments. Do **not** use `NEXT_PUBLIC_`.
`PDFXYZ_STORAGE_PROVIDER=s3` is the explicit selector; without it the app falls
back to the safe disabled/remote-unimplemented storage provider.

| Variable | Required | Notes |
| --- | --- | --- |
| `PDFXYZ_STORAGE_PROVIDER` | Yes | Set to `s3` to enable this provider. |
| `PDFXYZ_S3_ENDPOINT` | Yes | S3-compatible origin only, e.g. AWS/R2/MinIO endpoint; no path/query/credentials. |
| `PDFXYZ_S3_REGION` | Yes | Region string; R2 commonly uses `auto`. |
| `PDFXYZ_S3_BUCKET` | Yes | Private bucket name. Public listing must be disabled. |
| `PDFXYZ_S3_ACCESS_KEY_ID` | Yes | Server-side key id; appears inside presigned URLs by S3 design but is never reported in status. |
| `PDFXYZ_S3_SECRET_ACCESS_KEY` | Yes | Server-side signing secret; never logged, serialized, or returned. |
| `PDFXYZ_S3_SESSION_TOKEN` | Optional | Temporary credential token if used. |
| `PDFXYZ_S3_FORCE_PATH_STYLE` | Optional | `true` for MinIO/some local-compatible deployments. |
| `PDFXYZ_S3_KEY_PREFIX` | Optional | Sanitized tenant/prefix segment; no traversal or spaces. |
| `PDFXYZ_S3_UPLOAD_TTL_SECONDS` | Optional | Default 900; must be 1–604800. |
| `PDFXYZ_S3_DOWNLOAD_TTL_SECONDS` | Optional | Default 900; must be 1–604800. |

Storage readiness is presence-only in `/api/worker/status`: it can say S3 storage
is ready, but never names bucket, endpoint, region, prefix, variable names, or
credential values. Queue and processor readiness remain separate; do not enable
remote processing claims until a real broker and worker service are deployed.

### Optional: Redis/Upstash-compatible secure-worker queue

Set these only in server-side environments. Do **not** use `NEXT_PUBLIC_`.
`PDFXYZ_QUEUE_PROVIDER=redis` (or `upstash-redis`) is the explicit selector;
without it the app falls back to the safe disabled/remote-unimplemented queue
provider. Works with Upstash Redis REST and any compatible HTTP Redis gateway that
supports Redis script execution (`EVAL`) for the Phase 21 atomic transition layer.
If the broker/gateway cannot execute those scripts, worker-owned transitions fail as
typed `unavailable` instead of silently falling back to unsafe read→write behavior.

| Variable | Required | Notes |
| --- | --- | --- |
| `PDFXYZ_QUEUE_PROVIDER` | Yes | Set to `redis` (or `upstash-redis`) to enable this provider. |
| `PDFXYZ_REDIS_REST_URL` | Yes | REST endpoint origin only, e.g. `https://<db>.upstash.io`; no path/query/credentials. |
| `PDFXYZ_REDIS_REST_TOKEN` | Yes | Server-side REST bearer token; sent only as an `Authorization` header, never logged, serialized, or returned. |
| `PDFXYZ_QUEUE_KEY_PREFIX` | Optional | Sanitized key namespace (default `pdfxyz`); no traversal or spaces. |
| `PDFXYZ_QUEUE_LEASE_SECONDS` | Optional | Lease-duration ceiling; default 300, must be 5–3600. |
| `PDFXYZ_QUEUE_MAX_ATTEMPTS` | Optional | Dead-letter cap on delivery attempts; default 5, must be 1–20. |
| `PDFXYZ_QUEUE_JOB_TTL_SECONDS` | Optional | Retention TTL applied to every broker key; default 86400, must be 300–604800. |

Queue readiness is presence-only in `/api/worker/status`: it can say the queue is
ready and configured, but never names the endpoint, token, prefix, variable names,
or key names. **Enabling the queue does not enable processing** — with no worker
daemon running, `POST /api/jobs` (when storage is also ready) records a `queued`
job and returns `202`, and it stays queued. Deploy the Phase 16 worker daemon
(`pnpm worker:daemon`, see its checklist below) to drain the queue before
advertising that jobs complete.

### Optional: public-API abuse guard (off by default)

The in-app abuse guard (`src/lib/ratelimit`, Phase 33) is **disabled unless you
select a provider**. With nothing set every request is allowed and the guard
reports `enforced: false` — identical to pre-Phase-33 behavior. Set these only in
server-side environments; do **not** use `NEXT_PUBLIC_`.

| Variable | Effect |
| --- | --- |
| `PDFXYZ_RATE_LIMIT_PROVIDER` | Selects the backend. Unset/`disabled` ⇒ no enforcement. `local-memory` ⇒ the per-process in-memory limiter (**not distributed** — see caveat). A remote name (`redis`/`upstash`/`remote`/…) ⇒ the shipped **distributed** provider (Phase 34) when a valid store is configured below — it is auto-registered at boot (`src/instrumentation.ts`) and the guard reports `provider: "remote"`, `enforced: true`. With a remote name selected but **no** valid store, it resolves to `remote-unimplemented` and **skips honestly** (never fakes distributed enforcement). |
| `PDFXYZ_RATE_LIMIT_REDIS_REST_URL` | Bare `https` origin of the distributed limiter store (Redis/Upstash-REST). **Web-tier** credential — deliberately distinct from the worker-only `PDFXYZ_REDIS_REST_URL`, so the public web pod never carries a worker secret. May point at the same managed instance as the queue. |
| `PDFXYZ_RATE_LIMIT_REDIS_REST_TOKEN` | Bearer token for that store. Read only to build the auth header; never logged, returned, or surfaced. Server-only; never `NEXT_PUBLIC_`. |
| `PDFXYZ_RATE_LIMIT_KEY_PREFIX` | Optional key namespace (default `pdfxyz`); limiter keys live under `{prefix}:ratelimit:…`, never colliding with queue keys. |
| `PDFXYZ_RATE_LIMIT_FAIL_MODE` | How the guard degrades when the store errors: `open` (default) ⇒ allow, unenforced (a store outage never takes the API down); `closed` ⇒ deliberate `429` (shed load rather than serve unthrottled). |
| `PDFXYZ_RATE_LIMIT_TRUST_PROXY` | Truthy ⇒ attribute requests to a client via the `x-forwarded-for`/`x-real-ip` header (salted-hashed, never retained). Off by default because that header is spoofable unless a trusted edge overwrites it; off ⇒ one shared bucket (a coarse global throttle). Enable **only** behind a proxy/CDN you trust to set it. |

Notes specific to this feature:

- **Distributed enforcement runs on the WEB tier.** The guard is called by the public
  API route handlers, so the store credentials go on the **web** deployment (a small
  web-tier secret + the `PDFXYZ_RATE_LIMIT_*` vars above), NOT the worker. They are
  separate variable names from the queue's worker-only `PDFXYZ_REDIS_REST_*` precisely
  so the public web pod never inherits a worker secret (a load-bearing invariant — see
  `deployment-blueprint.test.ts`). You may set the same *values* under these web-safe
  *names* to reuse one managed instance. The committed k8s/compose examples ship with
  rate limiting **off**; the k8s README shows the exact web-tier secret + env snippet to
  turn it on.
- **⚠️ `local-memory` is not production distributed enforcement.** Its counters
  live in one process's heap, so behind N instances the effective budget is up to
  N× and a restart resets windows. It is a dev/test limiter and a coarse
  single-instance backstop — enable the distributed `redis`/`upstash` provider (or a
  real edge/WAF rule) before a high-traffic launch and keep the in-app guard as
  defense-in-depth.
- **Enabling the guard cannot break local-first tools.** The client-only tools
  never call the API, and the guard fails open (by default) on any internal error.
- **On deny it returns `429 rate_limited` + `Retry-After`**, with a content-free
  body that never names the caller. See [`SECURITY.md`](SECURITY.md),
  [`OBSERVABILITY.md`](OBSERVABILITY.md), and [`WORKER_ARCHITECTURE.md` §6](WORKER_ARCHITECTURE.md).

### Optional: client telemetry toggles (off by default)

Client error + Web-Vitals telemetry is **inert unless you point it at an ingest
endpoint**. With nothing set, no beacon is sent, the Web-Vitals listener is not
even mounted, and the CSP is unchanged. These are the only knobs:

| Variable | Effect |
| --- | --- |
| `NEXT_PUBLIC_TELEMETRY_ENDPOINT` | Where redacted reports are POSTed. Unset ⇒ telemetry disabled. Accepts a same-origin path (`/api/telemetry`) or an absolute `http(s)` URL; anything else is ignored and telemetry stays off. |
| `NEXT_PUBLIC_TELEMETRY_SAMPLE_RATE` | Optional `0`–`1` sampling rate (default `1`). `0` disables sending. |

Notes specific to this feature:

- **`NEXT_PUBLIC_` is correct here.** The browser must read the endpoint to send
  a beacon, so it is public by nature and is **not a secret** — unlike the
  server-only worker/AI credentials above. Never put a secret behind this prefix.
- **Payloads are redacted at the source.** Reports carry a coarse error name,
  a scrubbed message/stack, the current page URL reduced to origin+path, and a
  deep-scrubbed context — **never** file names, file contents, hand-off tokens,
  or a URL query string. See [`docs/SECURITY.md`](SECURITY.md).
- **CSP is handled for you.** If the endpoint is cross-origin, `next.config.mjs`
  adds exactly that origin to `connect-src` at build time; a same-origin path is
  already covered by `connect-src 'self'`. No manual CSP edit is needed.
- **These vars are build-time inlined.** Set them **before** the build (in the
  Vercel environment for the target deployment) — changing them requires a
  rebuild to take effect.
- We ship **no** ingest endpoint. Bring your own (a serverless route, a
  collector, or a third-party sink). Absent one, leave these unset.

## 4. Custom domain (pdf.xyz)

1. **Project → Settings → Domains → Add** `pdf.xyz` and `www.pdf.xyz`.
2. Set the redirect so one is canonical (recommend `pdf.xyz` apex as canonical,
   `www` → apex).
3. Configure DNS at the registrar as Vercel instructs, typically:
   - Apex `pdf.xyz`: `A` → `76.76.21.21` **or** an `ALIAS`/`ANAME` to
     `cname.vercel-dns.com` (registrar-dependent).
   - `www`: `CNAME` → `cname.vercel-dns.com`.
4. Vercel provisions TLS automatically.
5. Confirm `siteConfig.url` in `../src/lib/site.ts` is `https://pdf.xyz` — it is the
   `metadataBase` for canonical/OG URLs, robots, and the sitemap.

**HSTS note:** the app sends `Strict-Transport-Security` with `preload` in
production. This is correct for a dedicated HTTPS domain, but it commits the
apex + subdomains to HTTPS. Only submit to the [HSTS preload list](https://hstspreload.org/)
once you are certain every current and future subdomain will always serve
HTTPS.

## 5. Preview → production workflow

- **Pull requests** get an automatic **Preview Deployment** with a unique URL.
  CI (`../.github/workflows/ci.yml`) runs typecheck, lint, unit tests, the worker
  no-config honesty smoke, build, and the Playwright smoke suite on every PR. A
  second workflow (`../.github/workflows/container.yml`) builds both the `web` and
  `worker` image targets and runs the worker no-config smoke **inside** the built
  worker image.
- **`main`** is the production branch — merges deploy to `pdf.xyz`.
- Branch model: feature work happens on `phase-*` branches (e.g.
  `phase-4-production-hardening`). Open a PR into `main`; **do not** deploy
  straight to production from a feature branch.
- **Rollback:** Vercel keeps every deployment. Use
  **Deployments → ⋯ → Promote/Rollback** for an instant revert.

## 6. Post-deploy checklist

Run against the live/preview URL:

```bash
# Security headers
curl -sI https://pdf.xyz | grep -iE 'content-security-policy|x-frame-options|strict-transport|referrer-policy|permissions-policy|x-content-type'

# Crawl + share surfaces
curl -s https://pdf.xyz/robots.txt
curl -s https://pdf.xyz/sitemap.xml | head
curl -sI https://pdf.xyz/opengraph-image | grep -i content-type
```

- [ ] Security headers + CSP present (no CSP console errors on tool pages).
- [ ] `robots.txt` points at the sitemap; `sitemap.xml` lists tool pages.
- [ ] OG image renders (paste a tool URL into a link-preview debugger).
- [ ] Core in-browser tools work (merge two PDFs end-to-end).
- [ ] Lighthouse: performance, SEO, and accessibility are green.
- [ ] `GET /api/worker/operations` returns a content-free web-vantage operations snapshot:
      no provider values, bounded subsystem health, and a single `recommendedAction`.
      With `PDFXYZ_WORKER_HEARTBEAT` disabled, `daemonObserved:false` is neutral; with it
      enabled and Redis configured, `daemonObserved:true` requires a fresh heartbeat.
      Use worker-side daemon logs for actual processing details.

## Phase 32 deployment blueprints and scheduler examples

Phase 32 adds copy-and-adapt deployment templates under [`docs/examples/deployment`](examples/deployment):

- Docker Compose full-topology blueprint: public `web`, private `worker`, optional local Redis-REST broker shim, optional ClamAV scanner, and placeholder-only env file.
- systemd examples: `pdfxyz-worker-daemon.service` for the long-running worker plus `pdfxyz-ops-check.service`/`.timer` for scheduled health evaluation.
- Kubernetes examples: namespace, ConfigMap, placeholder Secret, web Deployment/Service, worker Deployment, and `worker:ops-check` CronJob.
- GitHub Actions fixture gate: runs `worker:ops-check --file` against committed content-free fixtures without real credentials.

Validate templates locally with:

```bash
pnpm deploy:examples:check
pnpm test src/deploy/deployment-blueprint.test.ts src/deploy/scheduler-templates.test.ts
```

Honesty boundary: these examples were statically validated here; they were not applied to a real Docker daemon, Kubernetes cluster, cloud bucket, broker, DNS/TLS, or pager. Replace placeholders and provision secrets/infrastructure out-of-band before using them.

## Phase 12 worker provider checklist

Production worker rollout now requires concrete providers for object storage and queueing behind the typed contracts in `src/lib/workers/storage/` and `src/lib/workers/queue/`. Configure private encrypted storage, lifecycle deletion, signed upload/download URL TTLs, a broker-backed queue, idempotency storage, and an authenticated delete-now path before enabling remote processing. Until those adapters exist, remote-configured mode must continue returning typed not-implemented/not-configured responses rather than minting dummy URLs or jobs.

## Phase 14 S3-compatible storage checklist

Phase 14 ships a real S3/R2/MinIO-compatible object-storage provider behind the
Phase 12 storage contract. It can mint signed upload/download URLs and execute
server-side delete-now when `PDFXYZ_STORAGE_PROVIDER=s3` plus the required
server-side S3 variables are valid. Before using it for production traffic:

- Create a private, encrypted bucket with public listing/access disabled.
- Configure lifecycle deletion for input and artifact prefixes as a backstop; the
  app's TTLs are not a substitute for bucket lifecycle rules.
- Add a bucket **CORS policy** so the browser can transfer bytes directly against
  the signed URLs: allow the app's exact origin(s) for `PUT` (uploads), `GET`
  (downloads), and `DELETE` (delete-now), permit the `content-type` request
  header, and expose `ETag`. A valid signature is still blocked by the browser
  without this — the app server intentionally never proxies the bytes.
- Keep upload/download TTLs short (defaults: 15 minutes) and verify clocks are in
  sync for SigV4 signing.
- Use a narrow IAM/R2 token that can only put/get/delete under the configured
  prefix.
- Confirm `/api/worker/status` reports storage ready without exposing bucket,
  endpoint, region, key id, prefix, variable names, or secret values.
- Remember this is **storage only**: jobs still require a real queue adapter and a
  separate sandboxed worker process before remote processing can be enabled.

## Phase 15 Redis/Upstash queue checklist

Phase 15 ships a real Redis/Upstash-compatible **queue** provider behind the Phase
12 queue contract. It records real `queued` jobs and serves status/cancel/expire/
idempotency (plus the worker-claim surface) when `PDFXYZ_QUEUE_PROVIDER=redis` plus
the required REST variables are valid. Before using it for production traffic:

- Provision a private Redis/Upstash database with REST enabled; use a token scoped
  to that database only. Prefer a per-environment database (or a distinct
  `PDFXYZ_QUEUE_KEY_PREFIX`) so preview and production never share job state.
- Enable in-transit encryption (Upstash REST is HTTPS) and encryption at rest.
- Set `PDFXYZ_QUEUE_JOB_TTL_SECONDS` so every key auto-expires comfortably past the
  retention window — it is the backstop that keeps no job state around forever.
- Tune `PDFXYZ_QUEUE_LEASE_SECONDS` (lease ceiling) above the worst-case job slice
  and `PDFXYZ_QUEUE_MAX_ATTEMPTS` so only genuinely transient failures retry before
  a job is dead-lettered.
- Confirm `/api/worker/status` reports the queue ready/configured without exposing
  the endpoint, token, prefix, variable names, or key names.
- **This is the queue only.** With no worker daemon deployed, a created job stays
  `queued` forever (until its TTL) and nothing is processed. Do **not** tell users
  jobs complete until the Phase 13 executor is deployed as a separate worker (next
  section) draining this queue. Enable storage *and* queue together, then the
  worker, before advertising end-to-end processing.

## Phase 13 worker executor checklist

Phase 13 adds the **execution foundation** — a processor registry and an executor
loop (`src/lib/workers/processor/` + `src/lib/workers/executor/`) — but ships **no
long-running worker in the app runtime**. Importing the executor starts nothing;
it must be *driven*. Before enabling remote processing:

- **Run the executor out-of-band.** Deploy a **separate, sandboxed worker
  process** (not a Vercel serverless function on the request path) that constructs
  `createWorkerExecutor({ queue, storage, registry })` against the real broker +
  bucket adapters and calls `drain()` on an interval or on queue notifications.
  The Next.js app must never spawn it.
- **Implement the adapters, not the loop.** The loop is done; wire real
  `ClaimableQueue`, `ExecutorStorage`, and processor runners behind the existing
  contracts. The native `deep`-compression and **OCR (OCRmyPDF/Tesseract, Phase 23)**
  runners already ship — both use fixed argv arrays and fixed temp paths (no
  user-supplied paths, no shell string interpolation); the Phase 24 worker image
  already ships the OCR engines + English data, so enabling OCR in production is just
  `PDFXYZ_OCR=on` ([`OCR_BACKEND.md`](../docs/OCR_BACKEND.md)).
- **Tune lease & retries.** Set `leaseMs` above the worst-case job duration and
  heartbeat long jobs, so a slow job is not redelivered under a healthy worker;
  set `maxAttempts` so only genuinely transient (`retryable`) failures retry.
- **Scan for real.** The executor's `scanning` phase runs the Phase 22 malware-scan
  gate: point `PDFXYZ_MALWARE_SCANNER` at an **optional ClamAV/clamd** endpoint and an
  infected or unscannable input is blocked before processing; unconfigured, it is an
  honest no-op (nothing scanned, and nothing is ever *reported* as scanned). Deploy
  clamd (e.g. as a sidecar) to scan for real, and arm `PDFXYZ_WORKER_REQUIRE_SCAN`
  where scanning is mandatory.
- **OCR for real.** OCR is a real, optional backend (Phase 23), off by default. The
  Phase 24 worker image already ships the engines — OCRmyPDF (preferred, for
  PDF→searchable PDF + text) and Tesseract (images) — plus English
  (`tesseract-ocr-eng`) language data, so enabling OCR in production is just
  `PDFXYZ_OCR=on` on top of the usual queue/storage; add more `tesseract-ocr-<lang>`
  packs to the image only if you advertise more languages. `PDFXYZ_OCR=on` is
  **necessary but not sufficient** — confirm with `pnpm worker:daemon --dry-run-status`
  (the `ocr_health` line reports `enabled`/`ready`/`engine`), and arm
  `PDFXYZ_WORKER_REQUIRE_OCR` where OCR is mandatory, so the daemon refuses to start
  (exit `4`) without a ready engine. With nothing configured, `ocr-pdf` fails honestly
  as `not_implemented` — never a fabricated result. **Real end-to-end user-document OCR
  recognition validation stays out-of-band** — the image smoke proves the engine is
  installed and reports ready, not that any document OCRs correctly. See
  [`docs/OCR_BACKEND.md`](../docs/OCR_BACKEND.md).
- **OCR job status now carries safe metadata (Phase 26).** Once OCR is enabled, a
  completed `ocr-pdf` job's status (`GET /api/jobs/:id`) includes `results.ocr` —
  structural, content-free metadata (engine family from the closed set
  `ocrmypdf`/`tesseract`/`unknown`, validated languages, output kind, page count,
  sidecar character count). As of Phase 27 those produced-kind flags and page/character
  counts are derived from the artifacts **actually produced** — the searchable-PDF page
  count is measured from the produced PDF's bytes, never the input — so a missing or
  invalid output fabricates nothing. It never carries recognized text, a filename, object key,
  signed URL, or path; it is written only on a genuinely completed job and dropped when
  the outputs are deleted. Nothing new to configure — it rides the existing job record;
  the recognized text itself remains download-only in the artifact. If you proxy or log
  job-status responses, note `results.ocr` is safe to retain (it is a *description* of
  the output, never the output).
- **Keep it presence-only.** `/api/worker/status` exposes
  `providers.processor.executor` (mode/ready/detail) — confirm no broker name,
  worker URL, key, or variable ever appears there. `remote-configured` must keep
  reporting `executor.mode: "not-implemented"` until the worker is live.

## Phase 16 worker daemon checklist

Phase 16 ships the **out-of-band worker daemon runner** that Phase 13's checklist
called for — `scripts/worker-daemon.ts`, run with `pnpm worker:daemon`. It is the
one process that actually drains the queue; the Next.js app never becomes it.

- **Run it as a separate process.** In sandboxed worker infrastructure (a container,
  VM, or worker dyno — *not* a Vercel serverless function on the request path), give
  the process the same server-only S3/R2 **and** Redis/Upstash variables the web app
  uses, then run one of:

  ```bash
  pnpm worker:daemon --drain          # process the current backlog once and exit
  pnpm worker:daemon --once           # smoke-test a single job
  pnpm worker:daemon                  # long-running: drain, then poll (default --loop)
  pnpm worker:daemon --dry-run-status # report readiness only; claims nothing
  ```

  Tuning: `--max-ticks=<n>` caps total ticks, `--idle-sleep-ms=<ms>` sets the poll
  interval when idle (default 1000), `--lease-ms=<ms>` sets the per-claim lease.
- **Smoke-test before advertising processing.** `pnpm worker:daemon --dry-run-status`
  exits `0` only when the queue *and* storage are both configured (drainable) and
  `2` otherwise — wire it into a health check. It claims no job and processes nothing.
- **It refuses to fake work.** With no drainable queue + storage the daemon exits `2`
  (not configured); a processor with no runner (OCR, or `deep` compression with no
  native engine) fails the job honestly (`not_implemented`) — it never fabricates a
  completion. **Lossless compression always completes** (pure-JS repack, no extra
  dependencies); **deep image compression completes only when a native engine is
  installed on the worker host** (see the next bullet).
- **Install a native engine for deep compression (Phase 17).** The daemon's
  compression processor auto-detects **Ghostscript (`gs`), qpdf, or mutool** on the
  worker's `PATH` and runs the first it finds — so the worker **container image** must
  ship one for `deep` jobs to complete (e.g. `apt-get install -y ghostscript` in the
  worker Dockerfile). Lossless needs nothing. Native compression can be tuned or hard-
  disabled with the `PDFXYZ_NATIVE_COMPRESSION` / `PDFXYZ_COMPRESSION_*` server-side
  variables (presence/shape only; never `NEXT_PUBLIC_`); see the compression-engine
  config (`src/lib/workers/compression/native-config.ts`).
- **Verify the deep engine with the health signal.** Alongside `readiness`, the daemon
  emits a content-free `compression_health` line — `{ lossless: true, deep, engines }`.
  This is **distinct from `drainable`**: a worker can be drainable yet lossless-only.
  Smoke-test the image with `pnpm worker:daemon --dry-run-status` and confirm
  `compression_health.deep` is `true` (and `engines` lists your installed engine)
  before advertising deep compression.
- **Worker output filenames are display-only metadata (Phase 18).** Upload signing
  can carry a sanitized `x-amz-meta-filename`, and job specs can carry sanitized
  `inputNames`, so worker outputs can download as useful names such as
  `invoice-compressed.pdf`. These names are never used as object keys, Redis keys,
  signed URL paths/queries, status payloads, telemetry, or daemon logs; if metadata
  is absent, the deterministic content-type fallback (`document-compressed.pdf`) is
  still used.
- **Logs are content-free.** The daemon prints structured JSON with a run mode, tick
  counters, an opaque job id/attempt, an error *code*, and the presence-only
  `compression_health` booleans/engine names only — never a filename, byte count,
  object key, URL, option value, or secret. Ship stdout to your log sink as-is.
- **Shut it down cleanly.** SIGINT/SIGTERM lets the in-flight tick finish and the
  loop exit; a second signal forces an immediate stop. Run several replicas safely —
  the broker's atomic claim (RPOP/ZREM) guarantees no two workers run the same job.
- **Still operator-owned:** lifecycle-enforced bucket deletion and native `deep`/OCR
  runners remain your responsibility. Malware scanning now ships as an **optional gate**
  (Phase 22 — configure `PDFXYZ_MALWARE_SCANNER` and run a clamd service), but the clamd
  daemon itself is operator-owned; the worker daemon changes none of those honesty
  boundaries.

## Phase 19 worker container & deployment artifacts

Phase 19 makes the split between the **web app** and the **worker daemon**
concrete infrastructure. The web app deploys to Vercel as before; the worker is a
separate, sandboxed process you build and run yourself. The artifacts:

| File | Purpose |
| --- | --- |
| [`Dockerfile`](../Dockerfile) | Multi-stage build with two independent targets, `web` and `worker`. |
| [`.dockerignore`](../.dockerignore) | Keeps `node_modules`, `.next`, `.env*`, and the `.claude-*.md` prompts out of every image layer. |
| [`docker-compose.worker.yml`](../docker-compose.worker.yml) | Example web + worker composition; placeholder env **names** only, no values. |
| [`.env.worker.example`](../.env.worker.example) | The worker's server-only variables with obvious placeholders; copy to a git-ignored `.env`. |
| `scripts/worker-smoke.sh` (`pnpm worker:smoke`) | No-config honesty smoke; asserts the daemon refuses to fake work and rejects bad flags. |
| `scripts/worker-image-smoke.sh` (`pnpm worker:image-smoke`) | Image-level native-engine + OCR presence/readiness smoke; runs inside the built worker image. |
| `scripts/worker-engines.sh` (`pnpm worker:engines`) | Node-free `command -v` engine preflight (`0` ok / `1` usage / `3` a required engine missing); honors the opt-in require-flags. Runs in or out of the image. |
| `scripts/worker-ocr-proof.sh` (`pnpm worker:ocr-proof`) | Deterministic OCR **recognition** proof on a synthetic fixture (Phase 25): gs renders a sentinel raster, Tesseract OCRs it, the sidecar must contain the sentinel. `0` pass / `2` engine missing / `3` proof failed. Presence-only, content-free, self-cleaning; runs inside the built worker image. |
| `scripts/worker-ocrmypdf-proof.sh` (`pnpm worker:ocrmypdf-proof`) | Deterministic OCRmyPDF **searchable-PDF** proof on a synthetic fixture (Phase 27): gs's `pdfimage` device builds an **image-only** PDF, `pdftotext` confirms the source has no selectable text, OCRmyPDF adds a text layer, and the same `pdftotext` confirms the **output** yields the sentinel (image-only → searchable) with the sidecar corroborating. `0` pass / `2` tool missing (gs/ocrmypdf/pdftotext) / `3` proof failed. Presence-only, content-free, self-cleaning; runs inside the built worker image. |

### Build the two images separately

The web and worker are **completely separate final images** — the web image
cannot run the daemon and ships no PDF engines; the worker image never bundles
the site (`.next`) and never serves HTTP. Build one or the other by target:

```bash
docker build --target worker -t pdfxyz-worker:local .   # Ghostscript/qpdf/mutool + Tesseract/OCRmyPDF + daemon
docker build --target web    -t pdfxyz-web:local .        # Next.js site only
```

- **Native engine dependencies.** In one apt layer the `worker` stage installs
  **Ghostscript, qpdf, and `mupdf-tools`** (`mutool`) so `deep` image compression
  can run, plus the OCR stack — **`ocrmypdf`, `tesseract-ocr`, and
  `tesseract-ocr-eng`** (English language data; the `-eng` pack is listed explicitly
  because `--no-install-recommends` would otherwise skip the language pack). Tesseract
  is the guaranteed baseline (image → searchable PDF/text); OCRmyPDF is the PDF-first
  engine that adds a text layer to a scanned PDF (it wraps Tesseract + Ghostscript).
  The same apt layer also installs **`poppler-utils`** (which provides `pdftotext`) as
  **proof-only** tooling — used solely by the Phase 27 searchable-PDF proof to confirm
  the OUTPUT is selectable, and **not** on the OCR runtime path. Lossless structural
  repack needs none of them, and the `web` stage installs no engines — nor `pdftotext` —
  by design.
- **The daemon needs no build.** It runs `scripts/worker-daemon.ts` via `tsx`, so
  the worker image copies `src/`, `scripts/`, `tsconfig.json`, and `node_modules`
  (which includes `tsx`) — but not the web build.
- **Provider config comes from the environment at run time**, never baked into a
  layer. Give the worker container the same server-only S3/R2 **and** Redis/Upstash
  variables from [`.env.worker.example`](../.env.worker.example) (see the tables
  above). They must **not** be `NEXT_PUBLIC_`.

### Health checks and smoke commands (no secrets required)

- **Container `HEALTHCHECK`** runs `pnpm worker:daemon --dry-run-status`: exit `0`
  when the queue **and** storage are configured (drainable), `2` otherwise. It
  claims no job and processes nothing. `pnpm worker:daemon:status` is the same
  probe as a package script.
- **No-config honesty smoke** — `pnpm worker:smoke` — runs the real CLI in a
  scrubbed environment and asserts the honest exit-code contract (`--help` → 0;
  `--dry-run-status` / `--once` / `--drain` → 2; bad/conflicting flags → 1). It is
  deterministic and offline, so it runs in CI without any provider wired.
- **Verify the deep engine** on the built image with
  `docker run --rm pdfxyz-worker:local pnpm worker:daemon --dry-run-status` and
  confirm the `compression_health` line reports `deep: true` with your engine in
  `engines` before advertising deep compression.

### Not exercised here / still out-of-band

- The **Docker image build is not run in this repository's local environment** (no
  reachable Docker daemon). It **is** built in CI — see the Phase 20 section below —
  and the Dockerfile structure, the web ↔ worker separation, and the "no committed
  secrets" rule are also pinned by static tests under `src/deploy/`. Build and run
  the images in real worker infrastructure before trusting them.
- Still operator-owned and **not** provided by these artifacts: real secrets and a
  provisioned S3/R2 bucket + Redis/Upstash broker, the actual worker deployment
  (orchestrator/scheduler), lifecycle-enforced bucket deletion, malware scanning,
  and the native `deep`/OCR runners themselves. None of these artifacts fake any of
  that — with nothing configured the worker honestly reports "not configured."

## Phase 19 operator runbook: lifecycle, readiness & guardrails

Phase 19 also adds operator tooling to deploy the daemon **safely** and verify its
configuration without exposing secrets. Everything below is presence/shape-only,
content-free, and offline — no command here makes a live cloud call.

### Required env groups (server-only; never `NEXT_PUBLIC_`)

| Group | Variables | Purpose |
| --- | --- | --- |
| Storage | `PDFXYZ_STORAGE_PROVIDER=s3`, `PDFXYZ_S3_ENDPOINT`, `PDFXYZ_S3_REGION`, `PDFXYZ_S3_BUCKET`, `PDFXYZ_S3_ACCESS_KEY_ID`, `PDFXYZ_S3_SECRET_ACCESS_KEY` (+ optional `…_FORCE_PATH_STYLE`, `…_KEY_PREFIX`, TTLs) | Signed I/O + delete. |
| Queue | `PDFXYZ_QUEUE_PROVIDER=redis`, `PDFXYZ_REDIS_REST_URL`, `PDFXYZ_REDIS_REST_TOKEN` (+ optional lease/attempts/TTL) | Claim/complete jobs. |
| Compression | `PDFXYZ_NATIVE_COMPRESSION` (auto by default), optional engine pin + absolute binary overrides | Deep image compression. |
| OCR *(optional)* | `PDFXYZ_OCR` (`on`/`off`, **off by default**), optional `PDFXYZ_OCR_ENGINE` (`ocrmypdf`/`tesseract`), absolute binary overrides, `PDFXYZ_OCR_TIMEOUT_MS` / `_MAX_INPUT_BYTES` / `_MAX_OUTPUT_BYTES` / `_TMPDIR` | Optional OCR backend (Phase 23). Requires an engine installed on the worker. See [`OCR_BACKEND.md`](../docs/OCR_BACKEND.md). |
| Retention *(optional)* | `PDFXYZ_RETENTION_INPUT_TTL_MINUTES`, `PDFXYZ_RETENTION_ARTIFACT_TTL_MINUTES`, `PDFXYZ_RETENTION_MULTIPART_ABORT_HOURS`, `PDFXYZ_RETENTION_NONCURRENT_VERSION_DAYS` | Tighten the lifecycle backstop (≤ 7-day ceiling). |
| Lifecycle *(optional)* | `PDFXYZ_LIFECYCLE_PROVIDER` (`aws-s3`\|`cloudflare-r2`\|`minio`\|`generic`), `PDFXYZ_LIFECYCLE_VALIDATED=true`, `PDFXYZ_LIFECYCLE_VERSIONED` | Declare that the generated policy is applied and verified. Back the assertion with evidence via `--lifecycle-verify` (§3). |
| Guardrails *(optional)* | `PDFXYZ_WORKER_STRICT`, `PDFXYZ_WORKER_REQUIRE_DRAINABLE`, `PDFXYZ_WORKER_REQUIRE_DEEP_ENGINE`, `PDFXYZ_WORKER_REQUIRE_LIFECYCLE`, `PDFXYZ_QUEUE_REQUIRE_ATOMIC`, `PDFXYZ_WORKER_REQUIRE_SCAN`, `PDFXYZ_WORKER_REQUIRE_OCR` | Fail fast on a dangerous production state. `PDFXYZ_QUEUE_REQUIRE_ATOMIC` (also implied by strict) rejects a deployment whose queue cannot guarantee atomic, race-safe transitions (`queue_atomic_unsupported`); `PDFXYZ_WORKER_REQUIRE_SCAN` / `PDFXYZ_WORKER_REQUIRE_OCR` (opt-in, **not** implied by strict) require an active scanner / a ready OCR engine. |

Copy [`.env.worker.example`](../.env.worker.example) to a git-ignored `.env`. Values
are read only to sign/authenticate inside the worker; they are never logged,
serialized, or returned.

### 1. Dry-run health (readiness + posture, claims nothing)

```bash
pnpm worker:daemon --dry-run-status   # exit 0 drainable · 2 not configured · 4 guardrail error
```

Emits content-free JSON: `readiness` (queue/storage/drainable), `compression_health`
(`deep`/`engines`), `deployment_readiness` (`posture` + a `facet` line each for
storage, queue, engine, lifecycle, **malware-scan**, **ocr**), and a `guardrails`
summary. Use it as the container `HEALTHCHECK` and the pre-advertise smoke.

### 2. Evaluate deployment guardrails

```bash
pnpm worker:daemon --check                        # exit 0 clean · 4 on any error violation
PDFXYZ_WORKER_STRICT=true pnpm worker:daemon --check   # enforce production requirements
```

A *selected-but-invalid* provider (e.g. `PDFXYZ_STORAGE_PROVIDER=s3` with a typo'd
variable) is an **error**, not a silent fallback. Run modes (`--once`/`--drain`/
`--loop`) run the same check and refuse to start (exit `4`) on an error.

### 3. Generate, apply & verify a lifecycle policy

```bash
# Print an AWS S3 policy for a versioned bucket under a key prefix (exit 0):
pnpm worker:daemon --lifecycle-policy --provider=aws-s3 --key-prefix=pdfxyz --versioned

# Extract just the document to apply:
pnpm worker:daemon --lifecycle-policy --provider=aws-s3 | jq -r 'select(.event=="lifecycle_policy").document' > lifecycle.json
aws s3api put-bucket-lifecycle-configuration --bucket <your-bucket> --lifecycle-configuration file://lifecycle.json
```

`--provider` defaults to any declared `PDFXYZ_LIFECYCLE_PROVIDER` (else `generic`).
A malformed retention override refuses generation (exit `1`) rather than emitting a
policy from silent defaults.

**Verify the applied policy (Phase 25).** After applying the rules, confirm the bucket
actually enforces the generated backstop — evidence, not just an assertion. You export
the live config out-of-band (the app never reads the bucket) and hand it to the daemon:

```bash
# Export the LIVE bucket lifecycle config (your credentials, out-of-band):
aws s3api get-bucket-lifecycle-configuration --bucket <your-bucket> > observed.json

# Verify it against the policy the app would generate. No cloud call happens here.
pnpm worker:daemon --lifecycle-verify --provider=aws-s3 --versioned --observed=observed.json
#   exit 0 verified · 2 unknown (no --observed supplied) · 4 drift or malformed document
```

The exported document is content-free (rule ids, structural prefixes, `Status`, day
counts — no bucket, endpoint, or credential), so it is safe to keep in CI. The output
reports each generated rule as `satisfied`/`stricter`/`weaker`/`disabled`/`missing`
plus a reconciliation plan; a `drift` verdict (exit `4`) means a backstop is not
actually in force. Only after verifying should you set `PDFXYZ_LIFECYCLE_PROVIDER` +
`PDFXYZ_LIFECYCLE_VALIDATED=true` so the readiness facet reports `validated`. See the
example exports and README in [`examples/lifecycle/`](examples/lifecycle/).

Two honesty caveats, both fail-safe (they never turn a real gap into `verified`):

- **Pass `--versioned` on a versioning-enabled bucket**, so the noncurrent-version and
  delete-marker backstops are checked; without it they are skipped. The daemon flags
  this with a `note` when the exported config itself contains version-cleanup rules.
- **Only pure-prefix (or whole-bucket) rules count** toward a backstop. A rule scoped
  by tag, object size, or a multi-condition `Filter.And` deletes only a subset of a
  prefix, so it is reported as `missing`/drift (never credited), and a version rule
  that *retains* recent versions (`NewerNoncurrentVersions`) does not satisfy the
  noncurrent backstop. If your bucket relies on such a rule, confirm coverage manually.

### 4. Start the worker (one-shot / drain / loop)

```bash
pnpm worker:daemon --once     # claim + run at most one job, then exit (smoke)
pnpm worker:daemon --drain    # drain the backlog to idle, then exit (batch/cron)
pnpm worker:daemon            # long-running: drain, then poll (sleeps when idle)
```

Exit codes: `0` clean · `1` usage · `2` not configured to run · `3` queue
unreachable · `4` guardrail violation. SIGINT/SIGTERM drain the in-flight tick and
exit cleanly.

### What is real now vs. intentionally not implemented

- **Real:** provider config validation; the drain/one-shot/loop daemon; lossless
  compression always, `deep` when a native engine is installed; an **optional
  ClamAV/clamd malware-scan gate** (streams inputs over INSTREAM; blocks infected
  before processing) — off unless a clamd endpoint is configured, else the honest
  no-op; retention→lifecycle policy generation/validation for four providers, plus
  **structural verification** of an operator-exported lifecycle config against the
  generated backstop (`--lifecycle-verify`, offline — no cloud call); active
  delete-now proven on every terminal executor path; deployment readiness/posture;
  production guardrails; content-free readiness + logs.
- **Intentionally NOT implemented (never faked):** *applying* a lifecycle policy to a
  live bucket, and *reading* the live bucket to verify it — the operator runs the
  provider CLI for both (apply, then export the config for `--lifecycle-verify`); the
  app never calls the cloud;
  **OCR** and the other non-compress processors; and, when no clamd endpoint is
  configured, **malware scanning** stays inactive and an unscanned upload is never
  reported as scanned. The status and readiness surfaces state each of these honestly.

### Security notes (logs / secrets / filenames / object keys)

- The daemon's entire output is content-free structured JSON: run/tick counters,
  opaque job ids, error **codes**, presence-only readiness, and typed guardrail
  codes/messages — never a filename, byte, object key, signed URL, option value,
  **environment-variable name**, or secret. Guardrail field names exist only in the
  return value for programmatic use; the CLI never prints them.
- Generated lifecycle documents contain only structural prefixes + day counts, and
  apply to a `<bucket>` placeholder — never a real bucket, endpoint, or credential.
- Filenames stay client-side/opaque end to end (Phase 18); object keys derive from
  opaque ids, never from a user-supplied name.

## Phase 20 container CI + production runbook

Phase 20 makes the container model a **first-class CI check** and adds an
operational **runbook** for a real two-service rollout, without faking any
infrastructure.

- **Container CI** — [`.github/workflows/container.yml`](../.github/workflows/container.yml)
  builds **both** the `web` and `worker` image targets on GitHub Actions and, inside
  the built worker image, runs the no-config honesty smoke (`pnpm worker:smoke`),
  asserts the readiness probe reports not-configured (exit `2`), and also runs the
  image-level native-engine + OCR proofs (`pnpm worker:image-smoke`, plus the node-free
  `pnpm worker:engines` preflight with the production require-flags armed —
  `PDFXYZ_WORKER_REQUIRE_OCR` / `PDFXYZ_WORKER_REQUIRE_DEEP_ENGINE` — which must pass
  precisely because the image ships the engines), and — after presence is established —
  the deterministic OCR **recognition** proof (`pnpm worker:ocr-proof`, Phase 25), which
  OCRs a generated sentinel raster and verifies the sentinel is recognized, and then the
  OCRmyPDF **searchable-PDF** proof (`pnpm worker:ocrmypdf-proof`, Phase 27), which turns a
  generated **image-only** PDF into a genuinely **searchable** one and verifies `pdftotext`
  extracts the sentinel from the OUTPUT but not the source (no user document, no cloud, no
  secret). It proves the
  web ↔ worker split at the image level — asserting the worker image ships
  `gs`/`qpdf`/`mutool`/`tesseract`/`ocrmypdf` (and the proof-only `pdftotext`) and the web
  image ships none. It builds
  with `push: false` — images are validated, never published — so the workflow needs
  **no** secret.
- **Docker-free gate** — the JS CI job ([`ci.yml`](../.github/workflows/ci.yml)) now
  also runs `pnpm worker:smoke`, so the daemon's honest exit-code contract (clean `0`,
  not-configured `2`, usage error `1`, fail-fast guardrail `4`) gates every PR even
  where Docker is unavailable.
- **Static invariants** — [`src/deploy/artifacts.test.ts`](../src/deploy/artifacts.test.ts)
  and [`src/deploy/ci-workflow.test.ts`](../src/deploy/ci-workflow.test.ts) pin the
  Dockerfile/compose/workflow invariants (two independent targets, worker
  `HEALTHCHECK` is the presence-only probe, both image targets built in CI, and **no
  committed secret** in any artifact or workflow).
- **Runbook** — the full production procedure (web vs worker responsibilities, env by
  service with placeholders only, build/publish/promote-by-digest, smoke, and
  rollback) is in [`RUNBOOK.md`](RUNBOOK.md).

## Phase 31 operator healthcheck (cron / uptime / supervisor wiring)

`pnpm worker:ops-check` folds the readiness/deployment/guardrail/engine/scanner/lifecycle
posture and the Phase 30 liveness heartbeat into a **single alert verdict + exit code** a
monitor keys on. It claims no job, contacts no metrics backend, and pages no one — it is
local evaluation. It reads a provider (the heartbeat broker) only through the existing
disabled-by-default seam, so with nothing configured it makes no network call.

**Sources** (pick one; default `--runtime`):

```bash
pnpm worker:ops-check                 # ON the worker host: real engine/OCR/scanner probes + heartbeat
pnpm worker:ops-check --web           # on a monitor host: config-only web-vantage snapshot + heartbeat
curl -s "$APP/api/worker/operations" | pnpm worker:ops-check --stdin   # evaluate a scraped snapshot
pnpm worker:ops-check --file=snapshot.json            # evaluate a saved snapshot ({ operations, metrics })
```

**Formats:** `--json` (default, for a monitor to parse), `--prometheus` (scrapeable
gauges: `pdfxyz_ops_check_severity` + per-subsystem, all bounded-enum labels), `--text`.

**Exit codes** (distinct from the daemon's — here `2` = unknown/no-data, `4` = critical):

| Code | Meaning |
| ---- | ------- |
| `0` | OK — healthy |
| `1` | usage — bad flag / unreadable / malformed input |
| `2` | UNKNOWN — health could not be determined (no data) |
| `3` | WARNING — a recommended fix is outstanding |
| `4` | CRITICAL — a worker cannot run correctly, or an SLO breached |

**Wire it** — schedule it and alert on a non-zero, non-`1` exit (`1` means the *check*
was misconfigured, not the worker):

```bash
# cron on a monitor host
*/5 * * * * cd /app && pnpm -s worker:ops-check --web; c=$?; [ "$c" -ge 2 ] && your-notifier "ops-check exit $c"

# systemd timer / supervisor: run `pnpm worker:ops-check`, treat exit >= 2 as an incident
# CI gate: pnpm worker:ops-check --file=docs/examples/observability/healthcheck/healthy.json  (asserts 0)
```

The output is content-free by construction and never echoes an ingested string, so it is
safe in any cron/monitor log. What stays operator-owned: the scheduler above, a hosted
timeseries store, and the notifier/pager. See
[`OBSERVABILITY.md`](OBSERVABILITY.md#operator-healthcheck--alert-evaluation-phase-31) and
the runnable fixtures in
[`docs/examples/observability/healthcheck/`](examples/observability/healthcheck/).
