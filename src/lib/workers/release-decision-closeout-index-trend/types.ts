/**
 * The bounded, content-free vocabulary for the secure-worker **release decision closeout index trend** (Phase 66).
 *
 * Phases 59–65 built the release DECISION chain, one rung per phase: the decision RECORD ledger
 * (`pdfxyz.release-decision/1`, Phase 59), the decision LEDGER INDEX (`pdfxyz.release-decision-index/1`, Phase 60), the
 * decision INDEX TREND (`pdfxyz.release-decision-trend/1`, Phase 61), the decision TREND ACTION PLAN (Phase 62), the
 * ACTION-PLAN EXECUTION RECEIPT (Phase 63), the decision CLOSEOUT BUNDLE (`pdfxyz.release-decision-closeout/1`, Phase
 * 64), and the decision CLOSEOUT INDEX (`pdfxyz.release-decision-closeout-index/1`, Phase 65) — which folds a bounded
 * BATCH of closeout records into ONE index verdict + closeout distribution for a single review window (a sprint /
 * quarter of closeouts).
 *
 * This phase closes the *governance review* loop over a BOUNDED HISTORY of those closeout-index windows. It INGESTS
 * one or more `pdfxyz.release-decision-closeout-index/1` documents (a quarter / year of weekly, monthly, or quarterly
 * closeout-index summaries), RE-VALIDATES each against ITSELF (re-deriving its Phase 65 index verdict from its own
 * recorded ledger + latest AND re-checking those counts against the window's own per-record sequence, so a hand-flipped
 * index is caught as a tamper), and folds them into ONE stable, content-free
 * `pdfxyz.release-decision-closeout-index-trend/1` summary that answers a single question a periodic
 * release-governance review needs —
 *
 *    "Over the recent history of release-decision closeout-index windows on this host, are the closeouts trending
 *     STABLE / improving (consistently closed), WATCHing (an open posture / worsening arc), INCOMPLETE (a coverage
 *     gap), or BLOCKED (untrustworthy / blocked), and what bounded operator follow-up is warranted?"
 *
 * — with a bounded trend verdict + direction, a per-window index-verdict distribution, an aggregate closeout
 * distribution, a per-window posture sequence, a bounded rationale, and a bounded next-action checklist, and it FAILS
 * CLOSED when a window cannot be trusted or the history is inconclusive.
 *
 * Like the Phase 65 index it summarizes, it is LATEST-FOCUSED: the NEWEST usable window's own index verdict is the
 * primary driver, and bounded history thresholds (`--max-watch` / `--max-incomplete` / `--max-blocked`, each defaulting
 * to 0) let an operator tolerate a bounded number of non-`indexed` windows in the history before the accumulation
 * escalates the trend; a worsening ARC additionally raises a `watch`.
 *
 * It obeys the same honesty contract as the rest of the worker layer and is as content-free as the windows it
 * summarizes:
 *  - Every load-bearing token here is a bounded enum — a window state, an index verdict, a closeout verdict, a trend
 *    verdict, a direction, a trend class, a severity, a reason id, a checklist id — never a filename, path, object key,
 *    bucket, URL, endpoint, region, id, token, size, byte, raw ref, raw label, raw note, reviewer identity, commit URL,
 *    or digest. The only non-enum values are small integer counts, an ISO stamp, and app-authored prose.
 *  - It never copies a free-text field out of an ingested window (each — even one Phase 65 produced — is UNTRUSTED
 *    input here); it reduces every window to bounded enums, small integers, or booleans, it never echoes an ingested
 *    window's OWN stamp (the trend carries only its own), and it never echoes an input file path, even on an error.
 *  - It never fabricates a clean pass. `trend-stable` REQUIRES a coherent bounded history: the latest usable window an
 *    `indexed` index, no tampered / unreadable window, the watch / incomplete / blocked counts within their thresholds,
 *    and a non-degrading arc. A tampered window, an `index-blocked` latest / threshold breach, or a `--strict-watch`
 *    escalation makes the trend `trend-blocked`; an `index-open` latest / threshold breach or a degrading arc makes it
 *    `trend-watch`; an unreadable window, an `index-incomplete` latest / threshold breach, or zero usable windows makes
 *    it `trend-incomplete`.
 *
 * It is deliberately NOT a new evidence rung, NOT a legal audit trail, NOT a compliance attestation, NOT an external
 * signature, NOT an identity ledger, NOT storage-retention ENFORCEMENT, and NOT a deployment / promotion ledger. It
 * PROVES nothing the windows do not already prove; it SUMMARIZES a bounded history of their content-free index verdicts
 * + closeout distributions, RE-VALIDATES each one's self-consistency, and rolls them up into one trend verdict +
 * follow-up checklist. Its authored caveats (see {@link RELEASE_DECISION_CLOSEOUT_INDEX_TREND_CAVEATS}) say so out loud.
 */

import {
  RELEASE_DECISION_CLOSEOUT_INDEX_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_INDEX_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_VERDICTS,
  type ReleaseDecisionCloseoutIndexVerdict,
  type ReleaseDecisionCloseoutVerdict,
} from "../release-decision-closeout-index/types";

/** The schema tag every closeout-index-trend result carries, so tooling can pin the shape it parses. */
export const RELEASE_DECISION_CLOSEOUT_INDEX_TREND_SCHEMA =
  "pdfxyz.release-decision-closeout-index-trend/1" as const;

/** The upstream document schema the trend ingests. Re-exported so the result can pin its input shape. */
export { RELEASE_DECISION_CLOSEOUT_INDEX_SCHEMA };

/** The upstream index / closeout verdicts the trend tallies + surfaces per window, re-exported for convenience. */
export { RELEASE_DECISION_CLOSEOUT_INDEX_VERDICTS, RELEASE_DECISION_CLOSEOUT_VERDICTS };
export type { ReleaseDecisionCloseoutIndexVerdict, ReleaseDecisionCloseoutVerdict };

