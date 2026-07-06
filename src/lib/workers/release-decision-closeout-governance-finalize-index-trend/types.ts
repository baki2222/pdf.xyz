/**
 * The bounded, content-free vocabulary for the secure-worker **release decision closeout governance finalize index
 * trend** (Phase 76).
 *
 * Phases 72–75 built the release decision closeout governance FINALIZE chain, culminating (Phase 75) in the closeout
 * governance FINALIZE INDEX (`pdfxyz.release-decision-closeout-governance-finalize-index/1`) — which folds a bounded
 * HISTORY of Phase 74 finalization bundles into ONE index verdict + finalization-verdict distribution for a single
 * review window (a sprint / quarter of finalization bundles).
 *
 * This phase closes the *finalization review* loop over a BOUNDED HISTORY of those finalize-index windows. It INGESTS
 * one or more `pdfxyz.release-decision-closeout-governance-finalize-index/1` documents (a quarter / year of weekly,
 * monthly, or quarterly finalize-index summaries), RE-VALIDATES each against ITSELF (re-deriving its Phase 75 index
 * verdict from its own recorded coverage + distribution + policy AND re-checking those counts against the window's own
 * per-record posture sequence, so a hand-flipped index is caught as a tamper), and folds them into ONE stable,
 * content-free `pdfxyz.release-decision-closeout-governance-finalize-index-trend/1` summary that answers a single
 * question a periodic release-governance review needs —
 *
 *    "Across the recent history of release-decision closeout governance finalize-index windows on this host, is the
 *     closeout-governance FINALIZATION posture IMPROVING, STABLE, WATCH-worthy, DEGRADING / open, INSUFFICIENT (a
 *     coverage gap), BLOCKED, or INVALID (untrustworthy), and what bounded operator follow-up is warranted?"
 *
 * — with a bounded trend verdict + direction + class, a per-window index-verdict distribution, an aggregate
 * finalization distribution, a per-window posture sequence, a bounded rationale, and a bounded next-action list, and it
 * FAILS CLOSED when a window cannot be trusted or the history is inconclusive.
 *
 * Like the Phase 75 index it summarizes, it is LATEST-FOCUSED: the NEWEST usable window's own index verdict is the
 * primary driver, and the ORDERED arc (oldest first, newest last) refines the directional band (improving vs stable,
 * degrading vs watch). Direction is derived from ORDERED INPUT POSITIONS, never from any ingested timestamp.
 *
 * It obeys the same honesty contract as the rest of the worker layer and is as content-free as the windows it
 * summarizes:
 *  - Every load-bearing token here is a bounded enum — a window state, an index verdict, a finalization verdict, a trend
 *    verdict, a direction, a trend class, a severity, a reason id, a next-action id — never a filename, path, object
 *    key, bucket, URL, endpoint, region, id, token, size, byte, raw ref, raw label, raw note, reviewer identity, commit
 *    URL, or digest. The only non-enum values are small integer counts, an ISO stamp, and app-authored prose.
 *  - It never copies a free-text field out of an ingested window (each — even one Phase 75 produced — is UNTRUSTED input
 *    here); it reduces every window to bounded enums, small integers, or booleans, it never echoes an ingested window's
 *    OWN stamp (the trend carries only its own), and it never echoes an input file path, even on an error.
 *  - It never fabricates a clean pass. `stable` REQUIRES a coherent bounded history: every usable window an `indexed`
 *    index, no tampered / unreadable window, and no blocked / invalid / open / incomplete window. A tampered / unreadable
 *    window makes the trend `invalid`; an `index-blocked` / `index-invalid` usable window (or a `--strict-open`
 *    escalation) makes it `blocked`; zero usable windows or an `index-incomplete` latest / only-incomplete history makes
 *    it `insufficient`; an `index-open` latest or a degrading arc makes it `degrading`; an older open / incomplete window
 *    under a clean latest makes it `watch` or (a recovering arc) `improving`.
 *
 * It is deliberately NOT a new evidence rung, NOT a legal audit trail, NOT a compliance attestation, NOT an external
 * signature, NOT an identity ledger, NOT storage-retention ENFORCEMENT, and NOT a deployment / promotion ledger. It
 * PROVES nothing the windows do not already prove; it SUMMARIZES a bounded history of their content-free index verdicts
 * + finalization distributions, RE-VALIDATES each one's self-consistency, and rolls them up into one trend verdict +
 * follow-up list. Its authored caveats (see {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_CAVEATS})
 * say so out loud.
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeVerdict,
} from "../release-decision-closeout-governance-finalize-index/types";

/** The schema tag every finalize-index-trend result carries, so tooling can pin the shape it parses. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_SCHEMA =
  "pdfxyz.release-decision-closeout-governance-finalize-index-trend/1" as const;

/** The upstream document schema the trend ingests. Re-exported so the result can pin its input shape. */
export { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_SCHEMA };

/** The upstream index / finalization verdicts the trend tallies + surfaces per window, re-exported for convenience. */
export {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICTS,
};
export type {
  ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict,
  ReleaseDecisionCloseoutGovernanceFinalizeVerdict,
};

/** Stable identity of the release-decision-closeout-governance-finalize-index-trend — for docs / receipts / audit. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_POLICY_ID =
  "pdfxyz-worker-release-decision-closeout-governance-finalize-index-trend";
/** Bump when the trend surface, the verdict ladder, the reason / next-action / class sets, or the schema changes. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_POLICY_VERSION = 1;

/** The default window cap: the newest N windows considered when `--max-windows` is not given. */
export const DEFAULT_MAX_WINDOWS = 26;
/** The hard maximum window cap. A `--max-windows` above this is a usage error (an unbounded history is not a summary). */
export const MAX_WINDOWS = 104;

