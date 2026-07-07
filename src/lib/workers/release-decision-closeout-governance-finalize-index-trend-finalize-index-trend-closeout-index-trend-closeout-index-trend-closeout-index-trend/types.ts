/**
 * The bounded, content-free vocabulary for the secure-worker **release decision closeout governance finalize index trend
 * finalize index trend closeout INDEX TREND** (Phase 96).
 *
 * Phase 95 built the closeout governance FINALIZE INDEX TREND FINALIZE INDEX TREND CLOSEOUT INDEX
 * (`pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index/1`) — which folds
 * a bounded BATCH of Phase 94 closeout records into ONE index verdict + closeout-verdict distribution for a single review
 * window (a sprint / quarter of finalization-index-trend follow-up-loop closeouts).
 *
 * This phase closes the *governance review* loop over a BOUNDED HISTORY of those closeout-index windows. It INGESTS one or
 * more `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index/1` documents
 * (a quarter / year of weekly, monthly, or quarterly closeout-index summaries), RE-VALIDATES each against ITSELF
 * (re-deriving its Phase 95 index verdict from its own recorded coverage + distribution + policy AND re-checking those
 * counts against the window's own per-record sequence, so a hand-flipped index is caught as a tamper), and folds them into
 * ONE stable, content-free
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/1` summary
 * that answers a single question a periodic release-governance review needs —
 *
 *    "Across the recent history of release-decision closeout-index windows on this host, is the closeout-index posture
 *     IMPROVING, STABLE, WATCH-worthy, DEGRADING, INSUFFICIENT (a coverage gap), BLOCKED, or INVALID (untrustworthy), and
 *     what bounded operator follow-up is warranted?"
 *
 * — with a bounded trend verdict + direction + class, a per-window index-verdict distribution, an aggregate closeout
 * distribution, a per-window posture sequence, a bounded rationale, and a bounded next-action list, and it FAILS CLOSED
 * when a window cannot be trusted or the history is inconclusive.
 *
 * Like the Phase 95 index it summarizes, it is LATEST-FOCUSED: the NEWEST usable window's own index verdict is the primary
 * driver, and the ORDERED arc (oldest first, newest last) refines the directional band (improving vs stable, degrading vs
 * watch). Bounded history thresholds (`--max-open` / `--max-incomplete` / `--max-blocked`, each defaulting to 0) let an
 * operator tolerate a bounded number of non-`all-closed` windows in the history before the accumulation escalates the trend.
 * Direction is derived from ORDERED INPUT POSITIONS, never from any ingested timestamp.
 *
 * It obeys the same honesty contract as the rest of the worker layer and is as content-free as the windows it summarizes:
 *  - Every load-bearing token here is a bounded enum — a window state, an index verdict, a closeout verdict, a trend
 *    verdict, a direction, a trend class, a severity, a reason id, a next-action id — never a filename, path, object key,
 *    bucket, URL, endpoint, region, id, token, size, byte, raw ref, raw label, raw note, reviewer identity, commit URL, or
 *    digest. The only non-enum values are small integer counts, an ISO stamp, and app-authored prose.
 *  - It never copies a free-text field out of an ingested window (each — even one Phase 95 produced — is UNTRUSTED input
 *    here); it reduces every window to bounded enums, small integers, or booleans, it never echoes an ingested window's
 *    OWN stamp (the trend carries only its own), and it never echoes an input file path, even on an error.
 *  - It never fabricates a clean pass. `stable` REQUIRES a coherent bounded history: every usable window an `all-closed`
 *    index, no tampered / unreadable window, and the watch / incomplete / blocked counts within their thresholds. A
 *    tampered / unreadable window makes the trend `invalid`; an `blocked` / `invalid` usable window over the
 *    threshold (or a blocked / invalid latest, or a `--strict-open` escalation) makes it `blocked`; zero usable windows,
 *    an `incomplete` latest, or an incomplete-threshold breach makes it `insufficient`; an `open` latest or a
 *    open-threshold breach makes it `watch`; a degrading arc makes it `degrading`; an older open under a clean latest with
 *    a recovering arc makes it `improving`.
 *
 * It is deliberately NOT a new evidence rung, NOT a legal audit trail, NOT a compliance attestation, NOT an external
 * signature, NOT an identity ledger, NOT storage-retention ENFORCEMENT, and NOT a deployment / promotion ledger. It PROVES
 * nothing the windows do not already prove; it SUMMARIZES a bounded history of their content-free index verdicts + closeout
 * distributions, RE-VALIDATES each one's self-consistency, and rolls them up into one trend verdict + follow-up list. Its
 * authored caveats (see {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CAVEATS})
 * say so out loud.
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index/types";

/** The schema tag every closeout-index-trend result carries, so tooling can pin the shape it parses. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_SCHEMA =
  "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/1" as const;

/** The upstream document schema the trend ingests. Re-exported so the result can pin its input shape. */
export { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_SCHEMA };

/** The upstream index / closeout verdicts the trend tallies + surfaces per window, re-exported for convenience. */
export {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_VERDICTS,
};
export type {
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict,
};

/** Stable identity of the release-decision-…-closeout-index-trend — for docs / receipts / audit. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_POLICY_ID =
  "pdfxyz-worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend";
/** Bump when the trend surface, the verdict ladder, the reason / next-action / class sets, or the schema changes. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_POLICY_VERSION = 1;

/** The default window cap: the newest N windows considered when `--max-indexes` is not given. */
export const DEFAULT_MAX_INDEXES = 26;
/** The hard maximum window cap. A `--max-indexes` above this is a usage error (an unbounded history is not a summary). */
export const MAX_INDEXES = 200;

