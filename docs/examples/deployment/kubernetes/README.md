# Kubernetes deployment blueprints

Provider-neutral, secret-free Kubernetes manifests for pdf.xyz web + secure-worker +
`worker:ops-check` CronJob. They are static examples: no cluster is provisioned by this
repo, and these manifests were not applied in this environment.

## Files

| File | Purpose |
| ---- | ------- |
| `namespace.yaml` | Dedicated namespace. |
| `configmap.yaml` | Non-secret runtime defaults and placeholder public origin. |
| `secret.example.yaml` | Placeholder-only Secret shape; replace values out-of-band or use your secret manager. |
| `web-deployment.yaml` | Public web Deployment + Service. No worker provider secrets. |
| `worker-deployment.yaml` | Private secure-worker Deployment. Runs `pnpm worker:daemon`. |
| `ops-check-cronjob.yaml` | CronJob that runs `pnpm worker:ops-check --runtime --json` every 5 minutes. |

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

## Honesty notes

- `secret.example.yaml` intentionally uses `REPLACE_*` placeholders only. Do not commit a
  real Secret manifest.
- The CronJob is a local evaluator, not a pager. It exits `0/1/2/3/4`; your cluster
  alerting watches failed Jobs and decides who to notify.
- `daemonObserved:true` requires Phase 30 heartbeat enabled plus a configured Redis-REST
  broker; absent/stale/disabled heartbeat never fakes worker liveness.
