# Rate limiting — turning it on

Everything is built. The guard, its policies, the Redis provider, the boot
hook, and their tests all exist and pass. It is **switched off**, because
`PDFXYZ_RATE_LIMIT_PROVIDER` is unset and unset means `disabled`.

Turning it on is three environment variables and a redeploy. Two of them are
secrets, so they have to be pasted by a person with the Upstash account — no
part of this repository or its tooling reads, stores, or transmits them.

---

## What is already enforced the moment it is on

| Policy              | Limit | Window     |
| ------------------- | ----- | ---------- |
| `uploads.create`    | 60    | per hour   |
| `jobs.create`       | 60    | per hour   |
| `jobs.delete`       | 60    | per hour   |
| `jobs.status`       | 120   | per minute |
| `artifacts.fetch`   | 120   | per minute |
| `worker.status`     | 120   | per minute |
| `worker.operations` | 120   | per minute |
| `interest.note`     | 30    | per hour   |
| `ai.run`            | 3     | per day    |

**Read that table as a GLOBAL budget today, not a per-visitor one.** The
limiter buckets by the token `deriveClientToken` returns, and that function
returns the single shared token `"shared"` for every request unless
`PDFXYZ_RATE_LIMIT_TRUST_PROXY` is on (`src/lib/ratelimit/identity.ts:61`). So
with the recommended configuration, `ai.run` is 3 runs per day for **everyone
combined**, and `uploads.create` is 60 per hour in total — not 60 each.

A refused request gets `429` with a `Retry-After`, not a silent drop.

---

## Step 1 — create an Upstash Redis database

<https://console.upstash.com> → **Create Database**. The free tier is ample:
these are short fixed windows holding one counter per bucket per policy — and
see the note above about how few buckets there currently are.

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

| Name                                 | Value                  |
| ------------------------------------ | ---------------------- |
| `PDFXYZ_RATE_LIMIT_PROVIDER`         | `redis`                |
| `PDFXYZ_RATE_LIMIT_REDIS_REST_URL`   | the Upstash REST URL   |
| `PDFXYZ_RATE_LIMIT_REDIS_REST_TOKEN` | the Upstash REST token |

Only the first is written out here because only the first is not a secret.

**Optional, and deliberately left alone:**

- `PDFXYZ_RATE_LIMIT_KEY_PREFIX` — defaults to `pdfxyz`. Set it only if the same
  Upstash database is shared with something else.
- `PDFXYZ_RATE_LIMIT_FAIL_MODE` — defaults to `open`. **Leave it.** See below.
- `PDFXYZ_RATE_LIMIT_KEY_SALT` — **required for per-client limits.** A secret,
  identical on every instance, that salts the bucket keys so they are not a
  plain reversible hash of a client address. Until 2026-08-10 this was generated
  per process with `randomBytes`, which meant every serverless instance — and
  every cold start — bucketed the same caller differently; measured on
  production as four distinct buckets from two machines. **If it is unset the
  guard refuses to key per client and falls back to the single shared bucket**,
  reporting `remote-configured-shared`, rather than silently reproducing that
  defect. Rotating it resets every counter once (one window) and is otherwise
  safe; environment variables persist across deploys, so it does not rotate on
  its own.

- `PDFXYZ_RATE_LIMIT_TRUST_PROXY` — leave it off, but **not for the reason this
  document gave until 2026-08-10**. The old text said Vercel already supplies a
  trustworthy client address, which is true — and then the code never reads it.
  `deriveClientToken` has exactly two paths: trust a client-supplied forwarding
  header (forgeable), or bucket every request in the world together (the
  default). The guidance to leave the flag off was right about the flag and
  wrong about the consequence, and it is why every limit in the table above is
  currently global. The fix is not this flag; it is for identity to read the
  platform-set address. Until then, treat the numbers as a global budget.

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

