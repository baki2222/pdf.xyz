# Release decision closeout index — example fixtures

Content-free fixtures for `pnpm worker:release-decision-closeout-index` (Phase 65). The closeout index **indexes** a
bounded **history** of content-free `pdfxyz.release-decision-closeout/1` closeout records (the Phase 64 closeout
bundles, one per release; repeated `--file`/`--closeout`, oldest first / newest last, or a `--stdin` JSON array / NDJSON
stream / single closeout) into ONE `pdfxyz.release-decision-closeout-index/1` review summary. It **re-validates each
closeout against itself** (re-deriving its Phase 64 closeout rollup from its own recorded receipt-source facets +
per-kind related-record signals + policy, mirroring the Phase 64 `computeCloseout` reducer, so a hand-flipped closeout
verdict / exit / rollup is caught as a tamper), and folds them into the **closeout-verdict distribution**
(`closed`/`closeout-incomplete`/`closeout-open`/`closeout-blocked` counts), the **latest / oldest** closeout verdict, a
per-record **posture sequence**, a **trend class**
(`all-closed`/`open-present`/`incomplete-present`/`blocked-present`/`tampered-present`/`no-usable`), an **index verdict**
+ bounded **reasons**, and an ordered **next-action checklist** — answering *"across the recent release decision
closeouts, are we **consistently closed**, or is the latest / recent history **open**, **incomplete**, or **blocked**?"*

It is **latest-focused**: the newest usable closeout drives the verdict, and bounded history thresholds
(`--max-open`/`--max-incomplete`/`--max-blocked`, each defaulting to `0`) let an operator tolerate a bounded number of
non-closed closeouts before the accumulation escalates. Everything here is **content-free**: bounded enums, small
counts, booleans, ISO stamps, and app-authored prose only — no reviewer name / email, filename, path, object key,
bucket, URL, raw ref, raw label, raw note, size, digest, or byte, even from a hostile input, and never any ingested
closeout's own stamp. It is a content-free closeout-ledger **INDEX SUMMARY ONLY** — **not** a legal audit log, a
compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger. It runs
no gate / index / decision / trend / plan / receipt / closeout itself, contacts no cloud, and signs / approves /
publishes / promotes / deletes / mutates nothing.

> **An `indexed` index requires a coherent bounded history: the latest usable closeout `closed`, no tampered / unreadable
> closeout, and the open / incomplete / blocked counts within their thresholds.** A tampered closeout, a
> `closeout-blocked` latest / threshold breach, or a `--strict-open` escalation is `index-blocked` (exit 4); an
> unreadable closeout, a `closeout-incomplete` latest / threshold breach, or zero usable closeouts is `index-incomplete`
> (exit 2); a `closeout-open` latest / threshold breach is `index-open` (exit 3). It never fabricates an `indexed` from
> thin or untrusted input.

## Closeout-record fixtures

Each `closeout-*.json` is a genuine `pdfxyz.release-decision-closeout/1` document (its recorded closeout rollup
re-derives from its own recorded facets, so the index's trust boundary marks it `usable`). `closeout-tampered.json` (a
hand-flipped verdict) and `not-a-closeout.json` (a wrong schema) prove the fail-closed paths.

| File | Closeout verdict | Role |
| --- | --- | --- |
| `closeout-closed.json` | `closed` | a completed receipt, no related records — the chain reads as closed out |
| `closeout-closed-coherent.json` | `closed` | a completed receipt cross-checked against a coherent plan + trend |
| `closeout-open.json` | `closeout-open` | a followup-open receipt — an advisory follow-up still open |
| `closeout-incomplete.json` | `closeout-incomplete` | a receipt not acknowledged as reviewed |
| `closeout-blocked.json` | `closeout-blocked` | a block plan not acknowledged as held-blocked |
| `closeout-contradictory.json` | `closeout-blocked` | a supplied plan that contradicts the receipt (a cross-check mismatch) |
| `closeout-tampered.json` | `closeout-blocked` (claimed) | a hand-flipped verdict that no longer re-derives (a tamper) |
| `not-a-closeout.json` | — | not a recognized closeout (an unreadable input) |

## Reproduce the documented index verdicts

Supply the closeouts **oldest first, newest last**. The newest usable closeout is the primary driver.

```bash
# A coherent all-closed history → indexed (exit 0)
pnpm worker:release-decision-closeout-index \
  --file=docs/examples/release-decision-closeout-index/closeout-closed.json \
  --file=docs/examples/release-decision-closeout-index/closeout-closed-coherent.json --text

# A latest-open history → index-open (exit 3); with --strict-open → index-blocked (exit 4)
pnpm worker:release-decision-closeout-index \
  --file=docs/examples/release-decision-closeout-index/closeout-closed.json \
  --file=docs/examples/release-decision-closeout-index/closeout-open.json --json

# A latest-blocked, contradictory, or tampered closeout → index-blocked (exit 4)
pnpm worker:release-decision-closeout-index \
  --file=docs/examples/release-decision-closeout-index/closeout-closed.json \
  --file=docs/examples/release-decision-closeout-index/closeout-tampered.json --json

# A latest-incomplete history, or an unreadable decoy → index-incomplete (exit 2)
pnpm worker:release-decision-closeout-index \
  --file=docs/examples/release-decision-closeout-index/closeout-closed.json \
  --file=docs/examples/release-decision-closeout-index/not-a-closeout.json --json

# Tolerate a bounded backlog: an older open with a closed latest is index-open by default, indexed under --max-open=1
pnpm worker:release-decision-closeout-index \
  --file=docs/examples/release-decision-closeout-index/closeout-open.json \
  --file=docs/examples/release-decision-closeout-index/closeout-closed.json --max-open=1 --json
```

Exit codes: `0` indexed · `1` usage · `2` index-incomplete · `3` index-open · `4` index-blocked. Emits
`worker_release_decision_closeout_index_total{verdict}`. See the deployment fixture
[`../deployment/github-actions/release-decision-closeout-index-fixture.yml`](../deployment/github-actions/release-decision-closeout-index-fixture.yml)
for the CI wiring, and the module tests under `src/lib/workers/release-decision-closeout-index/` for the proofs.
