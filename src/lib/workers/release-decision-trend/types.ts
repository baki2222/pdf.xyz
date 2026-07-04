/**
 * The bounded, content-free vocabulary for the secure-worker **release decision index trend summary** (Phase 61).
 *
 * Phases 46–60 built the release-evidence chain, one rung per phase: the release readiness gate folds the content-free
 * worker checks into ONE promotion verdict; the release artifact stamps it with bounded provenance + an integrity
 * digest; the release index re-verifies many artifacts into a retention manifest; the release policy asserts bounded
 * operator thresholds; the release CI bundle composes a single job's stage outputs; the release audit diffs a baseline
 * bundle against a current one; the operator report folds a bundle + audit into ONE recommendation; the trend summary
 * summarizes a bounded HISTORY of those reports; the governance bundle composes a trend + latest report / audit; the
 * archive pack, restore drill, publish / handoff pack, and handoff acknowledgement carry the evidence through
 * archival, recoverability, hand-off, and receipt; the release DECISION record composes a publish pack + its
 * acknowledgement into ONE bounded decision; and the release DECISION LEDGER INDEX (`pdfxyz.release-decision-index/1`,
 * Phase 60) folds a bounded BATCH of those decision records into ONE ledger index verdict + decision distribution for
 * a single review window (a sprint / month of decisions).
 *
 * This phase closes the *governance review* loop over a BOUNDED HISTORY of those decision-index windows. It INGESTS
 * one or more `pdfxyz.release-decision-index/1` documents (a quarter / year of weekly or monthly ledger windows),
 * RE-VALIDATES each against ITSELF (re-deriving its Phase 60 index verdict from its own recorded counts AND checking
 * the recorded counts against the window's own per-record sequence, so a hand-flipped index is caught as a tamper),
 * and folds them into ONE stable, content-free `pdfxyz.release-decision-trend/1` summary that answers a single
 * question a periodic release-governance review needs —
 *
 *    "Over the recent history of release-decision ledger windows on this host, are the decisions improving, stable,
 *     or degrading, is anything blocking / inconclusive / untrustworthy, and what bounded operator follow-up is
 *     warranted?"
 *
 * — with a bounded trend verdict + direction, a per-window verdict distribution, an aggregate decision distribution,
 * a per-window posture sequence, a bounded rationale, and a bounded next-action checklist, and it FAILS CLOSED when a
 * window cannot be trusted or the history is insufficient.
 *
 * It obeys the same honesty contract as the rest of the worker layer and is as content-free as the windows it
 * summarizes:
 *  - Every load-bearing token here is a bounded enum — a window state, an index verdict, a trend verdict, a direction,
 *    a trend class, a severity, a reason id, a checklist id — never a filename, path, object key, bucket, URL,
 *    endpoint, region, id, token, size, byte, raw ref, raw label, reviewer identity, commit URL, or digest. The only
 *    non-enum values are small integer counts, an ISO stamp, and app-authored prose.
 *  - It never copies a free-text field out of an ingested window (each — even one Phase 60 produced — is UNTRUSTED
 *    input here); it reduces every window to bounded enums, small integers, or booleans, it never echoes an ingested
 *    window's OWN stamp (the trend carries only its own), and it never echoes an input file path, even on an error.
 *  - It never fabricates a clean pass. `stable` / `improving` REQUIRE a clean bounded history: no tampered /
 *    unreadable window and (for `stable`) every usable window a clean `stable` index. A tampered / unreadable window
 *    makes the trend `invalid`; a `blocked` / `invalid` window (or a `--strict` violation) makes it `blocked`; zero
 *    usable windows or an only-`insufficient` history is `insufficient`; a degrading / watch arc is `degrading` /
 *    `watch`.
 *
 * It is deliberately NOT a new evidence rung, NOT a legal audit trail, NOT a compliance attestation, NOT an external
 * signature, NOT an identity ledger, NOT storage-retention ENFORCEMENT, and NOT a deployment / promotion ledger. It
 * PROVES nothing the windows do not already prove; it SUMMARIZES a bounded history of their content-free index
 * verdicts + decision distributions, RE-VALIDATES each one's self-consistency, and rolls them up into one trend
 * verdict + follow-up checklist. Its authored caveats (see {@link RELEASE_DECISION_TREND_CAVEATS}) say so out loud: it
 * is a local content-free ledger-index TREND SUMMARY over decision-index windows — not a legal audit log, a compliance
 * attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger.
 */

import {
  RELEASE_DECISION_DECISIONS,
  RELEASE_DECISION_INDEX_SCHEMA,
  RELEASE_DECISION_INDEX_VERDICTS,
  type ReleaseDecisionDecision,
  type ReleaseDecisionIndexTrendClass,
  type ReleaseDecisionIndexVerdict,
} from "../release-decision-index/types";

/** The schema tag every release-decision-trend result carries, so tooling can pin the shape it parses. */
export const RELEASE_DECISION_TREND_SCHEMA = "pdfxyz.release-decision-trend/1" as const;

/** The upstream document schema the trend ingests. Re-exported so the result can pin its input shape. */
export { RELEASE_DECISION_INDEX_SCHEMA };

/** Stable identity of the release-decision-trend — for docs / receipts / audit. */
export const RELEASE_DECISION_TREND_POLICY_ID = "pdfxyz-worker-release-decision-trend";
/** Bump when the trend surface, the verdict ladder, the reason / checklist / trend-class sets, or the schema changes. */
export const RELEASE_DECISION_TREND_POLICY_VERSION = 1;

