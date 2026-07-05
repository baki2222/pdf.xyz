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

### Gate a release archive on explicit policy: release-policy (Phase 49)

Once you build a `pdfxyz.release-index/1` manifest, you rarely eyeball it by hand in CI — you assert a **policy** over it and fail closed. `worker:release-policy` answers one question: **"Is this release evidence archive acceptable under our explicit release policy?"** It evaluates a small, explicit set of bounded operator thresholds and routes on the shared ladder.

**`pnpm worker:release-policy`** evaluates a release-index (or an in-process index of raw artifacts) against the policy flags:

```bash
# Gate a pre-built index (the CI flow: release-index → release-policy)
pnpm worker:release-policy --index=release-index.json \
  --require-clean --require-latest-ok --max-invalid=0 --max-fail=0 --min-artifacts=1 --max-age-bucket=7-30d --max-warn=2 --json
# Strongest mode: index raw artifacts in-process (re-hashing every digest), then gate
pnpm worker:release-policy --artifact=a.json --artifact=b.json --require-clean --min-artifacts=2
cat release-index.json | pnpm worker:release-policy --require-clean --text   # a release-index on stdin
```

Verdict/exit ladder: `0` pass, `1` usage, `2` unknown, `3` warn, `4` fail. Policy assertions come in two severities — **blocking** (`--require-clean`, `--require-latest-ok`, `--max-invalid=N`, `--max-fail=N`, `--min-artifacts=N`, `--max-artifacts=N`, `--max-age-bucket=<bucket>`) escalate to `fail`; **warning-only** (`--max-warn=N`, `--max-skipped=N`, `--forbid-over-retention`) escalate at most to `warn`. An unset flag asserts nothing.

| Exit | Verdict | What it means | Do |
| --- | --- | --- | --- |
| `0` | `pass` | A valid, consistent, untampered, non-empty index met every configured assertion. | Proceed; wire your real promotion/approval after it. |
| `1` | `usage` | The CLI was misused: a bad flag, a bad bound/bucket, both `--index` and `--artifact`, or an unwritable output. | Fix the invocation; not a policy verdict. |
| `2` | `unknown` | No readable release-index was provided, or the archive is empty (zero indexed artifacts). | Treat as a setup error, never a pass; point it at your archived index/artifacts. |
| `3` | `warn` | A warning-only assertion was violated (a non-blocking concern). | Review the `violations` + remediation; decide whether to proceed. |
| `4` | `fail` | A blocking assertion was violated, OR the index is malformed / internally inconsistent / reports a tampered artifact. | **Do not promote**; resolve the named violation. Recover an untampered index from your CI archive if invalid. |

**Fail closed on a tampered index.** In `--index` mode the policy TRUSTS the index's self-reported bounded counts, but it re-checks the manifest against ITSELF: it recomputes the archive-health verdict from the index's own counts (via the same `worker:release-index` rollup) and rejects an index whose counts or rollup are inconsistent (`invalid-index` → `fail`), and it rejects a valid index that honestly reports a tampered artifact inside (`index-tampered` → `fail`) — regardless of which flags were set. To re-hash the artifacts themselves, use `--artifact` mode, which builds the index in-process and re-verifies every digest. **Content-free by construction.** The ingested index is reduced to bounded enums, small counts, and coarse age buckets; the result carries no filename, path, object key, bucket, URL, raw ref, raw label, commit URL, size, or byte, even from a hostile input, and no input path is ever echoed. It is local bounded policy evaluation over content-free evidence — **not** signing, authentication, cloud validation, storage retention enforcement, or the promotion; a `pass` authorizes nothing on its own. The CI workflow example lives at `docs/examples/deployment/github-actions/release-policy-fixture.yml`; example index fixtures live under `docs/examples/release-policy/`.

### Bundle the whole chain for CI/handoff: release-ci-bundle (Phase 50)

At the end of a release job you have four content-free stage outputs (a gate, an artifact, an index, a policy result). Rather than eyeball each, you **bundle** them: `worker:release-ci-bundle` composes whichever you supply into ONE handoff record and answers **"What did the chain decide end-to-end, do the stages AGREE, what should I archive, and what is the next safe action?"** It runs no stage itself — it ingests the outputs and re-verifies them.

**`pnpm worker:release-ci-bundle`** composes the stage outputs and re-verifies six consistency links:

```sh
# The final CI step: gate → artifact → index → policy → CI BUNDLE
pnpm worker:release-gate --json > gate.json || true
pnpm worker:release-artifact --release-gate=gate.json --output=artifact.json --json
pnpm worker:release-index --artifact=artifact.json --output=index.json --json
pnpm worker:release-policy --index=index.json --require-clean --min-artifacts=1 --output=policy.json --json
pnpm worker:release-ci-bundle --release-gate=gate.json --release-artifact=artifact.json \
  --release-index=index.json --release-policy=policy.json --json   # → pass (exit 0) if coherent
```

