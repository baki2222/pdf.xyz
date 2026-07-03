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

**g. Storage-artifact cleanup verification** — prove that artifacts which should be
gone are actually **deleted from object storage**, not just retrieval-denied. Four
distinct facts the platform keeps separate, easiest to hardest to confirm:

| Fact | What enforces it | How you confirm it |
| --- | --- | --- |
| **Retrieval-time denial** | Phase 41: the download route denies an expired/tombstoned artifact `410 Gone` before serving a byte | already automatic; a `worker_artifact_expiry_total{state}` drift receipt surfaces `expired`/`deleted` |
| **Active app deletion** | the executor's delete-now on terminal job paths (Phase 25) | evidence with `activeDelete:true` on an absent object → `absent-active` |
| **Bucket lifecycle backstop** | your bucket's own retention rule reaping objects | `pnpm worker:daemon --lifecycle-verify` confirms the *rules*; an absent object with no delete receipt → `absent-backstop` confirms a *reap* |
| **Cleanup verification** | Phase 42: `pnpm worker:cleanup-check` | the command below |

The app **never calls the cloud**, so you export the evidence out-of-band with your
own credentials — a content-free per-object summary — and pipe it in:

```bash
# Build a content-free evidence doc: for each artifact the app expected to be gone,
# record ONLY presence + the coarse retention facts (never a key, bucket, URL, or byte).
# e.g. HEAD each object and project into:
#   [ { "presence":"absent", "activeDelete":true },        # deleted-now → absent-active
#     { "presence":"absent" },                              # reaped by lifecycle → absent-backstop
#     { "presence":"present", "expiresAtMs":1700000000000 } # still present → denied or drift
#   ]
cat cleanup-evidence.json | pnpm worker:cleanup-check --stdin
# 0 verified (all should-be-gone confirmed absent) · 1 usage/malformed · 2 unknown
# (not-configured, no evidence, present-but-denied awaiting reap, or a probe failed) ·
# 3 drift (an object is still present past its retention window + --grace-hours, default 48)

# Wire drift into your monitor (exit 3 = an object outlived its window + grace):
*/30 * * * * cd /app && export-cleanup-evidence | pnpm -s worker:cleanup-check --stdin; \
  c=$?; [ "$c" -eq 3 ] && notify "storage cleanup drift"
```

Honesty you can rely on: it verifies, it **never deletes** (removal stays your job,
out of band); **absence is the only proof of cleanup**, so a present-but-denied object
is reported as *pending* (`unknown`), never fabricated into "deleted"; a deployment
with no storage wired reports an honest `not-configured` (exit `2`), never a fake pass.
The output is content-free (bounded verdict + small counts + authored prose; every
field of your evidence document except the four understood keys is dropped, so a stray
object key or bucket name can never be echoed), safe for any cron/monitor log.

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
- [ ] `pnpm worker:cleanup-check` exits `0` (`not-configured`, honest `2`, in a
      deliberately empty environment). With storage wired, a periodic run over exported
      cleanup evidence returns `verified` (or the honest `unknown` while reap is pending),
      and `drift` (exit `3`) is alerted — objects still present past their retention
      window + grace mean the bucket lifecycle backstop is not reaping (Phase 42).

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

## Worker artifact-retrieval denials (Phase 38 / 39)

Two routes share one pure retrieval-access boundary before streaming any bytes: the local-dev route (`GET /api/artifacts/local/:artifactId`, in-process store, local-dev only) and the Phase 39 storage-backed route (`GET /api/artifacts/:artifactId`, active only when object storage is configured — it reads the bytes from the bucket **server-side** and streams them through this app, never a signed object-store URL). When collection is wired, `worker_artifact_retrieval_total{outcome="denied"}` counts refused downloads by a content-free `reason` and a bounded `provider` (`local-dev` / `remote-configured` / `not-configured`, so you can tell which route denied); the same reason drives the response code:

