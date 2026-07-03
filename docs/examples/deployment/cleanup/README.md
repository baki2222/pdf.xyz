# Storage-artifact cleanup pipeline — scheduler / ops examples (Phase 43)

Runnable, content-free templates for scheduling the storage-artifact cleanup pipeline safely.
The pipeline has three offline stages, none of which call the cloud or delete anything:

```
raw provider export            worker:cleanup-project            worker:cleanup-check
(YOUR out-of-band          →   --target=evidence     →  (absence VERIFIER, Phase 42)
 aws s3api capture)             --target=inventory    →  worker:artifact-cleanup
                                                          (dry-run SWEEPER, Phase 42)
```

1. **Project (Phase 43).** `pnpm worker:cleanup-project` reads a raw provider export you
   produced out-of-band (`aws s3api list-objects-v2` / `head-object`, or a normalized dump)
   and emits the two bounded, content-free Phase 42 shapes, **dropping every object key,
   bucket name, signed URL, endpoint, region, account id, ETag, filename, and user-metadata
   blob**. It reads only a bounded allowlist of fields.
2. **Verify (Phase 42).** `pnpm worker:cleanup-check` folds cleanup **evidence** to prove
   whether should-be-gone artifacts are actually absent (deleted / reaped) or only
   retrieval-denied.
3. **Sweep (Phase 42).** `pnpm worker:artifact-cleanup` evaluates the present-object
   **inventory** and reports expired/stale/tombstoned-but-present objects as a dry-run plan.

None of these tools ever list a real bucket, call a cloud API, or delete an object. Producing
the raw export (with your credentials) and performing any deletion both stay **operator-owned
and out-of-band**.

## One command: `worker:cleanup-pipeline` (Phase 44)

Phase 44 collapses the three stages into a single fail-closed command. `pnpm worker:cleanup-pipeline`
reads the raw export **once**, projects it into both shapes, runs the verifier **and** the dry-run
sweeper internally, and rolls the two arms into ONE composite exit code:

```
raw provider export  →  worker:cleanup-pipeline  →  one exit code
(YOUR out-of-band        (project once, then           0 ok · 1 usage · 2 unknown
 aws s3api capture)       verify + sweep arms)          3 drift · 4 breach
```

Key it on the **exit code** exactly like the granular stages; the higher the worse, and `1` is a
distinct "the pipeline was misused / the export was unreadable" band — a NON-ZERO fail-closed
result, never a silent clean pass. It still lists no bucket, calls no cloud API, and deletes
nothing. Prefer it for scheduled monitoring; use the granular stages when you want per-stage codes.

## Files

| File | What it schedules |
| --- | --- |
| `cleanup-pipeline-notify.sh` | **(Phase 44)** Inert wrapper around the one-command `worker:cleanup-pipeline`: run the composite over a mounted export, map its single exit code to a severity, re-raise it. The simplest safe path. |
| `../github-actions/cleanup-pipeline-fixture.yml` | **(Phase 44)** GitHub Actions gate that runs `worker:cleanup-pipeline` over the committed fixtures offline and asserts each composite exit code. |
| `cleanup-evidence-notify.sh` | Inert wrapper: project → verify → dry-run sweep a mounted export, map exit codes to a severity, re-raise the actionable ones. Copy next to your deploy. |
| `../kubernetes/cleanup-check-cronjob.yaml` | Kubernetes `CronJob` that projects a ConfigMap-mounted raw export and runs the verifier + sweeper, failing the Job on drift/breach. |
| `../scheduler/pdfxyz-cleanup-check.service` + `.timer` | systemd oneshot + timer that run the wrapper hourly. |
| `../scheduler/cleanup-check.cron` | `/etc/cron.d` row that runs the wrapper hourly with `MAILTO`. |
| `../github-actions/cleanup-evidence-fixture.yml` | GitHub Actions gate that projects the committed fixtures offline and asserts each exit code. |

All placeholders (`REPLACE-ME`, `*.example.invalid`, `/evidence/raw-export.json`) are inert —
they carry no real bucket, key, URL, or secret. `pnpm deploy:examples:check` validates that.

## Alerting by exit code

Key your monitor on the **exit code**, never on stdout (which is content-free JSON you can log
but never need to parse to decide severity). Higher = worse; the `1` band is a distinct "the
check itself was misused", never a cleanup incident.

| Stage | 0 | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- | --- |
| `cleanup-project` | projected | usage | insufficient (thin export) | — | unsafe (tombstoned-present / corrupt) |
| `cleanup-check` | verified | usage | unknown / not-configured | drift | — |
| `artifact-cleanup` | ok | usage | unknown | drift | breach (tombstoned / invalid) |
| `cleanup-pipeline` | ok (both arms clean) | usage | unknown / not-configured | drift | breach (tombstoned / unsafe) |

The `cleanup-pipeline` row is the **worst of the verify + sweep arms** — the single code the
Phase 44 one-command wrapper re-raises.

Recommended policy (encoded by `cleanup-evidence-notify.sh`):

- **0** — clean; no action.
- **1** — the CHECK is misconfigured (bad flag / unreadable export). Fix the wiring; do **not**
  page it as a cleanup incident. The wrapper folds it to `unknown` so it is never a silent pass.
- **2** — `unknown` / `insufficient` / `not-configured`: not enough evidence to prove cleanup.
  A soft warning — often means the export is stale or storage is not wired here.
- **3** — `drift`: an artifact is present past its retention window + reap grace. **Page.** The
  bucket lifecycle backstop has not removed what the app no longer serves.
- **4** — `breach` / `unsafe`: a tombstoned object is still present, or the export is corrupt.
  **Page urgently.** Bytes that should be gone remain.

A `drift`/`breach` is a cleanup gap, **not** a disclosure: the retrieval boundary (Phase 41)
still denies the download regardless. It is also **not** a claim about your bucket lifecycle
policy's correctness — verify that separately with `worker:daemon --lifecycle-verify`.

## What each stage is and is NOT

- **Provider-export projection (Phase 43, this dir)** — an offline redaction/normalization of
  YOUR export into the bounded shapes. Not proof of deletion, not a cloud scanner.
- **Cleanup verifier / dry-run sweeper (Phase 42)** — evaluate the projected evidence/inventory.
  Never list a bucket, never delete.
- **Retrieval-time expiry enforcement (Phase 41)** — denies an expired/tombstoned artifact
  `410 Gone` at download, before any bytes are served. Access denial, not byte deletion.
- **Bucket lifecycle policy verifier (`worker:daemon --lifecycle-verify`)** — checks that your
  bucket's lifecycle RULES match the app's generated backstop. Policy, not effect.
- **Real deletion / listing** — remains operator-owned and out-of-band. None of these tools
  perform it.
