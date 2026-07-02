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
  and idempotency. **A configured queue accepts jobs but nothing runs them until a
  worker daemon is deployed** — a created job stays `queued`, and the status
  endpoint says so. Never claim remote processing is live on this basis alone.
- **When remaining secure workers / AI land:** add their keys in
  **Vercel → Project → Settings → Environment Variables**, scoped to the right
  environment (Production / Preview / Development). Server-only secrets must
  **not** be prefixed `NEXT_PUBLIC_` (that prefix exposes a value to the
  browser). Keep worker/AI credentials server-side only.
- **OCR (and every secure-worker tool) is disabled by default.** `/tools/ocr-pdf`
  reads `GET /api/worker/status` and honestly reports OCR unavailable until a real
  OCR processor (OCRmyPDF/Tesseract or a managed provider) is deployed behind the
  worker adapter contract; no scan is uploaded and no text is fabricated until
  then. When that processor lands, its endpoint/credentials are **server-side
  configuration behind the adapter — never `NEXT_PUBLIC_`** — and the status
  endpoint starts reporting `ocr.available` from the worker's advertised
  capability (presence-only, names not values). See
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
provider. Works with Upstash Redis REST and any compatible HTTP Redis gateway.

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
daemon deployed, `POST /api/jobs` (when storage is also ready) records a `queued`
job and returns `202`, and it stays queued. Deploy a worker that runs the
executor's `drain()` loop before advertising that jobs complete.

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
  CI (`../.github/workflows/ci.yml`) runs typecheck, lint, unit tests, build, and
  the Playwright smoke suite on every PR.
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
  `ClaimableQueue`, `ExecutorStorage`, and processor runners (native `deep`
  compression, OCRmyPDF/Tesseract) behind the existing contracts. Native runners
  use fixed argv arrays and fixed temp paths — no user-supplied paths, no shell
  string interpolation.
- **Tune lease & retries.** Set `leaseMs` above the worst-case job duration and
  heartbeat long jobs, so a slow job is not redelivered under a healthy worker;
  set `maxAttempts` so only genuinely transient (`retryable`) failures retry.
- **Scan for real.** The executor's `scanning` phase is a state today; a
  production worker must run malware/soundness scanning there before processing.
- **Keep it presence-only.** `/api/worker/status` exposes
  `providers.processor.executor` (mode/ready/detail) — confirm no broker name,
  worker URL, key, or variable ever appears there. `remote-configured` must keep
  reporting `executor.mode: "not-implemented"` until the worker is live.