| Reason | HTTP | What it means | Operator action |
| --- | --- | --- | --- |
| `malformed_handle` | 400 | The presented handle is not a valid opaque id | Client bug or probing; no server action |
| `storage_unavailable` / `policy_unavailable` | 503 | The download backend is **not configured** to serve here, or the guardrail failed closed | Expected on the local-dev route outside local-dev, and on the storage-backed route when object storage is not (fully) configured — no read is attempted. A `policy_unavailable` spike is a defense-in-depth surprise — investigate |
| `storage_error` | 503 | Storage **is** configured but the bucket read failed transiently (5xx / network) — retryable | Distinct from `storage_unavailable` ("no backend"). A sustained `storage_error{provider="remote-configured"}` spike means the bucket is reachable-but-flaky (throttling, 5xx, DNS) — check bucket/endpoint health and rate limits; clients may safely retry. Never a false `not_found` |
| `not_found` | 404 | No such artifact (unknown handle, or reaped past the tombstone horizon) | Expected once outputs auto-delete and their tombstones age out |
| `expired` / `deleted` | 410 | The artifact provably existed and is now gone (retention window passed, or an explicit delete-now) | A spike of `expired` means clients retry too late; `deleted` follows a cancel/delete-now |
| `job_mismatch` | 403 | A client's `?job=` integrity binding named a job that does not own the artifact | A client's own false claim; not an access-control breach (the boundary has no auth — the handle is the capability) |
| `not_ready` | 409 | The owning job is not completed | Usually a client racing job completion |
| `invalid_manifest` | 422 | A recorded provenance manifest failed re-validation against the stored bytes | Investigate a manifest/byte desync in the publish path; content-free, do not correlate with names/keys |
| `unsupported_kind` | 415 | The output classifies to no recognized, downloadable kind | A producer emitting an unrecognized content-type |
| `empty_artifact` | 422 | The stored output is zero bytes | Degenerate processor run |
| `missing_manifest` | 404 | No manifest recorded and a strict-manifest posture is in force | Only if an operator both disabled the manifest gate and required a manifest at retrieval |

Alongside the `worker_artifact_retrieval_total` counter, every decision (served or denied) also derives a content-free **retrieval receipt** (`src/lib/workers/artifacts/retrieval-receipt.ts`: `{ category, outcome, reason, kind, provider, policyId, policyVersion }`) emitted through an injectable observer that defaults to none — wire it to an audit sink to keep a per-attempt trail. By default an output published *without* a manifest (the manifest gate was disabled) still downloads via intrinsic checks (recognized kind, non-empty, live) and is honestly **not** reported as provenance-validated; a storage-backed object carries its content-free manifest as signed object metadata (`x-amz-meta-artifact-manifest`), re-validated on the server-side read. Every reason and receipt is content-free — never a handle, filename, object key, bucket name, signed URL, or document byte. This is a bounded structural + lifecycle eligibility check, not authentication, authorization, malware scanning, sanitization, or a deletion proof; possession of the unguessable opaque handle is the capability, and `?job=` is an optional integrity cross-check, not access control. The `?job=` binding is honored only on the local-dev route (which holds a server-side job→artifact record); the storage-backed object has no such record, so the binding is honestly skipped there, never denied.

## Worker artifact-delivery denials (Phase 40)

Once access is granted, a **second** gate (`decideDelivery`) verifies the byte delivery itself before streaming, on both routes, and records `worker_artifact_delivery_total{outcome,reason,kind,provider}` (same default-off sink). Its denials are deliberately collapsed to one client code so a download never leaks internals:

| Reason | HTTP | What it means | Operator action |
| --- | --- | --- | --- |
| `size_mismatch` | 503 `service_unavailable` | The `Content-Length` the boundary would emit could not be verified against the actual bytes *and* any upstream-declared length (a truncated / over-declared / desynced object) | Never streamed under a lying header. A spike on `remote-configured` points at bucket-side truncation or a `Content-Length` header that disagrees with the object body — check the storage provider; on `local-dev` it implies a store/publish bug |
| `oversize` | 503 `service_unavailable` | The artifact exceeds the fixed **1 GiB** delivery ceiling and is refused rather than buffered+streamed through the app server | Normally impossible for a real output — investigate a pathological/tampered object or a producer emitting an enormous artifact; the ceiling backstops the opt-in publish-time `PDFXYZ_WORKER_ARTIFACT_MAX_BYTES` cap |
| `stream_error` | 503 `service_unavailable` | An unexpected failure while producing the response (a backend that threw, a body that could not be built), caught and closed to a safe `503` rather than a framework `500` with a stack | Correlate with `worker_artifact_retrieval_total{reason="storage_error"}` and backend health; content-free, so never a provider message/key/URL. Clients may retry |