/**
 * The bounded coverage state of one ingested closeout-index window — every supplied `--index` / `--file` / stdin element is
 * SUPPLIED, so a window is one of:
 *  - `unreadable` — an element was supplied but could not be read / parsed / recognized as a
 *                   `…-closeout-index/1` (never echoed). It certifies nothing → an untrustworthy INPUT (INVALID), never a
 *                   vacuous pass;
 *  - `tampered`   — recognized as a closeout index but its recorded index verdict does NOT re-derive from its own recorded
 *                   coverage + distribution + policy, or those counts disagree with the window's own per-record sequence (a
 *                   hand-edited / corrupt window) → an untrustworthy INPUT (INVALID);
 *  - `usable`     — recognized AND self-consistent (its recorded index verdict re-derives, and its counts match its
 *                   sequence): trustworthy.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_WINDOW_STATES = [
  "unreadable",
  "tampered",
  "usable",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendWindowState =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_WINDOW_STATES)[number];

/**
 * The single trend verdict a governance review keys on — the answer to "across the recent closeout-index windows, how is
 * the closeout-index posture, and is follow-up warranted?":
 *  - `improving`    — a healthy history whose ARC recovered: the latest usable window is `all-closed`, and an earlier window
 *                     was worse (a recovering arc). A clean code `0`, distinguished from `stable` by the improvement;
 *  - `stable`       — a COHERENT bounded history: every usable window is an `all-closed` index, with no tampered / unreadable
 *                     window and the watch / incomplete / blocked counts within their thresholds. The recent closeout
 *                     indexes read as consistently closed. It authorizes NOTHING;
 *  - `watch`        — an ADVISORY history: the latest usable window is `all-closed`, but the `open` count exceeds
 *                     `--max-open` (a residual open posture under a clean latest). Not a hard block — track it;
 *  - `degrading`    — a WORSENING history: the latest usable window is `open`, or the arc DEGRADED (the newest usable
 *                     window is worse than the oldest). The recent closeout indexing is not consistently closed;
 *  - `insufficient` — a COVERAGE GAP: zero usable windows were considered, the latest usable window is `incomplete`,
 *                     or the `incomplete` count exceeds `--max-incomplete`. Fail-closed, never a vacuous `stable`;
 *  - `blocked`      — a BLOCKING history: a usable window's own verdict is `blocked` / `invalid` (its closeout
 *                     history was blocked / untrustworthy) over `--max-blocked` or as the latest, or `--strict-open`
 *                     escalated a watch / degrading trend. Do NOT treat the recent closeouts as consistently closed;
 *  - `invalid`      — an UNTRUSTWORTHY INPUT (the TOP precedence): a considered window was tampered or unreadable (its
 *                     recorded index verdict does not re-derive, or it is not a recognized closeout index). A trend over it
 *                     cannot be trusted.
 *
 * These are the exact bounded values the run-level
 * `worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_closeout_index_trend_closeout_index_trend_closeout_index_trend_total`
 * metric carries as its `verdict` label; all seven are low-cardinality, redaction-stable tokens.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_VERDICTS = [
  "improving",
  "stable",
  "watch",
  "degrading",
  "insufficient",
  "blocked",
  "invalid",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_VERDICTS)[number];

/**
 * The exit-code ladder a CI / governance job routes on — the same shape / spirit as the whole release-decision suite:
 *  - `0` CLEAN        — a coherent, healthy history (`stable` or `improving`);
 *  - `1` USAGE        — the CLI was misused (a bad flag, no window supplied, or an unwritable output). CLI-owned; a trend
 *                       RUN never resolves to it;
 *  - `2` INSUFFICIENT — a coverage gap (zero usable windows, an incomplete latest, an incomplete-threshold breach);
 *  - `3` WATCH        — an advisory / worsening history (`watch` or `degrading`);
 *  - `4` BLOCKED      — a blocking / untrustworthy history (`blocked` or `invalid`).
 *
 * Monotonic in badness; `insufficient` (2) sorts before the watch / degrading band (3) exactly like the rest of the suite
 * folds a coverage gap before an advisory posture.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_EXIT = {
  CLEAN: 0,
  USAGE: 1,
  INSUFFICIENT: 2,
  WATCH: 3,
  BLOCKED: 4,
} as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendExitCode =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_EXIT)[keyof typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_EXIT];

/** The authoritative verdict → exit code map. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_EXIT_FOR_VERDICT: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendExitCode
> = {
  improving: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_EXIT.CLEAN,
  stable: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_EXIT.CLEAN,
  watch: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_EXIT.WATCH,
  degrading: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_EXIT.WATCH,
  insufficient:
    RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_EXIT.INSUFFICIENT,
  blocked: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_EXIT.BLOCKED,
  invalid: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_EXIT.BLOCKED,
};

/**
 * The common **severity** each fired trend reason maps onto, with precedence
 * `invalid > blocking > insufficient > advisory > informational` (checked in that order — higher is worse). The verdict is
 * resolved from the fired reason SET refined by the arc direction (advisory splits into `degrading` / `watch`,
 * informational into `improving` / `stable`), not purely by the worst severity — but the exit code follows the worst fired
 * band:
 *  - `informational` — a benign trend marker (the latest window `all-closed` / an improving arc / a fully-coherent history);
 *  - `advisory`      — an advisory / worsening posture (an open latest / a open-threshold breach / a degrading arc);
 *  - `insufficient`  — a coverage gap (zero usable windows, an incomplete latest, an incomplete-threshold breach);
 *  - `blocking`      — a blocked / untrustworthy usable window (`blocked` / `invalid`) over threshold / as
 *                      latest, or a `--strict-open` escalation;
 *  - `invalid`       — an untrustworthy INPUT (a tampered or unreadable window).
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_SEVERITIES = [
  "informational",
  "advisory",
  "insufficient",
  "blocking",
  "invalid",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendSeverity =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_SEVERITIES)[number];

/**
 * One usable window's own index verdict → the common trend severity it contributes. A window whose OWN verdict is
 * `blocked` / `invalid` (Phase 95 concluded its closeout history was blocked / untrustworthy) is a BLOCKING
 * trend outcome — "a closeout history could not be trusted" — NOT an untrustworthy TREND input (that is an `unreadable` /
 * `tampered` window state).
 */
