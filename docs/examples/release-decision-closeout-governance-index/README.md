# Release decision closeout governance index — example fixtures

Content-free fixtures for `pnpm worker:release-decision-closeout-governance-index` (Phase 70). The governance index
**indexes** a bounded **history** of content-free `pdfxyz.release-decision-closeout-governance/1` governance bundles (the
Phase 69 governance bundles, one per release; repeated `--file`/`--governance`, oldest first / newest last, or a
`--stdin` JSON array / NDJSON stream / single bundle) into ONE `pdfxyz.release-decision-closeout-governance-index/1`
review summary. It **re-validates each bundle against itself** (re-deriving its Phase 69 governance rollup from its own
recorded primary-receipt source facets + per-kind related-record signals + policy, mirroring the Phase 69
`computeGovernance` reducer, so a hand-flipped governance verdict / exit / rollup — or a flipped cross-check / posture
signal — is caught as a tamper), and folds them into the **governance-verdict distribution**
(`closed`/`governance-incomplete`/`governance-open`/`governance-blocked` counts), the **latest / oldest** governance
verdict, a per-record **posture sequence**, a **trend class**
(`all-closed`/`open-present`/`incomplete-present`/`blocked-present`/`tampered-present`/`no-usable`), an **index verdict**
+ bounded **reasons**, and an ordered **next-action checklist** — answering *"across the recent release closeout
governance bundles, is the latest governance state **consistently closed**, or is the latest / recent history **open**,
**incomplete**, or **blocked**?"*

It is **latest-focused**: the newest usable bundle drives the verdict, and bounded history thresholds
(`--max-open`/`--max-incomplete`/`--max-blocked`, each defaulting to `0`) let an operator tolerate a bounded number of
non-closed bundles before the accumulation escalates. Everything here is **content-free**: bounded enums, small counts,
booleans, ISO stamps, and app-authored prose only — no reviewer name / email, filename, path, object key, bucket, URL,
raw ref, raw label, raw note, size, digest, or byte, even from a hostile input, and never any ingested bundle's own
stamp. It is a content-free governance-history **INDEX SUMMARY ONLY** — **not** a legal audit log, a compliance
attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger. It runs no gate /
index / decision / trend / plan / receipt / closeout / governance itself, contacts no cloud, and signs / approves /
publishes / promotes / deletes / mutates nothing.

> **An `indexed` index requires a coherent bounded history: the latest usable bundle `closed`, no tampered / unreadable
> bundle, and the open / incomplete / blocked counts within their thresholds.** A tampered bundle, a
> `governance-blocked` latest / threshold breach, or a `--strict-open` escalation is `index-blocked` (exit 4); an
> unreadable bundle, a `governance-incomplete` latest / threshold breach, or zero usable bundles is `index-incomplete`
> (exit 2); a `governance-open` latest / threshold breach is `index-open` (exit 3). It never fabricates an `indexed` from
> thin or untrusted input.

## Governance-bundle fixtures

Each `governance-*.json` is a genuine `pdfxyz.release-decision-closeout-governance/1` document (its recorded governance
rollup re-derives from its own recorded facets, so the index's trust boundary marks it `usable`).
`governance-tampered.json` (a hand-flipped verdict) and `not-a-governance.json` (a wrong schema) prove the fail-closed
paths.

| File | Governance verdict | Role |
| --- | --- | --- |
| `governance-closed.json` | `closed` | a completed primary receipt, no related records — the chain reads as closed out |
| `governance-closed-coherent.json` | `closed` | a completed receipt cross-checked against a coherent plan + trend |
| `governance-open.json` | `governance-open` | a followup-open receipt — an advisory follow-up still open |
| `governance-incomplete.json` | `governance-incomplete` | a receipt not acknowledged as reviewed |
| `governance-blocked.json` | `governance-blocked` | a block plan not acknowledged as held-blocked |
| `governance-contradictory.json` | `governance-blocked` | a supplied plan that contradicts the receipt (a cross-check mismatch) |
| `governance-tampered.json` | `governance-blocked` (claimed) | a hand-flipped verdict that no longer re-derives (a tamper) |
| `not-a-governance.json` | — | not a recognized governance bundle (an unreadable input) |

## Reproduce the documented index verdicts

Supply the bundles **oldest first, newest last**. The newest usable bundle is the primary driver.

```bash
# A coherent all-closed history → indexed (exit 0)
pnpm worker:release-decision-closeout-governance-index \
  --file=docs/examples/release-decision-closeout-governance-index/governance-closed.json \
  --file=docs/examples/release-decision-closeout-governance-index/governance-closed-coherent.json --text

# A latest-open history → index-open (exit 3); with --strict-open → index-blocked (exit 4)
pnpm worker:release-decision-closeout-governance-index \
  --file=docs/examples/release-decision-closeout-governance-index/governance-closed.json \
  --file=docs/examples/release-decision-closeout-governance-index/governance-open.json --json

# A latest-blocked, contradictory, or tampered bundle → index-blocked (exit 4)
pnpm worker:release-decision-closeout-governance-index \
  --file=docs/examples/release-decision-closeout-governance-index/governance-closed.json \
  --file=docs/examples/release-decision-closeout-governance-index/governance-tampered.json --json

# A latest-incomplete history, or an unreadable decoy → index-incomplete (exit 2)
pnpm worker:release-decision-closeout-governance-index \
  --file=docs/examples/release-decision-closeout-governance-index/governance-closed.json \
  --file=docs/examples/release-decision-closeout-governance-index/not-a-governance.json --json

# Tolerate a bounded backlog: an older open with a closed latest is index-open by default, indexed under --max-open=1
pnpm worker:release-decision-closeout-governance-index \
  --file=docs/examples/release-decision-closeout-governance-index/governance-open.json \
  --file=docs/examples/release-decision-closeout-governance-index/governance-closed.json --max-open=1 --json
```

Exit codes: `0` indexed · `1` usage · `2` index-incomplete · `3` index-open · `4` index-blocked. Emits
`worker_release_decision_closeout_governance_index_total{verdict}`. See the deployment fixture
[`../deployment/github-actions/release-decision-closeout-governance-index-fixture.yml`](../deployment/github-actions/release-decision-closeout-governance-index-fixture.yml)
for the CI wiring, and the module tests under `src/lib/workers/release-decision-closeout-governance-index/` for the
proofs.
