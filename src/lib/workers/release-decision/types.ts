/**
 * The bounded, content-free vocabulary for the secure-worker **release decision record ledger** (Phase 59).
 *
 * Phases 46–58 built the release-evidence chain one rung per phase: the release gate folds the content-free worker
 * checks into ONE promotion verdict; the artifact, index, policy, CI bundle, audit, operator report, trend summary,
 * governance bundle, archive pack, and restore drill each compose or re-verify the layer below; the publish / handoff
 * pack (`pdfxyz.release-publish-pack/1`, Phase 57) composes the governance bundle + related records into ONE
 * share-safe MANIFEST with a DISCLOSURE CLASSIFICATION; and the handoff acknowledgement receipt
 * (`pdfxyz.release-ack/1`, Phase 58) records an operator's bounded ACKNOWLEDGEMENT of that pack.
 *
 * This phase closes the *decision* loop. A publish pack says whether the evidence is safe to hand off; an
 * acknowledgement records that a reviewer / operator reviewed / received it and what bounded stance they chose. What is
 * still missing is ONE final, content-free LEDGER ENTRY that composes the two into a single, stable decision posture an
 * operator files as the record of what was decided — proceed, proceed with a follow-up, hold, reject, or "not enough
 * evidence yet". This tool INGESTS a `pdfxyz.release-publish-pack/1` AND a `pdfxyz.release-ack/1`, RE-VALIDATES each
 * against ITSELF (reusing the Phase 57 pack rollup + re-running the Phase 58 ack rollup, so a hand-flipped verdict /
 * disclosure / decision is caught as a tamper), CROSS-CHECKS that the acknowledgement's recorded source-pack summary
 * is coherent with the supplied publish pack, and emits ONE stable, content-free `pdfxyz.release-decision/1` document —
 *
 *    "Given this publish pack and this acknowledgement of it, what is the recorded release DECISION — proceed, proceed
 *     with a follow-up, hold, reject, or is the evidence insufficient?"
 *
 * — with a bounded decision, per-source summaries (the pack's own verdict / disclosure / source count; the
 * acknowledgement's own verdict / decision / reviewer class / note class), a coherence cross-check status, a
 * next-action checklist, and honesty caveats. It FAILS CLOSED: it never vacuous-passes a missing / unreadable /
 * tampered document or an incoherent pair (that is `invalid`), and only a clean `publishable` (share-safe) pack
 * acknowledged by an `accepted` decision yields a `proceed`.
 *
 * It obeys the same honesty contract as the rest of the worker layer and is as content-free as the two documents it
 * composes:
 *  - Every load-bearing token here is a bounded enum — a decision, a source state, a cross-check status, a severity, a
 *    reason id, a checklist id — never a reviewer name / email, a filename, path, object key, bucket, URL, endpoint,
 *    region, id, token, size, byte, raw ref, raw label, raw note text, provider error, or digest. The only non-enum
 *    values are small integer counts, an ISO stamp, and app-authored prose.
 *  - It never copies a free-text field out of either ingested document (each — even one Phase 57 / 58 produced — is
 *    UNTRUSTED input here); it reduces every fact to a bounded enum, a small integer, or a boolean, it never echoes an
 *    ingested document's OWN stamp (the record carries only its own), and it never echoes an input file path, even on
 *    an error.
 *  - It never fabricates a `proceed`. A `proceed` REQUIRES a usable publish pack whose own verdict is `publishable`
 *    (share-safe) AND a usable acknowledgement whose recorded decision is a clean `accepted` (no follow-up) AND a
 *    matching cross-check. Anything less is `proceed-with-followup` / `hold` / `insufficient` / `reject`, and a
 *    missing / unreadable / tampered document — or an acknowledgement that does not correspond to the supplied pack —
 *    is `invalid` (fail-closed).
 *
 * It is deliberately NOT an external signature, NOT an approval, NOT an identity attestation, NOT legal / compliance
 * sign-off, NOT release promotion, and NOT actual deployment. It RECORDS the composite decision posture over two
 * content-free documents; it authorizes nothing and promotes nothing. Its authored caveats (see
 * {@link RELEASE_DECISION_CAVEATS}) say so out loud: it is a local content-free decision RECORD — it never signs,
 * approves, publishes, promotes, deploys, notifies, or mutates anything.
 */

import {
  RELEASE_PUBLISH_PACK_DISCLOSURES,
  RELEASE_PUBLISH_PACK_SCHEMA,
  RELEASE_PUBLISH_PACK_VERDICTS,
  type ReleasePublishPackDisclosure,
  type ReleasePublishPackVerdict,
} from "../release-publish-pack/types";
import {
  RELEASE_ACK_DECISIONS,
  RELEASE_ACK_NOTES,
  RELEASE_ACK_REVIEWERS,
  RELEASE_ACK_SCHEMA,
  RELEASE_ACK_VERDICTS,
  type ReleaseAckDecision,
  type ReleaseAckNote,
  type ReleaseAckReviewer,
  type ReleaseAckVerdict,
} from "../release-ack/types";

/** The schema tag every release-decision result carries, so tooling can pin the shape it parses. */
export const RELEASE_DECISION_SCHEMA = "pdfxyz.release-decision/1" as const;

/** The upstream document schemas the record composes. Re-exported so the result can pin each input shape. */
export { RELEASE_PUBLISH_PACK_SCHEMA, RELEASE_ACK_SCHEMA };

