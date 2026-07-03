# Release evidence policy assertions — example fixtures

Content-free fixtures for `pnpm worker:release-policy` (Phase 49). The policy evaluates a small,
explicit set of operator thresholds against a `pdfxyz.release-index/1` manifest (Phase 48) — or an
in-process index of `pdfxyz.release-artifact/1` files (Phase 47) — and answers one question for
CI/operators: **“Is this release evidence archive acceptable under our explicit release policy?”**

Everything here is **content-free**: bounded enums, small counts, coarse age buckets, ISO stamps, and
app-authored prose only — no filename, path, object key, bucket, URL, raw ref, raw label, commit URL,
size, or byte. It is local bounded policy **evaluation** over content-free evidence, **not** signing,
auth, cloud validation, storage retention enforcement, or deployment promotion. A passing gate
authorizes nothing on its own.

## Input index fixtures (the archive the policy reads)

Each is a valid `pdfxyz.release-index/1` manifest, except the last two, which are deliberately broken
to prove the policy **fails closed**:

| File | Archive verdict | What it exercises |
| --- | --- | --- |
| `index-clean.json` | `ok` | three recent `pass` builds — passes a full acceptance policy |
| `index-mixed.json` | `ok` | `pass`/`warn`/`fail`/`pass` history — trips `--max-fail` / `--max-warn` |
| `index-drift.json` | `warn` | four builds over a `--max-artifacts=2` cap — over-retention drift |
| `index-empty.json` | `unknown` | zero indexed artifacts — an empty archive is never a pass |
| `index-tampered.json` | `invalid` | a valid index that honestly reports a **tampered artifact** inside |
| `index-inconsistent.json` | (`ok` self-report) | its `rollup.verdict` was flipped to `ok` while its counts say `invalid` — a **smuggle** the consistency check rejects |

`index-tampered.json` is well-formed and internally consistent — it truthfully reports an archive that
contains a tampered artifact (its archive-health is `invalid`), so **any** policy fails it.
`index-inconsistent.json` is the smuggle attack: its self-reported clean verdict contradicts its own
counts, so the policy recomputes the archive-health from those counts and rejects the manifest.

## Example invocations

```sh
# Clean archive under a full acceptance policy → PASS (exit 0)
pnpm worker:release-policy --index=docs/examples/release-policy/index-clean.json \
  --require-clean --require-latest-ok --min-artifacts=3 --max-fail=0

# A failed build in history under a zero-fail policy → FAIL (exit 4)
pnpm worker:release-policy --index=docs/examples/release-policy/index-mixed.json --max-fail=0

# Retention drift is a warning-only concern → WARN (exit 3)
pnpm worker:release-policy --index=docs/examples/release-policy/index-drift.json --forbid-over-retention

# An empty archive can never pass → UNKNOWN (exit 2)
pnpm worker:release-policy --index=docs/examples/release-policy/index-empty.json

# A tampered / self-contradicting index fails closed → FAIL (exit 4)
pnpm worker:release-policy --index=docs/examples/release-policy/index-tampered.json
pnpm worker:release-policy --index=docs/examples/release-policy/index-inconsistent.json

# Strongest mode: index raw artifacts in-process (re-verifying every digest), then gate
pnpm worker:release-policy \
  --artifact=docs/examples/release-index/artifact-pass-recent.json \
  --artifact=docs/examples/release-index/artifact-pass-old.json \
  --require-clean --min-artifacts=2 --max-age-bucket=30-90d
```

## Policy surface (all optional; an unset flag asserts nothing)

Blocking (a violation ⇒ `fail`, exit 4):
`--require-clean`, `--require-latest-ok`, `--max-invalid=N`, `--max-fail=N`, `--min-artifacts=N`,
`--max-artifacts=N`, `--max-age-bucket=<bucket>` (one of `<1h`, `1-24h`, `1-7d`, `7-30d`, `30-90d`, `90d+`).

Warning-only (a violation ⇒ at most `warn`, exit 3):
`--max-warn=N`, `--max-skipped=N`, `--forbid-over-retention`.

## CI workflow example

- `docs/examples/deployment/github-actions/release-policy-fixture.yml` — a content-free GitHub Actions
  workflow wiring the full chain `worker:release-gate` → `worker:release-artifact` →
  `worker:release-index` → `worker:release-policy` as a fail-closed release gate (it accepts a clean
  archive, then asserts a blocking violation fails to exit `4` and a misused CLI to exit `1`). Copy it
  into `.github/workflows/` and adapt the policy flags to your release rules. Validated by
  `pnpm deploy:examples:check`.

## Exit codes

`0` pass · `1` usage (CLI misuse) · `2` unknown (no readable index / empty archive) · `3` warn
(warning-only concern) · `4` fail (a blocking violation or an invalid/tampered index).
