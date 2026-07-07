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
  app's TTLs are not a substitute for bucket lifecycle rules. As of **Phase 41** the
  storage-backed download route additionally enforces the artifact retention window
  **at retrieval time**: the worker signs the window as content-free object metadata
  (`x-amz-meta-artifact-lifecycle`, no new env config — it reuses the existing
  artifact TTL) and the app denies a logically-expired object `410 Gone` **before**
  streaming a byte, even in the gap between its deadline and the bucket rule reaping
  it. This is app-level access denial, **not** a deletion guarantee and **not** a
  substitute for the bucket lifecycle rule — configure the bucket rule anyway (it is
  the actual deletion backstop; watch `worker_artifact_expiry_total{state="expired"}`
  for drift, i.e. the bucket still serving objects past their window). Legacy objects
  written before Phase 41 carry no lifecycle metadata (`state="unknown"`) and are
  served honestly, relying on the bucket rule alone until they age out.
- Add a bucket **CORS policy** for the direct-transfer paths: the browser still
  uploads bytes **directly** against a signed `PUT`, so allow the app's exact
  origin(s) for `PUT` (uploads), permit the `content-type` request header, and
  expose `ETag`; a valid signature is otherwise blocked by the browser. As of
  **Phase 39, artifact _downloads_ are proxied through the app** — the opaque route
  `GET /api/artifacts/:artifactId` reads the object server-side and streams it, so
  the browser never touches a signed download URL and bucket CORS for `GET` is not
  required for the app's own downloads (still allow `GET`/`DELETE` for any
  out-of-band tooling and delete-now). Downloads therefore flow through the app
  server by design (no signed link ever reaches the client); size app egress
  accordingly.
- Keep upload TTLs short (default: 15 minutes) and verify clocks are in sync for
  SigV4 signing. The server-side download GET is signed for a short internal window
  (~5 min) and never leaves the server; artifact `expiresAt` is the retention window.
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

## Upload intake guardrails

Phase 35 adds a server-side intake policy in front of secure-worker upload and job routes. Leave the defaults unless you have measured production capacity: they inherit `JOB_LIMITS` and reject over-size declarations, unsupported file families, MIME/extension mismatches, hostile filenames, and too many job inputs before storage/queue work. Optional PDF envelope checks can be enabled with `PDFXYZ_UPLOAD_REQUIRE_PDF_MAGIC=true` and/or `PDFXYZ_UPLOAD_REQUIRE_PDF_EOF=true`; these checks scan only bounded leading/trailing windows and are not a substitute for worker malware scanning or PDF soundness processing.

Relevant server-only env names: `PDFXYZ_UPLOAD_MAX_FILE_BYTES`, `PDFXYZ_UPLOAD_MAX_REQUEST_BYTES`, `PDFXYZ_UPLOAD_MAX_FILES`, `PDFXYZ_UPLOAD_MAX_FILENAME_LENGTH`, `PDFXYZ_UPLOAD_REQUIRE_PDF_MAGIC`, `PDFXYZ_UPLOAD_REQUIRE_PDF_EOF`, `PDFXYZ_UPLOAD_PDF_HEADER_SCAN_BYTES`, `PDFXYZ_UPLOAD_PDF_TRAILER_SCAN_BYTES`. Never expose these as `NEXT_PUBLIC_*`.

## Worker soundness configuration

Phase 36 enables a worker-side file-soundness gate by default. Server/worker-only env names: `PDFXYZ_WORKER_SOUNDNESS`, `PDFXYZ_WORKER_SOUNDNESS_MAX_BYTES`, `PDFXYZ_WORKER_SOUNDNESS_MAX_INPUTS`, `PDFXYZ_WORKER_SOUNDNESS_REQUIRE_PDF_HEADER`, `PDFXYZ_WORKER_SOUNDNESS_REQUIRE_PDF_EOF`, `PDFXYZ_WORKER_SOUNDNESS_CHECK_CONTENT_TYPE`, `PDFXYZ_WORKER_SOUNDNESS_CHECK_SIZE`, `PDFXYZ_WORKER_SOUNDNESS_HEADER_SCAN_BYTES`, and `PDFXYZ_WORKER_SOUNDNESS_TRAILER_SCAN_BYTES`. Defaults are conservative: gate on, PDF header required for PDF-expected inputs, content-type and declared-size checks on, EOF and hard max-bytes opt-in. Keep these variables off the public client (`NEXT_PUBLIC_*`) and treat them as operational policy, not proof of sanitization.

## Worker artifact-manifest configuration

Phase 37 enables a worker-side artifact-manifest / provenance gate by default. Like soundness it runs **only inside the worker/daemon** (after a processor succeeds, before any bytes are persisted) and makes no security claim, so it needs no backend and ships on. Server/worker-only env names: `PDFXYZ_WORKER_ARTIFACT_MANIFEST` (master switch), `PDFXYZ_WORKER_ARTIFACT_MAX_COUNT`, `PDFXYZ_WORKER_ARTIFACT_MAX_BYTES` (per-output byte ceiling; `0`/unset ⇒ off), `PDFXYZ_WORKER_ARTIFACT_CHECK_CONTENT_TYPE`, and `PDFXYZ_WORKER_ARTIFACT_REQUIRE_RETENTION_CLASS`. Defaults are conservative: gate on, output-count capped, content-type and retention-class checks on, per-output byte ceiling opt-in. These are **worker-only** — deploy them with the same discipline as `PDFXYZ_WORKER_SOUNDNESS_*` and the worker-only queue/heartbeat secrets: never expose them as `NEXT_PUBLIC_*` and never let a shared `envFrom` leak them onto the public web pod (the web/worker env-separation invariant, see the rate-limit and heartbeat notes above). Setting `PDFXYZ_WORKER_ARTIFACT_MAX_BYTES` tighter than real outputs will reject legitimate jobs as `oversize_artifact`; leave it `0` unless you have measured output sizes. Treat the gate as structural provenance policy, not proof of sanitization or deletion.

## Phase 43 storage-artifact cleanup pipeline scheduling

Phase 43 adds copy-and-adapt scheduler templates for the offline storage-artifact cleanup pipeline under [`docs/examples/deployment/cleanup`](examples/deployment/cleanup). The pipeline has three offline stages, **none of which calls the cloud, needs credentials, or deletes anything**:

1. **Project** — `pnpm worker:cleanup-project` reads a raw provider export you captured out-of-band (`aws s3api list-objects-v2` / `head-object`, or a normalized dump) and emits the two content-free Phase 42 shapes, dropping every object key/bucket/URL/endpoint/id/ETag/filename/user-metadata.
2. **Verify** — `pnpm worker:cleanup-check` folds the projected **evidence** to prove whether should-be-gone artifacts are actually absent (deleted/reaped) or only retrieval-denied.
3. **Sweep** — `pnpm worker:artifact-cleanup` evaluates the projected **inventory** and reports expired/tombstoned-but-present objects as a dry-run plan.

Templates (all placeholder-only — no real bucket, key, URL, or secret):

- `cleanup/cleanup-evidence-notify.sh` — inert wrapper that projects a mounted export, runs the verifier + dry-run sweeper, and re-raises the worst actionable exit code.
- `kubernetes/cleanup-check-cronjob.yaml` — a `CronJob` that projects a ConfigMap-mounted raw export (the operator populates it out-of-band with their own credentials) and runs the verifier + sweeper, failing the Job on drift/breach.
- `scheduler/pdfxyz-cleanup-check.service` + `.timer` and `scheduler/cleanup-check.cron` — systemd + cron wiring that run the wrapper hourly.
- `github-actions/cleanup-evidence-fixture.yml` — a CI gate that projects the committed content-free fixtures and asserts each exit code, plus the end-to-end pipe into the Phase 42 tools.

Key your monitor on the **exit code** (higher = worse; `1` is a distinct "the check itself was misused"): `cleanup-project` — `0` projected / `1` usage / `2` insufficient / `4` unsafe; `cleanup-check` — `0` verified / `1` usage / `2` unknown/not-configured / `3` drift; `artifact-cleanup` — `0` ok / `1` usage / `2` unknown / `3` drift / `4` breach. Alert on `>= 3` (drift/breach) and on any projection `unsafe`; treat `2` as a soft "not enough evidence / storage not wired". The full alerting table lives in [`docs/examples/deployment/cleanup/README.md`](examples/deployment/cleanup/README.md).

Validate the templates locally with:

```bash
pnpm deploy:examples:check
# Roll up a mounted export through project → verify → dry-run sweep (exit 4 on the unsafe fixture):
PDFXYZ_CLEANUP_RAW_EXPORT=docs/examples/cleanup-project/raw-unsafe-tombstoned.json \
  sh docs/examples/deployment/cleanup/cleanup-evidence-notify.sh
```

Honesty boundary: these templates were statically validated and smoke-run against committed content-free fixtures here; they were not applied to a real Kubernetes cluster, cloud bucket, or pager. A `drift`/`breach` is a cleanup gap, not a disclosure (the Phase 41 retrieval boundary still denies the download) and not a claim about your bucket lifecycle policy's correctness (verify that with `worker:daemon --lifecycle-verify`). Producing the raw export and performing any deletion/CDN purge both remain operator-owned and out-of-band.

## Phase 45 operations evidence bundle artifacts

