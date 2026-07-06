# Release decision closeout governance finalize index trend — FINALIZATION record examples (Phase 79)

Content-free example fixtures for `pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize`.

The worker FINALIZES the finalize-index-trend follow-up loop. It ingests a **required** Phase 78
`pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-receipt/1` primary receipt plus, **optionally**, the
source-chain records it was built from — the Phase 77 follow-up plan (`--plan`), the Phase 76 finalize-index trend
(`--trend`), the Phase 75 finalize index (`--index`), and the Phase 74 finalization bundle (`--finalization`) — RE-VALIDATES
each supplied record against ITSELF through the existing Phase 74–78 boundaries (so a hand-flipped verdict is caught as a
tamper), CROSS-CHECKS each supplied record against what its downstream record recorded (a swapped / edited record is a
contradiction), folds every supplied record's own bounded posture, and emits ONE stable
`pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize/1` record: a finalization verdict, a source-chain
checklist, bounded reasons, a compact `nextActions` id list, and a content-free receipt.

It answers ONE question a governance review needs — **"given the content-free finalization-index trend follow-up receipt and
optional source-chain records, is this follow-up loop finalized, open, incomplete, blocked, or untrustworthy?"** — and FAILS
CLOSED when the receipt cannot be trusted or a supplied record contradicts / blocks the loop.

It is **local, offline, and read-only**: it runs no gate / index / decision / trend / finalize / plan / governance /
closeout / receipt itself, makes no network call, reads no secret / bucket / object, and NEVER signs, approves, publishes,
promotes, deploys, notifies, deletes, or mutates anything. It is a content-free operational **finalization record ONLY** —
NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a
promotion ledger, an incident record, or an audit log. It carries no reviewer identity, filename, path, object key, bucket,
URL, raw ref, raw label, raw note, size, digest, or byte, and never echoes an ingested record's own stamp.

## Fixtures

Every fixture is a **real, self-consistent** document produced by the shipped Phase 74–78 builders. The receipts form a
coherent chain with the coherent source-chain records below.

| File | Role | Finalize verdict over it |
| --- | --- | --- |
| `receipt-completed.json` | a Phase 78 `completed` receipt (a reviewed clear plan) | `finalized` (exit 0) |
| `receipt-incomplete.json` | a Phase 78 `incomplete` receipt (a monitor plan not fully acknowledged) | `finalize-incomplete` (exit 2) |
| `receipt-blocked.json` | a Phase 78 `blocked` receipt (a block-release plan held) | `finalize-blocked` (exit 4) |
| `receipt-invalid.json` | a Phase 78 receipt whose OWN verdict is `invalid` (its plan was untrusted) | `finalize-blocked` (exit 4) |
| `receipt-advisory.json` | a Phase 78 `completed` receipt over a degrading (monitor) chain | pairs with `trend-advisory.json` → `finalize-open` (exit 3) |
| `receipt-tampered.json` | a hand-flipped `completed` receipt (its decision no longer re-derives) | `finalize-invalid` (exit 4) |
| `not-a-receipt.json` | a wrong-schema decoy | `finalize-invalid` (exit 4) |
| `plan-coherent.json` | the Phase 77 plan `receipt-completed.json` receipted (a clear plan) | coherent `--plan` cross-check |
| `plan-contradictory.json` | a **different** Phase 77 plan (an investigate plan) | contradictory `--plan` → `finalize-blocked` |
| `trend-coherent.json` | the Phase 76 trend the plan folded (a stable trend) | coherent `--trend` cross-check |
| `trend-advisory.json` | a Phase 76 degrading trend (an advisory posture) | pairs with `receipt-advisory.json` → `finalize-open` |
| `index-coherent.json` | the Phase 75 index window matching the trend's newest window (`indexed`) | coherent `--index` cross-check |
| `index-blocked.json` | a Phase 75 `index-blocked` window (does not match a stable trend's newest window) | contradictory `--index` → `finalize-blocked` |
| `finalization-coherent.json` | the Phase 74 finalization matching the index's latest finalization (`finalized`) | coherent `--finalization` cross-check |

## Fail-closed precedence

The finalization verdict follows the worst fired reason's severity, in this order (higher outranks lower — note
**INCOMPLETE outranks OPEN**, so a coverage gap is resolved before an advisory open follow-up):

