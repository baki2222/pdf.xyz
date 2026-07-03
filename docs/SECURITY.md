# Security & Privacy

pdf.xyz is **privacy-first by architecture, not by policy.** Wherever a browser
can do the job reliably, the file is processed on your device and never
uploaded. Where it genuinely cannot (native renderers, OCR, AI), the work is
routed to a clearly-labeled worker — and we say so in the UI rather than faking
it client-side.

---

## Processing modes

Every tool declares one of these, shown on its card and page:

| Mode | Meaning |
| --- | --- |
| **In-browser** (`client`) | Runs entirely on your device. Files are never uploaded. |
| **Hybrid** | Runs in the browser when possible, with an encrypted server fallback for large/complex files. |
| **Secure worker** (`server`) | Processed on an encrypted, isolated worker and deleted shortly after. |
| **AI** | Uses an AI model on secure infrastructure; your content is never used to train models. |

## What runs where (honest status)

**Live and fully in-browser today** — files never leave the device:

- Merge PDF, Split PDF, Rotate PDF
- Delete / Extract / Organize pages
- Compress PDF — in-browser size analyzer + **lossless** structural repack.
  Deep image downsampling is not faked in the browser: it runs on the secure
  worker, and the tool page only offers that path when a worker is actually
  available (see `GET /api/worker/status`), labeling it honestly otherwise.

Page rendering/thumbnails use `pdfjs-dist` locally; the pdfjs worker is bundled
(no third-party CDN request).

## Browser-local workspace handoff

The workspace-to-tool handoff is also local-only:

- Staged files live in browser memory while the workspace tab is open.
- Launching a supported in-browser tool writes the selected `File`/`Blob` objects
  to origin-private IndexedDB under an opaque, unguessable handoff id.
- The tool opens as `/tools/<slug>?handoff=<id>`, claims the record once, filters
  incompatible files, reconstructs `File` objects in the browser, and removes the
  token from the address bar.
- Handoffs expire automatically, are swept on both workspace open and tool
  mount, and can be wiped on demand with the workspace **Clear session** control
  (which also clears staged files and remembered preferences); a missing,
  expired, or incompatible handoff falls back to the normal file picker with
  honest copy.
- Reading a token strips it from the address bar reliably — the `handoff`
  parameter is removed while any sibling query params and the path are preserved
  (`src/lib/handoff/url.ts`, unit-tested) — so a token never lingers in a
  shareable, reloadable, or logged URL.
- The token never points to server storage, and the server never receives file
  contents for in-browser tools.

## Client telemetry (privacy-safe, off by default)

Error and Web-Vitals telemetry holds the same line as the rest of the app: it is
**inert unless a deployment explicitly configures an ingest endpoint**
(`NEXT_PUBLIC_TELEMETRY_ENDPOINT`; see [`docs/DEPLOYMENT.md`](DEPLOYMENT.md)).
With nothing set — the default, and what the e2e suite exercises — no beacon is
sent, the Web-Vitals listener is not mounted, and the CSP is unchanged.

When it *is* enabled, every payload is scrubbed at the source before it can leave
the browser (`src/lib/telemetry/redact.ts`, unit-tested):

- **Never sent:** file names, file contents/bytes, `data:`/`blob:` URLs,
  hand-off tokens, or any URL query string.
- The current page URL is reduced to **origin + path only**, so a `?handoff=`
  token can't ride along in an error report.
- Error messages and stacks are pattern-scrubbed (tokens, quoted/unquoted
  filenames, inline data URLs) and length-clipped; a structured context object is
  deep-scrubbed, dropping known-sensitive keys (`name`, `file*`, `token`, …)
  outright and reducing URL-shaped keys to origin+path.
- Redaction is enforced in the pure `build*Report` layer, not left to callers, so
  a careless call site still can't leak — and reporting is fully exception-proof
  and fire-and-forget, so it can never break the app.

Web Vitals themselves are pure performance numbers (LCP/CLS/INP/…), never
document-derived, and still pass through the same redactor for defense in depth.
The endpoint is public by nature (the browser reads it to send a beacon) and is
**not** a secret; if it is cross-origin, its origin is added to `connect-src`
automatically at build time.

**Planned secure workers** (not yet live — pages show an implementation-ready
overview): Office ⇄ PDF conversions, OCR, repair, web-optimize, PDF/A,
compare, high-quality compression, irreversible redaction, fillable forms, and
e-signature workflows.

**OCR** has a dedicated, honest secure-worker page (`/tools/ocr-pdf`) and a full
request/capability contract (`src/lib/jobs/ocr.ts`, `src/lib/workers/ocr.ts`): it
validates recognition options (languages, output mode, skip-text), reports its
capability **presence-only**, and mounts an uploader **only** when a worker
genuinely offers OCR. Phase 23 ships a **real, optional** OCR backend
(`src/lib/workers/ocr-native.ts`) that shells out to OCRmyPDF/Tesseract on the
out-of-band worker (never in-browser), **off by default**: with nothing configured,
`ocr-pdf` fails honestly as `not_implemented`, the browser reports OCR unavailable, and
no scan is uploaded. No searchable PDF or recognized text is ever fabricated — output
comes only from actual recognition — and the recognized text lives **only** in the
downloaded artifact, never in a log, status field, or job record. Inputs are wiped
right after recognition and outputs auto-delete on their TTL, exactly like every other
job (`DEFAULT_RETENTION`). See [`OCR_BACKEND.md`](./OCR_BACKEND.md) for the full envelope.

**Planned AI tools:** chat with PDF, summarize, translate, extract tables/data.

When workers ship they will follow the plan in
[`docs/ENGINE_ROADMAP.md`](ENGINE_ROADMAP.md): short-lived encrypted
storage, isolated per-job sandboxes, malware scanning, strict egress limits,
automatic deletion within minutes, and **no document contents in logs**.

## Server API contract (secure workers)

