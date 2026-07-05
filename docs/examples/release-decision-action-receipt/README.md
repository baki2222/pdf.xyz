# Release decision action-plan execution receipt — example fixtures

Content-free fixtures for `pnpm worker:release-decision-action-receipt` (Phase 63). The receipt **ingests** ONE
content-free `pdfxyz.release-decision-action-plan/1` follow-up plan (Phase 62) a release pipeline already produced plus
a small set of **bounded operator acknowledgement flags**, **re-validates the plan against itself** (reconstructing its
Phase 62 bounded decision from the source-trend details the plan recorded and re-running the Phase 62 `computeActionPlan`
reducer, so a hand-flipped plan verdict / action class / exit code is caught as a tamper), and records whether the plan's
required follow-ups were acknowledged: ONE stable `pdfxyz.release-decision-action-receipt/1` document with a **receipt
verdict**, the resolved **plan class**, a bounded **acknowledgement checklist**, a bounded rationale, and a content-free
**receipt**. It answers ONE question a governance review needs — *"given this content-free follow-up plan and the
operator's bounded acknowledgements, were the plan's required follow-ups closed out?"* — and **fails closed** when the
plan cannot be trusted or a required acknowledgement is absent.

Everything here is **content-free**: bounded enums, small counts, booleans, ISO stamps, and app-authored prose only — no
reviewer name / email, filename, path, object key, bucket, URL, raw ref, raw label, raw note, size, digest, or byte, even
from a hostile input, and never the ingested plan's own stamp. The acknowledgements are **booleans only** — no free-form
note or actor name. It is a content-free **operational execution receipt only** — **not** a legal / compliance sign-off,
an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record,
or an audit log. It runs no gate / index / decision / trend / plan itself, contacts no cloud, and signs / approves /
publishes / promotes / deletes / mutates nothing.

> **A `completed` receipt requires a usable plan AND the bounded acknowledgements its class demands.** A tampered plan is
> `blocked`; a missing / unreadable plan is `incomplete` (nothing to receipt); a `block` plan not acknowledged as
> held-blocked is `blocked`; a contradictory acknowledgement is `blocked`; a missing required acknowledgement is
> `incomplete`; an open advisory follow-up (monitor / investigate) is `followup-open`. `--strict-open` escalates an open
> follow-up to `blocked`. It never fabricates a completed close-out.

## Plan fixtures