**Fail closed on disagreement.** The bundle reduces each stage to bounded facts, then evaluates six BLOCKING links: `artifact-digest` re-hashes the artifact's integrity digest; `index-self-consistent` and `policy-self-consistent` recompute each stage's verdict from its own counts (a flipped `rollup.verdict` cannot smuggle a tampered stage past the bundle); `gate-artifact-agreement` confirms the artifact archived the same gate decision; `artifact-index-inclusion` confirms the artifact is a verified entry in the index; and `index-policy-agreement` confirms the policy was evaluated over that index. A stage `fail` OR any link `mismatch` (two stages describing different evidence — a tamper or a stale/mixed input) is `fail` (exit `4`). An unreadable / indeterminate stage, or a chain with no archive-decision stage (only a gate/artifact, no index/policy), is `unknown` (exit `2`, never a pass). An advisory stage verdict is `warn` (exit `3`). **Content-free by construction.** Every stage is reduced to bounded enums, small counts, and booleans; the result carries no filename, path, object key, bucket, URL, raw ref, raw label, commit URL, size, digest, or byte, even from a hostile input, and no input path is ever echoed. It is local content-free bundling + consistency checking over evidence — **not** signing, authentication, cloud validation, storage retention enforcement, or the promotion; a `pass` authorizes nothing on its own. The CI workflow example lives at `docs/examples/deployment/github-actions/release-ci-bundle-fixture.yml`; example stage fixtures live under `docs/examples/release-ci-bundle/`.

### Compare bundles across releases: release-audit (Phase 51)

The CI bundle answers *"did this ONE build's chain cohere?"* The **release audit** closes the loop OVER TIME: `worker:release-audit` ingests two (or a history of) content-free `pdfxyz.release-ci-bundle/1` bundles — a **baseline** (the last accepted release) and a **current** (this release) — and answers **"did this release's evidence posture REGRESS versus the baseline, and what is the next safe action?"** It runs no stage or bundle itself; it ingests bundles `worker:release-ci-bundle` already produced and DIFFS their bounded postures.

**`pnpm worker:release-audit`** takes `--baseline=<path> --current=<path>` (pair mode), or a chronological `--bundle=<path>` list / a `--stdin` JSON array (history mode — the newest bundle is the current release, the one before it the baseline, plus a trend over the whole list):

```sh
# Keep the previous release's bundle as the baseline; audit the current build's bundle against it.
pnpm worker:release-audit --baseline=previous-bundle.json --current=release-ci-bundle.json --json
```

**Re-validate, then diff.** Each ingested bundle is UNTRUSTED (a CI archive, a committed baseline, a hand-crafted file): the audit re-derives each bundle's Phase 50 rollup from the bundle's OWN stages + consistency links and treats a recognized bundle whose recorded verdict does not re-derive as **tampered** (`fail`, exit `4`), and a not-a-bundle input as **unreadable** (`unknown`, exit `2`, never a "no regression"). Over two usable bundles it evaluates a closed set of regression checks — `verdict-worsened`, `consistency-broke` (a held link now mismatches), `consistency-weakened` (a held link now skipped), `coverage-dropped` (a stage present in the baseline is gone), `archive-decision-worsened`, and `warnings-increased` — a blocking regression is `fail` (exit `4`), an advisory drift is `warn` (exit `3`), and no regression is `pass` (exit `0`). **Diff-only honesty:** a `pass` means the current bundle did not regress versus the baseline, NOT that it is itself acceptable — gate the current bundle on its own (`worker:release-ci-bundle` / `worker:release-policy`) too; two bundles that are BOTH failing show "no regression" here. **Accept an expected drift deliberately** with `--allow-warn-regression` (or raise `--max-new-warnings=N`) and archive the audit as the record of that decision; escalate a drop to an uncertified (`unknown`) posture to blocking with `--fail-on-unknown`. **Content-free by construction:** every bundle is reduced to bounded enums, small counts/deltas, and booleans; the result carries no filename, path, object key, bucket, URL, raw ref, raw label, commit URL, size, digest, or byte, even from a hostile bundle, and no input path is ever echoed. It is local content-free audit/diff over evidence — **not** signing, authentication, cloud validation, storage retention enforcement, or the promotion. Wire it as an OPTIONAL regression gate AFTER `worker:release-ci-bundle` (fail the job on exit `4`, surface exit `3` for review, treat exit `2` as a setup error). The CI workflow example lives at `docs/examples/deployment/github-actions/release-audit-fixture.yml`; example baseline/current bundle fixtures live under `docs/examples/release-audit/`.