/** Stable identity of the release-decision-closeout-index-trend — for docs / receipts / audit. */
export const RELEASE_DECISION_CLOSEOUT_INDEX_TREND_POLICY_ID =
  "pdfxyz-worker-release-decision-closeout-index-trend";
/** Bump when the trend surface, the verdict ladder, the reason / checklist / trend-class sets, or the schema changes. */
export const RELEASE_DECISION_CLOSEOUT_INDEX_TREND_POLICY_VERSION = 1;

/** The default window cap: the newest N windows considered when `--max-indexes` is not given. */
export const DEFAULT_MAX_INDEXES = 26;

/**
 * The bounded coverage state of one ingested closeout-index window — every supplied `--index` / `--file` / stdin
 * element is SUPPLIED, so a window is one of:
 *  - `unreadable` — an element was supplied but could not be read / parsed / recognized as a
 *                   `pdfxyz.release-decision-closeout-index/1` (never echoed). It certifies nothing → a coverage gap
 *                   (INCOMPLETE), never a vacuous pass;
 *  - `tampered`   — recognized as a closeout index but its recorded index verdict does NOT re-derive from its own
 *                   recorded ledger, or those counts disagree with the window's own per-record sequence (a hand-edited
 *                   / corrupt window) → an untrustworthy INPUT (BLOCKING);
 *  - `usable`     — recognized AND self-consistent (its recorded index verdict re-derives, and its counts match its
 *                   sequence): trustworthy.
 */
export const RELEASE_DECISION_CLOSEOUT_INDEX_TREND_WINDOW_STATES = [
  "unreadable",
  "tampered",
  "usable",
] as const;
export type ReleaseDecisionCloseoutIndexTrendWindowState =
  (typeof RELEASE_DECISION_CLOSEOUT_INDEX_TREND_WINDOW_STATES)[number];

/**
 * The single trend verdict a governance review keys on — the answer to "how are the recent closeout-index windows, and
 * is follow-up warranted?":
 *  - `trend-stable`     — a COHERENT bounded history: the latest usable window is an `indexed` index, no tampered /
 *                         unreadable window is present, the watch / incomplete / blocked counts are within their
 *                         thresholds, and the arc is not degrading. The recent closeouts read as consistently closed.
 *                         It authorizes NOTHING;
 *  - `trend-incomplete` — a COVERAGE GAP: zero usable windows were considered, a considered window was unreadable, the
 *                         latest usable window's own verdict is `index-incomplete`, or the incomplete count exceeds
 *                         `--max-incomplete`. Fail-closed, never a vacuous `trend-stable`;
 *  - `trend-watch`      — an ADVISORY / worsening history: the latest usable window's own verdict is `index-open`, the
 *                         watch count exceeds `--max-watch`, or the arc DEGRADED (the newest usable window is worse than
 *                         the oldest). Not a hard block — track it before relying on the history;
 *  - `trend-blocked`    — a BLOCKING / untrustworthy history: a considered window is tampered, the latest usable window's
 *                         own verdict is `index-blocked`, the blocked count exceeds `--max-blocked`, or `--strict-watch`
 *                         escalated a watch trend. Do NOT treat the history as consistently closed.
 *
 * These are the exact bounded values the run-level `worker_release_decision_closeout_index_trend_total` metric carries
 * as its `verdict` label; all four are low-cardinality, redaction-stable tokens.
 */
export const RELEASE_DECISION_CLOSEOUT_INDEX_TREND_VERDICTS = [
  "trend-stable",
  "trend-incomplete",
  "trend-watch",
  "trend-blocked",
] as const;
export type ReleaseDecisionCloseoutIndexTrendVerdict =
  (typeof RELEASE_DECISION_CLOSEOUT_INDEX_TREND_VERDICTS)[number];

/**
 * The exit-code ladder a CI / governance job routes on — the same shape / spirit as the whole release-decision suite:
 *  - `0` STABLE      — a coherent, healthy history (the latest window `indexed`, within thresholds, non-degrading);
 *  - `1` USAGE       — the CLI was misused (a bad flag, no window supplied, or an unwritable output). CLI-owned; a
 *                      trend RUN never resolves to it;
 *  - `2` INCOMPLETE  — a coverage gap (zero usable windows, an unreadable window, an incomplete latest / breach);
 *  - `3` WATCH       — an advisory / worsening history (an open latest / breach, or a degrading arc);
 *  - `4` BLOCKED     — a blocking / untrustworthy history (a tampered window, a blocked latest / breach, or a
 *                      `--strict-watch` escalation).
 *
 * Monotonic in badness; `trend-incomplete` (2) sorts before the `trend-watch` band (3) exactly like the rest of the
 * suite folds a coverage gap before an advisory posture.
 */
export const RELEASE_DECISION_CLOSEOUT_INDEX_TREND_EXIT = {
  STABLE: 0,
  USAGE: 1,
  INCOMPLETE: 2,
  WATCH: 3,
  BLOCKED: 4,
} as const;
export type ReleaseDecisionCloseoutIndexTrendExitCode =
  (typeof RELEASE_DECISION_CLOSEOUT_INDEX_TREND_EXIT)[keyof typeof RELEASE_DECISION_CLOSEOUT_INDEX_TREND_EXIT];

/** The authoritative verdict → exit code map. */
export const RELEASE_DECISION_CLOSEOUT_INDEX_TREND_EXIT_FOR_VERDICT: Record<
  ReleaseDecisionCloseoutIndexTrendVerdict,
  ReleaseDecisionCloseoutIndexTrendExitCode
> = {
  "trend-stable": RELEASE_DECISION_CLOSEOUT_INDEX_TREND_EXIT.STABLE,
  "trend-incomplete": RELEASE_DECISION_CLOSEOUT_INDEX_TREND_EXIT.INCOMPLETE,
  "trend-watch": RELEASE_DECISION_CLOSEOUT_INDEX_TREND_EXIT.WATCH,
  "trend-blocked": RELEASE_DECISION_CLOSEOUT_INDEX_TREND_EXIT.BLOCKED,
};

