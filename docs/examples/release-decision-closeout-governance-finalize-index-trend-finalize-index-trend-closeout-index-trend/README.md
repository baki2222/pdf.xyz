# Release decision closeout governance finalize index trend finalize index trend closeout index trend — example fixtures

Content-free fixtures for `pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend`
(Phase 86). The trend **ingests** a bounded history of content-free
`pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index/1` windows (Phase 85)
a release pipeline already produced (a quarter / year of weekly, monthly, or quarterly closeout-index summaries),
**re-validates each window against itself** (re-deriving its Phase 85 index verdict from its own recorded coverage +
distribution + policy, **and** re-checking those counts against the window's own per-record sequence + window arithmetic, so
a hand-flipped index — or a lied count consistent with it — is caught as a tamper), and folds them into one stable trend
summary: the per-window **index-verdict distribution**, the **aggregate closeout distribution**, a per-window **posture
sequence**, an **arc direction** + **trend class**, a **trend verdict** + bounded **reasons**, and an ordered **next-action
list**. It answers ONE question a periodic release-governance review needs — *"over the recent closeout-index windows, is
the closeout-index posture improving, stable, watch-worthy, degrading, insufficient, blocked, or untrustworthy, and what
follow-up is warranted?"* — and **fails closed** when a window cannot be trusted or the history is inconclusive.

Everything here is **content-free**: bounded enums, small counts, ISO stamps, and app-authored prose only — no reviewer
name / email, filename, path, object key, bucket, URL, raw ref, raw label, raw note, size, digest, or byte, even from a
hostile input, and never an ingested window's own stamp. It is a local content-free **closeout-index trend summary over
closeout-index windows** — **not** a legal audit log, a compliance attestation, an external approval / signature, an
identity proof, or a deployment / promotion ledger. It runs no gate / index / decision / trend / plan / receipt / closeout /
governance / finalize itself, contacts no cloud, and signs / approves / publishes / promotes / deletes / mutates nothing.

> **A `stable` / `improving` trend requires a coherent bounded history:** every usable window an `indexed` index, no
> tampered / unreadable window, and the watch / incomplete / blocked counts within their thresholds. It **fails closed**: a
> tampered / unreadable window is `invalid` (the TOP precedence); an `index-blocked` / `index-invalid` usable window over
> `--max-blocked` (or as the latest), or a `--strict-watch` escalation, is `blocked`; zero usable windows, an
> `index-incomplete` latest, or an `--max-incomplete` breach is `insufficient`; an `index-open` latest or a degrading arc is
> `degrading`; a `--max-watch` breach under a clean latest is `watch`. Direction is derived from **ordered input positions**
> (oldest first, newest last), never from any ingested timestamp.

## Window fixtures