/** The upstream index verdicts the trend tallies per window, re-exported for convenience. */
export { RELEASE_DECISION_INDEX_VERDICTS, RELEASE_DECISION_DECISIONS };
export type { ReleaseDecisionIndexVerdict, ReleaseDecisionDecision, ReleaseDecisionIndexTrendClass };

/** The default window cap: the newest N windows considered when `--max-windows` is not given. */
export const DEFAULT_MAX_WINDOWS = 26;

/**
 * The bounded coverage state of one ingested decision-index window — every supplied `--file` / `--window` / stdin
 * element is SUPPLIED, so a window is one of:
 *  - `unreadable` — an element was supplied but could not be read / parsed / recognized as a
 *                   `pdfxyz.release-decision-index/1` (never echoed). It certifies nothing → INVALID input;
 *  - `tampered`   — recognized as a decision index but its recorded index verdict does NOT re-derive from its own
 *                   recorded ledger counts, or those counts disagree with the window's own per-record sequence (a
 *                   hand-edited / corrupt window) → INVALID input;
 *  - `usable`     — recognized AND self-consistent (its recorded index verdict re-derives, and its counts match its
 *                   sequence): trustworthy.
 */
export const RELEASE_DECISION_TREND_WINDOW_STATES = ["unreadable", "tampered", "usable"] as const;
export type ReleaseDecisionTrendWindowState = (typeof RELEASE_DECISION_TREND_WINDOW_STATES)[number];

/**
 * The single trend verdict a governance review keys on — the answer to "how are the recent decision windows, and is
 * follow-up warranted?":
 *  - `improving`    — a clean bounded history whose LATEST window is a clean `stable` index and at least one EARLIER
 *                     window was worse (a `watch` / `insufficient` index): the decisions recovered to clean;
 *  - `stable`       — a clean bounded history: no tampered / unreadable window, and EVERY usable window is a clean
 *                     `stable` index. The recent decision windows are healthy;
 *  - `watch`        — no blocker / untrustworthy input and the history is sufficient, but an ADVISORY concern is
 *                     present: a usable window is a `watch` / `insufficient` index (flat / mixed, not degrading);
 *  - `degrading`    — no blocker / untrustworthy input, but the LATEST window is WORSE than the earliest usable window
 *                     (a `watch` / `insufficient` index after an earlier cleaner one). The arc is worsening;
 *  - `insufficient` — the history is INCONCLUSIVE: zero usable windows were considered, or every usable window is an
 *                     `insufficient` index. Fail-closed, not a clean pass;
 *  - `blocked`      — a BLOCKING window is present: a usable window is a `blocked` / `invalid` index (its decision
 *                     batch was rejected / untrustworthy), or `--strict` escalated a non-clean history;
 *  - `invalid`      — an untrustworthy INPUT: a supplied window was unreadable or is recognized-but-self-inconsistent
 *                     (a tamper). The trend itself cannot be trusted until the window is recovered. Dominates.
 *
 * These are the exact bounded values the run-level `worker_release_decision_trend_total` metric carries as its
 * `verdict` label; all seven are low-cardinality, redaction-stable tokens.
 */
export const RELEASE_DECISION_TREND_VERDICTS = [
  "improving",
  "stable",
  "watch",
  "degrading",
  "insufficient",
  "blocked",
  "invalid",
] as const;
export type ReleaseDecisionTrendVerdict = (typeof RELEASE_DECISION_TREND_VERDICTS)[number];

/**
 * The exit-code ladder a CI / governance job routes on — the same shape as the whole release-evidence suite so the
 * tools speak one language:
 *  - `0` CLEAR        — a clean, healthy history (`improving` or `stable`);
 *  - `1` USAGE        — the CLI was misused (a bad flag, no window supplied, or an unwritable output). CLI-owned; a
 *                       trend RUN never resolves to it;
 *  - `2` INSUFFICIENT — the history was inconclusive (zero usable windows, or an only-insufficient history);
 *  - `3` WATCH        — an advisory / worsening history (`watch` or `degrading`);
 *  - `4` BLOCKED      — a blocking window (a `blocked` / `invalid` index, or a strict violation);
 *  - `4` INVALID      — an untrustworthy input (an unreadable / tampered window).
 *
 * `improving` and `stable` share the clean code `0` (both are healthy — the arc detail distinguishes them);
 * `watch` and `degrading` share the advisory code `3` (both warrant review — `degrading` is the worsening arc);
 * `insufficient` (2) sorts before the advisory band (3) exactly like the rest of the suite folds insufficiency before
 * advisory; and `blocked` / `invalid` share the top code `4` but are distinct verdicts (a rejected / untrustworthy
 * WINDOW in a VALID input vs an untrustworthy / unreadable INPUT).
 */
export const RELEASE_DECISION_TREND_EXIT = {
  CLEAR: 0,
  USAGE: 1,
  INSUFFICIENT: 2,
  WATCH: 3,
  BLOCKED: 4,
  INVALID: 4,
} as const;
export type ReleaseDecisionTrendExitCode =
  (typeof RELEASE_DECISION_TREND_EXIT)[keyof typeof RELEASE_DECISION_TREND_EXIT];

/** The authoritative verdict → exit code map. */
export const RELEASE_DECISION_TREND_EXIT_FOR_VERDICT: Record<
  ReleaseDecisionTrendVerdict,
  ReleaseDecisionTrendExitCode
