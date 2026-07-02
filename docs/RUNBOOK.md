# Production runbook — web + worker

The operational guide for running pdf.xyz as **two independent services**: the
public **web** app and the out-of-band **secure worker**. It covers who does what,
the environment each needs, how images are built and promoted, and how to smoke
and roll back a deployment.

This is a runbook, not a provisioning system. It does **not** create a bucket, a
broker, or a registry, and nothing here fakes them: with nothing configured the
worker honestly reports "not configured" rather than pretending to process. For
the Vercel web deploy specifics and the full env-variable tables see
[`DEPLOYMENT.md`](DEPLOYMENT.md); for the worker internals and the privacy model
see [`WORKER_ARCHITECTURE.md`](WORKER_ARCHITECTURE.md) and [`SECURITY.md`](SECURITY.md).

> **Honesty first.** The container images are **not built in this repository's
> environment** (no reachable Docker daemon). The real `docker build` for both
> targets — plus the worker no-config smoke inside the built worker image — runs in
> CI on GitHub Actions ([`.github/workflows/container.yml`](../.github/workflows/container.yml)),
> and the Dockerfile/compose/CI invariants are pinned by static tests under
> [`src/deploy/`](../src/deploy). Build and run the images in real worker
> infrastructure before advertising remote processing.

---

## 1. Topology & responsibilities

Two images, two runtimes, no overlap. The web image **cannot** run the daemon and
ships no PDF engines; the worker image never bundles the site and never serves
HTTP. This split is real infrastructure, enforced three ways: the multi-stage
[`Dockerfile`](../Dockerfile) (separate final targets), the container CI (builds
both and asserts engines live only in the worker), and the import-boundary test
([`src/deploy/import-boundary.test.ts`](../src/deploy/import-boundary.test.ts))
that keeps Node-only worker internals out of the web bundle.

| | **web** service | **worker** service |
| --- | --- | --- |
| Image target | `web` (`docker build --target web`) | `worker` (`docker build --target worker`) |
| Command | `pnpm start` (or Vercel) | `pnpm worker:daemon` |
| Native engines | none | Ghostscript, qpdf, `mutool` |
| Serves HTTP | yes (the site + API routes) | **never** |
| Responsibilities | Serve the site and in-browser tools; when storage **and** queue are wired, mint signed upload/download URLs and **record** `queued` jobs | Drain the queue, run processors against object storage, complete jobs; do deep compression when a native engine is present |
| Must **not** | Run the daemon, ship engines, or process jobs on the request path | Serve HTTP or run as a serverless function on the request path |

**Scale.** Run several worker replicas safely — the broker's atomic claim
(`RPOP`/`ZREM`) guarantees no two workers run the same job. The web app scales
independently and stays stateless.

---

## 2. Environment by service (placeholders only)

**Policy (load-bearing):** never commit secrets; all provider credentials are
**server-side only** and must **never** be prefixed `NEXT_PUBLIC_` (that prefix
ships a value to the browser). Copy [`.env.worker.example`](../.env.worker.example)
to a git-ignored `.env` and replace every `REPLACE_*` placeholder out-of-band. The
full variable tables (shapes, bounds, notes) live in [`DEPLOYMENT.md`](DEPLOYMENT.md);
this section is the by-service summary.

### web service

| Variable | Required | Notes |
| --- | --- | --- |
| — | — | **Nothing is required by default.** The site builds and serves with no env at all. |
| `PDFXYZ_STORAGE_PROVIDER` + `PDFXYZ_S3_*` | Optional | Wire the same server-only S3/R2 vars to mint signed URLs and record jobs. Recording a job is **not** processing it. |
| `PDFXYZ_QUEUE_PROVIDER` + `PDFXYZ_REDIS_REST_*` | Optional | Wire the queue so `POST /api/jobs` records a `queued` job (202). It stays queued until a worker drains it. |
| `NEXT_PUBLIC_TELEMETRY_ENDPOINT` / `NEXT_PUBLIC_TELEMETRY_SAMPLE_RATE` | Optional | Client telemetry, **off** unless set. `NEXT_PUBLIC_` is correct here — it is public by nature, never a secret. |

### worker service