### Report the operator recommendation for CI/handoff: release-report (Phase 52)

The bundle answers *"did this build's chain cohere?"* and the audit *"did it regress?"* — but an operator at a CI summary, a deployment review, or an incident handoff still has to READ them and decide. The **release report** answers that decision directly: `worker:release-report` ingests whichever of the content-free `pdfxyz.release-ci-bundle/1` (`--bundle`) and/or `pdfxyz.release-audit/1` (`--audit`) a release job produced, re-validates each against itself, and folds them into ONE operator recommendation — **"what should I DO now, based only on the content-free release evidence — is this release promote-ready, should it be held, or is the evidence insufficient?"** It runs no stage / bundle / audit itself; it ingests documents the earlier tools already produced.

**`pnpm worker:release-report`** takes `--bundle=<path>` and/or `--audit=<path>` (at least one; either may be `-` to read that document from stdin):

```sh
# The FINAL CI-summary / handoff step: compose the bundle (+ optional audit) into an operator report.
pnpm worker:release-report --bundle=release-ci-bundle.json --audit=release-audit.json --text >> "$GITHUB_STEP_SUMMARY"
```

**Recommend, fail-closed.** Each document is UNTRUSTED (a CI archive, a hand-crafted file): the report re-derives each one's Phase 50/51 rollup from its OWN recorded facts (reusing the upstream reducers) and treats a recorded verdict that does not re-derive as a **tamper** (`hold-fail`, exit `4`). It folds the two sources with fail-closed precedence: a tamper / a failed bundle / a blocking audit regression is `hold-fail` (exit `4`); an unreadable / indeterminate document, or **no usable bundle at all**, is `needs-evidence` (exit `2`); an advisory bundle warn / audit drift is `hold-warning` (exit `3`); a usable bundle that PASSED (and an audit, if any, with no regression) is `promote-ready` (exit `0`). **The load-bearing honesty:** a `promote-ready` REQUIRES a usable bundle whose own verdict is `pass` — an audit only reports *no regression versus a baseline*, never that the current release is acceptable, so an **audit-only** (or bundle-absent) run is `needs-evidence`, never a promote. `--strict` escalates an advisory-only posture to `hold-fail` (warnings treated as a hold). The report emits an evidence-coverage summary, per-source summaries, the bounded rationale ids, an archive checklist (which content-free files to keep), and an ordered next-action checklist. **Content-free by construction:** every document is reduced to bounded enums, small counts, and booleans; the result carries no filename, path, object key, bucket, URL, raw ref, raw label, commit URL, size, digest, or byte, even from a hostile input, and no input path is ever echoed. It is local content-free reporting over evidence — **not** signing, authentication, cloud validation, storage retention enforcement, deployment approval, or the promotion. Wire it as the FINAL CI-summary / handoff step AFTER `worker:release-ci-bundle` (render `--text` into `$GITHUB_STEP_SUMMARY`, fail the job on exit `4`, surface exit `3` for review, treat exit `2` as a setup error). The CI workflow example lives at `docs/examples/deployment/github-actions/release-report-fixture.yml`; example bundle/audit fixtures live under `docs/examples/release-report/`.

### Summarize the recent posture trend for governance: release-trend (Phase 53)

The report answers *"what should I do about THIS release?"* — but a weekly / monthly release-governance review asks a different question: *"how is the recent trend, across the last N releases?"* The **release trend** answers that: `worker:release-trend` ingests a bounded HISTORY of the content-free `pdfxyz.release-report/1` reports a release pipeline archived, re-validates each against itself, and folds them into ONE governance verdict — **"how has release evidence posture changed over the recent report history, and what follow-up is warranted?"** It runs no gate / bundle / audit / report itself; it summarizes reports the earlier tools already produced. It is a scheduled governance summary, **not** a per-release gate.

**`pnpm worker:release-trend`** takes repeated `--report=<path>` / `--file=<path>` (chronological, oldest first / newest last), or a `--stdin` JSON array of reports:

```sh
pnpm worker:release-trend --report=reports/r1.json --report=reports/r2.json --report=reports/r3.json --text >> "$GITHUB_STEP_SUMMARY"
```