The boundary to future server-side processing is defined as typed contracts in
[`src/lib/jobs`](../src/lib/jobs) and exposed as three App Router endpoints:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/uploads` | Create a short-lived, single-use upload session. |
| `POST /api/jobs` | Create a processing job from uploaded files or a URL. |
| `GET /api/jobs/:id` | Read typed job status and download readiness. |
| `GET /api/worker/status` | Presence-only capability probe (mode + per-tool capability — compression profiles and OCR); no secrets. |

**No fake processing.** With no worker backend configured, these route handlers
validate every request against the contract and then answer honestly with
`503 worker_not_configured` — they never store a file, enqueue work, or fabricate
a "completed" job. A developer can opt a single machine into a real, in-process
worker with `PDFXYZ_WORKER_MODE=local-dev`; it performs genuine work when it
honestly can (lossless repack) and records an honest **`failed`** job when it
cannot (deep image compression with no native engine installed) — never a dummy
file. The developer transport endpoints (`PUT /api/uploads/local/:fileId`,
`GET /api/artifacts/local/:artifactId`) are inert (`503`) unless local-dev mode
is on, so the production build is unaffected. The full design is in
[`docs/WORKER_ARCHITECTURE.md`](WORKER_ARCHITECTURE.md).

**Strict validation at the edge** (`src/lib/jobs/validation.ts`):

- Only worker-capable tools accept jobs; in-browser tools are rejected.
- Filenames may not contain path separators or `..` traversal.
- Declared MIME types must be in the tool's allowlist; sizes are bounded by
  `JOB_LIMITS` (100 MB/file, 500 MB/session, 20 files) and request bodies are
  capped before parsing.
- URL-input tools (e.g. webpage-to-PDF) accept only public `http(s)` URLs;
  localhost, private, link-local/metadata ranges, embedded credentials, and
  non-http(s) schemes are blocked — defense-in-depth against SSRF, with the
  worker's egress policy as the real enforcement.
- Rate limits (`RATE_LIMITS`) are published in the contract and enforced at the
  gateway. Phase 33 adds an in-app **abuse guard** (`src/lib/ratelimit`) as
  defense-in-depth behind that gateway — see **Abuse guard & rate limiting** below.

**Privacy by default.** Every job carries a `RetentionPolicy`: inputs are wiped
right after processing and outputs auto-delete within the retention window
(`DEFAULT_RETENTION`), with `persistsAfterJob: false` as a contractual
guarantee. The local-dev worker implements this literally — the input slot and
its bytes are deleted the moment a job finishes (success or failure), and upload
slots are single-use.

**Backend detection reads no secrets.** Legacy worker backend detection is based
on the *presence* of infrastructure variable names (`src/lib/jobs/config.ts`).
The S3-compatible storage provider introduced in Phase 14 reads server-side
credential values only inside the storage provider closure to compute SigV4
signatures; those values are never logged, serialized, returned in status, or
placed in client code. `/api/worker/status` reports only presence/capability, not
bucket, endpoint, region, key id, prefix, variable names, or secrets.

**The Redis/Upstash queue provider (Phase 15) follows the identical posture.** Its
REST token is read only inside the provider/client closure and sent solely as an
`Authorization: Bearer` header — never placed in a URL, a thrown error, a log line,
a returned value, or client code. Config parse errors and `/api/worker/status` name
no endpoint, token, prefix, variable, or key. Two queue-specific rules matter for
security: (1) the client idempotency key is user-supplied, so it is **SHA-256
hashed** before it is used as a Redis key component — the raw value never becomes a
broker key name; (2) job ids, and therefore every Redis key, are derived only from
**server-minted opaque ids** — no client ever supplies a Redis key, stream name, or
broker id. Commands are sent as JSON argument arrays (not string-interpolated RESP),
so a value can never be interpreted as a command. Phase 21 also moves worker-owned
state transitions behind Redis `EVAL` scripts with status + lease-attempt
preconditions: a stale daemon cannot heartbeat, advance, complete, fail, or requeue
a job after its lease is reclaimed, and a broker without atomic script support fails
as typed `unavailable` rather than silently using unsafe read→write behavior. A
broker outage surfaces as a
typed `unavailable` (HTTP 500, retryable), never a fabricated job or status.

## Worker operations observability (Phase 28)

`/api/worker/operations` and daemon `operations`/`metrics`/`slo` lines are deliberately
content-free. They expose bounded enums, health classes, coarse buckets, counts, and safe
recommended-action prose only. They must never include bucket names, endpoints, object
keys, filenames, signed URLs, command paths, env values, OCR text, scanner signatures, or
job/user ids. From the web vantage, `daemonObserved:false` and worker-image proof fields
may be `unknown`; this is an honesty boundary, not a hidden green check.

## Worker liveness heartbeat (Phase 30)

The optional cross-process liveness heartbeat keeps that honesty boundary intact even as
it lets the web vantage *observe* a running worker. It is doubly gated — off unless
`PDFXYZ_WORKER_HEARTBEAT` is explicitly enabled **and** the Redis/Upstash job-queue broker
is configured — and adds no new hosted dependency (it reuses the broker under the same
sanitized key prefix, a single `…:heartbeat:secure-worker` key with no worker id).

The published record is bounded by construction and validated on read: a schema version, a
fixed `role`/`mode` enum, a coarse `major.minor` release, four capability booleans, and a
single publish timestamp used **only** to derive a coarse age bucket — never surfaced raw.
It never carries — and the parser drops anything that is not — a hostname, PID, container
id, IP, port, path, Redis/object key, endpoint, signed URL, filename, OCR text, scanner
signature, secret, or any high-cardinality label. The reader classifies liveness as
`observed` / `stale` / `unknown` / `disabled`; a dead daemon cannot refresh its own
timestamp and the broker key's TTL sweeps it, so `daemonObserved` can never outlive the
worker by more than one freshness window, and a stale/absent/disabled beat never upgrades
to observed. `/api/worker/operations` maps the result to a coarse state, last-seen bucket,
and safe source *category* (`queue-broker`/`self`/`none`); the dashboard re-authors every
word from bounded enums and never renders a stored field. A heartbeat outage is swallowed
(publish → `unavailable`, read → `unknown`) so it can never corrupt a job or fake liveness.

## Operator healthcheck alert evaluation (Phase 31)

`pnpm worker:ops-check` and its alert policy (`evaluateOperationsAlerts`) hold the same
privacy boundary as the snapshot they read: every field they produce is a bounded enum
(`AlertSeverity`, `AlertReason`, `AlertAction`, `AlertSource`), a boolean, a small integer
count, or prose authored **in code** from those enums. The policy never copies a string out
of the snapshot or SLO report, so an alert can never carry a filename, object key, endpoint,
value, host, port, Redis key, OCR text, scanner signature, or secret — even if a hand-crafted
snapshot were fed in.

The ingest path (`src/lib/workers/ops-check/ingest.ts`) is the trust boundary for a
monitor-supplied snapshot and is deliberately paranoid: it validates each load-bearing
field against a bounded allowlist and **rebuilds** the snapshot from those enums with all
prose re-authored, `daemonObserved` recomputed from the heartbeat state (never trusted from
input), and counts clamped to safe integers. A field it does not recognize — including a
`detail` string carrying a secret — is simply dropped, never echoed. The CLI never contacts
a cloud service unless the existing (disabled-by-default) heartbeat seam is configured, and
a bad flag or unreadable/malformed input is a distinct usage exit (`1`), never a crash and
never a leak. The report attached to `/api/worker/operations` and rendered on `/status` is
the same bounded object; the dashboard maps its codes to client-authored copy and renders no
stored string. This is honest **local evaluation** — it stores no history and pages no one,
so it introduces no new hosted dependency or egress.

## Deployment blueprint safety (Phase 32)

The deployment examples in [`docs/examples/deployment`](examples/deployment) are validated
as text, not executed infrastructure. The static validator and tests enforce the same
privacy posture as the app: placeholder-only secrets, no real provider endpoints, no
`NEXT_PUBLIC_*` secret-like variables, no worker provider secrets in the web deployment,
and no scheduler command that hides `worker:ops-check` failures with `|| true`. The
Kubernetes Secret manifest is intentionally `secret.example.yaml`; replace it through your
secret manager or out-of-band deploy tooling, never by committing real values.

## Abuse guard & rate limiting (Phase 33)

The public API ships an in-app **abuse guard** (`src/lib/ratelimit`) with typed
per-action policies for every route (`uploads.create`, `jobs.create`,
`jobs.status`, `jobs.delete`, `artifacts.fetch`, `worker.status`,
`worker.operations`). On deny it returns `429 rate_limited` with `Retry-After` and
standard `RateLimit-*` headers (all derived from the policy + clock, never the
caller). It is **defense-in-depth behind the edge, not the primary control.**

- **Off by default, fail-open.** With no provider configured the guard allows
  every request (`enforced: false`); the default build and every local-first
  browser tool are unaffected. It is opt-in via `PDFXYZ_RATE_LIMIT_PROVIDER`
  (`local-memory` for the per-process limiter; a remote name like `redis`/`upstash`
  activates the shipped distributed provider below when a store is configured, or
  **skips honestly** as `remote-unimplemented` when it is not — it never fabricates
  distributed enforcement).
- **Distributed enforcement ships (Phase 34).** A real `RateLimitProvider` backed by
  a Redis/Upstash-REST store (`src/lib/ratelimit/redis.ts`) is auto-registered at boot
  (`src/instrumentation.ts`) when a remote provider is selected AND the store is wired.
  Each check is a single **atomic** server-side Lua `EVAL` (fixed-window `INCR` +
  first-hit `PEXPIRE` + `PTTL`) — never a race-prone get-then-set — so every web replica
  shares one budget. It runs on the **web tier** and reads its own web-safe credentials
  (`PDFXYZ_RATE_LIMIT_REDIS_REST_URL` / `..._TOKEN`), deliberately distinct from the
  worker-only `PDFXYZ_REDIS_REST_*` so the public web pod never carries a worker secret.
  The backend is handed only the opaque salted-hash bucket token (never a raw identity),
  keys the store under `{prefix}:ratelimit:…`, and is held to the same content-free,
  no-leak invariant. On a store error it degrades per `PDFXYZ_RATE_LIMIT_FAIL_MODE`:
  `open` (default) allows unenforced so an outage never downs the API; `closed` denies
  (`429`). It **never fabricates an allow** from an errored backend.
- **Honest boundary.** The `local-memory` limiter is per-process and **not
  distributed**: behind N instances the effective budget is up to N×, and a
  restart resets windows. Enable the distributed `redis`/`upstash` provider (or a real
  edge/WAF rule) before a high-traffic launch. See
  [`WORKER_ARCHITECTURE.md` §6](WORKER_ARCHITECTURE.md).
- **Content-free by construction.** A decision carries only `allowed`, the
  action, the stable `policyId`, the `provider`, an `enforced` flag, and an exact
  + coarse-bucketed retry-after — **never** an IP, user agent, filename, token,
  object key, job id, env value, or request body. Client attribution is opt-in
  (`PDFXYZ_RATE_LIMIT_TRUST_PROXY`, off by default because the forwarding header
  is spoofable outside a trusted edge) and, when on, the address is **salted-hashed**
  and used only as an in-memory bucket key — never retained or surfaced. The
  `worker.status`/`worker.operations` endpoints stay lightweight and never expose
  request identity in any mode.

## HTTP security headers

Set for every response in [`next.config.mjs`](../next.config.mjs) and asserted by
the Playwright suite:

- **Content-Security-Policy** — `default-src 'self'`; `object-src 'none'`;
  `base-uri 'self'`; `frame-ancestors 'none'`; `form-action 'self'`;
  `img/font` allow `data:`/`blob:`; `worker-src 'self' blob:` and
  `script-src` includes `'wasm-unsafe-eval'` so the in-browser pdfjs
  worker + WASM image decoders run; `upgrade-insecure-requests` in production.
- **Strict-Transport-Security** (production) — `max-age=63072000; includeSubDomains; preload`.
- **X-Frame-Options:** `DENY` (with `frame-ancestors 'none'` for modern browsers).
- **X-Content-Type-Options:** `nosniff`.
- **Referrer-Policy:** `strict-origin-when-cross-origin`.
- **Permissions-Policy:** camera, microphone, geolocation, payment, USB,
  `browsing-topics`, `interest-cohort`, etc. all disabled.
- **Cross-Origin-Opener-Policy:** `same-origin`.

### Known CSP tradeoff

The policy currently allows `script-src 'unsafe-inline'` (and `'unsafe-eval'`
**in development only**). This is required because the app is statically
generated and Next.js injects inline bootstrap/flight scripts that cannot carry
a per-request nonce across full static generation. The planned hardening is a
middleware-issued **nonce-based** CSP for dynamically-rendered routes, which
lets us drop `'unsafe-inline'`. We prefer to ship an enforced, honest policy
today and tighten it deliberately rather than leave CSP off.

## Secrets & supply chain

- Secrets are never committed. `.env*` files are git-ignored and never read into
  client code. Runtime secrets (future workers/AI) live only in the host's
  environment settings.
- Dependencies are installed with a **frozen lockfile** in CI and on Vercel for
  reproducible builds; the dependency surface is kept intentionally small.
- **Container images bake no secrets (Phase 19).** The worker/web `Dockerfile`
  reads provider configuration from the environment at run time only; nothing is
  copied into a layer. [`.dockerignore`](../.dockerignore) excludes `.env*`, the
  `.claude-*.md` prompt files, `.git`, and test code from every build context. The
  `docker-compose.worker.yml` and `.env.worker.example` examples carry placeholder
  variable **names** only — never values — and all worker/provider variables are
  server-side (never `NEXT_PUBLIC_`). A static test (`src/deploy/artifacts.test.ts`)
  fails the build if any artifact grows a real-looking secret or a `NEXT_PUBLIC_`
  provider value, and `src/deploy/import-boundary.test.ts` fails if a web bundle
  eagerly imports the Node-only daemon runtime or native-compression subprocess.
- **Container CI proves this always-on, and needs no secret (Phase 20).** Both
  GitHub Actions workflows build with `push: false` and reference **no** repository
  secret — the [`container.yml`](../.github/workflows/container.yml) job proves the
  web ↔ worker split and the worker's no-config refusal on **real built images**
  without any credential, and [`ci.yml`](../.github/workflows/ci.yml) re-runs the
  same honesty smoke Docker-free. `src/deploy/ci-workflow.test.ts` extends the
  secret scan to **every** workflow file (no committed AWS key; any secret-ish env
  must be a `${{ secrets.* }}` reference, never a literal), so a workflow can't grow
  a committed secret unnoticed.
- **The worker image ships native engines, still no secrets (Phase 24).** The
  `worker` Docker target installs the deep-compression engines (Ghostscript,
  qpdf, mupdf-tools) **and** the OCR stack (OCRmyPDF, Tesseract, English
  language data) in one apt layer; the `web` target ships **none** of them,
  holding the web ↔ worker split at the image level. Native **engines** are
  baked in — secrets and `.env` files still are not, and provider **and** OCR
  configuration are read from the environment at run time, never copied into a
  layer. `pnpm worker:image-smoke` (`scripts/worker-image-smoke.sh`) runs
  **inside** the built worker image with no cloud, secret, or network and
  **processes no document**: it probes for the binaries and English langdata and
  reads OCR/deep readiness **presence-only** from the daemon's content-free
  `ocr_health`/`compression_health` lines (`--dry-run-status`), so no path,
  binary, language, or secret is ever echoed. `container.yml` runs it (with
  `pnpm worker:smoke`) inside the built worker image and asserts
  worker-ships-engines / web-ships-none — no secret, no push;
  `src/deploy/artifacts.test.ts` pins the presence-only/no-echo hygiene and
  `src/deploy/ci-workflow.test.ts` keeps every workflow secret-free.

## Reporting a vulnerability

Please report privately — **do not open a public issue**:

- GitHub: open a private **Security Advisory** on the repository, or
- Email `security@pdf.xyz` *(provision this mailbox before public launch)*.

Include reproduction steps and impact. We aim to acknowledge within a few
business days and will coordinate a fix and disclosure timeline with you.

**Supported version:** the latest `main` deployed to production.

## Worker provider security rules

Storage and queue providers must not accept user-supplied filesystem paths, object keys, Redis keys, stream names, or broker ids. Route handlers work only with opaque ids minted by the backend; providers map those ids to private bucket or broker keys internally. The Phase 14 S3 provider signs keys derived from `inputs/<fileId>` and `artifacts/<artifactId>` plus an optional sanitized prefix — never from filenames — rejects oversized reservations before signing, and treats malformed artifact ids as unavailable/already-gone instead of signing arbitrary paths. The Phase 15 Redis/Upstash queue provider stores jobs under sanitized namespaces (`job`, `spec`, `lease`, `ready`, `active`, `idem`) and hashes idempotency keys before they become broker keys, so raw user-provided idempotency strings are never persisted as key names. Signed URLs and queue keys must expire, buckets must deny public listing, Redis/Upstash tokens must stay server-side only, and `DELETE /api/jobs/:id` must cancel queued/running work or expire completed artifacts without logging file names, file contents, raw URLs, object keys, Redis keys, queue payloads, or credentials.

The Phase 16 worker daemon (`pnpm worker:daemon`) follows the same rules as an out-of-band process. It is **opt-in and never started by the web app** — importing the app spins up no worker. It reads provider configuration for *presence and shape only* and never logs, serializes, or prints a variable value; its worker-side S3 storage signs keys derived only from opaque `f_…`/`art_…` ids (shared with the app provider), and its structured JSON logs carry only a run mode, tick counters, an opaque job id/attempt, and an error *code* — never a filename, byte, object key, URL, option value, or secret. It refuses to fabricate work: with no drainable queue + storage it exits non-zero, and a processor with no real runner fails the job `not_implemented` rather than inventing a result. Deploy it in **sandboxed** worker infrastructure whose only egress is to the configured object storage and queue, on the same server-only credentials as the app — never on the request path.

Phase 18 adds useful worker artifact names without turning filenames into identifiers. The only allowed filename channels are display-only values: a sanitized `x-amz-meta-filename` upload metadata header and sanitized `inputNames` in the job spec. The sanitizer strips path components, control bytes, bidi/zero-width characters, unsafe separators, and header-injection vectors before any provider sees the value. These names may be used for `Content-Disposition` / the user's download prompt, but **never** for object keys, Redis keys, signed URL paths or queries, status payloads, telemetry, or daemon/executor logs.

Phase 38 hardens the client-facing **retrieval boundary** for the local-dev download route (`GET /api/artifacts/local/:artifactId`). Every download flows through a pure, content-free access layer (`src/lib/workers/artifacts/access.ts`) that validates the opaque handle, checks the artifact's lifecycle (live/expired/deleted/absent), confirms the owning job completed, and re-validates the recorded content-free provenance manifest against the stored bytes (recognized downloadable kind, coherent content-type, resolved retention class, matching byte count) before a single byte is streamed. Response headers are deterministic and safe: the `Content-Disposition` filename is **generated** from the output kind/tool (e.g. `compressed.pdf`) — the retrieval boundary no longer echoes even the sanitized original name — the `Content-Type` is the manifest's canonical bare type (never the raw stored value or its parameters), plus `Content-Length`, `Cache-Control: private, no-store`, and `X-Content-Type-Options: nosniff`. A denial returns one of a closed set of content-free reasons (`malformed_handle`, `storage_unavailable`, `policy_unavailable`, `not_found`, `deleted`, `not_ready`, `expired`, `job_mismatch`, `missing_manifest`, `invalid_manifest`, `unsupported_kind`, `empty_artifact`) mapped to a safe status (a provably-gone `expired`/`deleted` → `410`, `not_found`/`missing_manifest` → `404`, fail-closed infra → `503`) — never a handle, filename, object key, signed URL, job ID, size, or document byte — and no bytes. Every decision (served or denied) also derives a content-free **retrieval receipt** (`retrieval-receipt.ts`) emitted through an OPTIONAL operator observer (default none). It is a bounded structural + lifecycle eligibility check only: it does **not** claim authentication, authorization, malware scanning, sanitization, provenance beyond the recorded manifest, or a deletion guarantee — this boundary has **no auth model**: possession of the unguessable opaque handle is the capability, and the optional `?job=` binding is a caller-opted integrity cross-check (a false claim is a content-free `job_mismatch`, `403`), never access control. An output published without a manifest (the manifest gate was disabled) still downloads via intrinsic checks and is honestly not reported as provenance-validated. This local-dev route is inert (`503`) outside local-dev; its production counterpart is Phase 39.

Phase 39 extends that boundary to **storage-backed** artifacts without weakening any of its guarantees. The access layer is generalized behind an `ArtifactRetrievalBackend` seam so a configured object bucket flows through the SAME pure `decideArtifactAccess` policy, headers, and denial taxonomy as local-dev; the production route `GET /api/artifacts/:artifactId` reads the artifact's bytes from the bucket **server-side** (a short-lived signed GET) and streams them through this app server. This is a deliberate **proxy/stream** posture, not a redirect: the client never receives a signed object-store URL, and nothing about the bucket, object key, endpoint, region, or signature ever appears in a header, a body, a denial, a receipt, a metric, or a log — proven by a route-level test that stuffs an object key, bucket name, endpoint, signed-URL fragment, request token, SSN, and OCR text into the backend result and asserts none survive into any response header or the denial body. The content-free provenance manifest travels as **signed object metadata** (`x-amz-meta-artifact-manifest`); it is content-free by construction (bounded enums, a byte count, a public tool slug, stable policy constants), its decoder is strict and total (a tampered/oversized/malformed value collapses to "no manifest", never a half-trusted object), and it is never part of an object key. A transient bucket failure is a retryable `storage_error` → `503 service_unavailable`, deliberately distinct from a not-configured backend's `storage_unavailable` — a bucket read failure is never downgraded to a false `not_found`, and an absent/half-configured backend denies before any read (no fake stream). The retrieval receipt + metric gain a bounded `provider` label (`local-dev`/`remote-configured`/`not-configured`) — a closed enum, never a bucket or endpoint. What remains explicitly **out of band and not claimed**: a CDN or private-bucket access policy, bucket-side authentication, and any remote job/metadata store beyond the object read itself.

Phase 40 hardens the **download delivery** boundary that streams the bytes an access decision granted. Where the Phase 38/39 access layer answers *may this handle be served, and with what headers*, a distinct second gate (`src/lib/workers/artifacts/delivery.ts`, pure and node-free) answers *are those bytes safe to deliver as those headers claim* — applied identically on both routes through the one shared serve helper (`src/app/api/artifacts/_lib/serve.ts`). It exists because a proxied byte stream has failure modes an access check cannot see, and it never claims more than it does (it is a byte-consistency + method/range safety check — **not** authentication, resumable range serving, content scanning, or zero-copy streaming). The hardening: **(1) verified `Content-Length`** — the length the boundary emits is re-asserted from the actual bytes it will stream and cross-checked against both the access decision's length and any length the upstream provider declared (a bucket's `Content-Length` response header, parsed to a bounded byte count); a truncated / over-declared / desynced object is refused, never streamed under a header that lies about its size. **(2) A hard defensive delivery ceiling** (1 GiB, fixed — not operator-tunable) so an artifact larger than any real output fails closed rather than being buffered and streamed through the app server; it backstops the fact that the publish-time per-output ceiling (`PDFXYZ_WORKER_ARTIFACT_MAX_BYTES`) is opt-in and off by default. **(3) Deterministic `GET`/`HEAD`** — `HEAD` returns byte-identical headers (including the verified `Content-Length`) with **no body**; the routes wire only `GET`/`HEAD`, and every other method is refused a content-free `405` (no body) by the framework before any handler runs (Next.js additionally auto-answers `OPTIONS` with a `204` + `Allow: GET, HEAD, OPTIONS`). **(4) An honest `Range` posture** — this boundary proxies whole buffered objects and does **not** implement partial or resumable delivery, so it advertises `Accept-Ranges: none` and *ignores* a `Range` header (returning the whole file `200`), never a fabricated `206`, a `416`, or any resumable-download claim. Every delivery-policy denial (`size_mismatch`, `oversize`, `stream_error`) maps to a single content-free `503 service_unavailable` — the client learns only "could not safely deliver right now"; the precise internal reason lives only in the decision + the delivery receipt/metric. Crucially the whole serve path is wrapped so **any** unexpected failure — a backend that threw, a body that could not be built — closes to that safe `503` (a delivery `stream_error`) rather than a framework `500` that could leak a stack, and never a provider exception message, object key, URL, path, or byte. Because the object is fully buffered server-side before the `200` is constructed, a read failure is always a **pre-stream** content-free denial, never a truncated body under a `200`. A new content-free `worker_artifact_delivery_total{outcome,reason,kind,provider}` metric and a per-attempt **delivery receipt** (which additionally records the bounded `method` and `range` disposition) make the second gate observable and auditable through the same OPTIONAL, default-off sinks — every field a bounded enum or stable policy constant, never a handle, filename, object key, bucket, signed URL, byte range, size, or byte.

Phase 41 enforces the artifact **retention window at retrieval time** for storage-backed artifacts, closing an honest gap: an object store generally does **not** tombstone, so a bucket answers a GET with `200` for an object whose app retention window has already passed, right up until the bucket's own lifecycle rule physically reaps it (a best-effort, coarse, often-daily sweep). Local-dev already closes this with an in-process expiry stamp; Phase 41 is the storage-backed counterpart. The worker signs the artifact's retention window as content-free object metadata (`x-amz-meta-artifact-lifecycle`) — the SAME `expiresAt` instant the client already holds, encoded as a bounded epoch-ms integer plus an optional deletion-tombstone marker; the codec is content-free by construction (a coarse instant + a presence flag, never a filename, key, URL, bucket, id, or byte) and its decoder is strict and total (any malformed/oversized value collapses to "no evidence"). On the download GET the storage reader (`retrieval-storage.ts`) decodes that evidence and evaluates it against its clock (`artifacts/lifecycle.ts`) **before the body is read**, so a logically-expired object (`expired`) or an explicit tombstone (`deleted`) is denied `410 Gone` and its bytes are never buffered — reusing the Phase 38 `expired`/`deleted` → `410` mapping. This is **app-level retrieval-time enforcement**, deliberately distinct from — and additional to — both the **bucket lifecycle-deletion backstop** and any active delete-now the executor performs. The honesty rules are load-bearing: a present object with **no** usable evidence (a legacy object predating this phase, or storage that strips user-metadata) resolves to `unknown` and is **served**, never reported as deleted/expired — so the boundary never over-claims; the manifest/intrinsic checks and the shipped `requireManifest:false` policy continue to govern such an object exactly as before, and the bucket lifecycle rule remains the eventual backstop (surfacing later as an honest `404`/`not_found`). A tampered value can only ever fail toward serving a present object (never a false denial), and the metadata is signed, so a client cannot alter it. What Phase 41 **does not** claim: it is **not** proof the bytes were deleted (deletion stays the bucket's job; once an object is gone, expired/deleted/never-existed collapse to an indistinguishable `not_found`, the honest object-store semantic), **not** a verification of the bucket lifecycle policy's correctness (the app never inspects the bucket — that stays operator-declared, see the lifecycle readiness seam), and it does **not** cover legal-hold/retention compliance, audit-log export, private-bucket access policy, or CDN cache purge — all of which remain **out of band**. A content-free `worker_artifact_expiry_total{state,provider}` metric + per-read **drift receipt** (default-off sinks, `state` ∈ `live`/`expired`/`deleted`/`unknown`) make the "bucket still serving a gone object" drift signal and the "no lifecycle metadata" signal observable without exposing any object detail.

Phase 42 adds **cleanup verification** — the honest-evidence rung above Phase 41's retrieval denial. It is load-bearing to separate four facts the platform keeps deliberately distinct, because they make different promises: **(a) retrieval-time denial** (Phase 41) refuses to *serve* an expired/tombstoned artifact — it is access control, not deletion, and the bytes may still exist in the bucket; **(b) active app deletion** is the executor's best-effort delete-now on terminal job paths (Phase 25), removing an object so a later GET is a genuine `404`; **(c) the bucket lifecycle backstop** is the object-store's own retention rule that reaps objects past their window (verified structurally, out of band, by `--lifecycle-verify`); and **(d) cleanup verification** (Phase 42, `pnpm worker:cleanup-check`) proves *which of those actually happened* — whether an artifact that should be gone is confirmed absent, and by which mechanism, versus only retrieval-denied. Like the lifecycle-config verifier, the app **never calls the cloud**: the operator exports content-free cleanup EVIDENCE out-of-band with their own credentials (a per-object `{ presence: present|absent|error, expiresAtMs?, deleted?, activeDelete? }` — the SAME coarse retention facts the app already stamps on the object, never a key, bucket, URL, or byte) and pipes it in. The verifier re-evaluates each object through the SAME `evaluateArtifactLifecycle` the retrieval boundary uses, then resolves a bounded per-object state — `absent-active` (a delete-now receipt attributes the `404` to active deletion), `absent-backstop` (a `404` with no receipt: the lifecycle reap, or an indistinguishable never-existed handle), `retrieval-denied` (present-but-denied, within a reap grace — denial working, byte cleanup pending), `drift` (present past its retention window + grace — the backstop has not reaped it), `live`, `unknown`, or `unavailable` — and folds them to one verdict (`verified`/`drift`/`unknown`/`unavailable`/`not-configured`). The honesty invariants are strict and mirror the rest of the worker layer: **absence is the only proof of cleanup** — a present-but-denied object is reported as *pending*, never fabricated into a deletion, so only a confirmed `404` yields `verified`; an unreadable clock, a placeholder deadline, or a tombstone without an expiry falls toward `retrieval-denied`, never a fabricated `drift`; a `not-configured` deployment short-circuits to `not-configured` without inspecting evidence (never upgraded to a success); and the tool **reads no bytes and NEVER deletes** — actual object removal stays operator-owned and out of band. What Phase 42 **does not** claim: it is not itself a deletion (it verifies, it does not act), not a live bucket scan (it evaluates the operator's exported evidence), not a claim about the bucket lifecycle policy's correctness, and not legal-hold/audit-export/CDN-purge compliance — all still out of band. The trust boundary is paranoid: the ingest parser reads ONLY the four bounded fields and drops every other field, so a hostile `objectKey`/`bucket`/`signedUrl`/`providerMessage`/OCR string riding along in the document can never reach the verdict, a receipt, a metric, or a log (a privacy test drives the full pipeline with exactly such a document and asserts nothing survives). The content-free `worker_cleanup_verification_total{verdict,provider}` metric + per-run receipt (default-off sinks, bounded verdict + small counts + a stable policy stamp) make the verdict auditable; every verdict×provider label is redaction-stable so `sanitizeMetric` never silently drops a sample. Exit codes follow the ops ladder (`0` verified / `1` usage / `2` unknown·unavailable·not-configured / `3` drift), so a monitor can gate on cleanup drift without a pager. The Phase 41 retrieval-denial path, local-dev tombstones, storage-backed downloads, and the no-config posture are all unchanged.

Phase 42 also ships the complementary **dry-run sweeper** (`pnpm worker:artifact-cleanup`), which shares the exact same paranoid trust boundary. Where the verifier evaluates a probe set of should-be-gone objects, the sweeper categorizes an offline **inventory** of PRESENT object metadata (a projection of a bucket listing) into `expired-but-present`/`deleted-but-present`/`missing-lifecycle`/`missing-manifest`/`unsupported-kind`/`storage-unavailable`/`ok` and emits a content-free dry-run plan (counts + actions only). Its parser is equally paranoid: it reads ONLY bounded enum fields plus the `{expiresAtMs,deleted}` retention evidence and coarse age/size, and **drops every other field** and rejects out-of-enum values to the honest `unknown` sentinel — so a hostile `objectKey`/`bucket`/`signedUrl`/`filename`/OCR string riding along in a record can never reach a category count, the plan, a receipt, a metric, or a log (a no-leak test drives the full CLI with exactly such an inventory and asserts nothing survives in either JSON or text output). It escalates a severity ONLY on positive evidence (a tombstone or a passed deadline); absent/incomplete evidence stays `unknown`, never a fabricated cleanup recommendation. Like the verifier it lists no real bucket, reads no bytes, and **NEVER deletes** — actual object removal stays operator-owned and out of band. Its content-free `worker_artifact_cleanup_total{category,severity}` labels are redaction-stable, and its exit ladder is `0` clean / `1` usage / `2` unknown / `3` cleanup-recommended / `4` invalid·breached.

## Native deep-compression engine (Phase 17)

Phase 17 makes `compress-pdf` **deep** compression run for real on the worker by shelling out to a native engine (Ghostscript, qpdf, or mutool). Because that means a subprocess touches user bytes, the engine is built to a strict, defense-in-depth posture (`src/lib/workers/compression/native.ts`, `native-config.ts`; unit-tested with mocked processes — no binary ships in CI):

- **No shell, ever.** The engine is invoked with `execFile` and a **fixed argv array** — never a shell string. Temp file paths and the target DPI are separate array elements, so a path or option can never be interpreted as a flag or shell syntax. There is no string concatenation of a command line anywhere.
- **Explicit gate + kill switch.** Native compression is controlled by `PDFXYZ_NATIVE_COMPRESSION` (auto-detect by default, or `off` to force it off on a hardened host) and may be pinned to a single engine with `PDFXYZ_COMPRESSION_ENGINE`. A disabled config yields zero usable engines, so `deep` fails honestly as `not_implemented`.
- **Allowlisted binaries only.** By default each engine is auto-detected by a *fixed command name* (`gs`/`qpdf`/`mutool`) on `PATH` (presence only — the probe never executes a candidate). An operator may override a binary with an absolute path (`PDFXYZ_COMPRESSION_{GHOSTSCRIPT,QPDF,MUTOOL}_BIN`), but only if it passes a safe-path allowlist: absolute, no `..` traversal, no shell metacharacters or control bytes, length-bounded. An arbitrary command or a relative path is rejected at parse time (naming the offending *variable*, never its value). Ghostscript additionally runs with `-dSAFER`.
- **Strict bounds.** A hard subprocess **timeout**, a **max input size** (an oversized input is rejected *before* anything is spawned or written, as a non-retryable `payload_too_large`), and a **max output size** are all clamped to hard ceilings; a misconfigured deployment cannot ask the worker to run unbounded (`PDFXYZ_COMPRESSION_TIMEOUT_MS`, `PDFXYZ_COMPRESSION_MAX_INPUT_BYTES`, `PDFXYZ_COMPRESSION_MAX_OUTPUT_BYTES`).
- **Isolated temp, guaranteed cleanup.** Each job runs in its own `mkdtemp` directory (optionally rooted at `PDFXYZ_COMPRESSION_TMPDIR`); the directory is removed in a `finally` on **every** exit path — success, engine failure, or timeout — and a cleanup error is swallowed so it can never mask the outcome or leak a path.
- **Never a fabricated or worse artifact.** The engine's output is accepted only after a structural **PDF validation** (`%PDF-` header + `%%EOF` trailer, within bounds); unreadable output is an honest failure, never a "completed" job. And the artifact is **never larger than the input** — if deep compression cannot reduce the file (already-optimized / text-only PDFs), the original bytes are returned unchanged with honest zero-savings metrics rather than a bigger file (the "valid and no-worse" policy).
- **Presence-only status, no path leakage.** The client capability and `/api/worker/status` report only whether deep compression is enabled and, at most, the engine *family* name (like storage reports `s3`) — never a binary path, argument, temp directory, or variable value. The native runner logs nothing; the executor/daemon logs stay content-free as above.

## Lifecycle backstop, deployment guardrails & honest negatives (Phase 19)

Phase 19 hardens how the daemon is deployed, holding the same "no fake claims, no leaks" line for operational safety (`src/lib/workers/lifecycle/`, `src/lib/workers/deploy/`; all node-free and unit-tested offline — no cloud calls):

- **Lifecycle as a privacy backstop.** Retention is enforced primarily by the app (inputs wiped on job completion, artifacts expire on their clock). The generated storage lifecycle policy is the *independent backstop* that bounds object lifetime even if active deletion fails. Retention overrides (`PDFXYZ_RETENTION_*`) are validated to hard **privacy ceilings** (≤ 7 days); an over-ceiling or malformed value is rejected (fails closed to the safe default) and surfaced as a guardrail — a deployment can shorten retention, never silently lengthen it past the ceiling.
- **Content-free generated policies.** A rendered lifecycle document (AWS S3 / R2 / MinIO / generic) contains only structural prefixes (`inputs/`, `artifacts/`) and integer day counts, and applies to a `<bucket>` placeholder the operator names on the provider CLI. No bucket, endpoint, region, key, object key, or credential is ever embedded — the document is safe to print, log, or commit to a runbook.
- **Lifecycle readiness is operator-declared, never assumed.** The app cannot inspect a live bucket's lifecycle without a cloud call, so it never claims one exists. Readiness is `unknown` until an operator declares `PDFXYZ_LIFECYCLE_PROVIDER`, and only reaches `validated` when the operator asserts `PDFXYZ_LIFECYCLE_VALIDATED=true` — i.e. it trusts an explicit out-of-band verification, and says "unknown/declared" otherwise.
- **Deletion enforcement is provable, not just asserted (Phase 25).** Two independent proofs back the retention contract without ever faking a cloud call. (1) *Active delete-now* is proven on every terminal executor path — `executor.leak.test.ts` asserts no input survives a terminal state and no artifact survives a failed/canceled one across completion, no-processor, expired input, processing failure, OCR failure, all three scan blocks, and cancellation; only a successful job keeps its one artifact, with a bounded TTL. (2) The *lifecycle backstop* can be verified against the live bucket via `--lifecycle-verify` (`src/lib/workers/lifecycle/verify.ts`): the operator exports the bucket's lifecycle config out-of-band (the app never reads the bucket) and the daemon structurally compares it to the generated policy — `verified` (exit `0`), `unknown` when no document is supplied (exit `2`), or `drift`/malformed (exit `4`). This upgrades `validated` from a bare boolean assertion to checked evidence. The verifier's output is content-free: only the app's own `pdfxyz-*` rule ids, a status/action enum, prose, and a count of unrelated rules — an operator-authored rule id, prefix, or day count from the exported document is never echoed into the report or logs.
- **Guardrails fail fast, not silently.** The provider config layers deliberately degrade a half-configured backend to "not configured" so the app never processes against a broken provider. That hides operator typos, so guardrails (`evaluateGuardrails`) re-surface a *selected-but-invalid* or *unrecognized* provider, malformed compression/lifecycle/retention config as **errors**. The daemon refuses to start (exit `4`) on any error before claiming work. Opt-in `PDFXYZ_WORKER_STRICT` / `…_REQUIRE_*` enforce production requirements (a runnable worker, a validated lifecycle backstop). Defaults stay safe and disabled: a bare environment produces zero violations.
- **Honest negatives — OCR and malware scanning are optional, off by default.** OCR (Phase 23) and malware scanning (Phase 22) are both **real but optional** controls, and neither is ever assumed. OCR ships a real OCRmyPDF/Tesseract backend (below and in [`OCR_BACKEND.md`](./OCR_BACKEND.md)) that stays honestly not-implemented (`ocr-pdf` → `not_implemented`, `ocr.available: false`) until an operator opts in **and** installs an engine on the worker — the web app never runs OCR and never claims a searchable PDF or recognized text it can't produce. Malware scanning is likewise `not-configured` (and no upload is ever reported as scanned) until an operator configures a scanner, exactly like storage or the queue — presence-only, never assumed.
- **Malware-scan gate (Phase 22) — an optional ClamAV scanner, wired before processing.** The executor runs a typed **scan gate** on a job's inputs *before* it advances to processing (`src/lib/workers/scanner/`). Phase 22 ships a real, optional **ClamAV/clamd** backend (`./clamav`, INSTREAM) behind that seam plus the honest no-op. It is **off by default**: with nothing configured the no-op runs — it inspects nothing and returns `skipped` (never `clean`), so **no upload is scanned and none is ever reported as scanned**. An operator turns it on with `PDFXYZ_MALWARE_SCANNER=clamav://host[:port]` (or `clamav+unix:///path`); readiness then reports `ready`/`active` for a usable endpoint, or `unavailable` (still inactive) for a misconfigured one — declaring a broken endpoint never silently pretends to scan. When a scanner is active, an `infected` verdict **blocks the job terminally before any processing**, so no artifact is ever produced and its inputs are wiped like any terminal job; an input that can never be scanned (e.g. it exceeds the hard size limit) **fails closed** — blocked with `scan_invalid` rather than processed unscanned; and a transient scan failure (clamd unreachable) is a **retryable** `scan_unavailable`, never downgraded to clean. Required-vs-optional is decided at the scanner boundary: a **required** scanner that can't clear an input fails/retries, an **optional** one degrades to `skipped` (proceed, honestly not-scanned); an `infected` detection blocks either way. The client-facing error is a fixed, content-free message, and clamd's reply is classified so the **signature name is dropped at the protocol layer** — the scanner's `detail` (which could name a signature or path) is never propagated into the error or the logs. `PDFXYZ_WORKER_REQUIRE_SCAN` arms the opt-in `require-scan` guardrail (`--check` fails fast with exit `4` when scanning is required but not active, and passes once a usable endpoint is configured); a selected-but-invalid or unrecognized sc... [truncated]
- **OCR backend (Phase 23) — an optional native engine, hardened like native compression.** OCR is a real, optional worker backend (`src/lib/workers/ocr-native.ts`) that shells out to **OCRmyPDF/Tesseract**, and it is bounded on every axis: **opt-in** (`PDFXYZ_OCR`, disabled unless set, with a malformed config degrading to fully off); **no shell** (a fixed **argv array** via `execFile` — input/output/sidecar paths are worker-owned temp paths, never a user path, so a filename or option can never become a flag or shell syntax); a **binary allowlist** (an override must be a safe absolute path for a known engine, else the fixed command name is auto-detected on `PATH`, presence-only); **bounded resources** (hard timeout, input/output byte ceilings, and a structural PDF check on the searchable-PDF output); an **isolated temp dir with guaranteed cleanup** on success, failure, and timeout; and **single-document** processing. Phase 24 now **packages this engine (OCRmyPDF/Tesseract + English data) in the worker image**, so it is present on `PATH` by default — still opt-in via `PDFXYZ_OCR`, configured from the environment, and reported presence-only. It runs **only** on the out-of-band daemon — never the web app or local-dev worker (enforced by `src/deploy/import-boundary.test.ts`), and after the malware-scan gate. A runner failure is caught and mapped to a typed, content-free `internal_error` — never a fabricated result. Crucially, the **recognized text is never logged, echoed in status, or written to a job record**; it lives only in the artifact bytes the user downloads (asserted with a sentinel in `ocr-backend.test.ts`). Opt-in `PDFXYZ_WORKER_REQUIRE_OCR` (fail-fast when a ready engine is required but absent) and an always-on `ocr_config_invalid` guardrail (a malformed `PDFXYZ_OCR*` value) round it out; like `require-scan`, it is **not** folded into strict.
- **OCR result metadata + synthetic recognition proof (Phase 25) — safe by construction.** A successful OCR job now attaches bounded, structural metadata (`OcrResultMeta`, built by the pure `buildOcrResultMeta`): engine family, validated languages, output mode, which artifact kinds were produced, an output **page count**, and a sidecar **character count**. It carries **no recognized text** (a count is a length, never the contents), and **no** filename, object key, signed URL, temp path, command path, or secret; nulls are honest ("not determinable"), never fabricated, and `meanConfidence` stays `null` because the native backend exposes none. Counts are clamped and the field set is schema-stable; metadata extraction is itself bounded (a very large artifact reports `null` rather than paying unbounded cost). The guarantee is asserted directly — the recognized text must not appear in `JSON.stringify(meta)` (`ocr-native.test.ts`, `jobs/ocr.test.ts`). Separately, the deterministic recognition proof (`scripts/worker-ocr-proof.sh`) uses a **generated, non-user-document** fixture only, prints presence-only/content-free output (never a path or the recognized text), touches no cloud/secret/queue/store/scanner, and always removes its temp dir — its hygiene is pinned by `src/deploy/worker-ocr-proof.test.ts`.
- **Client-visible OCR metadata (Phase 26) — one redaction boundary, closed engine set.** That same safe metadata is now threaded onto the client-facing **job record** (`Job.results.ocr`, `src/lib/jobs/results.ts`) and returned by `GET /api/jobs/:id`, so a user/operator can see *what was produced* (pages, output kind, languages, character count) without ever seeing recognized text. Every write funnels through the single `sanitizeJobResults` boundary, which re-bounds the block through `buildOcrResultMeta` **and** collapses the engine to the closed client-facing family set via `normalizeOcrEngineFamily` — a client ever sees only `ocrmypdf`, `tesseract`, or `unknown`, never a path, version, or smuggled fragment (a decorated token like `ocrmypdf-16.4.0` reads `unknown`). A block whose `outputMode` is not a real contract value is dropped whole; `results` is written **only** on a genuinely completed job that produced output (never on a failed/infected/not-enabled job) and is **dropped with the artifacts** when outputs are deleted (cancel/expire), so it can never outlive or misrepresent them. The recognized text itself stays **artifact-only**; the record carries only its structural *description*. No-leak is asserted directly — a text/path/key/URL sentinel must not survive `sanitizeJobResults` (`jobs/results.test.ts`), nor appear on the completed job (`ocr-backend.test.ts`) or through the Redis persistence round-trip (`queue/redis.test.ts`).
- **OCRmyPDF searchable-PDF proof + metadata fidelity (Phase 27) — proven, still content-free.** The packaged OCRmyPDF PDF→searchable-PDF path is now proven end-to-end on a synthetic fixture (`scripts/worker-ocrmypdf-proof.sh`, `pnpm worker:ocrmypdf-proof`), run inside the built worker image in CI. It builds an **image-only PDF** (Ghostscript `pdfimage` — no text layer), confirms with `pdftotext` that the source yields no selectable text, runs OCRmyPDF by a **fixed argv** (no shell, worker-owned temp paths only — the same hardening as the runtime runner), and confirms with the same `pdftotext` that the **output** PDF is now searchable (image-only → searchable), corroborated by the sidecar. Like the recognition proof, it uses a **generated, non-user-document** fixture only, prints presence-only/content-free output (never a path, filename, or recognized text), touches no cloud/secret/queue/store/scanner, and always removes its temp dir; its hygiene and enforced exit codes are pinned Docker-free with stub tools in `src/deploy/worker-ocrmypdf-proof.test.ts`. Its dependency `pdftotext` (`poppler-utils`) is installed in the **worker image only** and is **proof-only** — never on the OCR runtime path, and absent from the web image (pinned by `src/deploy/artifacts.test.ts` and proven at the image level in CI). Separately, the native runner now derives the result metadata's produced-kind flags and page/character counts from the artifacts it *actually returns* (the searchable-PDF page count from the produced PDF's bytes, never the input), so the counts cannot drift from the output and a missing/invalid searchable PDF still fabricates nothing — asserted in `ocr-native.test.ts`.
- **Content-free readiness & guardrail output.** `--dry-run-status`, `--check`, and the run modes emit only booleans, typed states/codes, and generic prose — never a variable name, value, path, object key, or signed URL. Offending variable **names** exist only in a `fields` array on the returned violation (for programmatic diagnostics); the CLI never prints them, so the daemon's whole output stays free of environment-variable names and secrets.