/**
 * The bounded coverage state of one ingested finalize-index window — every supplied `--index` / `--file` / stdin element
 * is SUPPLIED, so a window is one of:
 *  - `unreadable` — an element was supplied but could not be read / parsed / recognized as a
 *                   `pdfxyz.release-decision-closeout-governance-finalize-index/1` (never echoed). It certifies nothing →
 *                   an untrustworthy INPUT (INVALID), never a vacuous pass;
 *  - `tampered`   — recognized as a finalize index but its recorded index verdict does NOT re-derive from its own
 *                   recorded coverage + distribution + policy, or those counts disagree with the window's own per-record
 *                   sequence (a hand-edited / corrupt window) → an untrustworthy INPUT (INVALID);
 *  - `usable`     — recognized AND self-consistent (its recorded index verdict re-derives, and its counts match its
 *                   sequence): trustworthy.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_WINDOW_STATES = [
  "unreadable",
  "tampered",
  "usable",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendWindowState =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_WINDOW_STATES)[number];

/**
 * The single trend verdict a governance review keys on — the answer to "across the recent finalize-index windows, how is
 * the finalization posture, and is follow-up warranted?":
 *  - `improving`    — a healthy history whose ARC recovered: the latest usable window is `indexed`, and an earlier window
 *                     was worse (a recovering arc). A clean code `0`, distinguished from `stable` by the improvement;
 *  - `stable`       — a COHERENT bounded history: every usable window is an `indexed` index, with no tampered /
 *                     unreadable / open / incomplete / blocked / invalid window. The recent finalization reads as
 *                     consistently finalized. It authorizes NOTHING;
 *  - `watch`        — an ADVISORY history: the latest usable window is `indexed`, but an OLDER window was `index-open` /
 *                     `index-incomplete` (a residual concern under a clean latest). Not a hard block — track it;
 *  - `degrading`    — a WORSENING history: the latest usable window is `index-open`, or the arc DEGRADED (the newest
 *                     usable window is worse than the oldest). The recent finalization is not consistently finalized;
 *  - `insufficient` — a COVERAGE GAP: zero usable windows were considered, the latest usable window is
 *                     `index-incomplete`, or every usable window is `index-incomplete`. Fail-closed, never a vacuous
 *                     `stable`;
 *  - `blocked`      — a BLOCKING history: a usable window's own verdict is `index-blocked` or `index-invalid` (its
 *                     finalization history was blocked / untrustworthy), or `--strict-open` escalated a non-indexed
 *                     window. Do NOT treat the recent finalization as consistently finalized;
 *  - `invalid`      — an UNTRUSTWORTHY INPUT (the TOP precedence): a considered window was tampered or unreadable (its
 *                     recorded index verdict does not re-derive, or it is not a recognized finalize index). A trend over
 *                     it cannot be trusted.
 *
 * These are the exact bounded values the run-level `worker_release_decision_closeout_governance_finalize_index_trend_total`
 * metric carries as its `verdict` label; all seven are low-cardinality, redaction-stable tokens.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_VERDICTS = [
  "improving",
  "stable",
  "watch",
  "degrading",
  "insufficient",
  "blocked",
  "invalid",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_VERDICTS)[number];

/**
 * The exit-code ladder a CI / governance job routes on — the same shape / spirit as the whole release-decision suite:
 *  - `0` CLEAN        — a coherent, healthy history (`stable` or `improving`);
 *  - `1` USAGE        — the CLI was misused (a bad flag, no window supplied, or an unwritable output). CLI-owned; a trend
 *                       RUN never resolves to it;
 *  - `2` INSUFFICIENT — a coverage gap (zero usable windows, an incomplete latest, an only-incomplete history);
 *  - `3` WATCH        — an advisory / worsening history (`watch` or `degrading`);
 *  - `4` BLOCKED      — a blocking / untrustworthy history (`blocked` or `invalid`).
 *
 * Monotonic in badness; `insufficient` (2) sorts before the watch / degrading band (3) exactly like the rest of the
 * suite folds a coverage gap before an advisory posture.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_EXIT = {
  CLEAN: 0,
  USAGE: 1,
  INSUFFICIENT: 2,
  WATCH: 3,
  BLOCKED: 4,
} as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendExitCode =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_EXIT)[keyof typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_EXIT];

/** The authoritative verdict → exit code map. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_EXIT_FOR_VERDICT: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendExitCode
> = {
  improving: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_EXIT.CLEAN,
  stable: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_EXIT.CLEAN,
  watch: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_EXIT.WATCH,
  degrading: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_EXIT.WATCH,
  insufficient: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_EXIT.INSUFFICIENT,
  blocked: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_EXIT.BLOCKED,
  invalid: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_EXIT.BLOCKED,
};

/**
 * The common **severity** each fired trend reason maps onto, with precedence
 * `invalid > blocking > insufficient > advisory > informational` (checked in that order — higher is worse). The verdict
 * is resolved from the fired reason SET refined by the arc direction (advisory splits into `degrading` / `watch`,
 * informational into `improving` / `stable`), not purely by the worst severity — but the exit code follows the worst
 * fired band:
 *  - `informational` — a benign trend marker (the latest window `indexed` / an improving arc / a fully-coherent history);
 *  - `advisory`      — an advisory / worsening posture (an open latest / older open / an incomplete-in-history /
 *                      degrading arc);
 *  - `insufficient`  — a coverage gap (zero usable windows, an incomplete latest, an only-incomplete history);
 *  - `blocking`      — a blocked / untrustworthy usable window (`index-blocked` / `index-invalid`) or a `--strict-open`
 *                      escalation;
 *  - `invalid`       — an untrustworthy INPUT (a tampered or unreadable window).
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_SEVERITIES = [
  "informational",
  "advisory",
  "insufficient",
  "blocking",
  "invalid",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendSeverity =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_SEVERITIES)[number];

/**
 * One usable window's own index verdict → the common trend severity it contributes. A window whose OWN verdict is
 * `index-blocked` / `index-invalid` (Phase 75 concluded its finalization history was blocked / untrustworthy) is a
 * BLOCKING trend outcome — "a finalization history could not be trusted" — NOT an untrustworthy TREND input (that is an
 * `unreadable` / `tampered` window state).
 */