Two more delivery facts to know when triaging: **`HEAD`** is answered with the verified headers (including `Content-Length`) and no body — a byte-free way for clients to check readiness/size; and a **`Range`** request is *ignored* (whole-file `200`, `Accept-Ranges: none`) — this boundary proxies whole buffered objects and does **not** support partial or resumable downloads, so a paused download resumes by re-fetching, not by range. The per-attempt **delivery receipt** adds the bounded `method` (`GET`/`HEAD`) and `range` (`none`/`ignored`) so you can see probing patterns without any high-cardinality value. Any HTTP method other than `GET`/`HEAD` is refused a content-free `405` (no body) by the framework before a delivery decision is reached (so it never appears in this metric); `OPTIONS` is auto-answered `204` with `Allow: GET, HEAD, OPTIONS`. None of this is authentication, resumable serving, or content scanning — it is a bounded byte-consistency + method/range safety check only.

## Storage-backed artifact expiry drift (Phase 41)

An object store does **not** tombstone: it answers a GET with `200` for an artifact whose retention window has already passed, right up until the bucket's own lifecycle rule physically deletes it. Phase 41 makes the app enforce the window itself at retrieval time — the worker signs the artifact's retention window as content-free object metadata (`x-amz-meta-artifact-lifecycle`), and the storage reader denies a logically-expired object `410 Gone` **before** reading its bytes. Three layers are at play; keep them distinct when triaging:

- **App retrieval-time expiry enforcement (Phase 41).** Denies `expired`/`deleted` at download from signed lifecycle evidence. It surfaces as `worker_artifact_retrieval_total{reason="expired"|"deleted"}` (the `410`) **and** `worker_artifact_expiry_total{state="expired"|"deleted"}` (the lifecycle lens). This is enforcement, not deletion.
- **Bucket lifecycle-deletion backstop (operator-owned).** The bucket's own rule eventually reaps the object; once gone, the GET is a genuine `404` → `not_found`/`absent`. Its declared readiness is `worker_lifecycle_verification_total` / the lifecycle readiness seam — a **separate** signal from artifact expiry.
- **Local-dev tombstones.** The in-process store distinguishes `deleted` (explicit delete) from `expired` (window passed) from `absent`; the object-store path collapses a truly-gone object to `not_found` because a bucket cannot tell those apart once the object is reaped. This asymmetry is expected, not a bug.

Read `worker_artifact_expiry_total{state,provider}` (default-off sink) as a **drift + coverage** signal:

| Signal | What it means | Operator action |
| --- | --- | --- |
| `state=expired` / `deleted` on `remote-configured`, sustained | The bucket is still serving objects the app's retention window has passed — **lifecycle drift**. The app is denying them `410`, so no bytes leak, but the bucket lifecycle rule is lagging or missing | Verify the bucket lifecycle policy is applied and reaping on schedule (regenerate/apply it; mark it validated). This is a bucket-side backstop problem, not an app bug. Not proof any bytes were deleted |
| `state=unknown`, persistently high | Present objects carry no usable lifecycle evidence (a legacy backlog written before Phase 41, or storage that strips user-metadata), so retrieval-time expiry cannot be enforced for them — they are served honestly (never over-claimed as gone) and rely on the bucket backstop alone | Confirm the worker is stamping `x-amz-meta-artifact-lifecycle` on PUTs and that the storage provider returns user-metadata on GET. Legacy objects age out via the bucket rule |
| `state=live`, normal | Objects served within their window — the healthy path | None |

Out of band and **not** covered here: proof of byte deletion, bucket lifecycle policy correctness (the app never inspects the bucket), legal-hold/retention compliance, audit-log export, private-bucket access policy, and CDN cache purge (a `410` from this app does not purge an edge-cached copy — configure short/again `Cache-Control: private, no-store` is already set, but a CDN in front must honor it or purge independently).

## Storage-artifact cleanup: two offline operator lenses (Phase 42)

