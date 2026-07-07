# Release decision closeout governance finalize-index-trend finalize-index-trend closeout-index-trend closeout-index-trend closeout — example fixtures

Content-free example inputs for
`pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout`
(Phase 94). Every file here is a **real, self-consistent** record produced by the shipped release-evidence workers and
committed so the closeout's behavior is provable offline — there are **no secrets, buckets, paths, identities, digests, or
timestamps** in any of them, only bounded enums, small integer counts, and booleans.

The closeout is a **content-free operational closeout SUMMARY ONLY** — NOT a legal / compliance sign-off, an external
approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit
log. It is offline and read-only: it ingests records the release-decision workers already produced, re-validates them, and
records whether the closeout-index-trend follow-up loop reads as **closed out**. It archives / approves / signs /
publishes / promotes / deploys / notifies / mutates **nothing**.

## What it ingests

A REQUIRED primary receipt plus OPTIONAL related records already on hand:

| Flag | Schema | Role |
| --- | --- | --- |
| `--receipt` (alias `--file`, or `--stdin`) | `…-closeout-index-trend-closeout-index-trend-action-receipt/1` (Phase 93) | the ONE receipt to close out |
| `--plan` | `…-closeout-index-trend-closeout-index-trend-action-plan/1` (Phase 92) | cross-check: the plan the receipt receipted |
| `--trend` | `…-closeout-index-trend-closeout-index-trend/1` (Phase 91) | cross-check: the trend the plan planned over |

Make a related record MANDATORY with `--require-plan` / `--require-trend` (its absence is a coverage gap ⇒ `incomplete`).

## Fixtures

Primary receipts (Phase 93 `…-closeout-index-trend-closeout-index-trend-action-receipt/1`):

- `receipt-completed.json` — a clear plan reviewed AND accepted for routine monitoring → receipt verdict `completed`.
- `receipt-followup-open.json` — a monitor plan reviewed but its follow-up not acknowledged → `followup-open`.
- `receipt-incomplete.json` — a clear plan NOT acknowledged as reviewed → `incomplete`.
- `receipt-blocked.json` — a block plan not acknowledged as held → `blocked`.
- `receipt-invalid.json` — a receipt whose receipted plan was unreadable → receipt verdict `invalid`.
- `receipt-tampered.json` — a `completed` receipt with a hand-flipped recorded verdict (does not re-derive).
- `not-a-receipt.json` — a decoy carrying a different schema tag (unreadable).

Related records:

- `plan-coherent.json` / `plan-contradictory.json` / `plan-tampered.json` — Phase 92 plans (the coherent one is the plan
  `receipt-completed.json` receipted; the contradictory one is a different class; the tampered one no longer re-derives).
- `trend-coherent.json` / `trend-contradictory.json` — Phase 91 trends (`stable` matches the receipt's recorded
  source-trend verdict; `degrading` does not).

## The verdict ladder (exit codes)

| Verdict | Exit | When |
| --- | --- | --- |
| `closed` | 0 | usable, `completed` receipt AND every supplied related record coherent |
| `open` | 3 | `followup-open` receipt |
| `incomplete` | 2 | `incomplete` receipt, or a missing required related record |
| `blocked` | 4 | `blocked` receipt, or a `--strict-open` escalation of an open closeout |
| `invalid` | 4 | missing / unreadable / tampered / wrong-schema receipt, an `invalid` receipt verdict, or a supplied related record that contradicts the receipt / is tampered / is unreadable (an incoherent chain) |

(`1` is a distinct **usage** band — a bad flag, no receipt supplied, or an unwritable output.)

## Examples

```bash
# Closed: a completed receipt with the coherent plan / trend it was built from (exit 0).
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout \
  --receipt=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/receipt-completed.json \
  --plan=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/plan-coherent.json \
  --trend=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/trend-coherent.json \
  --text

# Invalid: a contradictory plan (not the one the receipt receipted) is an incoherent chain and fails closed (exit 4).
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout \
  --receipt=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/receipt-completed.json \
  --plan=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/plan-contradictory.json

# Open: a followup-open receipt (exit 3); add --strict-open to escalate it to a hard block (exit 4).
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout \
  --receipt=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/receipt-followup-open.json

# Invalid: a tampered receipt document (exit 4), never a vacuous closed closeout.
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout \
  --receipt=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/receipt-tampered.json
```

Wire it as a **scheduled or on-demand governance step**, not a per-release gate: fail the review on exit 4 (blocked /
invalid), surface exit 3 (open) and exit 2 (incomplete) for review, and treat exit 0 (closed) as closed-out — never as an
authorization. See `docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-fixture.yml`
for a full offline workflow.
