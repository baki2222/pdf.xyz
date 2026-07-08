# Release decision closeout governance finalize index trend finalize index trend closeout index trend action-plan execution receipt — example fixtures

Content-free fixtures for `pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt`
(Phase 93). The receipt **ingests** ONE content-free
`pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-plan/1`
follow-up plan (Phase 92) a release pipeline already produced plus a small set of **bounded operator acknowledgement
flags**, **re-validates the plan against itself** (reconstructing its Phase 92 bounded decision from the source-trend
details the plan recorded and re-running the Phase 92 `computeActionPlan` reducer, so a hand-flipped plan verdict / action
class / exit code is caught as a tamper), and records whether the operator provided the acknowledgements required to close
it out or hold it: ONE stable
`pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/1`
document with a **receipt verdict**, the resolved **plan class**, a bounded **acknowledgement checklist**, a bounded
rationale + next actions, and a content-free **receipt**. It answers ONE question a governance review needs — *"given this
content-free closeout-index trend action plan, did the operator provide the bounded acknowledgements required to close it
out or hold it, and what is the resulting receipt posture?"* — and **fails closed** when the plan cannot be trusted or a
required acknowledgement is absent.

Everything here is **content-free**: bounded enums, small counts, booleans, ISO stamps, and app-authored prose only — no
reviewer name / email, filename, path, object key, bucket, URL, raw ref, raw label, raw note, size, digest, or byte, even
from a hostile input, and never the ingested plan's own stamp. The acknowledgements are **booleans only** — no free-form
note or actor name. It is a content-free **operational acknowledgement receipt only** — **not** a legal / compliance
sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident
record, or an audit log. It runs no gate / index / decision / trend / finalize / plan / governance / closeout itself,
contacts no cloud, and signs / approves / publishes / promotes / deletes / mutates nothing — even a completed block plan
records the release as **HELD**, never promoted.

> **A `completed` receipt requires a usable plan AND the bounded acknowledgements its class demands.** A missing /
> unreadable / tampered / wrong-schema plan is `invalid` (nothing trustworthy to receipt); a `block-release` plan not
> acknowledged as held-blocked is `blocked` (and even when fully acknowledged it records the release as **held**, never
> promoted); a contradictory acknowledgement is `blocked`; a `monitor` / `investigate` plan reviewed but its follow-up
> acknowledgement absent is `followup-open`; a missing required acknowledgement is `incomplete`. `--strict-open` escalates
> any open follow-up to `blocked`. It never fabricates a completed close-out.

## Plan fixtures

Each `plan-*.json` is a genuine, self-consistent
`pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-plan/1`
document (its recorded plan decision re-derives from its own recorded source facts, so the receipt's trust boundary marks
it `usable`). `plan-tampered.json` (a hand-flipped verdict) and `not-a-plan.json` (a wrong schema) prove the fail-closed
paths.

| File | Plan verdict | Receipt plan class | Role |
| --- | --- | --- | --- |
| `plan-clear.json` | `clear` | `clear` | a coherent stable closeout-index trend — the only follow-up is to keep the cadence |
| `plan-monitor.json` | `monitor` | `monitor` | a `watch` history — a follow-up to track to closure |
| `plan-investigate.json` | `investigate` | `investigate` | an `insufficient`, inconclusive history — evidence to complete |
| `plan-block.json` | `block-release` | `block` | a `blocked` history — hold promotion + reconcile (held until acknowledged) |
| `plan-invalid.json` | `invalid` | `block` | a plan whose SOURCE TREND was untrustworthy (`reject-input`) — a `block`-class hold |
| `plan-tampered.json` | `monitor` (claimed) | — | a hand-flipped verdict that no longer re-derives (a tamper ⇒ `invalid`) |
| `not-a-plan.json` | — | — | not a recognized closeout-index-trend action plan (an unreadable input ⇒ `invalid`) |

Note `plan-invalid.json` is itself a **usable** plan document — a valid Phase 92 plan that *concluded* `invalid`
(`reject-input`, its source trend could not be trusted). The receipt treats it as a **`block`-class hold** (the release
stays held; acknowledging it as held-blocked closes it out), distinct from an untrustworthy **plan document**
(`plan-tampered.json` / `not-a-plan.json`), which is `invalid` regardless of the flags supplied.

## What the receipt records

Which acknowledgements each class **requires** for a `completed` receipt:

| Plan class | Required acknowledgements | Reviewed-but-unacked | Never acknowledged |
| --- | --- | --- | --- |
| `clear` | `--ack-plan` (alias `--ack-reviewed`) + `--ack-clear` | `incomplete` (reviewed, not accepted) | `incomplete` (not reviewed) |
| `monitor` | `--ack-plan` + `--ack-monitor` | `followup-open` (exit 3, advisory) | `incomplete` (not reviewed) |
| `investigate` | `--ack-plan` + `--ack-investigation` | `followup-open` (exit 3, advisory) | `incomplete` (not reviewed) |
| `block` | `--ack-plan` + `--ack-block` | `incomplete` (held but not reviewed) | `blocked` (not acknowledged as blocked) |

