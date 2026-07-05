# Release decision closeout bundle — example fixtures

Content-free fixtures for `pnpm worker:release-decision-closeout` (Phase 64). The closeout **composes** the release
DECISION governance chain into ONE bounded record: it **ingests** ONE content-free
`pdfxyz.release-decision-action-receipt/1` execution receipt (Phase 63; **required**) plus **optional** related records
already on hand — the `pdfxyz.release-decision-action-plan/1` plan the receipt receipted, the
`pdfxyz.release-decision-trend/1` trend the plan folded, and the `pdfxyz.release-decision/1` /
`pdfxyz.release-decision-index/1` ledger records upstream. It **re-validates the primary receipt against itself**
(reconstructing its Phase 63 bounded decision from the source facets it recorded and re-running the Phase 63
`computeReceipt` reducer, so a hand-flipped receipt verdict / ack coverage / exit code is caught as a tamper),
**cross-checks** the supplied related records against what the receipt recorded, and emits ONE stable
`pdfxyz.release-decision-closeout/1` document with a **closeout verdict**, the primary receipt's **state + verdict**, a
bounded **related-record checklist**, a bounded rationale, and a content-free **receipt**. It answers ONE question a
governance review needs — *"Is this release decision governance chain **closed out**, still **open**, **incomplete**, or
**blocked**?"* — and **fails closed** when the primary receipt cannot be trusted or a required related record is absent.

Everything here is **content-free**: bounded enums, small counts, booleans, ISO stamps, and app-authored prose only — no
reviewer name / email, filename, path, object key, bucket, URL, raw ref, raw label, raw note, size, digest, or byte, even
from a hostile input, and never any ingested record's own stamp. It accepts **no free-form note or actor name**. It is a
content-free **operational closeout summary only** — **not** a legal / compliance sign-off, an external approval /
signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It
runs no gate / index / decision / trend / plan / receipt itself, contacts no cloud, and signs / approves / publishes /
promotes / deletes / mutates nothing.

> **A `closed` closeout requires a usable primary receipt whose OWN verdict is `completed` AND every supplied related
> record coherent.** A tampered / self-inconsistent receipt is `closeout-blocked`; a receipt whose own verdict is
> `blocked` is `closeout-blocked`; a contradictory cross-check record, a tampered related record, or a blocked
> source-chain record is `closeout-blocked`; a missing / unreadable receipt, a receipt whose own verdict is `incomplete`,
> a missing required related record, or an insufficient source chain is `closeout-incomplete`; a `followup-open` receipt
> or an advisory decision / index record is `closeout-open`. `--strict-open` escalates an open closeout to
> `closeout-blocked`. It never fabricates a `closed` closeout.

## Primary receipt fixtures