> = {
  improving: RELEASE_DECISION_TREND_EXIT.CLEAR,
  stable: RELEASE_DECISION_TREND_EXIT.CLEAR,
  watch: RELEASE_DECISION_TREND_EXIT.WATCH,
  degrading: RELEASE_DECISION_TREND_EXIT.WATCH,
  insufficient: RELEASE_DECISION_TREND_EXIT.INSUFFICIENT,
  blocked: RELEASE_DECISION_TREND_EXIT.BLOCKED,
  invalid: RELEASE_DECISION_TREND_EXIT.INVALID,
};

/**
 * The common **severity** each usable window's index verdict, and each fired trend reason, maps onto so the trend can
 * fold a history of window verdicts + coverage states into one trend verdict, with precedence
 * `invalid > blocking > insufficient > advisory > ready` (checked in that order — so an untrustworthy input never
 * masquerades as a mere blocker, an insufficiency never as an advisory, and a real blocker is never masked):
 *  - `ready`        — a usable window that is a clean `stable` index (best);
 *  - `advisory`     — a usable window that is a `watch` index, or an advisory reason (a degrading arc);
 *  - `insufficient` — a usable window that is an `insufficient` index, or zero usable windows;
 *  - `blocking`     — a usable window that is a `blocked` / `invalid` index (a blocking window outcome);
 *  - `invalid`      — an unreadable / tampered window (an untrustworthy input, worst).
 */
export const RELEASE_DECISION_TREND_SEVERITIES = [
  "ready",
  "advisory",
  "insufficient",
  "blocking",
  "invalid",
] as const;
export type ReleaseDecisionTrendSeverity = (typeof RELEASE_DECISION_TREND_SEVERITIES)[number];

/** The severity rank (higher = worse) — used for the reason-count buckets. */
export const RELEASE_DECISION_TREND_SEVERITY_RANK: Record<ReleaseDecisionTrendSeverity, number> = {
  ready: 0,
  advisory: 1,
  insufficient: 2,
  blocking: 3,
  invalid: 4,
};

/**
 * A usable window's own index verdict → common trend severity. A window whose OWN verdict is `invalid` (Phase 60
 * concluded a record in its batch was untrustworthy) is a BLOCKING trend outcome — "a decision batch could not be
 * trusted" — NOT an untrustworthy TREND input (that is an `unreadable` / `tampered` window state, the `invalid` band).
 */
export const WINDOW_VERDICT_SEVERITY: Record<ReleaseDecisionIndexVerdict, ReleaseDecisionTrendSeverity> = {
  stable: "ready",
  watch: "advisory",
  insufficient: "insufficient",
  blocked: "blocking",
  invalid: "blocking",
};

/**
 * The rank of a usable window's index verdict for the DIRECTION arc (higher = worse). Monotonic over the whole index
 * verdict ladder so the oldest→newest arc is well-ordered even when a blocking window is present: a `blocked` window
 * ranks above `insufficient`, and an `invalid` window (Phase 60's worst) ranks above `blocked`.
 */
export const WINDOW_VERDICT_RANK: Record<ReleaseDecisionIndexVerdict, number> = {
  stable: 0,
  watch: 1,
  insufficient: 2,
  blocked: 3,
  invalid: 4,
};

/**
 * The bounded **direction** of the recent trend — the arc from the OLDEST usable window to the NEWEST, by index
 * verdict rank: `improving` (posture got better), `flat` (unchanged), `degrading` (got worse), or `unknown` (fewer
 * than two usable windows, so there is no arc). A bounded facet for the summary; the verdict logic consults it (with
 * the newest window's cleanliness) to split `improving` / `stable` / `watch` / `degrading`.
 */
export const RELEASE_DECISION_TREND_DIRECTIONS = ["improving", "flat", "degrading", "unknown"] as const;
export type ReleaseDecisionTrendDirection = (typeof RELEASE_DECISION_TREND_DIRECTIONS)[number];

/**
 * The bounded **trend class** — the single coarse classification of what the history contains, by worst-present +
 * cross-window pressure, in this precedence (a strict-INDEPENDENT description, so a `--strict` run can be `blocked`
 * while still classing the history as `stable-watch`):
 *  - `invalid-input`         — an unreadable / tampered window is present (an untrustworthy input);
 *  - `rejection-present`     — a usable window is a `blocked` / `invalid` index, or a `reject` / `invalid` decision is
 *                              present in the aggregate distribution (a rejected / untrustworthy decision batch);
 *  - `insufficient-evidence` — zero usable windows, or every usable window is an `insufficient` index;
 *  - `hold-rising`           — `hold` decisions rose across the window sequence (the newest usable window recorded
 *                              more holds than the oldest usable window);
 *  - `followup-rising`       — `proceed-with-followup` decisions rose across the window sequence;
 *  - `improving`             — the arc improved (the newest usable window's index verdict is cleaner than the oldest);
 *  - `stable-watch`          — a `watch` window, or a `hold` / `proceed-with-followup` decision, is present (a standing
 *                              advisory, flat);
 *  - `all-clear`             — every usable window is a clean `stable` index and every decision a clean `proceed`.
 */
export const RELEASE_DECISION_TREND_CLASSES = [
  "all-clear",
  "improving",
  "stable-watch",
  "followup-rising",
  "hold-rising",
  "rejection-present",
  "insufficient-evidence",
  "invalid-input",
] as const;
export type ReleaseDecisionTrendClass = (typeof RELEASE_DECISION_TREND_CLASSES)[number];

