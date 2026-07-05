# Release decision trend action plan — example fixtures

Content-free fixtures for `pnpm worker:release-decision-action-plan` (Phase 62). The plan **ingests** ONE content-free
`pdfxyz.release-decision-trend/1` summary (Phase 61) a release pipeline already produced, **re-validates it against
itself** (re-deriving its Phase 61 trend verdict from its own recorded window-verdict summary, **and** re-checking that
summary against the trend's own per-window posture sequence + window arithmetic, so a hand-flipped trend verdict — or a
lied window distribution consistent with it — is caught as a tamper), and translates its bounded verdict into ONE stable
operator follow-up plan: a **plan verdict** + **urgency** + **action class**, the surfaced **source trend verdict /
class / arc**, an ordered **next-action checklist** (each item a stable id + a label from an allowlist + bounded urgency
/ expectation enums), a bounded rationale, and a content-free **receipt**. It answers ONE question a governance review
needs — *"given this content-free decision-trend summary, what bounded follow-up plan should an operator run next, and
at what urgency?"* — and **fails closed** when the trend cannot be trusted.

Everything here is **content-free**: bounded enums, small counts, ISO stamps, and app-authored prose only — no reviewer
name / email, filename, path, object key, bucket, URL, raw ref, raw label, raw note, size, digest, or byte, even from a
hostile input, and never the ingested trend's own stamp. It is a content-free **operational follow-up plan only** —
**not** a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization,
a promotion ledger, an incident record, or an audit log. It runs no gate / index / decision / trend itself, contacts no
cloud, and signs / approves / publishes / promotes / deletes / mutates nothing.

> **A `clear` plan requires a usable trend whose OWN verdict is a clean `stable` history.** An untrustworthy input (an
> unreadable / tampered trend) **dominates** — the plan over it cannot be trusted, so it is `invalid` (`reject-input`),
> never a vacuous clear plan. `--strict` escalates **any** non-clear plan to `block-release`, but never fabricates a
> compliance approval for a clean trend.

## Trend fixtures

Each `trend-*.json` is a genuine, self-consistent `pdfxyz.release-decision-trend/1` summary (its recorded trend verdict
+ summary re-derive, so the plan's trust boundary marks it `usable`). `not-a-trend.json` (a wrong schema) proves the
fail-closed path; a hand-flipped trend verdict (a runtime tamper) is caught the same way.

| File | Trend verdict | Role |
| --- | --- | --- |
| `trend-stable.json` | `stable` | a clean history of stable decision-index windows |
| `trend-improving.json` | `improving` | a watch window recovering to a clean stable latest window |
| `trend-watch.json` | `watch` | a flat advisory history |
| `trend-degrading.json` | `degrading` | a stable window worsening to a watch latest window |
| `trend-insufficient.json` | `insufficient` | an only-insufficient (inconclusive) history |
| `trend-blocked.json` | `blocked` | a blocked window in the history (a rejected decision batch) |
| `trend-invalid.json` | `invalid` | a self-consistent trend that *concluded* invalid (an untrustworthy window in its history) |
| `not-a-trend.json` | — | not a recognized release decision trend (an unreadable input) |

Note `trend-invalid.json` is itself a **usable** trend — a valid Phase 61 document that *concluded* `invalid` (an
unreadable / tampered decision-index window was in its history). That is a **block-release** plan (`restore-evidence`),
distinct from an untrustworthy **trend input** (an unreadable / tampered trend document → `invalid` / `reject-input`).

## What the plan concludes

| Source trend | Plan verdict | Urgency | Action class | Exit | Why |
| --- | --- | --- | --- | --- | --- |
| `stable` | `clear` | `none` | `none` | `0` | a clean history; no follow-up beyond the cadence |
| `improving` | `monitor` | `low` | `monitor-next-window` | `0` | a benign recovering arc — confirm it is sustained |
| `watch` | `monitor` | `medium` | `review-followups` | `3` | a flat advisory — track the follow-ups to closure |
| `degrading` | `monitor` | `high` | `stabilize-regression` | `3` | a worsening arc — investigate + stabilize |
| `insufficient` | `investigate` | `medium` | `restore-evidence` | `2` | inconclusive — complete the missing evidence |
| `blocked` | `block-release` | `critical` | `block-and-reconcile` | `4` | a rejected decision batch — hold + reconcile |
| `invalid` | `block-release` | `critical` | `restore-evidence` | `4` | an untrustworthy window — recover + re-trend |
| unreadable / tampered input | `invalid` | `critical` | `reject-input` | `4` | the trend itself can't be trusted — reject + recover |

The verdict resolves with fail-closed precedence: **untrusted input** (an unreadable / tampered trend) → `invalid`; else
the trend's OWN verdict maps as above (`blocked` / `invalid` → `block-release`; `insufficient` → `investigate`; `watch`
/ `degrading` → a follow-up `monitor`; `improving` / `stable` → `monitor` / `clear`). `--strict` escalates any non-clear
plan to `block-release` — a hard "all-clear or block" gate — but leaves a `clear` trend alone.

