/**
 * Pure, node-free **composer** for the release evidence artifact (Phase 47).
 *
 * It folds the bounded sections the trust boundaries produced (`./git`, `./gate`, `./opsbundle`)
 * into one stable {@link ReleaseArtifact}: it computes the composite rollup, assembles the
 * digest-covered {@link ReleaseArtifactBody}, and — once `./digest` has hashed that body behind the
 * injected seam — flattens the audit {@link ReleaseArtifactReceipt} that references the digest.
 *
 * The rollup is deliberately honest about what drives it. The PRIMARY evidence is the archived
 * release-gate verdict; the one independent signal the artifact adds is this build's working-tree
 * cleanliness (a `dirty` tree is an advisory `warn`, because the recorded commit then does not fully
 * describe the built bytes). The attached ops-bundle summary is incident-handoff CONTEXT about a
 * runtime's live ops posture and is deliberately NOT folded — it would conflate runtime health with
 * build-promotion readiness. Composite exit = worst (numeric max) of the gate + provenance
 * contributions on the shared `0 pass / 2 unknown / 3 warn / 4 fail` ladder, so a missing/unreadable
 * gate result keeps the verdict off `pass` (fail-closed), never a vacuous `pass`.
 */

import type { ReleaseGateVerdict } from "../release-gate/types";
import { buildReceipt } from "./receipt";
import {
  RELEASE_ARTIFACT_CAVEATS,
  RELEASE_ARTIFACT_EXIT,
  RELEASE_ARTIFACT_GUIDANCE,
  RELEASE_ARTIFACT_POLICY_ID,
  RELEASE_ARTIFACT_POLICY_VERSION,
  RELEASE_ARTIFACT_SCHEMA,
  RELEASE_ARTIFACT_VERDICT_SUMMARY,
  type GitCleanliness,
  type ReleaseArtifact,
  type ReleaseArtifactBody,
  type ReleaseArtifactDriver,
  type ReleaseArtifactExitCode,
  type ReleaseArtifactGate,
  type ReleaseArtifactIntegrity,
  type ReleaseArtifactMetadata,
  type ReleaseArtifactOpsBundle,
  type ReleaseArtifactRollup,
  type ReleaseArtifactVerdict,
  type ReleaseGitProvenance,
} from "./types";

/** The authoritative verdict → exit code map. */
export const RELEASE_ARTIFACT_EXIT_FOR_VERDICT: Record<ReleaseArtifactVerdict, ReleaseArtifactExitCode> = {
  pass: RELEASE_ARTIFACT_EXIT.PASS,
  unknown: RELEASE_ARTIFACT_EXIT.UNKNOWN,
  warn: RELEASE_ARTIFACT_EXIT.WARN,
  fail: RELEASE_ARTIFACT_EXIT.FAIL,
};

/** The bounded reasons the rollup escalated off `pass`, in a stable order (gate first, then provenance). */
function computeDrivers(
  gateVerdict: ReleaseGateVerdict,
  cleanliness: GitCleanliness,
): ReleaseArtifactDriver[] {
  const drivers: ReleaseArtifactDriver[] = [];
  if (gateVerdict === "fail") drivers.push("gate-fail");
  else if (gateVerdict === "warn") drivers.push("gate-warn");
  else if (gateVerdict === "unknown") drivers.push("gate-unknown");
  if (cleanliness === "dirty") drivers.push("dirty-tree");
  return drivers;
}

/**
 * Compute the composite rollup from the archived gate verdict + the build's cleanliness.
 *
 * The gate verdict is the PRIMARY evidence and carries straight through — a `fail`/`warn`/`unknown`
 * gate makes the artifact `fail`/`warn`/`unknown` respectively. The one thing provenance adds is that
 * a dirty working tree ESCALATES a clean `pass` to `warn` (the recorded commit then does not fully
 * describe the built bytes). Crucially, a dirty tree does NOT downgrade an `unknown` gate to `warn`:
 * "we have no gate evidence" is a more honest signal than "ready with a caveat", so the missing
 * evidence dominates. A dirty tree never lowers the verdict, so it is monotonic w.r.t. cleanliness.
 */
export function computeRollup(
  gate: ReleaseArtifactGate,
  cleanliness: GitCleanliness,
): ReleaseArtifactRollup {
  const dirty = cleanliness === "dirty";
  let verdict: ReleaseArtifactVerdict;
  switch (gate.verdict) {
    case "fail":
      verdict = "fail";
      break;
    case "unknown":
      verdict = "unknown";
      break;
    case "warn":
      verdict = "warn";
      break;
    case "pass":
    default:
      verdict = dirty ? "warn" : "pass";
      break;
  }
  return {
    verdict,
    exitCode: RELEASE_ARTIFACT_EXIT_FOR_VERDICT[verdict],
    ready: verdict === "pass",
    drivers: computeDrivers(gate.verdict, cleanliness),
    detail: RELEASE_ARTIFACT_VERDICT_SUMMARY[verdict],
  };
}

/** Assemble the bounded release metadata block. */
export function buildMetadata(
  label: string | null,
  git: ReleaseGitProvenance,
): ReleaseArtifactMetadata {
  return {
    schemaVersion: RELEASE_ARTIFACT_POLICY_VERSION,
    policyId: RELEASE_ARTIFACT_POLICY_ID,
    policyVersion: RELEASE_ARTIFACT_POLICY_VERSION,
    label,
    git,
  };
}

/**
 * Assemble the content-free, digest-covered {@link ReleaseArtifactBody} from the bounded sections.
 * Pure: the rollup is derived here, and the honesty guidance + caveats are the app's own maps.
 */
export function buildBody(
  generatedAt: string,
  metadata: ReleaseArtifactMetadata,
  gate: ReleaseArtifactGate,
  opsBundle: ReleaseArtifactOpsBundle,
): ReleaseArtifactBody {
  return {
    generatedAt,
    metadata,
    gate,
    opsBundle,
    rollup: computeRollup(gate, metadata.git.cleanliness),
    guidance: RELEASE_ARTIFACT_GUIDANCE,
    caveats: RELEASE_ARTIFACT_CAVEATS,
  };
}

/** Assemble the full artifact from the body + its computed integrity block (building the receipt). */
export function assembleArtifact(
  body: ReleaseArtifactBody,
  integrity: ReleaseArtifactIntegrity,
): ReleaseArtifact {
  return {
    schema: RELEASE_ARTIFACT_SCHEMA,
    body,
    integrity,
    receipt: buildReceipt(body, integrity),
  };
}