/**
 * The bounded reason ids — the closed set of REASONS the trend verdict resolved as it did, emitted in this stable
 * order (a superset view, so a reviewer sees every condition that applied, not only the winning one). The per-id
 * severity is authored in {@link RELEASE_DECISION_TREND_REASON_DETAIL}:
 *
 * Invalid input (a window can't be trusted):
 *  - `window-unreadable`     — a supplied window could not be read / recognized as a `pdfxyz.release-decision-index/1`;
 *  - `window-tampered`       — a supplied window is recognized but its index verdict / counts do NOT re-derive.
 *
 * Blocking (a decision batch was not / must not be trusted):
 *  - `window-blocked`        — a usable window is a `blocked` index (a rejected / invalid decision in its batch);
 *  - `window-invalid`        — a usable window is an `invalid` index (an unreadable / tampered record in its batch);
 *  - `strict-nonclean`       — `--strict` was set and a non-`stable` usable window is present (an escalated block).
 *
 * Insufficient (the history is inconclusive):
 *  - `no-usable-windows`     — the history has zero usable windows (nothing to summarize);
 *  - `only-insufficient`     — every usable window is an `insufficient` index (only inconclusive evidence).
 *
 * Advisory (a worsening arc or a standing concern):
 *  - `trend-degrading`       — the newest usable window is worse than the oldest usable window (a degrading arc);
 *  - `window-watch`          — a usable window is a `watch` index (an advisory concern);
 *  - `window-insufficient`   — a usable window is an `insufficient` index while others are cleaner (a coverage gap).
 */
export const RELEASE_DECISION_TREND_REASON_IDS = [
  // Invalid input
  "window-unreadable",
  "window-tampered",
  // Blocking
  "window-blocked",
  "window-invalid",
  "strict-nonclean",
  // Insufficient
  "no-usable-windows",
  "only-insufficient",
  // Advisory
  "trend-degrading",
  "window-watch",
  "window-insufficient",
] as const;
export type ReleaseDecisionTrendReasonId = (typeof RELEASE_DECISION_TREND_REASON_IDS)[number];

/**
 * The bounded next-action checklist ids — the closed set of concrete operator steps the trend can recommend, in this
 * canonical order (the checklist is emitted in this order, deduped):
 *  - `recover-invalid-windows`     — recover the unreadable / tampered decision-index window(s) from your CI archive;
 *  - `review-blocked-windows`      — a window is `blocked` / `invalid`; do NOT treat those decision batches as clean;
 *  - `review-strict-nonclean`      — `--strict` flagged a non-stable window; review it, or drop `--strict` if allowed;
 *  - `supply-decision-indexes`     — supply more / readable `pdfxyz.release-decision-index/1` windows and re-run;
 *  - `complete-insufficient-windows` — a window is inconclusive; complete its missing decision evidence and re-index;
 *  - `review-degrading-trend`      — the arc is worsening; investigate what changed between the recent windows;
 *  - `review-watch-windows`        — a watch window is present; track the follow-up before relying on the history;
 *  - `note-improving-trend`        — the arc recovered to a clean latest window; confirm the improvement is sustained;
 *  - `continue-indexing-decisions` — the history is clean; keep indexing decisions and summarizing on your cadence;
 *  - `keep-decision-trend`         — keep this content-free trend as the local governance review SUMMARY (always). It
 *                                    is NOT a legal audit log, a compliance attestation, an external approval, an
 *                                    identity proof, or a deployment / promotion ledger.
 */
export const RELEASE_DECISION_TREND_CHECKLIST_IDS = [
  "recover-invalid-windows",
  "review-blocked-windows",
  "review-strict-nonclean",
  "supply-decision-indexes",
  "complete-insufficient-windows",
  "review-degrading-trend",
  "review-watch-windows",
  "note-improving-trend",
  "continue-indexing-decisions",
  "keep-decision-trend",
] as const;
export type ReleaseDecisionTrendChecklistId = (typeof RELEASE_DECISION_TREND_CHECKLIST_IDS)[number];

/* ------------------------------------------------------------------ *
 *  Per-window bounded facts + the reduced trend point
 * ------------------------------------------------------------------ */

/** The bounded facts reduced from a usable `pdfxyz.release-decision-index/1` (its verdict re-derived in ingest). */
export interface DecisionIndexFacts {
  /** The window's final index verdict (trusted — the window re-derived its own verdict + counts). */
  readonly verdict: ReleaseDecisionIndexVerdict;
  /** The window's own exit code (context; the trend has its own). */
  readonly exitCode: number;
  /** True iff `verdict === "stable"`. */
  readonly stable: boolean;
  /** How many records the window considered (after its own window cap). */
  readonly recordsConsidered: number;
  /** How many of those records were usable in the window. */
  readonly recordsUsable: number;
  /** The window's decision distribution over its usable records (all six keys present). */
  readonly decisionCounts: Readonly<Record<ReleaseDecisionDecision, number>>;
  /** The window's own coarse class (context; the trend derives its own). */
  readonly windowTrendClass: ReleaseDecisionIndexTrendClass;
  /** True iff the window was produced under `--strict` (context; never re-judged by the trend). */
  readonly strict: boolean;
}

/**
 * One reduced window in the trend sequence — a bounded point ordered oldest → newest. Every field is a bounded enum,
 * a small integer, or app-authored prose; never a raw value from the input (not even the window's stamp).
 */
