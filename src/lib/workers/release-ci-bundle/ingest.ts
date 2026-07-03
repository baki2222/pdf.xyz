/**
 * Pure, node-free **stage ingest** for the release CI bundle (Phase 50) — the trust boundary and the
 * no-leak core.
 *
 * The bundle composes up to four release-evidence stage outputs. Even though each is already
 * content-free, every one is UNTRUSTED input here (a CI archive an operator points us at, or a hand-
 * crafted / tampered file), and this module turns each parsed root into a bounded ingested shape, in the
 * same paranoid spirit as the rest of the worker ingest layer:
 *  - **No-leak by reconstruction.** It NEVER copies a free-text field out of a stage output. Every
 *    recorded fact is validated against a bounded enum or reduced to a non-negative integer / boolean /
 *    a short content-free digest PREFIX. Prose, caveats, guidance, stamps, raw refs/labels, and any
 *    stray extra field are all DROPPED.
 *  - **Reuse the tested boundaries.** The artifact stage reuses the release-index `ingestArtifact` (which
 *    re-verifies the integrity digest via the injected hash); the index stage reuses the release-policy
 *    `ingestIndex` (which recomputes the archive-health verdict from the index's own counts and rejects a
 *    self-report that disagrees); the policy stage reuses the release-policy `evaluatePolicy` +
 *    `computePolicyRollup` to RE-DERIVE the policy verdict from its own recorded facts.
 *  - **Honest tri-state.** A non-object / wrong-schema input is `recognized = false` (⇒ an `unreadable`
 *    stage, insufficient); a recognized-but-inconsistent index/policy is `recognized = true, usable =
 *    false` (⇒ a blocking consistency mismatch); a valid stage yields reduced bounded facts. The
 *    offending content is never echoed.
 */

import { ingestArtifact, type IngestedArtifact } from "../release-index/ingest";
import type { HashFn } from "../release-artifact/digest";
import { RELEASE_GATE_SCHEMA, RELEASE_GATE_VERDICTS, type ReleaseGateVerdict } from "../release-gate/types";
import { RELEASE_ARTIFACT_VERDICTS, type ReleaseArtifactVerdict } from "../release-artifact/types";
import {
  RELEASE_INDEX_AGE_BUCKETS,
  RELEASE_INDEX_VERDICTS,
  type ReleaseIndexVerdict,
} from "../release-index/types";
import {
  computePolicyRollup,
  evaluatePolicy,
  configuredAssertions,
  ingestIndex,
  RELEASE_POLICY_AGE_BOUNDS,
  RELEASE_POLICY_SCHEMA,
  RELEASE_POLICY_VERDICTS,
  type IngestedIndex,
  type ReleasePolicyAgeBound,
  type ReleasePolicyFacts,
  type ReleasePolicyInputs,
  type ReleasePolicyVerdict,
} from "../release-policy";
import type {
  GateStageFacts,
  IndexStageFacts,
  PolicyStageFacts,
} from "./types";

export type { IngestedArtifact } from "../release-index/ingest";

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

/** A non-negative integer, or `0` for anything else (for a tolerant count with a safe floor). */
function intOr0(value: unknown): number {
  return intOf(value) ?? 0;
}

/** The shape of a short lowercase-hex digest prefix an index entry records (≤12 chars). */
const DIGEST_PREFIX = /^[0-9a-f]{1,12}$/;

/* ------------------------------------------------------------------ *
 *  Gate stage
 * ------------------------------------------------------------------ */

/** The bounded outcome of ingesting a `pdfxyz.worker-release-gate/1` report. */
export interface IngestedGate {
  readonly recognized: boolean;
  readonly verdict: ReleaseGateVerdict | null;
  readonly facts: GateStageFacts | null;
}

/** The bounded outcome for an input that was not a recognized gate report. */
export const UNRECOGNIZED_GATE: IngestedGate = { recognized: false, verdict: null, facts: null };

/**
 * Reduce one parsed release-gate `root` to the bounded {@link IngestedGate}. A non-object / wrong-schema
 * input is `UNRECOGNIZED_GATE`; a recognized report yields its bounded verdict + check counts (the
 * blocker COUNT only, never their ids' text). Never throws and never echoes the input.
 */
export function ingestGate(root: unknown): IngestedGate {
  if (!isObject(root) || root.schema !== RELEASE_GATE_SCHEMA) return UNRECOGNIZED_GATE;
  const rollup = isObject(root.rollup) ? root.rollup : undefined;
  const verdict = rollup ? (oneOf(rollup.verdict, RELEASE_GATE_VERDICTS) ?? null) : null;
  const facts: GateStageFacts = {
    includedChecks: intOr0(rollup?.includedChecks),
    passedChecks: intOr0(rollup?.passedChecks),
    skippedChecks: intOr0(rollup?.skippedChecks),
    blockers: rollup && Array.isArray(rollup.blockers) ? rollup.blockers.length : 0,
  };
  return { recognized: true, verdict, facts };
}