Each plan class has exactly **one class acknowledgement** (`--ack-clear` / `--ack-monitor` / `--ack-investigation` /
`--ack-block`); supplying a class ack that does not match the plan's ACTUAL class is a **contradiction** (`blocked`).

The verdict resolves with fail-closed precedence `invalid > blocking > open > incomplete > informational`: a **missing /
unreadable / tampered / wrong-schema plan** → `invalid`; else an **unacknowledged block plan**, a **contradictory
acknowledgement** (a class ack that does not match the plan's class), or a **`--strict-open` escalation** → `blocked`; else
an **open monitor / investigate follow-up** → `followup-open`; else a **missing required acknowledgement** → `incomplete`;
else `completed`.

A `block-release` plan (and a plan whose own verdict is `invalid`) records the release as **held**. Acknowledging it
(`--ack-plan` + `--ack-block`) closes out the acknowledgement record but is **never** an approval to promote — the release
stays held.

## Run it

```sh
# A clear plan, reviewed + accepted → completed (exit 0)
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt --plan=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/plan-clear.json --ack-plan --ack-clear --text

# A clear plan reviewed but NOT accepted → incomplete (exit 2), never a vacuous completed receipt
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt --plan=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/plan-clear.json --ack-plan --json

# A watch monitor plan, reviewed but its follow-up not yet acknowledged → followup-open (exit 3)
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt --plan=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/plan-monitor.json --ack-plan --json

# The same monitor plan, follow-up acknowledged → completed (exit 0)
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt --plan=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/plan-monitor.json --ack-plan --ack-monitor --json

# An investigate plan reviewed but its investigation not yet acknowledged → followup-open (exit 3)
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt --plan=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/plan-investigate.json --ack-plan --json

# A block plan NOT acknowledged as held → blocked (exit 4)
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt --plan=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/plan-block.json --json

# A block plan, confirmed held + reviewed → completed (exit 0), the release stays held
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt --plan=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/plan-block.json --ack-plan --ack-block --json

# A plan whose own verdict is invalid is a block-class hold → blocked (exit 4) until acknowledged as held
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt --plan=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/plan-invalid.json --json

# A contradictory acknowledgement (ack-block on a clear plan) → blocked (exit 4)
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt --plan=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/plan-clear.json --ack-plan --ack-clear --ack-block --json

# --strict-open escalates any open follow-up to a hard block (exit 4)
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt --plan=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/plan-monitor.json --ack-plan --strict-open --json

# A tampered plan fails closed → invalid (exit 4), even with every acknowledgement
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt --plan=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/plan-tampered.json --ack-plan --ack-monitor --json

# A non-plan decoy → invalid (exit 4), never a vacuous completed receipt
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt --plan=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/not-a-plan.json --json

# Read the plan document from stdin
cat plan.json | pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt --stdin --ack-plan --ack-clear --text
```

## Acknowledgement flags

| Flag | Effect |
| --- | --- |
| `--ack-plan` (alias `--ack-reviewed`) | the operator confirms the plan was reviewed (required for every usable class) |
| `--ack-clear` | the clear / no-follow-up plan was accepted for routine monitoring (required for a clear-class plan) |
| `--ack-monitor` | the monitor follow-up was acknowledged (required for a monitor-class plan) |
| `--ack-investigation` | the investigation was acknowledged (required for an investigate-class plan) |
| `--ack-block` | confirms the release remains BLOCKED, not promoted (required for a block-class plan) |
| `--strict-open` | escalate any open advisory follow-up to a hard block — a `closed-out or blocked` gate |

Each plan class has exactly one class acknowledgement (`clear` / `monitor` / `investigation` / `block`); supplying one for
any other class is a contradiction (fails closed).

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | **completed** — the plan is usable and its class's required acknowledgements are all present |
| `1` | **usage** — the CLI was misused (a bad flag, no plan supplied, or an unwritable output) |
| `2` | **incomplete** — a missing required acknowledgement for a usable plan (a coverage gap) |
| `3` | **followup-open** — an advisory follow-up still open for a monitor / investigate plan |
| `4` | **blocked** — an unacknowledged block plan, a contradictory acknowledgement, or a `--strict-open` escalation |
| `4` | **invalid** — a missing / unreadable / tampered / wrong-schema plan |

See `docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt-fixture.yml`
for the full scheduled CI job that summarizes a closeout-index trend, translates it into an action plan, records the
execution receipt into `$GITHUB_STEP_SUMMARY`, and fails closed.

## Not a legal audit trail

This receipt is a **content-free operational acknowledgement receipt**, not a system of record. It is **not** a legal /
compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger,
an incident record, or an audit log — keep each of those in its own dedicated system. It attests no person's identity;
its re-derivation is **tamper-evidence over content-free data**, not a cryptographic signature (there is no signing key
and no attested identity), and a fully self-consistent fabricated plan is out of its scope.
