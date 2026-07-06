# Release decision closeout governance finalize index trend — example fixtures

Content-free fixtures for `pnpm worker:release-decision-closeout-governance-finalize-index-trend` (Phase 76). The trend
**ingests** a bounded history of content-free `pdfxyz.release-decision-closeout-governance-finalize-index/1` windows
(Phase 75) a release pipeline already produced (a quarter / year of weekly, monthly, or quarterly finalize-index
summaries), **re-validates each window against itself** (re-deriving its Phase 75 index verdict from its own recorded
coverage + distribution + policy, **and** re-checking those counts against the window's own per-record sequence + window
arithmetic, so a hand-flipped index — or a lied count consistent with it — is caught as a tamper), and folds them into
one stable trend summary: the per-window **index-verdict distribution**, the **aggregate finalization distribution**, a
per-window **posture sequence**, an **arc direction** + **trend class**, a **trend verdict** + bounded **reasons**, and an
ordered **next-action list**. It answers ONE question a periodic release-governance review needs — *"across the recent
finalize-index windows, is the closeout-governance FINALIZATION posture improving, stable, watch-worthy, degrading / open,
insufficient, blocked, or untrustworthy, and what follow-up is warranted?"* — and **fails closed** when a window cannot be
trusted or the history is inconclusive.

Everything here is **content-free**: bounded enums, small counts, ISO stamps, and app-authored prose only — no reviewer
name / email, filename, path, object key, bucket, URL, raw ref, raw label, raw note, size, digest, or byte, even from a
hostile input, and never an ingested window's own stamp. It is a local content-free **finalize-index trend summary over
finalize-index windows** — **not** a legal audit log, a compliance attestation, an external approval / signature, an
identity proof, or a deployment / promotion ledger. It runs no gate / index / decision / trend / plan / receipt /
closeout / governance / finalize itself, contacts no cloud, and signs / approves / publishes / promotes / deletes /
mutates nothing.

> **A `stable` / `improving` trend requires a coherent bounded history:** every usable window an `indexed` index, no
> tampered / unreadable window, and no open / incomplete / blocked / invalid window. It **fails closed**: a tampered /
> unreadable window is `invalid` (the TOP precedence); an `index-blocked` / `index-invalid` usable window, or a
> `--strict-open` escalation, is `blocked`; zero usable windows, an `index-incomplete` latest, or an only-incomplete
> history is `insufficient`; an `index-open` latest or a degrading arc is `degrading`; an older open / incomplete window
> under a clean latest is `watch`. Direction is derived from **ordered input positions** (oldest first, newest last),
> never from any ingested timestamp.

## Window fixtures