| Variable | Required | Notes |
| --- | --- | --- |
| `PDFXYZ_STORAGE_PROVIDER` (`s3`) + `PDFXYZ_S3_ENDPOINT` / `_REGION` / `_BUCKET` / `_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | **Yes, to drain** | Object storage the worker reads inputs from and writes artifacts to. |
| `PDFXYZ_QUEUE_PROVIDER` (`redis`) + `PDFXYZ_REDIS_REST_URL` / `_TOKEN` | **Yes, to drain** | The broker the worker claims jobs from. The Redis/Upstash-compatible REST gateway must support script execution (`EVAL`) for Phase 21 atomic transitions; otherwise worker writes fail as typed `unavailable`. Without both storage **and** queue the daemon exits `2` (not configured). |
| `PDFXYZ_NATIVE_COMPRESSION` (`auto`/`off`), `PDFXYZ_COMPRESSION_*` | Optional | Deep image compression. `auto` detects an installed engine; lossless always works. |
| `PDFXYZ_LIFECYCLE_PROVIDER` / `PDFXYZ_LIFECYCLE_VALIDATED` / `PDFXYZ_LIFECYCLE_VERSIONED` | Optional | Declare the retention/lifecycle backstop so `--check` / `--dry-run-status` can report it. |
| `PDFXYZ_WORKER_STRICT`, `PDFXYZ_WORKER_REQUIRE_DRAINABLE` / `_REQUIRE_DEEP_ENGINE` / `_REQUIRE_LIFECYCLE`, `PDFXYZ_QUEUE_REQUIRE_ATOMIC` | Optional (recommended in prod) | Opt-in guardrails: turn a dangerous or half-configured deployment into a fail-fast (exit `4`) instead of a silent fallback. `PDFXYZ_QUEUE_REQUIRE_ATOMIC` (implied by strict) requires a queue that guarantees atomic, race-safe transitions. See §4. |

Provider config is read from the **environment at run time** and is never baked
into an image layer, never logged, and never returned by `/api/worker/status`
(readiness is presence-only — it never names a bucket, endpoint, token, key, or
variable). Give the web and worker the **same** storage/queue values when you want
end-to-end flow; give the worker the compression/lifecycle/guardrail knobs.

---

## 3. Build, publish & promote the images

CI **builds and validates** both targets on every PR and push to `main`
([`container.yml`](../.github/workflows/container.yml)) but deliberately does
**not** publish them (`push: false`) — so no registry credential lives in CI.
Publishing and promotion are operator-owned; the recommended flow:

```bash
# 1. Build each target, tagged by the immutable commit SHA (not a floating tag).
#    $REGISTRY is your registry host/namespace, e.g. a GHCR/ECR/GAR path.
GIT_SHA="$(git rev-parse --short HEAD)"
docker build --target web    -t "$REGISTRY/pdfxyz-web:$GIT_SHA"    .
docker build --target worker -t "$REGISTRY/pdfxyz-worker:$GIT_SHA" .

# 2. Smoke the worker image locally with NO config before pushing (see §4).
docker run --rm "$REGISTRY/pdfxyz-worker:$GIT_SHA" pnpm worker:smoke