Phase 42 adds two content-free, offline operator tools. Both re-derive lifecycle through the SAME Phase 41 `evaluateArtifactLifecycle`, both are dry-run (they read no bytes and NEVER delete — actual object deletion stays operator-owned and out of band), and both are fake-testable (no real S3). They answer **different** questions:

- **`pnpm worker:cleanup-check` — the absence VERIFIER.** Given content-free evidence for a set of should-be-gone objects (`{ presence, expiresAtMs?, deleted?, activeDelete? }`, exported out-of-band), it proves whether each is actually **absent** (and by which mechanism — active delete-now vs the bucket lifecycle backstop) versus only retrieval-denied, folding to one verdict (`verified`/`drift`/`unknown`/`unavailable`/`not-configured`). Use it to confirm cleanup actually happened. See the smoke procedure above.
- **`pnpm worker:artifact-cleanup` — the inventory SWEEPER.** Given an offline inventory of PRESENT object metadata (a projection of `aws s3api list-objects-v2` + `head-object`), it categorizes each present object and emits an optional dry-run cleanup **plan** (counts + actions only). Use it to find what present objects should be swept.

Triage the sweeper's verdict (exit `0` clean / `2` unknown / `3` cleanup-recommended / `4` invalid·breached; `1` = bad input):

| Category (severity) | What it means | Operator action |
| --- | --- | --- |
| `expired-but-present` (drift, exit 3) | An object is past its retention window yet still present — a sweep candidate. The app already denies its download `410` (Phase 41); the bucket has not reaped it | Confirm the bucket lifecycle rule is applied and reaping; you MAY remove these out-of-band with your own credentials. Cross-check with `worker:cleanup-check` to see whether it is normal reap latency or true drift |
| `deleted-but-present` (breach, exit 4) | A tombstoned object's bytes are still present — the strongest cleanup gap | Remove the object out-of-band; investigate why the tombstone did not take effect at the storage layer |
| `missing-lifecycle` / `missing-manifest` / `storage-unavailable` (unknown, exit 2) | Not enough evidence to decide (no lifecycle metadata, no valid manifest, or no backend configured) | Investigate before acting: confirm the worker stamps `x-amz-meta-artifact-lifecycle`/`-manifest`, and that the projection recorded the fields |
| `unsupported-kind` (unknown, exit 2) | An object whose content-type maps to no recognized output kind | Review whether it is a foreign/legacy object before removing it |
| `invalid-record` (breach, exit 4) | The inventory contained a structurally invalid record — it cannot be trusted as a clean bill of health | Fix the projection pipeline and re-run |
| `ok` (exit 0) | Live, with a valid manifest, a recognized kind, and a configured backend | None |

Neither tool proves byte deletion on its own, claims bucket lifecycle policy correctness, or performs deletion/CDN purge — all still operator-owned and out of band.

### Producing the inputs safely: `pnpm worker:cleanup-project` (Phase 43)

Both tools above consume **content-free** documents. Do **not** hand-craft them from a raw
bucket capture (that risks pasting an object key, bucket, or signed URL into a document that
gets logged). Instead pipe your own out-of-band capture through the offline **projector**,
which reads only a bounded allowlist and drops every locator/identifier before anything is
written:

```sh
# Raw aws s3api head-object / list-objects-v2 capture (or a normalized dump) → INVENTORY → sweeper
aws s3api list-objects-v2 --bucket "$B" --prefix artifacts/ > raw-export.json   # your creds, out of band
pnpm worker:cleanup-project --target=inventory --file=raw-export.json | pnpm worker:artifact-cleanup --stdin --text

# Raw probe capture → EVIDENCE → absence verifier
pnpm worker:cleanup-project --target=evidence --file=raw-probe.json | pnpm worker:cleanup-check --stdin

# --source=generic if your export already uses the bounded field names; default is aws-s3
```

The projector's own exit ladder is `0` projected / `1` usage / `2` insufficient (a metadata-thin
export — capture lifecycle/manifest metadata and retry) / `4` unsafe (a present-but-tombstoned
object, or a structurally invalid record — investigate that object). It embeds a content-free
`receipt` (record counts + dropped-field counts by category + warnings by bounded reason) the
downstream tool ignores, so you can save the piped document and audit what was dropped. It is a
**redaction/normalization helper** — it makes no cloud call, needs no credentials, deletes
nothing, and is **not** proof of deletion, malware scanning, or a cloud scanner. Content-free
example raw exports (with `EXAMPLE-…` placeholder locators the projector strips) live in
`docs/examples/cleanup-project/`.