/* ------------------------------------------------------------------ *
 *  Artifact stage — reuse the release-index ingest (re-verifies the integrity digest)
 * ------------------------------------------------------------------ */

/**
 * Reduce one parsed release-artifact `root` to the bounded {@link IngestedArtifact}, re-verifying its
 * integrity digest with `hash`. Delegates to the tested release-index boundary; a non-artifact input is
 * `unreadable` (digestStatus `unreadable`), a tampered body is `mismatch`/`malformed`. The verified
 * digest re-check IS the `artifact-digest` consistency signal (read from `digestStatus`).
 */
export function ingestArtifactStage(root: unknown, hash: HashFn): IngestedArtifact {
  return ingestArtifact(root, hash);
}

/* ------------------------------------------------------------------ *
 *  Index stage — reuse the release-policy ingest (recomputes the archive verdict against itself)
 * ------------------------------------------------------------------ */

/** One verified index entry reduced to a bounded {digest prefix, verdict} pair (for the inclusion check). */
export interface VerifiedIndexEntry {
  readonly prefix: string;
  readonly verdict: ReleaseArtifactVerdict | null;
}

/** The bounded outcome of ingesting a `pdfxyz.release-index/1` manifest. */
export interface IngestedIndexStage {
  readonly recognized: boolean;
  readonly usable: boolean;
  /** The archive verdict — recomputed (effective) if usable, else the self-reported one (if any). */
  readonly verdict: ReleaseIndexVerdict | null;
  readonly facts: IndexStageFacts | null;
  /** The verified entries' bounded {prefix, verdict} pairs (empty unless usable). */
  readonly verifiedEntries: readonly VerifiedIndexEntry[];
}

/** Extract the bounded {prefix, verdict} of every VERIFIED index entry (content-free hex prefixes only). */
function verifiedEntriesOf(root: Obj): VerifiedIndexEntry[] {
  const out: VerifiedIndexEntry[] = [];
  const artifacts = Array.isArray(root.artifacts) ? root.artifacts : [];
  for (const entry of artifacts) {
    if (!isObject(entry) || entry.digestStatus !== "verified") continue;
    const prefix = typeof entry.digestPrefix === "string" && DIGEST_PREFIX.test(entry.digestPrefix)
      ? entry.digestPrefix
      : undefined;
    if (prefix === undefined) continue;
    out.push({ prefix, verdict: oneOf(entry.verdict, RELEASE_ARTIFACT_VERDICTS) ?? null });
  }
  return out;
}

/**
 * Reduce one parsed release-index `root` to the bounded {@link IngestedIndexStage}, reusing the release-
 * policy `ingestIndex` for the self-consistency recompute. A non-object / wrong-schema input is not
 * recognized; a recognized-but-inconsistent manifest is `usable = false`; a valid manifest yields
 * reduced facts + the verified entry prefixes.
 */
export function ingestIndexStage(root: unknown): IngestedIndexStage {
  const ing = ingestIndex(root);
  if (!ing.recognized) {
    return { recognized: false, usable: false, verdict: null, facts: null, verifiedEntries: [] };
  }
  if (!ing.usable || ing.facts === null) {
    return {
      recognized: true,
      usable: false,
      verdict: ing.reportedVerdict,
      facts: null,
      verifiedEntries: [],
    };
  }
  const f = ing.facts;
  const facts: IndexStageFacts = {
    archiveVerdict: f.archiveVerdict,
    indexedArtifacts: f.indexedArtifacts,
    skippedInputs: f.skippedInputs,
    integrityFailures: f.integrityFailures,
    overRetentionCount: f.overRetentionCount,
    verdictCounts: {
      pass: f.verdictCounts.pass,
      warn: f.verdictCounts.warn,
      fail: f.verdictCounts.fail,
      unknown: f.verdictCounts.unknown,
    },
    newestAgeBucket: f.newestAgeBucket,
    latestVerdict: f.latestVerdict,
  };
  return {
    recognized: true,
    usable: true,
    verdict: ing.effectiveVerdict,
    facts,
    verifiedEntries: isObject(root) ? verifiedEntriesOf(root) : [],
  };
}

/* ------------------------------------------------------------------ *
 *  Policy stage — reuse the release-policy evaluate + rollup (re-derives the verdict against itself)
 * ------------------------------------------------------------------ */