export const WINDOW_VERDICT_SEVERITY: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendSeverity
> = {
  "all-closed": "informational",
  "open": "advisory",
  "incomplete": "insufficient",
  "blocked": "blocking",
  "invalid": "blocking",
};

/**
 * The rank of a usable window's index verdict for the DIRECTION arc (higher = worse). Monotonic over the whole Phase 95
 * index verdict ladder so the oldest→newest arc is well-ordered: `all-closed` (clean) is best; `invalid` (an
 * untrustworthy closeout history) is worst.
 */
export const WINDOW_VERDICT_RANK: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict,
  number
> = {
  "all-closed": 0,
  "incomplete": 1,
  "open": 2,
  "blocked": 3,
  "invalid": 4,
};

/**
 * The bounded **direction** of the recent trend — the arc from the OLDEST usable window to the NEWEST, by index verdict
 * rank over the whole ordered sequence:
 *  - `improving` — the newest usable window is cleaner than the oldest AND the arc is monotonically non-worsening;
 *  - `stable`    — every usable window has the same rank (unchanged);
 *  - `degrading` — the newest usable window is worse than the oldest AND the arc is monotonically non-improving;
 *  - `mixed`     — the arc is non-monotonic (it both improved and worsened across the window);
 *  - `unknown`   — fewer than two usable windows, so there is no arc.
 *
 * A bounded facet for the summary; the verdict logic consults it (a degrading arc drives `degrading`, an improving arc an
 * `improving`). Derived from ORDERED INPUT POSITIONS, never from any ingested timestamp.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_DIRECTIONS = [
  "improving",
  "stable",
  "degrading",
  "mixed",
  "unknown",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendDirection =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_DIRECTIONS)[number];

/**
 * The bounded **trend class** — the single coarse classification of the history, by worst-present + arc (a
 * strict-INDEPENDENT, threshold-INDEPENDENT description, so a `--strict-open` run can be `blocked` while still classing the
 * history as `watch`), in this severity order:
 *  - `invalid`      — a tampered / unreadable window is present (an untrustworthy input);
 *  - `blocked`      — a usable window's own verdict is `blocked` / `invalid`;
 *  - `no-usable`    — the history has zero usable windows (nothing to summarize);
 *  - `insufficient` — the latest usable window is `incomplete`, or every usable window is `incomplete`;
 *  - `regressing`   — the latest usable window is `open`, or the arc degraded;
 *  - `watch`        — an older `open` / `incomplete` window is present under a clean, non-degrading latest;
 *  - `recovering`   — the latest usable window is `all-closed`, an arc improved, with no residual open / incomplete window;
 *  - `clean`        — every usable window is `all-closed` (a fully-coherent history).
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLASSES = [
  "clean",
  "recovering",
  "watch",
  "regressing",
  "insufficient",
  "no-usable",
  "blocked",
  "invalid",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendClass =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLASSES)[number];

/**
 * The bounded reason ids — the closed set of REASONS the trend verdict resolved as it did, emitted in this stable order (a
 * superset view, so a reviewer sees every condition that applied, not only the winning one). The per-id severity is authored
 * in {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_REASON_DETAIL}:
 *
 * Invalid input (the trend cannot be trusted):
 *  - `index-unreadable`             — a considered window could not be read / recognized as a closeout index;
 *  - `index-tampered`               — a considered window is recognized but its recorded index verdict does NOT re-derive.
 *
 * Blocking (do NOT treat the closeouts as consistently closed):
 *  - `latest-blocked`               — the latest usable window's own verdict is `blocked` / `invalid`;
 *  - `blocked-threshold-exceeded`   — the `blocked` + `invalid` window count exceeds `--max-blocked`;
 *  - `strict-open-escalation`      — `--strict-open` escalated an otherwise watch / degrading trend to a hard block.
 *
 * Insufficient (a coverage gap):
 *  - `no-indexes`                   — the history has zero usable windows (nothing to summarize);
 *  - `latest-incomplete`            — the latest usable window's own verdict is `incomplete`;
 *  - `incomplete-threshold-exceeded`— the `incomplete` window count exceeds `--max-incomplete`.
 *
 * Advisory (an advisory / worsening posture):
 *  - `latest-open`                  — the latest usable window's own verdict is `open`;
 *  - `open-threshold-exceeded`     — the `open` window count exceeds `--max-open`;
 *  - `trend-degrading`              — the newest usable window is worse than the oldest usable window (a degrading arc);
 *  - `require-latest-miss`          — `--require-latest-all-closed` was set and the latest usable window is NOT `all-closed`.
 *
 * Informational (a benign trend marker):
 *  - `latest-all-closed`               — the latest usable window's own verdict is `all-closed`;
 *  - `trend-improving`              — the newest usable window is cleaner than the oldest (a recovering arc);
 *  - `history-coherent`             — every considered window is a usable `all-closed` (a fully-clean history marker).
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_REASON_IDS = [
  // Invalid input
  "index-unreadable",
  "index-tampered",
  // Blocking
  "latest-blocked",
  "blocked-threshold-exceeded",
  "strict-open-escalation",
  // Insufficient
  "no-indexes",
  "latest-incomplete",
  "incomplete-threshold-exceeded",
  // Advisory
  "latest-open",
  "open-threshold-exceeded",
  "trend-degrading",
  "require-latest-miss",
  // Informational
  "latest-all-closed",
  "trend-improving",
  "history-coherent",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendReasonId =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_REASON_IDS)[number];

/**
 * The bounded next-action ids — the closed set of concrete operator steps the trend can recommend, in this canonical order
 * (the list is emitted in this order, deduped):
 *  - `recover-tampered-indexes`        — recover the tampered closeout-index window(s) from your CI archive;
 *  - `recover-unreadable-indexes`      — recover the unreadable closeout-index window(s); an untrustworthy input;
 *  - `review-blocked-indexes`          — a window is `blocked` / `invalid`; reconcile before treating closed;
 *  - `review-strict-open`             — `--strict-open` flagged a watch / degrading trend; review it, or drop the flag;
 *  - `review-degrading-trend`          — the arc is worsening / the latest is open; investigate what changed;
 *  - `review-watch-indexes`            — an open posture is present past the threshold; track the follow-up first;
 *  - `complete-incomplete-indexes`     — a window is `incomplete`; complete its evidence and re-index;
 *  - `supply-closeout-indexes`         — supply more / readable closeout-index windows and re-run;
 *  - `note-improving-trend`            — the arc recovered to a clean latest window; confirm the improvement is sustained;
 *  - `continue-indexing-closeouts`     — the history is coherent; keep indexing closeouts on your cadence;
 *  - `keep-closeout-index-trend`       — keep this content-free trend as the local governance review SUMMARY (always).
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_NEXT_ACTION_IDS = [
  "recover-tampered-indexes",
  "recover-unreadable-indexes",
  "review-blocked-indexes",
  "review-strict-open",
  "review-degrading-trend",
  "review-watch-indexes",
  "complete-incomplete-indexes",
  "supply-closeout-indexes",
  "note-improving-trend",
  "continue-indexing-closeouts",
  "keep-closeout-index-trend",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendNextActionId =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_NEXT_ACTION_IDS)[number];

/* ------------------------------------------------------------------ *
 *  Per-window bounded facts + the reduced trend point
 * ------------------------------------------------------------------ */

