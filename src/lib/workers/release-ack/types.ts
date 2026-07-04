/**
 * The bounded, content-free vocabulary for the secure-worker **release evidence handoff acknowledgement receipt**
 * (Phase 58).
 *
 * Phases 46–57 built the release-evidence chain one rung per phase: the release gate folds the content-free worker
 * checks into ONE promotion verdict; the artifact stamps it with provenance + an integrity digest; the index, policy,
 * CI bundle, audit, operator report, trend summary, governance bundle, archive pack, and restore drill each compose
 * or re-verify the layer below; and the publish / handoff pack (`pdfxyz.release-publish-pack/1`, Phase 57) composes
 * the governance bundle + related records into ONE share-safe, content-free MANIFEST an operator hands to an external
 * reviewer / approver / investor / incident responder, with a DISCLOSURE CLASSIFICATION (share-safe / internal-review
 * / blocked).
 *
 * This phase closes the *acknowledgement* loop. After a publish pack is handed off (or received), an operator needs a
 * local, content-free RECORD that the package was reviewed / received and what bounded decision was chosen — a
 * counterpart to a return receipt. This tool INGESTS a `pdfxyz.release-publish-pack/1`, RE-VALIDATES it against ITSELF
 * (reusing the Phase 57 rollup, so a hand-flipped verdict / disclosure is caught as a tamper), applies a bounded
 * acknowledgement DECISION the operator supplies, and emits ONE stable, content-free `pdfxyz.release-ack/1` receipt —
 *
 *    "This publish pack was reviewed / received; here is the bounded outcome (accepted / needs-changes / …) and what
 *     to do next."
 *
 * — with an acknowledgement verdict, a bounded source summary (the pack's own verdict / disclosure / source counts),
 * the recorded decision + reviewer CLASS + note CLASS, a next-action checklist, and honesty caveats. It FAILS CLOSED:
 * it never vacuous-passes a missing / unreadable / tampered pack (that is `invalid`), and only an `accepted` decision
 * over a `publishable` (share-safe) pack yields a clean `acknowledged`.
 *
 * It obeys the same honesty contract as the rest of the worker layer and is as content-free as the pack it
 * acknowledges:
 *  - Every load-bearing token here is a bounded enum — an acknowledgement verdict, a decision, a reviewer class, a
 *    note class, a pack state, a severity, a reason id, a checklist id — never a reviewer name / email, a filename,
 *    path, object key, bucket, URL, endpoint, region, id, token, size, byte, raw ref, raw label, raw note text, or
 *    digest. The only non-enum values are small integer counts, an ISO stamp, and app-authored prose.
 *  - It never copies a free-text field out of the ingested pack (even one Phase 57 produced is UNTRUSTED input here);
 *    it reduces every fact to a bounded enum, a small integer, or a boolean, and it never echoes the pack's OWN stamp
 *    (the receipt carries only its own) or an input file path, even on an error.
 *  - It never fabricates an `acknowledged`. A clean `acknowledged` REQUIRES a usable publish pack whose own verdict is
 *    `publishable` AND an `accepted` decision with no note; anything else is `acknowledged-with-followup` / `deferred`
 *    / `rejected`, and a missing / unreadable / tampered pack is `invalid` (fail-closed).
 *
 * It is deliberately NOT an external signature, NOT an approval, NOT an identity attestation, NOT legal / compliance
 * sign-off, NOT release promotion, and NOT actual publication. It records that an operator ACKNOWLEDGED a content-free
 * publish pack and what bounded decision they chose; the reviewer is a bounded CLASS, never an identity. Its authored
 * caveats (see {@link RELEASE_ACK_CAVEATS}) say so out loud: it is a local content-free acknowledgement RECEIPT — it
 * never signs, approves, publishes, promotes, notifies, or mutates anything.
 */

import {
  RELEASE_PUBLISH_PACK_DISCLOSURES,
  RELEASE_PUBLISH_PACK_SCHEMA,
  RELEASE_PUBLISH_PACK_VERDICTS,
  type ReleasePublishPackDisclosure,
  type ReleasePublishPackVerdict,
} from "../release-publish-pack/types";

/** The schema tag every release-ack receipt carries, so tooling can pin the shape it parses. */
export const RELEASE_ACK_SCHEMA = "pdfxyz.release-ack/1" as const;

