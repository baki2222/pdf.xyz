# Release decision ledger index — example fixtures

Content-free fixtures for `pnpm worker:release-decision-index` (Phase 60). The index **ingests** a bounded batch of
content-free `pdfxyz.release-decision/1` decision records (Phase 59) a release pipeline already produced (a sprint /
month of release decisions), **re-validates each record against itself** (re-deriving its Phase 59 decision from its
own recorded publish-pack / acknowledgement summaries + cross-check + strict flag, so a hand-flipped decision is
caught as a tamper), and folds them into one stable ledger index summary: the **decision distribution**, per-source
posture (cross-check) counts, a per-record **posture sequence**, an **index verdict** + bounded **reasons**, and an
ordered **next-action checklist**. It answers ONE question a release-decision review needs — *"over the batch of
release decisions, what did they decide, is anything blocking / inconclusive / untrustworthy, and what follow-up is
warranted?"* — and **fails closed** when a record cannot be trusted or the batch is inconclusive.

Everything here is **content-free**: bounded enums, small counts, ISO stamps, and app-authored prose only — no
reviewer name / email, filename, path, object key, bucket, URL, raw ref, raw label, raw note, size, digest, or byte,
even from a hostile input, and never an ingested record's own stamp. It is a local content-free ledger **index
summary over decision records** — **not** a legal audit log, a compliance attestation, an external approval /
signature, an identity proof, or a deployment / promotion ledger. It runs no gate / bundle / audit / report /
decision itself, contacts no cloud, and signs / approves / publishes / promotes / deletes / mutates nothing.

> **A `stable` index requires a clean bounded batch:** no tampered / unreadable record, and every usable record a
> clean `proceed`. An untrustworthy input (an unreadable / tampered record) **dominates** — the index over it cannot
> be trusted, so it is `invalid`, never a vacuous stable.

## Record fixtures

Each `decision-*.json` is a genuine, self-consistent `pdfxyz.release-decision/1` record (its recorded decision
re-derives, so the index's trust boundary marks it `usable`). `decision-tampered.json` is a real record whose recorded
decision was hand-flipped so it no longer re-derives, and `not-a-decision.json` (a wrong schema) proves the fail-closed
path.

| File | Decision | Role |
| --- | --- | --- |
| `decision-proceed.json` | `proceed` | a publishable pack + a clean `accepted` acknowledgement of it |
| `decision-proceed-with-followup.json` | `proceed-with-followup` | a share-safe release with a recorded follow-up |
| `decision-hold.json` | `hold` | a release whose pack needs internal review |
| `decision-insufficient.json` | `insufficient` | a release whose acknowledgement was deferred (inconclusive) |
| `decision-reject.json` | `reject` | a release whose acknowledgement rejected it (a blocking outcome) |
| `decision-invalid.json` | `invalid` | a self-consistent record whose evidence pair was incoherent (cross-check mismatch) |
| `decision-tampered.json` | `reject` (claimed) | a hand-flipped recorded decision that does **not** re-derive |
| `not-a-decision.json` | — | not a recognized release decision record (an unreadable input) |

Note `decision-invalid.json` is itself a **usable** record — a valid Phase 59 document that *concluded* `invalid`
(its pack / ack pair did not correspond). That is a **blocking** ledger outcome (`blocked`), distinct from an
untrustworthy **index input** (an unreadable / tampered record → `invalid`).

## What the index concludes

Supply records **oldest first, newest last**. The window defaults to the newest `100` records.

| Batch | Verdict | Exit | Why |
| --- | --- | --- | --- |
| `proceed` × N | `stable` | `0` | a clean batch: every usable record a clean proceed, no untrustworthy input |
| … a `proceed-with-followup` / `hold` | `watch` | `3` | an **advisory** decision is present |
| … an `insufficient` decision (or zero usable) | `insufficient` | `2` | inconclusive evidence — not a clean batch |
| … a `reject` / `invalid` decision | `blocked` | `4` | a **blocking** decision — a release was rejected or its pair untrustworthy |
| any `decision-tampered` | `invalid` | `4` | a recorded decision that does **not** re-derive (a tamper) |
| any `not-a-decision` | `invalid` | `4` | an unreadable record — the batch cannot be indexed with confidence |
| empty / all unreadable | `insufficient` / `invalid` | `2` / `4` | zero usable records is insufficient; an unreadable record is invalid |

The verdict resolves with fail-closed precedence: **invalid input** (an unreadable / tampered record) → `invalid`;
else **blocking** (a `reject` / `invalid` decision) → `blocked`; else **insufficient** (zero usable records, or an
`insufficient` decision) → `insufficient`; else **advisory** (a `proceed-with-followup` / `hold` decision) →
`watch`; else `stable`. `--strict` escalates a `watch` / `insufficient` batch to `blocked` — a hard "clean proceed
or block" gate.

## Run it

```sh
# A clean batch of proceed records → stable (exit 0)
pnpm worker:release-decision-index \
  --file=docs/examples/release-decision-index/decision-proceed.json \
  --file=docs/examples/release-decision-index/decision-proceed.json --text

# A reject decision in the batch blocks the index closed (exit 4)
pnpm worker:release-decision-index \
  --file=docs/examples/release-decision-index/decision-proceed.json \
  --file=docs/examples/release-decision-index/decision-reject.json --json

# A tampered record anywhere in the batch fails closed (exit 4)
pnpm worker:release-decision-index \
  --file=docs/examples/release-decision-index/decision-proceed.json \
  --file=docs/examples/release-decision-index/decision-tampered.json --json

# An insufficient decision makes the batch insufficient (exit 2), never a stable
pnpm worker:release-decision-index \
  --file=docs/examples/release-decision-index/decision-proceed.json \
  --file=docs/examples/release-decision-index/decision-insufficient.json --json

# --strict escalates a followup / hold batch to blocked (exit 4)
pnpm worker:release-decision-index \
  --file=docs/examples/release-decision-index/decision-proceed.json \
  --file=docs/examples/release-decision-index/decision-proceed-with-followup.json --strict --json

# Read a JSON array (or NDJSON stream) of records (newest last) from stdin
cat decisions-array.json | pnpm worker:release-decision-index --stdin --text
```

## Policy knobs

| Flag | Effect |
| --- | --- |
| `--max-records=N` | consider only the newest N records (default `100`); older records are dropped from the window (the count dropped is surfaced) |
| `--strict` | escalate any advisory (proceed-with-followup / hold) or insufficiency to a `blocked` index — a hard "clean proceed or block" gate |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | **stable** — a clean batch (every usable record a clean proceed, no tampered / unreadable record) |
| `1` | **usage** — the CLI was misused (a bad flag, no record supplied, or an unwritable output) |
| `2` | **insufficient** — an inconclusive batch (zero usable records, or an insufficient decision) |
| `3` | **watch** — an advisory batch (a proceed-with-followup / hold decision present) |
| `4` | **blocked / invalid** — a reject / invalid decision (blocked), or an unreadable / tampered record (invalid) |

See `docs/examples/deployment/github-actions/release-decision-index-fixture.yml` for the full scheduled CI job that
files decision records, indexes a bounded batch, renders it into `$GITHUB_STEP_SUMMARY`, and fails closed.

## Not a legal audit trail

This index is a **content-free review summary**, not a system of record. It is **not** a legal audit log, a
compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger —
keep each of those in its own dedicated system. The index proves neither authorship nor approval; its
re-derivation is **tamper-evidence over content-free data**, not a cryptographic signature (there is no signing key
and no attested identity).
