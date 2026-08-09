# Rate limiting — turning it on

Everything is built. The guard, seven policies, the Redis provider, the boot
hook, and 14 test files all exist and pass. It is **switched off**, because
`PDFXYZ_RATE_LIMIT_PROVIDER` is unset and unset means `disabled`.

Turning it on is three environment variables and a redeploy. Two of them are
secrets, so they have to be pasted by a person with the Upstash account — no
part of this repository or its tooling reads, stores, or transmits them.

---

## What is already enforced the moment it is on

| Policy | Limit | Window |
| --- | --- | --- |
| `uploads.create` | 60 | per hour |
| `jobs.create` | 60 | per hour |
| `jobs.delete` | 60 | per hour |
| `jobs.status` | 120 | per minute |
| `artifacts.fetch` | 120 | per minute |
| `worker.status` | 120 | per minute |
| `worker.operations` | 120 | per minute |

Per client, identified from the request. A refused request gets `429` with a
`Retry-After`, not a silent drop.

---

## Step 1 — create an Upstash Redis database

<https://console.upstash.com> → **Create Database**. The free tier is ample:
these are short fixed windows holding one counter per client per policy.

Pick a **region close to the Vercel deployment** — every guarded request costs
one round trip to this store, so distance here is latency on every API call.

From the database page, copy the two values under **REST API**:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Copy them straight from Upstash into Vercel. Do not paste them into a chat, a
commit, a screenshot, or a file in this repository.

---

## Step 2 — add three variables on Vercel

Project → **Settings** → **Environment Variables**. Set the scope to
**Production only** — not Preview, not Development. (Preview builds share the
production storage config; giving them the same rate-limit store would let
preview traffic consume the production budget.)

| Name | Value |
| --- | --- |
| `PDFXYZ_RATE_LIMIT_PROVIDER` | `redis` |
| `PDFXYZ_RATE_LIMIT_REDIS_REST_URL` | the Upstash REST URL |
| `PDFXYZ_RATE_LIMIT_REDIS_REST_TOKEN` | the Upstash REST token |

Only the first is written out here because only the first is not a secret.

**Optional, and deliberately left alone:**

- `PDFXYZ_RATE_LIMIT_KEY_PREFIX` — defaults to `pdfxyz`. Set it only if the same
  Upstash database is shared with something else.
- `PDFXYZ_RATE_LIMIT_FAIL_MODE` — defaults to `open`. **Leave it.** See below.
- `PDFXYZ_RATE_LIMIT_TRUST_PROXY` — Vercel already gives the route handler a
  trustworthy client address; setting this makes the guard trust a
  client-supplied forwarding header, which is a way to be trivially evaded.

---

## Step 3 — redeploy

Environment variables are read at boot. An existing deployment will not pick
them up: trigger a new Production deployment (Vercel → Deployments →
**Redeploy**, or push any commit).

---

## Step 4 — prove it, by being refused

```bash
pnpm verify:rate-limit
```

It sends `POST /api/uploads` until the server refuses one, and reports what it
observed. It does **not** read a status flag — a field saying `provider: redis`
means the environment parsed, not that a single request was ever denied, and
this codebase has shipped that exact distinction as a bug more than once.

Expected before: `NOT ENFORCING — 65 requests, none refused` (exit 1).
Expected after: `ENFORCING — request 61 was refused with 429` (exit 0).

The probe reserves upload slots and never uses them: no job is created, no
worker runs, no object is written, no AI provider is called. The slots expire.
It costs about one client's hourly upload budget, so run it once and from a
machine that is not about to need the service.

---

## Safety, and how to undo it

**Enabling this cannot lock users out.** The fail mode defaults to `open`: if the
Upstash store is unreachable or the credentials are wrong, the guard allows the
request and records the degrade rather than refusing traffic. The worst outcome
of a bad value is that rate limiting does nothing — and since 2026-08-09 that
state is no longer silent: `GET /api/worker/operations` folds the guard's own
posture into its snapshot and alert report, so a configured-but-not-enforcing
limiter (`remote-missing-config`, or a live store failure surfacing as
`remote-error-fail-open`) raises a warn on the operator dashboard and makes
`pnpm worker:ops-check` exit `3`. That is monitoring, not proof of enforcement —
Step 4 is still not optional.

A wrong or partial configuration is also detected at boot: a remote provider
selected with no valid store resolves to `unconfigured`, an honest skip, never
fabricated enforcement.

**To turn it back off:** delete `PDFXYZ_RATE_LIMIT_PROVIDER` (or set it to
`disabled`) and redeploy. The other two variables become inert; they do not need
removing.

---

## What this does not cover

- The presigned R2 `PUT` does not bind `Content-Length`, so a client with a valid
  slot can upload more bytes than it declared. Separate gap, separate fix.
- These are per-client limits over fixed windows. They stop casual abuse and
  runaway scripts. They are not a defence against a distributed attack, which
  belongs at the edge/WAF layer.