/** Stable identity of the release-decision — for docs / receipts / audit. */
export const RELEASE_DECISION_POLICY_ID = "pdfxyz-worker-release-decision";
/** Bump when the surface, the decision ladder, the reason / checklist / cross-check sets, or the schema changes. */
export const RELEASE_DECISION_POLICY_VERSION = 1;

/** Re-exported for convenience (the upstream enums the two source summaries surface). */
export type {
  ReleasePublishPackVerdict,
  ReleasePublishPackDisclosure,
  ReleaseAckVerdict,
  ReleaseAckDecision,
  ReleaseAckReviewer,
  ReleaseAckNote,
};
export {
  RELEASE_PUBLISH_PACK_VERDICTS,
  RELEASE_PUBLISH_PACK_DISCLOSURES,
  RELEASE_ACK_VERDICTS,
  RELEASE_ACK_DECISIONS,
  RELEASE_ACK_REVIEWERS,
  RELEASE_ACK_NOTES,
};

/**
 * The bounded coverage state of one composed document (the publish pack or the acknowledgement):
 *  - `absent`     — no file was supplied (the CLI requires both, so a RUN never sees this; modelled for completeness);
 *  - `unreadable` — a file was supplied but could not be read / parsed / recognized as its expected schema (never
 *                   echoed);
 *  - `tampered`   — the document was recognized but its recorded rollup does NOT re-derive from its own facts (a
 *                   hand-edited / corrupt document — the input can't be trusted);
 *  - `usable`     — recognized AND self-consistent (its recorded rollup re-derives): trustworthy evidence.
 */
export const RELEASE_DECISION_SOURCE_STATES = [
  "absent",
  "unreadable",
  "tampered",
  "usable",
] as const;
export type ReleaseDecisionSourceState =
  (typeof RELEASE_DECISION_SOURCE_STATES)[number];

/**
 * The coherence CROSS-CHECK status — whether the acknowledgement's recorded source-pack summary agrees with the
 * SUPPLIED publish pack, on bounded fields only (verdict / disclosure / source count; no digest / path / id):
 *  - `match`    — both documents are usable AND the acknowledgement recorded acknowledging a pack whose bounded
 *                 summary equals the supplied pack's: the pair is coherent;
 *  - `mismatch` — both documents are usable BUT the acknowledgement's recorded source-pack summary differs from the
 *                 supplied pack's (a different verdict / disclosure / source count, or the acknowledgement recorded a
 *                 non-usable source): the acknowledgement does not correspond to the supplied pack (`invalid`);
 *  - `unknown`  — the coherence could not be checked because a document is absent / unreadable / tampered (an
 *                 untrustworthy input already dominates the decision, so the cross-check is moot).
 *
 * This is content-free CONSISTENCY, NOT a cryptographic attestation: there is no signing key and no attested identity,
 * so a `match` is not proof the two documents share a provenance — only that their bounded postures are coherent.
 */
export const RELEASE_DECISION_CROSS_CHECKS = [
  "match",
  "mismatch",
  "unknown",
] as const;
export type ReleaseDecisionCrossCheckStatus =
  (typeof RELEASE_DECISION_CROSS_CHECKS)[number];

/**
 * The single decision a release ledger / CI keys on — the composite posture over the pack + acknowledgement:
 *  - `proceed`               — the pack is `publishable` (share-safe) and the acknowledgement is a clean `accepted`
 *                              (no follow-up) whose recorded source matches the supplied pack: the release may proceed
 *                              (out of band). It is NOT an approval, a signature, or a promotion;
 *  - `proceed-with-followup` — the same clean share-safe pack, but the acknowledgement carried a recorded follow-up
 *                              (an `accepted-with-notes` decision, an `acknowledged-with-followup` verdict, or a note
 *                              class): proceed, but TRACK the follow-up. Only when not `--strict`;
 *  - `hold`                  — the pack needs INTERNAL REVIEW (its own verdict is `review` / internal-review): hold
 *                              and review before proceeding. Advisory, not a rejection;
 *  - `insufficient`          — the evidence is inconclusive: the pack's own verdict is `incomplete`, or the
 *                              acknowledgement's decision is `deferred`. Complete the evidence or resolve the deferral;
 *  - `reject`                — a BLOCKING outcome: the acknowledgement is `rejected` / `needs-changes`, or the pack's
 *                              own verdict is `blocked`. Do NOT proceed;
 *  - `invalid`               — the inputs could not be trusted: a missing / unreadable / TAMPERED pack or
 *                              acknowledgement, or a cross-check MISMATCH (the acknowledgement does not correspond to
 *                              the supplied pack). Never a vacuous pass.
 *
 * These are the exact bounded values the run-level `worker_release_decision_total` metric carries as its `decision`
 * label; all six are low-cardinality, redaction-stable tokens.
 */
export const RELEASE_DECISION_DECISIONS = [
  "proceed",
  "proceed-with-followup",
  "hold",
  "reject",
  "insufficient",
  "invalid",
] as const;
export type ReleaseDecisionDecision =
  (typeof RELEASE_DECISION_DECISIONS)[number];