export const WINDOW_VERDICT_SEVERITY: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendSeverity
> = {
  indexed: "informational",
  "index-open": "advisory",
  "index-incomplete": "insufficient",
  "index-blocked": "blocking",
  "index-invalid": "blocking",
};

/**
 * The rank of a usable window's index verdict for the DIRECTION arc (higher = worse). Monotonic over the whole Phase 75
 * index verdict ladder so the oldest→newest arc is well-ordered: `indexed` (clean) is best; `index-invalid` (an
 * untrustworthy finalization history) is worst.
 */
export const WINDOW_VERDICT_RANK: Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict, number> = {
  indexed: 0,
  "index-incomplete": 1,
  "index-open": 2,
  "index-blocked": 3,
  "index-invalid": 4,
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
 * A bounded facet for the summary; the verdict logic consults it (a degrading arc drives `degrading`, an improving arc
 * an `improving`). Derived from ORDERED INPUT POSITIONS, never from any ingested timestamp.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_DIRECTIONS = [
  "improving",
  "stable",
  "degrading",
  "mixed",
  "unknown",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendDirection =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_DIRECTIONS)[number];

/**
 * The bounded **trend class** — the single coarse classification of the history, by worst-present + arc, in this
 * severity order:
 *  - `invalid`      — a tampered / unreadable window is present (an untrustworthy input);
 *  - `blocked`      — a usable window's own verdict is `index-blocked` / `index-invalid`;
 *  - `insufficient` — zero usable windows, an `index-incomplete` latest, or an only-incomplete history;
 *  - `regressing`   — the latest usable window is `index-open`, or the arc degraded;
 *  - `recovering`   — the latest usable window is `indexed` but an older window was non-indexed, or the arc improved;
 *  - `clean`        — every usable window is `indexed` (a fully-coherent history).
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_CLASSES = [
  "clean",
  "recovering",
  "regressing",
  "blocked",
  "insufficient",
  "invalid",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendClass =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_CLASSES)[number];

/**
 * The bounded reason ids — the closed set of REASONS the trend verdict resolved as it did, emitted in this stable order
 * (a superset view, so a reviewer sees every condition that applied, not only the winning one). The per-id severity is
 * authored in {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_REASON_DETAIL}:
 *
 * Invalid input (the trend cannot be trusted):
 *  - `window-unreadable`     — a considered window could not be read / recognized as a finalize index;
 *  - `window-tampered`       — a considered window is recognized but its recorded index verdict does NOT re-derive.
 *
 * Blocking (do NOT treat the finalization as consistently finalized):
 *  - `window-index-blocked`  — a usable window's own verdict is `index-blocked`;
 *  - `window-index-invalid`  — a usable window's own verdict is `index-invalid` (its finalization history was untrusted);
 *  - `strict-open-escalation`— `--strict-open` escalated a non-indexed usable window to a hard block.
 *
 * Insufficient (a coverage gap):
 *  - `no-usable-windows`     — the history has zero usable windows (nothing to summarize);
 *  - `latest-incomplete`     — the latest usable window's own verdict is `index-incomplete`;
 *  - `only-incomplete`       — every usable window's own verdict is `index-incomplete`.
 *
 * Advisory (an advisory / worsening posture):
 *  - `latest-open`           — the latest usable window's own verdict is `index-open`;
 *  - `trend-degrading`       — the newest usable window is worse than the oldest usable window (a degrading arc);
 *  - `window-open`           — an `index-open` window is present in the history (a residual open posture);
 *  - `window-incomplete`     — an `index-incomplete` window is present under a non-incomplete latest (a residual gap);
 *  - `require-latest-miss`   — `--require-latest-indexed` was set and the latest usable window is NOT `indexed`.
 *
 * Informational (a benign trend marker):
 *  - `latest-indexed`        — the latest usable window's own verdict is `indexed`;
 *  - `trend-improving`       — the newest usable window is cleaner than the oldest (a recovering arc);
 *  - `history-coherent`      — every considered window is a usable `indexed` (a fully-clean history marker).
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_REASON_IDS = [
  // Invalid input
  "window-unreadable",
  "window-tampered",
  // Blocking
  "window-index-blocked",
  "window-index-invalid",
  "strict-open-escalation",
  // Insufficient
  "no-usable-windows",
  "latest-incomplete",
  "only-incomplete",
  // Advisory
  "latest-open",
  "trend-degrading",
  "window-open",
  "window-incomplete",
  "require-latest-miss",
  // Informational
  "latest-indexed",
  "trend-improving",
  "history-coherent",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendReasonId =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_REASON_IDS)[number];

/**
 * The bounded next-action ids — the closed set of concrete operator steps the trend can recommend, in this canonical
 * order (the list is emitted in this order, deduped):
 *  - `recover-tampered-windows`        — recover the tampered finalize-index window(s) from your CI archive;
 *  - `recover-unreadable-windows`      — recover the unreadable finalize-index window(s); a coverage gap;
 *  - `review-blocked-windows`          — a window is `index-blocked` / `index-invalid`; reconcile before treating closed;
 *  - `review-strict-open`              — `--strict-open` flagged a non-indexed window; review it, or drop the flag;
 *  - `review-degrading-trend`          — the arc is worsening / the latest is open; investigate what changed;
 *  - `review-open-windows`             — an open posture is present; track the follow-up before relying on the history;
 *  - `complete-incomplete-windows`     — a window is `index-incomplete`; complete its evidence and re-index;
 *  - `supply-finalize-indexes`         — supply more / readable finalize-index windows and re-run;
 *  - `note-improving-trend`            — the arc recovered to a clean latest window; confirm the improvement is sustained;
 *  - `continue-indexing-finalizations` — the history is coherent; keep indexing finalization bundles on your cadence;
 *  - `keep-finalize-index-trend`       — keep this content-free trend as the local finalization review SUMMARY (always).
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_NEXT_ACTION_IDS = [
  "recover-tampered-windows",
  "recover-unreadable-windows",
  "review-blocked-windows",
  "review-strict-open",
  "review-degrading-trend",
  "review-open-windows",
  "complete-incomplete-windows",
  "supply-finalize-indexes",
  "note-improving-trend",
  "continue-indexing-finalizations",
  "keep-finalize-index-trend",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendNextActionId =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_NEXT_ACTION_IDS)[number];

/* ------------------------------------------------------------------ *
 *  Per-window bounded facts + the reduced trend point
 * ------------------------------------------------------------------ */

/**
 * The bounded facts reduced from a usable `pdfxyz.release-decision-closeout-governance-finalize-index/1` (its verdict
 * re-derived in ingest). Every field here re-derives from the window's own recorded coverage + distribution + policy, so
 * there is nothing un-revalidated for a locator to hide in.
 */
export interface FinalizeIndexFacts {
  /** The window's final index verdict (trusted — the window re-derived its own verdict + counts). */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict;
  /** The window's own exit code (context; the trend has its own). */
  readonly exitCode: number;
  /** True iff `verdict === "indexed"`. */
  readonly indexed: boolean;
  /** How many finalization bundles the window considered (after its own window cap). */
  readonly finalizationsConsidered: number;
  /** How many of those finalization bundles were usable in the window. */
  readonly finalizationsUsable: number;
  /** The window's finalization-verdict distribution over its usable bundles (all four keys present). */
  readonly finalizationVerdictCounts: Readonly<Record<ReleaseDecisionCloseoutGovernanceFinalizeVerdict, number>>;
  /** The window's own latest (newest) usable finalization verdict, or `null` (context). */
  readonly latestFinalization: ReleaseDecisionCloseoutGovernanceFinalizeVerdict | null;
  /** True iff the window was produced under `--strict-open` (context; never re-judged by the trend). */
  readonly strictOpen: boolean;
}

/**
 * One reduced window in the trend sequence — a bounded point ordered oldest → newest. Every field is a bounded enum, a
 * small integer, or app-authored prose; never a raw value from the input (not even the window's stamp).
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendPoint {
  /** 0-based position in the considered history, oldest = 0 (never the input's own stamp). */
  readonly position: number;
  /** The window's coverage state. */
  readonly state: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendWindowState;
  /**
   * The window's own index verdict (a bounded enum), or `null` when unreadable. Trusted only when `usable`; for a
   * `tampered` window it is the untrusted CLAIMED verdict (surfaced so the sequence shows what was asserted).
   */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict | null;
  /** The window's own latest (newest) usable finalization verdict, or `null` when not usable (context). */
  readonly latestFinalization: ReleaseDecisionCloseoutGovernanceFinalizeVerdict | null;
  /** The window's contribution on the common severity ladder, or `null` when not usable. */
  readonly severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendSeverity | null;
  /** How many finalization bundles the window considered (a bounded count; `0` when not usable). */
  readonly finalizationsConsidered: number;
  /** A one-line, content-free headline authored from the position + state + verdict. */
  readonly detail: string;
}