/**
 * The common **severity** each fired trend reason maps onto, with precedence
 * `blocking > watch > incomplete > informational` (checked in that order — higher is worse, and the run's exit code
 * follows the worst fired severity):
 *  - `informational` — a benign trend marker (the latest window `indexed` / the whole history coherent / an improving arc);
 *  - `incomplete`    — a coverage gap (zero usable windows, an unreadable window, an incomplete latest / breach);
 *  - `watch`         — an advisory / worsening posture (an open latest / breach, or a degrading arc);
 *  - `blocking`      — an untrustworthy / blocked history (a tampered window, a blocked latest / breach, a
 *                      `--strict-watch` escalation).
 */
export const RELEASE_DECISION_CLOSEOUT_INDEX_TREND_SEVERITIES = [
  "informational",
  "incomplete",
  "watch",
  "blocking",
] as const;
export type ReleaseDecisionCloseoutIndexTrendSeverity =
  (typeof RELEASE_DECISION_CLOSEOUT_INDEX_TREND_SEVERITIES)[number];

/**
 * One usable window's own index verdict → the common trend severity it contributes. A window whose OWN verdict is
 * `index-blocked` (Phase 65 concluded a closeout in its batch was tampered / blocked) is a BLOCKING trend outcome — "a
 * closeout batch could not be trusted" — NOT an untrustworthy TREND input (that is an `unreadable` / `tampered` window
 * state).
 */
export const INDEX_VERDICT_SEVERITY: Record<
  ReleaseDecisionCloseoutIndexVerdict,
  ReleaseDecisionCloseoutIndexTrendSeverity
> = {
  indexed: "informational",
  "index-incomplete": "incomplete",
  "index-open": "watch",
  "index-blocked": "blocking",
};

/**
 * The rank of a usable window's index verdict for the DIRECTION arc (higher = worse). Monotonic in exit badness over
 * the whole Phase 65 index verdict ladder so the oldest→newest arc is well-ordered: `index-open` (watch, exit 3) ranks
 * above `index-incomplete` (coverage gap, exit 2), and `index-blocked` (exit 4) is the worst.
 */
export const INDEX_VERDICT_RANK: Record<ReleaseDecisionCloseoutIndexVerdict, number> = {
  indexed: 0,
  "index-incomplete": 1,
  "index-open": 2,
  "index-blocked": 3,
};

/**
 * The bounded **direction** of the recent trend — the arc from the OLDEST usable window to the NEWEST, by index verdict
 * rank: `improving` (posture got better), `flat` (unchanged), `degrading` (got worse), or `unknown` (fewer than two
 * usable windows, so there is no arc). A bounded facet for the summary; the verdict logic consults it (a degrading arc
 * raises a `watch`).
 */
export const RELEASE_DECISION_CLOSEOUT_INDEX_TREND_DIRECTIONS = [
  "improving",
  "flat",
  "degrading",
  "unknown",
] as const;
export type ReleaseDecisionCloseoutIndexTrendDirection =
  (typeof RELEASE_DECISION_CLOSEOUT_INDEX_TREND_DIRECTIONS)[number];

/**
 * The bounded **trend class** — the single coarse classification of what the history contains, by worst-present (a
 * strict-INDEPENDENT description, so a `--strict-watch` run can be `trend-blocked` while still classing the history as
 * `watch-present`), in this severity order:
 *  - `tampered-present`   — a tampered window is present (an untrustworthy input);
 *  - `blocked-present`    — a usable window's own verdict is `index-blocked`;
 *  - `watch-present`      — a usable window's own verdict is `index-open`;
 *  - `incomplete-present` — a usable window's own verdict is `index-incomplete`, or an unreadable window is present (a
 *                           coverage gap);
 *  - `all-indexed`        — every usable window's own verdict is `indexed` (and at least one is usable), with no
 *                           unreadable / tampered window;
 *  - `no-usable`          — the history has zero usable windows (nothing to summarize).
 */
export const RELEASE_DECISION_CLOSEOUT_INDEX_TREND_CLASSES = [
  "all-indexed",
  "watch-present",
  "incomplete-present",
  "blocked-present",
  "tampered-present",
  "no-usable",
] as const;
export type ReleaseDecisionCloseoutIndexTrendClass =
  (typeof RELEASE_DECISION_CLOSEOUT_INDEX_TREND_CLASSES)[number];

/**
 * The bounded reason ids — the closed set of REASONS the trend verdict resolved as it did, emitted in this stable order
 * (a superset view, so a reviewer sees every condition that applied, not only the winning one). The per-id severity is
 * authored in {@link RELEASE_DECISION_CLOSEOUT_INDEX_TREND_REASON_DETAIL}:
 *
 * Blocking (do NOT treat the history as consistently closed):
 *  - `index-tampered`               — a considered window is recognized but its recorded index verdict does NOT re-derive;
 *  - `latest-blocked`               — the latest usable window's own verdict is `index-blocked`;
 *  - `blocked-threshold-exceeded`   — the `index-blocked` window count in the history exceeds `--max-blocked`;
 *  - `strict-watch-escalation`      — `--strict-watch` escalated an otherwise-watch trend to a hard block.
 *
 * Watch (an advisory / worsening posture):
 *  - `latest-open`                  — the latest usable window's own verdict is `index-open`;
 *  - `watch-threshold-exceeded`     — the `index-open` window count in the history exceeds `--max-watch`;
 *  - `trend-degrading`              — the newest usable window is worse than the oldest usable window (a degrading arc).
 *
 * Incomplete (a coverage gap):
 *  - `no-indexes`                   — the history has zero usable windows (nothing to summarize);
 *  - `index-unreadable`             — a considered window could not be read / recognized (a coverage gap);
 *  - `latest-incomplete`            — the latest usable window's own verdict is `index-incomplete`;
 *  - `incomplete-threshold-exceeded`— the `index-incomplete` window count in the history exceeds `--max-incomplete`.
 *
 * Informational (a benign trend marker):
 *  - `latest-indexed`               — the latest usable window's own verdict is `indexed`;
 *  - `trend-improving`              — the newest usable window is cleaner than the oldest (a recovering arc);
 *  - `history-coherent`             — every considered window is a usable `indexed` (a fully-clean history marker).
 */
