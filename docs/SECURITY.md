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
- Compress PDF — in-browser size analyzer + **lossless** structural repack
  (deep image downsampling is deferred to a worker rather than faked)

Page rendering/thumbnails use `pdfjs-dist` locally; the pdfjs worker is bundled
(no third-party CDN request).

**Planned secure workers** (not yet live — pages show an implementation-ready
overview): Office ⇄ PDF conversions, OCR, repair, web-optimize, PDF/A,
compare, high-quality compression, irreversible redaction, fillable forms, and
e-signature workflows.

**Planned AI tools:** chat with PDF, summarize, translate, extract tables/data.

When workers ship they will follow the plan in
[`docs/ENGINE_ROADMAP.md`](ENGINE_ROADMAP.md): short-lived encrypted
storage, isolated per-job sandboxes, malware scanning, strict egress limits,
automatic deletion within minutes, and **no document contents in logs**.

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