## Run it

```sh
# A clean stable trend → clear (exit 0)
pnpm worker:release-decision-action-plan --trend=docs/examples/release-decision-action-plan/trend-stable.json --text

# A worsening arc (degrading trend) → a follow-up monitor plan (exit 3)
pnpm worker:release-decision-action-plan --trend=docs/examples/release-decision-action-plan/trend-degrading.json --json

# A blocked trend → block-release (exit 4), hold promotion + reconcile
pnpm worker:release-decision-action-plan --trend=docs/examples/release-decision-action-plan/trend-blocked.json --json

# An inconclusive (insufficient) trend → investigate (exit 2)
pnpm worker:release-decision-action-plan --trend=docs/examples/release-decision-action-plan/trend-insufficient.json --json

# A non-trend decoy fails closed → invalid (exit 4), never a vacuous clear plan
pnpm worker:release-decision-action-plan --trend=docs/examples/release-decision-action-plan/not-a-trend.json --json

# --strict escalates any non-clear trend to block-release (exit 4)
pnpm worker:release-decision-action-plan --trend=docs/examples/release-decision-action-plan/trend-watch.json --strict --json

# Cap the checklist to the highest-priority actions (the count dropped is surfaced)
pnpm worker:release-decision-action-plan --trend=docs/examples/release-decision-action-plan/trend-blocked.json --max-actions=2 --text

# Read the trend document from stdin
cat trend.json | pnpm worker:release-decision-action-plan --stdin --text
```

## Policy knobs

| Flag | Effect |
| --- | --- |
| `--max-actions=N` | cap the number of emitted action items (default `8`, hard max `20`); the highest-priority N are kept and the count dropped is surfaced, never silent |
| `--strict` | escalate any non-clear plan (monitor / investigate) to `block-release` — a hard "all-clear or block" gate; never fabricates approval for a clear trend |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | **clear** — a clear plan (clean stable trend) or a benign monitor plan (an improving trend) |
| `1` | **usage** — the CLI was misused (a bad flag, no trend supplied, or an unwritable output) |
| `2` | **investigate** — an investigate plan (an insufficient, inconclusive trend) |
| `3` | **followup** — a monitor plan requiring follow-up (a watch / degrading trend) |
| `4` | **block** — a block-release plan (a blocked / invalid trend, or a `--strict` escalation) or an invalid plan (an untrustworthy trend input) |

See `docs/examples/deployment/github-actions/release-decision-action-plan-fixture.yml` for the full scheduled CI job
that summarizes a decision trend, translates it into an action plan, renders it into `$GITHUB_STEP_SUMMARY`, and fails
closed.

## Not a legal audit trail

This plan is a **content-free operational follow-up plan**, not a system of record. It is **not** a legal / compliance
sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an
incident record, or an audit log — keep each of those in its own dedicated system. The plan proves neither authorship
nor approval; its re-derivation is **tamper-evidence over content-free data**, not a cryptographic signature (there is
no signing key and no attested identity), and a fully self-consistent fabricated trend is out of its scope.