/* ------------------------------------------------------------------ *
 *  The internal history summary (build maps it to the result blocks)
 * ------------------------------------------------------------------ */

/**
 * The bounded history summary — how many windows were supplied / usable, the per-window index-verdict distribution, the
 * aggregate finalization distribution, the newest usable window summary, and the arc direction + trend class. Every
 * count is over the USABLE considered windows (an unreadable / tampered window contributes no trusted verdict), so the
 * summary never fabricates a posture. `build` maps this to the result's `coverage` / `windowDistribution` /
 * `finalizationDistribution` / `latest` / `trend` blocks.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendSummary {
  /** How many window inputs were supplied (before any cap). */
  readonly windowsSupplied: number;
  /** How many windows were considered after the `--max-windows` window cap (the newest N). */
  readonly windowsConsidered: number;
  /** True iff `--max-windows` dropped older windows from the history. */
  readonly truncated: boolean;
  /** How many older windows were dropped by the window cap (`windowsSupplied − windowsConsidered`). */
  readonly droppedOldest: number;
  /** How many considered windows are usable (recognized + self-consistent). */
  readonly windowsUsable: number;
  /** How many considered windows were unreadable (not recognized as a finalize index). */
  readonly windowsUnreadable: number;
  /** How many considered windows were tampered (recognized but self-inconsistent). */
  readonly windowsTampered: number;
  /** The count of each index verdict across the usable considered windows (all five keys present). */
  readonly windowVerdictCounts: Readonly<Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict, number>>;
  /** The newest usable window's index verdict, or `null` if none is usable (a coarse ordinal, never a timestamp). */
  readonly newest: ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict | null;
  /** The oldest usable window's index verdict, or `null` if none is usable (a coarse ordinal, never a timestamp). */
  readonly oldest: ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict | null;
  /** The total finalization bundles considered across the usable windows (a bounded sum). */
  readonly totalFinalizations: number;
  /** The total usable finalization bundles across the usable windows (a bounded sum). */
  readonly totalUsableFinalizations: number;
  /** The aggregate finalization distribution across the usable windows (all four keys present). */
  readonly finalizationVerdictCounts: Readonly<Record<ReleaseDecisionCloseoutGovernanceFinalizeVerdict, number>>;
  /** The bounded summary of the newest usable window, or `null` if none is usable. */
  readonly latest: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendLatest | null;
  /** The bounded arc from oldest usable to newest usable, by index verdict rank. */
  readonly direction: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendDirection;
  /** The single coarse classification of the history. */
  readonly trendClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendClass;
}

