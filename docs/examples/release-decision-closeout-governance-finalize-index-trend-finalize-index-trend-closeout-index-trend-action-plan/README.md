# Release decision closeout governance finalize index trend finalize index trend closeout index trend action plan — example fixtures

Content-free fixtures for `pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan` (Phase 87).
The plan **ingests** ONE content-free `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend/1` summary (Phase
86) a release pipeline already produced, **re-validates it against itself** (re-deriving its Phase 86 trend verdict from
its own recorded coverage + window distribution + arc summary, **and** re-checking that summary against the trend's own
per-window posture sequence + window arithmetic, so a hand-flipped trend verdict — or a lied window distribution
consistent with it — is caught as a tamper), and translates its bounded verdict into ONE stable operator follow-up plan:
a **plan verdict** + **urgency** + **action class**, the surfaced **source trend verdict / class / arc / latest
closeout-index posture**, an ordered **next-action checklist** (each item a stable id + a label from an allowlist +
bounded urgency / expectation enums), a bounded rationale, and a content-free **receipt**. It answers ONE question a
governance review needs — *"given this content-free closeout-index trend, what bounded follow-up plan should an
operator run next, and with what urgency?"* — and **fails closed** when the trend cannot be trusted.

Everything here is **content-free**: bounded enums, small counts, ISO stamps, and app-authored prose only — no reviewer
name / email, filename, path, object key, bucket, URL, raw ref, raw label, raw note, size, digest, or byte, even from a
hostile input, and never the ingested trend's own stamp. It is a content-free **operational follow-up plan only** —
**not** a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a
promotion ledger, an incident record, or an audit log. It runs no gate / index / decision / trend / closeout /
governance / finalize itself, contacts no cloud, and signs / approves / publishes / promotes / deletes / mutates nothing.

> **A `clear` plan requires a usable trend whose OWN verdict is a coherent `stable` or `improving` history.** An
> untrustworthy input (an unreadable / tampered trend) **dominates** — the plan over it cannot be trusted, so it is
> `invalid` (`reject-input`), never a vacuous clear plan, and no policy knob ever weakens that. `--strict-watch` escalates
> a `monitor` plan to `block-release`, and `--require-clean` escalates every non-clear plan to `block-release`, but
> neither ever fabricates a compliance approval for a clean trend.

## Trend fixtures