Phase 45 adds `pnpm worker:ops-bundle` and placeholder-only deployment examples for collecting a safe support/incident artifact. The bundle should run wherever `worker:ops-check` and the cleanup pipeline reports are already available; it does **not** need cloud credentials and must not be pointed at raw provider exports. Examples are under `docs/examples/deployment/kubernetes/ops-bundle-cronjob.yaml`, `docs/examples/deployment/scheduler/ops-bundle*`, and `docs/examples/deployment/github-actions/ops-bundle-fixture.yml`.

Typical production wiring is: schedule `worker:ops-check --runtime --json`, optionally run `worker:cleanup-pipeline --json`, then compose them with `worker:ops-bundle --operations-file=<ops-summary> --pipeline=<cleanup-summary> --output=<bundle.json>`. Key automation on the bundle exit code (`0` ok, `1` usage/miswired, `2` unknown, `3` warning, `4` critical). The output file path is operator-owned and never appears in the bundle; choose a local location with normal log-retention controls. Validate the examples with `pnpm deploy:examples:check`.

## Phase 46 release readiness gate artifacts

Phase 46 adds the local, offline, read-only **release readiness gate** for the promotion step, plus a placeholder-only deployment example. It needs no cloud credentials and does not perform the promotion.

- **`pnpm worker:release-gate`** RUNS the checks itself and is the natural fit for a single-host pre-deploy sweep; it reads only exit codes. Key automation on its verdict/exit ladder (`0` pass, `1` usage, `2` unknown, `3` warn, `4` fail). `--only`/`--skip` scope the run by bounded check id. Wire it into CI with the committed `docs/examples/deployment/github-actions/release-gate-fixture.yml`, which runs the full gate, asserts exit `0`, and — because an authored non-zero exit is a PASS (e.g. `cleanup-pipeline-breach` expects `4`) — exercises the fail-closed contract, then uploads the JSON report as a build artifact. It is a pre-deploy evidence gate, **not** live cloud validation: it reads only the committed deployment blueprints (secret-scanned by its `deploy-examples` check), never the working tree, so run your changed-file secret/NUL scan separately before you promote.

The committed CI example is `docs/examples/deployment/github-actions/release-gate-fixture.yml`; validate it with `pnpm deploy:examples:check`. As with the other tools, a `pass` verdict certifies only the evidence gathered here; real cloud state (bucket lifecycle, object deletion, queue/broker health, CDN), legal retention, data migration, and provider quotas remain operator-owned and out-of-band.

## Phase 47 release evidence artifact

Phase 47 adds the local, offline, read-only **release evidence artifact** for the archival step, plus a placeholder-only deployment example. It needs no cloud credentials, deletes nothing, and does not perform the promotion.

- **`pnpm worker:release-artifact`** archives the `worker:release-gate` result (run internally, or supplied via `--release-gate=<file>`) with bounded git/release provenance and an integrity digest, producing a stable `pdfxyz.release-artifact/1` record to keep as a CI artifact / release record / incident-handoff attachment. Key automation on its verdict/exit ladder (`0` pass, `1` usage, `2` unknown, `3` warn, `4` fail). The archived gate verdict is primary; a **dirty** working tree escalates a clean `pass` to `warn` (the recorded commit does not fully describe the built bytes). It records a cleanliness enum, a ref **class** (never the raw branch/remote), a validated short commit hash, and an optional validated `--label` — `--no-vcs` suppresses git facts entirely.
- **Integrity, not signing.** `integrity.digest` is a `sha256` over the canonical body (`pdfxyz-sorted-keys/1`). Re-verify it offline with `pnpm worker:release-artifact --verify=<file>` (a mismatch is exit `4`); there is no signing key and no attested identity, so it is tamper-evidence, not a signature. The `--output=<path>` and input paths are operator-owned and never embedded in the artifact.

Wire it into CI with the committed `docs/examples/deployment/github-actions/release-artifact-fixture.yml`, which runs the gate, archives the artifact, uploads it as a CI artifact, verifies its digest, and asserts both the tamper-detection (exit `4`) and usage (exit `1`) fail-closed exits; validate it with `pnpm deploy:examples:check`. Example inputs live under `docs/examples/release-artifact/`. As with the other tools, a `pass` certifies only the evidence gathered here; real cloud state, byte deletion, legal retention, data migration, and provider quotas remain operator-owned and out-of-band. It is evidence aggregation + integrity over content-free data — **not** signing, authentication, cloud validation, deletion proof, or the promotion.

## Phase 48 release evidence index / retention manifest

Phase 48 adds the local, offline, read-only **release evidence index / retention manifest** for the archival/retention step, plus a placeholder-only deployment example. It needs no cloud credentials, deletes/prunes nothing, and does not perform the promotion.

- **`pnpm worker:release-index`** ingests one or more `pdfxyz.release-artifact/1` files (repeated `--artifact`/`--file`, or a JSON array on stdin), **re-verifies each one's integrity digest** using the Phase 47 canonicalization + `sha256`, and folds them into a stable `pdfxyz.release-index/1` manifest an operator/CI keeps as a retention record. Key automation on its verdict/exit ladder (`0` ok, `1` usage, `2` insufficient, `3` warn, `4` invalid). The manifest keys on ARCHIVE HEALTH — integrity first, then retention: any tampered/malformed digest forces `invalid` (exit `4`), and a retention concern (over-count, over-age, stale) or a skipped non-artifact input is `warn` (exit `3`); an empty archive is `unknown` (exit `2`).
- **Retention is FLAGGED, never enforced.** `--max-artifacts=N` and `--max-age-days=N` mark over-retention artifacts as prune candidates and drive drift/stale in the rollup, but the offline index never deletes, prunes, uploads, or mutates any artifact or object — pruning is an operator/CI action out of band. The per-artifact `verdictCounts` transparently report the archived build verdicts (so an `ok` manifest can still show a `fail` in history), while the rollup stays about archive integrity + retention.
- **Content-free by construction.** Each ingested artifact is reduced to bounded enums, small counts, coarse age BUCKETS, and short hex digest PREFIXES — no filename, path, object key, bucket, URL, raw ref, raw label (only a `semver`/`named`/`absent` class), commit URL, size, or byte, even from a hostile input. The `--output`/input paths are operator-owned and never embedded in the manifest or an error.

Wire it into CI with the committed `docs/examples/deployment/github-actions/release-index-fixture.yml`, which runs the gate, archives an artifact, indexes + validates it as a CI artifact, and asserts both the tamper-detection (exit `4`) and usage (exit `1`) fail-closed exits; validate it with `pnpm deploy:examples:check`. Example inputs + a committed sample manifest live under `docs/examples/release-index/`. As with the other tools, an `ok` certifies only that the archive is intact + within retention on this host; real cloud/storage retention, object deletion, legal holds, and CDN state remain operator-owned and out-of-band. It is content-free indexing + digest verification — **not** storage retention enforcement, signing, authentication, cloud validation, or the promotion.

## Phase 49 release evidence policy assertions

Phase 49 adds the local, offline, read-only **release evidence policy** gate for the acceptance step, plus a content-free CI workflow example. It needs no cloud credentials, deletes/promotes nothing, and does not perform the deployment.

- **`pnpm worker:release-policy`** evaluates a small, explicit set of bounded operator thresholds against a `pdfxyz.release-index/1` manifest (`--index=<path>`, or a release-index on stdin), or against an in-process index of `pdfxyz.release-artifact/1` files (`--artifact=<path>`, repeated — the strongest mode, re-verifying every digest). It answers **“Is this release evidence archive acceptable under our explicit release policy?”** Key automation on its verdict/exit ladder (`0` pass, `1` usage, `2` unknown, `3` warn, `4` fail). Blocking assertions (`--require-clean`, `--require-latest-ok`, `--max-invalid=N`, `--max-fail=N`, `--min-artifacts=N`, `--max-artifacts=N`, `--max-age-bucket=<bucket>`) escalate to `fail`; warning-only ones (`--max-warn=N`, `--max-skipped=N`, `--forbid-over-retention`) escalate at most to `warn`. An unset flag asserts nothing; running with no flags checks only the index's structural integrity.
- **Fail closed on a bad archive.** An unreadable / not-a-release-index input is `unknown` (exit `2`, never a pass); an empty archive is `unknown`; a malformed / internally inconsistent index, or a valid index that reports a tampered artifact, is `fail` (exit `4`) — regardless of which flags were set. In `--index` mode the policy recomputes the archive-health verdict from the index's OWN counts (via the Phase 48 rollup) and rejects a manifest whose counts or rollup contradict each other, so a flipped `rollup.verdict` cannot smuggle a tampered archive past the gate.
- **Content-free by construction.** The ingested index is reduced to bounded enums, small counts, and coarse age buckets; the result + `worker_release_policy_total{verdict}` metric carry no filename, path, object key, bucket, URL, raw ref, raw label, commit URL, size, or byte, even from a hostile input. The `--output`/input paths are operator-owned and never embedded in the result or an error.

Wire it into CI as the final gate after `worker:release-artifact` → `worker:release-index`, using the committed `docs/examples/deployment/github-actions/release-policy-fixture.yml` workflow (fail the job on exit `4`, surface exit `3` for review, treat exit `2` as a setup error). Example index fixtures live under `docs/examples/release-policy/`. As with the other tools, a `pass` certifies only that the archive met YOUR explicit policy on this host; real cloud validation, signing, storage retention enforcement, legal holds, and the deployment approval/promotion remain operator-owned and out-of-band. It is bounded policy evaluation over content-free evidence — **not** signing, authentication, cloud validation, storage retention enforcement, or the promotion.

## Phase 50 release evidence CI bundle