export interface ReleaseDecisionTrendPoint {
  /** 0-based position in the considered history, oldest = 0 (never the input's own stamp). */
  readonly position: number;
  /** The window's coverage state. */
  readonly state: ReleaseDecisionTrendWindowState;
  /**
   * The window's own index verdict (a bounded enum), or `null` when unreadable. Trusted only when `usable`; for a
   * `tampered` window it is the untrusted CLAIMED verdict (surfaced so the sequence shows what was asserted).
   */
  readonly verdict: ReleaseDecisionIndexVerdict | null;
  /** The window's contribution on the common severity ladder, or `null` when not usable. */
  readonly severity: ReleaseDecisionTrendSeverity | null;
  /** How many records the window considered (a bounded count; `0` when not usable). */
  readonly recordsConsidered: number;
  /** A one-line, content-free headline authored from the position + state + verdict. */
  readonly detail: string;
}

/**
 * The bounded history summary — how many windows were supplied / usable, the per-window index-verdict distribution,
 * the aggregate decision distribution, and the arc direction + trend class. Every count is over the USABLE considered
 * windows (an unreadable / tampered window contributes no trusted verdict), so the summary never fabricates a posture.
 */
export interface ReleaseDecisionTrendSummary {
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
  /** How many considered windows were unreadable (not recognized as a decision index). */
  readonly windowsUnreadable: number;
  /** How many considered windows were tampered (recognized but self-inconsistent). */
  readonly windowsTampered: number;
  /** The count of each index verdict across the usable considered windows (all five keys present). */
  readonly windowVerdictCounts: Readonly<Record<ReleaseDecisionIndexVerdict, number>>;
  /** The total records considered across the usable windows (a bounded sum). */
  readonly totalRecords: number;
  /** The total usable records across the usable windows (a bounded sum). */
  readonly totalUsableRecords: number;
  /** The aggregate decision distribution across the usable windows (all six keys present). */
  readonly decisionCounts: Readonly<Record<ReleaseDecisionDecision, number>>;
  /** The newest usable window's index verdict, or `null` if none is usable (a coarse ordinal, never a timestamp). */
  readonly newest: ReleaseDecisionIndexVerdict | null;
  /** The oldest usable window's index verdict, or `null` if none is usable (a coarse ordinal, never a timestamp). */
  readonly oldest: ReleaseDecisionIndexVerdict | null;
  /** The bounded arc from oldest usable to newest usable, by index verdict rank. */
  readonly direction: ReleaseDecisionTrendDirection;
  /** The single coarse classification of what the history contains (strict-independent). */
  readonly trendClass: ReleaseDecisionTrendClass;
}

/** The bounded, applied policy knobs (from the validated args). */
export interface ReleaseDecisionTrendPolicy {
  /** The maximum number of newest windows considered (the window cap). */
  readonly maxWindows: number;
  /** True iff `--strict` was set (any non-`stable` window escalates the trend to `blocked`). */
  readonly strict: boolean;
}

