# Release decision closeout governance index trend action plan — example fixtures

Content-free fixtures for `pnpm worker:release-decision-closeout-governance-action-plan` (Phase 72). The plan **ingests**
ONE content-free `pdfxyz.release-decision-closeout-governance-index-trend/1` summary (Phase 71) a release pipeline
already produced, **re-validates it against itself** (re-deriving its Phase 71 trend verdict from its own recorded
per-window summary, **and** re-checking that summary against the trend's own per-window posture sequence + window
arithmetic, so a hand-flipped trend verdict — or a lied window distribution consistent with it — is caught as a tamper),
and translates its bounded verdict into ONE stable operator follow-up plan: a **plan verdict** + **urgency** + **action
class**, the surfaced **source trend verdict / class / arc / latest governance-index posture**, an ordered **next-action
checklist** (each item a stable id + a label from an allowlist + bounded urgency / expectation enums), a bounded
rationale, and a content-free **receipt**. It answers ONE question a governance review needs — *"given this content-free
governance-index trend, what bounded follow-up posture should the release team take next, and at what urgency?"* — and
**fails closed** when the trend cannot be trusted.

Everything here is **content-free**: bounded enums, small counts, ISO stamps, and app-authored prose only — no reviewer
name / email, filename, path, object key, bucket, URL, raw ref, raw label, raw note, size, digest, or byte, even from a
hostile input, and never the ingested trend's own stamp. It is a content-free **operational follow-up plan only** —
**not** a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization,
a promotion ledger, an incident record, or an audit log. It runs no gate / index / decision / trend / governance /
closeout itself, contacts no cloud, and signs / approves / publishes / promotes / deletes / mutates nothing.

> **A `clear` plan requires a usable trend whose OWN verdict is a coherent `trend-stable` history.** An untrustworthy
> input (an unreadable / tampered trend) **dominates** — the plan over it cannot be trusted, so it is `block-release`
> (`reject-input`), never a vacuous clear plan. `--strict-watch` escalates a `monitor` plan to `block-release`, but never
> fabricates a compliance approval for a stable trend.

## Trend fixtures

Each `trend-*.json` is a genuine, self-consistent `pdfxyz.release-decision-closeout-governance-index-trend/1` summary
(its recorded trend verdict + summary re-derive, so the plan's trust boundary marks it `usable`). `not-a-trend.json` (a
wrong schema) proves the fail-closed path; a hand-flipped trend verdict (a runtime tamper) is caught the same way.

| File | Trend verdict | Role |
| --- | --- | --- |
| `trend-stable.json` | `trend-stable` | a coherent all-indexed governance-index history |
| `trend-incomplete.json` | `trend-incomplete` | a flat incomplete (inconclusive) history — a coverage gap |
| `trend-watch.json` | `trend-watch` | an indexed window worsening to an `index-open` latest (a degrading arc) |
| `trend-blocked.json` | `trend-blocked` | an `index-blocked` latest window (a tampered / blocked governance batch) |
| `not-a-trend.json` | — | not a recognized release decision closeout governance index trend (an unreadable input) |

## What the plan concludes

| Source trend | Plan verdict | Urgency | Action class | Exit | Why |
| --- | --- | --- | --- | --- | --- |
| `trend-stable` | `clear` | `none` | `none` | `0` | a coherent history; no follow-up beyond routine monitoring |
| `trend-incomplete` | `investigate` | `medium` | `complete-evidence` | `2` | a coverage gap — complete the missing governance-index evidence |
| `trend-watch` | `monitor` | `high` | `monitor-followups` | `3` | an open / degrading posture — track the follow-ups + investigate |
| `trend-blocked` | `block-release` | `critical` | `block-and-reconcile` | `4` | a tampered / blocked window — hold + reconcile |
| unreadable / tampered input | `block-release` | `critical` | `reject-input` | `4` | the trend itself can't be trusted — reject + recover |

The verdict resolves with fail-closed precedence: **untrusted input** (an unreadable / tampered trend) → `block-release`
(`reject-input`); else the trend's OWN verdict maps as above (`trend-blocked` → `block-release`; `trend-watch` →
`monitor`; `trend-incomplete` → `investigate`; `trend-stable` → `clear`). `--strict-watch` escalates a `monitor` plan to
`block-release` — a hard "consistently closed or block" gate — but leaves a `clear` / `investigate` / already-blocked
plan alone.

## Run it

```sh
# A coherent stable trend → clear (exit 0)
pnpm worker:release-decision-closeout-governance-action-plan --trend=docs/examples/release-decision-closeout-governance-action-plan/trend-stable.json --text

# A worsening arc (watch trend) → a follow-up monitor plan (exit 3)
pnpm worker:release-decision-closeout-governance-action-plan --trend=docs/examples/release-decision-closeout-governance-action-plan/trend-watch.json --json

# A blocked trend → block-release (exit 4), hold promotion + reconcile
pnpm worker:release-decision-closeout-governance-action-plan --trend=docs/examples/release-decision-closeout-governance-action-plan/trend-blocked.json --json

# An inconclusive (incomplete) trend → investigate (exit 2)
pnpm worker:release-decision-closeout-governance-action-plan --trend=docs/examples/release-decision-closeout-governance-action-plan/trend-incomplete.json --json

# A non-trend decoy fails closed → block-release (exit 4), never a vacuous clear plan
pnpm worker:release-decision-closeout-governance-action-plan --trend=docs/examples/release-decision-closeout-governance-action-plan/not-a-trend.json --json

# --strict-watch escalates a monitor (watch / degrading) trend to block-release (exit 4)
pnpm worker:release-decision-closeout-governance-action-plan --trend=docs/examples/release-decision-closeout-governance-action-plan/trend-watch.json --strict-watch --json

# Read the trend document from stdin
cat trend.json | pnpm worker:release-decision-closeout-governance-action-plan --stdin --text
```

## Policy knobs

| Flag | Effect |
| --- | --- |
| `--strict-watch` | escalate a `monitor` plan (a watch / degrading trend) to `block-release` — a hard "consistently closed or block" gate; never fabricates approval for a stable trend |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | **clear** — a clear plan (a coherent, stable governance-index history; routine monitoring only) |
| `1` | **usage** — the CLI was misused (a bad flag, no trend supplied, or an unwritable output) |
| `2` | **investigate** — an investigate plan (a `trend-incomplete`, inconclusive history) |
| `3` | **monitor** — a monitor plan requiring follow-up (a `trend-watch` / degrading history) |
| `4` | **block** — a block-release plan (a `trend-blocked` history, an unreadable / tampered trend input, or a `--strict-watch` escalation) |

See `docs/examples/deployment/github-actions/release-decision-closeout-governance-action-plan-fixture.yml` for the full
scheduled CI job that summarizes a governance-index trend, translates it into an action plan, renders it into
`$GITHUB_STEP_SUMMARY`, and fails closed.

## Not a legal audit trail

This plan is a **content-free operational follow-up plan**, not a system of record. It is **not** a legal / compliance
sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an
incident record, or an audit log — keep each of those in its own dedicated system. The plan proves neither authorship nor
approval; its re-derivation is **tamper-evidence over content-free data**, not a cryptographic signature (there is no
signing key and no attested identity), and a fully self-consistent fabricated trend is out of its scope.