/**
 * The exit-code ladder a CI / release ledger job routes on — the same shape as the whole release-evidence suite so the
 * tools speak one language:
 *  - `0` PROCEED      — a clean, coherent proceed (share-safe pack + clean acceptance);
 *  - `1` USAGE        — the CLI was misused (a bad flag, a missing document, two stdin inputs, or an unwritable
 *                       output). CLI-owned; a decision RUN never resolves to it;
 *  - `2` INSUFFICIENT — the evidence was inconclusive (an incomplete pack or a deferred acknowledgement);
 *  - `3` ADVISORY     — an advisory posture: `proceed-with-followup` (a tracked follow-up) or `hold` (needs internal
 *                       review);
 *  - `4` REJECT       — a blocking outcome (a rejected / needs-changes acknowledgement or a blocked pack);
 *  - `4` INVALID      — an untrustworthy input (a missing / unreadable / tampered document, or a cross-check mismatch).
 *
 * Monotonic in badness within each band; `insufficient` (2) sorts before the `advisory` band (3) exactly like the rest
 * of the suite folds insufficiency before advisory. `reject` and `invalid` share the top code `4` but are distinct
 * decisions (a rejected VALID pair vs an untrustworthy / incoherent input).
 */
export const RELEASE_DECISION_EXIT = {
  PROCEED: 0,
  USAGE: 1,
  INSUFFICIENT: 2,
  ADVISORY: 3,
  REJECT: 4,
  INVALID: 4,
} as const;
export type ReleaseDecisionExitCode =
  (typeof RELEASE_DECISION_EXIT)[keyof typeof RELEASE_DECISION_EXIT];

/** The authoritative decision → exit code map. */
export const RELEASE_DECISION_EXIT_FOR_DECISION: Record<
  ReleaseDecisionDecision,
  ReleaseDecisionExitCode
> = {
  proceed: RELEASE_DECISION_EXIT.PROCEED,
  "proceed-with-followup": RELEASE_DECISION_EXIT.ADVISORY,
  hold: RELEASE_DECISION_EXIT.ADVISORY,
  insufficient: RELEASE_DECISION_EXIT.INSUFFICIENT,
  reject: RELEASE_DECISION_EXIT.REJECT,
  invalid: RELEASE_DECISION_EXIT.INVALID,
};

/**
 * The common **severity** each fired reason maps onto so the fold can resolve the pack posture + the acknowledgement +
 * the cross-check into one decision, with precedence `invalid > blocking > insufficient > advisory > ready` (checked in
 * that order — so an untrustworthy input never masquerades as a mere rejection, an insufficiency never as an advisory,
 * and a real blocker is never masked). No reason firing ⇒ a clean `proceed`.
 *  - `ready`        — no concern (the best contribution);
 *  - `advisory`     — a tracked follow-up (→ `proceed-with-followup`) or a needs-review pack (→ `hold`);
 *  - `insufficient` — an incomplete pack or a deferred acknowledgement (→ `insufficient`);
 *  - `blocking`     — a rejected / needs-changes acknowledgement or a blocked pack (→ `reject`);
 *  - `invalid`      — a missing / unreadable / tampered document or a cross-check mismatch (→ `invalid`, worst).
 */
export const RELEASE_DECISION_SEVERITIES = [
  "ready",
  "advisory",
  "insufficient",
  "blocking",
  "invalid",
] as const;
export type ReleaseDecisionSeverity =
  (typeof RELEASE_DECISION_SEVERITIES)[number];

/** The severity rank (higher = worse) — used for the fold precedence. */
export const RELEASE_DECISION_SEVERITY_RANK: Record<
  ReleaseDecisionSeverity,
  number
> = {
  ready: 0,
  advisory: 1,
  insufficient: 2,
  blocking: 3,
  invalid: 4,
};

/**
 * The bounded reason ids — the closed set of REASONS the decision resolved as it did, emitted in this stable order (a
 * superset view, so a reviewer sees every condition that applied, not only the winning one). The per-id severity is
 * authored in {@link RELEASE_DECISION_REASON_DETAIL}:
 *
 * Invalid input (a document can't be trusted, or the pair is incoherent):
 *  - `pack-missing`         — no publish pack was supplied;
 *  - `pack-unreadable`      — the supplied pack could not be read / recognized;
 *  - `pack-tampered`        — the pack is recognized but its recorded verdict does NOT re-derive from its own sources;
 *  - `ack-missing`          — no acknowledgement was supplied;
 *  - `ack-unreadable`       — the supplied acknowledgement could not be read / recognized;
 *  - `ack-tampered`         — the acknowledgement is recognized but its recorded verdict does NOT re-derive;
 *  - `cross-check-mismatch` — both documents are usable but the acknowledgement's recorded source-pack summary does not
 *                             match the supplied pack (a different verdict / disclosure / source count, or a non-usable
 *                             recorded source): the acknowledgement does not correspond to the supplied pack.
 *
 * Blocking (do not proceed):
 *  - `pack-blocked`         — the usable pack's own verdict is `blocked` (its disclosure is do-not-share);
 *  - `ack-rejected`         — the usable acknowledgement's recorded decision is `rejected`;
 *  - `ack-needs-changes`    — the usable acknowledgement's recorded decision is `needs-changes`.
 *
 * Insufficient (evidence inconclusive):
 *  - `pack-incomplete`      — the usable pack's own verdict is `incomplete` (insufficient evidence);
 *  - `ack-deferred`         — the usable acknowledgement's recorded decision is `deferred`.
 *
 * Advisory:
 *  - `pack-review`          — the usable pack's own verdict is `review` (internal-review) → drives a `hold`;
 *  - `ack-accepted-with-notes` — the usable acknowledgement's recorded decision is `accepted-with-notes` → follow-up;
 *  - `ack-note-followup`    — the usable acknowledgement recorded a non-`none` note class → follow-up.
 */
