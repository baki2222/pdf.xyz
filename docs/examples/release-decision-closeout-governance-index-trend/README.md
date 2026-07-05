# Release decision closeout governance index trend — example fixtures

Content-free fixtures for `pnpm worker:release-decision-closeout-governance-index-trend` (Phase 71). The trend
**ingests** a bounded history of content-free `pdfxyz.release-decision-closeout-governance-index/1` windows (Phase 70) a
release pipeline already produced (a quarter / year of weekly, monthly, or quarterly governance-index summaries),
**re-validates each window against itself** (re-deriving its Phase 70 index verdict from its own recorded ledger, **and**
re-checking those counts against the window's own per-record sequence + window arithmetic, so a hand-flipped index — or a
lied count consistent with it — is caught as a tamper), and folds them into one stable trend summary: the per-window
**index-verdict distribution**, the **aggregate governance distribution**, a per-window **posture sequence**, an **arc
direction** + **trend class**, a **trend verdict** + bounded **reasons**, and an ordered **next-action checklist**. It
answers ONE question a periodic release-governance review needs — *"over the recent governance-index windows, is the
closeout-governance posture trending stable, watch-worthy, incomplete, or blocked, and what follow-up is warranted?"* —
and **fails closed** when a window cannot be trusted or the history is inconclusive.

Everything here is **content-free**: bounded enums, small counts, ISO stamps, and app-authored prose only — no reviewer
name / email, filename, path, object key, bucket, URL, raw ref, raw label, raw note, size, digest, or byte, even from a
hostile input, and never an ingested window's own stamp. It is a local content-free **governance-index trend summary over
governance-index windows** — **not** a legal audit log, a compliance attestation, an external approval / signature, an
identity proof, or a deployment / promotion ledger. It runs no gate / index / decision / trend / plan / receipt /
closeout / governance itself, contacts no cloud, and signs / approves / publishes / promotes / deletes / mutates nothing.

> **A `trend-stable` trend requires a coherent bounded history:** the latest usable window an `indexed` index, no
> tampered / unreadable window, the open / incomplete / blocked counts within their thresholds, and a non-degrading
> arc. It **fails closed**: a tampered window, an `index-blocked` latest / threshold breach, or a `--strict-watch`
> escalation is `trend-blocked`; an `index-open` latest / threshold breach or a degrading arc is `trend-watch`; an
> unreadable window, an `index-incomplete` latest / threshold breach, or zero usable windows is `trend-incomplete`.
> Direction is derived from **ordered input positions** (oldest first, newest last), never from any ingested timestamp.

## Window fixtures