/**
 * The bounded facts reduced from a usable `…-closeout-index/1` (its verdict re-derived in ingest). Every field here
 * re-derives from the window's own recorded coverage + distribution + policy, so there is nothing un-revalidated for a
 * locator to hide in.
 */
export interface CloseoutIndexFacts {
  /** The window's final index verdict (trusted — the window re-derived its own verdict + counts). */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict;
  /** The window's own exit code (context; the trend has its own). */
  readonly exitCode: number;
  /** True iff `verdict === "all-closed"`. */
  readonly allClosed: boolean;
  /** How many closeout records the window considered (after its own window cap). */
  readonly closeoutsConsidered: number;
  /** How many of those closeout records were usable in the window. */
  readonly closeoutsUsable: number;
  /** The window's closeout-verdict distribution over its usable records (all five keys present). */
  readonly closeoutVerdictCounts: Readonly<
    Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict, number>
  >;
  /** The window's own latest (newest) usable closeout verdict, or `null` (context). */
  readonly latestCloseout: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict | null;
  /** True iff the window was produced under `--strict-open` (context; never re-judged by the trend). */
  readonly strictOpen: boolean;
}

/**
 * One reduced window in the trend sequence — a bounded point ordered oldest → newest. Every field is a bounded enum, a
 * small integer, or app-authored prose; never a raw value from the input (not even the window's stamp).
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendPoint {
  /** 0-based position in the considered history, oldest = 0 (never the input's own stamp). */
  readonly position: number;
  /** The window's coverage state. */
  readonly state: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendWindowState;
  /**
   * The window's own index verdict (a bounded enum), or `null` when unreadable. Trusted only when `usable`; for a
   * `tampered` window it is the untrusted CLAIMED verdict (surfaced so the sequence shows what was asserted).
   */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict | null;
  /** The window's own latest (newest) usable closeout verdict, or `null` when not usable (context). */
  readonly latestCloseout: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict | null;
  /** The window's contribution on the common severity ladder, or `null` when not usable. */
  readonly severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendSeverity | null;
  /** How many closeout records the window considered (a bounded count; `0` when not usable). */
  readonly closeoutsConsidered: number;
  /** A one-line, content-free headline authored from the position + state + verdict. */
  readonly detail: string;
}

/* ------------------------------------------------------------------ *
 *  The internal history summary (build maps it to the result blocks)
 * ------------------------------------------------------------------ */

/**
 * The bounded history summary — how many windows were supplied / usable, the per-window index-verdict distribution, the
 * aggregate closeout distribution, the newest usable window summary, and the arc direction + trend class. Every count is
 * over the USABLE considered windows (an unreadable / tampered window contributes no trusted verdict), so the summary never
 * fabricates a posture. `build` maps this to the result's `coverage` / `windowDistribution` / `closeoutDistribution` /
 * `latest` / `trend` blocks.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendSummary {
  /** How many window inputs were supplied (before any cap). */
  readonly indexesSupplied: number;
  /** How many windows were considered after the `--max-indexes` window cap (the newest N). */
  readonly indexesConsidered: number;
  /** True iff `--max-indexes` dropped older windows from the history. */
  readonly truncated: boolean;
  /** How many older windows were dropped by the window cap (`indexesSupplied − indexesConsidered`). */
  readonly droppedOldest: number;
  /** How many considered windows are usable (recognized + self-consistent). */
  readonly indexesUsable: number;
  /** How many considered windows were unreadable (not recognized as a closeout index). */
  readonly indexesUnreadable: number;
  /** How many considered windows were tampered (recognized but self-inconsistent). */
  readonly indexesTampered: number;
  /** The count of each index verdict across the usable considered windows (all five keys present). */
  readonly indexVerdictCounts: Readonly<
    Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict, number>
  >;
  /** The newest usable window's index verdict, or `null` if none is usable (a coarse ordinal, never a timestamp). */
  readonly newest: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict | null;
  /** The oldest usable window's index verdict, or `null` if none is usable (a coarse ordinal, never a timestamp). */
  readonly oldest: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict | null;
  /** The total closeout records considered across the usable windows (a bounded sum). */
  readonly totalCloseouts: number;
  /** The total usable closeout records across the usable windows (a bounded sum). */
  readonly totalUsableCloseouts: number;
  /** The aggregate closeout distribution across the usable windows (all five keys present). */
  readonly closeoutVerdictCounts: Readonly<
    Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict, number>
  >;
  /** The bounded summary of the newest usable window, or `null` if none is usable. */
  readonly latest: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendLatest | null;
  /** The bounded arc from oldest usable to newest usable, by index verdict rank. */
  readonly direction: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendDirection;
  /** The single coarse classification of the history. */
  readonly trendClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendClass;
}