export const RELEASE_DECISION_CLOSEOUT_INDEX_TREND_REASON_IDS = [
  // Blocking
  "index-tampered",
  "latest-blocked",
  "blocked-threshold-exceeded",
  "strict-watch-escalation",
  // Watch
  "latest-open",
  "watch-threshold-exceeded",
  "trend-degrading",
  // Incomplete
  "no-indexes",
  "index-unreadable",
  "latest-incomplete",
  "incomplete-threshold-exceeded",
  // Informational
  "latest-indexed",
  "trend-improving",
  "history-coherent",
] as const;
export type ReleaseDecisionCloseoutIndexTrendReasonId =
  (typeof RELEASE_DECISION_CLOSEOUT_INDEX_TREND_REASON_IDS)[number];

/**
 * The bounded next-action checklist ids — the closed set of concrete operator steps the trend can recommend, in this
 * canonical order (the checklist is emitted in this order, deduped):
 *  - `recover-tampered-indexes`      — recover the tampered closeout-index window(s) from your CI archive;
 *  - `review-blocked-indexes`        — a window is `index-blocked`; reconcile the block before treating it as closed;
 *  - `review-strict-watch`           — `--strict-watch` flagged a watch window; review it, or drop the flag if allowed;
 *  - `review-degrading-trend`        — the arc is worsening; investigate what changed between the recent windows;
 *  - `review-watch-indexes`          — an open posture is present; track the follow-up before relying on the history;
 *  - `recover-unreadable-indexes`    — recover the unreadable closeout-index window(s); a coverage gap;
 *  - `supply-closeout-indexes`       — supply more / readable `pdfxyz.release-decision-closeout-index/1` windows and re-run;
 *  - `complete-incomplete-indexes`   — a window is `index-incomplete`; complete its missing evidence and re-index;
 *  - `note-improving-trend`          — the arc recovered to a clean latest window; confirm the improvement is sustained;
 *  - `continue-indexing-closeouts`   — the history is coherent; keep indexing closeouts and summarizing on your cadence;
 *  - `keep-closeout-index-trend`     — keep this content-free trend as the local governance review SUMMARY (always). It
 *                                      is NOT a legal audit log, a compliance attestation, an external approval, an
 *                                      identity proof, or a deployment / promotion ledger.
 */
export const RELEASE_DECISION_CLOSEOUT_INDEX_TREND_CHECKLIST_IDS = [
  "recover-tampered-indexes",
  "review-blocked-indexes",
  "review-strict-watch",
  "review-degrading-trend",
  "review-watch-indexes",
  "recover-unreadable-indexes",
  "supply-closeout-indexes",
  "complete-incomplete-indexes",
  "note-improving-trend",
  "continue-indexing-closeouts",
  "keep-closeout-index-trend",
] as const;
export type ReleaseDecisionCloseoutIndexTrendChecklistId =
  (typeof RELEASE_DECISION_CLOSEOUT_INDEX_TREND_CHECKLIST_IDS)[number];

/* ------------------------------------------------------------------ *
 *  Per-window bounded facts + the reduced trend point
 * ------------------------------------------------------------------ */

/** The bounded facts reduced from a usable `pdfxyz.release-decision-closeout-index/1` (its verdict re-derived in ingest). */
export interface CloseoutIndexFacts {
  /** The window's final index verdict (trusted — the window re-derived its own verdict + counts). */
  readonly verdict: ReleaseDecisionCloseoutIndexVerdict;
  /** The window's own exit code (context; the trend has its own). */
  readonly exitCode: number;
  /** True iff `verdict === "indexed"`. */
  readonly indexed: boolean;
  /** How many closeouts the window considered (after its own window cap). */
  readonly closeoutsConsidered: number;
  /** How many of those closeouts were usable in the window. */
  readonly closeoutsUsable: number;
  /** The window's closeout-verdict distribution over its usable closeouts (all four keys present). */
  readonly closeoutVerdictCounts: Readonly<Record<ReleaseDecisionCloseoutVerdict, number>>;
  /** The window's own latest (newest) usable closeout verdict, or `null` (context; the trend keys on the index verdict). */
  readonly latestCloseout: ReleaseDecisionCloseoutVerdict | null;
  /** True iff the window was produced under `--strict-open` (context; never re-judged by the trend). */
  readonly strictOpen: boolean;
}

/**
 * One reduced window in the trend sequence — a bounded point ordered oldest → newest. Every field is a bounded enum, a
 * small integer, or app-authored prose; never a raw value from the input (not even the window's stamp).
 */
export interface ReleaseDecisionCloseoutIndexTrendPoint {
  /** 0-based position in the considered history, oldest = 0 (never the input's own stamp). */
  readonly position: number;
  /** The window's coverage state. */
  readonly state: ReleaseDecisionCloseoutIndexTrendWindowState;
  /**
   * The window's own index verdict (a bounded enum), or `null` when unreadable. Trusted only when `usable`; for a
   * `tampered` window it is the untrusted CLAIMED verdict (surfaced so the sequence shows what was asserted).
   */
  readonly verdict: ReleaseDecisionCloseoutIndexVerdict | null;
  /** The window's own latest (newest) usable closeout verdict, or `null` when not usable (context). */
  readonly latestCloseout: ReleaseDecisionCloseoutVerdict | null;
  /** The window's contribution on the common severity ladder, or `null` when not usable. */
  readonly severity: ReleaseDecisionCloseoutIndexTrendSeverity | null;
  /** How many closeouts the window considered (a bounded count; `0` when not usable). */
  readonly closeoutsConsidered: number;
  /** A one-line, content-free headline authored from the position + state + verdict. */
  readonly detail: string;
}

/**
 * The bounded history summary — how many windows were supplied / usable, the per-window index-verdict distribution, the
 * aggregate closeout distribution, and the arc direction + trend class. Every count is over the USABLE considered
 * windows (an unreadable / tampered window contributes no trusted verdict), so the summary never fabricates a posture.
 */