/** The upstream document schema the receipt acknowledges. Re-exported so the result can pin the input shape. */
export { RELEASE_PUBLISH_PACK_SCHEMA };

/** Stable identity of the release-ack — for docs / receipts / audit. */
export const RELEASE_ACK_POLICY_ID = "pdfxyz-worker-release-ack";
/** Bump when the surface, the verdict ladder, the decision / reviewer / note / reason / checklist sets, or the schema changes. */
export const RELEASE_ACK_POLICY_VERSION = 1;

/** Re-exported for convenience (the upstream pack verdict + disclosure enums the source summary surfaces). */
export type { ReleasePublishPackVerdict, ReleasePublishPackDisclosure };
export { RELEASE_PUBLISH_PACK_VERDICTS, RELEASE_PUBLISH_PACK_DISCLOSURES };

/**
 * The bounded acknowledgement DECISION an operator records — the one required knob. It is the operator's stance on the
 * handed-off / received publish pack, NOT a claim the release is correct / secure / compliant:
 *  - `accepted`            — the pack was reviewed / received and accepted as-is (no follow-up);
 *  - `accepted-with-notes` — accepted, but with a recorded follow-up (an advisory concern to track, not a block);
 *  - `needs-changes`       — the pack is not acceptable as-is; changes are required before it can be accepted (a block);
 *  - `rejected`            — the pack is rejected (a block);
 *  - `deferred`            — the decision is postponed (e.g. pending more evidence / a later review window).
 */
export const RELEASE_ACK_DECISIONS = [
  "accepted",
  "accepted-with-notes",
  "needs-changes",
  "rejected",
  "deferred",
] as const;
export type ReleaseAckDecision = (typeof RELEASE_ACK_DECISIONS)[number];

/**
 * The bounded reviewer CLASS — a role, never an identity. Recorded so a handoff log knows the KIND of party that
 * acknowledged the pack without ever storing a name / email / handle:
 *  - `internal-approver`  — an internal release approver / owner;
 *  - `external-reviewer`  — an external reviewer / auditor;
 *  - `incident-responder` — an incident / on-call responder;
 *  - `partner`            — an investor / partner;
 *  - `unknown`            — unspecified (the honest default).
 */
export const RELEASE_ACK_REVIEWERS = [
  "internal-approver",
  "external-reviewer",
  "incident-responder",
  "partner",
  "unknown",
] as const;
export type ReleaseAckReviewer = (typeof RELEASE_ACK_REVIEWERS)[number];

/**
 * The bounded note CLASS — a follow-up category, never free text. Recorded so a handoff log knows the KIND of
 * follow-up without ever storing a note body:
 *  - `none`                 — no follow-up (the default);
 *  - `operational-follow-up`— an operational task to track;
 *  - `evidence-gap`         — a gap in the evidence to close;
 *  - `policy-follow-up`     — a policy / process follow-up;
 *  - `legal-review`         — a legal / compliance review is needed (out of band — this tool performs none);
 *  - `security-review`      — a security review is needed (out of band).
 */
export const RELEASE_ACK_NOTES = [
  "none",
  "operational-follow-up",
  "evidence-gap",
  "policy-follow-up",
  "legal-review",
  "security-review",
] as const;
export type ReleaseAckNote = (typeof RELEASE_ACK_NOTES)[number];

/**
 * The single acknowledgement verdict a handoff log / CI keys on — the answer to "what did this acknowledgement
 * conclude?":
 *  - `acknowledged`               — an `accepted` decision over a usable, `publishable` (share-safe) pack, with no
 *                                   follow-up note: the package was reviewed / received and accepted clean. It is
 *                                   NOT an external signature / approval / promotion;
 *  - `acknowledged-with-followup` — accepted, but with a recorded follow-up (an `accepted-with-notes` decision, a
 *                                   `review` pack, or a note class): acknowledged, track the follow-up;
 *  - `deferred`                   — the decision was `deferred`, or the pack is `incomplete` (insufficient evidence):
 *                                   revisit after the evidence / decision is complete;
 *  - `rejected`                   — the decision was `rejected` / `needs-changes`, the pack is `blocked`, or `--strict`
 *                                   escalated a non-clean posture: do NOT proceed;
 *  - `invalid`                    — the input could not be trusted: no pack, an unreadable pack, or a tampered pack
 *                                   (recognized but its recorded verdict does NOT re-derive). Never a vacuous pass.
 *
 * These are the exact bounded values the run-level `worker_release_ack_total` metric carries as its `verdict` label;
 * all five are low-cardinality, redaction-stable tokens.
 */
