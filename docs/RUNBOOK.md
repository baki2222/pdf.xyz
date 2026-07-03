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
| Native engines | none | Ghostscript, qpdf, `mutool` + OCRmyPDF/Tesseract (English OCR data); plus `pdftotext` (poppler-utils) as **proof-only** tooling (not a runtime engine) |
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
| `PDFXYZ_RATE_LIMIT_PROVIDER` / `PDFXYZ_RATE_LIMIT_TRUST_PROXY` | Optional | In-app abuse guard, **off** unless a provider is set. `local-memory` = per-process limiter (**not distributed**). A remote name (`redis`/`upstash`) activates the shipped **distributed** provider (Phase 34) when the store below is wired, else skips honestly. Server-only; never `NEXT_PUBLIC_`. Deny ⇒ `429` + `Retry-After`, content-free. |
| `PDFXYZ_RATE_LIMIT_REDIS_REST_URL` / `..._TOKEN` / `..._KEY_PREFIX` / `..._FAIL_MODE` | Optional | **Web-tier** store for distributed rate limiting (Phase 34) — separate names from the worker-only `PDFXYZ_REDIS_REST_*` so no worker secret lands on the public web pod. May reuse the same instance. `FAIL_MODE`: `open` (default, store outage ⇒ allow) or `closed` (⇒ `429`). Server-only; never `NEXT_PUBLIC_`. |

### worker service

| Variable | Required | Notes |
| --- | --- | --- |
| `PDFXYZ_STORAGE_PROVIDER` (`s3`) + `PDFXYZ_S3_ENDPOINT` / `_REGION` / `_BUCKET` / `_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | **Yes, to drain** | Object storage the worker reads inputs from and writes artifacts to. |
| `PDFXYZ_QUEUE_PROVIDER` (`redis`) + `PDFXYZ_REDIS_REST_URL` / `_TOKEN` | **Yes, to drain** | The broker the worker claims jobs from. The Redis/Upstash-compatible REST gateway must support script execution (`EVAL`) for Phase 21 atomic transitions; otherwise worker writes fail as typed `unavailable`. Without both storage **and** queue the daemon exits `2` (not configured). |
| `PDFXYZ_NATIVE_COMPRESSION` (`auto`/`off`), `PDFXYZ_COMPRESSION_*` | Optional | Deep image compression. `auto` detects an installed engine; lossless always works. |
| `PDFXYZ_LIFECYCLE_PROVIDER` / `PDFXYZ_LIFECYCLE_VALIDATED` / `PDFXYZ_LIFECYCLE_VERSIONED` | Optional | Declare the retention/lifecycle backstop so `--check` / `--dry-run-status` can report it. |
| `PDFXYZ_MALWARE_SCANNER` (`clamav://host[:port]` or `clamav+unix:///path`), `PDFXYZ_CLAMAV_TIMEOUT_MS` / `PDFXYZ_CLAMAV_MAX_BYTES` | Optional | Enable the optional ClamAV/clamd malware-scan gate (streams inputs over INSTREAM, blocks infected before processing). Unset ⇒ inactive no-op (nothing scanned, never *reported* as scanned); `disabled`/`off` turns it off explicitly. Run clamd as a sidecar. Set `PDFXYZ_WORKER_REQUIRE_SCAN` to make `--check` refuse to run (exit `4`) unless a usable endpoint is configured. |
| `PDFXYZ_OCR` (`on`/`off`), `PDFXYZ_OCR_ENGINE` (`ocrmypdf`/`tesseract`), `PDFXYZ_OCR_*_BIN`, `PDFXYZ_OCR_TIMEOUT_MS` / `_MAX_INPUT_BYTES` / `_MAX_OUTPUT_BYTES` / `_TMPDIR` | Optional | Enable the optional OCR backend (Phase 23). **Unset ⇒ disabled** — `ocr-pdf` fails honestly as `not_implemented`. `PDFXYZ_OCR=on` is necessary but not sufficient: install **OCRmyPDF** (preferred; PDF→searchable PDF+text) or **Tesseract** (images) and the language packs you advertise on the worker image. Values are never logged. See [`OCR_BACKEND.md`](./OCR_BACKEND.md). |
| `PDFXYZ_WORKER_STRICT`, `PDFXYZ_WORKER_REQUIRE_DRAINABLE` / `_REQUIRE_DEEP_ENGINE` / `_REQUIRE_LIFECYCLE`, `PDFXYZ_QUEUE_REQUIRE_ATOMIC`, `PDFXYZ_WORKER_REQUIRE_SCAN`, `PDFXYZ_WORKER_REQUIRE_OCR` | Optional (recommended in prod) | Opt-in guardrails: turn a dangerous or half-configured deployment into a fail-fast (exit `4`) instead of a silent fallback. `PDFXYZ_QUEUE_REQUIRE_ATOMIC` (implied by strict) requires a queue that guarantees atomic, race-safe transitions; `PDFXYZ_WORKER_REQUIRE_SCAN` (opt-in, **not** implied by strict) requires an active scanner; `PDFXYZ_WORKER_REQUIRE_OCR` (opt-in, **not** implied by strict) requires a ready OCR engine. See §4. |
| `PDFXYZ_WORKER_HEARTBEAT`, `PDFXYZ_WORKER_HEARTBEAT_INTERVAL_SECONDS` | Optional | Phase 30 liveness observation. When explicitly enabled and the Redis/Upstash queue broker is configured, the daemon publishes a bounded heartbeat to the broker; the web operations dashboard reports `daemonObserved:true` only while that beat is fresh. Disabled/stale/absent beats never fake liveness. |

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