/* ------------------------------------------------------------------ *
 *  The result's bounded blocks (the spec's top-level fields)
 * ------------------------------------------------------------------ */

/** The bounded coverage block — how many windows were supplied / considered / usable / unreadable / tampered / dropped. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendCoverage {
  readonly windowsSupplied: number;
  readonly windowsConsidered: number;
  readonly windowsUsable: number;
  readonly windowsUnreadable: number;
  readonly windowsTampered: number;
  readonly truncated: boolean;
  readonly droppedOldest: number;
}

/** The bounded per-window index-verdict distribution over the usable windows (all five keys present) + newest / oldest. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendWindowDistribution {
  readonly verdictCounts: Readonly<Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict, number>>;
  readonly newest: ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict | null;
  readonly oldest: ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict | null;
}

/** The bounded aggregate finalization distribution across the usable windows (all four keys present) + bounded totals. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizationDistribution {
  readonly verdictCounts: Readonly<Record<ReleaseDecisionCloseoutGovernanceFinalizeVerdict, number>>;
  /** The total finalization bundles considered across the usable windows. */
  readonly totalConsidered: number;
  /** The total usable finalization bundles across the usable windows. */
  readonly totalUsable: number;
}

/** The bounded summary of the newest usable window — no timestamps / stamps, only bounded enums + small integers. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendLatest {
  /** The newest usable window's index verdict. */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict;
  /** True iff that verdict is `indexed`. */
  readonly indexed: boolean;
  /** How many finalization bundles that window considered. */
  readonly finalizationsConsidered: number;
  /** How many of those bundles were usable in that window. */
  readonly finalizationsUsable: number;
  /** That window's own latest (newest) usable finalization verdict, or `null`. */
  readonly latestFinalization: ReleaseDecisionCloseoutGovernanceFinalizeVerdict | null;
  /** True iff that window was produced under `--strict-open` (context). */
  readonly strictOpen: boolean;
}

/** The bounded `trend` block — the arc direction + coarse class only (the verdict / exit are top-level). */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendArc {
  readonly direction: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendDirection;
  readonly class: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendClass;
}

/** The bounded, applied policy knobs (from the validated args). */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendPolicy {
  /** The maximum number of newest windows considered (the window cap). */
  readonly maxWindows: number;
  /** True iff `--strict-open` was set (any non-indexed usable window escalates to `blocked`). */
  readonly strictOpen: boolean;
  /** True iff `--require-latest-indexed` was set (a non-indexed latest cannot be `stable` / `improving`). */
  readonly requireLatestIndexed: boolean;
}

/** One fired reason, with its resolved severity + authored detail. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendReason {
  readonly id: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendReasonId;
  readonly severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendSeverity;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** One next-action step, with its authored detail. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendNextAction {
  readonly id: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendNextActionId;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/**
 * The composite trend decision — the internal rollup the fold produces. `build` surfaces `verdict` / `exitCode` at the
 * top level and the `direction` / `class` under `trend`; the strict flags are surfaced via reasons + prose.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendRollup {
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict;
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendExitCode;
  /** True iff `verdict === "stable"` or `verdict === "improving"` (a coherent, healthy history). */
  readonly clean: boolean;
  /** The latest (newest) usable window's own index verdict, or `null` if none is usable. */
  readonly latest: ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict | null;
  /** The fired reason ids, in canonical order. */
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendReasonId[];
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
  readonly direction: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendDirection;
  /** The single coarse classification of the history. */
  readonly trendClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendClass;
  /** True iff `--strict-open` was applied. */
  readonly strictOpen: boolean;
  /** True iff `--strict-open` ESCALATED a non-indexed usable window to `blocked`. */
  readonly strictOpenEscalated: boolean;
  /** Which verdict `--strict-open` escalated FROM, or `null` when no escalation applied. */
  readonly strictOpenEscalatedFrom:
    | ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict
    | null;
  /** True iff `--require-latest-indexed` was applied. */
  readonly requireLatestIndexed: boolean;
  readonly detail: string;
}

/** The stable identity block the result records (with the pinned upstream finalize-index schema). */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_POLICY_VERSION;
  readonly finalizeIndexSchema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_SCHEMA;
}

/**
 * The stable, content-free release decision closeout governance finalize index trend a governance review / CI reads.
 * Every field is a bounded enum, a small integer, an ISO stamp, or app-authored prose — so it carries no reviewer
 * identity, locator, size, path, or byte, even from a hostile input, and never echoes an ingested window's own stamp.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendResult {
  readonly schema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendMetadata;
  readonly policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendPolicy;
  /** The composite trend verdict a governance review acts on. */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict;
  /** The process exit code (mirrors {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_EXIT_FOR_VERDICT}). */
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendExitCode;
  /** The bounded coverage summary. */
  readonly coverage: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendCoverage;
  /** The bounded per-window index-verdict distribution over the usable windows. */
  readonly windowDistribution: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendWindowDistribution;
  /** The bounded aggregate finalization distribution across the usable windows. */
  readonly finalizationDistribution: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizationDistribution;
  /** The bounded summary of the newest usable window, or `null` if none is usable. */
  readonly latest: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendLatest | null;
  /** One reduced point per considered window, ordered oldest → newest. */
  readonly points: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendPoint[];
  /** The bounded arc direction + coarse class. */
  readonly trend: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendArc;
  /** Every fired reason, in canonical {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_REASON_IDS} order. */
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendReason[];
  /** The bounded, ordered next-action list. Never derived from an input. */
  readonly nextActions: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendNextAction[];
  /** Bounded, app-authored guidance (out-of-scope steps this trend does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from any ingested window. */
  readonly caveats: readonly string[];
  /** The flattened, content-free receipt (safe to log / forward verbatim). */
  readonly receipt: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendReceipt;
}