Each `window-*.json` is a genuine, self-consistent `pdfxyz.release-decision-closeout-governance-finalize-index/1` window
(its recorded index verdict + coverage + distribution re-derive, so the trend's trust boundary marks it `usable`).
`window-tampered.json` is a real window whose recorded index verdict was hand-flipped so it no longer re-derives, and
`not-a-finalize-index.json` (a wrong schema) proves the fail-closed path.

| File | Index verdict | Role |
| --- | --- | --- |
| `window-indexed.json` | `indexed` | a coherent, consistently-finalized history |
| `window-open.json` | `index-open` | a window whose latest finalization bundle is `finalize-open` (an open follow-up) |
| `window-incomplete.json` | `index-incomplete` | a window whose latest bundle is `finalize-incomplete` (a coverage gap) |
| `window-blocked.json` | `index-blocked` | a window whose latest bundle is `finalize-blocked` (a blocked history) |
| `window-invalid.json` | `index-invalid` | a **usable** window whose finalization history contained a tampered bundle |
| `window-tampered.json` | `index-blocked` (claimed) | a hand-flipped recorded index verdict that does **not** re-derive |
| `not-a-finalize-index.json` | — | not a recognized release decision closeout governance finalize index (an unreadable input) |

Note the distinction the trend draws: `window-invalid.json` is a **trustworthy** window that correctly records an
`index-invalid` finalization history (a **blocking** trend outcome), whereas `window-tampered.json` /
`not-a-finalize-index.json` are **untrustworthy inputs to the trend itself** (an `invalid` trend outcome, the top
precedence).

## What the trend concludes

Supply windows **oldest first, newest last**. The history defaults to the newest `26` windows (hard max `104`). The trend
is **latest-focused**: the newest usable window's own index verdict drives the verdict, refined by the ordered **arc**
(improving vs stable, degrading vs watch).

| History | Verdict | Exit | Why |
| --- | --- | --- | --- |
| `indexed` × N | `stable` | `0` | a coherent history: every usable window an `indexed` index |
| `index-open` → `indexed` (recovered) | `improving` | `0` | the latest window is clean over an earlier worse one (a recovering arc) |
| `indexed` → `index-open` → `indexed` | `watch` | `3` | the latest window is clean, but an earlier window was open (a residual concern) |
| `indexed` → `index-open` (worsened) | `degrading` | `3` | the latest window is `index-open`, or the arc degraded |
| a flat `index-incomplete` history | `insufficient` | `2` | a coverage gap — the latest window is `index-incomplete`, or the whole history is |
| zero usable windows (empty / all bad) | `insufficient` | `2` | inconclusive history — never a vacuous stable |
| `indexed` → `index-blocked` / `index-invalid` | `blocked` | `4` | a usable window's finalization history was blocked / untrustworthy |
| any `window-tampered` / `not-a-finalize-index` | `invalid` | `4` | a window whose verdict does **not** re-derive, or is not a recognized finalize index |

The verdict resolves with fail-closed precedence: any **invalid** input (a tampered / unreadable window) → `invalid`;
else any **blocking** reason (an `index-blocked` / `index-invalid` usable window, or a `--strict-open` escalation) →
`blocked`; else any **insufficient** reason (zero usable windows, an `index-incomplete` latest, or an only-incomplete
history) → `insufficient`; else the directional band — an `index-open` latest or a degrading arc → `degrading`, a
recovering arc to a clean latest → `improving`, an older open / incomplete under a clean latest → `watch`, and an
all-`indexed` history → `stable`. `--strict-open` escalates any non-indexed usable window to `blocked` — a hard
"consistently finalized or blocked" gate (it never weakens the invalid precedence). `--require-latest-indexed` demands an
`indexed` latest window.

## Run it

```sh
# A coherent history of indexed windows → stable (exit 0)
pnpm worker:release-decision-closeout-governance-finalize-index-trend \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend/window-indexed.json \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend/window-indexed.json --text

# A recovering arc (open → indexed) is an improving history (exit 0)
pnpm worker:release-decision-closeout-governance-finalize-index-trend \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend/window-open.json \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend/window-indexed.json --json

# A worsening arc (indexed → open) is a degrading history (exit 3) for review
pnpm worker:release-decision-closeout-governance-finalize-index-trend \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend/window-indexed.json \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend/window-open.json --json

# A blocked / index-invalid window in the history blocks the trend closed (exit 4)
pnpm worker:release-decision-closeout-governance-finalize-index-trend \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend/window-indexed.json \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend/window-blocked.json --json

# A tampered / unreadable window anywhere in the history fails closed → invalid (exit 4)
pnpm worker:release-decision-closeout-governance-finalize-index-trend \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend/window-indexed.json \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend/window-tampered.json --json

# A flat incomplete history is insufficient (exit 2), never a stable
pnpm worker:release-decision-closeout-governance-finalize-index-trend \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend/window-incomplete.json \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend/window-incomplete.json --json

# --strict-open escalates any non-indexed history to a hard block (exit 4)
pnpm worker:release-decision-closeout-governance-finalize-index-trend \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend/window-indexed.json \
  --file=docs/examples/release-decision-closeout-governance-finalize-index-trend/window-open.json --strict-open --json

# Read a JSON array (or NDJSON stream) of windows (newest last) from stdin
cat windows-array.json | pnpm worker:release-decision-closeout-governance-finalize-index-trend --stdin --text
```

## Policy knobs

| Flag | Effect |
| --- | --- |
| `--max-windows=N` | consider only the newest N windows (default `26`, hard max `104`); older windows are dropped from the history (the count dropped is surfaced) |
| `--strict-open` | escalate ANY non-indexed usable window (an open / incomplete / recovering history) to a `blocked` history — a hard "consistently finalized or blocked" gate. It never weakens the invalid (tampered / unreadable) precedence |
| `--require-latest-indexed` | require the latest usable window to be `indexed`: a non-indexed latest cannot be stable / improving and surfaces a bounded reason |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | **clean** — a coherent history (`stable`), or a recovering one (`improving`) |
| `1` | **usage** — the CLI was misused (a bad flag, no window supplied, or an unwritable output) |
| `2` | **insufficient** — a coverage gap (zero usable windows, an `index-incomplete` latest, an only-incomplete history) |
| `3` | **watch / degrading** — an advisory or worsening history (an older open/incomplete under a clean latest, or an open latest / degrading arc) |
| `4` | **blocked / invalid** — a blocking history (an `index-blocked` / `index-invalid` window, or a `--strict-open` escalation), or an untrustworthy one (a tampered / unreadable window) |

See `docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-fixture.yml` for
the full scheduled CI job that indexes finalization windows, summarizes a bounded history, renders it into
`$GITHUB_STEP_SUMMARY`, and fails closed.

## Not a legal audit trail

This trend is a **content-free governance review summary**, not a system of record. It is **not** a legal audit log, a
compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger — keep
each of those in its own dedicated system. The trend proves neither authorship nor approval; its re-derivation is
**tamper-evidence over content-free data**, not a cryptographic signature (there is no signing key and no attested
identity), and a fully self-consistent fabricated window is out of its scope.
