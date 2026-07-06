# Release decision closeout governance finalize index trend action-plan execution receipt — example fixtures

Content-free fixtures for `pnpm worker:release-decision-closeout-governance-finalize-index-trend-action-receipt`
(Phase 78). The receipt **ingests** ONE content-free
`pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-plan/1` follow-up plan (Phase 77) a release
pipeline already produced plus a small set of **bounded operator acknowledgement flags**, **re-validates the plan against
itself** (reconstructing its Phase 77 bounded decision from the source-trend details the plan recorded and re-running the
Phase 77 `computeActionPlan` reducer, so a hand-flipped plan verdict / action class / exit code is caught as a tamper),
and records whether the operator provided the acknowledgements required to close it out: ONE stable
`pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-receipt/1` document with a **receipt verdict**,
the resolved **plan class**, a bounded **acknowledgement checklist**, a bounded rationale, and a content-free **receipt**.
It answers ONE question a governance review needs — *"given this content-free finalization-index trend action plan, did
the operator provide the bounded acknowledgements required to close it out, and what is the resulting receipt posture?"* —
and **fails closed** when the plan cannot be trusted or a required acknowledgement is absent.

Everything here is **content-free**: bounded enums, small counts, booleans, ISO stamps, and app-authored prose only — no
reviewer name / email, filename, path, object key, bucket, URL, raw ref, raw label, raw note, size, digest, or byte, even
from a hostile input, and never the ingested plan's own stamp. The acknowledgements are **booleans only** — no free-form
note or actor name, and the receipt never claims an action was executed unless `--ack-executed` is supplied. It is a
content-free **operational acknowledgement receipt only** — **not** a legal / compliance sign-off, an external approval /
signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It
runs no gate / index / decision / trend / finalize / plan / governance / closeout itself, contacts no cloud, and signs /
approves / publishes / promotes / deletes / mutates nothing.

> **A `completed` receipt requires a usable plan of a closeable class (`clear` / `monitor` / `investigate`) AND the
> bounded acknowledgements its class demands.** A missing / unreadable / tampered plan — or a plan whose OWN verdict is
> `invalid` — is `invalid` (nothing trustworthy to close out); a `block-release` plan is `blocked` (the release stays
> held, whether or not it was acknowledged); a contradictory acknowledgement is `blocked`; a missing required
> acknowledgement for a `clear` / `monitor` / `investigate` plan is `incomplete`. `--strict-open` escalates any
> missing-acknowledgement `incomplete` to `blocked`. It never fabricates a completed close-out.

## Plan fixtures

Each `plan-*.json` is a genuine, self-consistent
`pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-plan/1` document (its recorded plan decision
re-derives from its own recorded source facts, so the receipt's trust boundary marks it `usable`). `plan-tampered.json` (a
hand-flipped verdict) and `not-a-plan.json` (a wrong schema) prove the fail-closed paths.

| File | Plan verdict | Receipt plan class | Role |
| --- | --- | --- | --- |
| `plan-clear.json` | `clear` | `clear` | a coherent stable finalize-index trend — the only follow-up is to keep the cadence |
| `plan-monitor.json` | `monitor` | `monitor` | a `watch` history — a follow-up to track to closure |
| `plan-investigate.json` | `investigate` | `investigate` | an `insufficient`, inconclusive history — evidence to complete |
| `plan-block.json` | `block-release` | `block` | a `blocked` history — hold promotion + reconcile (always `blocked`) |
| `plan-invalid.json` | `invalid` | — | a plan whose SOURCE TREND was untrustworthy (`reject-input`) — always an `invalid` receipt |
| `plan-tampered.json` | `monitor` (claimed) | — | a hand-flipped verdict that no longer re-derives (a tamper ⇒ `invalid`) |
| `not-a-plan.json` | — | — | not a recognized finalize-index-trend action plan (an unreadable input ⇒ `invalid`) |

Note `plan-invalid.json` is itself a **usable** plan document — a valid Phase 77 plan that *concluded* `invalid`
(`reject-input`, its source trend could not be trusted). The receipt treats it as `invalid` regardless of the flags
supplied (there is no closeable follow-up), distinct from an untrustworthy **plan input** (`plan-tampered.json` /
`not-a-plan.json`, which are also `invalid`).

## What the receipt records

Which acknowledgements each class **requires** for a `completed` receipt:

| Plan class | Required acknowledgements | Reviewed-but-unacked | Never acknowledged |
| --- | --- | --- | --- |
| `clear` | `--ack-plan` (alias `--ack-reviewed`); `--ack-clear` optional | — | `incomplete` (not reviewed) |
| `monitor` | `--ack-plan` + `--ack-monitor` + `--ack-executed` | `incomplete` (exit 2, coverage gap) | `incomplete` (not reviewed) |
| `investigate` | `--ack-plan` + `--ack-investigation` + `--ack-executed` | `incomplete` (exit 2, coverage gap) | `incomplete` (not reviewed) |
| `block` | `--ack-plan` + `--ack-block` + `--ack-executed` | `blocked` (held, acknowledged) | `blocked` (not acknowledged as blocked) |

