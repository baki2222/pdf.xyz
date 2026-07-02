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

## Reporting a vulnerability

Please report privately — **do not open a public issue**:

- GitHub: open a private **Security Advisory** on the repository, or
- Email `security@pdf.xyz` *(provision this mailbox before public launch)*.

Include reproduction steps and impact. We aim to acknowledge within a few
business days and will coordinate a fix and disclosure timeline with you.

**Supported version:** the latest `main` deployed to production.

## Worker provider security rules

Storage and queue providers must not accept user-supplied filesystem paths or object keys. Route handlers work only with opaque ids minted by the backend; providers map those ids to private bucket keys internally. The Phase 14 S3 provider signs keys derived from `inputs/<fileId>` and `artifacts/<artifactId>` plus an optional sanitized prefix — never from filenames — rejects oversized reservations before signing, and treats malformed artifact ids as unavailable/already-gone instead of signing arbitrary paths. Signed URLs must expire, buckets must deny public listing, and `DELETE /api/jobs/:id` must cancel queued/running work or expire completed artifacts without logging file names, file contents, raw URLs, or object keys.
