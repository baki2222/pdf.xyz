# Release decision closeout governance finalize index — content-free example fixtures

These committed fixtures are **content-free** `pdfxyz.release-decision-closeout-governance-finalize/1` finalization
bundles (Phase 74 output) plus one non-finalize decoy. They exist so the
`worker:release-decision-closeout-governance-finalize-index` (Phase 75) tests, the deployment-example workflow, and an
operator can drive the index over a real, self-consistent history **offline** — no bucket, no network, no secrets.

The index ingests a **bounded history** of these bundles (oldest first, newest **last**), RE-VALIDATES each against
itself (re-deriving its Phase 74 finalization rollup from its own recorded facets, so a hand-edited verdict is caught as
a tamper), and folds them into ONE `pdfxyz.release-decision-closeout-governance-finalize-index/1` summary. It answers one
question: *across the recent finalization bundles, is the latest finalization state consistently finalized, or is the
latest / recent history open, incomplete, blocked, or untrustworthy?* It is a content-free review **SUMMARY** — NOT a
legal audit log, a compliance attestation, an external approval / signature, an identity proof, or a deployment /
promotion ledger, and it signs / approves / promotes / mutates nothing.

## Fixtures

| File | Kind | Its own finalization verdict |
| --- | --- | --- |
| `finalize-finalized.json` | usable | `finalized` (a completed primary receipt) |
| `finalize-finalized-coherent.json` | usable | `finalized` (completed receipt + coherent plan + trend cross-checks) |
| `finalize-open.json` | usable | `finalize-open` (a followup-open primary receipt) |
| `finalize-incomplete.json` | usable | `finalize-incomplete` (an incomplete primary receipt) |
| `finalize-blocked.json` | usable | `finalize-blocked` (a blocked primary receipt) |
| `finalize-tampered.json` | tampered | claims `finalize-blocked`, but its rollup does not re-derive |
| `not-a-finalize.json` | unreadable | not a recognized finalization bundle |

## Index outcomes (drive them yourself)

```bash
D=docs/examples/release-decision-closeout-governance-finalize-index

# A coherent all-finalized history → indexed (exit 0).
pnpm worker:release-decision-closeout-governance-finalize-index \
  --file=$D/finalize-finalized.json --file=$D/finalize-finalized-coherent.json --text

# A latest-open history → index-open (exit 3).
pnpm worker:release-decision-closeout-governance-finalize-index \
  --file=$D/finalize-finalized.json --file=$D/finalize-open.json

# A latest-incomplete history → index-incomplete (exit 2).
pnpm worker:release-decision-closeout-governance-finalize-index \
  --file=$D/finalize-finalized.json --file=$D/finalize-incomplete.json

# A blocked bundle (latest or anywhere) → index-blocked (exit 4).
pnpm worker:release-decision-closeout-governance-finalize-index \
  --file=$D/finalize-finalized.json --file=$D/finalize-blocked.json

# A tampered OR unreadable bundle → index-invalid (exit 4), the top precedence — never a vacuous pass.
pnpm worker:release-decision-closeout-governance-finalize-index \
  --file=$D/finalize-finalized.json --file=$D/finalize-tampered.json
pnpm worker:release-decision-closeout-governance-finalize-index --file=$D/not-a-finalize.json

# --strict-open escalates an open history to a hard block (exit 4).
pnpm worker:release-decision-closeout-governance-finalize-index \
  --file=$D/finalize-finalized.json --file=$D/finalize-open.json --strict-open

# --max-open tolerates a bounded number of OLDER opens when the latest is finalized → indexed (exit 0).
pnpm worker:release-decision-closeout-governance-finalize-index \
  --file=$D/finalize-open.json --file=$D/finalize-finalized.json --max-open=1

# --require-latest-finalized demands a finalized latest, else index-incomplete (exit 2).
pnpm worker:release-decision-closeout-governance-finalize-index \
  --file=$D/finalize-finalized.json --file=$D/finalize-incomplete.json --require-latest-finalized
```

## Exit codes

`0` indexed · `1` usage · `2` incomplete (coverage gap / require-latest miss) · `3` open · `4` blocked · `4` invalid
(a tampered / unreadable bundle; a distinct verdict, same exit as blocked).