Each `window-*.json` is a genuine, self-consistent `pdfxyz.release-decision-closeout-governance-index/1` window (its
recorded index verdict + ledger re-derive, so the trend's trust boundary marks it `usable`). `window-tampered.json` is a
real window whose recorded index verdict was hand-flipped so it no longer re-derives, and `not-a-governance-index.json`
(a wrong schema) proves the fail-closed path.

| File | Index verdict | Role |
| --- | --- | --- |
| `window-indexed.json` | `indexed` | a coherent, consistently-closed governance history |
| `window-watch.json` | `index-open` | a window whose latest governance bundle is `governance-open` (an open follow-up) |
| `window-incomplete.json` | `index-incomplete` | a window whose latest bundle is `governance-incomplete` (a coverage gap) |
| `window-blocked.json` | `index-blocked` | a window whose latest bundle is `governance-blocked` (a blocked history) |
| `window-tampered.json` | `index-blocked` (claimed) | a hand-flipped recorded index verdict that does **not** re-derive |
| `not-a-governance-index.json` | — | not a recognized release decision closeout governance index (an unreadable input) |

## What the trend concludes

Supply windows **oldest first, newest last**. The history defaults to the newest `26` windows. The trend is
**latest-focused**: the newest usable window's own index verdict drives the verdict, bounded history thresholds tolerate
a bounded backlog, and a worsening **arc** raises a watch.

| History | Verdict | Exit | Why |
| --- | --- | --- | --- |
| `indexed` × N | `trend-stable` | `0` | a coherent history: every usable window an `indexed` index |
| `incomplete` → `indexed` (recovered, tolerated) | `trend-stable` | `0` | the latest window is clean over an earlier worse one, within thresholds |
| `indexed` → `index-open` (worsened) | `trend-watch` | `3` | the latest window is `index-open`, or the arc degraded |
| a flat `incomplete` history | `trend-incomplete` | `2` | a coverage gap — the latest window (or the count) is `index-incomplete` |
| zero usable windows (empty / all unreadable) | `trend-incomplete` | `2` | inconclusive history — never a vacuous stable |
| `indexed` → `index-blocked` | `trend-blocked` | `4` | the latest usable window is `index-blocked` (a blocked governance history) |
| any `window-tampered` | `trend-blocked` | `4` | a recorded index verdict / count that does **not** re-derive (a tamper) |
| any `not-a-governance-index` | `trend-incomplete` | `2` | an unreadable window — a coverage gap (never a vacuous stable) |

The verdict resolves with fail-closed severity precedence: any **blocking** reason (a tampered window, an
`index-blocked` latest, a blocked-threshold breach, or a `--strict-watch` escalation) → `trend-blocked`; else any
**watch** reason (an `index-open` latest, an open-threshold breach, or a degrading arc) → `trend-watch`; else any
**incomplete** reason (an unreadable window, an `index-incomplete` latest, an incomplete-threshold breach, or zero usable
windows) → `trend-incomplete`; else `trend-stable`. `--strict-watch` escalates a watch trend to `trend-blocked` — a hard
"consistently closed or blocked" gate.

## Run it

```sh
# A coherent history of indexed windows → trend-stable (exit 0)
pnpm worker:release-decision-closeout-governance-index-trend \
  --file=docs/examples/release-decision-closeout-governance-index-trend/window-indexed.json \
  --file=docs/examples/release-decision-closeout-governance-index-trend/window-indexed.json --text

# A worsening arc (indexed → open) is a watch history (exit 3) for review
pnpm worker:release-decision-closeout-governance-index-trend \
  --file=docs/examples/release-decision-closeout-governance-index-trend/window-indexed.json \
  --file=docs/examples/release-decision-closeout-governance-index-trend/window-watch.json --json

# A blocked window in the history blocks the trend closed (exit 4)
pnpm worker:release-decision-closeout-governance-index-trend \
  --file=docs/examples/release-decision-closeout-governance-index-trend/window-indexed.json \
  --file=docs/examples/release-decision-closeout-governance-index-trend/window-blocked.json --json

# A tampered window anywhere in the history fails closed (exit 4)
pnpm worker:release-decision-closeout-governance-index-trend \
  --file=docs/examples/release-decision-closeout-governance-index-trend/window-indexed.json \
  --file=docs/examples/release-decision-closeout-governance-index-trend/window-tampered.json --json

# A flat incomplete history is trend-incomplete (exit 2), never a stable
pnpm worker:release-decision-closeout-governance-index-trend \
  --file=docs/examples/release-decision-closeout-governance-index-trend/window-incomplete.json \
  --file=docs/examples/release-decision-closeout-governance-index-trend/window-incomplete.json --json

# --strict-watch escalates a watch history to blocked (exit 4)
pnpm worker:release-decision-closeout-governance-index-trend \
  --file=docs/examples/release-decision-closeout-governance-index-trend/window-indexed.json \
  --file=docs/examples/release-decision-closeout-governance-index-trend/window-watch.json --strict-watch --json

# Read a JSON array (or NDJSON stream) of windows (newest last) from stdin
cat windows-array.json | pnpm worker:release-decision-closeout-governance-index-trend --stdin --text
```

## Policy knobs

| Flag | Effect |
| --- | --- |
| `--max-indexes=N` | consider only the newest N windows (default `26`); older windows are dropped from the history (the count dropped is surfaced) |
| `--max-open=N` | tolerate up to N `index-open` windows in the history before the watch threshold escalates (default `0`) |
| `--max-incomplete=N` | tolerate up to N `index-incomplete` windows before the incomplete threshold escalates (default `0`) |
| `--max-blocked=N` | tolerate up to N `index-blocked` windows before the blocked threshold escalates (default `0`) |
| `--strict-watch` | escalate a watch trend (an open latest, an open-threshold breach, or a degrading arc) to a `trend-blocked` history — a hard "consistently closed or blocked" gate |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | **trend-stable** — a coherent history (the latest window indexed, within thresholds, non-degrading) |
| `1` | **usage** — the CLI was misused (a bad flag, no window supplied, or an unwritable output) |
| `2` | **trend-incomplete** — a coverage gap (zero usable windows, an unreadable window, an incomplete latest / breach) |
| `3` | **trend-watch** — an advisory or worsening history (an open latest / breach, or a degrading arc) |
| `4` | **trend-blocked** — a blocking / untrustworthy history (a tampered window, a blocked latest / breach, or a `--strict-watch` escalation) |

See `docs/examples/deployment/github-actions/release-decision-closeout-governance-index-trend-fixture.yml` for the full
scheduled CI job that indexes governance windows, summarizes a bounded history, renders it into `$GITHUB_STEP_SUMMARY`,
and fails closed.

## Not a legal audit trail

This trend is a **content-free governance review summary**, not a system of record. It is **not** a legal audit log, a
compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger — keep
each of those in its own dedicated system. The trend proves neither authorship nor approval; its re-derivation is
**tamper-evidence over content-free data**, not a cryptographic signature (there is no signing key and no attested
identity), and a fully self-consistent fabricated window is out of its scope.
