# Release decision closeout governance finalization bundle — example fixtures

Content-free fixtures for `pnpm worker:release-decision-closeout-governance-finalize` (Phase 74). The bundle **ingests** a
**required** content-free `pdfxyz.release-decision-closeout-governance-action-receipt/1` primary receipt (Phase 73) plus,
optionally, the related closeout-governance-chain records it was built from — the follow-up plan (Phase 72), the
governance-index trend (Phase 71), the governance index (Phase 70), and the governance bundle (Phase 69) — **re-validates
each record against itself** (each is re-run through the exact downstream boundary that already consumes it, so a
hand-flipped verdict is caught as a tamper), **cross-checks** the supplied plan / trend against what the primary receipt
recorded, folds every supplied source-chain record's own bounded posture, and rolls them into ONE stable
`pdfxyz.release-decision-closeout-governance-finalize/1` document with a **finalization verdict**, a **primary-receipt
summary**, a bounded **related-record checklist**, an **archive checklist**, an ordered **follow-up assignment list**, and
a content-free **receipt**. It answers ONE question a governance review needs — *"is this closeout-governance chain fully
**finalized**, still **open**, **incomplete**, or **blocked**?"* — and **fails closed** when the primary receipt cannot be
trusted or a supplied record contradicts / blocks the chain.

Everything here is **content-free**: bounded enums, small counts, booleans, ISO stamps, and app-authored prose only — no
reviewer name / email, filename, path, object key, bucket, URL, raw ref, raw label, raw note, size, digest, or byte, even
from a hostile input, and never an ingested record's own stamp. It is a content-free **operational governance
finalization bundle only** — **not** a legal / compliance sign-off, an external approval / signature, an identity proof, a
deployment authorization, a promotion ledger, an incident record, or an audit log. It runs no gate / index / decision /
trend / plan / governance / closeout / receipt itself, contacts no cloud, and signs / approves / publishes / promotes /
deletes / mutates nothing.

> **A `finalized` bundle requires a usable primary receipt whose OWN verdict is `completed` AND every supplied related
> record coherent.** A missing / unreadable primary receipt is `finalize-incomplete` (nothing to finalize); a tampered /
> `blocked` receipt, a contradictory plan / trend, a tampered related record, or a blocked source chain is
> `finalize-blocked`; a required-but-missing related record, an `incomplete` receipt, or an inconclusive source chain is
> `finalize-incomplete`; a `followup-open` receipt or an advisory source chain is `finalize-open`. `--strict-open`
> escalates an open finalization to `finalize-blocked`. It never fabricates a `finalized`.

## Primary receipt fixtures

Each `receipt-*.json` is a genuine, self-consistent `pdfxyz.release-decision-closeout-governance-action-receipt/1` document
(its recorded receipt decision re-derives from its own recorded source facets, so the bundle's trust boundary marks it
`usable`). `receipt-tampered.json` (a hand-flipped verdict) and `not-a-receipt.json` (a wrong schema) prove the fail-closed
paths. The completed receipt is **clear-anchored** (built from a clear plan over a `trend-stable` trend), so it records
`claimedPlanVerdict = "clear"` and `sourceTrendVerdict = "trend-stable"` — the anchors the related plan / trend are
cross-checked against.

| File | Receipt verdict | Finalize verdict (alone) | Exit |
| --- | --- | --- | --- |
| `receipt-completed.json` | `completed` | `finalized` | `0` |
| `receipt-incomplete.json` | `incomplete` | `finalize-incomplete` | `2` |
| `receipt-followup-open.json` | `followup-open` | `finalize-open` | `3` |
| `receipt-blocked.json` | `blocked` | `finalize-blocked` | `4` |
| `receipt-tampered.json` | `completed` (claimed) | `finalize-blocked` | `4` |
| `not-a-receipt.json` | — | `finalize-incomplete` | `2` |

## Related-record fixtures

Each related record is a genuine, self-consistent document of its own schema. The **plan** and **trend** are
**cross-checked** against the receipt's recorded anchors (a mismatch is a `contradiction` ⇒ `finalize-blocked`); the
**index** and **governance** bundle fold their **own bounded posture** into the chain.

| File | Schema | Verdict | Role vs. the completed receipt |
| --- | --- | --- | --- |
| `plan-coherent.json` | `…governance-action-plan/1` | `clear` | matches `claimedPlanVerdict` → coherent |
| `plan-contradictory.json` | `…governance-action-plan/1` | `monitor` | disagrees with `claimedPlanVerdict` → contradiction |
| `trend-coherent.json` | `…governance-index-trend/1` | `trend-stable` | matches `sourceTrendVerdict` → coherent |
| `trend-contradictory.json` | `…governance-index-trend/1` | `trend-watch` | disagrees with `sourceTrendVerdict` → contradiction |
| `index-coherent.json` | `…governance-index/1` | `indexed` | a clean source-chain posture → coherent |
| `index-blocked.json` | `…governance-index/1` | `index-blocked` | a blocked source chain → `finalize-blocked` |
| `governance-coherent.json` | `…governance/1` | `closed` | a clean source-chain posture → coherent |
| `governance-open.json` | `…governance/1` | `governance-open` | an advisory / open source chain → `finalize-open` |

