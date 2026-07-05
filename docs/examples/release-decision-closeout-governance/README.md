# Release decision closeout governance bundle — example fixtures

Content-free fixtures for `pnpm worker:release-decision-closeout-governance` (Phase 69). The bundle **ingests** a
**required** content-free `pdfxyz.release-decision-closeout-action-receipt/1` primary receipt (Phase 68) plus, optionally,
the related closeout-chain records it was built from — the follow-up plan (Phase 67), the closeout-index trend (Phase 66),
the closeout index (Phase 65), and the closeout bundle (Phase 64) — **re-validates each record against itself** (each is
re-run through the exact downstream boundary that already consumes it, so a hand-flipped verdict is caught as a tamper),
**cross-checks** the supplied plan / trend against what the primary receipt recorded, folds every supplied source-chain
record's own bounded posture, and rolls them into ONE stable `pdfxyz.release-decision-closeout-governance/1` document with
a **governance verdict**, a **primary-receipt summary**, a bounded **related-record checklist**, an **archive checklist**,
an ordered **follow-up assignment list**, and a content-free **receipt**. It answers ONE question a governance review needs
— *"is this closeout governance chain fully **closed**, **open**, **incomplete**, or **blocked**?"* — and **fails closed**
when the primary receipt cannot be trusted or a supplied record contradicts / blocks the chain.

Everything here is **content-free**: bounded enums, small counts, booleans, ISO stamps, and app-authored prose only — no
reviewer name / email, filename, path, object key, bucket, URL, raw ref, raw label, raw note, size, digest, or byte, even
from a hostile input, and never an ingested record's own stamp. It is a content-free **operational governance bundle
only** — **not** a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment
authorization, a promotion ledger, an incident record, or an audit log. It runs no gate / index / decision / trend / plan
/ closeout / receipt itself, contacts no cloud, and signs / approves / publishes / promotes / deletes / mutates nothing.

> **A `closed` bundle requires a usable primary receipt whose OWN verdict is `completed` AND every supplied related
> record coherent.** A missing / unreadable primary receipt is `governance-incomplete` (nothing to certify); a tampered /
> `blocked` receipt, a contradictory plan / trend, a tampered related record, or a blocked source chain is
> `governance-blocked`; a required-but-missing related record, an `incomplete` receipt, or an inconclusive source chain is
> `governance-incomplete`; a `followup-open` receipt or an advisory source chain is `governance-open`. `--strict-open`
> escalates an open governance to `governance-blocked`. It never fabricates a `closed`.

## Primary receipt fixtures

Each `receipt-*.json` is a genuine, self-consistent `pdfxyz.release-decision-closeout-action-receipt/1` document (its
recorded receipt decision re-derives from its own recorded source facets, so the bundle's trust boundary marks it
`usable`). `receipt-tampered.json` (a hand-flipped verdict) and `not-a-receipt.json` (a wrong schema) prove the
fail-closed paths. The completed receipt is **clear-anchored** (built from a clear plan over a `trend-stable` trend), so it
records `claimedPlanVerdict = "clear"` and `sourceTrendVerdict = "trend-stable"` — the anchors the related plan / trend are
cross-checked against.

| File | Receipt verdict | Governance verdict (alone) | Exit |
| --- | --- | --- | --- |
| `receipt-completed.json` | `completed` | `closed` | `0` |
| `receipt-incomplete.json` | `incomplete` | `governance-incomplete` | `2` |
| `receipt-followup-open.json` | `followup-open` | `governance-open` | `3` |
| `receipt-blocked.json` | `blocked` | `governance-blocked` | `4` |
| `receipt-tampered.json` | `completed` (claimed) | `governance-blocked` | `4` |
| `not-a-receipt.json` | — | `governance-incomplete` | `2` |

## Related-record fixtures

Each related record is a genuine, self-consistent document of its own schema. The **plan** and **trend** are
**cross-checked** against the receipt's recorded anchors (a mismatch is a `contradiction` ⇒ `governance-blocked`); the
**index** and **closeout** fold their **own bounded posture** into the chain.

| File | Schema | Verdict | Role vs. the completed receipt |
| --- | --- | --- | --- |
| `plan-coherent.json` | `…closeout-action-plan/1` | `clear` | matches `claimedPlanVerdict` → coherent |
| `plan-contradictory.json` | `…closeout-action-plan/1` | `monitor` | disagrees with `claimedPlanVerdict` → contradiction |
| `trend-coherent.json` | `…closeout-index-trend/1` | `trend-stable` | matches `sourceTrendVerdict` → coherent |
| `trend-contradictory.json` | `…closeout-index-trend/1` | `trend-watch` | disagrees with `sourceTrendVerdict` → contradiction |
| `index-coherent.json` | `…closeout-index/1` | `indexed` | a clean source-chain posture → coherent |
| `index-blocked.json` | `…closeout-index/1` | `index-blocked` | a blocked source chain → `governance-blocked` |
| `closeout-coherent.json` | `…closeout/1` | `closed` | a clean source-chain posture → coherent |
| `closeout-open.json` | `…closeout/1` | `closeout-open` | an advisory / open source chain → `governance-open` |