### One command + a dashboard posture: cleanup evidence operations (Phase 44)

Phase 44 makes the three tools above easier and safer to operate, in two complementary halves.

**Run it as one command — `pnpm worker:cleanup-pipeline`.** Instead of wiring the project → verify
and project → sweep pipes by hand, run the whole workflow as ONE fail-closed command. It reads a
raw export once, projects it away, runs the absence verifier AND the dry-run sweeper internally,
and rolls the two arms into a single composite exit code (the worst arm wins):

```sh
# Verify + sweep a raw export in one read-only pass; key your monitor on the exit code.
pnpm worker:cleanup-pipeline --file=raw-export.json --grace-hours=48 --json
# aws s3api list-objects-v2 --bucket "$B" | pnpm worker:cleanup-pipeline --stdin --source=aws-s3
```

| Exit | Composite state | What it means | Do |
| --- | --- | --- | --- |
| `0` | `ok` | Both arms clean: absence verified and the dry-run sweep found nothing. | Nothing. |
| `1` | `usage` | The pipeline was misused (bad flag) or the export was unreadable/malformed. **Fail closed** — never a silent `0`. | Fix the wiring / capture; do **not** page as a cleanup incident. |
| `2` | `unknown` | Cleanup could not be proven: a metadata-thin export, no storage wired here, or a probe was unavailable. | Soft warn. Confirm the capture and that storage is configured. |
| `3` | `drift` | An artifact is present past its retention window + reap grace. | **Page.** The bucket lifecycle backstop has not reaped what the app no longer serves. |
| `4` | `breach` | A present-but-tombstoned object, or a structurally unsafe export. | **Page urgently.** Bytes that should be gone remain; reconcile out-of-band. |

`drift`/`breach` is a cleanup gap, **not** a disclosure — the Phase 41 retrieval boundary still
denies the download `410`. The composite still makes no cloud call and deletes nothing. Schedule
it with `docs/examples/deployment/cleanup/cleanup-pipeline-notify.sh` (maps the one exit code to a
severity, re-raises it) or the `cleanup-pipeline-fixture.yml` CI gate.

**Watch it on the dashboard — the cleanup evidence posture monitor.** The passive complement folds
the report SUMMARIES a scheduled cleanup job already wrote into a single ops posture for `/status`
and `worker:ops-check`. Point it at the summaries (monitoring is OFF until you do):

```sh
export PDFXYZ_CLEANUP_EVIDENCE_CHECK_REPORT=/var/lib/pdfxyz/cleanup-check.json   # pdfxyz.cleanup-check/1
export PDFXYZ_CLEANUP_EVIDENCE_SWEEP_REPORT=/var/lib/pdfxyz/artifact-cleanup.json # pdfxyz.artifact-cleanup/1
export PDFXYZ_CLEANUP_EVIDENCE_MAX_AGE_HOURS=26   # a report older than this is `stale` (default 26)
```

| Posture | What it means | Do |
| --- | --- | --- |
| `disabled` | No report path configured — monitoring is off (the honest default). | Nothing, or configure a path to enable it. |
| `healthy` | A fresh report proves cleanup `verified` (or the sweep found nothing). | Nothing. |
| `not-configured` | A fresh report declares no object storage — legitimately nothing to clean up. | Nothing. |
| `stale` | The report is older than the freshness window, or none is present yet. | Confirm the generating job runs on schedule. |
| `warning` | A fresh report shows `drift`. | Investigate the drifted object out-of-band. |
| `critical` | A fresh report shows `breach`, OR the report is unreadable/malformed/a raw export (`invalid`). | **Page.** For `invalid`, re-point the monitor at a content-free summary — **never** a raw export. |
| `unknown` | A fresh report is inconclusive (`unknown`/`unavailable`). | Neutral — re-run once evidence is available. |

It reads no bytes, calls no cloud, and reads no secret; it refuses a raw export and never
fabricates freshness. The full loop: **schedule the pipeline (or the individual tools) → it writes
a content-free report → the monitor reads it → the dashboard shows posture.**