export const RELEASE_ACK_VERDICTS = [
  "acknowledged",
  "acknowledged-with-followup",
  "deferred",
  "rejected",
  "invalid",
] as const;
export type ReleaseAckVerdict = (typeof RELEASE_ACK_VERDICTS)[number];

/**
 * The exit-code ladder a CI / handoff job routes on — the same shape as the whole release-evidence suite so the tools
 * speak one language:
 *  - `0` ACKNOWLEDGED               — an `accepted` decision over a share-safe pack, no follow-up;
 *  - `1` USAGE                      — the CLI was misused (a bad flag, no pack, a missing / duplicate decision, or an
 *                                     unwritable output). CLI-owned; an ack RUN never resolves to it;
 *  - `2` DEFERRED                   — the decision was deferred, or the pack is incomplete (insufficient);
 *  - `3` ACKNOWLEDGED_WITH_FOLLOWUP — accepted with a recorded follow-up (advisory);
 *  - `4` REJECTED                   — rejected / needs-changes / a blocked pack / a strict violation (blocking);
 *  - `4` INVALID                    — a missing / unreadable / tampered pack (input can't be trusted).
 *
 * Monotonic in badness within each band; `deferred` (2, insufficient) sorts before `acknowledged-with-followup` (3,
 * advisory) exactly like the rest of the suite folds insufficiency before advisory. `rejected` and `invalid` share
 * the top code `4` but are distinct verdicts (a rejected VALID pack vs an untrustworthy input).
 */
export const RELEASE_ACK_EXIT = {
  ACKNOWLEDGED: 0,
  USAGE: 1,
  DEFERRED: 2,
  ACKNOWLEDGED_WITH_FOLLOWUP: 3,
  REJECTED: 4,
  INVALID: 4,
} as const;
export type ReleaseAckExitCode = (typeof RELEASE_ACK_EXIT)[keyof typeof RELEASE_ACK_EXIT];

/** The authoritative verdict → exit code map. */
export const RELEASE_ACK_EXIT_FOR_VERDICT: Record<ReleaseAckVerdict, ReleaseAckExitCode> = {
  acknowledged: RELEASE_ACK_EXIT.ACKNOWLEDGED,
  "acknowledged-with-followup": RELEASE_ACK_EXIT.ACKNOWLEDGED_WITH_FOLLOWUP,
  deferred: RELEASE_ACK_EXIT.DEFERRED,
  rejected: RELEASE_ACK_EXIT.REJECTED,
  invalid: RELEASE_ACK_EXIT.INVALID,
};

/**
 * The bounded state of the ingested publish pack (the single acknowledged source):
 *  - `absent`     — no pack was supplied (the CLI requires one, so a RUN never sees this; modelled for completeness);
 *  - `unreadable` — a pack was supplied but could not be read / parsed / recognized as `pdfxyz.release-publish-pack/1`
 *                   (never echoed);
 *  - `tampered`   — recognized but its recorded rollup / coverage does NOT re-derive from its own sources (a
 *                   hand-edited / corrupt pack — the input can't be trusted);
 *  - `usable`     — recognized AND self-consistent (its recorded rollup re-derives): a trustworthy pack to acknowledge.
 */
export const RELEASE_ACK_PACK_STATES = ["absent", "unreadable", "tampered", "usable"] as const;
export type ReleaseAckPackState = (typeof RELEASE_ACK_PACK_STATES)[number];

/**
 * The common **severity** each fired reason maps onto so the fold can resolve the pack posture + the decision + the
 * note into one verdict, with precedence `invalid > blocking > insufficient > advisory` (checked in that order — so
 * an untrustworthy input never masquerades as a mere rejection, an insufficiency never as an advisory, and a real
 * blocker is never masked). No reason firing ⇒ a clean `acknowledged`.
 *  - `advisory`     — a recorded follow-up (accepted-with-notes / a review pack / a note class) → acknowledged-with-followup;
 *  - `insufficient` — a deferred decision or an incomplete pack → deferred;
 *  - `blocking`     — a rejected / needs-changes decision or a blocked pack → rejected;
 *  - `invalid`      — a missing / unreadable / tampered pack (the input itself can't be trusted) → invalid (worst).
 */