## Upload intake guardrails (Phase 35)

Secure-worker upload sessions and job creation now run through `src/lib/uploads/intake` before any storage or queue work. The layer is deliberately coarse and content-free: it rejects too many files, declared per-file/request sizes above policy, hostile/path-like filenames, unsupported upload families, MIME/extension mismatches, and local-dev PDF bytes that fail an opt-in bounded `%PDF-` / `%%EOF` sniff. It never logs or returns raw filenames, paths, object keys, signed URLs, request bodies, OCR text, scanner signatures, or uploaded bytes; client responses contain only stable error codes and positional fields such as `files[0].bytes`.

The defaults mirror the existing job contract limits (`JOB_LIMITS`), preserving local-first browser tools and the existing no-config secure-worker behavior. Operators may tune the public upload boundary with server-only env names: `PDFXYZ_UPLOAD_MAX_FILE_BYTES`, `PDFXYZ_UPLOAD_MAX_REQUEST_BYTES`, `PDFXYZ_UPLOAD_MAX_FILES`, `PDFXYZ_UPLOAD_MAX_FILENAME_LENGTH`, `PDFXYZ_UPLOAD_REQUIRE_PDF_MAGIC`, `PDFXYZ_UPLOAD_REQUIRE_PDF_EOF`, `PDFXYZ_UPLOAD_PDF_HEADER_SCAN_BYTES`, and `PDFXYZ_UPLOAD_PDF_TRAILER_SCAN_BYTES`. Values are parsed strictly and fail back to defaults; diagnostics and docs name variables only. The optional PDF sniff is only an envelope check, not malware scanning, sanitization, OCR validation, decompression, or a PDF parser.