/** One fired reason, with its resolved severity + authored detail. */
export interface ReleaseDecisionTrendReason {
  readonly id: ReleaseDecisionTrendReasonId;
  readonly severity: ReleaseDecisionTrendSeverity;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** One next-action checklist step, with its authored detail. */
export interface ReleaseDecisionTrendChecklistItem {
  readonly id: ReleaseDecisionTrendChecklistId;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** The composite trend decision — the single verdict + exit code a governance review acts on. */
export interface ReleaseDecisionTrendRollup {
  readonly verdict: ReleaseDecisionTrendVerdict;
  readonly exitCode: ReleaseDecisionTrendExitCode;
  /** True iff `verdict === "stable"` or `verdict === "improving"` (a clean, healthy history). */
  readonly clear: boolean;
  /** The fired reason ids, in canonical order (empty on a clean stable history). */
  readonly reasons: readonly ReleaseDecisionTrendReasonId[];
  /** How many fired reasons were invalid-input. */
  readonly invalidInputs: number;
  /** How many fired reasons were blocking. */
  readonly blocking: number;
  /** How many fired reasons were insufficiencies. */
  readonly insufficiencies: number;
  /** How many fired reasons were advisory. */
  readonly advisories: number;
  /** The reported arc direction (context; the verdict already folded it). */
  readonly direction: ReleaseDecisionTrendDirection;
  /** True iff `--strict` was applied. */
  readonly strict: boolean;
  /**
   * True iff `--strict` ESCALATED a non-clean history (a `watch` / `degrading` / `improving` / `insufficient` trend)
   * to `blocked`. Surfaced so the summary explains the escalation (the trend would be that verdict without the flag).
   */
  readonly strictEscalated: boolean;
  /** Which verdict `--strict` escalated FROM, or `null` when no escalation applied. */
  readonly strictEscalatedFrom: "watch" | "degrading" | "improving" | "insufficient" | null;
  readonly detail: string;
}

/** The stable identity block the result records (with the pinned upstream decision-index schema). */
export interface ReleaseDecisionTrendMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_DECISION_TREND_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_TREND_POLICY_VERSION;
  readonly indexSchema: typeof RELEASE_DECISION_INDEX_SCHEMA;
}

/**
 * The stable, content-free release decision index trend summary a governance review / CI reads. Every field is a
 * bounded enum, a small integer, an ISO stamp, or app-authored prose — so it carries no reviewer identity, locator,
 * size, path, or byte, even from a hostile input, and never echoes an ingested window's own stamp.
 */
export interface ReleaseDecisionTrendResult {
  readonly schema: typeof RELEASE_DECISION_TREND_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleaseDecisionTrendMetadata;
  readonly policy: ReleaseDecisionTrendPolicy;
  readonly summary: ReleaseDecisionTrendSummary;
  /** One reduced point per considered window, ordered oldest → newest. */
  readonly points: readonly ReleaseDecisionTrendPoint[];
  readonly trend: ReleaseDecisionTrendRollup;
  /** Every fired reason, in canonical {@link RELEASE_DECISION_TREND_REASON_IDS} order. */
  readonly reasons: readonly ReleaseDecisionTrendReason[];
  /** The bounded, ordered next-action checklist. Never derived from an input. */
  readonly checklist: readonly ReleaseDecisionTrendChecklistItem[];
  /** Bounded, app-authored guidance (out-of-scope steps this trend does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from any ingested window. */
  readonly caveats: readonly string[];
  /** The flattened, content-free receipt (safe to log / forward verbatim). */
  readonly receipt: ReleaseDecisionTrendReceipt;
}

/**
 * The content-free **audit receipt** the result rides alongside its body — the flattened answer to "what did this
 * trend conclude, over how many usable windows, and in what verdict / decision distribution" for a SIEM / review
 * record. Bounded enums + small integers + a stable policy id + the run's own stamp only (trend verdict + window count
 * + aggregate decision counts); safe to log or forward verbatim.
 */
export interface ReleaseDecisionTrendReceipt {
  readonly category: "worker-release-decision-trend";
  readonly policyId: typeof RELEASE_DECISION_TREND_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_TREND_POLICY_VERSION;
  readonly at: string;
  readonly verdict: ReleaseDecisionTrendVerdict;
  readonly exitCode: ReleaseDecisionTrendExitCode;
  /** How many window inputs were supplied. */
  readonly windowsSupplied: number;
  /** How many windows were considered after the window cap. */
  readonly windowsConsidered: number;
  /** How many considered windows are usable. */
  readonly windowsUsable: number;
  /** The total records considered across the usable windows. */
  readonly totalRecords: number;
  /** The aggregate decision distribution across the usable windows (all six keys present). */
  readonly decisionCounts: Readonly<Record<ReleaseDecisionDecision, number>>;
  /** The bounded arc direction. */
  readonly direction: ReleaseDecisionTrendDirection;
  /** The single coarse classification of what the history contains. */
  readonly trendClass: ReleaseDecisionTrendClass;
}

/** The process exit code for a trend result. */
export function releaseDecisionTrendExitCode(result: ReleaseDecisionTrendResult): number {
  return result.trend.exitCode;
}

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from any ingested window)
 * ------------------------------------------------------------------ */

/** The one-line verdict headline. Authored here, keyed by the enum. */
export const RELEASE_DECISION_TREND_VERDICT_SUMMARY: Record<ReleaseDecisionTrendVerdict, string> = {
  improving:
    "IMPROVING: a clean history whose LATEST window is a clean STABLE index and at least one EARLIER window was worse (a watch / insufficient index) — the recent decisions recovered to clean. Confirm the improvement is sustained; this trend authorizes nothing on its own.",
  stable:
    "STABLE: the recent decision-index history is healthy — no tampered or unreadable window, and every usable window is a clean STABLE index. Keep indexing decisions per window and summarizing them on your governance cadence. This trend authorizes nothing on its own.",
  watch:
    "WATCH: no blocker or untrustworthy input and the history is sufficient, but an ADVISORY concern is present — a usable window is a WATCH or INSUFFICIENT index (flat / mixed, not degrading). Review the recent windows and decide whether follow-up is warranted.",
  degrading:
    "DEGRADING: no blocker or untrustworthy input, but the LATEST window is WORSE than the earliest usable window (a watch / insufficient index after an earlier cleaner one). The arc is worsening; investigate what changed between the recent windows.",
  insufficient:
    "INSUFFICIENT: the history is INCONCLUSIVE — zero usable windows were considered, or every usable window is an INSUFFICIENT index. Supply a readable history or complete the missing decision evidence, then re-summarize; this is not a clean history.",
  blocked:
    "BLOCKED: a BLOCKING window is present — a usable window is a BLOCKED or INVALID index (its decision batch was rejected or contained an untrustworthy record), or `--strict` escalated a non-clean history. Do NOT treat the history as clean until the cause is resolved.",
  invalid:
    "INVALID: an untrustworthy INPUT — a supplied window was unreadable or is recognized but self-inconsistent (a tamper). The trend itself cannot be trusted until the window is recovered; this is never a vacuous pass.",
};

/**
 * The dedicated headline for a `blocked` trend produced ONLY because `--strict` escalated a non-clean history — there
 * was no `blocked` / `invalid` window or untrustworthy input, so the generic `blocked` summary would misrepresent the
 * cause. Authored, keyed by which verdict `--strict` escalated from.
 */
export const RELEASE_DECISION_TREND_STRICT_ESCALATED_SUMMARY: Record<
  "watch" | "degrading" | "improving" | "insufficient",
  string