export const RELEASE_ACK_SEVERITIES = ["advisory", "insufficient", "blocking", "invalid"] as const;
export type ReleaseAckSeverity = (typeof RELEASE_ACK_SEVERITIES)[number];

/** The severity rank (higher = worse) — used for the fold precedence. */
export const RELEASE_ACK_SEVERITY_RANK: Record<ReleaseAckSeverity, number> = {
  advisory: 0,
  insufficient: 1,
  blocking: 2,
  invalid: 3,
};

/**
 * The bounded reason ids — the closed set of REASONS the acknowledgement verdict resolved as it did, emitted in this
 * stable order (a superset view, so a reviewer sees every condition that applied, not only the winning one). The
 * per-id severity is authored in {@link RELEASE_ACK_REASON_DETAIL}:
 *
 * Invalid input (the pack can't be trusted):
 *  - `pack-missing`     — no publish pack was supplied;
 *  - `pack-unreadable`  — the supplied pack could not be read / recognized;
 *  - `pack-tampered`    — the pack is recognized but its recorded verdict does NOT re-derive from its own sources.
 *
 * Blocking (do not proceed):
 *  - `pack-blocked`            — the usable pack's own verdict is `blocked` (its disclosure is do-not-share);
 *  - `decision-needs-changes`  — the operator's decision is `needs-changes`;
 *  - `decision-rejected`       — the operator's decision is `rejected`.
 *
 * Insufficient (revisit later):
 *  - `pack-incomplete`   — the usable pack's own verdict is `incomplete` (insufficient evidence);
 *  - `decision-deferred` — the operator's decision is `deferred`.
 *
 * Advisory (acknowledged, track a follow-up):
 *  - `pack-review`                 — the usable pack's own verdict is `review` (needs internal review);
 *  - `decision-accepted-with-notes`— the operator's decision is `accepted-with-notes`;
 *  - `note-followup`               — a non-`none` note class was recorded (a follow-up to track).
 */
export const RELEASE_ACK_REASON_IDS = [
  // Invalid input
  "pack-missing",
  "pack-unreadable",
  "pack-tampered",
  // Blocking
  "pack-blocked",
  "decision-needs-changes",
  "decision-rejected",
  // Insufficient
  "pack-incomplete",
  "decision-deferred",
  // Advisory
  "pack-review",
  "decision-accepted-with-notes",
  "note-followup",
] as const;
export type ReleaseAckReasonId = (typeof RELEASE_ACK_REASON_IDS)[number];

/**
 * The bounded next-action checklist ids — the closed set of concrete steps to complete (or hold) after the
 * acknowledgement, in this canonical order (the checklist is emitted in this order, deduped):
 *  - `resolve-input-before-acknowledging`   — the input can't be trusted; recover a valid, untampered publish pack and
 *                                             re-run (an acknowledgement over an untrusted input is meaningless);
 *  - `do-not-proceed-on-rejection`          — this acknowledgement is a REJECTION (or the pack is blocked); do NOT hand
 *                                             off / promote; resolve the cause and re-run;
 *  - `complete-evidence-before-proceeding`  — the pack is incomplete or the decision was deferred; complete the missing
 *                                             evidence or revisit the deferral before an external handoff;
 *  - `track-recorded-followup`              — a follow-up was recorded (accepted-with-notes / a review pack / a note
 *                                             class); track it to closure;
 *  - `record-acknowledgement`               — record this content-free acknowledgement in the handoff / SIEM log;
 *  - `obtain-external-approval-out-of-band` — this is an acknowledgement RECEIPT, NOT an external approval / signature /
 *                                             legal sign-off / promotion; obtain any required approval SEPARATELY;
 *  - `keep-ack-receipt`                     — keep this content-free receipt as the acknowledgement record (always).
 */
export const RELEASE_ACK_CHECKLIST_IDS = [
  "resolve-input-before-acknowledging",
  "do-not-proceed-on-rejection",
  "complete-evidence-before-proceeding",
  "track-recorded-followup",
  "record-acknowledgement",
  "obtain-external-approval-out-of-band",
  "keep-ack-receipt",
] as const;
export type ReleaseAckChecklistId = (typeof RELEASE_ACK_CHECKLIST_IDS)[number];

