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
genuinely offers OCR — which no environment does yet. No scan is uploaded, and no
searchable PDF or recognized text is ever fabricated, until a real OCR processor
is deployed. Inputs would be wiped right after recognition and outputs auto-delete
on their TTL, exactly like every other job (`DEFAULT_RETENTION`).

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
  gateway.

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
- **Guardrails fail fast, not silently.** The provider config layers deliberately degrade a half-configured backend to "not configured" so the app never processes against a broken provider. That hides operator typos, so guardrails (`evaluateGuardrails`) re-surface a *selected-but-invalid* or *unrecognized* provider, malformed compression/lifecycle/retention config as **errors**. The daemon refuses to start (exit `4`) on any error before claiming work. Opt-in `PDFXYZ_WORKER_STRICT` / `…_REQUIRE_*` enforce production requirements (a runnable worker, a validated lifecycle backstop). Defaults stay safe and disabled: a bare environment produces zero violations.
- **Honest negatives — malware scanning and OCR.** This build ships **no malware scanner and no OCR processor**, and never pretends otherwise. Malware-scan readiness reports `active: false` even when a scanner variable is set (`declared-not-implemented`) — declaring a scanner does not make one exist, and no upload is ever reported as scanned. OCR is reported not-implemented in every mode. Operator readiness and the client status both state these plainly.
- **Content-free readiness & guardrail output.** `--dry-run-status`, `--check`, and the run modes emit only booleans, typed states/codes, and generic prose — never a variable name, value, path, object key, or signed URL. Offending variable **names** exist only in a `fields` array on the returned violation (for programmatic diagnostics); the CLI never prints them, so the daemon's whole output stays free of environment-variable names and secrets.
