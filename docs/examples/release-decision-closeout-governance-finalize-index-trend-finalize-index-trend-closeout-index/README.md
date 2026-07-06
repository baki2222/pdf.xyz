# Release decision closeout governance finalize index trend finalize index trend — CLOSEOUT INDEX examples (Phase 85)

Content-free example fixtures for `pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index`.

The worker indexes a bounded history of Phase 84 `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout/1` records. It re-validates every closeout record against itself, drops prose/stamps/paths, folds only bounded verdict/count/checklist facets, and emits ONE `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index/1` review summary.

## Fixtures

| Fixture | Purpose |
|---|---|
| `closeout-closed.json` | A self-consistent closed closeout record. |
| `closeout-closed-coherent.json` | A second coherent closed record (coherent plan + trend cross-checks) for multi-record index windows. |
| `closeout-open.json` | A coherent open closeout record. |
| `closeout-incomplete.json` | A coherent incomplete closeout record. |
| `closeout-blocked.json` | A coherent blocked closeout record. |
| `closeout-tampered.json` | A recognized closeout record whose coverage rollup does not re-derive. |
| `not-a-closeout.json` | A wrong-schema decoy that must fail closed as unreadable/invalid. |

## Smoke examples

```bash
# Coherent closed history → indexed (exit 0).
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index \
  --file=closeout-closed.json --file=closeout-closed-coherent.json

# Latest open → index-open (exit 3).
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index \
  --file=closeout-closed.json --file=closeout-open.json

# Latest incomplete → index-incomplete (exit 2).
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index \
  --file=closeout-closed.json --file=closeout-incomplete.json

# Any blocked / invalid-posture closeout → index-blocked (exit 4).
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index \
  --file=closeout-closed.json --file=closeout-blocked.json

# Tampered / wrong-schema input → index-invalid (exit 4), never indexed.
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index --file=closeout-tampered.json
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index --file=not-a-closeout.json

# From stdin as JSON array / NDJSON.
printf '[%s,%s]' "$(cat closeout-closed.json)" "$(cat closeout-closed-coherent.json)" | \
  pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index --stdin
cat closeout-closed.json closeout-closed-coherent.json | \
  pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index --stdin
```

## Privacy boundary

The index is a local, offline, read-only review summary. It does not run any release gate, index, decision, trend, action plan, receipt, closeout, governance, or finalization worker itself. It does not sign, approve, publish, promote, deploy, notify, delete, mutate, or call GitHub/cloud services. It is not a legal audit log, compliance attestation, external approval/signature, identity proof, deployment authorization, promotion ledger, or incident record.

A committed GitHub Actions example lives at `docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-fixture.yml`.
