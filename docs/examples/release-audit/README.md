# Release evidence audit / diff — example fixtures

Content-free fixtures for `pnpm worker:release-audit` (Phase 51). The audit **ingests** two (or a history
of) content-free `pdfxyz.release-ci-bundle/1` bundles a release job already produced — a **baseline** and a
**current** — **re-validates each bundle against itself** (re-deriving its Phase 50 rollup, so a hand-
flipped bundle verdict is caught as a tamper), **diffs** their bounded postures, and folds the differences
into one stable audit result: per-slot summaries, the regression findings, a rollup verdict, an exit code,
and the next safe operator action. It answers ONE question a CI regression gate / operator handoff needs —
*"did this release's evidence posture **regress** versus a baseline/history, and what bounded next action
should the operator take?"* — and **fails closed** when a bundle cannot be trusted or the posture regressed
in a blocking way.

Everything here is **content-free**: bounded enums, small counts/deltas, ISO stamps, and app-authored prose
only — no filename, path, object key, bucket, URL, raw ref, raw label, commit URL, size, digest, or byte,
even from a hostile bundle input. It is local content-free **audit / diff over evidence**, **not** signing,
authentication, cloud validation, storage retention enforcement, or deployment promotion. It runs no stage
or bundle itself, contacts no cloud, and deletes / prunes / uploads / promotes / mutates nothing.

> **A `pass` only means the current bundle did not regress versus the baseline — not that the current
> bundle is itself acceptable.** Gate the current bundle on its own with `worker:release-ci-bundle` /
> `worker:release-policy` too: a baseline and a current that are **both** failing shows "no regression"
> here, which is honest scope, not an endorsement.

## Bundle fixtures

Each file is a genuine, self-consistent `pdfxyz.release-ci-bundle/1` bundle (its recorded rollup re-derives
from its own stages + consistency links), so the audit's trust boundary marks it `usable` — except
`current-tampered.json` (a hand-flipped verdict) and `not-a-bundle.json` (a wrong schema), which prove the
fail-closed paths.

| File | Bundle posture | Role in the diff |
| --- | --- | --- |
| `baseline-pass.json` | `pass` | the last accepted release (the baseline) |
| `current-pass.json` | `pass` | a current release with no regression |
| `current-warn.json` | `warn` | a current release whose posture **softened** (an advisory drift) |
| `current-fail.json` | `fail` | a current release that **failed** (a blocking regression) |
| `current-tampered.json` | `pass` (claimed) | a bundle whose recorded verdict does **not** re-derive — a tamper |
| `not-a-bundle.json` | — | not a recognized `pdfxyz.release-ci-bundle/1` (an unreadable input) |

## What the audit decides

| Baseline → Current | Rollup | Exit | Why |
| --- | --- | --- | --- |
| `baseline-pass.json` → `current-pass.json` | `pass` | `0` | the current posture is at least as strong as the baseline |
| `baseline-pass.json` → `current-warn.json` | `warn` | `3` | a **non-blocking** drift: the posture softened / advisory pressure rose |
| `baseline-pass.json` → `current-fail.json` | `fail` | `4` | a **blocking** regression: the current bundle dropped to `fail` |
| `baseline-pass.json` → `current-tampered.json` | `fail` | `4` | a recognized bundle whose recorded verdict does not re-derive (a tamper) |
| `baseline-pass.json` → `not-a-bundle.json` | `unknown` | `2` | an unreadable bundle — the comparison could not be made (never a "no regression") |

The regression checks the audit evaluates, in order: `bundle-tampered`, `bundle-unreadable`,
`verdict-worsened`, `consistency-broke`, `consistency-weakened`, `coverage-dropped`,
`archive-decision-worsened`, `warnings-increased`. Each reduces to a bounded, deterministic comparison over
the two bundles' already content-free facts; a `bundle-tampered` or a blocking regression is `fail`, an
unreadable bundle or too little history is `unknown`, and an advisory drift is `warn`.

## Run it

```sh
# Diff a current bundle against the last accepted baseline → pass (exit 0)
pnpm worker:release-audit \
  --baseline=docs/examples/release-audit/baseline-pass.json \
  --current=docs/examples/release-audit/current-pass.json \
  --json

# A softened posture is a non-blocking drift → warn (exit 3); accept it deliberately with the flag
pnpm worker:release-audit \
  --baseline=docs/examples/release-audit/baseline-pass.json \
  --current=docs/examples/release-audit/current-warn.json --text
pnpm worker:release-audit \
  --baseline=docs/examples/release-audit/baseline-pass.json \
  --current=docs/examples/release-audit/current-warn.json --allow-warn-regression   # exit 0

# A failed or a TAMPERED current fails closed → fail (exit 4)
pnpm worker:release-audit \
  --baseline=docs/examples/release-audit/baseline-pass.json \
  --current=docs/examples/release-audit/current-fail.json --json
pnpm worker:release-audit \
  --baseline=docs/examples/release-audit/baseline-pass.json \
  --current=docs/examples/release-audit/current-tampered.json --json

# An unreadable bundle → unknown (exit 2), never a fabricated pass
pnpm worker:release-audit \
  --baseline=docs/examples/release-audit/baseline-pass.json \
  --current=docs/examples/release-audit/not-a-bundle.json --json

# History mode: a chronological list (newest LAST) — diffs the last two + a trend over the whole list
pnpm worker:release-audit \
  --bundle=docs/examples/release-audit/baseline-pass.json \
  --bundle=docs/examples/release-audit/current-pass.json \
  --bundle=docs/examples/release-audit/current-warn.json --text
```

## Policy knobs

| Flag | Effect |
| --- | --- |
| `--allow-warn-regression` | report warn-level drift but do **not** fail on it (exit 0 instead of 3) |
| `--max-new-warnings=N` | tolerate up to N new advisory signals before `warnings-increased` fires (default 0) |
| `--fail-on-unknown` | treat a drop to an **uncertified** (unknown) posture as a **blocking** regression |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | **pass** — no regression (or only warn-level drift accepted via `--allow-warn-regression`) |
| `1` | **usage** — the CLI was misused (a bad flag, missing/duplicated inputs, or an unwritable output) |
| `2` | **unknown** — an unreadable bundle, or too little comparable history |
| `3` | **warn** — a non-blocking regression / advisory drift |
| `4` | **fail** — a blocking regression, or a recognized-but-self-inconsistent (tampered) bundle |

See `docs/examples/deployment/github-actions/release-audit-fixture.yml` for the full CI regression-gate
job that compares a previous release's bundle against the current build's bundle.