/**
 * The content-free **audit receipt** the result rides alongside its body — the flattened answer to "what did this trend
 * conclude, over how many usable windows, in what distribution, with what latest" for a SIEM / review record. Bounded
 * enums + small integers + a stable policy id + the run's own stamp + a disclosure statement only; safe to log or
 * forward verbatim.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendReceipt {
  readonly category: "worker-release-decision-closeout-governance-finalize-index-trend";
  readonly policyId: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_POLICY_VERSION;
  readonly at: string;
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict;
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendExitCode;
  /** How many window inputs were supplied. */
  readonly windowsSupplied: number;
  /** How many windows were considered after the window cap. */
  readonly windowsConsidered: number;
  /** How many considered windows are usable. */
  readonly windowsUsable: number;
  /** The count of each index verdict across the usable considered windows (all five keys present). */
  readonly windowVerdictCounts: Readonly<Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict, number>>;
  /** The latest (newest) usable window's own index verdict, or `null` if none is usable. */
  readonly latest: ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict | null;
  /** The bounded arc direction. */
  readonly direction: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendDirection;
  /** The single coarse classification of the history. */
  readonly trendClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendClass;
  /** The bounded, app-authored disclosure statement (what this trend is NOT). Never derived from an input. */
  readonly disclosure: string;
}

/** The process exit code for a trend result. */
export function releaseDecisionCloseoutGovernanceFinalizeIndexTrendExitCode(
  result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendResult,
): number {
  return result.exitCode;
}

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from any ingested window)
 * ------------------------------------------------------------------ */

