# Release decision closeout governance finalize index trend — FINALIZATION INDEX examples (Phase 80)

Content-free example fixtures for `pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index`.

The worker indexes a bounded history of Phase 79 `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize/1` records. It re-validates every finalization record against itself, drops prose/stamps/paths, folds only bounded verdict/count/checklist facets, and emits ONE `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index/1` review summary.

## Fixtures

| Fixture | Purpose |
|---|---|
| `finalize-finalized.json` | A self-consistent finalized record. |
| `finalize-finalized-coherent.json` | A second coherent finalized record for multi-record index windows. |
| `finalize-open.json` | A coherent open finalization record. |
| `finalize-incomplete.json` | A coherent incomplete finalization record. |
| `finalize-blocked.json` | A coherent blocked finalization record. |
| `finalize-tampered.json` | A recognized finalization record whose rollup does not re-derive. |
| `not-a-finalize.json` | A wrong-schema decoy that must fail closed as unreadable/invalid. |

## Smoke examples

```bash
# Coherent finalized history → indexed (exit 0).
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index \
  --file=finalize-finalized.json --file=finalize-finalized-coherent.json

# Latest open → index-open (exit 3).
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index \
  --file=finalize-finalized.json --file=finalize-open.json

# Latest incomplete → index-incomplete (exit 2).
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index \
  --file=finalize-finalized.json --file=finalize-incomplete.json

# Any blocked finalization → index-blocked (exit 4).
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index \
  --file=finalize-finalized.json --file=finalize-blocked.json

# Tampered / wrong-schema input → index-invalid (exit 4), never indexed.
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index --file=finalize-tampered.json
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index --file=not-a-finalize.json

# From stdin as JSON array / NDJSON.
printf '[%s,%s]' "$(cat finalize-finalized.json)" "$(cat finalize-finalized-coherent.json)" | \
  pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index --stdin
cat finalize-finalized.json finalize-finalized-coherent.json | \
  pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index --stdin
```

## Privacy boundary

The index is a local, offline, read-only review summary. It does not run any release gate, index, decision, trend, action plan, receipt, closeout, governance, or finalization worker itself. It does not sign, approve, publish, promote, deploy, notify, delete, mutate, or call GitHub/cloud services. It is not a legal audit log, compliance attestation, external approval/signature, identity proof, deployment authorization, promotion ledger, or incident record.

A committed GitHub Actions example lives at `docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-finalize-index-fixture.yml`.