export interface ReleaseDecisionCloseoutIndexTrendSummary {
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
  /** The count of each index verdict across the usable considered windows (all four keys present). */
  readonly indexVerdictCounts: Readonly<Record<ReleaseDecisionCloseoutIndexVerdict, number>>;
  /** The total closeouts considered across the usable windows (a bounded sum). */
  readonly totalCloseouts: number;
  /** The total usable closeouts across the usable windows (a bounded sum). */
  readonly totalUsableCloseouts: number;
  /** The aggregate closeout distribution across the usable windows (all four keys present). */
  readonly closeoutVerdictCounts: Readonly<Record<ReleaseDecisionCloseoutVerdict, number>>;
  /** The newest usable window's index verdict, or `null` if none is usable (a coarse ordinal, never a timestamp). */
  readonly newest: ReleaseDecisionCloseoutIndexVerdict | null;
  /** The oldest usable window's index verdict, or `null` if none is usable (a coarse ordinal, never a timestamp). */
  readonly oldest: ReleaseDecisionCloseoutIndexVerdict | null;
  /** The bounded arc from oldest usable to newest usable, by index verdict rank. */
  readonly direction: ReleaseDecisionCloseoutIndexTrendDirection;
  /** The single coarse classification of what the history contains (strict-independent). */
  readonly trendClass: ReleaseDecisionCloseoutIndexTrendClass;
}

/** The bounded, applied policy knobs (from the validated args). */
export interface ReleaseDecisionCloseoutIndexTrendPolicy {
  /** The maximum number of newest windows considered (the window cap). */
  readonly maxIndexes: number;
  /** The maximum tolerated `index-open` windows in the history before the watch threshold fires (default 0). */
  readonly maxWatch: number;
  /** The maximum tolerated `index-incomplete` windows before the incomplete threshold fires (default 0). */
  readonly maxIncomplete: number;
  /** The maximum tolerated `index-blocked` windows before the blocked threshold fires (default 0). */
  readonly maxBlocked: number;
  /** True iff `--strict-watch` was set (a watch trend escalates to `trend-blocked`). */
  readonly strictWatch: boolean;
}

/** One fired reason, with its resolved severity + authored detail. */
export interface ReleaseDecisionCloseoutIndexTrendReason {
  readonly id: ReleaseDecisionCloseoutIndexTrendReasonId;
  readonly severity: ReleaseDecisionCloseoutIndexTrendSeverity;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** One next-action checklist step, with its authored detail. */
export interface ReleaseDecisionCloseoutIndexTrendChecklistItem {
  readonly id: ReleaseDecisionCloseoutIndexTrendChecklistId;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** The composite trend decision — the single verdict + exit code a governance review acts on. THE TOP-LEVEL rollup. */
export interface ReleaseDecisionCloseoutIndexTrendRollup {
  readonly verdict: ReleaseDecisionCloseoutIndexTrendVerdict;
  readonly exitCode: ReleaseDecisionCloseoutIndexTrendExitCode;
  /** True iff `verdict === "trend-stable"` (a coherent, healthy history). */
  readonly stable: boolean;
  /** The latest (newest) usable window's own index verdict, or `null` if none is usable. */
  readonly latest: ReleaseDecisionCloseoutIndexVerdict | null;
  /** The fired reason ids, in canonical order. */
  readonly reasons: readonly ReleaseDecisionCloseoutIndexTrendReasonId[];
  /** How many fired reasons were blocking. */
  readonly blocking: number;
  /** How many fired reasons were watch. */
  readonly watch: number;
  /** How many fired reasons were incomplete. */
  readonly incomplete: number;
  /** How many fired reasons were informational. */
  readonly informational: number;
  /** The reported arc direction (context; the verdict already folded it). */
  readonly direction: ReleaseDecisionCloseoutIndexTrendDirection;
  /** True iff `--strict-watch` was applied. */
  readonly strictWatch: boolean;
  /** True iff `--strict-watch` ESCALATED a watch trend to `trend-blocked`. */
  readonly strictWatchEscalated: boolean;
  /** Which verdict `--strict-watch` escalated FROM, or `null` when no escalation applied. */
  readonly strictWatchEscalatedFrom: "trend-watch" | null;
  readonly detail: string;
}

/** The stable identity block the result records (with the pinned upstream closeout-index schema). */
export interface ReleaseDecisionCloseoutIndexTrendMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_DECISION_CLOSEOUT_INDEX_TREND_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_CLOSEOUT_INDEX_TREND_POLICY_VERSION;
  readonly indexSchema: typeof RELEASE_DECISION_CLOSEOUT_INDEX_SCHEMA;
}

/**
 * The stable, content-free release decision closeout index trend a governance review / CI reads. Every field is a
 * bounded enum, a small integer, an ISO stamp, or app-authored prose — so it carries no reviewer identity, locator,
 * size, path, or byte, even from a hostile input, and never echoes an ingested window's own stamp.
 */
export interface ReleaseDecisionCloseoutIndexTrendResult {
  readonly schema: typeof RELEASE_DECISION_CLOSEOUT_INDEX_TREND_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleaseDecisionCloseoutIndexTrendMetadata;
  readonly policy: ReleaseDecisionCloseoutIndexTrendPolicy;
  readonly summary: ReleaseDecisionCloseoutIndexTrendSummary;
  /** One reduced point per considered window, ordered oldest → newest. */
  readonly points: readonly ReleaseDecisionCloseoutIndexTrendPoint[];
  /** The composite trend rollup (verdict + exit + reasons + strict flags). THE TOP-LEVEL rollup. */
  readonly closeoutIndexTrend: ReleaseDecisionCloseoutIndexTrendRollup;
  /** Every fired reason, in canonical {@link RELEASE_DECISION_CLOSEOUT_INDEX_TREND_REASON_IDS} order. */
  readonly reasons: readonly ReleaseDecisionCloseoutIndexTrendReason[];
  /** The bounded, ordered next-action checklist. Never derived from an input. */
  readonly checklist: readonly ReleaseDecisionCloseoutIndexTrendChecklistItem[];
  /** Bounded, app-authored guidance (out-of-scope steps this trend does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from any ingested window. */
  readonly caveats: readonly string[];
  /** The flattened, content-free receipt (safe to log / forward verbatim). */
  readonly receipt: ReleaseDecisionCloseoutIndexTrendReceipt;
}

/**
 * The content-free **audit receipt** the result rides alongside its body — the flattened answer to "what did this trend
 * conclude, over how many usable windows, in what distribution, with what latest" for a SIEM / review record. Bounded
 * enums + small integers + a stable policy id + the run's own stamp + a disclosure statement only; safe to log or
 * forward verbatim.
 */
export interface ReleaseDecisionCloseoutIndexTrendReceipt {
  readonly category: "worker-release-decision-closeout-index-trend";
  readonly policyId: typeof RELEASE_DECISION_CLOSEOUT_INDEX_TREND_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_CLOSEOUT_INDEX_TREND_POLICY_VERSION;
  readonly at: string;
  readonly verdict: ReleaseDecisionCloseoutIndexTrendVerdict;
  readonly exitCode: ReleaseDecisionCloseoutIndexTrendExitCode;
  /** How many window inputs were supplied. */
  readonly indexesSupplied: number;
  /** How many windows were considered after the window cap. */
  readonly indexesConsidered: number;
  /** How many considered windows are usable. */
  readonly indexesUsable: number;
  /** The count of each index verdict across the usable considered windows (all four keys present). */
  readonly indexVerdictCounts: Readonly<Record<ReleaseDecisionCloseoutIndexVerdict, number>>;
  /** The latest (newest) usable window's own index verdict, or `null` if none is usable. */
  readonly latest: ReleaseDecisionCloseoutIndexVerdict | null;
  /** The bounded arc direction. */
  readonly direction: ReleaseDecisionCloseoutIndexTrendDirection;
  /** The single coarse classification of what the history contains. */
  readonly trendClass: ReleaseDecisionCloseoutIndexTrendClass;
  /** The bounded, app-authored disclosure statement (what this trend is NOT). Never derived from an input. */
  readonly disclosure: string;
}

/** The process exit code for a trend result. */
export function releaseDecisionCloseoutIndexTrendExitCode(
  result: ReleaseDecisionCloseoutIndexTrendResult,
): number {
  return result.closeoutIndexTrend.exitCode;
}

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from any ingested window)
 * ------------------------------------------------------------------ */