export const RELEASE_DECISION_REASON_IDS = [
  // Invalid input
  "pack-missing",
  "pack-unreadable",
  "pack-tampered",
  "ack-missing",
  "ack-unreadable",
  "ack-tampered",
  "cross-check-mismatch",
  // Blocking
  "pack-blocked",
  "ack-rejected",
  "ack-needs-changes",
  // Insufficient
  "pack-incomplete",
  "ack-deferred",
  // Advisory
  "pack-review",
  "ack-accepted-with-notes",
  "ack-note-followup",
] as const;
export type ReleaseDecisionReasonId =
  (typeof RELEASE_DECISION_REASON_IDS)[number];

/**
 * The bounded next-action checklist ids — the closed set of concrete steps to take (or hold) after the decision, in
 * this canonical order (the checklist is emitted in this order, deduped):
 *  - `resolve-inputs-before-deciding`       — a document can't be trusted or the pair is incoherent; recover a valid,
 *                                             matching publish pack + acknowledgement and re-run (a decision over an
 *                                             untrustworthy / incoherent pair is meaningless);
 *  - `do-not-proceed-on-rejection`          — this decision is a REJECTION (or the pack is blocked); do NOT hand off /
 *                                             promote; resolve the cause and re-run;
 *  - `complete-evidence-before-proceeding`  — the pack is incomplete or the acknowledgement was deferred; complete the
 *                                             missing evidence or resolve the deferral before proceeding;
 *  - `hold-for-internal-review`             — the pack needs INTERNAL REVIEW; review it internally, then re-decide;
 *  - `track-recorded-followup`              — a follow-up was recorded; track it to closure while proceeding;
 *  - `proceed-with-handoff-out-of-band`     — the decision supports proceeding; perform the actual handoff / promotion
 *                                             / deployment OUT OF BAND with your own tooling (this record performs none);
 *  - `obtain-external-approval-out-of-band` — this is a decision RECORD, NOT an external approval / signature / legal /
 *                                             compliance sign-off / promotion; obtain any required approval SEPARATELY;
 *  - `keep-decision-record`                 — keep this content-free record as the release decision ledger entry (always).
 */
export const RELEASE_DECISION_CHECKLIST_IDS = [
  "resolve-inputs-before-deciding",
  "do-not-proceed-on-rejection",
  "complete-evidence-before-proceeding",
  "hold-for-internal-review",
  "track-recorded-followup",
  "proceed-with-handoff-out-of-band",
  "obtain-external-approval-out-of-band",
  "keep-decision-record",
] as const;
export type ReleaseDecisionChecklistId =
  (typeof RELEASE_DECISION_CHECKLIST_IDS)[number];

/* ------------------------------------------------------------------ *
 *  Reduced sources, cross-check, rollup, receipt, result
 * ------------------------------------------------------------------ */

/**
 * The bounded summary of the supplied publish pack — the pack's own posture, reduced to bounded enums + small integers.
 * Never a raw value from the input.
 */
export interface ReleaseDecisionPackSummary {
  /** The pack's ingest state (absent / unreadable / tampered / usable). */
  readonly state: ReleaseDecisionSourceState;
  /** True iff a pack file was supplied (independent of whether it parsed / recognized). */
  readonly supplied: boolean;
  /** True iff the parsed input carried the `pdfxyz.release-publish-pack/1` schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND self-consistent (its recorded rollup re-derives). */
  readonly usable: boolean;
  /**
   * The pack's own publish verdict (a bounded enum), or `null`. Trusted only when `usable`; for a `tampered` pack it is
   * the untrusted CLAIMED verdict (surfaced so the summary shows what was asserted).
   */
  readonly verdict: ReleasePublishPackVerdict | null;
  /** The pack's own disclosure classification, or `null`. Trusted only when `usable`; untrusted claim when tampered. */
  readonly disclosure: ReleasePublishPackDisclosure | null;
  /** How many evidence sources the pack recorded as supplied (0–5; 0 when the pack is unreadable / absent). */
  readonly sourcesSupplied: number;
  /** How many evidence sources the pack recorded as usable (0–5; 0 when the pack is unreadable / absent). */
  readonly sourcesUsable: number;
  /** A one-line, content-free headline authored from the pack state + verdict. */
  readonly detail: string;
}

/**
 * The bounded summary of the supplied acknowledgement — its own posture + the pack summary IT recorded acknowledging,
 * reduced to bounded enums + small integers. Never a raw value from the input.
 */