/* ------------------------------------------------------------------ *
 *  The result's bounded blocks (the spec's top-level fields)
 * ------------------------------------------------------------------ */

/** The bounded coverage block — how many windows were supplied / considered / usable / unreadable / tampered / dropped. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCoverage {
  readonly indexesSupplied: number;
  readonly indexesConsidered: number;
  readonly indexesUsable: number;
  readonly indexesUnreadable: number;
  readonly indexesTampered: number;
  readonly truncated: boolean;
  readonly droppedOldest: number;
}

/** The bounded per-window index-verdict distribution over the usable windows (all five keys present) + newest / oldest. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendWindowDistribution {
  readonly verdictCounts: Readonly<
    Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict, number>
  >;
  readonly newest: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict | null;
  readonly oldest: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict | null;
}

/** The bounded aggregate closeout distribution across the usable windows (all five keys present) + bounded totals. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutDistribution {
  readonly verdictCounts: Readonly<
    Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict, number>
  >;
  /** The total closeout records considered across the usable windows. */
  readonly totalConsidered: number;
  /** The total usable closeout records across the usable windows. */
  readonly totalUsable: number;
}

/** The bounded summary of the newest usable window — no timestamps / stamps, only bounded enums + small integers. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendLatest {
  /** The newest usable window's index verdict. */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict;
  /** True iff that verdict is `all-closed`. */
  readonly allClosed: boolean;
  /** How many closeout records that window considered. */
  readonly closeoutsConsidered: number;
  /** How many of those records were usable in that window. */
  readonly closeoutsUsable: number;
  /** That window's own latest (newest) usable closeout verdict, or `null`. */
  readonly latestCloseout: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict | null;
  /** True iff that window was produced under `--strict-open` (context). */
  readonly strictOpen: boolean;
}

/** The bounded `trend` block — the arc direction + coarse class only (the verdict / exit are top-level). */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendArc {
  readonly direction: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendDirection;
  readonly class: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendClass;
}

/** The bounded, applied policy knobs (from the validated args). */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendPolicy {
  /** The maximum number of newest windows considered (the window cap). */
  readonly maxIndexes: number;
  /** The maximum tolerated `open` windows in the history before the watch threshold fires (default 0). */
  readonly maxOpen: number;
  /** The maximum tolerated `incomplete` windows before the incomplete threshold fires (default 0). */
  readonly maxIncomplete: number;
  /** The maximum tolerated `blocked` + `invalid` windows before the blocked threshold fires (default 0). */
  readonly maxBlocked: number;
  /** True iff `--strict-open` was set (a watch / degrading trend escalates to `blocked`). */
  readonly strictOpen: boolean;
  /** True iff `--require-latest-all-closed` was set (a non-all-closed latest cannot be `stable` / `improving`). */
  readonly requireLatestAllClosed: boolean;
}

/** One fired reason, with its resolved severity + authored detail. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendReason {
  readonly id: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendReasonId;
  readonly severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendSeverity;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** One next-action step, with its authored detail. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendNextAction {
  readonly id: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendNextActionId;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/**
 * The composite trend decision — the internal rollup the fold produces. `build` surfaces `verdict` / `exitCode` at the top
 * level and the `direction` / `class` under `trend`; the strict flags are surfaced via reasons + prose.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendRollup {
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict;
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendExitCode;
  /** True iff `verdict === "stable"` or `verdict === "improving"` (a coherent, healthy history). */
  readonly clean: boolean;
  /** The latest (newest) usable window's own index verdict, or `null` if none is usable. */
  readonly latest: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict | null;
  /** The fired reason ids, in canonical order. */
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendReasonId[];
  /** How many fired reasons were invalid-input. */
  readonly invalidInputs: number;
  /** How many fired reasons were blocking. */
  readonly blocking: number;
  /** How many fired reasons were insufficient. */
  readonly insufficiencies: number;
  /** How many fired reasons were advisory. */
  readonly advisories: number;
  /** How many fired reasons were informational. */
  readonly informational: number;
  /** The reported arc direction (context; the verdict already folded it). */
  readonly direction: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendDirection;
  /** The single coarse classification of the history. */
  readonly trendClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendClass;
  /** True iff `--strict-open` was applied. */
  readonly strictOpen: boolean;
  /** True iff `--strict-open` ESCALATED a watch / degrading / insufficient trend to `blocked`. */
  readonly strictOpenEscalated: boolean;
  /** Which verdict `--strict-open` escalated FROM, or `null` when no escalation applied. */
  readonly strictOpenEscalatedFrom: "watch" | "degrading" | "insufficient" | null;
  /** True iff `--require-latest-all-closed` was applied. */
  readonly requireLatestAllClosed: boolean;
  readonly detail: string;
}

/** The stable identity block the result records (with the pinned upstream closeout-index schema). */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_POLICY_VERSION;
  readonly closeoutIndexSchema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_SCHEMA;
}

/**
 * The stable, content-free release decision closeout-index trend a governance review / CI reads. Every field is a bounded
 * enum, a small integer, an ISO stamp, or app-authored prose — so it carries no reviewer identity, locator, size, path, or
 * byte, even from a hostile input, and never echoes an ingested window's own stamp.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendResult {
  readonly schema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendMetadata;
  readonly policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendPolicy;
  /** The composite trend verdict a governance review acts on. */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict;
  /** The process exit code (mirrors {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_EXIT_FOR_VERDICT}). */
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendExitCode;
  /** The bounded coverage summary. */
  readonly coverage: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCoverage;
  /** The bounded per-window index-verdict distribution over the usable windows. */
  readonly windowDistribution: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendWindowDistribution;
  /** The bounded aggregate closeout distribution across the usable windows. */
  readonly closeoutDistribution: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutDistribution;
  /** The bounded summary of the newest usable window, or `null` if none is usable. */
  readonly latest: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendLatest | null;
  /** One reduced point per considered window, ordered oldest → newest. */
  readonly points: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendPoint[];
  /** The bounded arc direction + coarse class. */
  readonly trend: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendArc;
  /** Every fired reason, in canonical {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_REASON_IDS} order. */
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendReason[];
  /** The bounded, ordered next-action list. Never derived from an input. */
  readonly nextActions: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendNextAction[];
  /** Bounded, app-authored guidance (out-of-scope steps this trend does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from any ingested window. */
  readonly caveats: readonly string[];
  /** The flattened, content-free receipt (safe to log / forward verbatim). */
  readonly receipt: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendReceipt;
}