## Worker file-soundness quarantine gate (Phase 36)

The secure-worker executor now runs a bounded file-soundness gate immediately after retrieving input bytes and **before the scanner and any processor** — so a structurally-unsound or contract-mismatched input never reaches ClamAV, OCR, or compression. The gate checks only low-cost, content-free contradictions: empty input, input-count ceiling, optional max-byte ceiling, declared-vs-fetched byte-count mismatch, declared family/tool and family/extension mismatch, and PDF envelope markers (`%PDF-` by default for PDF-expected inputs, `%%EOF` only when opted in). A rejection terminates the job with the non-retryable `unsound_input` error (coarse class `unsound`), emits a content-free quarantine receipt, and skips scanner + processor execution so no artifact, OCR text, or transformed output is fabricated.

**Quarantine is a receipt plus active deletion, not a byte-retaining store.** The rejected input is wiped by the same active-deletion path as any other terminal failure; the default is always to delete, and no unsafe user bytes are retained (there is no opt-in operator quarantine store in this phase). The receipt carries only a bounded reason enum, the stable policy id/version, a coarse size bucket + input count, the processor family, and a timestamp.

This layer is deliberately distinct from the others: it is not the Phase 35 upload-intake validation (that runs at the public boundary on declared metadata before storage/queue work), not malware scanning (the separate ClamAV gate, which now runs *after* this one), not PDF sanitization, PDF repair, PDF validity proof, OCR correctness, or a decompression/deep parse — deep PDF sanitization/repair remains out-of-band and is not implemented. Scanner and processor claims are made only when their configured backends run. Logs and receipts never include filenames, object keys, signed URLs, bucket names, job/user IDs, scanner signatures, request bodies, or document contents.