export interface ReleaseDecisionAckSummary {
  /** The acknowledgement's ingest state (absent / unreadable / tampered / usable). */
  readonly state: ReleaseDecisionSourceState;
  /** True iff an acknowledgement file was supplied (independent of whether it parsed / recognized). */
  readonly supplied: boolean;
  /** True iff the parsed input carried the `pdfxyz.release-ack/1` schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND self-consistent (its recorded rollup re-derives). */
  readonly usable: boolean;
  /**
   * The acknowledgement's own verdict (a bounded enum), or `null`. Trusted only when `usable`; for a `tampered`
   * acknowledgement it is the untrusted CLAIMED verdict (surfaced so the summary shows what was asserted).
   */
  readonly ackVerdict: ReleaseAckVerdict | null;
  /** The acknowledgement's recorded DECISION class, or `null`. Trusted only when `usable`. */
  readonly decision: ReleaseAckDecision | null;
  /** The acknowledgement's recorded reviewer CLASS (a role, never an identity), or `null`. */
  readonly reviewer: ReleaseAckReviewer | null;
  /** The acknowledgement's recorded note CLASS (a follow-up category, never free text), or `null`. */
  readonly note: ReleaseAckNote | null;
  /** The publish-pack verdict the acknowledgement RECORDED acknowledging (for the cross-check), or `null`. */
  readonly recordedPackVerdict: ReleasePublishPackVerdict | null;
  /** The publish-pack disclosure the acknowledgement recorded acknowledging, or `null`. */
  readonly recordedDisclosure: ReleasePublishPackDisclosure | null;
  /** The pack coverage state the acknowledgement recorded (its view of the pack it acknowledged), or `null`. */
  readonly recordedPackState: ReleaseDecisionSourceState | null;
  /** How many evidence sources the acknowledgement recorded its pack as supplying (0–5). */
  readonly recordedSourcesSupplied: number;
  /** How many evidence sources the acknowledgement recorded its pack as usable (0–5). */
  readonly recordedSourcesUsable: number;
  /** A one-line, content-free headline authored from the acknowledgement state + verdict. */
  readonly detail: string;
}

/** The bounded coherence cross-check between the acknowledgement's recorded source pack and the supplied pack. */
export interface ReleaseDecisionCrossCheck {
  readonly status: ReleaseDecisionCrossCheckStatus;
  /** Bounded, app-authored explanation (keyed by status). Never derived from an input. */
  readonly detail: string;
}

/** The bounded, applied policy knobs (from the validated args). */
export interface ReleaseDecisionPolicy {
  /** True iff `--strict` was set (only a clean share-safe pack + clean acceptance may `proceed`; else escalate). */
  readonly strict: boolean;
}

/** One fired reason, with its resolved severity + authored detail. */
export interface ReleaseDecisionReason {
  readonly id: ReleaseDecisionReasonId;
  readonly severity: ReleaseDecisionSeverity;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** One next-action checklist step, with its authored detail. */
export interface ReleaseDecisionChecklistItem {
  readonly id: ReleaseDecisionChecklistId;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** The composite decision — the single decision + exit code a release ledger acts on. */
export interface ReleaseDecisionRollup {
  readonly decision: ReleaseDecisionDecision;
  readonly exitCode: ReleaseDecisionExitCode;
  /** True iff `decision === "proceed"`. */
  readonly proceed: boolean;
  /** The fired reason ids, in canonical order (empty on a clean `proceed`). */
  readonly reasons: readonly ReleaseDecisionReasonId[];
  /** How many fired reasons were invalid-input. */
  readonly invalidInputs: number;
  /** How many fired reasons were blocking. */
  readonly blocking: number;
  /** How many fired reasons were insufficiencies. */
  readonly insufficiencies: number;
  /** How many fired reasons were advisory. */
  readonly advisories: number;
  /** True iff `--strict` was applied. */
  readonly strict: boolean;
  /**
   * True iff `--strict` ESCALATED a `proceed-with-followup`, `hold`, or `insufficient` posture to `reject`. Surfaced so
   * the summary explains the escalation (the record would be that posture without the flag).
   */
  readonly strictEscalated: boolean;
  /** Which posture `--strict` escalated FROM, or `null` when no escalation applied. */
  readonly strictEscalatedFrom:
    "proceed-with-followup" | "hold" | "insufficient" | null;
  readonly detail: string;
}

/** The stable identity block the result records (with the pinned upstream document schemas). */
export interface ReleaseDecisionMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_DECISION_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_POLICY_VERSION;
  readonly publishPackSchema: typeof RELEASE_PUBLISH_PACK_SCHEMA;
  readonly ackSchema: typeof RELEASE_ACK_SCHEMA;
}

/**
 * The stable, content-free release decision record an operator files as the ledger entry for a release. Every field is
 * a bounded enum, a small integer, an ISO stamp, or app-authored prose — so it carries no reviewer identity, locator,
 * size, path, or byte, even from a hostile input, and never echoes an ingested document's own stamp.
 */
export interface ReleaseDecisionResult {
  readonly schema: typeof RELEASE_DECISION_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleaseDecisionMetadata;
  readonly policy: ReleaseDecisionPolicy;
  /** The bounded summary of the supplied publish pack (its own verdict / disclosure / source counts). */
  readonly publishPack: ReleaseDecisionPackSummary;
  /** The bounded summary of the supplied acknowledgement (its own verdict / decision / reviewer / note classes). */
  readonly acknowledgement: ReleaseDecisionAckSummary;
  /** The coherence cross-check between the acknowledgement's recorded source pack and the supplied pack. */
  readonly crossCheck: ReleaseDecisionCrossCheck;
  readonly decision: ReleaseDecisionRollup;
  /** Every fired reason, in canonical {@link RELEASE_DECISION_REASON_IDS} order. */
  readonly reasons: readonly ReleaseDecisionReason[];
  /** The bounded, ordered next-action checklist. Never derived from an input. */
  readonly checklist: readonly ReleaseDecisionChecklistItem[];
  /** Bounded, app-authored guidance (out-of-scope steps this record does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from any ingested document. */
  readonly caveats: readonly string[];
  /** The flattened, content-free receipt (safe to log / forward verbatim). */
  readonly receipt: ReleaseDecisionReceipt;
}

/**
 * The content-free **receipt** the result rides alongside its body — the flattened answer to "what did this decision
 * record conclude, over how many usable documents, and on what acknowledgement decision" for a SIEM / release ledger.
 * Bounded enums + small integers + a stable policy id + the run's own stamp only (final decision + source count + the
 * acknowledgement's decision class); safe to log or forward verbatim.
 */
export interface ReleaseDecisionReceipt {
  readonly category: "worker-release-decision";
  readonly policyId: typeof RELEASE_DECISION_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_POLICY_VERSION;
  readonly at: string;
  readonly decision: ReleaseDecisionDecision;
  readonly exitCode: ReleaseDecisionExitCode;
  /** The coherence cross-check status (match / mismatch / unknown). */
  readonly crossCheck: ReleaseDecisionCrossCheckStatus;
  /** How many of the two composed documents were supplied (0–2). */
  readonly sourcesSupplied: number;
  /** How many of the two composed documents are usable (0–2). */
  readonly sourcesUsable: number;
  /** The acknowledgement's recorded decision CLASS only (trusted when usable; the claim when tampered; `null` if unreadable). */
  readonly ackDecision: ReleaseAckDecision | null;
}

/** The process exit code for a decision result. */
export function releaseDecisionExitCode(result: ReleaseDecisionResult): number {
  return result.decision.exitCode;
}

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from any ingested document)
 * ------------------------------------------------------------------ */