Each `trend-*.json` is a genuine, self-consistent `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend/1`
summary (its recorded trend verdict + summary re-derive, so the plan's trust boundary marks it `usable`).
`not-a-trend.json` (a wrong schema) proves the fail-closed path; a hand-flipped trend verdict (a runtime tamper) is
caught the same way.

| File | Trend verdict | Role |
| --- | --- | --- |
| `trend-stable.json` | `stable` | a coherent all-indexed closeout-index history |
| `trend-improving.json` | `improving` | an `index-open` window recovering to an `indexed` latest (a healthy arc) |
| `trend-watch.json` | `watch` | an older `index-open` window under a clean `indexed` latest (a residual concern) |
| `trend-degrading.json` | `degrading` | an `indexed` window worsening to an `index-open` latest (a degrading arc) |
| `trend-insufficient.json` | `insufficient` | a flat `index-incomplete` (inconclusive) history — a coverage gap |
| `trend-blocked.json` | `blocked` | an `index-blocked` latest window (a blocked closeout history) |
| `trend-invalid.json` | `invalid` | an `indexed` window plus a tampered window (an untrustworthy window in the history) |
| `not-a-trend.json` | — | not a recognized closeout-index trend (an unreadable input) |

## What the plan concludes

| Source trend | Plan verdict | Urgency | Action class | Exit | Why |
| --- | --- | --- | --- | --- | --- |
| `stable` | `clear` | `routine` | `none` | `0` | a coherent history; no follow-up beyond routine monitoring |
| `improving` | `clear` | `routine` | `confirm-improvement` | `0` | a recovering arc; confirm the improvement is sustained |
| `watch` | `monitor` | `soon` | `monitor-followups` | `3` | a residual open / incomplete posture — track the follow-ups |
| `degrading` | `monitor` | `high` | `stabilize-regression` | `3` | a worsening arc / open latest — investigate + stabilize |
| `insufficient` | `investigate` | `soon` | `complete-evidence` | `2` | a coverage gap — complete the missing closeout-index evidence |
| `blocked` | `block-release` | `immediate` | `block-and-reconcile` | `4` | a blocked window — hold promotion + reconcile |
| `invalid` (history) | `block-release` | `immediate` | `restore-history` | `4` | an untrustworthy window in the history — recover + re-trend |
| unreadable / tampered input | `invalid` | `immediate` | `reject-input` | `4` | the trend document itself can't be trusted — reject + recover |

The verdict resolves with fail-closed precedence: an **untrustworthy input** (an unreadable / tampered trend) → `invalid`
(`reject-input`, dominates and is never weakened); else the trend's OWN verdict maps as above (`blocked` →
`block-release`; `invalid`-history → `block-release`; `insufficient` → `investigate`; `watch` / `degrading` → `monitor`;
`stable` / `improving` → `clear`). `--strict-watch` escalates a `monitor` plan to `block-release` (a hard "consistently
closed or block" gate); `--require-clean` escalates every non-clear plan (`monitor` / `investigate`) to
`block-release` (a hard "stable / improving or block" gate). Both leave a `clear` plan alone, and neither weakens the
`invalid` precedence of an untrustworthy input.

## Run it

```sh
# A coherent stable / improving trend → clear (exit 0)
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan --trend=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan/trend-stable.json --text

# A worsening arc (degrading trend) → a follow-up monitor plan (exit 3, high urgency)
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan --trend=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan/trend-degrading.json --json

# A blocked trend → block-release (exit 4), hold promotion + reconcile
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan --trend=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan/trend-blocked.json --json

# An inconclusive (insufficient) trend → investigate (exit 2)
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan --trend=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan/trend-insufficient.json --json

# A non-trend decoy fails closed → invalid (exit 4), never a vacuous clear plan
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan --trend=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan/not-a-trend.json --json

# --strict-watch escalates a monitor (watch / degrading) trend to block-release (exit 4)
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan --trend=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan/trend-degrading.json --strict-watch --json

# --require-clean escalates every non-clear trend (including insufficient) to block-release (exit 4)
pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan --trend=docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan/trend-insufficient.json --require-clean --json

# Read the trend document from stdin
cat trend.json | pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan --stdin --text
```

## Policy knobs

| Flag | Effect |
| --- | --- |
| `--strict-watch` | escalate a `monitor` plan (a watch / degrading trend) to `block-release` — a hard "consistently closed or block" gate; never fabricates approval for a stable / improving trend |
| `--require-clean` | require an improving / stable trend: escalate EVERY non-clear plan (monitor / investigate) to `block-release`; never weakens the invalid precedence of an untrustworthy input |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | **clear** — a clear plan (a coherent stable / improving closeout-index history; routine monitoring only) |
| `1` | **usage** — the CLI was misused (a bad flag, no trend supplied, or an unwritable output) |
| `2` | **investigate** — an investigate plan (an `insufficient`, inconclusive history) |
| `3` | **monitor** — a monitor plan requiring follow-up (a `watch` / `degrading` history) |
| `4` | **block** — a block-release plan (a `blocked` / `invalid`-history trend, or a `--strict-watch` / `--require-clean` escalation), or an invalid plan (an unreadable / tampered trend input) |

See `docs/examples/deployment/github-actions/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan-fixture.yml`
for the full scheduled CI job that summarizes a closeout-index trend, translates it into an action plan, renders it into
`$GITHUB_STEP_SUMMARY`, and fails closed.

## Not a legal audit trail

This plan is a **content-free operational follow-up plan**, not a system of record. It is **not** a legal / compliance
sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an
incident record, or an audit log — keep each of those in its own dedicated system. The plan proves neither authorship nor
approval; its re-derivation is **tamper-evidence over content-free data**, not a cryptographic signature (there is no
signing key and no attested identity), and a fully self-consistent fabricated trend is out of its scope.