## How the verdict resolves

The primary receipt's OWN verdict is the base; each supplied related record can only **escalate** it, with fail-closed
precedence `blocking > open > incomplete > informational`:

- **blocked** — a tampered / `blocked` primary receipt, a **contradictory** plan / trend, a **tampered** related record, a
  **blocked source chain** (`index-blocked` / `closeout-blocked`), or a `--strict-open` escalation;
- **open** — a `followup-open` receipt, or an **advisory** source chain (`index-open` / `closeout-open`);
- **incomplete** — a missing / unreadable / `incomplete` primary receipt, a **required-but-missing** related record, or an
  **inconclusive** source chain (`index-incomplete` / `closeout-incomplete`);
- **closed** — a usable `completed` receipt and every supplied related record coherent.

## Run it

```sh
# The completed receipt alone → closed (exit 0)
pnpm worker:release-decision-closeout-governance --receipt=docs/examples/release-decision-closeout-governance/receipt-completed.json --text

# A completed receipt + a fully coherent chain → closed (exit 0)
pnpm worker:release-decision-closeout-governance \
  --receipt=docs/examples/release-decision-closeout-governance/receipt-completed.json \
  --plan=docs/examples/release-decision-closeout-governance/plan-coherent.json \
  --trend=docs/examples/release-decision-closeout-governance/trend-coherent.json \
  --index=docs/examples/release-decision-closeout-governance/index-coherent.json \
  --closeout=docs/examples/release-decision-closeout-governance/closeout-coherent.json --json

# An incomplete receipt → governance-incomplete (exit 2)
pnpm worker:release-decision-closeout-governance --receipt=docs/examples/release-decision-closeout-governance/receipt-incomplete.json --json

# A followup-open receipt → governance-open (exit 3)
pnpm worker:release-decision-closeout-governance --receipt=docs/examples/release-decision-closeout-governance/receipt-followup-open.json --json

# A blocked receipt → governance-blocked (exit 4)
pnpm worker:release-decision-closeout-governance --receipt=docs/examples/release-decision-closeout-governance/receipt-blocked.json --json

# A supplied plan that disagrees with the receipt → governance-blocked (exit 4), a contradiction
pnpm worker:release-decision-closeout-governance \
  --receipt=docs/examples/release-decision-closeout-governance/receipt-completed.json \
  --plan=docs/examples/release-decision-closeout-governance/plan-contradictory.json --json

# A blocked source chain → governance-blocked (exit 4)
pnpm worker:release-decision-closeout-governance \
  --receipt=docs/examples/release-decision-closeout-governance/receipt-completed.json \
  --index=docs/examples/release-decision-closeout-governance/index-blocked.json --json

# --require-plan without a plan → governance-incomplete (exit 2)
pnpm worker:release-decision-closeout-governance --receipt=docs/examples/release-decision-closeout-governance/receipt-completed.json --require-plan --json

# --strict-open escalates an open governance to a hard block (exit 4)
pnpm worker:release-decision-closeout-governance --receipt=docs/examples/release-decision-closeout-governance/receipt-followup-open.json --strict-open --json

# A tampered receipt fails closed → governance-blocked (exit 4)
pnpm worker:release-decision-closeout-governance --receipt=docs/examples/release-decision-closeout-governance/receipt-tampered.json --json

# A non-receipt decoy → governance-incomplete (exit 2), never a vacuous closed
pnpm worker:release-decision-closeout-governance --receipt=docs/examples/release-decision-closeout-governance/not-a-receipt.json --json

# Read the primary receipt from stdin
cat receipt.json | pnpm worker:release-decision-closeout-governance --stdin --text
```

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | **closed** — a usable, completed primary receipt and every supplied related record coherent |
| `1` | **usage** — the CLI was misused (a bad flag, no primary receipt supplied, or an unwritable output) |
| `2` | **governance-incomplete** — a missing / unreadable / incomplete primary receipt, a required-but-missing record, or an inconclusive source chain |
| `3` | **governance-open** — a followup-open receipt, or an advisory / open source-chain record |
| `4` | **governance-blocked** — a tampered / blocked receipt, a contradictory / tampered related record, a blocked source chain, or a `--strict-open` escalation |

See `docs/examples/deployment/github-actions/release-decision-closeout-governance-fixture.yml` for the full scheduled CI
job that runs the closeout chain, bundles the governance record into `$GITHUB_STEP_SUMMARY`, and fails closed.

## Not a legal audit trail

This bundle is a **content-free operational governance bundle**, not a system of record. It is **not** a legal /
compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger,
an incident record, or an audit log — keep each of those in its own dedicated system. It attests no person's identity; its
re-derivation is **tamper-evidence over content-free data**, not a cryptographic signature (there is no signing key and no
attested identity), and a fully self-consistent fabricated record is out of its scope. The cross-checks compare bounded
verdict enums across records; they catch a swapped / edited record, not a fully-consistent forgery.