**Summarize, fail-closed.** Each report is UNTRUSTED (a CI archive, a hand-crafted file): the trend re-derives each report's Phase 52 recommendation from its OWN recorded sources + strict flag (reusing `computeReportRecommendation`) and treats a recorded recommendation that does not re-derive as a **tamper** (`failing`, exit `4`). It applies the `--max-reports` window cap (surfacing how many older reports were dropped) and folds the bounded history with fail-closed precedence: a tampered report / a `hold-fail` newest / a breached `--max-hold-fail` / a required-not-ready tip is `failing` (exit `4`); an unreadable report / an empty history / a `needs-evidence` newest is `unknown` (exit `2`); a `hold-warning` newest / a breached `--max-hold-warning` / a degraded posture is `warning` (exit `3`); a clean window is `stable` (exit `0`). **The load-bearing honesty:** the NEWEST usable report is authoritative — a `hold-fail` tip fails the trend even within a tolerated threshold (thresholds tolerate only HISTORICAL noise), and a `stable` trend requires a clean window (a promote-ready tip, no tamper, no breached threshold), never a fabrication from thin / untrusted history. The trend emits the recommendation distribution, a per-report posture sequence, the bounded reason ids, and an ordered follow-up checklist. **Content-free by construction:** every report is reduced to bounded enums, small counts, and booleans; the result carries no filename, path, object key, bucket, URL, raw ref, raw label, commit URL, size, digest, or byte, even from a hostile input, and no input path or ingested report stamp is ever echoed. It is local content-free trend reporting over evidence reports — **not** signing, authentication, cloud validation, storage retention enforcement, deployment approval, or the promotion. Wire it as a SCHEDULED governance summary over your archived per-release reports (render `--text` into a review artifact / `$GITHUB_STEP_SUMMARY`, fail the review on exit `4`, surface exit `3` for review, treat exit `2` as a coverage gap). Small policy knobs: `--max-reports=N`, `--max-hold-warning=N`, `--max-hold-fail=N`, `--require-latest-ready`. The CI workflow example lives at `docs/examples/deployment/github-actions/release-trend-fixture.yml`; example report fixtures live under `docs/examples/release-trend/`.

### Bundle the review window for governance: release-governance (Phase 54)

The trend answers *"how is the recent trend?"* — but a weekly / monthly governance review wants ONE archivable record that folds the window-level trend together with the LATEST point-in-time evidence: *"what is the governance posture for this review window, what should be archived, and what follow-up should be assigned?"* The **release governance bundle** answers that: `worker:release-governance` ingests a content-free `pdfxyz.release-trend/1` window summary (the PRIMARY signal) plus, optionally, the latest `pdfxyz.release-report/1` and/or `pdfxyz.release-audit/1`, re-validates each against itself, cross-checks the latest report against the trend's newest report, and folds them into ONE governance verdict + archive / follow-up checklists. It runs no gate / bundle / audit / report / trend itself; it composes documents the earlier tools already produced. It is a scheduled governance-review record, **not** a per-release gate.

**`pnpm worker:release-governance`** takes `--trend=<path>` (primary) plus optional `--report=<path>` / `--audit=<path>` (any value may be `-` for stdin, at most one):

```sh
pnpm worker:release-governance --trend=trend.json --report=latest-report.json --audit=latest-audit.json --text >> "$GITHUB_STEP_SUMMARY"
```

**Compose, fail-closed.** Each document is UNTRUSTED (a CI archive, a hand-crafted file): the report source re-runs the Phase 52 recommendation reducer, the audit source re-runs the Phase 51 audit rollup, and the trend source reconstructs the trend's OWN per-report points and re-runs the Phase 53 `reduceTrend` + `computeTrendRollup`, treating a recorded verdict that does not re-derive as a **tamper** (`blocked`, exit `4`). It folds the three sources with fail-closed precedence: a tampered document / a `failing` trend / a `hold-fail` report / a blocking audit regression is `blocked` (exit `4`); an absent / unreadable / `unknown` trend / an indeterminate latest / a required-but-missing document is `incomplete` (exit `2`); a `warning` trend / a `hold-warning` report / an audit drift / a report ↔ trend drift is `watch` (exit `3`); a coherent window is `healthy` (exit `0`). **The load-bearing honesty:** the PRIMARY trend is required for a healthy window — a latest report / audit can BLOCK or FLAG but can never GRANT a healthy on its own (a trend-absent run is `incomplete`, never a fabricated healthy). The bundle emits the evidence coverage, per-source summaries, the bounded reason ids, an archive checklist, and an ordered follow-up assignment list. **Content-free by construction:** every document is reduced to bounded enums, small counts, and booleans; the result carries no filename, path, object key, bucket, URL, raw ref, raw label, commit URL, size, digest, or byte, even from a hostile input, and no input path or ingested document stamp is ever echoed. It is local content-free governance bundling over evidence summaries — **not** signing, authentication, cloud validation, storage retention enforcement, deployment approval, or the promotion. Wire it as a SCHEDULED governance-review artifact over your archived trend + latest report / audit (render `--text` into a review artifact / `$GITHUB_STEP_SUMMARY`, fail the review on exit `4`, surface exit `3` for review, treat exit `2` as a coverage gap). Small policy knobs: `--require-report`, `--require-audit`, `--strict-watch`. The CI workflow example lives at `docs/examples/deployment/github-actions/release-governance-fixture.yml`; example fixtures live under `docs/examples/release-governance/`.

