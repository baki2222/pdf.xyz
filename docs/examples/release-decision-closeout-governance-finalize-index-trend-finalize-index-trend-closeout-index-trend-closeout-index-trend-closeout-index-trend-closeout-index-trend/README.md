# Release decision closeout governance finalize index trend finalize index trend closeout index trend closeout index trend closeout index trend — example fixtures

Content-free fixtures for `pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend`
(Phase 96). The trend **ingests** a bounded history of content-free
`pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index/1` windows (Phase 95)
a release pipeline already produced (a quarter / year of weekly, monthly, or quarterly closeout-index summaries),
**re-validates each window against itself** (re-deriving its Phase 95 index verdict from its own recorded coverage +
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

> **A `stable` / `improving` trend requires a coherent bounded history:** every usable window an `all-closed` index, no
> tampered / unreadable window, and the watch / incomplete / blocked counts within their thresholds. It **fails closed**: a
> tampered / unreadable window is `invalid` (the TOP precedence); an `blocked` / `invalid` usable window over
> `--max-blocked` (or as the latest), or a `--strict-open` escalation, is `blocked`; zero usable windows, an
> `incomplete` latest, or an `--max-incomplete` breach is `insufficient`; an `open` latest or a degrading arc is
> `degrading`; a `--max-open` breach under a clean latest is `watch`. Direction is derived from **ordered input positions**
> (oldest first, newest last), never from any ingested timestamp.

## Window fixtures

Each `window-*.json` is a genuine, self-consistent
`pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index/1` window (its recorded
index verdict + coverage + distribution re-derive, so the trend's trust boundary marks it `usable`).
`window-tampered.json` is a real window whose recorded index verdict was hand-flipped so it no longer re-derives, and
`not-a-closeout-index.json` (a wrong schema) proves the fail-closed path.

| File | Index verdict | Role |
| --- | --- | --- |
| `window-all-closed.json` | `all-closed` | a coherent, consistently-closed history |
| `window-open.json` | `open` | a window whose latest closeout record is `open` (an open follow-up) |
| `window-incomplete.json` | `incomplete` | a window whose latest record is `incomplete` (a coverage gap) |
| `window-blocked.json` | `blocked` | a window whose latest record is `blocked` (a blocked history) |
| `window-invalid.json` | `invalid` | a **usable** window whose closeout history contained a tampered record |
| `window-tampered.json` | `blocked` (claimed) | a hand-flipped recorded index verdict that does **not** re-derive |
| `not-a-closeout-index.json` | — | not a recognized release decision closeout-index window (an unreadable input) |

Note the distinction the trend draws: `window-invalid.json` is a **trustworthy** window that correctly records an
`invalid` closeout history (a **blocking** trend outcome), whereas `window-tampered.json` /
`not-a-closeout-index.json` are **untrustworthy inputs to the trend itself** (an `invalid` trend outcome, the top
precedence).

## What the trend concludes

Supply windows **oldest first, newest last**. The history defaults to the newest `26` windows (hard max `200`). The trend
is **latest-focused**: the newest usable window's own index verdict drives the verdict, refined by the ordered **arc**
(improving vs stable) and the bounded history thresholds (`--max-open` / `--max-incomplete` / `--max-blocked`, each default
`0`).

| History | Verdict | Exit | Why |
| --- | --- | --- | --- |
| `all-closed` × N | `stable` | `0` | a coherent history: every usable window an `all-closed` index, within thresholds |
| `open` → `all-closed` (recovered) | `improving` | `0` | the latest window is clean over an earlier worse one (a recovering arc) |
| `all-closed` → `open` → `all-closed` | `watch` | `3` | the latest is clean, but the open count exceeds `--max-open` (a residual concern) |
| `all-closed` → `open` (worsened) | `degrading` | `3` | the latest window is `open`, or the arc degraded |
| a flat `incomplete` history | `insufficient` | `2` | a coverage gap — the latest window is `incomplete`, or the count exceeds `--max-incomplete` |
| zero usable windows (empty / all bad) | `insufficient` | `2` | inconclusive history — never a vacuous stable |
| `all-closed` → `blocked` / `invalid` | `blocked` | `4` | a usable window's closeout history was blocked / untrustworthy |
| any `window-tampered` / `not-a-closeout-index` | `invalid` | `4` | a window whose verdict does **not** re-derive, or is not a recognized closeout index |

The verdict resolves with fail-closed precedence: any **invalid** input (a tampered / unreadable window) → `invalid`; else
any **blocking** reason (an `blocked` / `invalid` usable window over `--max-blocked` or as the latest, or a
`--strict-open` escalation) → `blocked`; else any **insufficient** reason (zero usable windows, an `incomplete`
latest, or an `--max-incomplete` breach) → `insufficient`; else the directional band — an `open` latest or a degrading
arc → `degrading`, a `--max-open` breach under a clean latest → `watch`, a recovering arc to a clean latest → `improving`,
and a fully `all-closed` history within thresholds → `stable`. `--strict-open` escalates any watch / degrading / insufficient trend to
`blocked` — a hard "consistently closed or blocked" gate (it never weakens the invalid precedence).
`--require-latest-all-closed` demands an `all-closed` latest window.

## Run it

```sh
# A coherent history of all-closed windows → stable (exit 0)
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/window-all-closed.json \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/window-all-closed.json --text

# A recovering arc (open → all-closed) is an improving history (exit 0)
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/window-open.json \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/window-all-closed.json --json

# A worsening arc (all-closed → open) is a degrading history (exit 3) for review
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/window-all-closed.json \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/window-open.json --json

# A blocked / invalid window in the history blocks the trend closed (exit 4)
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/window-all-closed.json \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/window-blocked.json --json

# A tampered / unreadable window anywhere in the history fails closed → invalid (exit 4)
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/window-all-closed.json \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/window-tampered.json --json

# A flat incomplete history is insufficient (exit 2), never a stable
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/window-incomplete.json \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/window-incomplete.json --json

# --strict-open escalates a watch / degrading history to a hard block (exit 4)
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/window-all-closed.json \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/window-open.json --strict-open --json

# Read a JSON array (or NDJSON stream) of windows (newest last) from stdin
cat windows-array.json | pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend --stdin --text
```

## Policy knobs

| Flag | Effect |
| --- | --- |
| `--max-indexes=N` | consider only the newest N windows (default `26`, hard max `200`); older windows are dropped from the history (the count dropped is surfaced) |
| `--max-open=N` | tolerate up to N `open` windows before the watch threshold escalates the trend (default `0` — any open window escalates) |
| `--max-incomplete=N` | tolerate up to N `incomplete` windows before the incomplete threshold escalates (default `0`) |
| `--max-blocked=N` | tolerate up to N `blocked` + `invalid` windows before the blocked threshold escalates (default `0`); the latest window is never tolerated |
| `--strict-open` | escalate any watch / degrading trend (an open latest, a open-threshold breach, or a degrading arc) to a `blocked` history — a hard "consistently closed or blocked" gate. It never weakens the invalid (tampered / unreadable) precedence |
| `--require-latest-all-closed` | require the latest usable window to be `all-closed`: a non-all-closed latest cannot be stable / improving and surfaces a bounded reason |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | **clean** — a coherent history (`stable`), or a recovering one (`improving`) |
| `1` | **usage** — the CLI was misused (a bad flag, no window supplied, or an unwritable output) |
| `2` | **insufficient** — a coverage gap (zero usable windows, an `incomplete` latest, an incomplete-threshold breach) |
| `3` | **watch / degrading** — an advisory or worsening history (a open-threshold breach under a clean latest, or an open latest / degrading arc) |
| `4` | **blocked / invalid** — a blocking history (an `blocked` / `invalid` window over threshold, or a `--strict-open` escalation), or an untrustworthy one (a tampered / unreadable window) |

See `docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-fixture.yml`
for the full scheduled CI job that indexes closeout windows, summarizes a bounded history, renders it into
`$GITHUB_STEP_SUMMARY`, and fails closed.

## Not a legal audit trail

This trend is a **content-free governance review summary**, not a system of record. It is **not** a legal audit log, a
compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger — keep each
of those in its own dedicated system. The trend proves neither authorship nor approval; its re-derivation is
**tamper-evidence over content-free data**, not a cryptographic signature (there is no signing key and no attested
identity), and a fully self-consistent fabricated window is out of its scope.