None of these tools proves byte deletion on its own, claims bucket lifecycle policy correctness, or performs deletion/CDN purge — all still operator-owned and out of band.

### Package a safe incident artifact: operations evidence bundle (Phase 45)

When a worker incident needs a ticket attachment or handoff artifact, use `pnpm worker:ops-bundle` instead of pasting raw logs, paths, bucket listings, or provider exports. It packages the existing **content-free** operations healthcheck plus an optional cleanup pipeline summary into one `pdfxyz.ops-bundle/1` JSON/text artifact:

```sh
# One-line runtime handoff; the bundle writes JSON to stdout and exits with the composite severity.
pnpm worker:ops-check --runtime --json | pnpm worker:ops-bundle --json

# Persist a content-free support artifact. The destination path is never embedded in the bundle.
pnpm worker:ops-bundle \
  --operations-file=/var/lib/pdfxyz/ops-check.json \
  --pipeline=/var/lib/pdfxyz/cleanup-pipeline.json \
  --output=/var/lib/pdfxyz/ops-bundle.json \
  --pretty
```

Exit ladder: `0` ok, `1` usage/miswired aggregation, `2` unknown/incomplete evidence, `3` warning/degraded or drift, `4` critical/breach. The bundle is an aggregator only: it does not call the cloud, inspect buckets, read object bytes, or delete anything. It reconstructs from bounded enums/counts and drops unsafe strings, so do **not** attach raw provider exports or logs to a ticket; attach the generated bundle instead. Runnable examples live under `docs/examples/ops-bundle/` and `docs/examples/deployment/*ops-bundle*`.

### Gate a worker build before promoting it: release readiness gate (Phase 46)

Before promoting a worker build or declaring production readiness, run ONE local, offline, read-only release gate that fails **closed** — it never certifies a promotion it cannot verify.

**`pnpm worker:release-gate`** is a single-host pre-deploy sweep with no setup — it RUNS the existing checks itself as subprocesses over committed fixtures and reads only their exit codes:

```
pnpm worker:release-gate --text          # run the whole catalog, fold to pass/warn/fail/unknown
pnpm worker:release-gate --only=deploy-examples,worker-smoke --json
```

Verdict/exit ladder: `0` pass, `1` usage, `2` unknown, `3` warn (an advisory check flagged a concern), `4` fail (a blocking check failed). Its verdict vocabulary is `pass`/`warn`/`fail`/`unknown` — a fold of the checks it ran.

`worker:release-gate` composes **11** bounded checks and reads ONLY each subprocess's exit code — never a byte of its stdout/stderr — so no filename, key, path, URL, or document content can reach the report; it is content-free **by construction**. A check PASSES when the subprocess exit matches the check's AUTHORED expected code, so several checks pass on a NON-ZERO exit precisely because they prove a fail-closed contract: `cleanup-pipeline-breach`, `ops-check-critical`, `ops-bundle-critical`, and `lifecycle-drift` expect `4`; `cleanup-pipeline-unknown` expects `2`; the rest — `deploy-examples`, `worker-smoke`, `worker-engines` (advisory), `ops-check-healthy`, `ops-bundle-healthy`, `lifecycle-verify` — expect `0`.

| Exit | Verdict | What it means | Do |
| --- | --- | --- | --- |
| `0` | `pass` | Every included check's exit matched its authored expectation. | Promote — subject to the out-of-band caveats below. |
| `1` | `usage` | The gate was misused: a bad flag, or an unknown `--skip`/`--only` check id. | Fix the invocation; do **not** read it as a build verdict. |
| `2` | `unknown` | A check was indeterminate (spawn failure/timeout/internal fault), or no check was included. | Re-run; investigate the host. Treat as a non-promotion, never a pass. |
| `3` | `warn` | An advisory check flagged a concern (e.g. `worker-engines` — advisory because the gate host may differ from the deployed worker image). | Review; a warn is informational, not a hard block. |
| `4` | `fail` | A blocking check failed — its exit did not match its authored expectation. | **Block the promotion.** Re-run the named failing check on its own. |

