# Kubernetes deployment blueprints

Provider-neutral, secret-free Kubernetes manifests for pdf.xyz web + secure-worker +
`worker:ops-check` CronJob. They are static examples: no cluster is provisioned by this
repo, and these manifests were not applied in this environment.

## Files

| File                     | Purpose                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `namespace.yaml`         | Dedicated namespace.                                                                  |
| `configmap.yaml`         | Non-secret runtime defaults and placeholder public origin.                            |
| `secret.example.yaml`    | Placeholder-only Secret shape; replace values out-of-band or use your secret manager. |
| `web-deployment.yaml`    | Public web Deployment + Service. No worker provider secrets.                          |
| `worker-deployment.yaml` | Private secure-worker Deployment. Runs `pnpm worker:daemon`.                          |
| `ops-check-cronjob.yaml` | CronJob that runs `pnpm worker:ops-check --runtime --json` every 5 minutes.           |

## Apply sequence

```bash
kubectl apply -f namespace.yaml
kubectl apply -f configmap.yaml
# Replace placeholder values out-of-band first, or use ExternalSecrets/SealedSecrets.
kubectl apply -f secret.example.yaml
kubectl apply -f web-deployment.yaml
kubectl apply -f worker-deployment.yaml
kubectl apply -f ops-check-cronjob.yaml
```

## Optional: enable distributed rate limiting on the WEB tier (Phase 34)

The committed `web-deployment.yaml` ships with rate limiting **off** and holds **no**
secret — the honest default. Distributed enforcement runs on the **web** tier (the public
API routes), so to turn it on you add a small **web-tier** secret and a few inline env
vars to the web Deployment. These use their own `PDFXYZ_RATE_LIMIT_REDIS_*` names —
deliberately distinct from the worker-only `PDFXYZ_REDIS_REST_*` — so the public web pod
never inherits a worker secret (the load-bearing web/worker separation this blueprint
enforces). You may point them at the same managed instance the queue uses.

```bash
# 1) A web-tier secret for the limiter store (placeholders — replace out-of-band,
#    or use ExternalSecrets/SealedSecrets; never commit a real token).
kubectl -n pdfxyz create secret generic pdfxyz-ratelimit \
  --from-literal=PDFXYZ_RATE_LIMIT_REDIS_REST_URL=https://REPLACE-ME.example-redis.invalid \
  --from-literal=PDFXYZ_RATE_LIMIT_REDIS_REST_TOKEN=REPLACE_WITH_RATE_LIMIT_REDIS_TOKEN
```

```yaml
# 2) In web-deployment.yaml, add to the web container (inline env — the URL/token come
#    from the web-tier secret above; the store key namespace + degrade policy are plain):
env:
  - name: PDFXYZ_RATE_LIMIT_PROVIDER
    value: redis
  - name: PDFXYZ_RATE_LIMIT_KEY_PREFIX
    value: pdfxyz
  - name: PDFXYZ_RATE_LIMIT_FAIL_MODE
    value: open # open (default) = allow on store error; closed = 429
  - name: PDFXYZ_RATE_LIMIT_REDIS_REST_URL
    valueFrom:
      secretKeyRef:
        { name: pdfxyz-ratelimit, key: PDFXYZ_RATE_LIMIT_REDIS_REST_URL }
  - name: PDFXYZ_RATE_LIMIT_REDIS_REST_TOKEN
    valueFrom:
      secretKeyRef:
        { name: pdfxyz-ratelimit, key: PDFXYZ_RATE_LIMIT_REDIS_REST_TOKEN }
  # Only behind a proxy/CDN you trust to set x-forwarded-for:
  # - name: PDFXYZ_RATE_LIMIT_TRUST_PROXY
  #   value: "true"
```

At boot the web pod logs one content-free line (`[pdf.xyz] rate-limit provider:
remote-configured`); a `remote-error-fail-open` at runtime means the store is unreachable
and the guard is failing open. The operations snapshot alerts on that state
(`rate-limit-fail-open` / `rate-limit-misconfigured`), so an ops-check evaluating a
scraped `/api/worker/operations` snapshot exits `3` and the CronJob's failure is what
your cluster alerting sees. See `docs/DEPLOYMENT.md` and `docs/OBSERVABILITY.md`.

## Honesty notes

- `secret.example.yaml` intentionally uses `REPLACE_*` placeholders only. Do not commit a
  real Secret manifest.
- The CronJob is a local evaluator, not a pager. It exits `0/1/2/3/4`; your cluster
  alerting watches failed Jobs and decides who to notify.
- `daemonObserved:true` requires Phase 30 heartbeat enabled plus a configured Redis-REST
  broker; absent/stale/disabled heartbeat never fakes worker liveness.
- Distributed rate limiting (above) is the one optional **web-tier** secret; it is a
  rate-limit store token, never a worker/queue/storage credential, and the committed
  `web-deployment.yaml` stays secret-free until you add it.
