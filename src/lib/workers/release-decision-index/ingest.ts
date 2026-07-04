/**
 * Pure, node-free **record ingest** for the release decision ledger index (Phase 60) — the trust boundary and the
 * no-leak core.
 *
 * The index indexes a bounded batch of `pdfxyz.release-decision/1` decision records. Even though each record is
 * already content-free, every one is UNTRUSTED input here (a CI archive an operator points us at, a committed
 * record, or a hand-crafted / tampered file), and this module turns each parsed root into a bounded ingested shape,
 * in the same paranoid spirit as the rest of the worker ingest layer:
 *  - **No-leak by reconstruction.** It NEVER copies a free-text field out of a record. Every recorded fact is
 *    validated against a bounded enum or reduced to a non-negative integer / boolean. Prose, caveats, guidance, the
 *    record's OWN stamp, and any stray extra field are all DROPPED.
 *  - **Reuse the tested boundary.** It RE-RUNS the Phase 59 {@link computeDecisionRollup} over the record's OWN
 *    recorded pack + acknowledgement summaries (each reduced to its bounded `state` + verdict / decision / note) +
 *    the recorded cross-check status + the recorded `strict` flag, and marks the record `usable` only if the
 *    recorded decision (decision, exit code, reason set, invalid / blocking / insufficiency / advisory counts,
 *    strict-escalation position) re-derives — so a hand-flipped decision / lied count / hidden reason on a record
 *    is caught as self-inconsistent.
 *  - **Honest tri-state.** A non-object / wrong-schema input is `recognized = false` (⇒ an `unreadable` record);
 *    a recognized-but-inconsistent record is `recognized = true, usable = false` (⇒ a `tampered` record); a
 *    coherent record yields reduced bounded facts. The offending content is never echoed.
 *
 * A NOTE ON DEPTH: a decision record's own pack / acknowledgement summaries record only the bounded posture of the
 * two documents it composed (their states + verdict / decision / note), not the raw publish pack / ack — the
 * decision already reduced those away. So the DEEPEST self-consistency check available over a decision record is
 * re-deriving its DECISION from its own recorded (pack state + verdict, ack state + decision + note, cross-check,
 * strict); that is exactly what the Phase 59 rollup reducer reads, so re-running it is faithful tamper-evidence at
 * this boundary (the decision is the atom of evidence here, as the report was at Phase 53).
 *
 * SAFETY of the stripped reconstruction: {@link computeDecisionRollup} (via `deriveDecisionReasons`) reads ONLY the
 * pack's `state` + `verdict`, the acknowledgement's `state` + `decision` + `note`, the `crossCheck` status, and the
 * `strict` flag — never the pack's `disclosure` / source counts, the acknowledgement's `reviewer` / recorded-source
 * fields, nor any authored `detail`. So filling those with derived defaults cannot change the recompute; the
 * load-bearing fields are read faithfully from the record's own summaries. (Verified against
 * `release-decision/rollup.ts` — re-verify those field reads before trusting this reconstruction.)
 */

