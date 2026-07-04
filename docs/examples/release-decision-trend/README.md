# Release decision index trend — example fixtures

Content-free fixtures for `pnpm worker:release-decision-trend` (Phase 61). The trend **ingests** a bounded history of
content-free `pdfxyz.release-decision-index/1` ledger windows (Phase 60) a release pipeline already produced (a quarter
/ year of weekly or monthly decision-index windows), **re-validates each window against itself** (re-deriving its
Phase 60 index verdict from its own recorded ledger counts, **and** re-checking those counts against the window's own
per-record sequence + window arithmetic, so a hand-flipped index — or a lied count consistent with it — is caught as a
tamper), and folds them into one stable trend summary: the per-window **index-verdict distribution**, the **aggregate
decision distribution**, a per-window **posture sequence**, an **arc direction** + **trend class**, a **trend verdict**
+ bounded **reasons**, and an ordered **next-action checklist**. It answers ONE question a periodic release-governance
review needs — *"over the recent decision-index windows, are the decisions improving, stable, or degrading, is anything
blocking / inconclusive / untrustworthy, and what follow-up is warranted?"* — and **fails closed** when a window cannot
be trusted or the history is inconclusive.

Everything here is **content-free**: bounded enums, small counts, ISO stamps, and app-authored prose only — no reviewer
name / email, filename, path, object key, bucket, URL, raw ref, raw label, raw note, size, digest, or byte, even from a
hostile input, and never an ingested window's own stamp. It is a local content-free ledger-index **trend summary over
decision-index windows** — **not** a legal audit log, a compliance attestation, an external approval / signature, an
identity proof, or a deployment / promotion ledger. It runs no gate / index / decision itself, contacts no cloud, and
signs / approves / publishes / promotes / deletes / mutates nothing.

> **A `stable` trend requires a clean bounded history:** no tampered / unreadable window, and every usable window a
> clean `stable` index; `improving` additionally requires the latest window to be clean over an earlier worse one. An
> untrustworthy input (an unreadable / tampered window) **dominates** — the trend over it cannot be trusted, so it is
> `invalid`, never a vacuous clean pass. Direction is derived from **ordered input positions** (oldest first, newest
> last), never from any ingested timestamp.

## Window fixtures