/** The one-line decision headline. Authored here, keyed by the enum. */
export const RELEASE_DECISION_SUMMARY: Record<ReleaseDecisionDecision, string> =
  {
    proceed:
      "PROCEED: the publish pack is PUBLISHABLE (share-safe) and the acknowledgement is a clean `accepted` (no follow-up) whose recorded source matches the supplied pack — the release may proceed. This is a content-free decision RECORD, NOT an external signature, an approval, a legal / compliance sign-off, or an actual deployment / promotion; perform the handoff / promotion out of band.",
    "proceed-with-followup":
      "PROCEED WITH FOLLOW-UP: the pack is share-safe and accepted, but a follow-up was recorded — an `accepted-with-notes` decision, an `acknowledged-with-followup` acknowledgement, or a note class. Proceed, but TRACK the follow-up to closure. Still not an external approval or a promotion.",
    hold: "HOLD: the publish pack needs INTERNAL REVIEW (its own verdict is `review` / internal-review). Hold and review the evidence internally before proceeding — this is an advisory hold, not a rejection.",
    insufficient:
      "INSUFFICIENT: the evidence is inconclusive — the publish pack is INCOMPLETE, or the acknowledgement was DEFERRED. Complete the missing evidence or resolve the deferral, then re-decide; this is not a proceed.",
    reject:
      "REJECT: a BLOCKING outcome — the acknowledgement is `rejected` / `needs-changes`, or the publish pack is BLOCKED (do-not-share). Do NOT hand off / promote the release on the strength of this pair until the cause is resolved.",
    invalid:
      "INVALID: the inputs could not be trusted — a missing / unreadable / TAMPERED publish pack or acknowledgement, or a cross-check MISMATCH (the acknowledgement does not correspond to the supplied pack). A decision over an untrustworthy or incoherent pair is meaningless; recover valid, matching documents and re-run. This is never a vacuous pass.",
  };

/**
 * The dedicated headline for a `reject` decision produced ONLY because `--strict` escalated a `proceed-with-followup`,
 * `hold`, or `insufficient` posture — there was no explicit rejection, blocked pack, or untrustworthy input, so the
 * generic `reject` summary would misrepresent the cause. Authored; selected by the rollup when `strictEscalated`.
 */
export const RELEASE_DECISION_STRICT_ESCALATED_SUMMARY: Record<
  "proceed-with-followup" | "hold" | "insufficient",
  string
> = {
  "proceed-with-followup":
    "REJECT (--strict): the only concern was a recorded FOLLOW-UP (accepted-with-notes / an acknowledged-with-followup acknowledgement / a note class), which `--strict` escalates to a rejection — under `--strict` only a clean `accepted` over a `publishable` pack may proceed. Without `--strict` this would be PROCEED WITH FOLLOW-UP, exit 3. No explicit rejection, blocked pack, or untrustworthy input was found.",
  hold: "REJECT (--strict): the pack needs INTERNAL REVIEW (a `review` pack), which `--strict` escalates to a rejection — under `--strict` only a clean `accepted` over a `publishable` (share-safe) pack may proceed. Without `--strict` this would be HOLD, exit 3. No explicit rejection, blocked pack, or untrustworthy input was found.",
  insufficient:
    "REJECT (--strict): the evidence was INSUFFICIENT (an incomplete pack or a deferred acknowledgement), which `--strict` escalates to a rejection — under `--strict` only a clean `accepted` over a `publishable` pack may proceed. Without `--strict` this would be INSUFFICIENT, exit 2. Supply complete evidence and record an explicit `accepted` over a share-safe pack to proceed.",
};

/** A one-line, content-free headline authored from the pack state + verdict. */
export const RELEASE_DECISION_PACK_DETAIL: Record<
  ReleaseDecisionSourceState,
  string
> = {
  absent: "no publish pack supplied — nothing to decide over.",
  unreadable:
    "a pack was supplied but is NOT a recognized `pdfxyz.release-publish-pack/1` (unreadable — never echoed); it cannot anchor a decision.",
  tampered:
    "the pack is recognized but its recorded verdict does NOT re-derive from its own sources (tampered / corrupt); it cannot be trusted.",
  usable:
    "a self-consistent `pdfxyz.release-publish-pack/1` (its recorded verdict re-derives).",
};