/** The one-line verdict headline. Authored here, keyed by the enum. */
export const RELEASE_DECISION_CLOSEOUT_INDEX_TREND_VERDICT_SUMMARY: Record<
  ReleaseDecisionCloseoutIndexTrendVerdict,
  string
> = {
  "trend-stable":
    "TREND-STABLE: the recent closeout-index history is healthy — the latest usable window is an INDEXED index, no tampered or unreadable window is present, the watch / incomplete / blocked counts are within their thresholds, and the arc is not degrading. Keep indexing closeouts per window and summarizing them on your governance cadence. This trend authorizes nothing on its own.",
  "trend-incomplete":
    "TREND-INCOMPLETE: the closeout-index history has a COVERAGE GAP — zero usable windows were considered, a considered window was unreadable, the latest usable window is INDEX-INCOMPLETE, or the incomplete count exceeds the threshold. Complete the missing evidence or supply a readable history, then re-summarize; this is not a coherent history.",
  "trend-watch":
    "TREND-WATCH: an ADVISORY or worsening history — the latest usable window is INDEX-OPEN, the watch count exceeds the threshold, or the arc DEGRADED (the newest window is worse than the oldest). Track the open follow-up(s) and review what changed; this is not a hard block, but the history is not consistently closed either.",
  "trend-blocked":
    "TREND-BLOCKED: a BLOCKING or untrustworthy history — a considered window is tampered, the latest usable window is INDEX-BLOCKED, the blocked count exceeds the threshold, or `--strict-watch` escalated a watch trend. Do NOT treat the recent closeouts as consistently closed until the cause is resolved.",
};

/**
 * The dedicated headline for a `trend-blocked` trend produced ONLY because `--strict-watch` escalated a watch trend —
 * there was no tampered window, blocked latest, or blocked-threshold breach, so the generic headline would misrepresent
 * the cause. Authored.
 */
export const RELEASE_DECISION_CLOSEOUT_INDEX_TREND_STRICT_WATCH_ESCALATED_SUMMARY =
  "TREND-BLOCKED (--strict-watch): the only concern is a WATCH trend (an index-open latest, a watch-threshold breach, or a degrading arc), and `--strict-watch` escalates any watch trend to a hard block — a `consistently closed or blocked` gate for a high-assurance review. Without the flag this would be TREND-WATCH. No tampered window, blocked latest, or blocked-threshold breach was found.";

/** Per-reason authored detail + resolved severity, keyed by id. */
export const RELEASE_DECISION_CLOSEOUT_INDEX_TREND_REASON_DETAIL: Record<
  ReleaseDecisionCloseoutIndexTrendReasonId,
  { readonly severity: ReleaseDecisionCloseoutIndexTrendSeverity; readonly detail: string }