import { computeDecisionRollup } from "../release-decision/rollup";
import {
  RELEASE_ACK_DECISIONS,
  RELEASE_ACK_NOTES,
  RELEASE_DECISION_CROSS_CHECKS,
  RELEASE_DECISION_DECISIONS,
  RELEASE_DECISION_REASON_IDS,
  RELEASE_DECISION_SCHEMA,
  RELEASE_DECISION_SOURCE_STATES,
  RELEASE_PUBLISH_PACK_DISCLOSURES,
  RELEASE_PUBLISH_PACK_VERDICTS,
  type ReleaseAckDecision,
  type ReleaseAckNote,
  type ReleaseDecisionAckSummary,
  type ReleaseDecisionCrossCheckStatus,
  type ReleaseDecisionDecision,
  type ReleaseDecisionPackSummary,
  type ReleaseDecisionReasonId,
  type ReleaseDecisionRollup,
  type ReleaseDecisionSourceState,
  type ReleasePublishPackDisclosure,
  type ReleasePublishPackVerdict,
} from "../release-decision/types";
import type { DecisionRecordFacts } from "./types";

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Return `value` if it is one of `allowed`, else `undefined`. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** A strict non-negative safe integer, or `undefined`. */
function intOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Strictly `true` or `false`, or `undefined`. */
function boolOf(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** `null`, or one of `allowed`; anything else (a stray non-null off-enum value) is a corrupt field (`undefined`). */
function nullableOneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null | undefined {
  if (value === null) return null;
  return oneOf(value, allowed);
}

/** The bounded outcome of ingesting a `pdfxyz.release-decision/1` document. */
export interface IngestedDecision {
  /** True iff the input parsed to an object carrying the `pdfxyz.release-decision/1` schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND its recorded decision RE-DERIVES from its own summaries + cross-check + strict. */
  readonly usable: boolean;
  /** The record's recorded decision (its CLAIM), or `null` if unreadable. Surfaced even when tampered. */
  readonly decision: ReleaseDecisionDecision | null;
  /** The bounded reduced facts (present only when usable; `null` otherwise). */
  readonly facts: DecisionRecordFacts | null;
}

/** The bounded outcome for an input that was not a recognized `pdfxyz.release-decision/1`. */
export const UNRECOGNIZED_DECISION: IngestedDecision = {
  recognized: false,
  usable: false,
  decision: null,
  facts: null,
};

/** A recognized-but-inconsistent (tampered) record, carrying only its untrusted claimed decision. */
function inconsistentDecision(decision: ReleaseDecisionDecision | null): IngestedDecision {
  return { recognized: true, usable: false, decision, facts: null };
}

/**
 * Build a minimal, type-safe {@link ReleaseDecisionPackSummary} from its two load-bearing fields (+ derived
 * filler). The filler (`supplied` / `recognized` / `usable` / `disclosure` / source counts / `detail`) is NEVER read
 * by {@link computeDecisionRollup}, so it cannot change the recompute.
 */
function packSummaryFrom(
  state: ReleaseDecisionSourceState,
  verdict: ReleasePublishPackVerdict | null,
  disclosure: ReleasePublishPackDisclosure | null,
): ReleaseDecisionPackSummary {
  return {
    state,
    supplied: state !== "absent",
    recognized: state !== "absent" && state !== "unreadable",
    usable: state === "usable",
    verdict,
    disclosure,
    sourcesSupplied: 0,
    sourcesUsable: 0,
    detail: "",
  };
}

/**
 * Build a minimal, type-safe {@link ReleaseDecisionAckSummary} from its three load-bearing fields (+ derived
 * filler). The filler is NEVER read by {@link computeDecisionRollup}, so it cannot change the recompute.
 */
function ackSummaryFrom(
  state: ReleaseDecisionSourceState,
  decision: ReleaseAckDecision | null,
  note: ReleaseAckNote | null,
): ReleaseDecisionAckSummary {
  return {
    state,
    supplied: state !== "absent",
    recognized: state !== "absent" && state !== "unreadable",
    usable: state === "usable",
    ackVerdict: null,
    decision,
    reviewer: null,
    note,
    recordedPackVerdict: null,
    recordedDisclosure: null,
    recordedPackState: null,
    recordedSourcesSupplied: 0,
    recordedSourcesUsable: 0,
    detail: "",
  };
}

/** The reconstructed inputs the Phase 59 fold consumes, or `undefined` if any recorded field is off-enum. */
interface ReconstructedInputs {
  readonly pack: ReleaseDecisionPackSummary;
  readonly ack: ReleaseDecisionAckSummary;
  readonly crossCheck: ReleaseDecisionCrossCheckStatus;
}

/** Validate the record's `publishPack` + `acknowledgement` + `crossCheck` blocks into the reconstructed inputs. */
function reconstructInputs(root: Obj): ReconstructedInputs | undefined {
  const packObj = isObject(root.publishPack) ? root.publishPack : undefined;
  const ackObj = isObject(root.acknowledgement) ? root.acknowledgement : undefined;
  const crossObj = isObject(root.crossCheck) ? root.crossCheck : undefined;
  if (packObj === undefined || ackObj === undefined || crossObj === undefined) return undefined;

  const packState = oneOf(packObj.state, RELEASE_DECISION_SOURCE_STATES);
  const packVerdict = nullableOneOf(packObj.verdict, RELEASE_PUBLISH_PACK_VERDICTS);
  const packDisclosure = nullableOneOf(packObj.disclosure, RELEASE_PUBLISH_PACK_DISCLOSURES);
  const ackState = oneOf(ackObj.state, RELEASE_DECISION_SOURCE_STATES);
  const ackDecision = nullableOneOf(ackObj.decision, RELEASE_ACK_DECISIONS);
  const ackNote = nullableOneOf(ackObj.note, RELEASE_ACK_NOTES);
  const crossCheck = oneOf(crossObj.status, RELEASE_DECISION_CROSS_CHECKS);
  if (
    packState === undefined ||
    packVerdict === undefined ||
    packDisclosure === undefined ||
    ackState === undefined ||
    ackDecision === undefined ||
    ackNote === undefined ||
    crossCheck === undefined
  ) {
    return undefined;
  }
  return {
    pack: packSummaryFrom(packState, packVerdict, packDisclosure),
    ack: ackSummaryFrom(ackState, ackDecision, ackNote),
    crossCheck,
  };
}

/** The recorded decision-rollup fields the recompute must reproduce for the record to be `usable`. */
interface RecordedRollup {
  readonly decision: ReleaseDecisionDecision;
  readonly exitCode: number;
  readonly reasons: readonly ReleaseDecisionReasonId[];
  readonly invalidInputs: number;
  readonly blocking: number;
  readonly insufficiencies: number;
  readonly advisories: number;
  readonly strict: boolean;
  readonly strictEscalated: boolean;
  readonly strictEscalatedFrom: "proceed-with-followup" | "hold" | "insufficient" | null;
}

/** Validate the record's `decision` rollup block into the bounded {@link RecordedRollup}, or `undefined`. */
function readRecordedRollup(rollup: Obj): RecordedRollup | undefined {
  const decision = oneOf(rollup.decision, RELEASE_DECISION_DECISIONS);
  const exitCode = intOf(rollup.exitCode);
  const invalidInputs = intOf(rollup.invalidInputs);
  const blocking = intOf(rollup.blocking);
  const insufficiencies = intOf(rollup.insufficiencies);
  const advisories = intOf(rollup.advisories);
  const strict = boolOf(rollup.strict);
  const strictEscalated = boolOf(rollup.strictEscalated);
  const rawFrom = rollup.strictEscalatedFrom;
  const fromOk =
    rawFrom === null ||
    rawFrom === "proceed-with-followup" ||
    rawFrom === "hold" ||
    rawFrom === "insufficient";
  if (
    decision === undefined ||
    exitCode === undefined ||
    invalidInputs === undefined ||
    blocking === undefined ||
    insufficiencies === undefined ||
    advisories === undefined ||
    strict === undefined ||
    strictEscalated === undefined ||
    !fromOk ||
    !Array.isArray(rollup.reasons)
  ) {
    return undefined;
  }
  const reasons: ReleaseDecisionReasonId[] = [];
  for (const r of rollup.reasons) {
    const id = oneOf(r, RELEASE_DECISION_REASON_IDS);
    if (id === undefined) return undefined; // an off-enum reason is a corrupt rollup
    reasons.push(id);
  }
  return {
    decision,
    exitCode,
    reasons,
    invalidInputs,
    blocking,
    insufficiencies,
    advisories,
    strict,
    strictEscalated,
    strictEscalatedFrom: rawFrom as "proceed-with-followup" | "hold" | "insufficient" | null,
  };
}

/** Compare two `ReleaseDecisionReasonId` lists as sets (order-independent, exact membership). */
function sameReasons(
  a: readonly ReleaseDecisionReasonId[],
  b: readonly ReleaseDecisionReasonId[],
): boolean {
  if (a.length !== b.length) return false;
  const set = new Set<string>(a);
  return b.every((id) => set.has(id));
}

/** Whether the re-derived rollup matches the recorded one on every load-bearing field (skips authored `detail`). */
function sameRollup(a: ReleaseDecisionRollup, b: RecordedRollup): boolean {
  return (
    a.decision === b.decision &&
    a.exitCode === b.exitCode &&
    a.invalidInputs === b.invalidInputs &&
    a.blocking === b.blocking &&
    a.insufficiencies === b.insufficiencies &&
    a.advisories === b.advisories &&
    a.strict === b.strict &&
    a.strictEscalated === b.strictEscalated &&
    a.strictEscalatedFrom === b.strictEscalatedFrom &&
    sameReasons(a.reasons, b.reasons)
  );
}

/**
 * Reduce one parsed `pdfxyz.release-decision/1` `root` to the bounded {@link IngestedDecision}.
 *
 * A non-object / wrong-schema input is {@link UNRECOGNIZED_DECISION}. For a recognized record it reconstructs the
 * pack + acknowledgement summaries + cross-check status from the record's OWN recorded fields, RE-RUNS the Phase 59
 * {@link computeDecisionRollup} over them with the record's recorded `strict`, and marks the record `usable` only if
 * (a) the record's `policy.strict` equals the recorded rollup's `strict`, and (b) the recorded rollup equals the
 * re-derived one in every load-bearing field — so a hand-flipped decision / lied count / hidden reason / lied strict
 * is caught. Never throws and never echoes the input.
 */
export function ingestDecision(root: unknown): IngestedDecision {
  if (!isObject(root) || root.schema !== RELEASE_DECISION_SCHEMA) return UNRECOGNIZED_DECISION;

  const rollupObj = isObject(root.decision) ? root.decision : undefined;
  const claimed = rollupObj ? (oneOf(rollupObj.decision, RELEASE_DECISION_DECISIONS) ?? null) : null;

  // Structural validation. Any malformed piece ⇒ recognized-but-not-usable (a tamper / corruption), with the
  // claimed decision surfaced (untrusted) so the index can show what the record asserted.
  if (rollupObj === undefined) return inconsistentDecision(claimed);
  const recorded = readRecordedRollup(rollupObj);
  if (recorded === undefined) return inconsistentDecision(claimed);

  const inputs = reconstructInputs(root);
  if (inputs === undefined) return inconsistentDecision(recorded.decision);

  // The record's `policy.strict` must agree with the rollup's recorded `strict` (a smuggled inconsistent policy is
  // a tamper). A real Phase 59 record always carries both, equal.
  const policyObj = isObject(root.policy) ? root.policy : undefined;
  const policyStrict = policyObj ? boolOf(policyObj.strict) : undefined;
  if (policyStrict === undefined || policyStrict !== recorded.strict) {
    return inconsistentDecision(recorded.decision);
  }

  // Re-derive the composite decision from the record's OWN reconstructed inputs + recorded strict flag, exactly as
  // the Phase 59 CLI did, and require the recorded rollup to match in every load-bearing field.
  const { rollup: rederived } = computeDecisionRollup(
    inputs.pack,
    inputs.ack,
    inputs.crossCheck,
    recorded.strict,
  );
  if (!sameRollup(rederived, recorded)) return inconsistentDecision(recorded.decision);

  const facts: DecisionRecordFacts = {
    decision: rederived.decision,
    exitCode: rederived.exitCode,
    proceed: rederived.proceed,
    crossCheck: inputs.crossCheck,
    invalidInputs: rederived.invalidInputs,
    blocking: rederived.blocking,
    insufficiencies: rederived.insufficiencies,
    advisories: rederived.advisories,
    strict: rederived.strict,
    strictEscalated: rederived.strictEscalated,
  };
  return { recognized: true, usable: true, decision: rederived.decision, facts };
}

/** One ingested record, plus whether a file was SUPPLIED for it (always true for a real input slot). */
export interface DecisionIngest {
  /** True iff a `--file` / `--decision` / stdin element was provided for this slot. */
  readonly supplied: boolean;
  readonly ingested: IngestedDecision;
}