> = {
  watch:
    "BLOCKED (--strict): the only concern is an ADVISORY window (a watch / insufficient index), and `--strict` escalates any non-clean window to a blocked history — a hard `all-stable or block` gate. Without the flag this would be WATCH. No blocked / invalid window or untrustworthy input was found.",
  degrading:
    "BLOCKED (--strict): the only concern is a DEGRADING arc (a non-clean latest window), and `--strict` escalates any non-clean window to a blocked history — a hard `all-stable or block` gate. Without the flag this would be DEGRADING. No blocked / invalid window or untrustworthy input was found.",
  improving:
    "BLOCKED (--strict): the latest window recovered to clean but EARLIER windows were non-clean, and `--strict` escalates any non-clean window to a blocked history — a hard `all-stable or block` gate. Without the flag this would be IMPROVING. No blocked / invalid window or untrustworthy input was found.",
  insufficient:
    "BLOCKED (--strict): the only concern is an INSUFFICIENT history (an inconclusive window), and `--strict` escalates any non-clean window to a blocked history — a hard `all-stable or block` gate. Without the flag this would be INSUFFICIENT. No blocked / invalid window or untrustworthy input was found.",
};

/** Per-reason authored detail + resolved severity, keyed by id. */
export const RELEASE_DECISION_TREND_REASON_DETAIL: Record<
  ReleaseDecisionTrendReasonId,
  { readonly severity: ReleaseDecisionTrendSeverity; readonly detail: string }
> = {
  "window-unreadable": {
    severity: "invalid",
    detail:
      "A supplied window could not be read / recognized as a `pdfxyz.release-decision-index/1` (wrong schema or unparseable — never echoed), so it contributes no trusted verdict. The trend is incomplete; recover a readable decision index produced by `worker:release-decision-index` and re-run.",
  },
  "window-tampered": {
    severity: "invalid",
    detail:
      "A supplied window is a recognized `pdfxyz.release-decision-index/1` whose recorded index verdict does NOT re-derive from its own recorded ledger counts, or whose counts disagree with its own per-record sequence — a hand-edited or corrupt window. Recover the untampered window from your CI archive; a tampered window cannot be summarized.",
  },
  "window-blocked": {
    severity: "blocking",
    detail:
      "A usable window is a BLOCKED index: a decision in that batch was REJECT or INVALID (a rejected / untrustworthy release), or that window was produced under `--strict`. Do NOT treat that window's decision batch as clean; resolve the cause and re-index it before relying on the history.",
  },
  "window-invalid": {
    severity: "blocking",
    detail:
      "A usable window is an INVALID index: a record in that batch was unreadable or tampered (an untrustworthy decision record). It is a blocking history outcome — recover the untampered records for that window and re-index it before relying on the history.",
  },
  "strict-nonclean": {
    severity: "blocking",
    detail:
      "`--strict` was set and a non-STABLE usable window is present (a watch / insufficient / blocked / invalid index). The policy requires every window to be a clean stable index; escalate the non-clean history to a blocked trend and resolve the concern before relying on the history.",
  },
  "no-usable-windows": {
    severity: "insufficient",
    detail:
      "The history has zero usable windows — every considered window was unreadable / tampered, or the history was empty. There is nothing to summarize; supply a bounded history of readable `pdfxyz.release-decision-index/1` windows and re-run.",
  },
  "only-insufficient": {
    severity: "insufficient",
    detail:
      "Every usable window is an INSUFFICIENT index: the recent decision batches were all inconclusive (an incomplete or empty batch). Complete the missing decision evidence and re-index those windows before treating the history as summarizable.",
  },
  "trend-degrading": {
    severity: "advisory",
    detail:
      "The newest usable window's index verdict is WORSE than the oldest usable window's (a watch / insufficient index after an earlier cleaner one) — the recent arc degraded. Review what changed between the recent windows before relying on the history.",
  },
  "window-watch": {
    severity: "advisory",
    detail:
      "A usable window is a WATCH index: that decision batch carried an advisory concern (a proceed-with-followup / hold decision). Track the follow-up to closure before relying on the history; an advisory concern, not a rejection.",
  },
  "window-insufficient": {
    severity: "advisory",
    detail:
      "A usable window is an INSUFFICIENT index while other windows are cleaner — a coverage gap in the recent history (an inconclusive batch among usable ones). Complete the missing decision evidence for that window and re-index it.",
  },
};

/** Per-checklist authored detail, keyed by id. */
export const RELEASE_DECISION_TREND_CHECKLIST_DETAIL: Record<ReleaseDecisionTrendChecklistId, string> = {
  "recover-invalid-windows":
    "Recover the unreadable / tampered decision-index window(s) from your CI archive: a window that cannot be read, or whose recorded verdict does not re-derive from its own counts, means the trend input was lost or hand-edited and cannot be trusted.",
  "review-blocked-windows":
    "A usable window is a BLOCKED or INVALID index: do NOT treat that window's decision batch as clean. Resolve the rejection cause, or recover the untampered records for that window and re-index it, before relying on the history.",
  "review-strict-nonclean":
    "`--strict` flagged a non-stable window (a watch / insufficient / blocked / invalid index): the policy requires every window in the history to be a clean stable index. Review the flagged window(s) and resolve the concern, or drop `--strict` if a non-stable window is acceptable for this review, before relying on the history.",
  "supply-decision-indexes":
    "Supply more / readable content-free `pdfxyz.release-decision-index/1` windows (a bounded history, oldest first) and re-run this trend: an unreadable or empty history cannot be summarized.",
  "complete-insufficient-windows":
    "A usable window is an INSUFFICIENT index (an inconclusive decision batch): complete the missing decision evidence with `worker:release-decision` / `worker:release-decision-index`, re-index that window, and re-summarize.",
  "review-degrading-trend":
    "The recent arc is worsening (the newest window is worse than the earliest usable window): investigate what changed between the recent windows and resolve the regression before relying on the history. Archive this trend as the record of that review.",
  "review-watch-windows":
    "A usable window is a WATCH index: track the recorded follow-up (a proceed-with-followup / hold decision) to closure before relying on the history. Archive this trend as the record of that review.",
  "note-improving-trend":
    "The recent arc recovered to a clean latest window: note the improvement and confirm it is sustained across the next windows. Keep indexing decisions and summarizing them here; this trend authorizes no promotion on its own.",
  "continue-indexing-decisions":
    "The history is clean: keep filing one `worker:release-decision-index` window per review period and summarizing them here on your governance cadence. This trend authorizes no promotion on its own.",
  "keep-decision-trend":
    "Keep this content-free trend as the local release-decision-index governance review SUMMARY. It is NOT a legal audit log, a compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger; keep those separately.",
};