/**
 * The content-free **audit receipt** the result rides alongside its body — the flattened answer to "what did this trend
 * conclude, over how many usable windows, in what distribution, with what latest" for a SIEM / review record. Bounded enums
 * + small integers + a stable policy id + the run's own stamp + a disclosure statement only; safe to log or forward
 * verbatim.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendReceipt {
  readonly category: "worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend";
  readonly policyId: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_POLICY_VERSION;
  readonly at: string;
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict;
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendExitCode;
  /** How many window inputs were supplied. */
  readonly indexesSupplied: number;
  /** How many windows were considered after the window cap. */
  readonly indexesConsidered: number;
  /** How many considered windows are usable. */
  readonly indexesUsable: number;
  /** The count of each index verdict across the usable considered windows (all five keys present). */
  readonly indexVerdictCounts: Readonly<
    Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict, number>
  >;
  /** The latest (newest) usable window's own index verdict, or `null` if none is usable. */
  readonly latest: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict | null;
  /** The bounded arc direction. */
  readonly direction: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendDirection;
  /** The single coarse classification of the history. */
  readonly trendClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendClass;
  /** The bounded, app-authored disclosure statement (what this trend is NOT). Never derived from an input. */
  readonly disclosure: string;
}

/** The process exit code for a trend result. */
export function releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendExitCode(
  result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendResult,
): number {
  return result.exitCode;
}

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from any ingested window)
 * ------------------------------------------------------------------ */