## How the verdict resolves

The primary receipt's OWN verdict is the base; each supplied related record can only **escalate** it, with fail-closed
precedence `blocking > open > incomplete > informational`:

- **blocked** — a tampered / `blocked` primary receipt, a **contradictory** plan / trend, a **tampered** related record, a
  **blocked source chain** (`index-blocked` / `governance-blocked`), or a `--strict-open` escalation;
- **open** — a `followup-open` receipt, or an **advisory** source chain (`index-open` / `governance-open`);
- **incomplete** — a missing / unreadable / `incomplete` primary receipt, a **required-but-missing** related record, or an
  **inconclusive** source chain (`index-incomplete` / `governance-incomplete`);
- **finalized** — a usable `completed` receipt and every supplied related record coherent.

## Run it

```sh
# The completed receipt alone → finalized (exit 0)
pnpm worker:release-decision-closeout-governance-finalize --receipt=docs/examples/release-decision-closeout-governance-finalize/receipt-completed.json --text

# A completed receipt + a fully coherent chain → finalized (exit 0)
pnpm worker:release-decision-closeout-governance-finalize \
  --receipt=docs/examples/release-decision-closeout-governance-finalize/receipt-completed.json \
  --plan=docs/examples/release-decision-closeout-governance-finalize/plan-coherent.json \
  --trend=docs/examples/release-decision-closeout-governance-finalize/trend-coherent.json \
  --index=docs/examples/release-decision-closeout-governance-finalize/index-coherent.json \
  --governance=docs/examples/release-decision-closeout-governance-finalize/governance-coherent.json --json

# An incomplete receipt → finalize-incomplete (exit 2)
pnpm worker:release-decision-closeout-governance-finalize --receipt=docs/examples/release-decision-closeout-governance-finalize/receipt-incomplete.json --json

# A followup-open receipt → finalize-open (exit 3)
pnpm worker:release-decision-closeout-governance-finalize --receipt=docs/examples/release-decision-closeout-governance-finalize/receipt-followup-open.json --json

# A blocked receipt → finalize-blocked (exit 4)
pnpm worker:release-decision-closeout-governance-finalize --receipt=docs/examples/release-decision-closeout-governance-finalize/receipt-blocked.json --json

# A supplied plan that disagrees with the receipt → finalize-blocked (exit 4), a contradiction
pnpm worker:release-decision-closeout-governance-finalize \
  --receipt=docs/examples/release-decision-closeout-governance-finalize/receipt-completed.json \
  --plan=docs/examples/release-decision-closeout-governance-finalize/plan-contradictory.json --json

# A blocked source chain → finalize-blocked (exit 4)
pnpm worker:release-decision-closeout-governance-finalize \
  --receipt=docs/examples/release-decision-closeout-governance-finalize/receipt-completed.json \
  --index=docs/examples/release-decision-closeout-governance-finalize/index-blocked.json --json

# --require-plan without a plan → finalize-incomplete (exit 2)
pnpm worker:release-decision-closeout-governance-finalize --receipt=docs/examples/release-decision-closeout-governance-finalize/receipt-completed.json --require-plan --json

# --strict-open escalates an open finalization to a hard block (exit 4)
pnpm worker:release-decision-closeout-governance-finalize --receipt=docs/examples/release-decision-closeout-governance-finalize/receipt-followup-open.json --strict-open --json

# A tampered receipt fails closed → finalize-blocked (exit 4)
pnpm worker:release-decision-closeout-governance-finalize --receipt=docs/examples/release-decision-closeout-governance-finalize/receipt-tampered.json --json

# A non-receipt decoy → finalize-incomplete (exit 2), never a vacuous finalized
pnpm worker:release-decision-closeout-governance-finalize --receipt=docs/examples/release-decision-closeout-governance-finalize/not-a-receipt.json --json

# Read the primary receipt from stdin
cat receipt.json | pnpm worker:release-decision-closeout-governance-finalize --stdin --text
```

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | **finalized** — a usable, completed primary receipt and every supplied related record coherent |
| `1` | **usage** — the CLI was misused (a bad flag, no primary receipt supplied, or an unwritable output) |
| `2` | **finalize-incomplete** — a missing / unreadable / incomplete primary receipt, a required-but-missing record, or an inconclusive source chain |
| `3` | **finalize-open** — a followup-open receipt, or an advisory / open source-chain record |
| `4` | **finalize-blocked** — a tampered / blocked receipt, a contradictory / tampered related record, a blocked source chain, or a `--strict-open` escalation |

See `docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-fixture.yml` for the full
scheduled CI job that runs the closeout-governance chain, finalizes the governance record into `$GITHUB_STEP_SUMMARY`, and
fails closed.

## Not a legal audit trail

This bundle is a **content-free operational governance finalization bundle**, not a system of record. It is **not** a legal
/ compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger,
an incident record, or an audit log — keep each of those in its own dedicated system. It attests no person's identity; its
re-derivation is **tamper-evidence over content-free data**, not a cryptographic signature (there is no signing key and no
attested identity), and a fully self-consistent fabricated record is out of its scope. The cross-checks compare bounded
verdict enums across records; they catch a swapped / edited record, not a fully-consistent forgery.