Each `window-*.json` is a genuine, self-consistent
`pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index/1` window (its recorded
index verdict + coverage + distribution re-derive, so the trend's trust boundary marks it `usable`).
`window-tampered.json` is a real window whose recorded index verdict was hand-flipped so it no longer re-derives, and
`not-a-closeout-index.json` (a wrong schema) proves the fail-closed path.

| File | Index verdict | Role |
| --- | --- | --- |
| `window-indexed.json` | `indexed` | a coherent, consistently-closed history |
| `window-open.json` | `index-open` | a window whose latest closeout record is `open` (an open follow-up) |
| `window-incomplete.json` | `index-incomplete` | a window whose latest record is `incomplete` (a coverage gap) |
| `window-blocked.json` | `index-blocked` | a window whose latest record is `blocked` (a blocked history) |
| `window-invalid.json` | `index-invalid` | a **usable** window whose closeout history contained a tampered record |
| `window-tampered.json` | `index-blocked` (claimed) | a hand-flipped recorded index verdict that does **not** re-derive |
| `not-a-closeout-index.json` | — | not a recognized release decision closeout-index window (an unreadable input) |

Note the distinction the trend draws: `window-invalid.json` is a **trustworthy** window that correctly records an
`index-invalid` closeout history (a **blocking** trend outcome), whereas `window-tampered.json` /
`not-a-closeout-index.json` are **untrustworthy inputs to the trend itself** (an `invalid` trend outcome, the top
precedence).

## What the trend concludes

Supply windows **oldest first, newest last**. The history defaults to the newest `26` windows (hard max `104`). The trend
is **latest-focused**: the newest usable window's own index verdict drives the verdict, refined by the ordered **arc**
(improving vs stable) and the bounded history thresholds (`--max-watch` / `--max-incomplete` / `--max-blocked`, each default
`0`).

| History | Verdict | Exit | Why |
| --- | --- | --- | --- |
| `indexed` × N | `stable` | `0` | a coherent history: every usable window an `indexed` index, within thresholds |
| `index-open` → `indexed` (recovered) | `improving` | `0` | the latest window is clean over an earlier worse one (a recovering arc) |
| `indexed` → `index-open` → `indexed` | `watch` | `3` | the latest is clean, but the open count exceeds `--max-watch` (a residual concern) |
| `indexed` → `index-open` (worsened) | `degrading` | `3` | the latest window is `index-open`, or the arc degraded |
| a flat `index-incomplete` history | `insufficient` | `2` | a coverage gap — the latest window is `index-incomplete`, or the count exceeds `--max-incomplete` |
| zero usable windows (empty / all bad) | `insufficient` | `2` | inconclusive history — never a vacuous stable |
| `indexed` → `index-blocked` / `index-invalid` | `blocked` | `4` | a usable window's closeout history was blocked / untrustworthy |
| any `window-tampered` / `not-a-closeout-index` | `invalid` | `4` | a window whose verdict does **not** re-derive, or is not a recognized closeout index |

The verdict resolves with fail-closed precedence: any **invalid** input (a tampered / unreadable window) → `invalid`; else
any **blocking** reason (an `index-blocked` / `index-invalid` usable window over `--max-blocked` or as the latest, or a
`--strict-watch` escalation) → `blocked`; else any **insufficient** reason (zero usable windows, an `index-incomplete`
latest, or an `--max-incomplete` breach) → `insufficient`; else the directional band — an `index-open` latest or a degrading
arc → `degrading`, a `--max-watch` breach under a clean latest → `watch`, a recovering arc to a clean latest → `improving`,
and an all-`indexed` history within thresholds → `stable`. `--strict-watch` escalates any watch / degrading trend to
`blocked` — a hard "consistently closed or blocked" gate (it never weakens the invalid precedence).
`--require-latest-indexed` demands an `indexed` latest window.

## Run it

```sh
# A coherent history of indexed windows → stable (exit 0)
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend/window-indexed.json \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend/window-indexed.json --text

# A recovering arc (open → indexed) is an improving history (exit 0)
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend/window-open.json \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend/window-indexed.json --json

# A worsening arc (indexed → open) is a degrading history (exit 3) for review
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend/window-indexed.json \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend/window-open.json --json

# A blocked / index-invalid window in the history blocks the trend closed (exit 4)
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend/window-indexed.json \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend/window-blocked.json --json

# A tampered / unreadable window anywhere in the history fails closed → invalid (exit 4)
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend/window-indexed.json \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend/window-tampered.json --json

# A flat incomplete history is insufficient (exit 2), never a stable
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend/window-incomplete.json \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend/window-incomplete.json --json

# --strict-watch escalates a watch / degrading history to a hard block (exit 4)
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend/window-indexed.json \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend/window-open.json --strict-watch --json

# Read a JSON array (or NDJSON stream) of windows (newest last) from stdin
cat windows-array.json | pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend --stdin --text
```

## Policy knobs

| Flag | Effect |
| --- | --- |
| `--max-indexes=N` | consider only the newest N windows (default `26`, hard max `104`); older windows are dropped from the history (the count dropped is surfaced) |
| `--max-watch=N` | tolerate up to N `index-open` windows before the watch threshold escalates the trend (default `0` — any open window escalates) |
| `--max-incomplete=N` | tolerate up to N `index-incomplete` windows before the incomplete threshold escalates (default `0`) |
| `--max-blocked=N` | tolerate up to N `index-blocked` + `index-invalid` windows before the blocked threshold escalates (default `0`); the latest window is never tolerated |
| `--strict-watch` | escalate any watch / degrading trend (an open latest, a watch-threshold breach, or a degrading arc) to a `blocked` history — a hard "consistently closed or blocked" gate. It never weakens the invalid (tampered / unreadable) precedence |
| `--require-latest-indexed` | require the latest usable window to be `indexed`: a non-indexed latest cannot be stable / improving and surfaces a bounded reason |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | **clean** — a coherent history (`stable`), or a recovering one (`improving`) |
| `1` | **usage** — the CLI was misused (a bad flag, no window supplied, or an unwritable output) |
| `2` | **insufficient** — a coverage gap (zero usable windows, an `index-incomplete` latest, an incomplete-threshold breach) |
| `3` | **watch / degrading** — an advisory or worsening history (a watch-threshold breach under a clean latest, or an open latest / degrading arc) |
| `4` | **blocked / invalid** — a blocking history (an `index-blocked` / `index-invalid` window over threshold, or a `--strict-watch` escalation), or an untrustworthy one (a tampered / unreadable window) |

See `docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-fixture.yml`
for the full scheduled CI job that indexes closeout windows, summarizes a bounded history, renders it into
`$GITHUB_STEP_SUMMARY`, and fails closed.

## Not a legal audit trail

This trend is a **content-free governance review summary**, not a system of record. It is **not** a legal audit log, a
compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger — keep each
of those in its own dedicated system. The trend proves neither authorship nor approval; its re-derivation is
**tamper-evidence over content-free data**, not a cryptographic signature (there is no signing key and no attested
identity), and a fully self-consistent fabricated window is out of its scope.