> = {
  "index-tampered": {
    severity: "blocking",
    detail:
      "A considered window is a recognized `pdfxyz.release-decision-closeout-index/1` whose recorded index verdict does NOT re-derive from its own recorded ledger, or whose counts disagree with its own per-record sequence — a hand-edited or corrupt window. Recover the untampered window from your CI archive; a tampered window cannot be summarized.",
  },
  "latest-blocked": {
    severity: "blocking",
    detail:
      "The latest (newest) usable window's OWN index verdict is `index-blocked` — its most recent closeout batch was tampered / blocked. The recent history is not consistently closed: reconcile the latest window's block and re-index it before relying on the history.",
  },
  "blocked-threshold-exceeded": {
    severity: "blocking",
    detail:
      "The number of `index-blocked` windows in the history exceeds `--max-blocked`. A recurring blocked window is a governance regression, not noise: reconcile the blocked windows (or raise `--max-blocked` only if the blocked history is understood and accepted) before treating the history as closed.",
  },
  "strict-watch-escalation": {
    severity: "blocking",
    detail:
      "`--strict-watch` was set and the trend would otherwise be WATCH (an index-open latest, a watch-threshold breach, or a degrading arc), so the policy escalates it to a hard block — a `consistently closed or blocked` gate for a high-assurance review. Close the open follow-up(s) / resolve the regression (or drop `--strict-watch` if a watch history is acceptable) before treating the history as closed.",
  },
  "latest-open": {
    severity: "watch",
    detail:
      "The latest (newest) usable window's OWN index verdict is `index-open` — an advisory follow-up remains open on the most recent closeout batch. Track the follow-up to closure, re-index the latest window, and re-summarize; this is not a hard block, but the history is not consistently closed.",
  },
  "watch-threshold-exceeded": {
    severity: "watch",
    detail:
      "The number of `index-open` windows in the history exceeds `--max-watch`. Recurring open postures mean the recent closeouts are not being closed out promptly: track the open follow-ups to closure (or raise `--max-watch` if a bounded open backlog is acceptable) before treating the history as consistently closed.",
  },
  "trend-degrading": {
    severity: "watch",
    detail:
      "The newest usable window's index verdict is WORSE than the oldest usable window's (a worse index posture after an earlier cleaner one) — the recent arc degraded. Investigate what changed between the recent windows before relying on the history.",
  },
  "no-indexes": {
    severity: "incomplete",
    detail:
      "The history has zero usable windows — every considered window was unreadable / tampered, or the history was empty. There is nothing to summarize; supply a bounded history of readable `pdfxyz.release-decision-closeout-index/1` windows and re-run.",
  },
  "index-unreadable": {
    severity: "incomplete",
    detail:
      "A considered window could not be read / recognized as a `pdfxyz.release-decision-closeout-index/1` (wrong schema or unparseable — never echoed), so it contributes no trusted verdict. The trend is incomplete; recover a readable closeout index produced by `worker:release-decision-closeout-index` and re-run.",
  },
  "latest-incomplete": {
    severity: "incomplete",
    detail:
      "The latest (newest) usable window's OWN index verdict is `index-incomplete` — its most recent closeout batch had a coverage gap (an unreadable closeout, an incomplete latest, or zero usable closeouts). Complete the missing evidence, re-index the latest window, and re-summarize before treating the history as closed.",
  },
  "incomplete-threshold-exceeded": {
    severity: "incomplete",
    detail:
      "The number of `index-incomplete` windows in the history exceeds `--max-incomplete`. A recurring incomplete window means recent review periods are not being fully evidenced: complete the missing evidence (or raise `--max-incomplete` if a bounded incomplete backlog is acceptable) before treating the history as consistently closed.",
  },
  "latest-indexed": {
    severity: "informational",
    detail:
      "The latest (newest) usable window's OWN index verdict is `indexed` — the most recent closeout batch read as consistently closed. This is the load-bearing marker for a `trend-stable` trend (provided the history is coherent within its thresholds and the arc is not degrading); it records a bounded review, not an approval or a promotion.",
  },
  "trend-improving": {
    severity: "informational",
    detail:
      "The newest usable window's index verdict is CLEANER than the oldest usable window's (a recovering arc) — the recent closeout-index postures improved. Note the improvement and confirm it is sustained across the next windows; this trend authorizes nothing on its own.",
  },
  "history-coherent": {
    severity: "informational",
    detail:
      "Every considered window is a usable `indexed` index — the whole recent history reads as consistently closed, with no unreadable / tampered / open / incomplete / blocked window. Keep the underlying closeout indexes on your governance cadence.",
  },
};

/** Per-checklist authored detail, keyed by id. */
export const RELEASE_DECISION_CLOSEOUT_INDEX_TREND_CHECKLIST_DETAIL: Record<
  ReleaseDecisionCloseoutIndexTrendChecklistId,
  string
> = {
  "recover-tampered-indexes":
    "Recover the tampered closeout-index window(s) from your CI archive: a window whose recorded index verdict does not re-derive from its own recorded ledger, or whose counts disagree with its own sequence, means the trend input was hand-edited or corrupt and cannot be trusted.",
  "review-blocked-indexes":
    "A window in the history is `index-blocked` (its closeout batch was tampered / blocked, or `--strict-watch` escalated a watch one): do NOT treat that review period as consistently closed. Reconcile the block and re-index that window before relying on the history.",
  "review-strict-watch":
    "`--strict-watch` flagged a watch trend (an index-open latest, a watch-threshold breach, or a degrading arc): the policy requires the history to be consistently closed. Review the flagged window(s) and resolve the concern, or drop `--strict-watch` if a watch history is acceptable for this review, before relying on the history.",
  "review-degrading-trend":
    "The recent arc is worsening (the newest window is worse than the earliest usable window): investigate what changed between the recent review periods and resolve the regression before relying on the history. Archive this trend as the record of that review.",
  "review-watch-indexes":
    "A window in the history is `index-open` (an advisory follow-up still open): track the recorded follow-up to closure, re-index that window, and re-summarize before relying on the history. Archive this trend as the record of that review.",
  "recover-unreadable-indexes":
    "Recover the unreadable closeout-index window(s): a window that cannot be read / recognized as a `pdfxyz.release-decision-closeout-index/1` is a coverage gap in the trend. Recover a valid closeout index produced by `worker:release-decision-closeout-index` and re-run.",
  "supply-closeout-indexes":
    "Supply more / readable content-free `pdfxyz.release-decision-closeout-index/1` windows (a bounded history, oldest first) and re-run this trend: an unreadable or empty history cannot be summarized.",
  "complete-incomplete-indexes":
    "A window in the history is `index-incomplete` (a coverage gap in its closeout batch): complete the missing evidence with `worker:release-decision-closeout` / `worker:release-decision-closeout-index`, re-index that window, and re-summarize.",
  "note-improving-trend":
    "The recent arc recovered to a clean latest window: note the improvement and confirm it is sustained across the next windows. Keep indexing closeouts and summarizing them here; this trend authorizes no promotion on its own.",
  "continue-indexing-closeouts":
    "The history is coherent: keep filing one `worker:release-decision-closeout-index` window per review period and summarizing them here on your governance cadence. This trend authorizes no promotion on its own.",
  "keep-closeout-index-trend":
    "Keep this content-free trend as the local release-decision-closeout-index governance review SUMMARY. It is NOT a legal audit log, a compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger; keep those separately.",
};