Each `window-*.json` is a genuine, self-consistent `pdfxyz.release-decision-index/1` window (its recorded index verdict
+ counts re-derive, so the trend's trust boundary marks it `usable`). `window-tampered.json` is a real window whose
recorded index verdict was hand-flipped so it no longer re-derives, and `not-a-decision-index.json` (a wrong schema)
proves the fail-closed path.

| File | Index verdict | Role |
| --- | --- | --- |
| `window-stable.json` | `stable` | a clean batch of proceed decisions |
| `window-watch.json` | `watch` | a batch with an advisory (proceed-with-followup) decision |
| `window-insufficient.json` | `insufficient` | a batch with an inconclusive (insufficient) decision |
| `window-blocked.json` | `blocked` | a batch with a reject decision (a blocking outcome) |
| `window-invalid.json` | `invalid` | a self-consistent window that *concluded* invalid (an untrustworthy record in its batch) |
| `window-tampered.json` | `blocked` (claimed) | a hand-flipped recorded index verdict that does **not** re-derive |
| `not-a-decision-index.json` | — | not a recognized release decision index (an unreadable input) |

Note `window-invalid.json` is itself a **usable** window — a valid Phase 60 document that *concluded* `invalid` (an
unreadable / tampered record was in its batch). That is a **blocking** trend outcome (`blocked`), distinct from an
untrustworthy **trend input** (an unreadable / tampered window → `invalid`).

## What the trend concludes

Supply windows **oldest first, newest last**. The history defaults to the newest `26` windows.

| History | Verdict | Exit | Why |
| --- | --- | --- | --- |
| `stable` × N | `stable` | `0` | a clean history: every usable window a clean stable index |
| `watch` → `stable` (recovered) | `improving` | `0` | the latest window is clean over an earlier worse one |
| `stable` → `watch` (worsened) | `degrading` | `3` | the latest window is worse than the earliest usable window |
| a flat `watch` history | `watch` | `3` | an **advisory** window is present, no clear arc |
| every usable window `insufficient` (or zero usable) | `insufficient` | `2` | inconclusive history — not a clean pass |
| a `blocked` / `invalid` window | `blocked` | `4` | a **blocking** window — a decision batch was rejected / untrustworthy |
| any `window-tampered` | `invalid` | `4` | a recorded index verdict / count that does **not** re-derive (a tamper) |
| any `not-a-decision-index` | `invalid` | `4` | an unreadable window — the history cannot be summarized with confidence |

The verdict resolves with fail-closed precedence: **invalid input** (an unreadable / tampered window) → `invalid`;
else **blocking** (a `blocked` / `invalid` window, or a `--strict` violation) → `blocked`; else **insufficient** (zero
usable windows, or an only-insufficient history) → `insufficient`; else the **directional band** — a worsening arc is
`degrading`, a recovery to a clean latest window is `improving`, a flat advisory history is `watch`, and an all-stable
history is `stable`. `--strict` escalates **any** non-stable window to `blocked` — a hard "all-stable or block" gate.

## Run it

```sh
# A clean history of stable windows → stable (exit 0)
pnpm worker:release-decision-trend \
  --file=docs/examples/release-decision-trend/window-stable.json \
  --file=docs/examples/release-decision-trend/window-stable.json --text

# A worsening arc (stable → watch) is a degrading history (exit 3) for review
pnpm worker:release-decision-trend \
  --file=docs/examples/release-decision-trend/window-stable.json \
  --file=docs/examples/release-decision-trend/window-watch.json --json

# A blocked window in the history blocks the trend closed (exit 4)
pnpm worker:release-decision-trend \
  --file=docs/examples/release-decision-trend/window-stable.json \
  --file=docs/examples/release-decision-trend/window-blocked.json --json

# A tampered window anywhere in the history fails closed (exit 4)
pnpm worker:release-decision-trend \
  --file=docs/examples/release-decision-trend/window-stable.json \
  --file=docs/examples/release-decision-trend/window-tampered.json --json

# An only-insufficient history is insufficient (exit 2), never a stable
pnpm worker:release-decision-trend \
  --file=docs/examples/release-decision-trend/window-insufficient.json \
  --file=docs/examples/release-decision-trend/window-insufficient.json --json

# --strict escalates any non-stable window to blocked (exit 4)
pnpm worker:release-decision-trend \
  --file=docs/examples/release-decision-trend/window-stable.json \
  --file=docs/examples/release-decision-trend/window-watch.json --strict --json

# Read a JSON array (or NDJSON stream) of windows (newest last) from stdin
cat windows-array.json | pnpm worker:release-decision-trend --stdin --text
```

## Policy knobs

| Flag | Effect |
| --- | --- |
| `--max-windows=N` | consider only the newest N windows (default `26`); older windows are dropped from the history (the count dropped is surfaced) |
| `--strict` | escalate any non-stable window (watch / insufficient / blocked / invalid index) to a `blocked` history — a hard "all-stable or block" gate |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | **clear** — a clean history (improving or stable: every usable window a clean stable index) |
| `1` | **usage** — the CLI was misused (a bad flag, no window supplied, or an unwritable output) |
| `2` | **insufficient** — an inconclusive history (zero usable windows, or an only-insufficient history) |
| `3` | **watch / degrading** — an advisory or worsening history |
| `4` | **blocked / invalid** — a blocked / invalid window (blocked), or an unreadable / tampered window (invalid) |

See `docs/examples/deployment/github-actions/release-decision-trend-fixture.yml` for the full scheduled CI job that
indexes decision windows, summarizes a bounded history, renders it into `$GITHUB_STEP_SUMMARY`, and fails closed.

## Not a legal audit trail

This trend is a **content-free governance review summary**, not a system of record. It is **not** a legal audit log, a
compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger — keep
each of those in its own dedicated system. The trend proves neither authorship nor approval; its re-derivation is
**tamper-evidence over content-free data**, not a cryptographic signature (there is no signing key and no attested
identity), and a fully self-consistent fabricated window is out of its scope.