## Worker artifact-manifest / provenance gate (Phase 37)

After a processor produces its outputs — and **before any bytes are persisted or a download URL is minted** — the secure-worker executor validates each output through a bounded artifact-manifest gate, so a malformed or ambiguous output can never be stored or exposed to a client. The gate checks only low-cost, structural facts: at least one non-empty output within the count/size ceilings, a content-type that maps to a recognized output kind, coheres with the filename extension, and is one the producing tool may legitimately emit, and a job that resolves to a usable retention/lifecycle class. An `invalid` verdict terminates the job with the non-retryable `artifact_invalid` error (coarse class `artifact`), emits a content-free rejection receipt, and writes nothing — no artifact, download URL, OCR text, or transformed output is fabricated.

Every manifest is content-free by construction: it records the output kind, normalized content-type, byte count, bounded retention class, tool slug, bounded processor family, and stable policy id/version — and never a filename, object key, signed URL, job/user ID, temp path, OCR text, scanner signature, or document byte. The retention class fails closed (and rejects) for a malformed TTL or a policy claiming persistence beyond the job, so the privacy-by-default retention contract cannot be silently violated at publication.

This layer is deliberately distinct from the others: a manifest/provenance pass is **structural metadata validation, not content-security validation**. It is not malware scanning, not PDF sanitization or repair, not OCR-correctness proof, not proof the document is valid or safe, and not a lifecycle-deletion guarantee — those remain separate steps whose claims are made only when their configured backends actually run. Logs, metrics, and receipts carry only bounded enum labels, coarse buckets, and small counts.