Scope the run with `--only=<id,…>` or `--skip=<id,…>` over the bounded check ids (`deploy-examples`, `worker-smoke`, `worker-engines`, `ops-check-healthy`, `ops-check-critical`, `ops-bundle-healthy`, `ops-bundle-critical`, `cleanup-pipeline-unknown`, `cleanup-pipeline-breach`, `lifecycle-verify`, `lifecycle-drift`); an unknown id is a `1` usage error. `--json` (default) / `--text` / `--pretty` pick the format and `--output=<path>` writes the report to a file (the path is never embedded in the report). Wire it into CI with `docs/examples/deployment/github-actions/release-gate-fixture.yml`, which runs the full gate, asserts exit `0`, demonstrates the expected-non-zero-is-pass contract, and uploads the JSON report as an artifact.

**It is a pre-deploy EVIDENCE gate — a `pass` means only "the evidence gathered here shows no blocker."** It does **not** prove bytes were deleted, that a bucket's lifecycle policy is correct, or that live cloud validation, malware scanning, sanitization, or authentication/authorization are resolved — all out-of-band. And it does **not** scan the working tree for secrets or NUL bytes: its `deploy-examples` check secret-scans the *committed* deployment blueprints, but **uncommitted changes are not scanned** — run your changed-file secret/NUL scan separately before you promote.

The gate is local, offline, and read-only: it does not call the cloud, read a provider export/secret/bucket, inspect object bytes, or delete/upload/mutate anything, and it does not perform the promotion. A `pass` verdict certifies only that the evidence gathered here shows no blocker — real cloud state (bucket lifecycle, object deletion, queue/broker health, CDN), legal retention, data migration, and provider quotas remain operator-owned and out-of-band. Do **not** attach raw provider exports or logs to a promotion record; attach the generated content-free report instead. The CI example lives at `docs/examples/deployment/github-actions/release-gate-fixture.yml`.

### Archive a release evidence artifact: release-artifact (Phase 47)

Once the gate has run, archive its result as a stable, tamper-evident, content-free **release evidence artifact** — the record a CI job, an incident handoff, or a deployment-approval workflow keeps to answer "what evidence did this build carry when it was promoted, and was that record altered?"

**`pnpm worker:release-artifact`** archives the `worker:release-gate` result (run internally, or supplied via `--release-gate=<file>`) with bounded git/release provenance and an integrity digest:

```
pnpm worker:release-gate --json > gate.json                                      # pre-run the gate
pnpm worker:release-artifact --release-gate=gate.json --label=v1.2.3 \
  --output=release.json --json                                                   # archive it
pnpm worker:release-artifact --verify=release.json                               # confirm integrity
pnpm worker:release-artifact --text                                              # run the gate + summarize
```

Verdict/exit ladder: `0` pass, `1` usage, `2` unknown, `3` warn, `4` fail. The archived **gate verdict is primary** and carries straight through; the one signal the artifact adds is this build's working-tree cleanliness — a **dirty** tree escalates a clean `pass` to `warn` (the recorded commit then does not fully describe the built bytes) and never downgrades a `fail`/`unknown` (a missing gate result is a more honest signal than "ready with a caveat").

| Exit | Verdict | What it means | Do |
| --- | --- | --- | --- |
| `0` | `pass` | The gate passed and provenance is clean. | Archive + promote — subject to the out-of-band caveats. |
| `1` | `usage` | The CLI was misused: a bad flag, an invalid `--label`, or (in `--verify`) an unreadable/non-artifact file. | Fix the invocation; not a build verdict. |
| `2` | `unknown` | The gate result was indeterminate/absent. | Re-run the gate; treat as a non-promotion, never a pass. |
| `3` | `warn` | The gate warned, or the working tree is dirty. | Review; a warn is informational, not a hard block. |
| `4` | `fail` | A blocking gate check failed, or (in `--verify`) the digest did **not** match. | **Block the promotion**, or investigate the altered artifact. |

**Provenance is bounded, never raw.** The artifact records a cleanliness enum (`clean`/`dirty`/`unknown`), a ref **class** (`default`/`release`/`topic`/`detached`/`unknown` — never the raw branch name or remote URL), a validated abbreviated commit hash (a 7–40 char hex object id, capped to 12; anything else → `null`), and an optional operator `--label` (validated to `[A-Za-z0-9._-]{1,64}` and redaction-stable, else a `1` usage error). `--no-vcs` suppresses all git facts (records them `unknown`). The archived gate + any attached `--ops-bundle` summary are re-authored from bounded enums — a hostile input string is dropped.

