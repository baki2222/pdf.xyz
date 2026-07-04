# Release evidence operator report — example fixtures

Content-free fixtures for `pnpm worker:release-report` (Phase 52). The report **ingests** whichever of a
content-free `pdfxyz.release-ci-bundle/1` (this release's evidence coherence, Phase 50) and/or a
`pdfxyz.release-audit/1` (regression versus a baseline, Phase 51) a release job already produced,
**re-validates each document against itself** (re-deriving its Phase 50/51 rollup, so a hand-flipped verdict is
caught as a tamper), and folds them into one stable operator report: the **evidence coverage**, per-source
summaries, a **final recommendation** + bounded **rationale**, an **archive checklist**, and an ordered
**next-action checklist**. It answers ONE question a CI summary / deployment review / incident handoff needs —
*"what should the operator **do** now, based only on the content-free release evidence — is this release
promote-ready, should it be held, or is the evidence insufficient?"* — and **fails closed** when a document
cannot be trusted or the primary coherence evidence is missing.

Everything here is **content-free**: bounded enums, small counts/deltas, ISO stamps, and app-authored prose
only — no filename, path, object key, bucket, URL, raw ref, raw label, commit URL, size, digest, or byte, even
from a hostile input. It is local content-free **reporting over evidence**, **not** signing, authentication,
cloud validation, storage retention enforcement, deployment **approval**, or deployment **promotion**. It runs
no stage / bundle / audit itself, contacts no cloud, and deletes / prunes / uploads / promotes / approves /
mutates nothing.

> **A `promote-ready` requires a usable release CI bundle whose own verdict is `pass`.** An audit only reports
> whether the release **regressed** versus a baseline — it can never certify that the current release is itself
> acceptable — so an **audit-only** (or bundle-absent) run is honestly `needs-evidence`, never a promote.

## Document fixtures

Each `bundle-*.json` is a genuine, self-consistent `pdfxyz.release-ci-bundle/1`; each `audit-*.json` is a
genuine, self-consistent `pdfxyz.release-audit/1` (both re-derive their own rollup, so the report's trust
boundary marks them `usable`). `not-a-report.json` (a wrong schema) proves the fail-closed path.

| File | Kind | Own verdict | Role |
| --- | --- | --- | --- |
| `bundle-pass.json` | release CI bundle | `pass` | a coherent, promote-able release |
| `bundle-warn.json` | release CI bundle | `warn` | a release carrying an advisory concern |
| `bundle-fail.json` | release CI bundle | `fail` | a release whose evidence chain is not coherent |
| `audit-pass.json` | release audit | `pass` | no regression versus the baseline |
| `audit-warn.json` | release audit | `warn` | a non-blocking drift versus the baseline |
| `audit-fail.json` | release audit | `fail` | a blocking regression versus the baseline |
| `not-a-report.json` | — | — | not a recognized release document (an unreadable input) |

## What the report recommends

| Inputs | Recommendation | Exit | Why |
| --- | --- | --- | --- |
| `bundle-pass` (+ `audit-pass`) | `promote-ready` | `0` | a usable bundle passed and the audit (if any) reported no regression |
| `bundle-pass` only | `promote-ready` | `0` | the bundle certifies coherence; the audit is an optional regression guard |
| `bundle-warn` | `hold-warning` | `3` | an **advisory** concern (a bundle warn); review, then decide |
| `bundle-pass` + `audit-warn` | `hold-warning` | `3` | an **advisory** drift versus the baseline |
| `bundle-fail` | `hold-fail` | `4` | the bundle's coherence verdict **failed** (blocking) |
| `bundle-pass` + `audit-fail` | `hold-fail` | `4` | a **blocking** regression holds the release, even with a passing bundle |
| `audit-pass` only | `needs-evidence` | `2` | **no bundle** — a regression check cannot certify the release's own coherence |
| `not-a-report` | `needs-evidence` | `2` | an unreadable document certifies nothing (never a fabricated promote) |
| a tampered bundle / audit | `hold-fail` | `4` | a recorded verdict that does **not** re-derive (a tamper) |

The recommendation resolves with fail-closed precedence: **blocking** (a tamper, a failed bundle, a blocking
audit regression) → `hold-fail`; else **insufficient** (an unreadable / indeterminate document, or no usable
bundle) → `needs-evidence`; else **advisory** (a bundle warn / audit drift) → `hold-warning`; else
`promote-ready`. `--strict` escalates an advisory-only posture to `hold-fail`.

## Run it

```sh
# A passing bundle (+ a passing audit) → promote-ready (exit 0)
pnpm worker:release-report \
  --bundle=docs/examples/release-report/bundle-pass.json \
  --audit=docs/examples/release-report/audit-pass.json --text

# A warn bundle is an advisory hold-warning (exit 3); --strict makes it a hold-fail (exit 4)
pnpm worker:release-report --bundle=docs/examples/release-report/bundle-warn.json --json
pnpm worker:release-report --bundle=docs/examples/release-report/bundle-warn.json --strict --json

# A failed bundle, or a blocking audit regression, holds the release closed → hold-fail (exit 4)
pnpm worker:release-report --bundle=docs/examples/release-report/bundle-fail.json --json
pnpm worker:release-report \
  --bundle=docs/examples/release-report/bundle-pass.json \
  --audit=docs/examples/release-report/audit-fail.json --json

# An audit-only run cannot certify coherence → needs-evidence (exit 2), never a promote
pnpm worker:release-report --audit=docs/examples/release-report/audit-pass.json --json

# An unreadable document → needs-evidence (exit 2), never a fabricated promote
pnpm worker:release-report --bundle=docs/examples/release-report/not-a-report.json --json

# Read a document from stdin with the `-` sentinel
cat docs/examples/release-report/bundle-pass.json | pnpm worker:release-report --bundle=- --text
```

## Policy knob

| Flag | Effect |
| --- | --- |
| `--strict` | treat an advisory-only concern (a bundle warn / a non-blocking audit drift) as a blocking `hold-fail` (exit 4 instead of 3); blocking / insufficient outcomes are unaffected |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | **promote-ready** — a usable bundle passed and the audit (if any) reported no regression |
| `1` | **usage** — the CLI was misused (a bad flag, no document supplied, or an unwritable output) |
| `2` | **needs-evidence** — an unreadable / indeterminate document, or no usable bundle (an audit-only run) |
| `3` | **hold-warning** — an advisory concern (a non-blocking bundle warn / audit drift) |
| `4` | **hold-fail** — a tampered document, a failed bundle, or a blocking audit regression |

See `docs/examples/deployment/github-actions/release-report-fixture.yml` for the full CI job that builds the
current release's bundle, composes the report, renders it into `$GITHUB_STEP_SUMMARY`, and fails closed.