/* ------------------------------------------------------------------ *
 *  Reduced source, acknowledgement, rollup, receipt, result
 * ------------------------------------------------------------------ */

/**
 * The bounded summary of the acknowledged publish pack — the pack's own posture, reduced to bounded enums + small
 * integers. Never a raw value from the input.
 */
export interface ReleaseAckSource {
  /** The pack's ingest state (absent / unreadable / tampered / usable). */
  readonly state: ReleaseAckPackState;
  /** True iff a pack file was supplied (independent of whether it parsed / recognized). */
  readonly supplied: boolean;
  /** True iff the parsed input carried the `pdfxyz.release-publish-pack/1` schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND self-consistent (its recorded rollup re-derives). */
  readonly usable: boolean;
  /**
   * The pack's own publish verdict (a bounded enum), or `null`. Trusted only when `usable`; for a `tampered` pack it
   * is the untrusted CLAIMED verdict (surfaced so the summary shows what was asserted).
   */
  readonly packVerdict: ReleasePublishPackVerdict | null;
  /** The pack's own disclosure classification, or `null`. Trusted only when `usable`; untrusted claim when tampered. */
  readonly disclosure: ReleasePublishPackDisclosure | null;
  /** How many evidence sources the pack recorded as supplied (0–5; 0 when the pack is unreadable / absent). */
  readonly sourcesSupplied: number;
  /** How many evidence sources the pack recorded as usable (0–5; 0 when the pack is unreadable / absent). */
  readonly sourcesUsable: number;
  /** A one-line, content-free headline authored from the pack state + verdict. */
  readonly detail: string;
}

/** The bounded acknowledgement the operator supplied (from the validated args). */
export interface ReleaseAckAcknowledgement {
  /** The required decision. */
  readonly decision: ReleaseAckDecision;
  /** The reviewer CLASS (a role, never an identity). Defaults `unknown`. */
  readonly reviewer: ReleaseAckReviewer;
  /** The note CLASS (a follow-up category, never free text). Defaults `none`. */
  readonly note: ReleaseAckNote;
  /** True iff `--strict` was set (only `accepted` over a `publishable` pack may pass). */
  readonly strict: boolean;
  /** True iff a follow-up was recorded (`accepted-with-notes` decision OR a non-`none` note class). */
  readonly hasFollowup: boolean;
}