/** A one-line, content-free headline authored from the acknowledgement state + verdict. */
export const RELEASE_DECISION_ACK_DETAIL: Record<
  ReleaseDecisionSourceState,
  string
> = {
  absent: "no acknowledgement supplied — nothing to decide over.",
  unreadable:
    "an acknowledgement was supplied but is NOT a recognized `pdfxyz.release-ack/1` (unreadable — never echoed); it cannot anchor a decision.",
  tampered:
    "the acknowledgement is recognized but its recorded verdict does NOT re-derive from its own facts (tampered / corrupt); it cannot be trusted.",
  usable:
    "a self-consistent `pdfxyz.release-ack/1` (its recorded verdict re-derives).",
};

/** The authored cross-check note, keyed by status. */
export const RELEASE_DECISION_CROSS_CHECK_NOTE: Record<
  ReleaseDecisionCrossCheckStatus,
  string
> = {
  match:
    "MATCH: both documents are usable and the acknowledgement recorded acknowledging a pack whose bounded summary (verdict / disclosure / source count) equals the supplied pack's — the pair is coherent. This is content-free CONSISTENCY, not a cryptographic proof of shared provenance.",
  mismatch:
    "MISMATCH: both documents are usable but the acknowledgement's recorded source-pack summary differs from the supplied pack's (a different verdict / disclosure / source count, or the acknowledgement recorded a non-usable source). The acknowledgement does not correspond to the supplied pack — the pair is INVALID (do not decide over a mismatched pair).",
  unknown:
    "UNKNOWN: the coherence could not be checked because a document is absent / unreadable / tampered. An untrustworthy input already dominates the decision, so the cross-check is moot — resolve the input first.",
};

/** Per-reason authored detail + resolved severity, keyed by id. */
export const RELEASE_DECISION_REASON_DETAIL: Record<
  ReleaseDecisionReasonId,
  { readonly severity: ReleaseDecisionSeverity; readonly detail: string }
> = {
  "pack-missing": {
    severity: "invalid",
    detail:
      "No `pdfxyz.release-publish-pack/1` was supplied. There is nothing to decide over — a decision over no pack is meaningless. Supply a publish pack and re-run.",
  },
  "pack-unreadable": {
    severity: "invalid",
    detail:
      "The supplied publish pack could not be read / parsed / recognized as a `pdfxyz.release-publish-pack/1` (its content is never echoed). It cannot anchor a decision; recover a valid pack from a second copy and re-run.",
  },
  "pack-tampered": {
    severity: "invalid",
    detail:
      "The supplied publish pack is recognized but its recorded verdict / disclosure does NOT re-derive from its own reduced sources — a hand-edited or corrupt pack. A decision over a tampered pack would misrepresent the release; recover the untampered pack and re-run.",
  },
  "ack-missing": {
    severity: "invalid",
    detail:
      "No `pdfxyz.release-ack/1` was supplied. There is nothing to decide over — a decision needs the acknowledgement of the pack. Supply an acknowledgement and re-run.",
  },
  "ack-unreadable": {
    severity: "invalid",
    detail:
      "The supplied acknowledgement could not be read / parsed / recognized as a `pdfxyz.release-ack/1` (its content is never echoed). It cannot anchor a decision; recover a valid acknowledgement from a second copy and re-run.",
  },
  "ack-tampered": {
    severity: "invalid",
    detail:
      "The supplied acknowledgement is recognized but its recorded verdict does NOT re-derive from its own decision + source facts — a hand-edited or corrupt receipt. A decision over a tampered acknowledgement would misrepresent the review; recover the untampered acknowledgement and re-run.",
  },
  "cross-check-mismatch": {
    severity: "invalid",
    detail:
      "Both documents are usable, but the acknowledgement's recorded source-pack summary (verdict / disclosure / source count) does NOT match the supplied publish pack — the acknowledgement acknowledged a DIFFERENT pack (or a non-usable one). Supply the acknowledgement that corresponds to THIS pack, and re-run; do not decide over a mismatched pair.",
  },
  "pack-blocked": {
    severity: "blocking",
    detail:
      "The usable publish pack's own verdict is BLOCKED (disclosure do-not-share): a tamper / failure in the underlying evidence means the pack must not be shared. Do not proceed on the strength of this pack; resolve the block and re-run.",
  },
  "ack-rejected": {
    severity: "blocking",
    detail:
      "The usable acknowledgement's recorded decision is REJECTED: the reviewer / operator rejected the pack. Do not hand off / promote the release on the strength of this pair.",
  },
  "ack-needs-changes": {
    severity: "blocking",
    detail:
      "The usable acknowledgement's recorded decision is NEEDS-CHANGES: the pack is not acceptable as-is. Do not proceed until the required changes are made and a new pack is acknowledged.",
  },
  "pack-incomplete": {
    severity: "insufficient",
    detail:
      "The usable publish pack's own verdict is INCOMPLETE (insufficient evidence — e.g. an absent / unreadable / incomplete governance bundle). There is not enough to proceed; complete the missing evidence and re-run before a decision.",
  },
  "ack-deferred": {
    severity: "insufficient",
    detail:
      "The usable acknowledgement's recorded decision is DEFERRED: the review was postponed (e.g. pending more evidence or a later window). Revisit the deferral before proceeding.",
  },
  "pack-review": {
    severity: "advisory",
    detail:
      "The usable publish pack's own verdict is REVIEW (internal-review): an advisory concern was raised. Hold and review the evidence INTERNALLY before proceeding — it is not a clean share-safe package as-is.",
  },
  "ack-accepted-with-notes": {
    severity: "advisory",
    detail:
      "The usable acknowledgement's recorded decision is ACCEPTED-WITH-NOTES: accepted with a recorded follow-up to track. Proceed, but track the follow-up to closure.",
  },
  "ack-note-followup": {
    severity: "advisory",
    detail:
      "The usable acknowledgement recorded a follow-up note class (a bounded category, never free text). Proceed, but track the follow-up to closure.",
  },
};