/** The one-line verdict headline. Authored here, keyed by the enum. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_VERDICT_SUMMARY: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict,
  string
> = {
  improving:
    "IMPROVING: the recent finalize-index history recovered — the latest usable window is an INDEXED index and an earlier window was worse (a recovering arc). Confirm the improvement is sustained across the next windows. This trend authorizes nothing on its own.",
  stable:
    "STABLE: the recent finalize-index history is healthy — every usable window is an INDEXED index, with no tampered / unreadable / open / incomplete / blocked / invalid window. Keep indexing finalization bundles per window and summarizing them on your governance cadence. This trend authorizes nothing on its own.",
  watch:
    "WATCH: an ADVISORY history — the latest usable window is INDEXED, but an earlier window was INDEX-OPEN / INDEX-INCOMPLETE (a residual concern under a clean latest). Track the earlier follow-up(s); this is not a hard block, but the history is not uniformly clean either.",
  degrading:
    "DEGRADING: a WORSENING history — the latest usable window is INDEX-OPEN, or the arc DEGRADED (the newest window is worse than the oldest). Track the open follow-up(s) and investigate what changed; the recent finalization is not consistently finalized.",
  insufficient:
    "INSUFFICIENT: the finalize-index history has a COVERAGE GAP — zero usable windows were considered, the latest usable window is INDEX-INCOMPLETE, or every usable window is INDEX-INCOMPLETE. Complete the missing evidence or supply a readable history, then re-summarize; this is not a coherent history.",
  blocked:
    "BLOCKED: a BLOCKING history — a usable window's own verdict is INDEX-BLOCKED / INDEX-INVALID (its finalization history was blocked / untrustworthy), or `--strict-open` escalated a non-indexed window. Do NOT treat the recent finalization as consistently finalized until the cause is resolved.",
  invalid:
    "INVALID: an UNTRUSTWORTHY INPUT — a considered window is tampered (its recorded index verdict does not re-derive) or unreadable (not a recognized finalize index). A trend over an untrustworthy window cannot be trusted; recover the untampered / readable window(s) and re-run.",
};

/**
 * The dedicated headline for a `blocked` trend produced ONLY because `--strict-open` escalated a non-indexed usable
 * window — there was no blocked / invalid usable window or tampered / unreadable input, so the generic headline would
 * misrepresent the cause. Authored.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_STRICT_OPEN_ESCALATED_SUMMARY =
  "BLOCKED (--strict-open): the only concern is a NON-INDEXED usable window (an open / incomplete / recovering history), and `--strict-open` escalates any non-indexed usable window to a hard block — a `consistently finalized or blocked` gate for a high-assurance review. Without the flag this would be a watch / degrading / insufficient / improving trend. No blocked / invalid usable window and no tampered / unreadable input was found.";

/** Per-reason authored detail + resolved severity, keyed by id. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_REASON_DETAIL: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendReasonId,
  { readonly severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendSeverity; readonly detail: string }
> = {
  "window-unreadable": {
    severity: "invalid",
    detail:
      "A considered window could not be read / recognized as a `pdfxyz.release-decision-closeout-governance-finalize-index/1` (wrong schema or unparseable — never echoed), so it contributes no trusted verdict and the input cannot be trusted. Recover a readable finalize index produced by `worker:release-decision-closeout-governance-finalize-index` and re-run.",
  },
  "window-tampered": {
    severity: "invalid",
    detail:
      "A considered window is a recognized `pdfxyz.release-decision-closeout-governance-finalize-index/1` whose recorded index verdict does NOT re-derive from its own recorded coverage + distribution + policy, or whose counts disagree with its own per-record sequence — a hand-edited or corrupt window. Recover the untampered window from your CI archive; a tampered window cannot be summarized.",
  },
  "window-index-blocked": {
    severity: "blocking",
    detail:
      "A usable window's OWN index verdict is `index-blocked` — its finalization history was blocked (a `finalize-blocked` latest / bundle, or a `--strict-open` escalation in that window). The recent finalization is not consistently finalized: reconcile the block and re-index that window before relying on the history.",
  },
  "window-index-invalid": {
    severity: "blocking",
    detail:
      "A usable window's OWN index verdict is `index-invalid` — its finalization history contained a tampered / unreadable bundle (an untrustworthy input to that window). The window is self-consistent, but the finalization it summarizes cannot be trusted: recover the untampered bundle(s) and re-index that window before relying on the history.",
  },
  "strict-open-escalation": {
    severity: "blocking",
    detail:
      "`--strict-open` was set and a non-indexed usable window is present (an `index-open` / `index-incomplete` window, or a recovering history), so the policy escalates it to a hard block — a `consistently finalized or blocked` gate for a high-assurance review. Close the open follow-up(s) / complete the missing evidence (or drop `--strict-open` if a non-indexed history is acceptable) before treating the history as finalized.",
  },
  "no-usable-windows": {
    severity: "insufficient",
    detail:
      "The history has zero usable windows — every considered window was unreadable / tampered, or the history was empty. There is nothing to summarize; supply a bounded history of readable `pdfxyz.release-decision-closeout-governance-finalize-index/1` windows and re-run.",
  },
  "latest-incomplete": {
    severity: "insufficient",
    detail:
      "The latest (newest) usable window's OWN index verdict is `index-incomplete` — its most recent finalization history had a coverage gap (an unreadable bundle, an incomplete latest, a require-latest miss, or zero usable bundles). Complete the missing evidence, re-index the latest window, and re-summarize before treating the history as finalized.",
  },
  "only-incomplete": {
    severity: "insufficient",
    detail:
      "Every usable window's OWN index verdict is `index-incomplete` — the whole recent history is a coverage gap, with no window fully finalized. Complete the missing evidence across the review periods and re-index before treating the history as finalized; this is not a coherent history.",
  },
  "latest-open": {
    severity: "advisory",
    detail:
      "The latest (newest) usable window's OWN index verdict is `index-open` — an advisory follow-up remains open on the most recent finalization history. Track the follow-up to closure, re-index the latest window, and re-summarize; this is not a hard block, but the history is not consistently finalized.",
  },
  "trend-degrading": {
    severity: "advisory",
    detail:
      "The newest usable window's index verdict is WORSE than the oldest usable window's (a worse index posture after an earlier cleaner one) — the recent arc degraded. Investigate what changed between the recent windows before relying on the history.",
  },
  "window-open": {
    severity: "advisory",
    detail:
      "An `index-open` window is present in the history — an advisory follow-up was open on some review period's finalization history. Track the recorded follow-up(s) to closure and re-index before treating the history as consistently finalized.",
  },
  "window-incomplete": {
    severity: "advisory",
    detail:
      "An `index-incomplete` window is present in the history under a non-incomplete latest — a review period's finalization history had a coverage gap. Complete the missing evidence for that period and re-index; the latest window is clean, but the history is not uniformly complete.",
  },
  "require-latest-miss": {
    severity: "advisory",
    detail:
      "`--require-latest-indexed` was set and the latest (newest) usable window's OWN index verdict is NOT `indexed`. The policy requires the most recent review period to be fully finalized: complete / reconcile the latest window and re-index (or drop `--require-latest-indexed` if a non-indexed latest is acceptable) before treating the history as finalized.",
  },
  "latest-indexed": {
    severity: "informational",
    detail:
      "The latest (newest) usable window's OWN index verdict is `indexed` — the most recent finalization history read as consistently finalized. This is the load-bearing marker for a `stable` / `improving` trend (provided the history is coherent and the arc is not degrading); it records a bounded review, not an approval or a promotion.",
  },
  "trend-improving": {
    severity: "informational",
    detail:
      "The newest usable window's index verdict is CLEANER than the oldest usable window's (a recovering arc) — the recent finalize-index postures improved. Note the improvement and confirm it is sustained across the next windows; this trend authorizes nothing on its own.",
  },
  "history-coherent": {
    severity: "informational",
    detail:
      "Every considered window is a usable `indexed` index — the whole recent history reads as consistently finalized, with no unreadable / tampered / open / incomplete / blocked / invalid window. Keep the underlying finalize indexes on your governance cadence.",
  },
};

/** Per-next-action authored detail, keyed by id. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_NEXT_ACTION_DETAIL: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendNextActionId,
  string
> = {
  "recover-tampered-windows":
    "Recover the tampered finalize-index window(s) from your CI archive: a window whose recorded index verdict does not re-derive from its own recorded coverage + distribution, or whose counts disagree with its own sequence, means the trend input was hand-edited or corrupt and cannot be trusted.",
  "recover-unreadable-windows":
    "Recover the unreadable finalize-index window(s): a window that cannot be read / recognized as a `pdfxyz.release-decision-closeout-governance-finalize-index/1` is an untrustworthy input to the trend. Recover a valid finalize index produced by `worker:release-decision-closeout-governance-finalize-index` and re-run.",
  "review-blocked-windows":
    "A window in the history is `index-blocked` / `index-invalid` (its finalization history was blocked, or contained a tampered / unreadable bundle): do NOT treat that review period as consistently finalized. Reconcile the block / recover the untampered bundle and re-index that window before relying on the history.",
  "review-strict-open":
    "`--strict-open` flagged a non-indexed window (an open / incomplete / recovering history): the policy requires the history to be consistently finalized. Review the flagged window(s) and resolve the concern, or drop `--strict-open` if a non-indexed history is acceptable for this review, before relying on the history.",
  "review-degrading-trend":
    "The recent arc is worsening (the newest window is worse than the earliest usable window), or the latest window is open: investigate what changed between the recent review periods and resolve the regression before relying on the history. Archive this trend as the record of that review.",
  "review-open-windows":
    "A window in the history is `index-open` (an advisory follow-up still open): track the recorded follow-up to closure, re-index that window, and re-summarize before relying on the history. Archive this trend as the record of that review.",
  "complete-incomplete-windows":
    "A window in the history is `index-incomplete` (a coverage gap in its finalization history): complete the missing evidence with `worker:release-decision-closeout-governance-finalize` / `worker:release-decision-closeout-governance-finalize-index`, re-index that window, and re-summarize.",
  "supply-finalize-indexes":
    "Supply more / readable content-free `pdfxyz.release-decision-closeout-governance-finalize-index/1` windows (a bounded history, oldest first) and re-run this trend: an unreadable or empty history cannot be summarized.",
  "note-improving-trend":
    "The recent arc recovered to a clean latest window: note the improvement and confirm it is sustained across the next windows. Keep indexing finalization bundles and summarizing them here; this trend authorizes no promotion on its own.",
  "continue-indexing-finalizations":
    "The history is coherent: keep filing one `worker:release-decision-closeout-governance-finalize-index` window per review period and summarizing them here on your governance cadence. This trend authorizes no promotion on its own.",
  "keep-finalize-index-trend":
    "Keep this content-free trend as the local release-decision-closeout-governance-finalize-index governance review SUMMARY. It is NOT a legal audit log, a compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger; keep those separately.",
};

/** The bounded, app-authored disclosure statement the receipt + text render carry (what this trend is NOT). */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_DISCLOSURE =
  "This is a content-free finalize-index TREND SUMMARY ONLY — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It ingests a bounded history of previously produced finalize-index summaries and records whether the recent release decision closeout governance FINALIZATION trended consistently finalized; it authorizes and proves nothing, and it attests no person's identity.";