/** One fired reason, with its resolved severity + authored detail. */
export interface ReleaseAckReason {
  readonly id: ReleaseAckReasonId;
  readonly severity: ReleaseAckSeverity;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** One next-action checklist step, with its authored detail. */
export interface ReleaseAckChecklistItem {
  readonly id: ReleaseAckChecklistId;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** The composite acknowledgement decision — the single verdict + exit code a handoff log acts on. */
export interface ReleaseAckRollup {
  readonly verdict: ReleaseAckVerdict;
  readonly exitCode: ReleaseAckExitCode;
  /** True iff `verdict === "acknowledged"` (a clean acceptance of a share-safe pack). */
  readonly acknowledged: boolean;
  /** The fired reason ids, in canonical order (empty on a clean `acknowledged`). */
  readonly reasons: readonly ReleaseAckReasonId[];
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
   * True iff `--strict` ESCALATED an `acknowledged-with-followup` or `deferred` posture to `rejected`. Surfaced so the
   * summary explains the escalation (the ack would be that posture without the flag).
   */
  readonly strictEscalated: boolean;
  /** Which posture `--strict` escalated FROM, or `null` when no escalation applied. */
  readonly strictEscalatedFrom: "acknowledged-with-followup" | "deferred" | null;
  readonly detail: string;
}

/** The stable identity block the result records (with the pinned upstream publish-pack schema). */
export interface ReleaseAckMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_ACK_POLICY_ID;
  readonly policyVersion: typeof RELEASE_ACK_POLICY_VERSION;
  readonly publishPackSchema: typeof RELEASE_PUBLISH_PACK_SCHEMA;
}

/**
 * The stable, content-free release evidence handoff acknowledgement receipt. Every field is a bounded enum, a small
 * integer, an ISO stamp, or app-authored prose — so it carries no reviewer identity, locator, size, path, or byte,
 * even from a hostile input, and never echoes the ingested pack's own stamp.
 */
export interface ReleaseAckResult {
  readonly schema: typeof RELEASE_ACK_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleaseAckMetadata;
  /** The bounded acknowledgement the operator supplied (decision + reviewer class + note class + strict). */
  readonly acknowledgement: ReleaseAckAcknowledgement;
  /** The bounded summary of the acknowledged publish pack (its own verdict / disclosure / source counts). */
  readonly source: ReleaseAckSource;
  readonly ack: ReleaseAckRollup;
  /** Every fired reason, in canonical {@link RELEASE_ACK_REASON_IDS} order. */
  readonly reasons: readonly ReleaseAckReason[];
  /** The bounded, ordered next-action checklist. Never derived from an input. */
  readonly checklist: readonly ReleaseAckChecklistItem[];
  /** Bounded, app-authored guidance (out-of-scope steps this receipt does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from any ingested document. */
  readonly caveats: readonly string[];
  /** The flattened, content-free receipt (safe to log / forward verbatim). */
  readonly receipt: ReleaseAckReceipt;
}

/**
 * The content-free **receipt** the result rides alongside its body — the flattened answer to "what did this
 * acknowledgement conclude, over which pack" for a SIEM / handoff record. Bounded enums + small integers + a stable
 * policy id + the run's own stamp only (ack verdict + the source pack's verdict / disclosure + source counts); safe to
 * log or forward verbatim.
 */
export interface ReleaseAckReceipt {
  readonly category: "worker-release-ack";
  readonly policyId: typeof RELEASE_ACK_POLICY_ID;
  readonly policyVersion: typeof RELEASE_ACK_POLICY_VERSION;
  readonly at: string;
  readonly verdict: ReleaseAckVerdict;
  readonly exitCode: ReleaseAckExitCode;
  /** The source pack's own publish verdict (trusted only when usable; the claim when tampered; `null` if unreadable). */
  readonly packVerdict: ReleasePublishPackVerdict | null;
  /** The source pack's disclosure classification, or `null` if unreadable. */
  readonly packDisclosure: ReleasePublishPackDisclosure | null;
  /** How many evidence sources the pack recorded as supplied (0–5). */
  readonly sourcesSupplied: number;
  /** How many evidence sources the pack recorded as usable (0–5). */
  readonly sourcesUsable: number;
}

/** The process exit code for an ack result. */
export function releaseAckExitCode(result: ReleaseAckResult): number {
  return result.ack.exitCode;
}

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from any ingested document)
 * ------------------------------------------------------------------ */

/** The one-line verdict headline. Authored here, keyed by the enum. */
export const RELEASE_ACK_VERDICT_SUMMARY: Record<ReleaseAckVerdict, string> = {
  acknowledged:
    "ACKNOWLEDGED: an `accepted` decision over a usable, PUBLISHABLE (share-safe) publish pack with no follow-up note — the package was reviewed / received and accepted clean. This is a content-free acknowledgement RECEIPT, NOT an external signature, an approval, a legal / compliance sign-off, an identity attestation, or a release promotion; obtain any required approval out of band.",
  "acknowledged-with-followup":
    "ACKNOWLEDGED WITH FOLLOW-UP: accepted, but a follow-up was recorded — the decision was `accepted-with-notes`, the pack is `review` (needs internal review), or a note class was attached. Acknowledge and TRACK the follow-up to closure; this is still not an external approval.",
  deferred:
    "DEFERRED: the decision was `deferred`, or the pack is INCOMPLETE (insufficient evidence). Revisit the acknowledgement after the missing evidence is supplied or the deferral is resolved — this is not an acceptance.",
  rejected:
    "REJECTED: the decision was `rejected` / `needs-changes`, the pack is BLOCKED (do-not-share), or `--strict` escalated a non-clean posture. Do NOT hand off / promote the release on the strength of this pack until the cause is resolved.",
  invalid:
    "INVALID: the input could not be trusted — no publish pack, an unreadable pack, or a TAMPERED pack (recognized but its recorded verdict does NOT re-derive from its own sources). An acknowledgement over an untrustworthy input is meaningless; recover a valid pack and re-run. This is never a vacuous pass.",
};

