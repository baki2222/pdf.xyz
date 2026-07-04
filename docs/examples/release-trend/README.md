# Release evidence trend summary — example fixtures

Content-free fixtures for `pnpm worker:release-trend` (Phase 53). The trend **ingests** a bounded history of
content-free `pdfxyz.release-report/1` operator reports (Phase 52) a release pipeline already produced (a week /
month of release handoffs), **re-validates each report against itself** (re-deriving its Phase 52 recommendation
from its own recorded sources + strict flag, so a hand-flipped recommendation is caught as a tamper), and folds
them into one stable trend summary: the **recommendation distribution**, a per-report **posture sequence**, a
**trend verdict** + bounded **reasons**, and an ordered **follow-up checklist**. It answers ONE question a weekly
/ monthly release-governance review needs — *"how has release evidence posture changed over the recent report
history, and what bounded operator follow-up is warranted?"* — and **fails closed** when a report cannot be
trusted or the history is insufficient.

Everything here is **content-free**: bounded enums, small counts, ISO stamps, and app-authored prose only — no
filename, path, object key, bucket, URL, raw ref, raw label, commit URL, size, digest, or byte, even from a
hostile input, and never an ingested report's own stamp. It is local content-free **trend reporting over
evidence reports**, **not** signing, authentication, cloud validation, storage retention enforcement, deployment
**approval**, or deployment **promotion**. It runs no gate / bundle / audit / report itself, contacts no cloud,
and deletes / prunes / uploads / promotes / approves / mutates nothing.

> **A `stable` trend requires a clean bounded window:** no tampered / unreadable report, a newest usable report
> that is `promote-ready`, and no breached history threshold. The **newest** report is always authoritative — a
> currently-failing tip fails the trend even within a tolerated threshold.

## Report fixtures

Each `report-*.json` is a genuine, self-consistent `pdfxyz.release-report/1` (its recorded recommendation
re-derives, so the trend's trust boundary marks it `usable`). `report-tampered.json` is a real report whose
recorded recommendation was hand-flipped so it no longer re-derives, and `not-a-report.json` (a wrong schema)
proves the fail-closed paths.

| File | Recommendation | Role |
| --- | --- | --- |
| `report-promote-ready.json` | `promote-ready` | a coherent, promote-able release handoff |
| `report-hold-warning.json` | `hold-warning` | a release carrying an advisory concern |
| `report-needs-evidence.json` | `needs-evidence` | a release whose coherence could not be certified |
| `report-hold-fail.json` | `hold-fail` | a release held for a blocking issue |
| `report-tampered.json` | `hold-fail` (claimed) | a hand-flipped recommendation that does **not** re-derive |
| `not-a-report.json` | — | not a recognized release report (an unreadable input) |

## What the trend concludes

Supply reports **oldest first, newest last**. The window defaults to the newest `20` reports.

| History (oldest → newest) | Verdict | Exit | Why |
| --- | --- | --- | --- |
| `promote-ready` × N | `stable` | `0` | a clean window: promote-ready tip, no tamper, no threshold breach |
| … `hold-warning` (tip) | `warning` | `3` | an **advisory** tip (or `--max-hold-warning` exceeded, or warnings increased) |
| … `needs-evidence` (tip) | `unknown` | `2` | the latest release could not be certified — insufficient, not a stable |
| … `hold-fail` (tip) | `failing` | `4` | the latest release is held — the tip is failing |
| any `report-tampered` | `failing` | `4` | a recorded recommendation that does **not** re-derive (a tamper) |
| any `not-a-report` | `unknown` | `2` | an unreadable report — the window cannot be summarized confidently |
| empty / all unreadable | `unknown` | `2` | nothing usable to summarize |

The verdict resolves with fail-closed precedence: **blocking** (a tamper, a hold-fail tip, a breached
`--max-hold-fail`, or a required not-ready tip) → `failing`; else **insufficient** (an unreadable report, an
empty history, or a needs-evidence tip) → `unknown`; else **advisory** (a hold-warning tip, a breached
`--max-hold-warning`, or a degraded posture) → `warning`; else `stable`.

## Run it

```sh
# A stable window of promote-ready reports → stable (exit 0)
pnpm worker:release-trend \
  --report=docs/examples/release-trend/report-promote-ready.json \
  --report=docs/examples/release-trend/report-promote-ready.json \
  --report=docs/examples/release-trend/report-promote-ready.json --text

# A hold-fail TIP fails the trend closed (exit 4), even within a tolerated threshold
pnpm worker:release-trend \
  --report=docs/examples/release-trend/report-promote-ready.json \
  --report=docs/examples/release-trend/report-hold-fail.json --max-hold-fail=5 --json

# A tampered report anywhere in the window fails closed (exit 4)
pnpm worker:release-trend \
  --report=docs/examples/release-trend/report-promote-ready.json \
  --report=docs/examples/release-trend/report-tampered.json --json

# A needs-evidence TIP is insufficient (exit 2), never a stable
pnpm worker:release-trend \
  --report=docs/examples/release-trend/report-promote-ready.json \
  --report=docs/examples/release-trend/report-needs-evidence.json --json

# --require-latest-ready demands a promote-ready tip; a hold-warning tip then fails (exit 4)
pnpm worker:release-trend \
  --report=docs/examples/release-trend/report-promote-ready.json \
  --report=docs/examples/release-trend/report-hold-warning.json \
  --max-hold-warning=5 --require-latest-ready --json

# Read a JSON array of reports (newest last) from stdin
cat reports-array.json | pnpm worker:release-trend --stdin --text
```

## Policy knobs

| Flag | Effect |
| --- | --- |
| `--max-reports=N` | consider only the newest N reports (default `20`); older reports are dropped from the window (the count dropped is surfaced) |
| `--max-hold-warning=N` | tolerate up to N hold-warning reports before `repeated-hold-warning` fires (default `0`) |
| `--max-hold-fail=N` | tolerate up to N hold-fail reports before `repeated-hold-fail` fires (default `0`); a hold-fail **tip** always fails regardless |
| `--require-latest-ready` | require the newest usable report to be `promote-ready`, else the trend is `failing` |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | **stable** — a clean recent trend (promote-ready tip, no tamper, no threshold breach) |
| `1` | **usage** — the CLI was misused (a bad flag, no report supplied, or an unwritable output) |
| `2` | **unknown** — insufficient history (an unreadable / empty history, or a needs-evidence tip) |
| `3` | **warning** — an advisory trend (a hold-warning tip, warnings increased, or a threshold breach) |
| `4` | **failing** — a tampered report, a hold-fail tip / threshold, or a required not-ready tip |

See `docs/examples/deployment/github-actions/release-trend-fixture.yml` for the full scheduled CI job that builds
the current release's report, summarizes a bounded report history, renders it into `$GITHUB_STEP_SUMMARY`, and
fails closed.
