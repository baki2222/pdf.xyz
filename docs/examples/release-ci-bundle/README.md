# Release evidence CI bundle — example fixtures

Content-free fixtures for `pnpm worker:release-ci-bundle` (Phase 50). The CI bundle **ingests** whichever
of the content-free release-evidence stage outputs a release job produced — a
`pdfxyz.worker-release-gate/1` report, a `pdfxyz.release-artifact/1` file, a `pdfxyz.release-index/1`
manifest, and/or a `pdfxyz.release-policy/1` result — **re-verifies their internal + cross-stage
consistency**, and folds them into one stable bundle: per-stage summaries, the consistency links, a
rollup verdict, which stage outputs to archive, the next safe operator action, and an exit code.

Everything here is **content-free**: bounded enums, small counts, booleans, ISO stamps, and app-authored
prose only — no filename, path, object key, bucket, URL, raw ref, raw label, commit URL, size, digest, or
byte. It is local content-free **bundling + consistency checking** over evidence, **not** signing, auth,
cloud validation, storage retention enforcement, or deployment promotion. It runs no stage itself,
contacts no cloud, and mutates nothing.

## Stage fixtures (the chain the bundle composes)

These four files form ONE mutually coherent chain — the gate matches the artifact's archived gate, the
index indexes that artifact, and the policy was evaluated over that index:

| File | Stage | Verdict | Notes |
| --- | --- | --- | --- |
| `gate-pass.json` | `pdfxyz.worker-release-gate/1` | `pass` | every included readiness check passed |
| `artifact-pass.json` | `pdfxyz.release-artifact/1` | `pass` | a clean, integrity-stamped evidence artifact (its digest re-verifies) |
| `index-pass.json` | `pdfxyz.release-index/1` | `ok` | a one-artifact retention manifest that indexes `artifact-pass.json` |
| `policy-pass.json` | `pdfxyz.release-policy/1` | `pass` | `--require-clean --min-artifacts=1` over `index-pass.json` |

And one deliberately **incoherent** stage, to prove fail-closed cross-stage checking:

| File | Stage | Verdict | Notes |
| --- | --- | --- | --- |
| `policy-mismatch.json` | `pdfxyz.release-policy/1` | `pass` | evaluated over a **different, two-artifact** index — it disagrees with `index-pass.json` |

## What the bundle decides

| Inputs | Rollup | Exit | Why |
| --- | --- | --- | --- |
| gate + artifact + index + policy (all four above) | `pass` | `0` | every stage passed **and** all six consistency links held |
| `index-pass.json` + `policy-mismatch.json` | `fail` | `4` | `index-policy-agreement` **mismatch** — the policy was evaluated over a different index |
| `gate-pass.json` alone | `unknown` | `2` | `incomplete-chain` — a single build's gate is not an end-to-end archive decision |

The six consistency links the bundle verifies:

- **`artifact-digest`** — the artifact re-verifies its own integrity digest in-process (tamper-evidence).
- **`index-self-consistent`** — the index recomputes its archive verdict from its own counts.
- **`policy-self-consistent`** — the policy re-derives its rollup verdict from its own facts (defeats a
  flipped `rollup.verdict` smuggling a tampered archive past the gate).
- **`gate-artifact-agreement`** — the artifact archived the same gate verdict as the standalone gate.
- **`artifact-index-inclusion`** — the artifact's recomputed digest prefix appears among the index's
  verified entries.
- **`index-policy-agreement`** — the policy's effective archive verdict + indexed count match the index.

A `mismatch` on any link is a **blocking inconsistency** (⇒ `fail`); a link whose stages were not all
supplied is `skipped` — never a silent pass.

## Run it

```sh
# Compose the whole coherent chain → pass (exit 0)
pnpm worker:release-ci-bundle \
  --release-gate=docs/examples/release-ci-bundle/gate-pass.json \
  --release-artifact=docs/examples/release-ci-bundle/artifact-pass.json \
  --release-index=docs/examples/release-ci-bundle/index-pass.json \
  --release-policy=docs/examples/release-ci-bundle/policy-pass.json \
  --json

# A policy evaluated over a DIFFERENT index → fail closed (exit 4)
pnpm worker:release-ci-bundle \
  --release-index=docs/examples/release-ci-bundle/index-pass.json \
  --release-policy=docs/examples/release-ci-bundle/policy-mismatch.json --text

# A single build's gate, no archive-decision stage → unknown (exit 2)
pnpm worker:release-ci-bundle --release-gate=docs/examples/release-ci-bundle/gate-pass.json --json
```

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | **pass** — every supplied stage passed and the stages agree |
| `1` | **usage** — the CLI was misused (a bad flag, no stage supplied, or an unwritable output) |
| `2` | **unknown** — an unreadable/indeterminate stage, or no archive-decision stage (index/policy) |
| `3` | **warn** — an advisory stage verdict was raised (a non-blocking concern) |
| `4` | **fail** — a stage failed, or two stages disagree (a blocking inconsistency / tamper) |

See `docs/examples/deployment/github-actions/release-ci-bundle-fixture.yml` for the full
release-gate → release-artifact → release-index → release-policy → **release-ci-bundle** CI job.