The verdict resolves with fail-closed precedence `invalid > blocking > incomplete > informational`: a **missing /
unreadable / tampered plan**, or a plan whose **own verdict is `invalid`** → `invalid`; else a **`block-release` plan**, a
**contradictory acknowledgement** (a class ack that does not match the plan's class), or a **`--strict-open` escalation** →
`blocked`; else a **missing required acknowledgement** for a clear / monitor / investigate plan → `incomplete`; else
`completed`.

A `block-release` plan is **always `blocked`** — the release remains held. Acknowledging it (`--ack-plan` + `--ack-block`
+ `--ack-executed`) records the hold; it is never a completed close-out and never an approval to promote.

## Run it

```sh
# A clear plan, reviewed → completed (exit 0)
pnpm worker:release-decision-closeout-governance-finalize-index-trend-action-receipt --plan=docs/examples/release-decision-closeout-governance-finalize-index-trend-action-receipt/plan-clear.json --ack-plan --text

# A clear plan NOT reviewed → incomplete (exit 2), never a vacuous completed receipt
pnpm worker:release-decision-closeout-governance-finalize-index-trend-action-receipt --plan=docs/examples/release-decision-closeout-governance-finalize-index-trend-action-receipt/plan-clear.json --json

# A watch monitor plan, reviewed but its follow-up not yet acknowledged / executed → incomplete (exit 2)
pnpm worker:release-decision-closeout-governance-finalize-index-trend-action-receipt --plan=docs/examples/release-decision-closeout-governance-finalize-index-trend-action-receipt/plan-monitor.json --ack-plan --json

# The same monitor plan, follow-up acknowledged + executed → completed (exit 0)
pnpm worker:release-decision-closeout-governance-finalize-index-trend-action-receipt --plan=docs/examples/release-decision-closeout-governance-finalize-index-trend-action-receipt/plan-monitor.json --ack-plan --ack-monitor --ack-executed --json

# An investigate plan reviewed but its investigation not yet acknowledged / executed → incomplete (exit 2)
pnpm worker:release-decision-closeout-governance-finalize-index-trend-action-receipt --plan=docs/examples/release-decision-closeout-governance-finalize-index-trend-action-receipt/plan-investigate.json --ack-plan --json

# A block plan, confirmed held + reviewed + follow-up executed → blocked (exit 4), the release stays held
pnpm worker:release-decision-closeout-governance-finalize-index-trend-action-receipt --plan=docs/examples/release-decision-closeout-governance-finalize-index-trend-action-receipt/plan-block.json --ack-plan --ack-block --ack-executed --json

# A plan whose own verdict is invalid → invalid (exit 4), even fully acknowledged
pnpm worker:release-decision-closeout-governance-finalize-index-trend-action-receipt --plan=docs/examples/release-decision-closeout-governance-finalize-index-trend-action-receipt/plan-invalid.json --ack-plan --ack-executed --json

# A contradictory acknowledgement (ack-block on a clear plan) → blocked (exit 4)
pnpm worker:release-decision-closeout-governance-finalize-index-trend-action-receipt --plan=docs/examples/release-decision-closeout-governance-finalize-index-trend-action-receipt/plan-clear.json --ack-plan --ack-block --json

# --strict-open escalates any missing required acknowledgement to a hard block (exit 4)
pnpm worker:release-decision-closeout-governance-finalize-index-trend-action-receipt --plan=docs/examples/release-decision-closeout-governance-finalize-index-trend-action-receipt/plan-monitor.json --ack-plan --strict-open --json

# A tampered plan fails closed → invalid (exit 4), even with every acknowledgement
pnpm worker:release-decision-closeout-governance-finalize-index-trend-action-receipt --plan=docs/examples/release-decision-closeout-governance-finalize-index-trend-action-receipt/plan-tampered.json --ack-plan --ack-monitor --ack-executed --json

# A non-plan decoy → invalid (exit 4), never a vacuous completed receipt
pnpm worker:release-decision-closeout-governance-finalize-index-trend-action-receipt --plan=docs/examples/release-decision-closeout-governance-finalize-index-trend-action-receipt/not-a-plan.json --json

# Read the plan document from stdin
cat plan.json | pnpm worker:release-decision-closeout-governance-finalize-index-trend-action-receipt --stdin --ack-plan --text
```

## Acknowledgement flags

| Flag | Effect |
| --- | --- |
| `--ack-plan` (alias `--ack-reviewed`) | the operator confirms the plan was reviewed (required for every closeable class) |
| `--ack-executed` | the required next-action checklist was executed / worked (required for monitor / investigate / block) |
| `--ack-monitor` | the monitor follow-up was acknowledged (required for a monitor-class plan) |
| `--ack-investigation` | the investigation was acknowledged (required for an investigate-class plan) |
| `--ack-block` | confirms the release remains BLOCKED, not promoted (required for a block-class plan; a contradiction on any other class) |
| `--ack-clear` | confirms a clear plan needs no follow-up (optional for a clear-class plan; a contradiction on a block-release plan) |
| `--strict-open` | escalate any missing required acknowledgement to a hard block — a `closed-out or blocked` gate |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | **completed** — the plan is usable, closeable (clear / monitor / investigate), and its class's required acknowledgements are all present |
| `1` | **usage** — the CLI was misused (a bad flag, no plan supplied, or an unwritable output) |
| `2` | **incomplete** — a missing required acknowledgement for a clear / monitor / investigate plan (a coverage gap) |
| `4` | **blocked** — a block-release plan (release held), a contradictory acknowledgement, or a `--strict-open` escalation |
| `4` | **invalid** — a missing / unreadable / tampered plan, or a plan whose own verdict is invalid |

See `docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-action-receipt-fixture.yml`
for the full scheduled CI job that summarizes a finalize-index trend, translates it into an action plan, records the
execution receipt into `$GITHUB_STEP_SUMMARY`, and fails closed.

## Not a legal audit trail

This receipt is a **content-free operational acknowledgement receipt**, not a system of record. It is **not** a legal /
compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger,
an incident record, or an audit log — keep each of those in its own dedicated system. It attests no person's identity;
its re-derivation is **tamper-evidence over content-free data**, not a cryptographic signature (there is no signing key
and no attested identity), and a fully self-consistent fabricated plan is out of its scope.