## Release evidence archive pack

Use `pnpm worker:release-archive --governance=<governance.json> [--trend=<trend.json>] [--report=<report.json>] [--audit=<audit.json>] [--bundle=<bundle.json>]` during a periodic review when you need one content-free archive manifest for the evidence records to keep together. Exit `0` (`archivable`) means the primary governance bundle is healthy and supplied related records are clean/coherent. Exit `3` (`archive-watch`) means archive with follow-up. Exit `2` (`archive-incomplete`) is missing/unusable required evidence. Exit `4` (`archive-blocked`) is tamper/blocking evidence. Treat the output as an index/checklist, not as approval, signing, upload, immutable retention, or raw-file packing.

## Release evidence restore drill

Use `pnpm worker:release-restore-drill --archive=<archive.json> [--governance=<governance.json>] [--trend=<trend.json>] [--report=<report.json>] [--audit=<audit.json>] [--bundle=<bundle.json>]` as a scheduled disaster-recovery / review drill: RESTORE an archived `pdfxyz.release-archive/1` pack (and, ideally, the underlying records it indexed) from your archive store to a scratch dir, then hand them here to prove they can be re-validated and trusted. The drill re-derives the pack's own rollup (a hand-flip is caught as a tamper) and cross-checks each restored record's posture against what the pack recorded. Exit `0` (`restore-verified`) means the pack is archivable, every restored record matched, and a restore was exercised (or `--archive-only` scoped the drill to the pack). Exit `3` (`restore-drift`) is an advisory (a watch pack, or an out-of-band restored record). Exit `2` (`restore-incomplete`) is an unreadable/incomplete pack, an unreadable restored record, a required record not restored (`--require-full-restore`), or nothing restored. Exit `4` (`restore-failed`) is a tampered pack, a blocked archive, a restore mismatch, or a corrupt restore. It fetches nothing (you restore the files out of band) and it approves/signs/uploads/promotes nothing; treat a `restore-verified` as DR evidence, not authorization.

## Release evidence publish / handoff pack

Use `pnpm worker:release-publish-pack --governance=<governance.json> [--archive=<archive.json>] [--restore-drill=<drill.json>] [--report=<report.json>] [--trend=<trend.json>]` when you need to hand a release-evidence package to someone OUTSIDE the release loop — an external reviewer, an internal approver, an investor/partner, or an incident responder. It composes the content-free `pdfxyz.release-governance/1` bundle (PRIMARY) plus the related archive/restore-drill/report/trend records into ONE `pdfxyz.release-publish-pack/1` manifest with a publish verdict, a DISCLOSURE CLASSIFICATION, and a handoff checklist. It re-derives each document's own rollup (a hand-flip is caught as a tamper) and reduces everything to bounded verdicts + counts. Exit `0` (`publishable`, disclosure `share-safe`) means the governance bundle is `healthy` and every supplied source is clean — the manifest may be handed to the external party. Exit `3` (`review`, disclosure `internal-review`) is an advisory (a watch governance, an archive-watch pack, a restore-drift drill, a hold-warning report, or a warning trend) — share internally / with a reviewer first. Exit `2` (`incomplete`, disclosure `internal-review`) is an absent/unreadable/incomplete governance bundle, an indeterminate source, or a required-but-missing document (`--require-archive`/`--require-restore-drill`) — a governance-absent run is NEVER a vacuous share-safe pack. Exit `4` (`blocked`, disclosure `blocked`) is a tampered document, a blocked governance, a failed restore drill, a hold-fail report, or a failing trend — do NOT share. `--strict` escalates any non-`publishable` posture to `blocked` (a hard "share-safe or do not share" gate). It publishes/shares/sends/signs/approves/promotes NOTHING — you perform the actual handoff out of band; treat a `share-safe` classification as a recommendation over the evidence, not an approval or an authorization.

## Release evidence handoff acknowledgement receipt