`invalid > blocking > incomplete > open > informational`

1. an unreadable / tampered / wrong-schema **primary receipt** ⇒ `finalize-invalid`;
2. any **tampered supplied source** ⇒ `finalize-invalid`;
3. any **contradiction** (a supplied record disagrees with what its downstream record recorded) ⇒ `finalize-blocked`;
4. a receipt whose OWN verdict is `blocked` or `invalid` ⇒ `finalize-blocked`;
5. a missing required record (`--require-<kind>`) ⇒ `finalize-incomplete`;
6. an `incomplete` receipt ⇒ `finalize-incomplete` (escalated to `finalize-blocked` by `--strict-open`);
7. an advisory / open source chain (a monitor plan, a watch / degrading trend, an index-open window, a finalize-open
   finalization) ⇒ `finalize-open` (escalated to `finalize-blocked` by `--strict-open`);
8. a `completed` receipt and a coherent source chain ⇒ `finalized`.

## Run it

```bash
# A completed receipt alone → finalized (exit 0).
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize --receipt=receipt-completed.json

# A completed receipt + every coherent source-chain record → finalized (exit 0), 4 coherent.
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize \
  --receipt=receipt-completed.json --plan=plan-coherent.json --trend=trend-coherent.json \
  --index=index-coherent.json --finalization=finalization-coherent.json --text

# An incomplete receipt → finalize-incomplete (exit 2).
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize --receipt=receipt-incomplete.json

# A required-but-missing record → finalize-incomplete (exit 2).
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize --receipt=receipt-completed.json --require-index

# An advisory chain → finalize-open (exit 3); --strict-open escalates it to blocked (exit 4).
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize --receipt=receipt-advisory.json --trend=trend-advisory.json
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize --receipt=receipt-advisory.json --trend=trend-advisory.json --strict-open

# A blocked / invalid-verdict receipt → finalize-blocked (exit 4).
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize --receipt=receipt-blocked.json
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize --receipt=receipt-invalid.json

# A contradictory source-chain record → finalize-blocked (exit 4).
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize --receipt=receipt-completed.json --plan=plan-contradictory.json

# A tampered receipt or a non-receipt decoy → finalize-invalid (exit 4).
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize --receipt=receipt-tampered.json
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize --receipt=not-a-receipt.json

# From stdin.
cat receipt-completed.json | pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize --stdin
```

## Policy flags

| Flag | Effect |
| --- | --- |
| `--require-plan` / `--require-trend` / `--require-index` / `--require-finalization` | require a usable record of that kind; else the loop is INCOMPLETE (exit 2) |
| `--strict-open` | escalate an open finalization (an advisory source chain) or an incomplete primary receipt to a hard block (exit 4) |

## Exit codes

| Code | Verdict | Meaning |
| --- | --- | --- |
| `0` | `finalized` | a usable, completed receipt and every supplied source-chain record coherent |
| `1` | usage | the CLI was misused (a bad flag, no primary receipt supplied, or an unwritable output) |
| `2` | `finalize-incomplete` | an incomplete receipt, a required-but-missing / unreadable record, or an inconclusive source chain |
| `3` | `finalize-open` | an advisory / open source-chain record |
| `4` | `finalize-blocked` | a blocked / invalid receipt verdict, a contradictory record, a blocked source chain, or a `--strict-open` escalation |
| `4` | `finalize-invalid` | an unreadable / tampered / wrong-schema primary receipt, or a tampered supplied source-chain record |

A committed GitHub Actions example that builds the chain and asserts every fail-closed path lives at
`docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-finalize-fixture.yml`.

## Not a legal record

This finalization record is a content-free operational SUMMARY only. It proves nothing the composed records do not already
prove; it re-validates their self-consistency + chain coherence and rolls them into one finalization posture. Keep your
legal audit trail, compliance sign-off, external approval / signing, identity attestation, storage retention, incident
records, and release-promotion processes in their own dedicated systems.