**It also spends the budget `pnpm verify:upload-length` reserves from.** Both
probes hit the same `/api/uploads` bucket, so running this one first guarantees
the length probe is refused with a 429 for the rest of the window (observed on
production 2026-08-20: `Retry-After: 2328s`). Run `verify:upload-length` first
— it costs two reservations against this probe's ~61 — or wait out the
`Retry-After` this probe prints on success. The length probe reports a 429 as
exactly that (with the server's Retry-After) and stops; it never retries in a
loop.

When capturing either probe's exit code, read `$?` from the command itself,
never after a pipe: `pnpm verify:rate-limit | tail` makes `$?` report `tail`,
which is the right command asked of the wrong quantity.

---

## Step 5 — ask whether the AI allowance is gone, without spending it

The probes above answer "is throttling on". This one answers a different
question — **has this connection used up its free daily AI characters** — and it
costs 4 characters of the 123,096.

```bash
curl -sS -w '\n%{http_code}\n' \
  -H 'content-type: application/json' \
  -d '{"tool":"translate-pdf","inputs":["f_probe0000000000"],
       "options":{"targetLanguage":"fr","sourceLanguage":"auto"},
       "declaredCharacters":1}' \
  https://<host>/api/jobs
```

**Read the body, not the status.** `POST /api/jobs` returns `429` for two
unrelated reasons and they are told apart only by the message:

| you get                                                                                     | it means                                                          |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `429` + _"The 30,774 free characters of AI text for this connection are used up for today"_ | the **allowance** is spent                                        |
| `429` + _"Too many requests. This endpoint is rate-limited…"_                               | you hit `jobs.create` (60/hour); the allowance is unknown         |
| anything else (`503`, `404`)                                                                | the allowance had room, and you just spent **4** characters of it |

### Why it costs almost nothing, and why the obvious version does not work

`declaredCharacters: 1` reserves `1 × extractor headroom` — **four characters**.
The reservation is what the allowance is debited by, so a probe that declares
one character pays four and no more.

**A refusal costs nothing at all.** The allowance guard peeks before it spends
(`spendIfItFits` in `ratelimit/guard.ts`): when the budget cannot cover the
reservation it refuses without recording anything, so asking "am I out?" while
you are out does not push your reset further away. Asking twice returns the same
`Retry-After`.

**The file id must be well-formed and may be imaginary.** `f_` plus ten or more
`[A-Za-z0-9_-]` is all the contract checks — existence is the _worker's_
problem, and the request never reaches a worker. Nothing is uploaded, no job is
created, no AI provider is called.

**Do not use a malformed id.** _"Send an invalid file id, the guard refuses
before validation"_ is the intuitive version and it answers the wrong question:
`file_abc` fails at `parseCreateJobRequest` with a `400`, which happens **before
the allowance is ever consulted**. It is free and it tells you nothing. The
allowance only speaks to a request that parses.

All four of those claims are pinned by
`src/lib/ratelimit/allowance-probe.test.ts` — including the malformed-id one, so
this section cannot drift back to describing it.

⚠️ **Against an unconfigured deployment this probe always looks healthy.** With
no limiter provider set, the allowance guard short-circuits before reading a
header and can never return `429`. Run Step 4 first: "no 429" means "allowance
fine" only once you know something is counting.

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

- These are fixed-window limits. They stop casual abuse and runaway scripts.
  They are not a defence against a distributed attack, which belongs at the
  edge/WAF layer.
- **They are not per-visitor today.** See the note under the policy table:
  every request shares one bucket unless the forwarding header is trusted, and
  trusting that header is itself evadable. Neither setting gives honest
  per-client accounting; that needs BOTH the forwarding header trusted AND
  `PDFXYZ_RATE_LIMIT_KEY_SALT` set. Setting one without the other lands in the
  shared bucket and says so.

<!-- gap-while-absent: /sliding[- ]?window/i in src/lib/ratelimit -->
<!-- The marker above pins "fixed windows": if a sliding-window implementation
     lands in the limiter, the docs census fails and this bullet must be
     rewritten rather than silently going stale. -->

One gap previously listed here is closed: since **2026-08-06** the presigned R2
`PUT` binds `Content-Length` — the signature covers the declared size, so a
slot admits exactly the bytes it reserved and R2 refuses any other size with
`403 SignatureDoesNotMatch`. Proven against production R2 before it shipped:
declared 2048 → PUT 2048 accepted, PUT 6144 refused, PUT 1536 refused — exact
in both directions. The enforcement and that measurement record live in
`reserveUpload()` in `src/lib/workers/storage/s3.ts` (the signed
`content-length` header), so check it there rather than trusting this page.

<!-- true-while-present: /"content-length"/ in src/lib/workers/storage/s3.ts -->
<!-- The marker above pins the claim of PRESENCE this paragraph makes: if the
     signed content-length header ever leaves reserveUpload, the docs census
     fails and this paragraph goes back to being a gap — the exact rot this
     page carried for three days in the other direction. -->