# 2. Smoke the worker image locally with NO config before pushing (see §4):
#    the no-config honesty contract, then the native + OCR engine presence proof.
#    Both run inside the image and process no document.
docker run --rm "$REGISTRY/pdfxyz-worker:$GIT_SHA" pnpm worker:smoke
docker run --rm "$REGISTRY/pdfxyz-worker:$GIT_SHA" pnpm worker:image-smoke
# …and the node-free engine preflight with your production require-flags armed (must
# exit 0 because the image ships the engines you require):
docker run --rm \
  -e PDFXYZ_OCR=on -e PDFXYZ_WORKER_REQUIRE_OCR=true -e PDFXYZ_WORKER_REQUIRE_DEEP_ENGINE=true \
  "$REGISTRY/pdfxyz-worker:$GIT_SHA" pnpm worker:engines
# …then the deterministic OCR recognition proof (Phase 25): OCRs a generated sentinel
# raster and verifies the sentinel is recognized. Exit 0 = passed. No document, no cloud.
docker run --rm "$REGISTRY/pdfxyz-worker:$GIT_SHA" pnpm worker:ocr-proof
# …and the OCRmyPDF searchable-PDF proof (Phase 27): builds an image-only PDF, runs
# OCRmyPDF, and verifies pdftotext extracts the sentinel from the OUTPUT (image-only →
# searchable). Exit 0 = passed. No document, no cloud.
docker run --rm "$REGISTRY/pdfxyz-worker:$GIT_SHA" pnpm worker:ocrmypdf-proof

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
# clean guardrails / lifecycle-policy / lifecycle-verify(matching export) → 0,
# lifecycle-verify without a doc → 2, drifted export / dangerous config → 4
```

**b. Worker image engine presence + OCR readiness** — the built worker image must
actually ship the native + OCR engines it advertises; presence-only, processes no
document:

```bash
docker run --rm pdfxyz-worker:<tag> pnpm worker:image-smoke
# gs/qpdf/mutool + tesseract/ocrmypdf installed → 0; English OCR langdata present;
# daemon still exits 2 with nothing wired (present engines must not fake work);
# PDFXYZ_OCR=on flips ocr_health→ready:true and compression_health→deep:true
# (a content-free, path-free readout). Absent engines → non-zero (image-only).
```

It is the image counterpart of `worker:smoke`: it proves the engines are
**installed** and that the daemon reports them **ready** when opted in — not that any
user document was recognized. Because it deliberately fails where engines are absent
it is **not** in the Docker-free PR gate; the container CI
([`container.yml`](../.github/workflows/container.yml)) runs it inside the built
worker image.

**c. Worker readiness, with real config** — presence-only, claims no job:

```bash
pnpm worker:daemon --dry-run-status   # exit 0 = drainable (queue + storage), 2 = not configured
```

Confirm the `compression_health` line reports `deep: true` (with your engine in
`engines`) before advertising **deep** compression — a worker can be drainable yet
lossless-only.

**d. Guardrails** — catch a dangerous or half-configured deployment before it runs:

```bash
pnpm worker:daemon --check            # exit 0 = clean, 4 = a guardrail violation
```

In production, arm `PDFXYZ_WORKER_STRICT=true` so a selected-but-invalid provider,
an out-of-bounds retention TTL, or a missing lifecycle backstop **fails fast**
(exit `4`) instead of silently degrading to "not configured".

**e. Web** — verify security headers and share surfaces on the live URL (the
`curl` checks in [`DEPLOYMENT.md`](DEPLOYMENT.md) §6).

**f. Operator healthcheck** — one command that folds readiness, deployment,
guardrails, engine/OCR/scanner health, the lifecycle backstop, and the Phase 30
liveness heartbeat into a single alert verdict + exit code a monitor keys on:

```bash
pnpm worker:ops-check                 # on the worker host: full runtime evidence + heartbeat
# 0 ok · 1 usage/malformed input · 2 unknown (no data) · 3 warn · 4 critical
```

This is the piece a **cron job, uptime monitor, or process supervisor** runs on a
schedule. It never claims a job, contacts a metrics backend, or pages anyone — it is
local evaluation with a documented exit code (see
[`OBSERVABILITY.md`](OBSERVABILITY.md#operator-healthcheck--alert-evaluation-phase-31)).
Its exit codes are **distinct from the daemon's** above (`worker:daemon`): here `2` is
*unknown/no-data* and `4` is *critical*, matching the alert severity ladder. Wire it:

```bash
# cron on the worker host (or a monitor host with --web): alert on a non-zero,
# non-1 exit (1 = the check itself was misconfigured, not a worker problem).
*/5 * * * * cd /app && pnpm -s worker:ops-check --web; c=$?; [ "$c" -ge 2 ] && notify "worker ops-check exit $c"