/**
 * The honesty caveats every result carries and every text render prints. The trend SUMMARIZES a bounded history of
 * the chain's already content-free decision-index windows, RE-VALIDATES each one's self-consistency, and rolls them
 * up into one trend verdict; it must never be read as more than that.
 */
export const RELEASE_DECISION_TREND_CAVEATS: readonly string[] = [
  "This is a RELEASE DECISION INDEX TREND SUMMARY: it INGESTS a bounded history of content-free `pdfxyz.release-decision-index/1` ledger windows a release pipeline produced, RE-VALIDATES each against ITSELF, and folds them into ONE bounded trend verdict + follow-up checklist. It is a local content-free ledger-index TREND SUMMARY over decision-index windows — NOT a legal audit log, a compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger.",
  "It is offline and READ-ONLY: it makes NO network call, reads NO secret, bucket, or object, RUNS no gate / index / decision itself, and NEVER signs, approves, publishes, promotes, deploys, notifies, deletes, prunes, uploads, or mutates any window, record, artifact, object, or deployment. A `stable` / `improving` trend authorizes nothing; it only reports that the content-free decision-index windows supplied on THIS host trended clean over the review history.",
  "A `stable` trend REQUIRES a clean bounded history: no tampered / unreadable window, and every usable window a clean `stable` index; `improving` additionally REQUIRES the latest window to be clean over an earlier worse one. It FAILS CLOSED: an unreadable / tampered window makes the trend `invalid`; a `blocked` / `invalid` window (or a `--strict` violation) makes it `blocked`; zero usable windows or an only-`insufficient` history is `insufficient`; a degrading / advisory arc is `degrading` / `watch`. It never fabricates a clean trend from thin or untrusted history.",
  "It re-derives each ingested window's index verdict from the window's OWN recorded ledger counts (reusing the Phase 60 rollup reducer) AND re-checks those counts against the window's own per-record sequence + window arithmetic, and treats any disagreement as a TAMPER (`invalid`). This re-derivation is TAMPER-EVIDENCE over content-free data, NOT a cryptographic signature — there is no signing key and no attested identity, so the trend proves neither authorship nor approval, and a fully self-consistent fabricated window is out of its scope.",
  "It emits only bounded enums, small counts, an ISO stamp, and app-authored prose — so it carries no reviewer name or email, no filename, path, object key, bucket, URL, endpoint, region, job / user id, IP, token, raw ref, raw label, raw note, commit URL, size, byte, or digest, even from a hostile input; it never echoes an ingested window's own stamp, and it never echoes an input file path, even on an error.",
  "It is not malware scanning, sanitization, authorization, cloud validation, or deletion proof of any request or object, and it deletes, uploads, promotes, approves, or mutates nothing.",
];

/**
 * Out-of-band reminders the trend carries but does NOT itself perform — the honest edges of an offline summarizer.
 * Authored, bounded, content-free; never derived from an input.
 */
export const RELEASE_DECISION_TREND_GUIDANCE: readonly string[] = [
  "Wire this as a SCHEDULED or on-demand GOVERNANCE summary (per quarter / half-year), NOT a per-release gate: run `worker:release-decision-index` per review window and archive each window, then hand a bounded history (oldest first, newest last) here and render `--text` into a review artifact / `$GITHUB_STEP_SUMMARY`. Fail the review on exit 4 (a blocked history or an untrustworthy window), surface exit 3 (a watch / degrading history) for review, and treat exit 2 (an inconclusive history) as a coverage gap, not a clean history.",
  "Keep the history bounded and explicit: `--max-windows=N` caps the newest N windows (older windows are dropped from the history, and the count dropped is surfaced, never silent); `--strict` escalates any non-stable window to a blocked history — a hard `all-stable or block` gate for a high-assurance review. Direction is derived from ORDERED INPUT POSITIONS (oldest first, newest last), never from any ingested timestamp.",
  "Archive this trend (and the underlying decision-index windows) as CI artifacts: it is a content-free governance SUMMARY, not a substitute for the windows it summarizes, nor for your legal audit trail, compliance log, external approval / signing, storage retention, or release-promotion processes — keep each of those in its own dedicated system.",
  "Enforce promotion out of band: this trend SUMMARIZES a history of the content-free decision-index windows supplied, but recording a legal audit trail, obtaining an external approval / signature, proving reviewer identity, and promoting a deployment are operator / CI / legal actions this offline summarizer never performs.",
];