**The integrity digest is tamper-evidence, not a signature.** `integrity.digest` is a `sha256` over the **canonical** body (recursively key-sorted, minimally-separated JSON — the `pdfxyz-sorted-keys/1` scheme), so a verifier reproduces it from the archived body regardless of pretty-printing. `--verify=<file>` recomputes it offline and confirms it matches; a mismatch (exit `4`) means the archived body was altered. There is no signing key and no attested identity — it proves byte-stability, nothing more.

**An attached `--ops-bundle` is context only.** It reflects a runtime's live ops posture (possibly a different environment during an incident handoff), so it is archived for context and does **not** change the release verdict, which is about THIS build's promotion readiness.

Like the gate, the artifact is local, offline, and read-only: no cloud call, no provider export/secret/bucket, no deletion/upload/mutation, and it does not perform the promotion. It is evidence AGGREGATION + INTEGRITY over content-free data — **not** signing, authentication, cloud validation, deletion proof, or deployment promotion. Run your changed-file secret/NUL scan separately (it records the gate result but does not diff the working tree). The CI example lives at `docs/examples/deployment/github-actions/release-artifact-fixture.yml`; example inputs live under `docs/examples/release-artifact/`.

### Index release evidence artifacts over time: release-index (Phase 48)

Once you archive `pdfxyz.release-artifact/1` records across a CI history, a release train, or an incident timeline, index them into one content-free **retention manifest** — the record a CI archive or an operator retention review keeps to answer "is the whole archive INTACT (does every digest still verify), how much history is retained, and is any of it over-retention or stale?"

**`pnpm worker:release-index`** ingests many artifacts, re-verifies each one's integrity digest, and folds them into a stable manifest:

```bash
pnpm worker:release-index --artifact=a.json --artifact=b.json \
  --max-artifacts=20 --max-age-days=90 --output=release-index.json --json   # build a manifest
pnpm worker:release-index docs/examples/release-index/artifact-*.json --text # summarize an archive
cat artifacts.json | pnpm worker:release-index --text                        # a JSON array on stdin
```

Verdict/exit ladder: `0` ok, `1` usage, `2` insufficient, `3` warn, `4` invalid. The manifest keys on ARCHIVE HEALTH — integrity first, then retention — not a re-judgement of each build's promotion readiness (the archived artifacts already carry that; the manifest tallies it as `verdictCounts`).

| Exit | Verdict | What it means | Do |
| --- | --- | --- | --- |
| `0` | `ok` | ≥1 artifact indexed, every digest re-verified, within retention. | Archive the manifest as a CI/retention record. |
| `1` | `usage` | The CLI was misused: a bad flag, a non-numeric/negative bound, or an unwritable output. | Fix the invocation; not an archive verdict. |
| `2` | `unknown` | The archive is empty/insufficient (no usable artifact was ingested). | Point it at your archived artifacts; nothing to index. |
| `3` | `warn` | A retention concern (over-count, over-age, stale) or a skipped non-artifact input. | Review + prune out of band; the index never prunes. |
| `4` | `invalid` | An indexed artifact FAILED digest re-verification (tampered/corrupt). | **Investigate**; recover the untampered artifact from your CI archive, do not overwrite it. |

**Content-free by construction.** Every ingested artifact is reduced to bounded enums, small counts, coarse age BUCKETS, and short hex digest PREFIXES: it carries no filename, path, object key, bucket, URL, raw ref, raw label (only a `semver`/`named`/`absent` **class**), commit URL, size, or byte, even from a hostile input, and no input path is ever echoed. Retention flags (`--max-artifacts`/`--max-age-days`) only FLAG over-retention/stale — the offline index never deletes, prunes, uploads, or mutates any artifact or object. It is local content-free indexing + digest verification — **not** storage retention enforcement, signing, authentication, cloud validation, or the promotion. The CI example lives at `docs/examples/deployment/github-actions/release-index-fixture.yml`; example inputs + a sample manifest live under `docs/examples/release-index/`.