Phase 50 adds the local, offline, read-only **release evidence CI bundle** — the FINAL handoff step that composes the whole chain into one content-free record, plus a content-free CI workflow example. It needs no cloud credentials, runs no stage itself, deletes/promotes nothing, and does not perform the deployment.

- **`pnpm worker:release-ci-bundle`** ingests whichever of the content-free stage outputs a release job produced — a `pdfxyz.worker-release-gate/1` (`--release-gate=<path>`), a `pdfxyz.release-artifact/1` (`--release-artifact=<path>`), a `pdfxyz.release-index/1` (`--release-index=<path>`), and/or a `pdfxyz.release-policy/1` (`--release-policy=<path>`) — and answers **“What did the release evidence chain decide end-to-end, do the stages AGREE, what should be archived, and what is the next safe operator action?”** Supply at least one stage; for a certifiable bundle include at least an index or a policy. Key automation on its verdict/exit ladder (`0` pass, `1` usage, `2` unknown, `3` warn, `4` fail).
- **Re-verifies consistency, fails closed on disagreement.** It reduces each stage to bounded facts and evaluates six blocking links: `artifact-digest` (re-hash the artifact's integrity digest in-process), `index-self-consistent` + `policy-self-consistent` (recompute each stage's verdict from its own counts — a flipped `rollup.verdict` cannot smuggle a tampered stage past the bundle), `gate-artifact-agreement` (the artifact archived the same gate decision), `artifact-index-inclusion` (the artifact is a verified entry in the index), and `index-policy-agreement` (the policy was evaluated over that index). A stage `fail` OR any link `mismatch` is `fail` (exit `4`); an unreadable/indeterminate stage or a decision-less chain is `unknown` (exit `2`, never a pass); an advisory stage verdict is `warn` (exit `3`).
- **Content-free by construction.** Every stage is reduced to bounded enums, small counts, and booleans; the result + `worker_release_ci_bundle_total{verdict}` metric carry no filename, path, object key, bucket, URL, raw ref, raw label, commit URL, size, digest, or byte, even from a hostile input. The `--output`/input paths are operator-owned and never embedded in the result or an error.

Wire it into CI as the FINAL step after `worker:release-gate` → `worker:release-artifact` → `worker:release-index` → `worker:release-policy`, using the committed `docs/examples/deployment/github-actions/release-ci-bundle-fixture.yml` workflow (fail the job on exit `4`, surface exit `3` for review, treat exit `2` as a setup error, upload the bundle as a CI artifact / release handoff record). Example stage fixtures live under `docs/examples/release-ci-bundle/`. As with the other tools, a `pass` certifies only that the stages supplied were coherent on this host; real cloud validation, signing, storage retention enforcement, legal holds, and the deployment approval/promotion remain operator-owned and out-of-band. It is content-free bundling + consistency checking over evidence — **not** signing, authentication, cloud validation, storage retention enforcement, or the promotion.

## Phase 51 release evidence audit / diff

Phase 51 adds the local, offline, read-only **release evidence audit / diff** — an OPTIONAL CI regression gate that closes the loop OVER TIME by comparing release CI bundles, plus a content-free CI workflow example. It needs no cloud credentials, runs no stage or bundle itself, deletes/promotes nothing, and does not perform the deployment.

- **`pnpm worker:release-audit`** ingests two (or a history of) content-free `pdfxyz.release-ci-bundle/1` bundles — a `--baseline=<path>` and a `--current=<path>` (pair mode), or a chronological `--bundle=<path>` list / a `--stdin` JSON array (history mode) — RE-VALIDATES each bundle against itself (re-deriving its Phase 50 rollup, so a hand-flipped bundle verdict is caught as a tamper), DIFFS their bounded postures, and answers **“did this release's evidence posture REGRESS versus a baseline/history, and what is the next safe operator action?”** Key automation on its verdict/exit ladder (`0` pass, `1` usage, `2` unknown, `3` warn, `4` fail). Bounded policy knobs: `--allow-warn-regression` (accept an expected drift), `--max-new-warnings=N`, `--fail-on-unknown` (escalate a drop to an uncertified posture to blocking).

- **Diff-only, fail-closed, content-free.** A blocking regression (the current bundle dropped to `fail`, a held consistency link now mismatches, the archive decision worsened to a blocking state) OR a recognized-but-self-inconsistent (tampered) bundle is `fail` (exit `4`); an unreadable bundle or too little comparable history is `unknown` (exit `2`, never a vacuous pass); an advisory drift is `warn` (exit `3`). A `pass` only means the current bundle did not regress versus the baseline — gate the current bundle on its own (`worker:release-ci-bundle` / `worker:release-policy`) too. Every bundle is reduced to bounded enums, small counts/deltas, and booleans; the result + `worker_release_audit_total{verdict}` metric carry no filename, path, object key, bucket, URL, raw ref, raw label, commit URL, size, digest, or byte, even from a hostile bundle. The `--output`/input paths are operator-owned and never embedded in the result or an error.

Wire it into CI as an OPTIONAL regression gate AFTER `worker:release-ci-bundle`, keeping the previous release's bundle as the baseline (a committed artifact or a restored CI artifact), using the committed `docs/examples/deployment/github-actions/release-audit-fixture.yml` workflow (fail the job on exit `4`, surface exit `3` for review, treat exit `2` as a setup error, upload the audit as a CI artifact / release regression record). Example baseline/current bundle fixtures live under `docs/examples/release-audit/`. As with the other tools, a `pass` certifies only that the current bundle did not regress versus the baseline supplied on this host; real cloud validation, signing, storage retention enforcement, legal holds, and the deployment approval/promotion remain operator-owned and out-of-band. It is content-free audit/diff over evidence — **not** signing, authentication, cloud validation, storage retention enforcement, or the promotion.

## Phase 52 release evidence operator report

Phase 52 adds the local, offline, read-only **release evidence operator report** — the FINAL CI-summary / handoff step that folds the release CI bundle (+ optional audit) into ONE bounded operator recommendation, plus a content-free CI workflow example. It needs no cloud credentials, runs no stage / bundle / audit itself, deletes/promotes/approves nothing, and does not perform the deployment.

- **`pnpm worker:release-report`** ingests a content-free `pdfxyz.release-ci-bundle/1` (`--bundle=<path>`) and/or a `pdfxyz.release-audit/1` (`--audit=<path>`; either may be `-` for stdin — at least one required), RE-VALIDATES each against itself (re-deriving its Phase 50/51 rollup, so a hand-flipped verdict is caught as a tamper), and answers **“what should the operator DO now, based only on the content-free release evidence — is this release promote-ready, should it be held, or is the evidence insufficient?”** It emits the evidence coverage, per-source summaries, a final recommendation + bounded rationale, an archive checklist, and an ordered next-action checklist. Key automation on its recommendation/exit ladder (`0` promote-ready, `1` usage, `2` needs-evidence, `3` hold-warning, `4` hold-fail). One policy knob: `--strict` (treat an advisory-only concern as a blocking hold-fail).
- **Recommend, fail-closed, content-free.** A tamper / a failed bundle / a blocking audit regression is `hold-fail` (exit `4`); an unreadable or indeterminate document, or **no usable bundle at all** (an audit-only run), is `needs-evidence` (exit `2`, never a promote); an advisory bundle warn / audit drift is `hold-warning` (exit `3`); a usable bundle that PASSED with no regression is `promote-ready` (exit `0`). **A `promote-ready` requires a usable bundle whose own verdict is `pass`** — an audit only reports *no regression versus a baseline*, so it can never, on its own, certify the release's own coherence. Every document is reduced to bounded enums, small counts, and booleans; the result + `worker_release_report_total{recommendation}` metric carry no filename, path, object key, bucket, URL, raw ref, raw label, commit URL, size, digest, or byte, even from a hostile input. The `--output`/input paths are operator-owned and never embedded in the result or an error.

Wire it into CI as the FINAL CI-summary / handoff step AFTER `worker:release-ci-bundle` (and, optionally, `worker:release-audit`), using the committed `docs/examples/deployment/github-actions/release-report-fixture.yml` workflow (render `--text` into `$GITHUB_STEP_SUMMARY`, fail the job on exit `4`, surface exit `3` for review, treat exit `2` as a setup error, upload the report as a CI artifact / release handoff record). Example bundle/audit fixtures live under `docs/examples/release-report/`. As with the other tools, a `promote-ready` certifies only that the content-free evidence supplied on this host was coherent and non-regressed; real cloud validation, signing, storage retention enforcement, legal holds, and the deployment approval/promotion remain operator-owned and out-of-band. It is content-free reporting over evidence — **not** signing, authentication, cloud validation, storage retention enforcement, deployment approval, or the promotion.

## Phase 53 release evidence trend summary

Phase 53 adds the local, offline, read-only **release evidence trend summary** — a SCHEDULED governance-review step that folds a bounded HISTORY of the release operator reports into ONE governance verdict, plus a content-free CI workflow example. It needs no cloud credentials, runs no gate / bundle / audit / report itself, deletes/promotes/approves nothing, and does not perform the deployment.