# or evaluate a snapshot a monitor already scraped from the endpoint:
curl -s "$APP/api/worker/operations" | pnpm worker:ops-check --stdin --text
```

The output is content-free by construction (bounded enums + policy-authored prose;
an ingested snapshot's strings are re-authored, never echoed), so it is safe to ship
to any cron/monitor log. Runnable fixtures for each verdict live in
[`docs/examples/observability/healthcheck/`](../docs/examples/observability/healthcheck/).

Deploy checklist:

- [ ] Worker image passes `pnpm worker:smoke` (honest-refusal contract).
- [ ] Worker image passes `pnpm worker:image-smoke` — gs/qpdf/`mutool` +
      tesseract/ocrmypdf installed, English OCR langdata present, and
      `ocr_health.ready` / `compression_health.deep` when opted in (presence-only).
- [ ] Worker image passes `pnpm worker:ocr-proof` — the packaged Tesseract baseline
      recognizes a synthetic sentinel raster into a searchable PDF + sidecar (Phase 25;
      genuine recognition, no user document). Exit `0`.
- [ ] Worker image passes `pnpm worker:ocrmypdf-proof` — the packaged OCRmyPDF turns a
      synthetic **image-only** PDF into a genuinely **searchable** one, confirmed by
      `pdftotext` extracting the sentinel from the OUTPUT but not the source (Phase 27;
      the PDF→PDF path, no user document). Exit `0`.
- [ ] `--dry-run-status` is `0` (drainable) with production config; `2` in a
      deliberately empty environment.
- [ ] `--check` is `0` (or intentionally `4` with strict on a config you are fixing).
- [ ] `compression_health.deep` is `true` if you advertise deep compression.
- [ ] Web security headers + CSP present; core in-browser tools work.
- [ ] A test job flows end-to-end (queued → claimed → completed) in staging.
- [ ] A completed **OCR** job's status (`GET /api/jobs/:id`) carries `results.ocr`
      with structural facts (pages, output kind, languages, character count) and
      **no** recognized text, path, key, or URL (Phase 26). A failed/blocked OCR job,
      or any compression job, carries **no** `results` block — if one appears where it
      should not, treat it as a bug, not a cosmetic issue.
- [ ] `GET /api/worker/operations` reports the expected web-vantage posture: no fake
      daemon liveness (`daemonObserved:false`), safe recommended action, and no provider
      values. Confirm worker-side `operations`/`metrics`/`slo` JSON lines from the daemon
      logs for actual worker-vantage health (Phase 28).
- [ ] `pnpm worker:ops-check` exits `0` against a healthy stack (or the honest `2`
      unknown when a worker cannot be observed); it is wired into your cron/uptime
      monitor or supervisor with an alert on a non-zero, non-`1` exit (Phase 31).

**g. Worker operations/SLO snapshot** — use this for dashboards and runbook triage:

```bash
curl -fsS https://<your-web-host>/api/worker/operations | jq .
pnpm worker:daemon --dry-run-status   # emits readiness + operations + metrics + slo
pnpm worker:daemon --check            # emits guardrails + operations + metrics + slo
```

The same snapshot is rendered for humans as the **operator dashboard** on the `/status`
page (Phase 29) — overall health, the single recommended action, a subsystem grid,
lifecycle-verification + engine-proof cards, and the daemon-observability caveat spelled
out in plain language. Use `curl`/`jq` for scripting and alerts; use `/status` for triage.

Interpretation:

- Web-vantage `daemonObserved:false` is expected when heartbeat observation is disabled;
  the dashboard states this explicitly so it is never misread as "worker down". When
  `PDFXYZ_WORKER_HEARTBEAT` is enabled with the Redis queue broker, a fresh beat flips
  `daemonObserved:true`; stale or absent beats produce `investigate-worker-liveness`.

- `recommendedAction` is the first safe next step. `configure-providers`,
  `fix-guardrail`, `reconcile-lifecycle-drift`, `investigate-worker-liveness`, and
  `investigate-loop-errors` are operator-action states; `confirm-worker-deployment`
  means config looks good from the web but heartbeat observation is disabled, so the
  daemon must be checked out-of-band.
- SLO entries are computed from content-free metric samples. Missing observations are
  `unknown`; latency is bucketed (`≤2.5s`, `≤10s`, …), never exact per-document timing.

---

## Phase 32: deployment blueprint + scheduled ops-check

Use [`docs/examples/deployment`](examples/deployment) as the deployment starting point:

1. Pick a topology: Docker Compose blueprint, Kubernetes manifests, or systemd on a worker host.
2. Copy the placeholder env/Secret template and inject real S3/R2, Redis-REST, OCR/scanner, and heartbeat values out-of-band. Never commit the real file.
3. Run the worker daemon (`pnpm worker:daemon`) as a separate private process/container; do not put it in the web request path.
4. Enable Phase 30 heartbeat only when the Redis-REST broker is configured, so `/api/worker/operations` can observe a fresh daemon beat.
5. Schedule `pnpm worker:ops-check` from cron/systemd/Kubernetes CronJob or CI. Alert on exit `2`, `3`, or `4`; treat exit `1` as “the check is misconfigured,” not a worker incident.
6. Validate the static templates before adapting them: `pnpm deploy:examples:check`.

The blueprints are intentionally provider-neutral and secret-free. They do not provision cloud resources, deploy Docker/Kubernetes here, configure DNS/TLS, update ClamAV signatures, or page anyone; those remain operator-owned.

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
- **Distributed rate limiting — in-app guard + shipped distributed provider (Phase 34);
  the edge is still operator-owned.** The app carries an honest in-app abuse guard
  (`src/lib/ratelimit`): per-action policies, `429 rate_limited` + `Retry-After` on deny,
  content-free decisions, off by default. Its `local-memory` provider is **per-process
  only** (behind N instances the budget is N×; a restart resets windows). Phase 34 ships
  a real **distributed** provider backed by a Redis/Upstash-REST store with an atomic
  fixed-window `EVAL`: set `PDFXYZ_RATE_LIMIT_PROVIDER=redis` and the web-tier store
  (`PDFXYZ_RATE_LIMIT_REDIS_REST_URL` / `..._TOKEN`) and it auto-registers at boot, so a
  policy's budget is shared across the fleet. It is still **defense-in-depth**: a real
  **edge/WAF/CDN rate-limit rule** in front of the app remains the first line before a
  high-traffic launch. Confirm status via the boot log or `resolveRateLimitStatus()`
  (see [OBSERVABILITY.md](OBSERVABILITY.md)); a `remote-error-fail-open` status means the
  store is unreachable and the guard is failing open (not enforcing) — investigate the
  store, not the app.
- **Lifecycle-enforced deletion — generate + verify ship, applying is operator-owned.**
  The daemon can **generate** a retention policy
  (`pnpm worker:daemon --lifecycle-policy --provider=aws-s3|cloudflare-r2|minio|generic`)
  and, since Phase 25, **verify** an operator-exported lifecycle config against that
  generated backstop out-of-band
  (`pnpm worker:daemon --lifecycle-verify --observed=<exported.json>`: exit `0`
  verified · `2` unknown/no doc · `4` drift). What stays operator-owned is **applying**
  the policy to the bucket, **exporting** the live config for verification (the app
  never reads the bucket), and the bucket CORS rules the browser needs for direct
  signed transfers. The app's URL TTLs are not a substitute for bucket lifecycle rules,
  and the active delete-now on job completion is proven, not assumed
  (`executor.leak.test.ts`).
- **Malware scanning — gate ships, clamd is operator-owned.** The executor scan gate
  and an **optional ClamAV/clamd** backend ship (Phase 22): set `PDFXYZ_MALWARE_SCANNER`
  to a clamd endpoint and the worker streams inputs over INSTREAM and blocks infected
  (and unscannable) uploads before processing. What's operator-owned is **running the
  clamd daemon** (a sidecar with current signature databases) and pointing the worker
  at it; unset, the gate is an honest inactive no-op (nothing scanned, never *reported*
  as scanned). Arm `PDFXYZ_WORKER_REQUIRE_SCAN` to make the daemon refuse to start
  (exit `4`) unless a usable scanner is configured.
- **OCR — backend + engines ship (Phase 23–24), enabling is operator-owned.** OCR is
  a **real, optional** worker backend (`src/lib/workers/ocr-native.ts`), **off by
  default**. The worker image now **already ships** OCRmyPDF/Tesseract plus **English**
  OCR language data, so what's operator-owned is **enabling** it: set `PDFXYZ_OCR=on`
  (alongside the storage + queue a worker needs to drain). Add `tesseract-ocr-<lang>`
  packs to the image **only** if you advertise languages beyond English. Unset (or
  enabled with no engine), `ocr-pdf` fails honestly as `not_implemented`,
  `/api/worker/status` reports `ocr.available: false`, and no text is fabricated.
  `--dry-run-status` distinguishes the four states via the `ocr_health` line
  (`enabled`/`ready`/`engine`); arm `PDFXYZ_WORKER_REQUIRE_OCR` to refuse to start
  (exit `4`) unless a ready engine is present. See [`OCR_BACKEND.md`](./OCR_BACKEND.md).
- **Native `deep` + OCR engines — presence + synthetic recognition AND the OCRmyPDF
  searchable-PDF path proven in CI, real-document quality not.** `pnpm worker:image-smoke`
  **proves engine presence** at the image level in the container CI (Ghostscript/qpdf/`mutool`
  + Tesseract/OCRmyPDF binaries installed, **English** OCR language data present, ready
  `ocr_health` / `compression_health.deep` when opted in); Phase 25's `pnpm worker:ocr-proof`
  proves the Tesseract baseline actually **recognizes** a generated sentinel raster into a
  searchable PDF + sidecar; and Phase 27's `pnpm worker:ocrmypdf-proof` proves the **OCRmyPDF
  PDF→PDF path** — a synthetic **image-only** PDF becomes genuinely **searchable** (verified
  by `pdftotext` on the output, not the source). What none of them proves is real
  user-document OCR/compression **quality or behavior**, or non-English packs: validate
  `compression_health.deep` / `ocr_health.ready` on the **live** worker (§4) and run a real
  document through it out-of-band before advertising deep compression or OCR. Lossless
  always works.
- **Image publish/promotion is not automated.** CI builds and validates the images
  but does not push them; wiring a registry and the promote-by-digest flow (§3) is
  operator-owned.
- **Hosted metrics backend + pager — evaluation ships, the pipeline is operator-owned.**
  The daemon emits content-free `metrics`/`slo` lines, and Phase 31's
  `pnpm worker:ops-check` folds the operations snapshot (+ an optional metric window)
  into a single alert verdict with a documented exit code. What stays operator-owned is
  the **timeseries store** (Prometheus/OTel/hosted), the **scheduler** (cron / uptime
  service / supervisor) that runs `ops-check`, and the **notifier** (email/chat/on-call
  pager) that reacts to a non-zero exit. ops-check is local evaluation, not a pager: it
  stores no history and pages no one — see
  [`OBSERVABILITY.md`](OBSERVABILITY.md#operator-healthcheck--alert-evaluation-phase-31).

---

Related: [`DEPLOYMENT.md`](DEPLOYMENT.md) (Vercel web deploy, full env tables, phase
checklists) · [`WORKER_ARCHITECTURE.md`](WORKER_ARCHITECTURE.md) (worker internals)
· [`SECURITY.md`](SECURITY.md) (privacy & content-free logging) ·
[`OBSERVABILITY.md`](OBSERVABILITY.md) (status surface).

## Upload intake guardrail responses

If clients receive `invalid_upload_request`, `unsupported_file_type`, `too_many_files`, `file_too_large`, `request_too_large`, or `malformed_pdf`, the request was rejected at the upload-intake boundary before object storage or queue work. These errors are intentionally content-free: they use positional fields and policy limits, never filenames, object keys, signed URLs, body values, or bytes. Check whether the client is declaring correct MIME/size metadata and whether any server-only `PDFXYZ_UPLOAD_*` overrides are stricter than expected. `malformed_pdf` only appears when bounded PDF envelope sniffing is opted in; it is not a malware or sanitization verdict.

## Worker soundness rejections

If worker logs/metrics show `worker_soundness_total{verdict="unsound"}` or jobs fail with the `unsound` class, inspect the bounded reason code: `empty`, `missing_input`, `too_many_inputs`, `file_too_large`, `size_mismatch`, `unsupported_family`, `metadata_mismatch`, `malformed_pdf`, or `policy_unavailable`. These reasons are intentionally content-free; do not try to correlate them with filenames or object keys in logs. Common operator actions: verify upload metadata preservation, confirm the client is sending PDFs for PDF-only tools, and review any `PDFXYZ_WORKER_SOUNDNESS_*` overrides. `malformed_pdf` means the bounded envelope check failed; it is not a malware verdict.

## Worker artifact-manifest rejections

If worker logs/metrics show `worker_artifact_manifest_total{verdict="invalid"}` or jobs fail with the `artifact` class (client error `artifact_invalid`), the manifest gate blocked a processor's outputs *after* the transform but *before* publication — no artifact was stored or exposed. Inspect the bounded reason: `no_artifacts`, `too_many_artifacts`, `empty_artifact`, `oversize_artifact`, `unknown_output_kind`, `content_type_mismatch`, `unsupported_content_type`, `missing_retention_class`, `provenance_incomplete`, or `policy_unavailable`. These are content-free; do not correlate them with filenames or object keys. Common operator actions: a spike in `empty_artifact`/`no_artifacts` points at a degenerate processor run (check engine health); `content_type_mismatch`/`unsupported_content_type` points at a tool emitting the wrong output kind; `missing_retention_class` points at retention-policy drift; and `oversize_artifact` usually means a `PDFXYZ_WORKER_ARTIFACT_MAX_BYTES` ceiling is set tighter than real outputs. Review any `PDFXYZ_WORKER_ARTIFACT_*` overrides. This is a structural provenance check, not a malware, sanitization, or OCR-quality verdict.

## Worker artifact-retrieval denials (Phase 38)

The client-facing download boundary (`GET /api/artifacts/local/:artifactId`, local-dev only) runs the pure retrieval-access layer before streaming any bytes. When collection is wired, `worker_artifact_retrieval_total{outcome="denied"}` counts refused downloads by a content-free `reason`; the same reason drives the response code:

| Reason | HTTP | What it means | Operator action |
| --- | --- | --- | --- |
| `malformed_handle` | 400 | The presented handle is not a valid opaque id | Client bug or probing; no server action |
| `storage_unavailable` / `policy_unavailable` | 503 | The download backend cannot serve here, or the guardrail failed closed | Expected outside local-dev (this route is inert; real deployments serve signed URLs). A `policy_unavailable` spike is a defense-in-depth surprise — investigate |
| `not_found` | 404 | No such artifact (unknown handle, or reaped past the tombstone horizon) | Expected once outputs auto-delete and their tombstones age out |
| `expired` / `deleted` | 410 | The artifact provably existed and is now gone (retention window passed, or an explicit delete-now) | A spike of `expired` means clients retry too late; `deleted` follows a cancel/delete-now |
| `job_mismatch` | 403 | A client's `?job=` integrity binding named a job that does not own the artifact | A client's own false claim; not an access-control breach (the boundary has no auth — the handle is the capability) |
| `not_ready` | 409 | The owning job is not completed | Usually a client racing job completion |
| `invalid_manifest` | 422 | A recorded provenance manifest failed re-validation against the stored bytes | Investigate a manifest/byte desync in the publish path; content-free, do not correlate with names/keys |
| `unsupported_kind` | 415 | The output classifies to no recognized, downloadable kind | A producer emitting an unrecognized content-type |
| `empty_artifact` | 422 | The stored output is zero bytes | Degenerate processor run |
| `missing_manifest` | 404 | No manifest recorded and a strict-manifest posture is in force | Only if an operator both disabled the manifest gate and required a manifest at retrieval |

Alongside the `worker_artifact_retrieval_total` counter, every decision (served or denied) also derives a content-free **retrieval receipt** (`src/lib/workers/artifacts/retrieval-receipt.ts`: `{ category, outcome, reason, kind, policyId, policyVersion }`) emitted through an injectable observer that defaults to none — wire it to an audit sink to keep a per-attempt trail. By default an output published *without* a manifest (the manifest gate was disabled) still downloads via intrinsic checks (recognized kind, non-empty, live) and is honestly **not** reported as provenance-validated. Every reason and receipt is content-free — never a handle, filename, object key, signed URL, or document byte. This is a bounded structural + lifecycle eligibility check, not authentication, authorization, malware scanning, sanitization, or a deletion proof; possession of the unguessable opaque handle is the capability, and `?job=` is an optional integrity cross-check, not access control.