/** Per-checklist-id authored detail, keyed by id. */
export const RELEASE_DECISION_CHECKLIST_DETAIL: Record<
  ReleaseDecisionChecklistId,
  string
> = {
  "resolve-inputs-before-deciding":
    "A document could not be trusted (a missing / unreadable / tampered pack or acknowledgement), or the pair is incoherent (a cross-check mismatch). Recover a valid, matching `pdfxyz.release-publish-pack/1` + `pdfxyz.release-ack/1` and re-run — a decision over an untrustworthy or incoherent pair is meaningless.",
  "do-not-proceed-on-rejection":
    "This decision is a REJECTION (a rejected / needs-changes acknowledgement, a blocked pack, or a strict escalation). Do NOT hand off, promote, or deploy the release on the strength of this pair; resolve the cause and re-run.",
  "complete-evidence-before-proceeding":
    "The publish pack is incomplete or the acknowledgement was deferred. Complete the missing evidence (or resolve the deferral) before proceeding, then re-run.",
  "hold-for-internal-review":
    "The publish pack needs INTERNAL REVIEW (a `review` pack). Review the evidence internally, resolve or accept the concern, then re-decide before an external handoff.",
  "track-recorded-followup":
    "A follow-up was recorded (accepted-with-notes / an acknowledged-with-followup acknowledgement / a note class). Track it to closure in your system of record while proceeding.",
  "proceed-with-handoff-out-of-band":
    "The decision supports proceeding. Perform the ACTUAL handoff / promotion / deployment OUT OF BAND with your release tooling — this record decides nothing beyond the bounded posture and performs no promotion.",
  "obtain-external-approval-out-of-band":
    "This is a decision RECORD, NOT an external approval / signature / legal-compliance sign-off / promotion. Obtain any required approval SEPARATELY, with your approval tooling.",
  "keep-decision-record":
    "Keep this content-free record as the release decision ledger entry — it is a bounded record of what was decided (and why), safe to forward to any downstream system verbatim.",
};

/**
 * Out-of-scope steps this record does NOT perform — authored, never derived. Printed so an operator never mistakes a
 * decision record for an approval / signature / promotion / deployment.
 */
export const RELEASE_DECISION_GUIDANCE: readonly string[] = [
  "Obtaining an EXTERNAL SIGNATURE, an APPROVAL, or a LEGAL / COMPLIANCE sign-off is out of band — this record composes an operator's own content-free publish pack + acknowledgement into one decision posture; it is not a signature or an approval.",
  "ACTUALLY PROMOTING / DEPLOYING / PUBLISHING the release is out of band — do it with your release tooling after any required approval. A `proceed` decision authorizes none of it.",
  "RECORDING the decision in a release ledger / system of record, NOTIFYING stakeholders, or opening a ticket is out of band — this tool writes only its own content-free output and sends nothing.",
  "VERIFYING the underlying evidence is the upstream tools' job (gate → artifact → … → publish-pack → ack); this only re-validates the pack + acknowledgement against themselves, cross-checks their coherence, and records the composite decision.",
];

/** Honesty caveats — authored, never derived from any ingested document. */
export const RELEASE_DECISION_CAVEATS: readonly string[] = [
  "This is a local, offline, READ-ONLY release decision RECORD — NOT an external signature, a legal / compliance approval, an identity attestation, an actual deployment / promotion, or a compliance sign-off. It RECORDS a composite decision posture over two content-free documents; it authorizes nothing.",
  "It INGESTS a content-free `pdfxyz.release-publish-pack/1` (Phase 57) and a `pdfxyz.release-ack/1` (Phase 58), RE-VALIDATES each against ITSELF (a hand-flipped verdict / disclosure / decision is caught as a tamper ⇒ `invalid`), CROSS-CHECKS that the acknowledgement corresponds to the supplied pack, and folds them into ONE bounded decision + a next-action checklist.",
  "It makes no network call, signs nothing, approves nothing, publishes nothing, promotes nothing, deploys nothing, notifies no one, and mutates nothing.",
  "It never fabricates a `proceed`: a `proceed` REQUIRES a usable `publishable` (share-safe) pack AND a usable clean `accepted` acknowledgement AND a matching cross-check. It FAILS CLOSED — a missing / unreadable / tampered document, or an acknowledgement that does not correspond to the supplied pack, is `invalid`, never a vacuous pass.",
  "The re-derivation is TAMPER-EVIDENCE over content-free data, NOT a cryptographic signature — there is no signing key and no attested identity, so a `proceed` decision is not proof of authenticity or provenance; a fully-coherent rewrite of BOTH documents' own facts is beyond self-consistency. Anchor deeper trust in the upstream signed / archived evidence.",
  "It is content-free by construction: no reviewer name / email, no path, no object key, no bucket, no URL, no raw note text, no provider error, no log, and no document / OCR content — only bounded enums, small counts, an ISO stamp, and app-authored prose; it never echoes an ingested document's own stamp, and it never echoes an input file path, even on an error.",
];