Use `pnpm worker:release-ack --publish-pack=<publish-pack.json> --decision=<decision> [--reviewer=<class>] [--note=<class>]` after a `pdfxyz.release-publish-pack/1` is handed off (or received) to record a bounded ACKNOWLEDGEMENT of it — a local, content-free counterpart to a return receipt. It re-validates the pack against itself (a hand-flip is caught as a tamper), applies the required decision, and emits ONE `pdfxyz.release-ack/1` receipt with an acknowledgement verdict, a bounded source summary (the pack's own verdict/disclosure/source counts), the recorded decision/reviewer class/note class, and a next-action checklist. Exit `0` (`acknowledged`) means an `accepted` decision over a usable `publishable` pack with no note — the package was accepted clean. Exit `3` (`acknowledged-with-followup`) is `accepted-with-notes`, a `review` pack, or a note class — acknowledged, track the follow-up. Exit `2` (`deferred`) is a `deferred` decision or an `incomplete` pack — revisit after the evidence/decision is complete. Exit `4` (`rejected`) is a `rejected`/`needs-changes` decision, a `blocked` pack, or a `--strict` violation — do NOT proceed. Exit `4` (`invalid`) is a missing/unreadable/tampered pack — the input can't be trusted, never a vacuous pass. `--strict` escalates any follow-up/deferral to `rejected` (only `accepted` over a `publishable` pack passes). It is an acknowledgement RECEIPT ONLY — it signs/approves/publishes/promotes/notifies NOTHING; obtain any required external signature/approval/legal sign-off out of band, and treat an `acknowledged` verdict as a recorded acceptance of a share-safe pack, not an approval or a promotion. The reviewer is a bounded CLASS (a role), never an identity.

## Release decision record ledger

Use `pnpm worker:release-decision --publish-pack=<publish-pack.json> --ack=<release-ack.json>` after a `pdfxyz.release-publish-pack/1` has been acknowledged (`pdfxyz.release-ack/1`) to record the final release DECISION — the ledger entry that closes the loop. It re-validates each document against itself (a hand-flip is caught as a tamper), CROSS-CHECKS that the acknowledgement's recorded source-pack summary matches the supplied pack (verdict/disclosure/source count), and emits ONE `pdfxyz.release-decision/1` record with a bounded decision, per-source summaries, the cross-check status, and a next-action checklist. Exit `0` (`proceed`) means a usable `publishable`/share-safe pack acknowledged by a clean `accepted` decision with a `match` cross-check — the release may proceed (out of band). Exit `3` (`proceed-with-followup`) is a share-safe pack accepted with a recorded follow-up (an `accepted-with-notes` decision, an `acknowledged-with-followup` acknowledgement, or a note class) — proceed, track the follow-up. Exit `3` (`hold`) is a `review`/internal-review pack — hold and review internally before proceeding. Exit `2` (`insufficient`) is an `incomplete` pack or a `deferred` acknowledgement — complete the evidence or resolve the deferral. Exit `4` (`reject`) is a `rejected`/`needs-changes` acknowledgement or a `blocked` pack — do NOT proceed. Exit `4` (`invalid`) is a missing/unreadable/tampered document, or a cross-check `mismatch` (the acknowledgement acknowledged a DIFFERENT pack than the one supplied) — the pair can't be trusted, never a vacuous pass. `--strict` escalates any follow-up/hold/insufficiency to `reject` (only a clean `accepted` over a `publishable` pack proceeds). It is a decision RECORD ONLY — it signs/approves/publishes/promotes/deploys/notifies NOTHING; obtain any required external signature/approval/legal sign-off and perform the actual promotion/deployment out of band, and treat a `proceed` decision as a recorded posture, not an approval or an authorization.

## Release decision ledger index

Use `pnpm worker:release-decision-index --file=<decision.json> [--file=...]` (repeatable, oldest first / newest last, or `--stdin` for a JSON array / NDJSON stream / single record) to INDEX a bounded BATCH of `pdfxyz.release-decision/1` records (the Phase 59 ledger entries) into ONE review summary — a sprint / month of release decisions, reviewed at once. It re-validates each record against itself (re-deriving its Phase 59 decision, so a hand-flip is caught as a tamper), and emits ONE `pdfxyz.release-decision-index/1` document with the decision distribution, per-source cross-check posture counts, a per-record posture sequence, an index verdict + bounded reasons, a trend class, and a next-action checklist. Exit `0` (`stable`) means a clean batch — every usable record decided a clean `proceed`, no tampered / unreadable record. Exit `3` (`watch`) is an advisory batch — a `proceed-with-followup` or `hold` decision is present; review and track the follow-up. Exit `2` (`insufficient`) is an inconclusive batch — zero usable records, or an `insufficient` decision; complete the evidence and re-decide. Exit `4` (`blocked`) is a blocking decision — a `reject` or `invalid` decision, or a `--strict` violation; do NOT treat the batch as clean. Exit `4` (`invalid`) is an untrustworthy INPUT — an unreadable / tampered record; recover the record before relying on the batch (it dominates — never a vacuous stable). `--max-records=N` caps the newest N records (older records are dropped from the window; the count dropped is surfaced); `--strict` escalates any advisory / insufficiency to `blocked`. It is a ledger INDEX SUMMARY ONLY — it is NOT a legal audit log, a compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger, and it signs / approves / publishes / promotes / deploys / notifies / mutates NOTHING; keep each of those systems of record separately, and treat a `stable` index as a recorded review posture over the content-free decisions supplied on THIS host, not an approval or an authorization.


## Release decision index trend

Use `pnpm worker:release-decision-trend --file=<window.json> [--file=...]` (repeatable, oldest first / newest last, or `--stdin` for a JSON array / NDJSON stream / single window) to SUMMARIZE a bounded HISTORY of `pdfxyz.release-decision-index/1` windows (the Phase 60 ledger-index summaries) into ONE governance trend — a quarter / year of decision-index windows, reviewed at once. It re-validates each window against itself (re-deriving its Phase 60 index verdict from its own ledger counts AND re-checking those counts against the window's own sequence, so a hand-flip — or a lied count consistent with it — is caught as a tamper), and emits ONE `pdfxyz.release-decision-trend/1` document with the per-window index-verdict distribution, the aggregate decision distribution, a per-window posture sequence, an arc direction (from ordered input positions, never a timestamp), a trend class, a trend verdict + bounded reasons, and a next-action checklist. Exit `0` (`improving`/`stable`) means a clean history — every usable window a clean `stable` index, no tampered / unreadable window (`improving` when the latest window recovered to clean over an earlier worse one). Exit `3` (`watch`/`degrading`) is an advisory or worsening history — a `watch` / `insufficient` window is present (flat = `watch`, latest-worse-than-earliest = `degrading`); review what changed. Exit `2` (`insufficient`) is an inconclusive history — zero usable windows, or an only-`insufficient` history; complete the missing evidence and re-index. Exit `4` (`blocked`) is a blocking window — a `blocked` / `invalid` index, or a `--strict` violation; do NOT treat the history as clean. Exit `4` (`invalid`) is an untrustworthy INPUT — an unreadable / tampered window; recover the window before relying on the history (it dominates — never a vacuous pass). `--max-windows=N` caps the newest N windows (older windows are dropped from the history; the count dropped is surfaced); `--strict` escalates any non-stable window to `blocked`. It is a ledger-index TREND SUMMARY ONLY — it is NOT a legal audit log, a compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger, and it signs / approves / publishes / promotes / deploys / notifies / mutates NOTHING; keep each of those systems of record separately, and treat a `stable` / `improving` trend as a recorded review posture over the content-free windows supplied on THIS host, not an approval or an authorization.

Use `pnpm worker:release-decision-action-plan --trend=<trend.json>` (alias `--file=`, or `--stdin` for one JSON trend document) to TRANSLATE ONE `pdfxyz.release-decision-trend/1` summary (the Phase 61 governance trend) into ONE bounded operator follow-up plan — the "what do I do next, and how urgently?" step after a trend review. It re-validates the trend against itself (re-deriving its Phase 61 trend verdict from its own window-verdict summary AND re-checking that summary against the trend's own per-window sequence, so a hand-flip — or a lied distribution consistent with it — is caught as a tamper), and emits ONE `pdfxyz.release-decision-action-plan/1` document with a plan verdict, an urgency, an action class, the surfaced source trend verdict/class/arc, an ordered next-action checklist, and a receipt. Exit `0` (`clear`) is a clean stable trend — no follow-up beyond the cadence; exit `0` is also a benign `monitor` (an `improving` trend — confirm the recovery is sustained). Exit `3` (`monitor`) is a follow-up — a `watch` trend (`review-followups`, track the advisory) or a `degrading` trend (`stabilize-regression`, investigate the worsening arc). Exit `2` (`investigate`) is an `insufficient` trend — complete the missing decision evidence and re-summarize (`restore-evidence`). Exit `4` (`block-release`) is a `blocked` trend (`block-and-reconcile`, hold promotion + reconcile) or an `invalid` trend (`restore-evidence`, recover the untrustworthy window); exit `4` (`invalid`, `reject-input`) is an untrustworthy INPUT — an unreadable / tampered trend document; recover a valid trend before relying on it (it dominates — never a vacuous clear plan). `--max-actions=N` caps the emitted checklist to the highest-priority N (default 8 / hard max 20; the count dropped is surfaced); `--strict` escalates any non-clear plan to `block-release`, but never fabricates approval for a clear trend. It is a content-free operational follow-up plan ONLY — it is NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log, and it signs / approves / publishes / promotes / deploys / notifies / mutates NOTHING; keep each of those systems of record separately, and treat a `clear` plan as a bounded follow-up posture over the content-free trend supplied on THIS host, not an approval or an authorization.

Use `pnpm worker:release-decision-action-receipt --plan=<plan.json>` (alias `--file=`, or `--stdin` for one JSON plan document) to RECORD whether ONE `pdfxyz.release-decision-action-plan/1` follow-up plan (the Phase 62 operator plan) was closed out — the "did the operator actually do the plan's follow-ups?" step after a plan review. It re-validates the plan against itself (reconstructing its Phase 62 decision from the source-trend details the plan recorded and re-running the Phase 62 `computeActionPlan` reducer, so a hand-flip of the plan verdict / action class / exit code is caught as a tamper), folds the plan's coarse class against the bounded operator acknowledgement flags supplied, and emits ONE `pdfxyz.release-decision-action-receipt/1` document with a receipt verdict, the resolved plan class, an acknowledgement checklist, bounded reasons, and a receipt. Supply the acknowledgements an operator ACTUALLY performed (booleans only — no note or actor name): `--ack-plan` (reviewed the plan), `--ack-followups` (worked the checklist), `--ack-monitor` / `--ack-investigation` (tracked the class follow-up), `--ack-block` (release remains BLOCKED, not promoted). Exit `0` (`completed`) is a usable plan whose class's required acknowledgements are all present. Exit `2` (`incomplete`) is a missing / unreadable plan, or a missing required acknowledgement (the plan was not exercised, or a block plan is held-blocked but a non-critical ack is missing). Exit `3` (`followup-open`) is an advisory follow-up still open for a monitor / investigate plan — track it to closure. Exit `4` (`blocked`) is a tampered plan, a block plan not acknowledged as held-blocked, a contradictory acknowledgement (a class ack that does not match the plan class), or a `--strict-open` escalation of an open follow-up. `--strict-open` escalates any open follow-up to a hard block — a "closed-out or blocked" gate. It is a content-free operational execution receipt ONLY — it is NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log, and it signs / approves / publishes / promotes / deploys / notifies / mutates NOTHING; keep each of those systems of record separately, and treat a `completed` receipt as a bounded execution posture over one content-free plan on THIS host, not an approval or an authorization.

Use `pnpm worker:release-decision-closeout --receipt=<receipt.json>` (alias `--file=`, or `--stdin` for one JSON receipt document) to CLOSE OUT the whole release DECISION governance chain in ONE record — the "is this decision chain done, or still open / incomplete / blocked?" step after the execution receipt. Hand it the ONE `pdfxyz.release-decision-action-receipt/1` receipt (the Phase 63 receipt; required) plus any related records you already have — `--plan` (the plan the receipt receipted), `--trend` (the trend the plan folded), `--decision` / `--index` (the ledger records upstream). It re-validates the primary receipt against itself (reconstructing its Phase 63 decision from the source facets the receipt recorded and re-running the Phase 63 `computeReceipt` reducer, so a hand-flip of the receipt verdict / ack coverage / exit code is caught as a tamper), cross-checks the supplied plan / trend against what the receipt recorded, folds the decision / index records' own bounded posture as a source-chain signal, and emits ONE `pdfxyz.release-decision-closeout/1` document with a closeout verdict, the primary receipt's state + verdict, a related-record checklist, bounded reasons, and a receipt. Exit `0` (`closed`) is a usable receipt whose OWN verdict is `completed` with every supplied related record coherent. Exit `2` (`closeout-incomplete`) is a missing / unreadable primary receipt, an `incomplete` receipt, a missing required related record (`--require-plan` / `--require-trend` / `--require-decision` / `--require-index`), or an inconclusive source chain. Exit `3` (`closeout-open`) is a `followup-open` receipt, or an advisory decision / index record — track it to closure. Exit `4` (`closeout-blocked`) is a tampered / `blocked` receipt, a supplied plan / trend that contradicts the receipt, a tampered related record, a blocked source chain (a `reject` / `invalid` decision or a `blocked` / `invalid` index upstream), or a `--strict-open` escalation. `--strict-open` escalates any open closeout to a hard block — a "closed or blocked" gate. Supply the SAME records this receipt's chain was built from — never a newer / different window; a cross-check mismatch fails closed. It is a content-free operational closeout SUMMARY ONLY — it is NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log, and it signs / approves / publishes / promotes / deploys / notifies / mutates NOTHING; keep each of those systems of record separately, and treat a `closed` closeout as a bounded governance posture over the content-free records supplied on THIS host, not an approval or an authorization.