/** The one-line verdict headline. Authored here, keyed by the enum. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_VERDICT_SUMMARY: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict,
  string
> = {
  improving:
    "IMPROVING: the recent closeout-index history recovered — the latest usable window is an INDEXED index and an earlier window was worse (a recovering arc). Confirm the improvement is sustained across the next windows. This trend authorizes nothing on its own.",
  stable:
    "STABLE: the recent closeout-index history is healthy — every usable window is an INDEXED index, with no tampered / unreadable window and the watch / incomplete / blocked counts within their thresholds. Keep indexing closeouts per window and summarizing them on your governance cadence. This trend authorizes nothing on its own.",
  watch:
    "WATCH: an ADVISORY history — the latest usable window is INDEXED, but the open-window count exceeds the threshold (a residual open posture under a clean latest). Track the earlier follow-up(s); this is not a hard block, but the history is not uniformly clean either.",
  degrading:
    "DEGRADING: a WORSENING history — the latest usable window is INDEX-OPEN, or the arc DEGRADED (the newest window is worse than the oldest). Track the open follow-up(s) and investigate what changed; the recent closeout indexing is not consistently closed.",
  insufficient:
    "INSUFFICIENT: the closeout-index history has a COVERAGE GAP — zero usable windows were considered, the latest usable window is INDEX-INCOMPLETE, or the incomplete-window count exceeds the threshold. Complete the missing evidence or supply a readable history, then re-summarize; this is not a coherent history.",
  blocked:
    "BLOCKED: a BLOCKING history — a usable window's own verdict is INDEX-BLOCKED / INDEX-INVALID (its closeout history was blocked / untrustworthy) over the threshold or as the latest, or `--strict-open` escalated a watch / degrading trend. Do NOT treat the recent closeouts as consistently closed until the cause is resolved.",
  invalid:
    "INVALID: an UNTRUSTWORTHY INPUT — a considered window is tampered (its recorded index verdict does not re-derive) or unreadable (not a recognized closeout index). A trend over an untrustworthy window cannot be trusted; recover the untampered / readable window(s) and re-run.",
};

/**
 * The dedicated headline for a `blocked` trend produced ONLY because `--strict-open` escalated a watch / degrading trend —
 * there was no blocked / invalid usable window over threshold, no blocked / invalid latest, and no tampered / unreadable
 * input, so the generic headline would misrepresent the cause. Authored.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_STRICT_OPEN_ESCALATED_SUMMARY =
  "BLOCKED (--strict-open): the only concern is a WATCH / DEGRADING trend (an open latest, a open-threshold breach, or a degrading arc), and `--strict-open` escalates any watch / degrading trend to a hard block — a `consistently closed or blocked` gate for a high-assurance review. Without the flag this would be a watch / degrading trend. No blocked / invalid usable window over threshold, no blocked / invalid latest, and no tampered / unreadable input was found.";

/** Per-reason authored detail + resolved severity, keyed by id. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_REASON_DETAIL: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendReasonId,
  {
    readonly severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendSeverity;
    readonly detail: string;
  }
> = {
  "index-unreadable": {
    severity: "invalid",
    detail:
      "A considered window could not be read / recognized as a `…-closeout-index/1` (wrong schema or unparseable — never echoed), so it contributes no trusted verdict and the input cannot be trusted. Recover a readable closeout index produced by `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index` and re-run.",
  },
  "index-tampered": {
    severity: "invalid",
    detail:
      "A considered window is a recognized `…-closeout-index/1` whose recorded index verdict does NOT re-derive from its own recorded coverage + distribution + policy, or whose counts disagree with its own per-record sequence — a hand-edited or corrupt window. Recover the untampered window from your CI archive; a tampered window cannot be summarized.",
  },
  "latest-blocked": {
    severity: "blocking",
    detail:
      "The latest (newest) usable window's OWN index verdict is `blocked` / `invalid` — its most recent closeout history was blocked or contained a tampered / unreadable record. The recent history is not consistently closed: reconcile the latest window's block / recover the untampered record and re-index it before relying on the history.",
  },
  "blocked-threshold-exceeded": {
    severity: "blocking",
    detail:
      "The number of `blocked` + `invalid` windows in the history exceeds `--max-blocked`. A recurring blocked / untrustworthy window is a governance regression, not noise: reconcile the blocked windows (or raise `--max-blocked` only if the blocked history is understood and accepted) before treating the history as closed.",
  },
  "strict-open-escalation": {
    severity: "blocking",
    detail:
      "`--strict-open` was set and the trend would otherwise be WATCH / DEGRADING (an open latest, a open-threshold breach, or a degrading arc), so the policy escalates it to a hard block — a `consistently closed or blocked` gate for a high-assurance review. Close the open follow-up(s) / resolve the regression (or drop `--strict-open` if a watch history is acceptable) before treating the history as closed.",
  },
  "no-indexes": {
    severity: "insufficient",
    detail:
      "The history has zero usable windows — every considered window was unreadable / tampered, or the history was empty. There is nothing to summarize; supply a bounded history of readable `…-closeout-index/1` windows and re-run.",
  },
  "latest-incomplete": {
    severity: "insufficient",
    detail:
      "The latest (newest) usable window's OWN index verdict is `incomplete` — its most recent closeout history had a coverage gap (an unreadable record, an incomplete latest, a require-latest miss, or zero usable records). Complete the missing evidence, re-index the latest window, and re-summarize before treating the history as closed.",
  },
  "incomplete-threshold-exceeded": {
    severity: "insufficient",
    detail:
      "The number of `incomplete` windows in the history exceeds `--max-incomplete`. A recurring incomplete window means recent review periods are not being fully evidenced: complete the missing evidence (or raise `--max-incomplete` if a bounded incomplete backlog is acceptable) before treating the history as consistently closed.",
  },
  "latest-open": {
    severity: "advisory",
    detail:
      "The latest (newest) usable window's OWN index verdict is `open` — an advisory follow-up remains open on the most recent closeout history. Track the follow-up to closure, re-index the latest window, and re-summarize; this is not a hard block, but the history is not consistently closed.",
  },
  "open-threshold-exceeded": {
    severity: "advisory",
    detail:
      "The number of `open` windows in the history exceeds `--max-open`. Recurring open postures mean the recent closeouts are not being closed out promptly: track the open follow-ups to closure (or raise `--max-open` if a bounded open backlog is acceptable) before treating the history as consistently closed.",
  },
  "trend-degrading": {
    severity: "advisory",
    detail:
      "The newest usable window's index verdict is WORSE than the oldest usable window's (a worse index posture after an earlier cleaner one) — the recent arc degraded. Investigate what changed between the recent windows before relying on the history.",
  },
  "require-latest-miss": {
    severity: "advisory",
    detail:
      "`--require-latest-all-closed` was set and the latest (newest) usable window's OWN index verdict is NOT `all-closed`. The policy requires the most recent review period to be fully all-closed: complete / reconcile the latest window and re-index (or drop `--require-latest-all-closed` if a non-all-closed latest is acceptable) before treating the history as closed.",
  },
  "latest-all-closed": {
    severity: "informational",
    detail:
      "The latest (newest) usable window's OWN index verdict is `all-closed` — the most recent closeout history read as consistently closed. This is the load-bearing marker for a `stable` / `improving` trend (provided the history is coherent within its thresholds and the arc is not degrading); it records a bounded review, not an approval or a promotion.",
  },
  "trend-improving": {
    severity: "informational",
    detail:
      "The newest usable window's index verdict is CLEANER than the oldest usable window's (a recovering arc) — the recent closeout-index postures improved. Note the improvement and confirm it is sustained across the next windows; this trend authorizes nothing on its own.",
  },
  "history-coherent": {
    severity: "informational",
    detail:
      "Every considered window is a usable `all-closed` index — the whole recent history reads as consistently closed, with no unreadable / tampered / open / incomplete / blocked / invalid window. Keep the underlying closeout indexes on your governance cadence.",
  },
};

/** Per-next-action authored detail, keyed by id. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_NEXT_ACTION_DETAIL: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendNextActionId,
  string
> = {
  "recover-tampered-indexes":
    "Recover the tampered closeout-index window(s) from your CI archive: a window whose recorded index verdict does not re-derive from its own recorded coverage + distribution, or whose counts disagree with its own sequence, means the trend input was hand-edited or corrupt and cannot be trusted.",
  "recover-unreadable-indexes":
    "Recover the unreadable closeout-index window(s): a window that cannot be read / recognized as a `…-closeout-index/1` is an untrustworthy input to the trend. Recover a valid closeout index produced by `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index` and re-run.",
  "review-blocked-indexes":
    "A window in the history is `blocked` / `invalid` (its closeout history was blocked, or contained a tampered / unreadable record): do NOT treat that review period as consistently closed. Reconcile the block / recover the untampered record and re-index that window before relying on the history.",
  "review-strict-open":
    "`--strict-open` flagged a watch / degrading trend (an open latest, a open-threshold breach, or a degrading arc): the policy requires the history to be consistently closed. Review the flagged window(s) and resolve the concern, or drop `--strict-open` if a watch history is acceptable for this review, before relying on the history.",
  "review-degrading-trend":
    "The recent arc is worsening (the newest window is worse than the earliest usable window), or the latest window is open: investigate what changed between the recent review periods and resolve the regression before relying on the history. Archive this trend as the record of that review.",
  "review-watch-indexes":
    "A window in the history is `open` past the `--max-open` threshold (an advisory follow-up still open): track the recorded follow-up to closure, re-index that window, and re-summarize before relying on the history. Archive this trend as the record of that review.",
  "complete-incomplete-indexes":
    "A window in the history is `incomplete` (a coverage gap in its closeout history): complete the missing evidence with `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout` / `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index`, re-index that window, and re-summarize.",
  "supply-closeout-indexes":
    "Supply more / readable content-free `…-closeout-index/1` windows (a bounded history, oldest first) and re-run this trend: an unreadable or empty history cannot be summarized.",
  "note-improving-trend":
    "The recent arc recovered to a clean latest window: note the improvement and confirm it is sustained across the next windows. Keep indexing closeouts and summarizing them here; this trend authorizes no promotion on its own.",
  "continue-indexing-closeouts":
    "The history is coherent: keep filing one `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index` window per review period and summarizing them here on your governance cadence. This trend authorizes no promotion on its own.",
  "keep-closeout-index-trend":
    "Keep this content-free trend as the local closeout-index governance review SUMMARY. It is NOT a legal audit log, a compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger; keep those separately.",
};

/** The bounded, app-authored disclosure statement the receipt + text render carry (what this trend is NOT). */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_DISCLOSURE =
  "This is a content-free closeout-index TREND SUMMARY ONLY — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It ingests a bounded history of previously produced closeout-index summaries and records whether the recent release decision closeout indexing trended consistently closed; it authorizes and proves nothing, and it attests no person's identity.";

