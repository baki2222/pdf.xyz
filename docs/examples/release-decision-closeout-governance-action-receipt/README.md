# Release decision closeout governance action-plan execution receipt — example fixtures

Content-free fixtures for `pnpm worker:release-decision-closeout-governance-action-receipt` (Phase 73). The receipt
**ingests** ONE content-free `pdfxyz.release-decision-closeout-governance-action-plan/1` follow-up plan (Phase 72) a
release pipeline already produced plus a small set of **bounded operator acknowledgement flags**, **re-validates the plan
against itself** (reconstructing its Phase 72 bounded decision from the source-trend details the plan recorded and
re-running the Phase 72 `computeGovernanceActionPlan` reducer, so a hand-flipped plan verdict / action class / exit code
is caught as a tamper), and records whether the plan's required follow-ups were acknowledged / executed: ONE stable
`pdfxyz.release-decision-closeout-governance-action-receipt/1` document with a **receipt verdict**, the resolved **plan
class**, a bounded **acknowledgement checklist**, a bounded rationale, and a content-free **receipt**. It answers ONE
question a governance review needs — *"given this content-free governance follow-up plan and the operator's bounded
acknowledgements, were the plan's required follow-ups closed out?"* — and **fails closed** when the plan cannot be trusted
or a required acknowledgement is absent.

Everything here is **content-free**: bounded enums, small counts, booleans, ISO stamps, and app-authored prose only — no
reviewer name / email, filename, path, object key, bucket, URL, raw ref, raw label, raw note, size, digest, or byte, even
from a hostile input, and never the ingested plan's own stamp. The acknowledgements are **booleans only** — no free-form
note or actor name. It is a content-free **operational execution receipt only** — **not** a legal / compliance sign-off,
an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record,
or an audit log. It runs no gate / index / decision / trend / plan / governance / closeout itself, contacts no cloud, and
signs / approves / publishes / promotes / deletes / mutates nothing.

> **A `completed` receipt requires a usable plan AND the bounded acknowledgements its class demands.** A missing /
> unreadable / tampered plan is `blocked` (nothing trustworthy to receipt); a `block-release` plan not acknowledged as
> held-blocked is `blocked`; a contradictory acknowledgement is `blocked`; a missing required acknowledgement for a
> `clear` / `investigate` plan is `incomplete`; a `monitor` plan reviewed but whose follow-up is still open / not fully
> executed is `followup-open`. `--strict-open` escalates an open monitor follow-up to `blocked`. It never fabricates a
> completed close-out.

## Plan fixtures

