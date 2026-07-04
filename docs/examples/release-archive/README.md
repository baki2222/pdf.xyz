# Release evidence archive pack fixtures

Phase 55 adds `worker:release-archive`, a local/offline/read-only content-free archive manifest over release evidence review records.

It composes a **primary** `pdfxyz.release-governance/1` bundle plus optional related `pdfxyz.release-trend/1`, `pdfxyz.release-report/1`, `pdfxyz.release-audit/1`, and `pdfxyz.release-ci-bundle/1` records into one `pdfxyz.release-archive/1` manifest.

The manifest answers: **what bounded content-free records should be archived together, what is their governance posture, and what caveats/follow-up remain?**

It is **not** signing, authentication, cloud validation, immutable storage, retention enforcement, deployment approval, deployment promotion, or a ZIP/tar/raw-file pack.

## Fixtures

| File | Schema | Posture | Role |
| --- | --- | --- | --- |
| `governance-healthy.json` | `pdfxyz.release-governance/1` | `healthy` | primary clean review-window posture |
| `governance-watch.json` | `pdfxyz.release-governance/1` | `watch` | primary advisory review-window posture |
| `governance-incomplete.json` | `pdfxyz.release-governance/1` | `incomplete` | primary insufficient review-window posture |
| `governance-blocked.json` | `pdfxyz.release-governance/1` | `blocked` | primary blocking review-window posture |
| `governance-tampered.json` | `pdfxyz.release-governance/1` | claimed `blocked` | hand-flipped governance verdict; must fail closed as tampered |
| `trend-stable.json` | `pdfxyz.release-trend/1` | `stable` | related clean trend record |
| `trend-warning.json` | `pdfxyz.release-trend/1` | `warning` | related advisory trend record |
| `report-promote-ready.json` | `pdfxyz.release-report/1` | `promote-ready` | related latest clean report |
| `report-hold-fail.json` | `pdfxyz.release-report/1` | `hold-fail` | related latest blocking report |
| `audit-pass.json` | `pdfxyz.release-audit/1` | `pass` | related clean regression audit |
| `audit-fail.json` | `pdfxyz.release-audit/1` | `fail` | related blocking regression audit |
| `bundle-pass.json` | `pdfxyz.release-ci-bundle/1` | `pass` | related clean CI bundle |
| `bundle-fail.json` | `pdfxyz.release-ci-bundle/1` | `fail` | related blocking CI bundle |
| `not-a-document.json` | — | — | wrong-schema unreadable input |

## Run it

```sh
# Healthy governance + coherent related records → archivable (exit 0)
pnpm worker:release-archive \
  --governance=docs/examples/release-archive/governance-healthy.json \
  --trend=docs/examples/release-archive/trend-stable.json \
  --report=docs/examples/release-archive/report-promote-ready.json \
  --audit=docs/examples/release-archive/audit-pass.json \
  --bundle=docs/examples/release-archive/bundle-pass.json --text

# Watch governance / advisory related record → archive-watch (exit 3)
pnpm worker:release-archive \
  --governance=docs/examples/release-archive/governance-watch.json \
  --trend=docs/examples/release-archive/trend-warning.json --json

# Blocked governance → archive-blocked (exit 4)
pnpm worker:release-archive \
  --governance=docs/examples/release-archive/governance-blocked.json --json

# Incomplete governance → archive-incomplete (exit 2)
pnpm worker:release-archive \
  --governance=docs/examples/release-archive/governance-incomplete.json --json

# Tampered governance (recorded verdict does not re-derive) → archive-blocked (exit 4)
pnpm worker:release-archive \
  --governance=docs/examples/release-archive/governance-tampered.json --json

# Related hold-fail report blocks even healthy governance (exit 4)
pnpm worker:release-archive \
  --governance=docs/examples/release-archive/governance-healthy.json \
  --report=docs/examples/release-archive/report-hold-fail.json --json
```

## Policy knobs

| Flag | Effect |
| --- | --- |
| `--require-trend` | require a related `pdfxyz.release-trend/1`; else `archive-incomplete` |
| `--require-report` | require a related `pdfxyz.release-report/1`; else `archive-incomplete` |
| `--require-audit` | require a related `pdfxyz.release-audit/1`; else `archive-incomplete` |
| `--require-bundle` | require a related `pdfxyz.release-ci-bundle/1`; else `archive-incomplete` |
| `--strict-watch` | escalate advisory-only `archive-watch` to `archive-blocked` |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | **archivable** — healthy primary governance and supplied related records are clean/coherent |
| `1` | **usage** — CLI misuse |
| `2` | **archive-incomplete** — missing/unusable primary governance or required/indeterminate evidence |
| `3` | **archive-watch** — advisory posture or stale/mismatched related record |
| `4` | **archive-blocked** — tamper, blocked governance, failing related evidence, or blocking regression |

See `docs/examples/deployment/github-actions/release-archive-fixture.yml` for a CI review-record example.