/**
 * The honesty caveats every result carries and every text render prints. The trend SUMMARIZES a bounded history of the
 * chain's already content-free finalize-index windows, RE-VALIDATES each one's self-consistency, and rolls them up into
 * one trend verdict; it must never be read as more than that.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_CAVEATS: readonly string[] = [
  "This is a RELEASE DECISION CLOSEOUT GOVERNANCE FINALIZE INDEX TREND SUMMARY: it INGESTS a bounded history of content-free `pdfxyz.release-decision-closeout-governance-finalize-index/1` windows a release pipeline produced, RE-VALIDATES each against ITSELF, and folds them into ONE bounded trend verdict + follow-up list. It is a local content-free finalize-index TREND SUMMARY over finalize-index windows — NOT a legal audit log, a compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger.",
  "It is offline and READ-ONLY: it makes NO network call, reads NO secret, bucket, or object, RUNS no gate / index / decision / trend / plan / receipt / closeout / governance / finalize itself, and NEVER signs, approves, publishes, promotes, deploys, notifies, deletes, prunes, uploads, or mutates any window, record, artifact, object, or deployment. A `stable` / `improving` trend authorizes nothing; it only reports that the content-free finalize-index windows supplied on THIS host trended consistently finalized over the review history.",
  "A `stable` / `improving` trend REQUIRES a coherent bounded history: every usable window an `indexed` index, no tampered / unreadable window, and no open / incomplete / blocked / invalid window. It FAILS CLOSED: a tampered / unreadable window makes the trend `invalid` (the TOP precedence); an `index-blocked` / `index-invalid` usable window, or a `--strict-open` escalation, makes it `blocked`; zero usable windows, an `index-incomplete` latest, or an only-incomplete history makes it `insufficient`; an `index-open` latest or a degrading arc makes it `degrading`; an older open / incomplete window under a clean latest makes it `watch`. It never fabricates a clean trend from thin or untrusted history.",
  "It re-derives each ingested window's index verdict from the window's OWN recorded coverage + distribution + policy (reusing the Phase 75 index reducer) AND re-checks those counts against the window's own per-record sequence + window arithmetic, and treats any disagreement as a TAMPER (`invalid`). This re-derivation is TAMPER-EVIDENCE over content-free data, NOT a cryptographic signature — there is no signing key and no attested identity, so the trend proves neither authorship nor approval, and a set of fully self-consistent fabricated windows is out of its scope.",
  "It emits only bounded enums, small counts, an ISO stamp, and app-authored prose — so it carries no reviewer name or email, no filename, path, object key, bucket, URL, endpoint, region, job / user id, IP, token, raw ref, raw label, raw note, commit URL, size, byte, or digest, even from a hostile input; it never echoes an ingested window's own stamp, and it never echoes an input file path, even on an error.",
  "It is not malware scanning, sanitization, authorization, cloud validation, or deletion proof of any request or object, and it deletes, uploads, promotes, approves, or mutates nothing.",
];

/**
 * Out-of-band reminders the trend carries but does NOT itself perform — the honest edges of an offline summarizer.
 * Authored, bounded, content-free; never derived from an input.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_GUIDANCE: readonly string[] = [
  "Wire this as a SCHEDULED or on-demand GOVERNANCE summary (per quarter / half-year), NOT a per-release gate: run `worker:release-decision-closeout-governance-finalize-index` per review window and archive each window, then hand a bounded history (oldest first, newest last) here and render `--text` into a review artifact / `$GITHUB_STEP_SUMMARY`. Fail the review on exit 4 (a blocked / untrustworthy history), surface exit 3 (a watch / degrading history) and exit 2 (an insufficient history) for review, and treat exit 0 (a coherent / improving history) as consistently finalized — never as an authorization.",
  "Keep the history bounded and explicit: `--max-windows=N` caps the newest N windows (older windows are dropped from the history, and the count dropped is surfaced, never silent); `--require-latest-indexed` demands an `indexed` latest window; `--strict-open` escalates any non-indexed usable window to a hard block for a high-assurance review. Direction is derived from ORDERED INPUT POSITIONS (oldest first, newest last), never from any ingested timestamp.",
  "Archive this trend (and the underlying finalize-index windows) as CI artifacts: it is a content-free governance SUMMARY, not a substitute for the windows it summarizes, nor for your legal audit trail, compliance log, external approval / signing, storage retention, or release-promotion processes — keep each of those in its own dedicated system.",
  "Enforce promotion out of band: this trend SUMMARIZES a history of the content-free finalize-index windows supplied, but recording a legal audit trail, obtaining an external approval / signature, proving reviewer identity, and promoting a deployment are operator / CI / legal actions this offline summarizer never performs.",
];