/** The bounded, app-authored disclosure statement the receipt + text render carry (what this trend is NOT). */
export const RELEASE_DECISION_CLOSEOUT_INDEX_TREND_DISCLOSURE =
  "This is a content-free closeout-index TREND SUMMARY ONLY — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It ingests a bounded history of previously produced closeout-index summaries and records whether the recent release decision closeouts trended consistently closed; it authorizes and proves nothing, and it attests no person's identity.";

/**
 * The honesty caveats every result carries and every text render prints. The trend SUMMARIZES a bounded history of the
 * chain's already content-free closeout-index windows, RE-VALIDATES each one's self-consistency, and rolls them up into
 * one trend verdict; it must never be read as more than that.
 */
export const RELEASE_DECISION_CLOSEOUT_INDEX_TREND_CAVEATS: readonly string[] = [
  "This is a RELEASE DECISION CLOSEOUT INDEX TREND SUMMARY: it INGESTS a bounded history of content-free `pdfxyz.release-decision-closeout-index/1` windows a release pipeline produced, RE-VALIDATES each against ITSELF, and folds them into ONE bounded trend verdict + follow-up checklist. It is a local content-free closeout-index TREND SUMMARY over closeout-index windows — NOT a legal audit log, a compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger.",
  "It is offline and READ-ONLY: it makes NO network call, reads NO secret, bucket, or object, RUNS no gate / index / decision / trend / plan / receipt / closeout itself, and NEVER signs, approves, publishes, promotes, deploys, notifies, deletes, prunes, uploads, or mutates any window, record, artifact, object, or deployment. A `trend-stable` trend authorizes nothing; it only reports that the content-free closeout-index windows supplied on THIS host trended consistently closed over the review history.",
  "A `trend-stable` trend REQUIRES a coherent bounded history: the latest usable window an `indexed` index, no tampered / unreadable window, the watch / incomplete / blocked counts within their thresholds, and a non-degrading arc. It FAILS CLOSED: a tampered window, an `index-blocked` latest / threshold breach, or a `--strict-watch` escalation makes the trend `trend-blocked`; an `index-open` latest / threshold breach or a degrading arc makes it `trend-watch`; an unreadable window, an `index-incomplete` latest / threshold breach, or zero usable windows makes it `trend-incomplete`. It never fabricates a clean trend from thin or untrusted history.",
  "It re-derives each ingested window's index verdict from the window's OWN recorded ledger (reusing the Phase 65 rollup reducer) AND re-checks those counts against the window's own per-record sequence + window arithmetic, and treats any disagreement as a TAMPER (`trend-blocked`). This re-derivation is TAMPER-EVIDENCE over content-free data, NOT a cryptographic signature — there is no signing key and no attested identity, so the trend proves neither authorship nor approval, and a set of fully self-consistent fabricated windows is out of its scope.",
  "It emits only bounded enums, small counts, an ISO stamp, and app-authored prose — so it carries no reviewer name or email, no filename, path, object key, bucket, URL, endpoint, region, job / user id, IP, token, raw ref, raw label, raw note, commit URL, size, byte, or digest, even from a hostile input; it never echoes an ingested window's own stamp, and it never echoes an input file path, even on an error.",
  "It is not malware scanning, sanitization, authorization, cloud validation, or deletion proof of any request or object, and it deletes, uploads, promotes, approves, or mutates nothing.",
];

/**
 * Out-of-band reminders the trend carries but does NOT itself perform — the honest edges of an offline summarizer.
 * Authored, bounded, content-free; never derived from an input.
 */
export const RELEASE_DECISION_CLOSEOUT_INDEX_TREND_GUIDANCE: readonly string[] = [
  "Wire this as a SCHEDULED or on-demand GOVERNANCE summary (per quarter / half-year), NOT a per-release gate: run `worker:release-decision-closeout-index` per review window and archive each window, then hand a bounded history (oldest first, newest last) here and render `--text` into a review artifact / `$GITHUB_STEP_SUMMARY`. Fail the review on exit 4 (a blocked / untrustworthy history), surface exit 3 (a watch / degrading history) and exit 2 (an incomplete history) for review, and treat exit 0 (a coherent history) as consistently closed — never as an authorization.",
  "Keep the history bounded and explicit: `--max-indexes=N` caps the newest N windows (older windows are dropped from the history, and the count dropped is surfaced, never silent); `--max-watch=N` / `--max-incomplete=N` / `--max-blocked=N` (each default 0) tolerate a bounded number of non-`indexed` windows before the accumulation escalates; `--strict-watch` escalates any watch trend to a hard block for a high-assurance review. Direction is derived from ORDERED INPUT POSITIONS (oldest first, newest last), never from any ingested timestamp.",
  "Archive this trend (and the underlying closeout-index windows) as CI artifacts: it is a content-free governance SUMMARY, not a substitute for the windows it summarizes, nor for your legal audit trail, compliance log, external approval / signing, storage retention, or release-promotion processes — keep each of those in its own dedicated system.",
  "Enforce promotion out of band: this trend SUMMARIZES a history of the content-free closeout-index windows supplied, but recording a legal audit trail, obtaining an external approval / signature, proving reviewer identity, and promoting a deployment are operator / CI / legal actions this offline summarizer never performs.",
];