/** The bounded outcome of ingesting a `pdfxyz.release-policy/1` result. */
export interface IngestedPolicyStage {
  readonly recognized: boolean;
  /** True iff the result validated AND its recorded rollup verdict RE-DERIVES from its own facts. */
  readonly usable: boolean;
  /** The policy's recorded rollup verdict (its claim), or `null` if unreadable. */
  readonly verdict: ReleasePolicyVerdict | null;
  readonly facts: PolicyStageFacts | null;
}

/** The bounded outcome for an input that was not a recognized policy result. */
export const UNRECOGNIZED_POLICY: IngestedPolicyStage = {
  recognized: false,
  usable: false,
  verdict: null,
  facts: null,
};

/** Validate the four bounded per-verdict counts, or `undefined`. */
function verdictCountsOf(value: unknown): ReleasePolicyFacts["verdictCounts"] | undefined {
  if (!isObject(value)) return undefined;
  const pass = intOf(value.pass);
  const warn = intOf(value.warn);
  const fail = intOf(value.fail);
  const unknown = intOf(value.unknown);
  if (pass === undefined || warn === undefined || fail === undefined || unknown === undefined) {
    return undefined;
  }
  return { pass, warn, fail, unknown };
}

/** Validate a policy result's embedded, reduced `facts` object into a bounded {@link ReleasePolicyFacts}. */
function policyFactsOf(value: unknown): ReleasePolicyFacts | undefined {
  if (!isObject(value)) return undefined;
  const archiveVerdict = oneOf(value.archiveVerdict, RELEASE_INDEX_VERDICTS);
  const indexedArtifacts = intOf(value.indexedArtifacts);
  const skippedInputs = intOf(value.skippedInputs);
  const totalInputs = intOf(value.totalInputs);
  const integrityFailures = intOf(value.integrityFailures);
  const verdictCounts = verdictCountsOf(value.verdictCounts);
  const overRetentionCount = intOf(value.overRetentionCount);
  const overCount = boolOf(value.overCount);
  const overAge = boolOf(value.overAge);
  const stale = boolOf(value.stale);
  const newestAgeBucket = oneOf(value.newestAgeBucket, RELEASE_INDEX_AGE_BUCKETS);
  const oldestAgeBucket = oneOf(value.oldestAgeBucket, RELEASE_INDEX_AGE_BUCKETS);
  const latestVerdict =
    value.latestVerdict === null ? null : oneOf(value.latestVerdict, RELEASE_ARTIFACT_VERDICTS);
  if (
    archiveVerdict === undefined ||
    indexedArtifacts === undefined ||
    skippedInputs === undefined ||
    totalInputs === undefined ||
    integrityFailures === undefined ||
    verdictCounts === undefined ||
    overRetentionCount === undefined ||
    overCount === undefined ||
    overAge === undefined ||
    stale === undefined ||
    newestAgeBucket === undefined ||
    oldestAgeBucket === undefined ||
    latestVerdict === undefined
  ) {
    return undefined;
  }
  return {
    archiveVerdict,
    indexedArtifacts,
    skippedInputs,
    totalInputs,
    integrityFailures,
    verdictCounts,
    overRetentionCount,
    overCount,
    overAge,
    stale,
    newestAgeBucket,
    oldestAgeBucket,
    latestVerdict,
  };
}

/** Validate a policy result's `policy` block into a bounded {@link ReleasePolicyInputs}. */
function policyInputsOf(value: unknown): ReleasePolicyInputs | undefined {
  if (!isObject(value)) return undefined;
  const requireClean = boolOf(value.requireClean);
  const requireLatestOk = boolOf(value.requireLatestOk);
  const forbidOverRetention = boolOf(value.forbidOverRetention);
  if (requireClean === undefined || requireLatestOk === undefined || forbidOverRetention === undefined) {
    return undefined;
  }
  // Nullable bounded counts: a present value must be a non-negative integer; `null` is "unset".
  const nInt = (v: unknown): number | null | undefined =>
    v === null ? null : intOf(v);
  const maxInvalid = nInt(value.maxInvalid);
  const maxFail = nInt(value.maxFail);
  const minArtifacts = nInt(value.minArtifacts);
  const maxArtifacts = nInt(value.maxArtifacts);
  const maxWarn = nInt(value.maxWarn);
  const maxSkipped = nInt(value.maxSkipped);
  const maxAgeBucket: ReleasePolicyAgeBound | null | undefined =
    value.maxAgeBucket === null ? null : oneOf(value.maxAgeBucket, RELEASE_POLICY_AGE_BOUNDS);
  if (
    maxInvalid === undefined ||
    maxFail === undefined ||
    minArtifacts === undefined ||
    maxArtifacts === undefined ||
    maxWarn === undefined ||
    maxSkipped === undefined ||
    maxAgeBucket === undefined
  ) {
    return undefined;
  }
  return {
    requireClean,
    requireLatestOk,
    maxInvalid,
    maxFail,
    minArtifacts,
    maxArtifacts,
    maxAgeBucket,
    maxWarn,
    maxSkipped,
    forbidOverRetention,
  };
}