Each `receipt-*.json` is a genuine `pdfxyz.release-decision-action-receipt/1` document (its recorded receipt decision
re-derives from its own recorded source facets, so the closeout's trust boundary marks it `usable`).
`receipt-tampered.json` (a hand-flipped verdict) and `not-a-receipt.json` (a wrong schema) prove the fail-closed paths.

| File | Receipt verdict | Closeout (alone) | Role |
| --- | --- | --- | --- |
| `receipt-completed.json` | `completed` | `closed` (exit 0) | a clear plan reviewed → the chain reads as closed out |
| `receipt-followup-open.json` | `followup-open` | `closeout-open` (exit 3) | a monitor plan reviewed, follow-up still open |
| `receipt-incomplete.json` | `incomplete` | `closeout-incomplete` (exit 2) | a plan not acknowledged as reviewed |
| `receipt-blocked.json` | `blocked` | `closeout-blocked` (exit 4) | a block plan not acknowledged as held-blocked |
| `receipt-tampered.json` | `blocked` (claimed) | `closeout-blocked` (exit 4) | a hand-flipped verdict that no longer re-derives (a tamper) |
| `not-a-receipt.json` | — | `closeout-incomplete` (exit 2) | not a recognized action receipt (an unreadable input) |

## Related-record fixtures

Supply the **same** records this receipt's chain was built from — never a newer / different window. `plan` and `trend`
are **cross-checks** (they must AGREE with what the receipt recorded); `decision` and `index` are **source-chain**
records (their own bounded posture folds in as a signal). All are coherent with `receipt-completed.json`.

| File | Kind | Signal vs `receipt-completed` | Effect |
| --- | --- | --- | --- |
| `plan-coherent.json` | `--plan` | `coherent` | matches the plan the receipt receipted — stays `closed` |
| `plan-contradictory.json` | `--plan` | `contradictory` | a different plan — `closeout-blocked` |
| `plan-tampered.json` | `--plan` | tampered | recognized but does not re-derive — `closeout-blocked` |
| `trend-coherent.json` | `--trend` | `coherent` | matches the plan's recorded source-trend verdict (`stable`) — stays `closed` |
| `trend-contradictory.json` | `--trend` | `contradictory` | a `degrading` trend ≠ `stable` — `closeout-blocked` |
| `decision-proceed.json` | `--decision` | `coherent` (clean) | a `proceed` ledger record — stays `closed` |
| `decision-reject.json` | `--decision` | `blocking` | a `reject` ledger record — a blocked source chain, `closeout-blocked` |
| `index-coherent.json` | `--index` | `coherent` (clean) | a `stable` index window — stays `closed` |
| `index-advisory.json` | `--index` | `advisory` | a `watch` index window — `closeout-open` |

## What the closeout records

The verdict resolves with fail-closed precedence `blocking > open > incomplete > informational`, folding the **primary
receipt's own verdict** (the baseline) with each supplied related record's **cross-check / posture signal**:

- **`closed`** — the receipt is usable and `completed`, and every supplied related record is coherent;
- **`closeout-incomplete`** — the receipt is missing / unreadable / `incomplete`, a required record is absent / unusable,
  or a source-chain record is inconclusive;
- **`closeout-open`** — the receipt is `followup-open`, or a decision / index record's posture is advisory;
- **`closeout-blocked`** — the receipt is tampered / `blocked`, a cross-check record contradicts it, a related record is
  tampered, or a decision / index source chain is blocked. `--strict-open` escalates an open closeout here too.

## Run it

```sh
# A completed receipt, no related records → closed (exit 0)
pnpm worker:release-decision-closeout --receipt=docs/examples/release-decision-closeout/receipt-completed.json --text

# The same receipt cross-checked against the coherent plan + trend it was built from → still closed (exit 0)
pnpm worker:release-decision-closeout --receipt=docs/examples/release-decision-closeout/receipt-completed.json \
  --plan=docs/examples/release-decision-closeout/plan-coherent.json \
  --trend=docs/examples/release-decision-closeout/trend-coherent.json --json

# A supplied plan that does NOT match the receipt → closeout-blocked (exit 4)
pnpm worker:release-decision-closeout --receipt=docs/examples/release-decision-closeout/receipt-completed.json \
  --plan=docs/examples/release-decision-closeout/plan-contradictory.json --json

# An advisory decision-index record upstream → closeout-open (exit 3)
pnpm worker:release-decision-closeout --receipt=docs/examples/release-decision-closeout/receipt-completed.json \
  --index=docs/examples/release-decision-closeout/index-advisory.json --json

# A blocked decision-ledger record upstream → closeout-blocked (exit 4)
pnpm worker:release-decision-closeout --receipt=docs/examples/release-decision-closeout/receipt-completed.json \
  --decision=docs/examples/release-decision-closeout/decision-reject.json --json

# A followup-open receipt alone → closeout-open (exit 3); --strict-open escalates it to blocked (exit 4)
pnpm worker:release-decision-closeout --receipt=docs/examples/release-decision-closeout/receipt-followup-open.json --json
pnpm worker:release-decision-closeout --receipt=docs/examples/release-decision-closeout/receipt-followup-open.json --strict-open --json

# A tampered receipt fails closed → closeout-blocked (exit 4)
pnpm worker:release-decision-closeout --receipt=docs/examples/release-decision-closeout/receipt-tampered.json --json

# A required-but-absent related record → closeout-incomplete (exit 2)
pnpm worker:release-decision-closeout --receipt=docs/examples/release-decision-closeout/receipt-completed.json --require-plan --json

# Read the primary receipt document from stdin
cat receipt.json | pnpm worker:release-decision-closeout --stdin --text
```

## Flags

| Flag | Effect |
| --- | --- |
| `--receipt=<path>` / `--file=<path>` | the ONE primary action receipt to close out (required) |
| `--stdin` | read the primary receipt from stdin (cannot combine with `--receipt` / `--file`) |
| `--plan` / `--trend` / `--decision` / `--index` | optional related records (each supplied at most once) |
| `--require-plan` / `--require-trend` / `--require-decision` / `--require-index` | make a related record mandatory (absent / unusable ⇒ incomplete) |
| `--strict-open` | escalate an open closeout (a followup-open receipt or an advisory decision / index record) to a hard block |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | **closed** — the primary receipt completed and the supplied related records are coherent |
| `1` | **usage** — the CLI was misused (a bad flag, no receipt supplied, or an unwritable output) |
| `2` | **closeout-incomplete** — a missing / unusable primary receipt, or a missing required related record |
| `3` | **closeout-open** — a followup-open receipt, or an advisory decision / index record |
| `4` | **closeout-blocked** — a tampered / blocked receipt, a contradictory / tampered related record, a blocked source chain, or a `--strict-open` escalation |

See `docs/examples/deployment/github-actions/release-decision-closeout-fixture.yml` for the full scheduled CI job that
builds the whole decision chain, composes the closeout into `$GITHUB_STEP_SUMMARY`, and fails closed.

## Not a legal audit trail

This closeout is a **content-free operational closeout summary**, not a system of record. It is **not** a legal /
compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger,
an incident record, or an audit log — keep each of those in its own dedicated system. It attests no person's identity;
its re-derivation is **tamper-evidence over content-free data**, not a cryptographic signature (there is no signing key
and no attested identity), and a set of fully self-consistent fabricated records is out of its scope.