Each `plan-*.json` is a genuine, self-consistent `pdfxyz.release-decision-action-plan/1` document (its recorded plan
decision re-derives from its own recorded source facts, so the receipt's trust boundary marks it `usable`).
`plan-tampered.json` (a hand-flipped verdict) and `not-a-plan.json` (a wrong schema) prove the fail-closed paths.

| File | Plan verdict | Receipt plan class | Role |
| --- | --- | --- | --- |
| `plan-clear.json` | `clear` | `clear` | a clean stable trend — the only follow-up is to keep the cadence |
| `plan-monitor-watch.json` | `monitor` | `monitor` | a flat advisory (watch) trend — a follow-up to track |
| `plan-monitor-degrading.json` | `monitor` | `monitor` | a worsening (degrading) arc — a follow-up to stabilize |
| `plan-investigate.json` | `investigate` | `investigate` | an inconclusive (insufficient) trend — evidence to complete |
| `plan-block.json` | `block-release` | `block` | a blocked trend — hold promotion + reconcile |
| `plan-reject-input.json` | `invalid` | `block` | a plan whose SOURCE TREND was untrustworthy (reject-input) — still a block-class plan |
| `plan-tampered.json` | `block-release` (claimed) | — | a hand-flipped verdict that no longer re-derives (a tamper) |
| `not-a-plan.json` | — | — | not a recognized release decision action plan (an unreadable input) |

Note `plan-reject-input.json` is itself a **usable** plan document — a valid Phase 62 plan that *concluded* `invalid`
(its source trend could not be trusted). That is a **block** class for the receipt (confirm the release remains blocked),
distinct from an untrustworthy **plan input** (`plan-tampered.json` / `not-a-plan.json`).

## What the receipt records

Which acknowledgements each class **requires** for a `completed` receipt:

| Plan class | Required acknowledgements | Reviewed-but-unacked | Never acknowledged |
| --- | --- | --- | --- |
| `clear` | `--ack-plan` | — | `incomplete` (not exercised) |
| `monitor` | `--ack-plan` + `--ack-monitor` + `--ack-followups` | `followup-open` (exit 3) | `incomplete` (not exercised) |
| `investigate` | `--ack-plan` + `--ack-investigation` + `--ack-followups` | `followup-open` (exit 3) | `incomplete` (not exercised) |
| `block` | `--ack-plan` + `--ack-block` + `--ack-followups` | `incomplete` (held but not complete) | `blocked` (not acknowledged as blocked) |

The verdict resolves with fail-closed precedence `blocking > open > incomplete > informational`: a **tampered plan**, an
**unacknowledged block**, a **contradictory acknowledgement** (a class ack that does not match the plan's class), or a
**`--strict-open` escalation** → `blocked`; else an **open advisory follow-up** (monitor / investigate) → `followup-open`;
else a **missing required acknowledgement** or a **missing / unreadable plan** → `incomplete`; else `completed`.

## Run it

```sh
# A clear plan, reviewed → completed (exit 0)
pnpm worker:release-decision-action-receipt --plan=docs/examples/release-decision-action-receipt/plan-clear.json --ack-plan --text

# A clear plan NOT reviewed → incomplete (exit 2), never a vacuous completed receipt
pnpm worker:release-decision-action-receipt --plan=docs/examples/release-decision-action-receipt/plan-clear.json --json

# A watch monitor plan, reviewed but the follow-up not yet acknowledged → followup-open (exit 3)
pnpm worker:release-decision-action-receipt --plan=docs/examples/release-decision-action-receipt/plan-monitor-watch.json --ack-plan --json

# The same monitor plan, follow-up fully acknowledged → completed (exit 0)
pnpm worker:release-decision-action-receipt --plan=docs/examples/release-decision-action-receipt/plan-monitor-watch.json --ack-plan --ack-monitor --ack-followups --json

# A block plan NOT acknowledged as held-blocked → blocked (exit 4)
pnpm worker:release-decision-action-receipt --plan=docs/examples/release-decision-action-receipt/plan-block.json --json

# The same block plan, confirmed held + reviewed + follow-ups acknowledged → completed (exit 0)
pnpm worker:release-decision-action-receipt --plan=docs/examples/release-decision-action-receipt/plan-block.json --ack-plan --ack-block --ack-followups --json

# A contradictory acknowledgement (ack-block on a clear plan) → blocked (exit 4)
pnpm worker:release-decision-action-receipt --plan=docs/examples/release-decision-action-receipt/plan-clear.json --ack-plan --ack-block --json

# --strict-open escalates an open follow-up to a hard block (exit 4)
pnpm worker:release-decision-action-receipt --plan=docs/examples/release-decision-action-receipt/plan-monitor-watch.json --ack-plan --strict-open --json

# A tampered plan fails closed → blocked (exit 4), even with every acknowledgement
pnpm worker:release-decision-action-receipt --plan=docs/examples/release-decision-action-receipt/plan-tampered.json --ack-plan --ack-block --ack-followups --json

# A non-plan decoy → incomplete (exit 2), never a vacuous completed receipt
pnpm worker:release-decision-action-receipt --plan=docs/examples/release-decision-action-receipt/not-a-plan.json --json

# Read the plan document from stdin
cat plan.json | pnpm worker:release-decision-action-receipt --stdin --ack-plan --text
```

## Acknowledgement flags

| Flag | Effect |
| --- | --- |
| `--ack-plan` | the operator confirms the plan was reviewed (required for every class) |
| `--ack-followups` | the required follow-up checklist was acknowledged (required for monitor / investigate / block) |
| `--ack-monitor` | the monitor follow-up was acknowledged (required for a monitor-class plan) |
| `--ack-investigation` | the investigation was acknowledged (required for an investigate-class plan) |
| `--ack-block` | confirms the release remains BLOCKED, not promoted (required for a block-class plan; a contradiction on any other class) |
| `--strict-open` | escalate an open advisory follow-up (monitor / investigate) to a hard block — a `closed-out or blocked` gate |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | **completed** — the plan is usable and its class's required acknowledgements are all present |
| `1` | **usage** — the CLI was misused (a bad flag, no plan supplied, or an unwritable output) |
| `2` | **incomplete** — a missing / unusable plan, or a missing required acknowledgement (a coverage gap) |
| `3` | **followup-open** — an advisory follow-up still open for a monitor / investigate plan |
| `4` | **blocked** — a tampered plan, a block plan not acknowledged as blocked, a `--strict-open` escalation, or a contradictory acknowledgement |

See `docs/examples/deployment/github-actions/release-decision-action-receipt-fixture.yml` for the full scheduled CI job
that summarizes a decision trend, translates it into an action plan, records the execution receipt into
`$GITHUB_STEP_SUMMARY`, and fails closed.

## Not a legal audit trail

This receipt is a **content-free operational execution receipt**, not a system of record. It is **not** a legal /
compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger,
an incident record, or an audit log — keep each of those in its own dedicated system. It attests no person's identity;
its re-derivation is **tamper-evidence over content-free data**, not a cryptographic signature (there is no signing key
and no attested identity), and a fully self-consistent fabricated plan is out of its scope.