Each `plan-*.json` is a genuine, self-consistent `pdfxyz.release-decision-closeout-governance-action-plan/1` document (its
recorded plan decision re-derives from its own recorded source facts, so the receipt's trust boundary marks it `usable`).
`plan-tampered.json` (a hand-flipped verdict) and `not-a-plan.json` (a wrong schema) prove the fail-closed paths.

| File | Plan verdict | Receipt plan class | Role |
| --- | --- | --- | --- |
| `plan-clear.json` | `clear` | `clear` | a coherent stable governance-index trend — the only follow-up is to keep the cadence |
| `plan-investigate.json` | `investigate` | `investigate` | a `trend-incomplete`, inconclusive history — evidence to complete |
| `plan-monitor.json` | `monitor` | `monitor` | a `trend-watch` history — a follow-up to track to closure |
| `plan-block.json` | `block-release` | `block` | a `trend-blocked` history — hold promotion + reconcile |
| `plan-reject-input.json` | `block-release` | `block` | a plan whose SOURCE TREND was untrustworthy (reject-input) — still a block-class plan |
| `plan-tampered.json` | `block-release` (claimed) | — | a hand-flipped verdict that no longer re-derives (a tamper) |
| `not-a-plan.json` | — | — | not a recognized release decision closeout governance action plan (an unreadable input) |

Note `plan-reject-input.json` is itself a **usable** plan document — a valid Phase 72 plan that *concluded* `block-release`
(`reject-input`, its source trend could not be trusted). That is a **block** class for the receipt (confirm the release
remains blocked), distinct from an untrustworthy **plan input** (`plan-tampered.json` / `not-a-plan.json`).

## What the receipt records

Which acknowledgements each class **requires** for a `completed` receipt:

| Plan class | Required acknowledgements | Reviewed-but-unacked | Never acknowledged |
| --- | --- | --- | --- |
| `clear` | `--ack-plan` | — | `incomplete` (not exercised) |
| `investigate` | `--ack-plan` + `--ack-investigation` + `--ack-executed` | `incomplete` (exit 2, coverage gap) | `incomplete` (not exercised) |
| `monitor` | `--ack-plan` + `--ack-monitor` + `--ack-executed` | `followup-open` (exit 3) | `incomplete` (not exercised) |
| `block` | `--ack-plan` + `--ack-block` + `--ack-executed` | `incomplete` (held but not complete) | `blocked` (not acknowledged as blocked) |

The verdict resolves with fail-closed precedence `blocking > open > incomplete > informational`: a **missing / unreadable
/ tampered plan**, an **unacknowledged block**, a **contradictory acknowledgement** (a class ack that does not match the
plan's class), or a **`--strict-open` escalation** → `blocked`; else an **open monitor follow-up** → `followup-open`; else
a **missing required acknowledgement** for a clear / investigate / held-block plan → `incomplete`; else `completed`.

## Run it

```sh
# A clear plan, reviewed → completed (exit 0)
pnpm worker:release-decision-closeout-governance-action-receipt --plan=docs/examples/release-decision-closeout-governance-action-receipt/plan-clear.json --ack-plan --text

# A clear plan NOT reviewed → incomplete (exit 2), never a vacuous completed receipt
pnpm worker:release-decision-closeout-governance-action-receipt --plan=docs/examples/release-decision-closeout-governance-action-receipt/plan-clear.json --json

# An investigate plan reviewed but its investigation not yet acknowledged / executed → incomplete (exit 2)
pnpm worker:release-decision-closeout-governance-action-receipt --plan=docs/examples/release-decision-closeout-governance-action-receipt/plan-investigate.json --ack-plan --json

# The same investigate plan, investigation acknowledged + follow-up executed → completed (exit 0)
pnpm worker:release-decision-closeout-governance-action-receipt --plan=docs/examples/release-decision-closeout-governance-action-receipt/plan-investigate.json --ack-plan --ack-investigation --ack-executed --json

# A watch monitor plan, reviewed but the follow-up not yet acknowledged → followup-open (exit 3)
pnpm worker:release-decision-closeout-governance-action-receipt --plan=docs/examples/release-decision-closeout-governance-action-receipt/plan-monitor.json --ack-plan --json

# The same monitor plan, follow-up acknowledged + executed → completed (exit 0)
pnpm worker:release-decision-closeout-governance-action-receipt --plan=docs/examples/release-decision-closeout-governance-action-receipt/plan-monitor.json --ack-plan --ack-monitor --ack-executed --json

# A block plan NOT acknowledged as held-blocked → blocked (exit 4)
pnpm worker:release-decision-closeout-governance-action-receipt --plan=docs/examples/release-decision-closeout-governance-action-receipt/plan-block.json --json

# The same block plan, confirmed held + reviewed + follow-up executed → completed (exit 0)
pnpm worker:release-decision-closeout-governance-action-receipt --plan=docs/examples/release-decision-closeout-governance-action-receipt/plan-block.json --ack-plan --ack-block --ack-executed --json

# A contradictory acknowledgement (ack-block on a clear plan) → blocked (exit 4)
pnpm worker:release-decision-closeout-governance-action-receipt --plan=docs/examples/release-decision-closeout-governance-action-receipt/plan-clear.json --ack-plan --ack-block --json

# --strict-open escalates an open monitor follow-up to a hard block (exit 4)
pnpm worker:release-decision-closeout-governance-action-receipt --plan=docs/examples/release-decision-closeout-governance-action-receipt/plan-monitor.json --ack-plan --strict-open --json

# A tampered plan fails closed → blocked (exit 4), even with every acknowledgement
pnpm worker:release-decision-closeout-governance-action-receipt --plan=docs/examples/release-decision-closeout-governance-action-receipt/plan-tampered.json --ack-plan --ack-block --ack-executed --json

# A non-plan decoy → blocked (exit 4), never a vacuous completed receipt
pnpm worker:release-decision-closeout-governance-action-receipt --plan=docs/examples/release-decision-closeout-governance-action-receipt/not-a-plan.json --json

# Read the plan document from stdin
cat plan.json | pnpm worker:release-decision-closeout-governance-action-receipt --stdin --ack-plan --text
```

## Acknowledgement flags

| Flag | Effect |
| --- | --- |
| `--ack-plan` | the operator confirms the plan was reviewed (required for every class) |
| `--ack-executed` | the required next-action checklist was executed / worked (required for investigate / monitor / block) |
| `--ack-monitor` | the monitor follow-up was acknowledged (required for a monitor-class plan) |
| `--ack-investigation` | the investigation was acknowledged (required for an investigate-class plan) |
| `--ack-block` | confirms the release remains BLOCKED, not promoted (required for a block-class plan; a contradiction on any other class) |
| `--strict-open` | escalate an open monitor follow-up to a hard block — a `closed-out or blocked` gate |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | **completed** — the plan is usable and its class's required acknowledgements are all present |
| `1` | **usage** — the CLI was misused (a bad flag, no plan supplied, or an unwritable output) |
| `2` | **incomplete** — a missing required acknowledgement for a clear / investigate / held-block plan (a coverage gap) |
| `3` | **followup-open** — a monitor plan reviewed but its follow-up still open / not fully executed |
| `4` | **blocked** — a missing / unreadable / tampered plan, a block plan not acknowledged as blocked, a `--strict-open` escalation, or a contradictory acknowledgement |

See `docs/examples/deployment/github-actions/release-decision-closeout-governance-action-receipt-fixture.yml` for the full
scheduled CI job that summarizes a governance-index trend, translates it into a governance action plan, records the
execution receipt into `$GITHUB_STEP_SUMMARY`, and fails closed.

## Not a legal audit trail

This receipt is a **content-free operational execution receipt**, not a system of record. It is **not** a legal /
compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger,
an incident record, or an audit log — keep each of those in its own dedicated system. It attests no person's identity;
its re-derivation is **tamper-evidence over content-free data**, not a cryptographic signature (there is no signing key
and no attested identity), and a fully self-consistent fabricated plan is out of its scope.