/**
 * The honesty caveats every result carries and every text render prints. The trend SUMMARIZES a bounded history of the
 * chain's already content-free closeout-index windows, RE-VALIDATES each one's self-consistency, and rolls them up into one
 * trend verdict; it must never be read as more than that.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CAVEATS: readonly string[] = [
  "This is a RELEASE DECISION CLOSEOUT GOVERNANCE FINALIZE INDEX TREND FINALIZE INDEX TREND CLOSEOUT INDEX TREND SUMMARY: it INGESTS a bounded history of content-free `…-closeout-index/1` windows a release pipeline produced, RE-VALIDATES each against ITSELF, and folds them into ONE bounded trend verdict + follow-up list. It is a local content-free closeout-index TREND SUMMARY over closeout-index windows — NOT a legal audit log, a compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger.",
  "It is offline and READ-ONLY: it makes NO network call, reads NO secret, bucket, or object, RUNS no gate / index / decision / trend / plan / receipt / closeout / governance / finalize itself, and NEVER signs, approves, publishes, promotes, deploys, notifies, deletes, prunes, uploads, or mutates any window, record, artifact, object, or deployment. A `stable` / `improving` trend authorizes nothing; it only reports that the content-free closeout-index windows supplied on THIS host trended consistently closed over the review history.",
  "A `stable` / `improving` trend REQUIRES a coherent bounded history: every usable window an `all-closed` index, no tampered / unreadable window, and the watch / incomplete / blocked counts within their thresholds. It FAILS CLOSED: a tampered / unreadable window makes the trend `invalid` (the TOP precedence); an `blocked` / `invalid` usable window over `--max-blocked` (or as the latest), or a `--strict-open` escalation, makes it `blocked`; zero usable windows, an `incomplete` latest, or an `--max-incomplete` breach makes it `insufficient`; an `open` latest or a degrading arc makes it `degrading`; a `--max-open` breach under a clean latest makes it `watch`. It never fabricates a clean trend from thin or untrusted history.",
  "It re-derives each ingested window's index verdict from the window's OWN recorded coverage + distribution + policy (reusing the Phase 95 index reducer) AND re-checks those counts against the window's own per-record sequence + window arithmetic, and treats any disagreement as a TAMPER (`invalid`). This re-derivation is TAMPER-EVIDENCE over content-free data, NOT a cryptographic signature — there is no signing key and no attested identity, so the trend proves neither authorship nor approval, and a set of fully self-consistent fabricated windows is out of its scope.",
  "It emits only bounded enums, small counts, an ISO stamp, and app-authored prose — so it carries no reviewer name or email, no filename, path, object key, bucket, URL, endpoint, region, job / user id, IP, token, raw ref, raw label, raw note, commit URL, size, byte, or digest, even from a hostile input; it never echoes an ingested window's own stamp, and it never echoes an input file path, even on an error.",
  "It is not malware scanning, sanitization, authorization, cloud validation, or deletion proof of any request or object, and it deletes, uploads, promotes, approves, or mutates nothing.",
];

/**
 * Out-of-band reminders the trend carries but does NOT itself perform — the honest edges of an offline summarizer. Authored,
 * bounded, content-free; never derived from an input.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_GUIDANCE: readonly string[] = [
  "Wire this as a SCHEDULED or on-demand GOVERNANCE summary (per quarter / half-year), NOT a per-release gate: run `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index` per review window and archive each window, then hand a bounded history (oldest first, newest last) here and render `--text` into a review artifact / `$GITHUB_STEP_SUMMARY`. Fail the review on exit 4 (a blocked / untrustworthy history), surface exit 3 (a watch / degrading history) and exit 2 (an insufficient history) for review, and treat exit 0 (a coherent / improving history) as consistently closed — never as an authorization.",
  "Keep the history bounded and explicit: `--max-indexes=N` caps the newest N windows (older windows are dropped from the history, and the count dropped is surfaced, never silent); `--max-open=N` / `--max-incomplete=N` / `--max-blocked=N` (each default 0) tolerate a bounded number of non-`all-closed` windows before the accumulation escalates; `--strict-open` escalates any watch / degrading trend to a hard block; `--require-latest-all-closed` demands an `all-closed` latest window. Direction is derived from ORDERED INPUT POSITIONS (oldest first, newest last), never from any ingested timestamp.",
  "Archive this trend (and the underlying closeout-index windows) as CI artifacts: it is a content-free governance SUMMARY, not a substitute for the windows it summarizes, nor for your legal audit trail, compliance log, external approval / signing, storage retention, or release-promotion processes — keep each of those in its own dedicated system.",
  "Enforce promotion out of band: this trend SUMMARIZES a history of the content-free closeout-index windows supplied, but recording a legal audit trail, obtaining an external approval / signature, proving reviewer identity, and promoting a deployment are operator / CI / legal actions this offline summarizer never performs.",
];