/**
 * The dedicated headline for a `rejected` ack produced ONLY because `--strict` escalated an
 * `acknowledged-with-followup` or `deferred` posture — there was no explicit rejection / needs-changes / blocked pack,
 * so the generic `rejected` summary would misrepresent the cause. Authored; selected by the rollup when
 * `strictEscalated`.
 */
export const RELEASE_ACK_STRICT_ESCALATED_SUMMARY: Record<"acknowledged-with-followup" | "deferred", string> = {
  "acknowledged-with-followup":
    "REJECTED (--strict): the only concern was a recorded FOLLOW-UP (accepted-with-notes / a review pack / a note class), which `--strict` escalates to a rejection — under `--strict` only a clean `accepted` over a `publishable` pack may pass. Without `--strict` this would be ACKNOWLEDGED WITH FOLLOW-UP, exit 3. No explicit rejection, needs-changes, or blocked pack was found.",
  deferred:
    "REJECTED (--strict): the posture was DEFERRED / INSUFFICIENT (a deferred decision or an incomplete pack), which `--strict` escalates to a rejection — under `--strict` only a clean `accepted` over a `publishable` pack may pass. Without `--strict` this would be DEFERRED, exit 2. Supply the missing evidence or record an explicit `accepted` over a share-safe pack to acknowledge.",
};

/** A one-line, content-free headline authored from the pack state + verdict. */
export const RELEASE_ACK_SOURCE_DETAIL: Record<ReleaseAckPackState, string> = {
  absent: "no publish pack supplied — nothing to acknowledge.",
  unreadable:
    "a pack was supplied but is NOT a recognized `pdfxyz.release-publish-pack/1` (unreadable — never echoed); it cannot be acknowledged.",
  tampered:
    "the pack is recognized but its recorded verdict does NOT re-derive from its own sources (tampered / corrupt); it cannot be trusted or acknowledged.",
  usable: "a self-consistent `pdfxyz.release-publish-pack/1` (its recorded verdict re-derives).",
};

/** Per-reason authored detail + resolved severity, keyed by id. */
export const RELEASE_ACK_REASON_DETAIL: Record<
  ReleaseAckReasonId,
  { readonly severity: ReleaseAckSeverity; readonly detail: string }
> = {
  "pack-missing": {
    severity: "invalid",
    detail:
      "No `pdfxyz.release-publish-pack/1` was supplied. There is nothing to acknowledge — an acknowledgement over no pack is meaningless. Supply a publish pack and re-run.",
  },
  "pack-unreadable": {
    severity: "invalid",
    detail:
      "The supplied pack could not be read / parsed / recognized as a `pdfxyz.release-publish-pack/1` (its content is never echoed). It cannot be acknowledged; recover a valid pack from a second copy and re-run.",
  },
  "pack-tampered": {
    severity: "invalid",
    detail:
      "The supplied pack is recognized but its recorded verdict / disclosure does NOT re-derive from its own reduced sources — a hand-edited or corrupt pack. An acknowledgement over a tampered pack would misrepresent the release; recover the untampered pack and re-run.",
  },
  "pack-blocked": {
    severity: "blocking",
    detail:
      "The usable pack's own verdict is BLOCKED (disclosure do-not-share): a tamper / failure in the underlying evidence means the pack must not be shared. Do not hand off / promote on the strength of this pack; resolve the block and re-run.",
  },
  "decision-needs-changes": {
    severity: "blocking",
    detail:
      "The operator's decision is NEEDS-CHANGES: the pack is not acceptable as-is. Do not proceed until the required changes are made and a new pack is acknowledged.",
  },
  "decision-rejected": {
    severity: "blocking",
    detail:
      "The operator's decision is REJECTED: the pack is not accepted. Do not hand off / promote on the strength of this pack.",
  },
  "pack-incomplete": {
    severity: "insufficient",
    detail:
      "The usable pack's own verdict is INCOMPLETE (insufficient evidence — e.g. an absent / unreadable / incomplete governance bundle). There is not enough to fully acknowledge; complete the evidence and re-run, or record an explicit decision.",
  },
  "decision-deferred": {
    severity: "insufficient",
    detail:
      "The operator's decision is DEFERRED: the acknowledgement is postponed (e.g. pending more evidence or a later review window). Revisit before an external handoff.",
  },
  "pack-review": {
    severity: "advisory",
    detail:
      "The usable pack's own verdict is REVIEW (internal-review): an advisory concern was raised. Accepting it is an acknowledgement WITH a follow-up to review internally — not a clean external bill of health.",
  },
  "decision-accepted-with-notes": {
    severity: "advisory",
    detail:
      "The operator's decision is ACCEPTED-WITH-NOTES: accepted with a recorded follow-up to track. It is acknowledged, but not a clean acceptance.",
  },
  "note-followup": {
    severity: "advisory",
    detail:
      "A follow-up note class was recorded (a bounded category, never free text). Track the follow-up to closure; the acknowledgement carries an open item.",
  },
};

