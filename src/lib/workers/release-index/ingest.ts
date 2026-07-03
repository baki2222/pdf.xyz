/**
 * Pure, node-free **release-artifact ingest** for the release evidence index (Phase 48) — the trust
 * boundary and the no-leak core.
 *
 * The index ingests many `pdfxyz.release-artifact/1` files. Each is UNTRUSTED input (a CI archive an
 * operator points us at, or a hand-crafted / tampered file), and this module turns one parsed root
 * into the bounded {@link IngestedArtifact} the manifest is built from, in the same paranoid spirit as
 * the artifact's own gate/ops-bundle ingest:
 *  - **No-leak by reconstruction.** It NEVER copies a free-text field out of an artifact. Every
 *    recorded fact is validated against a bounded enum (the artifact's own verdict, gate verdict,
 *    cleanliness, ref class, gate/ops-bundle source) or reduced to a boolean / a bounded class (the
 *    operator label is classified, never echoed) / a short hex digest prefix. The raw label, commit
 *    hash, generatedAt stamp text, prose, caveats, and guidance are all DROPPED.
 *  - **Digest re-verification.** It recomputes the artifact's integrity digest over its canonical
 *    body (the SAME `./canonicalize` + `./digest` the artifact used) and compares it to the archived
 *    one, so a tampered body is caught as `mismatch` and a broken digest as `malformed`.
 *  - **Fail-closed honesty.** A non-object / wrong-schema / bodyless input is `unreadable` (recognized
 *    = false, every field null) — never fabricated into a verified artifact. The offending content is
 *    never echoed.
 */

import { verifyIntegrity, type HashFn } from "../release-artifact/digest";
import {
  GATE_SOURCES,
  GIT_CLEANLINESS,
  OPS_BUNDLE_SOURCES,
  REF_CLASSES,
  RELEASE_ARTIFACT_SCHEMA,
  RELEASE_ARTIFACT_VERDICTS,
  type GateSource,
  type GitCleanliness,
  type OpsBundleSource,
  type RefClass,
  type ReleaseArtifactVerdict,
} from "../release-artifact/types";
import { RELEASE_GATE_VERDICTS, type ReleaseGateVerdict } from "../release-gate/types";
import { instantToMs } from "./age";
import {
  type ReleaseIndexDigestStatus,
  type ReleaseLabelClass,
} from "./types";

/** The max hex chars of a recomputed digest the manifest records as a bounded, content-free prefix. */
const DIGEST_PREFIX_LEN = 12;

/** The shape of a `vX.Y[.Z...]` release tag, used ONLY to classify a label (never to echo it). */
const SEMVER_LABEL = /^v\d+(?:\.\d+)+/;

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

/**
 * Classify an artifact's operator release label into a bounded {@link ReleaseLabelClass} WITHOUT
 * echoing it. A present `vX.Y[.Z]`-shaped label is `semver`, any other present label is `named`, and
 * an absent/non-string label is `absent`. The raw label is used ONLY to pick the class.
 */
export function classifyLabel(label: unknown): ReleaseLabelClass {
  if (typeof label !== "string" || label.length === 0) return "absent";
  return SEMVER_LABEL.test(label) ? "semver" : "named";
}

/**
 * The bounded facts one ingested artifact contributes to the manifest, BEFORE the manifest-wide sort
 * (which assigns `position`) and retention pass (which assigns `overRetention`). `atMs` is the parsed
 * `generatedAt` used to sort newest-first and to bucket the age; it is never emitted as a raw number.
 */
