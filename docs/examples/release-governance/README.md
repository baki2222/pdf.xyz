# Release evidence governance bundle — example fixtures

Content-free fixtures for `pnpm worker:release-governance` (Phase 54). The bundle **ingests** a content-free
`pdfxyz.release-trend/1` window summary (Phase 53, the **primary** governance signal) plus, optionally, the
**latest** content-free `pdfxyz.release-report/1` (Phase 52) and/or `pdfxyz.release-audit/1` (Phase 51) a release
pipeline already produced, **re-validates each document against itself** (re-deriving the trend's Phase 53
verdict from its own per-report points, the report's Phase 52 recommendation, and the audit's Phase 51 rollup, so
a hand-flipped verdict is caught as a tamper), **cross-checks** the latest report against the trend's own newest
report, and folds them into one governance bundle: the **evidence coverage**, per-source **summaries**, a
**governance verdict** + bounded **reasons**, an **archive checklist**, and an ordered **follow-up assignment**
list. It answers ONE question a weekly / monthly release-governance review needs — *"what is the governance
posture for this review window, what bounded evidence should be archived, and what follow-up should be
assigned?"* — and **fails closed** when a document cannot be trusted or the primary trend evidence is missing /
insufficient.

Everything here is **content-free**: bounded enums, small counts, ISO stamps, and app-authored prose only — no
filename, path, object key, bucket, URL, raw ref, raw label, commit URL, size, digest, or byte, even from a
hostile input, and never an ingested document's own stamp. It is local content-free **governance bundling over
evidence summaries**, **not** signing, authentication, cloud validation, storage retention enforcement,
deployment **approval**, or deployment **promotion**. It runs no gate / bundle / audit / report / trend itself,
contacts no cloud, and deletes / prunes / uploads / promotes / approves / mutates nothing.

> **A `healthy` window requires a usable, `stable` trend** (the primary window signal). The latest report / audit
> are point-in-time signals that can **block** or **flag** the window but can never, on their own, **grant** a
> healthy window — so a trend-absent (or trend-unusable) run is honestly `incomplete`, never a healthy.

## Fixtures

Each `trend-*.json` / `report-*.json` / `audit-*.json` is a genuine, self-consistent upstream document (its
recorded rollup re-derives, so the bundle's trust boundary marks it `usable`). `trend-tampered.json` is a real
trend whose recorded verdict was hand-flipped so it no longer re-derives, and `not-a-document.json` (a wrong
schema) proves the fail-closed paths.

| File | Schema | Posture | Role |
| --- | --- | --- | --- |
| `trend-stable.json` | `pdfxyz.release-trend/1` | `stable` | a clean recent window (promote-ready tip) |
| `trend-warning.json` | `pdfxyz.release-trend/1` | `warning` | an advisory recent posture |
| `trend-unknown.json` | `pdfxyz.release-trend/1` | `unknown` | an insufficient recent posture |
| `trend-failing.json` | `pdfxyz.release-trend/1` | `failing` | a blocking recent posture (hold-fail tip) |
| `trend-tampered.json` | `pdfxyz.release-trend/1` | `stable` (claimed) | a hand-flipped verdict that does **not** re-derive |
| `report-promote-ready.json` | `pdfxyz.release-report/1` | `promote-ready` | a clean latest release handoff |
| `report-hold-fail.json` | `pdfxyz.release-report/1` | `hold-fail` | a latest release held for a blocking issue |
| `audit-pass.json` | `pdfxyz.release-audit/1` | `pass` | a latest regression check with no regression |
| `audit-fail.json` | `pdfxyz.release-audit/1` | `fail` | a latest audit with a blocking regression |
| `not-a-document.json` | — | — | not a recognized release document (an unreadable input) |

## What the bundle concludes

The **trend** is the primary signal; the **latest report / audit** are secondary guards.

| Inputs | Verdict | Exit | Why |
| --- | --- | --- | --- |
| `trend=stable` (+ clean latest) | `healthy` | `0` | a stable trend, and every supplied latest source clean |
| `trend=warning` / latest `hold-warning` / audit `warn` | `watch` | `3` | an **advisory** concern (or a report ↔ trend drift) |
| `trend` absent / unreadable / `unknown`, or latest `needs-evidence` / audit `unknown` | `incomplete` | `2` | **insufficient** evidence — never a vacuous healthy |
| `trend=failing` / latest `hold-fail` / audit `fail` / any tamper | `blocked` | `4` | a **blocking** issue or a tampered document |

The verdict resolves with fail-closed precedence: **blocking** (a tamper, a failing trend, a hold-fail report, or
a blocking audit regression) → `blocked`; else **insufficient** (an absent / unreadable / unknown trend, an
indeterminate latest, or a required-but-missing document) → `incomplete`; else **advisory** (a warning trend, a
hold-warning report, an audit drift, or a report ↔ trend drift) → `watch`; else `healthy`.

## Run it

```sh
# A stable trend with clean latest sources → healthy (exit 0)
pnpm worker:release-governance \
  --trend=docs/examples/release-governance/trend-stable.json \
  --report=docs/examples/release-governance/report-promote-ready.json \
  --audit=docs/examples/release-governance/audit-pass.json --text

# A failing trend blocks the window closed (exit 4)
pnpm worker:release-governance \
  --trend=docs/examples/release-governance/trend-failing.json --json

# A tampered trend (recorded verdict does not re-derive) blocks closed (exit 4)
pnpm worker:release-governance \
  --trend=docs/examples/release-governance/trend-tampered.json --json

# A hold-fail LATEST report blocks even a stable trend (exit 4)
pnpm worker:release-governance \
  --trend=docs/examples/release-governance/trend-stable.json \
  --report=docs/examples/release-governance/report-hold-fail.json --json

# A missing trend (a latest report only) is INCOMPLETE (exit 2), never a vacuous healthy
pnpm worker:release-governance \
  --report=docs/examples/release-governance/report-promote-ready.json --json

# --strict-watch escalates an advisory-only watch to blocked (exit 4)
pnpm worker:release-governance \
  --trend=docs/examples/release-governance/trend-warning.json --strict-watch --json

# Read the primary trend from stdin (`--trend=-`)
cat trend.json | pnpm worker:release-governance --trend=- --text
```

## Policy knobs

| Flag | Effect |
| --- | --- |
| `--require-report` | require a latest `pdfxyz.release-report/1`; else the window is `incomplete` |
| `--require-audit` | require a latest `pdfxyz.release-audit/1`; else the window is `incomplete` |
| `--strict-watch` | escalate an advisory-only posture (a `watch`) to `blocked` (exit 4 instead of 3); blocking / insufficient outcomes are unaffected |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | **healthy** — a coherent window (a stable trend, and every supplied latest source clean) |
| `1` | **usage** — the CLI was misused (a bad flag, no document supplied, or an unwritable output) |
| `2` | **incomplete** — insufficient evidence (an absent / unreadable / unknown trend, an indeterminate latest, or a required-but-missing document) |
| `3` | **watch** — an advisory posture (a warning trend, a hold-warning report, an audit drift, or a report ↔ trend drift) |
| `4` | **blocked** — a tampered document, a failing trend, a hold-fail report, or a blocking audit regression |

See `docs/examples/deployment/github-actions/release-governance-fixture.yml` for the full scheduled CI job that
builds the current release's trend + latest report / audit, composes the governance bundle, renders it into
`$GITHUB_STEP_SUMMARY`, and fails closed.
