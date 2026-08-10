# Deployment blueprint + ops-check scheduler templates

A **provider-neutral, secret-free deployment blueprint** for running the pdf.xyz web app
alongside the out-of-band secure-worker, a Redis-compatible broker, and an optional
ClamAV scanner — plus templates for scheduling the operator healthcheck (Phase 32).

> **This is a blueprint, not a live deployment.** Nothing here was provisioned or run in
> this repo's environment (no reachable Docker daemon, no cloud account, no broker). It
> is a set of validated, copy-and-adapt templates. Actual cloud resources, real secrets,
> the production rollout, and a hosted pager/timeseries backend remain **out-of-band**.

Everything is pinned by offline static tests — `src/deploy/deployment-blueprint.test.ts`
and `src/deploy/scheduler-templates.test.ts` — that parse each file, assert the required
services/commands/placeholders exist, and prove no template leaks a secret, endpoint, real
domain, IP, object key, Redis key, or password. **No test requires Docker or any external
service.**

## Topology

| Service            | Public?           | Image / target                          | Role                                                                               |
| ------------------ | ----------------- | --------------------------------------- | ---------------------------------------------------------------------------------- |
| `web`              | **yes** (`:3000`) | Dockerfile `web` target                 | The Next.js site. Serves users. Ships no engines; takes no provider secret.        |
| `worker`           | no                | Dockerfile `worker` target              | The secure-worker daemon. Drains the queue, runs engines/OCR/scan. Serves no HTTP. |
| `broker` + `redis` | no                | `hiett/serverless-redis-http` + `redis` | **LOCAL-ONLY** self-hosted Redis-REST broker (compose profile `local-broker`).     |
| `clamav`           | no                | `clamav/clamav`                         | **Optional** malware scanner over INSTREAM (compose profile `scanner`).            |

Only `web` publishes a port. The worker, broker, redis, and clamav live on a private
network and are never exposed.

### Why a REST broker shim (honesty note)

The worker's queue client speaks the **Redis REST dialect** (HTTP + bearer token, the
Upstash shape), **not raw RESP**. A bare `redis` container alone therefore cannot serve
it. The `local-broker` profile pairs `redis` with a small REST shim so a laptop can run
the whole stack — but it is a **development convenience**. In production you drop that
profile and point `PDFXYZ_REDIS_REST_URL` at a managed Redis-REST endpoint provisioned
out-of-band.

## Files

| File                                                                   | What it is                                                                                                                      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [`docker-compose.blueprint.yml`](docker-compose.blueprint.yml)         | The full-topology compose blueprint (web + worker + broker + optional clamav), profiles and content-free healthchecks included. |
| [`.env.blueprint.example`](.env.blueprint.example)                     | The `--env-file` for the blueprint — every interpolated variable, placeholders only.                                            |
| [`reverse-proxy/nginx.conf.example`](reverse-proxy/nginx.conf.example) | Optional TLS-terminating proxy fronting **only** `web`.                                                                         |
| [`scheduler/`](scheduler/)                                             | ops-check cron / systemd / notifier templates — see its [README](scheduler/README.md).                                          |

The minimal two-service example (`docker-compose.worker.yml` at the repo root) stays the
canonical **managed-provider** shape; this blueprint is the fuller **self-hostable**
topology that adds the broker and scanner.

## Run it

```bash
# Local dev — everything self-hosted (broker + scanner profiles on):
docker compose -f docs/examples/deployment/docker-compose.blueprint.yml \
  --env-file docs/examples/deployment/.env.blueprint.example \
  --profile local-broker --profile scanner up --build

# Production shape — managed broker/storage provisioned out-of-band, no local broker:
docker compose -f docs/examples/deployment/docker-compose.blueprint.yml \
  --env-file .env up --build web worker
```

## Adapt it safely

1. **Copy the env-file** (`cp .env.blueprint.example .env`) and replace every `REPLACE_*`
   placeholder out-of-band. `.env` is git-ignored; never commit real secrets. All
   variables are server-side only — **never** `NEXT_PUBLIC_*`.
2. **Provision the real broker + storage** (managed Redis-REST + S3/R2 bucket). Point
   `PDFXYZ_REDIS_REST_URL` / `PDFXYZ_S3_*` at them and drop the `local-broker` profile.
3. **Decide on scanning.** Leave `PDFXYZ_MALWARE_SCANNER` unset to keep it off (honest
   no-op), or enable the `scanner` profile and set `PDFXYZ_WORKER_REQUIRE_SCAN=true` to
   fail closed.
4. **Wire heartbeat + ops-check** (see [`scheduler/`](scheduler/)): enable
   `PDFXYZ_WORKER_HEARTBEAT` so `/api/worker/operations` can observe daemon liveness, and
   schedule `pnpm worker:ops-check` with an alert on any non-zero, non-`1` exit.
5. **Smoke before advertising processing** — build the images and run the worker smokes
   (`pnpm worker:smoke`, `worker:image-smoke`, the engine/OCR proofs) per
   [`docs/RUNBOOK.md`](../../RUNBOOK.md). The blueprint wires the seams; it does not prove
   your cloud resources exist.

## Still out-of-band (not faked here)

Actual cloud resources and secrets · the managed Redis-REST/S3 endpoints · the production
rollout and DNS/TLS · a hosted pager and a timeseries/metrics backend · the ClamAV
signature-update cadence. The blueprint shows exactly where each plugs in; it provisions
none of them.