# 3. Push, then deploy the SAME image reference to staging first.
docker push "$REGISTRY/pdfxyz-web:$GIT_SHA"
docker push "$REGISTRY/pdfxyz-worker:$GIT_SHA"
```

- **Promote by digest, not by tag.** After staging smoke passes, promote the exact
  image **digest** (`$REGISTRY/pdfxyz-worker@sha256:…`) to production so staging
  and production run byte-identical images. Never repoint a `latest`/`prod` tag.
- **Registry auth stays out of source.** Authenticate the pusher with a short-lived
  registry token in your deploy environment; never commit it, and never place a
  provider secret behind `NEXT_PUBLIC_`.
- **The web app** may instead deploy to Vercel from `main` (see
  [`DEPLOYMENT.md`](DEPLOYMENT.md)); the worker is always the container above.

---

## 4. Smoke procedure (no secrets required)

Run these after every deploy (and in staging before promotion). None need a real
secret; the no-config checks need no network.

**a. Worker no-config honesty contract** — the built worker image must refuse to
fake work with nothing wired:

```bash
docker run --rm pdfxyz-worker:<tag> pnpm worker:smoke
# help → 0, dry-run-status/once/drain → 2, bad/conflicting flags → 1,
# clean guardrails / lifecycle-policy → 0, dangerous config → 4
```

**b. Worker readiness, with real config** — presence-only, claims no job:

```bash
pnpm worker:daemon --dry-run-status   # exit 0 = drainable (queue + storage), 2 = not configured
```

Confirm the `compression_health` line reports `deep: true` (with your engine in
`engines`) before advertising **deep** compression — a worker can be drainable yet
lossless-only.

**c. Guardrails** — catch a dangerous or half-configured deployment before it runs:

```bash
pnpm worker:daemon --check            # exit 0 = clean, 4 = a guardrail violation
```

In production, arm `PDFXYZ_WORKER_STRICT=true` so a selected-but-invalid provider,
an out-of-bounds retention TTL, or a missing lifecycle backstop **fails fast**
(exit `4`) instead of silently degrading to "not configured".

**d. Web** — verify security headers and share surfaces on the live URL (the
`curl` checks in [`DEPLOYMENT.md`](DEPLOYMENT.md) §6).

Deploy checklist:

- [ ] Worker image passes `pnpm worker:smoke` (honest-refusal contract).
- [ ] `--dry-run-status` is `0` (drainable) with production config; `2` in a
      deliberately empty environment.
- [ ] `--check` is `0` (or intentionally `4` with strict on a config you are fixing).
- [ ] `compression_health.deep` is `true` if you advertise deep compression.
- [ ] Web security headers + CSP present; core in-browser tools work.
- [ ] A test job flows end-to-end (queued → claimed → completed) in staging.

---

## 5. Rollback

- **Web (Vercel):** **Deployments → ⋯ → Promote** the previous good deployment —
  instant revert. **Web (container):** redeploy the previous image digest.
- **Worker:** redeploy the previous image **digest**. This is safe by design:
  - **Cooperative shutdown.** `SIGTERM`/`SIGINT` lets the in-flight tick finish and
    the loop exit; a second signal forces stop. Drain before replacing when you can.
  - **No split-brain.** The broker's atomic claim means a stopping old replica and a
    starting new one never run the same job; unclaimed work simply waits.
  - **In-flight safety.** A job whose worker dies mid-run is redelivered after its
    lease expires (bounded by `PDFXYZ_QUEUE_MAX_ATTEMPTS`); artifacts are written
    before the job is marked complete, so a rollback never leaves a half-done job
    reported as done.
- **Config-only rollback.** If a bad env change (not a bad image) broke drainability,
  `--check` / `--dry-run-status` will show it; revert the env and re-smoke — no image
  change needed.

---

## 6. Known missing pieces / still operator-owned

These artifacts do **not** fake any of the following. Track them before calling
remote processing production-ready:

- **Provisioned infrastructure.** A real private, encrypted S3/R2 **bucket** and a
  private Redis/Upstash **broker** are not created here. Provision them out-of-band
  with public access disabled, scoped tokens, and encryption at rest/in transit.
- **Lifecycle-enforced deletion.** The daemon can **generate** a retention policy
  (`pnpm worker:daemon --lifecycle-policy --provider=aws-s3|cloudflare-r2|minio|generic`),
  but **applying** it to the bucket — plus the bucket CORS rules the browser needs
  for direct signed transfers — is operator-owned. The app's URL TTLs are not a
  substitute for bucket lifecycle rules.
- **Malware / soundness scanning.** The executor has a `scanning` phase, but this
  build ships **no** scanner — the deployment readiness reports malware scanning as
  **not implemented**. A production worker must add real scanning there before
  processing untrusted uploads.
- **OCR.** Not implemented in any build; `/api/worker/status` and the OCR tool
  honestly report it unavailable. No scan is uploaded and no text is fabricated
  until a real OCR processor is deployed behind the worker contract.
- **Native `deep` engines are shipped, not proven.** The worker image installs
  Ghostscript/qpdf/`mutool`, but confirm `compression_health.deep` on the running
  image (§4) before advertising deep compression; lossless always works.
- **Image publish/promotion is not automated.** CI builds and validates the images
  but does not push them; wiring a registry and the promote-by-digest flow (§3) is
  operator-owned.

---

Related: [`DEPLOYMENT.md`](DEPLOYMENT.md) (Vercel web deploy, full env tables, phase
checklists) · [`WORKER_ARCHITECTURE.md`](WORKER_ARCHITECTURE.md) (worker internals)
· [`SECURITY.md`](SECURITY.md) (privacy & content-free logging) ·
[`OBSERVABILITY.md`](OBSERVABILITY.md) (status surface).