- **`pnpm worker:release-trend`** ingests a bounded history of content-free `pdfxyz.release-report/1` reports (repeated `--report=<path>` / `--file=<path>`, oldest first / newest last; or a `--stdin` JSON array — at least one report required), RE-VALIDATES each against itself (re-deriving its Phase 52 recommendation, so a hand-flipped recommendation is caught as a tamper), and answers **“how has release evidence posture changed over the recent report history, and what bounded operator follow-up is warranted?”** It emits the recommendation distribution, a per-report posture sequence, a final trend verdict + bounded reasons, and an ordered follow-up checklist. Key automation on its verdict/exit ladder (`0` stable, `1` usage, `2` unknown, `3` warning, `4` failing). Small policy knobs: `--max-reports=N` (window cap), `--max-hold-warning=N` / `--max-hold-fail=N` (history tolerance), `--require-latest-ready` (demand a promote-ready tip).
- **Summarize, fail-closed, content-free.** A tampered report / a `hold-fail` newest / a breached `--max-hold-fail` / a required-not-ready tip is `failing` (exit `4`); an unreadable report / an empty history / a `needs-evidence` newest is `unknown` (exit `2`); a `hold-warning` newest / a breached `--max-hold-warning` / a degraded posture is `warning` (exit `3`); a clean window is `stable` (exit `0`). The NEWEST usable report is authoritative — a hold-fail tip fails the trend even within a tolerated threshold. Every report is reduced to bounded enums, small counts, and booleans; the result carries no filename, path, object key, bucket, URL, raw ref, raw label, size, digest, or byte, and never an ingested report's own stamp.

Wire it into CI as a SCHEDULED governance summary (weekly / monthly) over your archived per-release reports, using the committed `docs/examples/deployment/github-actions/release-trend-fixture.yml` workflow (render `--text` into `$GITHUB_STEP_SUMMARY`, fail the review on exit `4`, surface exit `3` for review, treat exit `2` as a coverage gap, upload the trend as a CI artifact / governance record). Example report fixtures live under `docs/examples/release-trend/`. As with the other tools, a `stable` trend certifies only that the content-free reports supplied on this host trended healthy over the review window; real cloud validation, signing, storage retention enforcement, legal holds, and the deployment approval/promotion remain operator-owned and out-of-band. It is content-free trend reporting over evidence reports — **not** signing, authentication, cloud validation, storage retention enforcement, deployment approval, or the promotion.

## Phase 54 release evidence governance bundle

Phase 54 adds the local, offline, read-only **release evidence governance bundle** — a SCHEDULED governance-review artifact that composes the release-trend window summary (PRIMARY) with the latest operator report and/or audit into ONE governance verdict for a weekly / monthly review, plus a content-free CI workflow example. It needs no cloud credentials, runs no gate / bundle / audit / report / trend itself, deletes/promotes/approves nothing, and does not perform the deployment.

