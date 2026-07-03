# Release evidence index / retention manifest — example fixtures

Content-free fixtures for `pnpm worker:release-index` (Phase 48). The index ingests one or more
`pdfxyz.release-artifact/1` files (Phase 47), **re-verifies each one's integrity digest**, and folds
their bounded facts into one stable retention manifest — a rollup verdict, per-verdict and
per-digest-status counts, a bounded newest/oldest age span, a retention posture (over-count /
over-age / stale), and a bounded per-artifact summary.

Everything here is **content-free**: bounded enums, small counts, coarse age buckets, short hex digest
prefixes, ISO stamps, and app-authored prose only — no filename, path, object key, bucket, URL, raw
ref, raw label, commit URL, size, or byte. It is local content-free **indexing + digest verification**,
**not** storage retention enforcement, signing, auth, cloud validation, or promotion.

## Input artifact fixtures (the archive the index reads)

Each is a valid `pdfxyz.release-artifact/1` with a **correct** integrity digest, except the last:

| File | Archived verdict | Notes |
| --- | --- | --- |
| `artifact-pass-recent.json` | `pass` | recent, clean, `v1.4.0` release branch — promote-able |
| `artifact-warn-dirty.json` | `warn` | gate warned + dirty tree, `nightly`, ops-bundle attached |
| `artifact-pass-old.json` | `pass` | old but clean, `v1.3.0` — trips a 90-day retention cap |
| `artifact-fail.json` | `fail` | a faithfully-archived failed build — history, not an index fault |
| `artifact-tampered.json` | (`pass` body) | its stored digest was altered — the index catches it (`invalid`) |

## Output fixture (a sample manifest)

- `index.sample.json` — the manifest produced by indexing the **four valid** artifacts with
  `--max-artifacts=10 --max-age-days=180` at a fixed clock of `2026-07-03T00:00:00.000Z`. It resolves
  `ok` (exit 0): the archive is **intact** (every digest verified) and **within retention**. Note that
  its `verdictCounts` still reports `fail=1` — the index tallies the archived build verdicts
  transparently, but the **rollup** is about archive integrity + retention, not a re-judgement of each
  build's promotion readiness.

## Try it

```bash
# Index the whole archive at real time — the tampered artifact fails digest re-verification (exit 4).
pnpm worker:release-index docs/examples/release-index/artifact-*.json --text

# Just the four valid artifacts, with retention bounds — flags over-count + over-age (exit 3).
pnpm worker:release-index \
  --artifact=docs/examples/release-index/artifact-pass-recent.json \
  --artifact=docs/examples/release-index/artifact-warn-dirty.json \
  --artifact=docs/examples/release-index/artifact-pass-old.json \
  --artifact=docs/examples/release-index/artifact-fail.json \
  --max-artifacts=3 --max-age-days=90 --text

# A JSON array on stdin instead of file flags.
cat > /tmp/artifacts.json <<'JSON'
[]
JSON
cat /tmp/artifacts.json | pnpm worker:release-index --text   # empty archive → unknown (exit 2)
```

## Exit codes

`0` ok · `1` usage (bad flag / non-numeric bound / unwritable output) · `2` insufficient (empty
archive / internal fault) · `3` warn (retention drift / stale / skipped non-artifact) · `4` invalid (a
tampered / corrupt artifact failed digest re-verification).