/**
 * Reduce one parsed release-policy `root` to the bounded {@link IngestedPolicyStage}. A non-object /
 * wrong-schema input is `UNRECOGNIZED_POLICY`. For a recognized result it RE-DERIVES the policy rollup
 * from the result's OWN recorded facts + assertions (reusing the tested `evaluatePolicy` +
 * `computePolicyRollup`) and marks it `usable` only if the re-derived verdict equals the recorded one —
 * so a hand-flipped `rollup.verdict` (smuggling a tampered archive past the gate) is caught as
 * inconsistent. Never throws and never echoes the input.
 */
export function ingestPolicy(root: unknown): IngestedPolicyStage {
  if (!isObject(root) || root.schema !== RELEASE_POLICY_SCHEMA) return UNRECOGNIZED_POLICY;

  const rollup = isObject(root.rollup) ? root.rollup : undefined;
  const recordedVerdict = rollup ? (oneOf(rollup.verdict, RELEASE_POLICY_VERDICTS) ?? null) : null;

  const indexRecognized = boolOf(root.indexRecognized);
  const indexUsable = boolOf(root.indexUsable);
  const reportedVerdict =
    root.reportedVerdict === null ? null : oneOf(root.reportedVerdict, RELEASE_INDEX_VERDICTS);
  const effectiveVerdict =
    root.effectiveVerdict === null ? null : oneOf(root.effectiveVerdict, RELEASE_INDEX_VERDICTS);
  const inputs = policyInputsOf(root.policy);

  // Structural validation: a policy result must carry a valid verdict, the two index-state booleans, a
  // valid (or null) effective/reported verdict, and a valid policy block. A malformed result cannot be
  // re-derived — it is recognized but NOT usable (⇒ a blocking `policy-self-consistent` mismatch).
  if (
    recordedVerdict === null ||
    indexRecognized === undefined ||
    indexUsable === undefined ||
    reportedVerdict === undefined ||
    effectiveVerdict === undefined ||
    inputs === undefined
  ) {
    return { recognized: true, usable: false, verdict: recordedVerdict, facts: null };
  }

  // When the policy evaluated a usable index, its `facts` must validate; when it did not, `facts` is null.
  const facts = indexUsable ? policyFactsOf(root.facts) : null;
  if (indexUsable && facts === undefined) {
    return { recognized: true, usable: false, verdict: recordedVerdict, facts: null };
  }

  // Re-derive the policy rollup from the result's OWN recorded state, exactly as the policy CLI did.
  const reconstructed: IngestedIndex = {
    recognized: indexRecognized,
    usable: indexUsable,
    reportedVerdict,
    effectiveVerdict,
    facts: facts ?? null,
  };
  const violations = indexUsable && facts ? evaluatePolicy(facts, inputs) : [];
  const rederived = computePolicyRollup(reconstructed, violations);
  const consistent = rederived.verdict === recordedVerdict;

  const stageFacts: PolicyStageFacts = {
    effectiveVerdict,
    indexUsable,
    indexedArtifacts: facts ? facts.indexedArtifacts : 0,
    assertionsEvaluated: configuredAssertions(inputs).length,
    blockingViolations: rederived.blockingViolations,
    warningViolations: rederived.warningViolations,
  };

  return {
    recognized: true,
    usable: consistent,
    verdict: recordedVerdict,
    facts: consistent ? stageFacts : null,
  };
}

/* ------------------------------------------------------------------ *
 *  The combined ingested set (what verify + build fold)
 * ------------------------------------------------------------------ */

/** One stage's ingest, plus whether a file was SUPPLIED for it (vs the honest not-supplied default). */
export interface StageIngest<I> {
  /** True iff a `--release-<stage>` file was provided (independent of whether it parsed / recognized). */
  readonly supplied: boolean;
  readonly ingested: I;
}

/** The four ingested stages the verify + build layers fold into one bundle. */
export interface IngestedStages {
  readonly gate: StageIngest<IngestedGate>;
  readonly artifact: StageIngest<IngestedArtifact>;
  readonly index: StageIngest<IngestedIndexStage>;
  readonly policy: StageIngest<IngestedPolicyStage>;
}