- **`pnpm worker:release-governance`** ingests a content-free `pdfxyz.release-trend/1` window summary (`--trend=<path>`, the PRIMARY signal) plus, optionally, the latest `pdfxyz.release-report/1` (`--report=<path>`) and/or `pdfxyz.release-audit/1` (`--audit=<path>`; any value may be `-` for stdin, at most one; at least one document required), RE-VALIDATES each against itself (re-deriving the trend's Phase 53 verdict / report's Phase 52 recommendation / audit's Phase 51 rollup, so a hand-flipped verdict is caught as a tamper), cross-checks the latest report against the trend's own newest report, and answers **“what is the governance posture for this review window, what bounded evidence should be archived, and what follow-up should be assigned?”** It emits the evidence coverage, per-source summaries, a governance verdict + bounded reasons, an archive checklist, and an ordered follow-up assignment list. Key automation on its verdict/exit ladder (`0` healthy, `1` usage, `2` incomplete, `3` watch, `4` blocked). Small policy knobs: `--require-report` / `--require-audit` (make either latest document mandatory), `--strict-watch` (escalate an advisory watch to blocked).
- **Compose, fail-closed, content-free.** A tampered document / a `failing` trend / a `hold-fail` latest report / a blocking latest audit regression is `blocked` (exit `4`); an absent / unreadable / `unknown` trend / an indeterminate latest / a required-but-missing document is `incomplete` (exit `2`); a `warning` trend / a `hold-warning` report / an audit drift / a report ↔ trend drift is `watch` (exit `3`); a coherent window is `healthy` (exit `0`). The PRIMARY trend is required — a latest report / audit can only BLOCK or FLAG, never GRANT a healthy on its own (a trend-absent run is `incomplete`, never a vacuous healthy). Every document is reduced to bounded enums, small counts, and booleans; the result carries no filename, path, object key, bucket, URL, raw ref, raw label, size, digest, or byte, and never an ingested document's own stamp.

Wire it into CI as a SCHEDULED governance-review artifact (weekly / monthly) over your archived trend + latest report / audit, using the committed `docs/examples/deployment/github-actions/release-governance-fixture.yml` workflow (render `--text` into `$GITHUB_STEP_SUMMARY`, fail the review on exit `4`, surface exit `3` for review, treat exit `2` as a coverage gap, upload the bundle as a CI artifact / governance record). Example fixtures live under `docs/examples/release-governance/`. As with the other tools, a `healthy` window certifies only that the content-free evidence supplied on this host was coherent for the review window; real cloud validation, signing, storage retention enforcement, legal holds, and the deployment approval/promotion remain operator-owned and out-of-band. It is content-free governance bundling over evidence summaries — **not** signing, authentication, cloud validation, storage retention enforcement, deployment approval, or the promotion.

## Release archive CI artifact

`docs/examples/deployment/github-actions/release-archive-fixture.yml` shows a scheduled/manual CI review job that builds or ingests a release-governance bundle and emits `worker:release-archive` as a content-free artifact. The job is safe for CI because the command is offline/read-only and outputs only bounded postures, counts, record classes, checklist ids, follow-up ids, and caveats. It does not contact cloud storage, sign records, enforce retention, approve deployment, promote releases, or pack raw evidence files.

## Release restore drill CI artifact

`docs/examples/deployment/github-actions/release-restore-drill-fixture.yml` shows a scheduled disaster-recovery drill that RESTORES an archived `pdfxyz.release-archive/1` pack (and the underlying records it indexed) and runs `worker:release-restore-drill` over them, emitting a content-free `pdfxyz.release-restore-drill/1` receipt as a CI artifact and asserting the tamper (exit 4), nothing-restored (exit 2), and usage (exit 1) fail-closed paths. In the fixture the "restore" step rebuilds the files from committed content-free examples so the job is deterministic and offline; a real drill would pull them from your archive store. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only bounded verdicts, counts, restore-check states, follow-up ids, opaque sha256 fingerprints, and caveats. It does not contact cloud storage, retrieve objects, sign records, approve deployment, or promote releases.

## Release publish / handoff pack CI artifact

`docs/examples/deployment/github-actions/release-publish-pack-fixture.yml` shows a handoff-preparation job that builds a `pdfxyz.release-governance/1` bundle from committed content-free fixtures, composes `worker:release-publish-pack` over it plus the related archive/restore-drill/report/trend records, and emits a content-free `pdfxyz.release-publish-pack/1` manifest (with its DISCLOSURE CLASSIFICATION) as a CI artifact — asserting the blocked (exit 4), missing-governance (exit 2), and usage (exit 1) fail-closed paths. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only bounded verdicts, disclosure classifications, counts, coverage states, checklist ids, and caveats. It publishes/shares/sends/signs/approves/promotes nothing — the actual handoff to the external reviewer/approver/investor/incident responder is done out of band; the workflow only prepares the share-safe manifest. It does not contact cloud storage, retrieve objects, sign records, approve deployment, or promote releases.

## Release handoff acknowledgement CI artifact

`docs/examples/deployment/github-actions/release-handoff-ack-fixture.yml` shows a handoff-record job that composes a `pdfxyz.release-publish-pack/1` from committed content-free fixtures, records a bounded acknowledgement of it with `worker:release-ack --decision=accepted --reviewer=internal-approver`, and emits a content-free `pdfxyz.release-ack/1` receipt as a CI artifact — asserting the rejected/invalid (exit 4, a blocked / tampered pack), deferred (exit 2, an incomplete pack), and usage (exit 1) fail-closed paths. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded acknowledgement verdict, the pack's own verdict/disclosure, source counts, the recorded decision/reviewer class/note class, checklist ids, and caveats. It signs/approves/publishes/promotes/notifies nothing — the actual external signature/approval/promotion is done out of band; the workflow only records the acknowledgement receipt. It does not contact cloud storage, retrieve objects, sign records, approve deployment, or promote releases.

## Release decision record CI artifact

`docs/examples/deployment/github-actions/release-decision-record-fixture.yml` shows a release-ledger job that composes a `pdfxyz.release-publish-pack/1` from committed content-free fixtures, records an acknowledgement of it with `worker:release-ack`, then folds the pack + acknowledgement into ONE content-free `pdfxyz.release-decision/1` record with `worker:release-decision` — emitted as a CI artifact — asserting the reject/invalid (exit 4, a rejected / tampered acknowledgement), insufficient (exit 2, a deferred acknowledgement), and usage (exit 1) fail-closed paths. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded decision, per-source verdicts/disclosures, source counts, a cross-check status, checklist ids, and caveats. It signs/approves/publishes/promotes/deploys/notifies nothing — the actual external signature/approval/promotion/deployment is done out of band; the workflow only records the decision. It does not contact cloud storage, retrieve objects, sign records, approve deployment, or promote releases.

## Release decision ledger index CI artifact

`docs/examples/deployment/github-actions/release-decision-index-fixture.yml` shows a release-review job that files two content-free `pdfxyz.release-decision/1` records with `worker:release-decision` (from committed publish-pack + acknowledgement fixtures), then INDEXES the bounded batch into ONE `pdfxyz.release-decision-index/1` review summary with `worker:release-decision-index` — emitted as a CI artifact — asserting the blocked/invalid (exit 4, a `reject` decision / a tampered record), insufficient (exit 2, an inconclusive batch), and usage (exit 1) fail-closed paths. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded index verdict, a decision distribution, per-source cross-check posture counts, a per-record posture sequence, a trend class, checklist ids, and caveats. It signs/approves/publishes/promotes/deploys/notifies nothing — it is a ledger INDEX SUMMARY ONLY, not a legal audit log, a compliance attestation, an external approval/signature, an identity proof, or a deployment/promotion ledger. It does not contact cloud storage, retrieve objects, sign records, approve deployment, or promote releases.


## Release decision index trend CI artifact

`docs/examples/deployment/github-actions/release-decision-trend-fixture.yml` shows a release-governance job that indexes two content-free `pdfxyz.release-decision-index/1` windows with `worker:release-decision-index` (from committed decision-record fixtures), then SUMMARIZES the bounded history into ONE `pdfxyz.release-decision-trend/1` governance summary with `worker:release-decision-trend` — emitted as a CI artifact — asserting the blocked/invalid (exit 4, a `blocked` window / a tampered window), degrading (exit 3, a worsening arc), insufficient (exit 2, an inconclusive history), and usage (exit 1) fail-closed paths. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded trend verdict, a per-window index-verdict distribution, an aggregate decision distribution, a per-window posture sequence, an arc direction, a trend class, checklist ids, and caveats. It signs/approves/publishes/promotes/deploys/notifies nothing — it is a ledger-index TREND SUMMARY ONLY, not a legal audit log, a compliance attestation, an external approval/signature, an identity proof, or a deployment/promotion ledger. It does not contact cloud storage, retrieve objects, sign windows, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-action-plan-fixture.yml` shows a release-governance job that SUMMARIZES a bounded decision-index history into ONE `pdfxyz.release-decision-trend/1` trend with `worker:release-decision-trend` (from committed content-free window fixtures), then TRANSLATES that ONE trend into a `pdfxyz.release-decision-action-plan/1` operator follow-up plan with `worker:release-decision-action-plan` — emitted as a CI artifact — asserting the block-release/invalid (exit 4, a `blocked`/`invalid` trend or a non-trend decoy), followup (exit 3, a worsening degrading trend), investigate (exit 2, an inconclusive insufficient trend), `--strict` escalation (exit 4), and usage (exit 1) fail-closed paths. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded plan verdict, an urgency, an action class, the source trend verdict/class/arc, a next-action checklist, and caveats. It signs/approves/publishes/promotes/deploys/notifies nothing — it is a content-free operational follow-up plan ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign the trend, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-action-receipt-fixture.yml` shows a release-governance job that summarizes a decision-index history into ONE `pdfxyz.release-decision-trend/1` trend, translates it into a `pdfxyz.release-decision-action-plan/1` follow-up plan with `worker:release-decision-action-plan`, then RECORDS a `pdfxyz.release-decision-action-receipt/1` execution receipt with `worker:release-decision-action-receipt` (a clean stable plan reviewed by the operator via `--ack-plan` → completed) — emitted as a CI artifact — asserting the blocked (exit 4, a `block` plan not acknowledged / a tampered plan / a `--strict-open` escalation), followup-open (exit 3, an open advisory follow-up), incomplete (exit 2, an unexercised / missing plan), and usage (exit 1) fail-closed paths. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded receipt verdict, the plan class, and an acknowledgement checklist. The acknowledgements are bounded BOOLEANS an operator actually performed — never a free-form note or actor name. It signs/approves/publishes/promotes/deploys/notifies nothing — it is a content-free operational execution receipt ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign the plan, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-fixture.yml` shows a release-governance job that builds the whole decision chain — a `pdfxyz.release-decision-trend/1` trend, a `pdfxyz.release-decision-action-plan/1` plan, and a `pdfxyz.release-decision-action-receipt/1` execution receipt — then COMPOSES it into ONE `pdfxyz.release-decision-closeout/1` closeout with `worker:release-decision-closeout` (the receipt cross-checked against the plan + trend it was built from → closed) — emitted as a CI artifact — asserting the closeout-blocked (exit 4, a tampered / `blocked` receipt, a contradictory cross-check record, a tampered related record, a blocked source chain, or a `--strict-open` escalation), closeout-open (exit 3, a `followup-open` receipt or an advisory decision / index record), closeout-incomplete (exit 2, an unusable / missing primary receipt), and usage (exit 1) fail-closed paths. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded closeout verdict, the primary receipt's state + verdict, and a related-record checklist. It signs/approves/publishes/promotes/deploys/notifies nothing — it is a content-free operational closeout SUMMARY ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign the records, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-index-fixture.yml` shows a release-governance REVIEW job that records a bounded history of `pdfxyz.release-decision-closeout/1` closeouts (three completed releases → `closed`) and then INDEXES that history into ONE `pdfxyz.release-decision-closeout-index/1` review summary with `worker:release-decision-closeout-index` (a coherent all-closed history → `indexed`) — emitted as a CI artifact — asserting the index-blocked (exit 4, a `closeout-blocked` latest, a tampered closeout record, or a `--strict-open` escalation), index-open (exit 3, a `closeout-open` latest), index-incomplete (exit 2, a `closeout-incomplete` / unreadable closeout), and usage (exit 1) fail-closed paths. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded index verdict, the closeout-verdict distribution, the latest / oldest closeout verdict, and a per-record posture sequence. It signs/approves/publishes/promotes/deploys/notifies nothing — it is a content-free closeout-ledger INDEX SUMMARY ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign the records, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-index-trend-fixture.yml` shows a release-governance REVIEW job that indexes two content-free `pdfxyz.release-decision-closeout-index/1` windows with `worker:release-decision-closeout-index` (from committed closeout fixtures) and then SUMMARIZES that bounded history into ONE `pdfxyz.release-decision-closeout-index-trend/1` governance summary with `worker:release-decision-closeout-index-trend` (a coherent all-indexed history → `trend-stable`) — emitted as a CI artifact — asserting the trend-blocked (exit 4, an `index-blocked` latest, a tampered window, or a `--strict-watch` escalation), trend-watch (exit 3, an `index-open` latest or a degrading arc), trend-incomplete (exit 2, an `index-incomplete` / unreadable window), and usage (exit 1) fail-closed paths. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded trend verdict, the per-window index-verdict distribution, the aggregate closeout distribution, a per-window posture sequence, an arc direction, and a trend class. It signs/approves/publishes/promotes/deploys/notifies nothing — it is a content-free closeout-index TREND SUMMARY ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign the windows, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-action-plan-fixture.yml` shows a release-governance REVIEW job that summarizes two content-free `pdfxyz.release-decision-closeout-index/1` windows into ONE `pdfxyz.release-decision-closeout-index-trend/1` trend with `worker:release-decision-closeout-index-trend` (a coherent all-indexed history → `trend-stable`) and then TRANSLATES that ONE trend into a `pdfxyz.release-decision-closeout-action-plan/1` operator follow-up plan with `worker:release-decision-closeout-action-plan` (a stable trend → a `clear` plan) — emitted as a CI artifact — asserting the block-release (exit 4, a `trend-blocked` history, an unreadable / tampered trend input, or a `--strict-watch` escalation), monitor (exit 3, a `trend-watch` / degrading history), investigate (exit 2, a `trend-incomplete` history), and usage (exit 1) fail-closed paths. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded plan verdict, an urgency, an action class, the surfaced source trend verdict / class / arc / latest index posture, and a next-action checklist. It signs/approves/publishes/promotes/deploys/notifies nothing — it is a content-free operational FOLLOW-UP PLAN ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign the trend, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-action-receipt-fixture.yml` shows a release-governance REVIEW job that summarizes two content-free `pdfxyz.release-decision-closeout-index/1` windows into ONE trend, TRANSLATES that trend into a `pdfxyz.release-decision-closeout-action-plan/1` follow-up plan with `worker:release-decision-closeout-action-plan`, and then RECORDS whether that plan's follow-ups were acknowledged with `worker:release-decision-closeout-action-receipt` (a coherent stable plan reviewed by the operator → `completed`) — emitted as a `pdfxyz.release-decision-closeout-action-receipt/1` CI artifact — asserting the blocked (exit 4, a missing / unreadable / tampered plan, a `block` plan not acknowledged as held-blocked, a contradictory acknowledgement, or a `--strict-open` escalation), followup-open (exit 3, a monitor plan reviewed but its follow-up still open / not executed), incomplete (exit 2, a clear / investigate plan whose required acknowledgement is absent), and usage (exit 1) fail-closed paths. The acknowledgements are BOUNDED BOOLEANS an operator actually performed — never a free-form note or actor name. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded receipt verdict, the resolved plan class, and an acknowledgement checklist. It signs/approves/publishes/promotes/deploys/notifies nothing — it is a content-free operational EXECUTION RECEIPT ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign the plan, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-governance-fixture.yml` shows a release-governance REVIEW job that runs the closeout chain end-to-end (summarizes two content-free `pdfxyz.release-decision-closeout-index/1` windows into ONE trend, translates that trend into a `pdfxyz.release-decision-closeout-action-plan/1` plan, and records its `pdfxyz.release-decision-closeout-action-receipt/1` execution receipt) and then BUNDLES the primary receipt + the related plan / trend into ONE `pdfxyz.release-decision-closeout-governance/1` governance record with `worker:release-decision-closeout-governance` (a coherent completed receipt + a coherent chain → `closed`) — emitted as a CI artifact — asserting the governance-blocked (exit 4, a tampered / `blocked` primary receipt, a contradictory plan / trend, a blocked source chain, or a `--strict-open` escalation), governance-open (exit 3, a `followup-open` receipt or an advisory source chain), governance-incomplete (exit 2, a missing / unreadable / incomplete receipt or a required-but-missing record), and usage (exit 1) fail-closed paths. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded governance verdict, a primary-receipt summary, a related-record checklist, an archive checklist, and a follow-up assignment list. It signs/approves/publishes/promotes/deploys/notifies nothing — it is a content-free operational GOVERNANCE BUNDLE ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign the records, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-governance-index-fixture.yml` shows a release-governance REVIEW job that BUNDLES three releases into `pdfxyz.release-decision-closeout-governance/1` governance records with `worker:release-decision-closeout-governance` and then INDEXES that bounded history into ONE `pdfxyz.release-decision-closeout-governance-index/1` review summary with `worker:release-decision-closeout-governance-index` (a coherent all-closed history → `indexed`) — emitted as a CI artifact — asserting the index-blocked (exit 4, a tampered bundle, a `governance-blocked` latest, a blocked-count breach, or a `--strict-open` escalation), index-open (exit 3, a `governance-open` latest or an open-count breach), index-incomplete (exit 2, an unreadable bundle, a `governance-incomplete` latest, or zero usable bundles), and usage (exit 1) fail-closed paths. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded index verdict, the governance-verdict distribution, the latest / oldest governance verdict, and a per-record posture sequence. It signs/approves/publishes/promotes/deploys/notifies nothing — it is a content-free governance-history INDEX SUMMARY ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign the records, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-governance-index-trend-fixture.yml` shows a periodic release-governance REVIEW job that INDEXES a review window into `pdfxyz.release-decision-closeout-governance-index/1` with `worker:release-decision-closeout-governance-index` and then SUMMARIZES a bounded history of those governance-index windows into ONE `pdfxyz.release-decision-closeout-governance-index-trend/1` trend with `worker:release-decision-closeout-governance-index-trend` (a coherent, non-degrading history → `trend-stable`) — emitted as a CI artifact — asserting the trend-blocked (exit 4, a tampered window, an `index-blocked` latest, a blocked-count breach, or a `--strict-watch` escalation), trend-watch (exit 3, an `index-open` latest or a degrading arc), trend-incomplete (exit 2, an unreadable window, an `index-incomplete` latest, or zero usable windows), and usage (exit 1) fail-closed paths. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded trend verdict, an arc direction, the per-window index-verdict distribution, the aggregate governance distribution, and a per-window posture sequence. It signs/approves/publishes/promotes/deploys/notifies nothing — it is a content-free governance-index TREND SUMMARY ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign the records, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-governance-action-plan-fixture.yml` shows a periodic release-governance REVIEW job that SUMMARIZES a bounded history of governance-index windows into ONE `pdfxyz.release-decision-closeout-governance-index-trend/1` trend with `worker:release-decision-closeout-governance-index-trend` and then TRANSLATES that ONE trend into a bounded operator follow-up plan (`pdfxyz.release-decision-closeout-governance-action-plan/1`) with `worker:release-decision-closeout-governance-action-plan` (a coherent, stable history → a `clear` plan) — emitted as a CI artifact — asserting the block-release (exit 4, a `trend-blocked` history, an unreadable / tampered trend input, or a `--strict-watch` escalation), monitor (exit 3, a `trend-watch` / degrading history), investigate (exit 2, a `trend-incomplete` history), and usage (exit 1) fail-closed paths. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded plan verdict, an urgency, an action class, the surfaced source trend verdict / class / arc / latest governance-index posture, and an ordered next-action checklist. It signs/approves/publishes/promotes/deploys/notifies nothing — it is a content-free operational FOLLOW-UP PLAN ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign the records, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-governance-action-receipt-fixture.yml` shows a release-governance REVIEW job that summarizes a bounded history of governance-index windows into ONE trend, TRANSLATES that trend into a `pdfxyz.release-decision-closeout-governance-action-plan/1` follow-up plan with `worker:release-decision-closeout-governance-action-plan`, and then RECORDS whether that plan's follow-ups were acknowledged with `worker:release-decision-closeout-governance-action-receipt` (a coherent stable plan reviewed by the operator → `completed`) — emitted as a `pdfxyz.release-decision-closeout-governance-action-receipt/1` CI artifact — asserting the blocked (exit 4, a missing / unreadable / tampered plan, a `block` plan not acknowledged as held-blocked, a contradictory acknowledgement, or a `--strict-open` escalation), followup-open (exit 3, a monitor plan reviewed but its follow-up still open / not executed), incomplete (exit 2, a clear / investigate plan whose required acknowledgement is absent), and usage (exit 1) fail-closed paths. The acknowledgements are BOUNDED BOOLEANS an operator actually performed — never a free-form note or actor name. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded receipt verdict, the resolved plan class, and an acknowledgement checklist. It signs/approves/publishes/promotes/deploys/notifies nothing — it is a content-free operational EXECUTION RECEIPT ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign the plan, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-fixture.yml` shows a release-governance REVIEW job that summarizes a bounded history of governance-index windows into ONE trend, translates it into a `pdfxyz.release-decision-closeout-governance-action-plan/1` follow-up plan, records the execution receipt with `worker:release-decision-closeout-governance-action-receipt` (a coherent stable plan reviewed by the operator → `completed`), and then FINALIZES the whole chain with `worker:release-decision-closeout-governance-finalize` — the primary receipt plus the related plan / trend it was built from (cross-checked) — emitted as a `pdfxyz.release-decision-closeout-governance-finalize/1` CI artifact — asserting the blocked (exit 4, a tampered / `blocked` receipt, a contradictory plan / trend, a blocked source chain, or a `--strict-open` escalation), open (exit 3, a `followup-open` receipt or an advisory source chain), incomplete (exit 2, a missing / unreadable / `incomplete` receipt or a required-but-missing record), and usage (exit 1) fail-closed paths. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded finalization verdict, a per-source posture, and content-free checklists. It signs/approves/publishes/promotes/deploys/notifies nothing — it is a content-free operational governance FINALIZATION bundle ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign the receipt, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-fixture.yml` shows a release-governance REVIEW job that FINALIZES a governance chain three times (a coherent stable trend → clear plan reviewed → completed receipt → `finalized` bundle) and then INDEXES the bounded history of those `pdfxyz.release-decision-closeout-governance-finalize/1` bundles with `worker:release-decision-closeout-governance-finalize-index` (oldest first, newest last) into a `pdfxyz.release-decision-closeout-governance-finalize-index/1` CI artifact — asserting the blocked (exit 4, a `finalize-blocked` latest / any blocked bundle or a `--strict-open` escalation), invalid (exit 4, a tampered or unreadable bundle — the top precedence), open (exit 3, a `finalize-open` latest / open-threshold breach), incomplete (exit 2, a `finalize-incomplete` latest / a `--require-latest-finalized` miss), and usage (exit 1) fail-closed paths over committed content-free fixtures. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded index verdict, a coverage + finalization-verdict distribution, and content-free checklists. It runs no gate / index / decision / trend / plan / receipt / closeout / governance / finalize itself and signs/approves/publishes/promotes/deploys/notifies nothing — it is a content-free finalization-history INDEX SUMMARY ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign a bundle, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-fixture.yml` shows a release-governance REVIEW job that INDEXES a bounded finalization-bundle history into ONE freshly-produced `pdfxyz.release-decision-closeout-governance-finalize-index/1` window with `worker:release-decision-closeout-governance-finalize-index`, then SUMMARIZES a bounded history of those finalize-index windows with `worker:release-decision-closeout-governance-finalize-index-trend` (oldest first, newest last) into a `pdfxyz.release-decision-closeout-governance-finalize-index-trend/1` CI artifact — asserting the blocked (exit 4, an `index-blocked` / `index-invalid` usable window or a `--strict-open` escalation), invalid (exit 4, a tampered or unreadable window — the top precedence), degrading (exit 3, an `index-open` latest / degrading arc), insufficient (exit 2, an `index-incomplete` latest / an only-incomplete history / zero usable windows), and usage (exit 1) fail-closed paths over committed content-free fixtures. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded trend verdict, a coverage + index-verdict + finalization distribution, and content-free next-actions. It runs no gate / index / decision / trend / plan / receipt / closeout / governance / finalize itself and signs/approves/publishes/promotes/deploys/notifies nothing — it is a content-free finalize-index TREND SUMMARY ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign a window, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-action-plan-fixture.yml` shows a release-governance REVIEW job that SUMMARIZES a bounded finalize-index-window history into ONE `pdfxyz.release-decision-closeout-governance-finalize-index-trend/1` trend with `worker:release-decision-closeout-governance-finalize-index-trend`, then TRANSLATES that ONE trend into a `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-plan/1` operator follow-up plan with `worker:release-decision-closeout-governance-finalize-index-trend-action-plan` — rendering it into `$GITHUB_STEP_SUMMARY` and asserting the block-release (exit 4, a `blocked` trend or a `--strict-watch` / `--require-clean` escalation), invalid (exit 4, an unreadable / tampered trend input — the top precedence), monitor (exit 3, a `watch` / `degrading` trend), investigate (exit 2, an `insufficient` trend), and usage (exit 1) fail-closed paths over committed content-free fixtures. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded plan verdict + urgency + action class, the surfaced source trend facets, and a content-free next-action checklist. It runs no gate / index / decision / trend / finalize / governance / closeout itself and signs/approves/publishes/promotes/deploys/notifies nothing — it is a content-free operational FOLLOW-UP PLAN ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign a trend, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-action-receipt-fixture.yml` shows a release-governance REVIEW job that TRANSLATES a finalize-index trend into a `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-plan/1` follow-up plan, then RECORDS the EXECUTION RECEIPT with `worker:release-decision-closeout-governance-finalize-index-trend-action-receipt` — supplying bounded operator acknowledgement flags (`--ack-plan`/`--ack-reviewed` for a reviewed clear plan → completed), rendering the receipt into `$GITHUB_STEP_SUMMARY`, and asserting the completed (exit 0, a reviewed clear plan), incomplete (exit 2, a missing required acknowledgement), blocked/invalid (exit 4, a `block-release` plan, a contradictory acknowledgement, a `--strict-open` escalation, a plan whose own verdict is `invalid`, a tampered plan, or an unreadable decoy), and usage (exit 1) fail-closed paths over committed content-free fixtures. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded receipt verdict + plan class + acknowledgement checklist. It runs no gate / index / decision / trend / finalize / plan / governance / closeout itself and signs/approves/publishes/promotes/deploys/notifies nothing — it accepts NO free-form note or actor name and never claims an action was executed unless `--ack-executed` was supplied; it is a content-free operational ACKNOWLEDGEMENT RECEIPT ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign a plan, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-finalize-fixture.yml` shows a release-governance REVIEW job that RECORDS a finalize-index-trend action-plan EXECUTION RECEIPT, then FINALIZES the follow-up loop with `worker:release-decision-closeout-governance-finalize-index-trend-finalize` — supplying the primary receipt (`--receipt`) plus the source-chain records it was built from (`--plan` / `--trend` cross-checked against what their downstream record recorded), rendering the finalization record into `$GITHUB_STEP_SUMMARY`, and asserting the finalized (exit 0, a completed receipt with coherent sources), open (exit 3, an advisory / open source chain), incomplete (exit 2, an incomplete receipt or a required-but-missing record), blocked/invalid (exit 4, a `blocked` / `invalid` receipt verdict, a contradictory source-chain record, a blocked source chain, a `--strict-open` escalation, a tampered receipt, or an unreadable decoy), and usage (exit 1) fail-closed paths over committed content-free fixtures. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded finalization verdict + source-chain checklist. It runs no gate / index / decision / trend / finalize / plan / governance / closeout / receipt itself and signs/approves/publishes/promotes/deploys/notifies nothing — it accepts NO free-form note or actor name; it is a content-free operational FINALIZATION record ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign a record, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-finalize-index-fixture.yml` shows a release-governance REVIEW job that FINALIZES a follow-up loop into a `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize/1` record (repeated for three review periods), then INDEXES the bounded history with `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index` — supplying the records oldest first / newest last (`--file`), rendering the index into `$GITHUB_STEP_SUMMARY`, and asserting the indexed (exit 0, a coherent all-finalized history), open (exit 3, a `finalize-open` latest), incomplete (exit 2, a `finalize-incomplete` latest or a `--require-latest-finalized` miss), blocked (exit 4, a `finalize-blocked` or usable `finalize-invalid` record, or a `--strict-open` escalation), invalid (exit 4, a tampered or unreadable INPUT record — the top precedence), and usage (exit 1) fail-closed paths over committed content-free fixtures. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded index verdict + finalization-verdict distribution + per-record posture sequence. It runs no gate / index / decision / trend / finalize / plan / governance / closeout / receipt itself and signs/approves/publishes/promotes/deploys/notifies nothing — it is a content-free finalization-history INDEX SUMMARY ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign a record, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-fixture.yml` shows a release-governance REVIEW job that INDEXES a bounded finalization-bundle history into ONE freshly-produced `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index/1` window with `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index`, then SUMMARIZES a bounded history of those finalize-index windows with `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend` (oldest first, newest last) into a `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend/1` CI artifact — asserting the blocked (exit 4, an `index-blocked` / `index-invalid` usable window or a `--strict-open` escalation), invalid (exit 4, a tampered or unreadable window — the top precedence), degrading (exit 3, an `index-open` latest / degrading arc), insufficient (exit 2, an `index-incomplete` latest / an only-incomplete history / zero usable windows), and usage (exit 1) fail-closed paths over committed content-free fixtures. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded trend verdict, a coverage + index-verdict + finalization distribution, and content-free next-actions. It runs no gate / index / decision / trend / plan / receipt / closeout / governance / finalize itself and signs/approves/publishes/promotes/deploys/notifies nothing — it is a content-free finalize-index TREND SUMMARY ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign a window, approve deployment, or promote releases.
`docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-plan-fixture.yml` shows a release-governance REVIEW job that SUMMARIZES a bounded finalize-index-window history into ONE `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend/1` trend with `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend`, then TRANSLATES that ONE trend into a `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-plan/1` operator follow-up plan with `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-plan` — rendering it into `$GITHUB_STEP_SUMMARY` and asserting the block-release (exit 4, a `blocked` trend or a `--strict-watch` / `--require-clean` escalation), invalid (exit 4, an unreadable / tampered trend input — the top precedence), monitor (exit 3, a `watch` / `degrading` trend), investigate (exit 2, an `insufficient` trend), and usage (exit 1) fail-closed paths over committed content-free fixtures. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded plan verdict + urgency + action class, the surfaced source trend facets, and a content-free next-action checklist. It runs no gate / index / decision / trend / finalize / governance / closeout itself and signs/approves/publishes/promotes/deploys/notifies nothing — it is a content-free operational FOLLOW-UP PLAN ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign a trend, approve deployment, or promote releases.
`docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-receipt-fixture.yml` shows a release-governance REVIEW job that SUMMARIZES a finalize-index-window history into ONE trend and TRANSLATES it into a `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-plan/1` plan, then RECORDS whether the operator provided the acknowledgements required to close it out or hold it with `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-receipt` — rendering the `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-receipt/1` receipt into `$GITHUB_STEP_SUMMARY` and asserting the completed (exit 0, a reviewed clear plan and a held-acknowledged block plan), incomplete (exit 2, a missing required acknowledgement), followup-open (exit 3, an open monitor / investigate follow-up), blocked / invalid (exit 4, an unacknowledged block plan / contradiction / `--strict-open`, or a tampered / unreadable plan), and usage (exit 1) fail-closed paths over committed content-free fixtures. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded receipt verdict + plan class + acknowledgement checklist. It runs no gate / index / decision / trend / finalize / plan / governance / closeout itself and signs/approves/publishes/promotes/deploys/notifies nothing — even a completed block plan records the release as HELD; it is a content-free operational ACKNOWLEDGEMENT RECEIPT ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign a plan, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-fixture.yml` shows a release-governance REVIEW job that RECORDS a finalize-index-trend action-plan EXECUTION RECEIPT, then CLOSES OUT the follow-up loop with `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout` — supplying the primary receipt (`--receipt`) plus the related records already on hand (`--plan` / `--trend` cross-checked against what the receipt recorded, and `--index` folded as a source-chain posture), rendering the `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout/1` closeout into `$GITHUB_STEP_SUMMARY`, and asserting the closed (exit 0, a completed receipt with coherent related records), open (exit 3, a followup-open receipt or an advisory finalization-index window), incomplete (exit 2, an incomplete receipt or a required-but-missing record), blocked / invalid (exit 4, a `blocked` receipt verdict, a contradictory related record, a blocked source chain, a `--strict-open` escalation, a tampered receipt, or an unreadable decoy), and usage (exit 1) fail-closed paths over committed content-free fixtures. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded closeout verdict + source-chain checklist. It runs no gate / index / decision / trend / plan / receipt / governance / finalize / closeout itself and signs/approves/publishes/promotes/deploys/notifies/archives/deletes/uploads nothing — it is a content-free operational CLOSEOUT SUMMARY ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign a receipt, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-fixture.yml` shows a release-governance REVIEW job that CLOSES OUT a history of follow-up loops into Phase 84 closeout records, then INDEXES that bounded history with `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index` — supplying the records oldest first / newest last (`--file`), rendering the `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index/1` summary into `$GITHUB_STEP_SUMMARY`, and asserting the indexed (exit 0, a coherent all-closed history within thresholds), index-open (exit 3, an open latest or `--max-open` breach), index-incomplete (exit 2, an incomplete latest or `--require-latest-closed` miss), index-blocked / index-invalid (exit 4, a blocked / invalid-posture record, a `--strict-open` escalation, a tampered record, or an unreadable decoy), and usage (exit 1) fail-closed paths over committed content-free fixtures. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded index verdict + closeout-verdict distribution + posture sequence. It runs no gate / index / decision / trend / plan / receipt / governance / finalize / closeout itself and signs/approves/publishes/promotes/deploys/notifies/archives/deletes/uploads nothing — it is a content-free closeout-history INDEX SUMMARY ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign a receipt, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-fixture.yml` shows a release-governance REVIEW job that INDEXES a couple of closeout windows with `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index`, then SUMMARIZES that bounded history with `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend` — supplying the windows oldest first / newest last (`--file`), rendering the `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend/1` summary into `$GITHUB_STEP_SUMMARY`, and asserting the stable/improving (exit 0, a coherent / recovering history), watch/degrading (exit 3, an open latest / degrading arc / watch-threshold breach), insufficient (exit 2, an incomplete latest / breach or zero usable windows), blocked/invalid (exit 4, a blocked / invalid-posture window over threshold, a `--strict-watch` escalation, a tampered window, or an unreadable decoy), and usage (exit 1) fail-closed paths over committed content-free fixtures. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded trend verdict + index-verdict distribution + posture sequence. It runs no gate / index / decision / trend / plan / receipt / governance / finalize / closeout itself and signs/approves/publishes/promotes/deploys/notifies/archives/deletes/uploads nothing — it is a content-free closeout-index TREND SUMMARY ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign a receipt, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan-fixture.yml` shows a release-governance REVIEW job that SUMMARIZES a bounded closeout-index-window history into ONE `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend/1` trend with `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend`, then TRANSLATES that ONE trend into a `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan/1` operator follow-up plan with `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan` — rendering it into `$GITHUB_STEP_SUMMARY` and asserting the block-release (exit 4, a `blocked` trend or a `--strict-watch` / `--require-clean` escalation), invalid (exit 4, an unreadable / tampered trend input — the top precedence), monitor (exit 3, a `watch` / `degrading` trend), investigate (exit 2, an `insufficient` trend), and usage (exit 1) fail-closed paths over committed content-free fixtures. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded plan verdict + urgency + action class, the surfaced source trend facets, and a content-free next-action checklist. It runs no gate / index / decision / trend / finalize / governance / closeout itself and signs/approves/publishes/promotes/deploys/notifies nothing — it is a content-free operational FOLLOW-UP PLAN ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign a trend, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-receipt-fixture.yml` shows a release-governance REVIEW job that SUMMARIZES a finalize-index-window history into ONE trend and TRANSLATES it into a `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan/1` plan, then RECORDS whether the operator provided the acknowledgements required to close it out or hold it with `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-receipt` — rendering the `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-receipt/1` receipt into `$GITHUB_STEP_SUMMARY` and asserting the completed (exit 0, a reviewed clear plan and a held-acknowledged block plan), incomplete (exit 2, a missing required acknowledgement), followup-open (exit 3, an open monitor / investigate follow-up), blocked / invalid (exit 4, an unacknowledged block plan / contradiction / `--strict-open`, or a tampered / unreadable plan), and usage (exit 1) fail-closed paths over committed content-free fixtures. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded receipt verdict + plan class + acknowledgement checklist. It runs no gate / index / decision / trend / finalize / plan / governance / closeout itself and signs/approves/publishes/promotes/deploys/notifies nothing — even a completed block plan records the release as HELD; it is a content-free operational ACKNOWLEDGEMENT RECEIPT ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign a plan, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-fixture.yml` shows a release-governance REVIEW job that RECORDS a finalize-index-trend action-plan EXECUTION RECEIPT, then CLOSES OUT the follow-up loop with `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout` — supplying the primary receipt (`--receipt`) plus the related records already on hand (`--plan` / `--trend` cross-checked against what the receipt recorded, and `--index` folded as a source-chain posture), rendering the `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout/1` closeout into `$GITHUB_STEP_SUMMARY`, and asserting the closed (exit 0, a completed receipt with coherent related records), open (exit 3, a followup-open receipt or an advisory closeout-index window), incomplete (exit 2, an incomplete receipt or a required-but-missing record), blocked / invalid (exit 4, a `blocked` receipt verdict, a contradictory related record, a blocked source chain, a `--strict-open` escalation, a tampered receipt, or an unreadable decoy), and usage (exit 1) fail-closed paths over committed content-free fixtures. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded closeout verdict + source-chain checklist. It runs no gate / index / decision / trend / plan / receipt / governance / finalize / closeout itself and signs/approves/publishes/promotes/deploys/notifies/archives/deletes/uploads nothing — it is a content-free operational CLOSEOUT SUMMARY ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign a receipt, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-fixture.yml` shows a release-governance REVIEW job that CLOSES OUT a window of follow-up loops (three `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout` records), then INDEXES the bounded window with `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index` (repeated `--file`, oldest first / newest last), rendering the `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index/1` index into `$GITHUB_STEP_SUMMARY`, and asserting the all-closed (exit 0, a coherent window), open (exit 3, an open latest / older breach), incomplete (exit 2, an incomplete latest / older breach), blocked / invalid (exit 4, a blocked record, a tampered / unreadable record, an own-`invalid` record, or a `--strict-open` escalation), and usage (exit 1) fail-closed paths over committed content-free fixtures. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded index verdict + posture sequence. It runs no gate / index / decision / trend / plan / receipt / closeout / governance / finalize itself and signs/approves/publishes/promotes/deploys/notifies/archives/deletes/uploads nothing — it is a content-free closeout-history INDEX SUMMARY ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign a receipt, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-fixture.yml` shows a release-governance REVIEW job that COMPOSES a bounded history of closeout-index windows (two `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index` windows), then SUMMARIZES the history into ONE trend with `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend` (repeated `--file`, oldest first / newest last), rendering the `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend/1` trend into `$GITHUB_STEP_SUMMARY`, and asserting the blocked / invalid (exit 4, a `blocked` window, a tampered window, or a `--strict-open` escalation), watch / degrading (exit 3, an open latest / degrading arc), insufficient (exit 2, a flat incomplete history), and usage (exit 1) fail-closed paths over committed content-free fixtures. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded trend verdict + posture sequence. It runs no gate / index / decision / trend / plan / receipt / closeout / governance / finalize itself and signs/approves/publishes/promotes/deploys/notifies/archives/deletes/uploads nothing — it is a content-free closeout-index TREND SUMMARY ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign a receipt, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-plan-fixture.yml` shows a release-governance REVIEW job that SUMMARIZES a bounded closeout-index-window history into ONE `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend/1` trend with `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend`, then TRANSLATES that ONE trend into a bounded `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-plan/1` operator follow-up plan with `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-plan`. The job is local/offline/read-only, emits only content-free CI artifacts, and never approves, deploys, promotes, signs, notifies, archives, deletes, or mutates release state.

`docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-receipt-fixture.yml` shows a release-governance REVIEW job that SUMMARIZES a finalize-index-window history into ONE trend and TRANSLATES it into a `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-plan/1` plan, then RECORDS whether the operator provided the acknowledgements required to close it out or hold it with `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-receipt` — rendering the `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/1` receipt into `$GITHUB_STEP_SUMMARY` and asserting the completed (exit 0, a reviewed clear plan and a held-acknowledged block plan), incomplete (exit 2, a missing required acknowledgement), followup-open (exit 3, an open monitor / investigate follow-up), blocked / invalid (exit 4, an unacknowledged block plan / contradiction / `--strict-open`, or a tampered / unreadable plan), and usage (exit 1) fail-closed paths over committed content-free fixtures. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded receipt verdict + plan class + acknowledgement checklist. It runs no gate / index / decision / trend / finalize / plan / governance / closeout itself and signs/approves/publishes/promotes/deploys/notifies nothing — even a completed block plan records the release as HELD; it is a content-free operational ACKNOWLEDGEMENT RECEIPT ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign a plan, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-fixture.yml` shows a release-governance REVIEW job that COMPOSES ONE `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/1` primary receipt (Phase 93) plus OPTIONAL related records (a Phase 92 plan, a Phase 91 trend) into ONE `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/1` closeout bundle with `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout` — rendering the closeout into `$GITHUB_STEP_SUMMARY` and asserting the closed (exit 0, a completed receipt with coherent related records), incomplete (exit 2, an incomplete receipt or a missing required related record), open (exit 3, a followup-open receipt), blocked / invalid (exit 4, a blocked receipt or `--strict-open`, or an untrusted receipt / contradictory / tampered / unreadable related record), and usage (exit 1) fail-closed paths over committed content-free fixtures. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded closeout verdict + primary-receipt summary + related-record checklist + source-chain posture. It runs no gate / index / decision / trend / plan / receipt / governance / finalize / closeout itself and signs/approves/publishes/promotes/deploys/notifies nothing; it is a content-free operational CLOSEOUT SUMMARY ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign a receipt, approve deployment, or promote releases.

`docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-fixture.yml` shows a release-governance REVIEW job that CLOSES OUT a window of follow-up loops (three `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout` records), then INDEXES the bounded window with `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index` (repeated `--file`, oldest first / newest last), rendering the `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index/1` index into `$GITHUB_STEP_SUMMARY`, and asserting the all-closed (exit 0, a coherent window), open (exit 3, an open latest / older breach), incomplete (exit 2, an incomplete latest / older breach), blocked / invalid (exit 4, a blocked record, a tampered / unreadable record, an own-`invalid` record, or a `--strict-open` escalation), and usage (exit 1) fail-closed paths over committed content-free fixtures. The job is safe for CI because the command fetches nothing, is offline/read-only, and outputs only a bounded index verdict + posture sequence. It runs no gate / index / decision / trend / plan / receipt / closeout / governance / finalize itself and signs/approves/publishes/promotes/deploys/notifies/archives/deletes/uploads nothing — it is a content-free closeout-history INDEX SUMMARY ONLY, not a legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It does not contact cloud storage, retrieve objects, sign a receipt, approve deployment, or promote releases.