export interface IngestedArtifact {
  readonly digestStatus: ReleaseIndexDigestStatus;
  readonly digestPrefix: string | null;
  readonly verdict: ReleaseArtifactVerdict | null;
  readonly gateVerdict: ReleaseGateVerdict | null;
  readonly cleanliness: GitCleanliness | null;
  readonly refClass: RefClass | null;
  readonly commitPresent: boolean;
  readonly labelClass: ReleaseLabelClass;
  readonly labelPresent: boolean;
  readonly gateSource: GateSource | null;
  readonly opsBundlePresent: boolean;
  readonly opsBundleSource: OpsBundleSource | null;
  /** The parsed `generatedAt` in epoch ms, or `null` if missing/unsafe. Used for sort + age; never emitted. */
  readonly atMs: number | null;
}

/** The bounded facts for an input that was not a recognized artifact (nothing to verify or record). */
export const UNREADABLE_ARTIFACT: IngestedArtifact = {
  digestStatus: "unreadable",
  digestPrefix: null,
  verdict: null,
  gateVerdict: null,
  cleanliness: null,
  refClass: null,
  commitPresent: false,
  labelClass: "absent",
  labelPresent: false,
  gateSource: null,
  opsBundlePresent: false,
  opsBundleSource: null,
  atMs: null,
};

/** Take a short lowercase-hex prefix of a recomputed digest (already content-free). */
function digestPrefix(digest: string): string {
  return digest.slice(0, DIGEST_PREFIX_LEN);
}

/**
 * Reduce one parsed release-artifact `root` to the bounded {@link IngestedArtifact}, re-verifying its
 * integrity digest with `hash`. A non-object / wrong-schema / bodyless input is `unreadable`. Never
 * throws (a malformed shape degrades to `unreadable`) and never echoes the input.
 */
export function ingestArtifact(root: unknown, hash: HashFn): IngestedArtifact {
  if (!isObject(root) || root.schema !== RELEASE_ARTIFACT_SCHEMA || !isObject(root.body)) {
    return UNREADABLE_ARTIFACT;
  }

  const body = root.body;

  // Re-verify the integrity digest over the canonical body — the SAME pre-image the artifact hashed.
  const claimed = isObject(root.integrity) ? root.integrity.digest : undefined;
  const verify = verifyIntegrity(body, claimed, hash);
  let digestStatus: ReleaseIndexDigestStatus;
  let computed: string;
  if (verify.ok) {
    digestStatus = "verified";
    computed = verify.digest;
  } else {
    digestStatus = verify.reason === "mismatch" ? "mismatch" : "malformed";
    computed = verify.computed;
  }

  // Bounded facts, reconstructed from the artifact's own enums (never a copied free-text field).
  const metadata = isObject(body.metadata) ? body.metadata : undefined;
  const git = metadata && isObject(metadata.git) ? metadata.git : undefined;
  const rollup = isObject(body.rollup) ? body.rollup : undefined;
  const gate = isObject(body.gate) ? body.gate : undefined;
  const opsBundle = isObject(body.opsBundle) ? body.opsBundle : undefined;

  const label = metadata ? metadata.label : undefined;
  const gateSource = gate ? (oneOf(gate.source, GATE_SOURCES) ?? null) : null;
  const opsBundleSource = opsBundle ? (oneOf(opsBundle.source, OPS_BUNDLE_SOURCES) ?? null) : null;

  return {
    digestStatus,
    digestPrefix: digestPrefix(computed),
    verdict: rollup ? (oneOf(rollup.verdict, RELEASE_ARTIFACT_VERDICTS) ?? null) : null,
    gateVerdict: gate ? (oneOf(gate.verdict, RELEASE_GATE_VERDICTS) ?? null) : null,
    cleanliness: git ? (oneOf(git.cleanliness, GIT_CLEANLINESS) ?? null) : null,
    refClass: git ? (oneOf(git.refClass, REF_CLASSES) ?? null) : null,
    commitPresent: git ? git.commitPresent === true : false,
    labelClass: classifyLabel(label),
    labelPresent: classifyLabel(label) !== "absent",
    gateSource,
    opsBundlePresent: opsBundleSource === "supplied",
    opsBundleSource,
    atMs: instantToMs(body.generatedAt),
  };
}