/** Per-checklist-id authored detail, keyed by id. */
export const RELEASE_ACK_CHECKLIST_DETAIL: Record<ReleaseAckChecklistId, string> = {
  "resolve-input-before-acknowledging":
    "The input could not be trusted (no pack, an unreadable pack, or a tampered pack). Recover a valid, untampered `pdfxyz.release-publish-pack/1` and re-run — an acknowledgement over an untrustworthy input is meaningless.",
  "do-not-proceed-on-rejection":
    "This acknowledgement is a REJECTION (rejected / needs-changes / a blocked pack / a strict violation). Do NOT hand off or promote the release on the strength of this pack; resolve the cause and re-run.",
  "complete-evidence-before-proceeding":
    "The pack is incomplete or the decision was deferred. Complete the missing evidence (or revisit the deferral) before an external handoff, then re-run.",
  "track-recorded-followup":
    "A follow-up was recorded (accepted-with-notes, a review pack, or a note class). Track it to closure in your system of record.",
  "record-acknowledgement":
    "Record this content-free acknowledgement in the handoff / SIEM log so the outcome is auditable (the reviewer is a bounded class, never an identity).",
  "obtain-external-approval-out-of-band":
    "This is an acknowledgement RECEIPT, NOT an external approval / signature / legal-compliance sign-off / release promotion. Obtain any required approval SEPARATELY, with your approval tooling.",
  "keep-ack-receipt":
    "Keep this content-free receipt as the acknowledgement record — it is safe to forward to any downstream system verbatim.",
};

/**
 * Out-of-scope steps this receipt does NOT perform — authored, never derived. Printed so an operator never mistakes
 * an acknowledgement receipt for an approval / signature / promotion.
 */
export const RELEASE_ACK_GUIDANCE: readonly string[] = [
  "Obtaining an EXTERNAL SIGNATURE, an APPROVAL, or a LEGAL / COMPLIANCE sign-off is out of band — this receipt records an operator's bounded acknowledgement, not a signature or an approval.",
  "ACTUALLY PUBLISHING / PROMOTING / DEPLOYING the release is out of band — do it with your release tooling after any required approval.",
  "NOTIFYING the reviewer / approver, opening a ticket, or archiving the receipt in a system of record is out of band — this tool sends nothing.",
  "VERIFYING the underlying evidence is the upstream tools' job (gate → artifact → … → publish-pack); this only acknowledges a publish pack's bounded, self-consistent posture.",
];

/** Honesty caveats — authored, never derived from any ingested document. */
export const RELEASE_ACK_CAVEATS: readonly string[] = [
  "This is a local, offline, READ-ONLY acknowledgement RECEIPT — NOT an external signature, a legal / compliance approval, an identity attestation, or a release promotion.",
  "It records THAT an operator reviewed / received a content-free publish pack and WHAT bounded decision they chose; it does NOT prove WHO reviewed it — the reviewer is a bounded CLASS (a role), never a name / email / identity.",
  "It makes no network call, signs nothing, approves nothing, publishes nothing, promotes nothing, notifies no one, and mutates nothing.",
  "It re-validates the publish pack against itself, so a hand-flipped verdict / disclosure is caught as `invalid`; but a fully-coherent rewrite of the pack's own reduced sources is beyond self-consistency — anchor trust in the upstream signed / archived evidence.",
  "An `acknowledged` verdict means an operator ACCEPTED a share-safe pack; it is NOT a statement that the release is correct, secure, or compliant.",
  "It is content-free by construction: no reviewer name / email, no path, no object key, no bucket, no URL, no raw note text, no provider error, no log, and no document / OCR content.",
];
