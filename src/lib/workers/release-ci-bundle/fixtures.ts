/**
 * Test-support builders for the release CI bundle tests (Phase 50).
 *
 * The bundle composes four release-evidence stage outputs, so these helpers build a REAL, mutually
 * COHERENT chain — a gate report, a `pdfxyz.release-artifact/1` with a correct digest (from the release-
 * index fixtures), a `pdfxyz.release-index/1` that indexes THAT artifact (from the release-policy
 * fixtures), and a `pdfxyz.release-policy/1` evaluated over THAT index (via the shipped policy build) —
 * so the tests can assert the happy path and then deliberately corrupt one stage (flip a verdict, swap
 * an index) to prove a cross-stage inconsistency is caught.
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from
 * `./index`), is never imported by any runtime module, and — like the index/policy fixtures — uses
 * `node:crypto` so tests get a real digest without threading a hash seam.
 */

import { createHash } from "node:crypto";
import { RELEASE_GATE_SCHEMA } from "../release-gate/types";
import { buildPolicyResult, ingestIndex, type ReleasePolicyInputs } from "../release-policy";
import { emptyPolicy, makeIndex, type ArtifactOptions } from "../release-policy/fixtures";
import { makeArtifact } from "../release-index/fixtures";
import {
  ingestArtifactStage,
  ingestGate,
  ingestIndexStage,
  ingestPolicy,
  type IngestedStages,
} from "./ingest";
import type { ReleaseCiBundleProvider } from "./run";
import type { ReleaseCiBundleArgs } from "./args";

export { makeArtifact } from "../release-index/fixtures";
export { emptyPolicy, makeIndex } from "../release-policy/fixtures";
export type { ArtifactOptions } from "../release-policy/fixtures";

/** A real lowercase-hex sha256 of `s` — the digest scheme the artifact/index/policy use. */
export const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

/** A fixed clock the bundle tests stamp with (deterministic). */
export const NOW = "2026-07-03T00:00:00.000Z";

/** A satisfiable policy (require-clean + at least one artifact) used to build a passing chain. */
export function passPolicy(): ReleasePolicyInputs {
  return { ...emptyPolicy(), requireClean: true, minArtifacts: 1 };
}

/** Build a minimal, well-typed-enough `pdfxyz.worker-release-gate/1` report the gate ingest reads. */
export function makeGate(
  verdict = "pass",
  rollupOver: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema: RELEASE_GATE_SCHEMA,
    policyId: "pdfxyz-worker-release-readiness-gate",
    policyVersion: 1,
    generatedAt: NOW,
    rollup: {
      verdict,
      exitCode: 0,
      ready: verdict === "pass",
      worst: "pass",
      blockers: [],
      includedChecks: 5,
      passedChecks: 5,
      skippedChecks: 0,
      detail: "authored gate detail",
      ...rollupOver,
    },
    checks: [],
    receipt: {},
    guidance: [],
    caveats: [],
  };
}

/** Build a REAL `pdfxyz.release-policy/1` result over `index`, under `inputs` (default: a passing policy). */
export function makePolicyResult(
  index: unknown,
  inputs: ReleasePolicyInputs = passPolicy(),
): unknown {
  return buildPolicyResult(NOW, "index", ingestIndex(index), inputs);
}

/** The four coherent stage objects the bundle composes. */
export interface Chain {
  gate: Record<string, unknown>;
  artifact: Record<string, unknown>;
  index: unknown;
  policy: unknown;
}

/**
 * Build a REAL, mutually coherent chain from one artifact's options: a gate whose verdict equals the
 * artifact's archived gate verdict, the artifact itself, an index that indexes that artifact, and a
 * policy evaluated over that index. Bundling all four resolves to `pass`; corrupt one to prove a
 * mismatch fails closed.
 */
export function makeChain(
  artifactOpts: ArtifactOptions = { generatedAt: NOW, verdict: "pass", gateVerdict: "pass" },
  policyInputs: ReleasePolicyInputs = passPolicy(),
): Chain {
  const artifact = makeArtifact(artifactOpts);
  const index = makeIndex([artifactOpts], { maxArtifacts: null, maxAgeDays: null }, NOW);
  const policy = makePolicyResult(index, policyInputs);
  const gate = makeGate(artifactOpts.gateVerdict ?? "pass");
  return { gate, artifact, index, policy };
}

/** The stage objects a test supplies to the bundle (any subset; `undefined` ⇒ not supplied). */
export interface StageObjects {
  gate?: unknown;
  artifact?: unknown;
  index?: unknown;
  policy?: unknown;
}

/** Reduce a subset of stage objects to the {@link IngestedStages} the build/verify/rollup layers fold. */
export function ingestStagesFrom(objs: StageObjects): IngestedStages {
  return {
    gate: { supplied: objs.gate !== undefined, ingested: ingestGate(objs.gate) },
    artifact: {
      supplied: objs.artifact !== undefined,
      ingested: ingestArtifactStage(objs.artifact, sha256),
    },
    index: { supplied: objs.index !== undefined, ingested: ingestIndexStage(objs.index) },
    policy: { supplied: objs.policy !== undefined, ingested: ingestPolicy(objs.policy) },
  };
}

/** A provider that serves each supplied stage object by its stage-key "path" (used by the run tests). */
export function makeProvider(objs: StageObjects): ReleaseCiBundleProvider {
  return {
    now: () => NOW,
    hash: sha256,
    readFile: async (path: string) => {
      const obj = (objs as Record<string, unknown>)[path];
      if (obj === undefined) throw new Error("enoent");
      return typeof obj === "string" ? obj : JSON.stringify(obj);
    },
  };
}

/** Build {@link ReleaseCiBundleArgs} that reference each supplied stage by its stage-key "path". */
export function makeArgs(objs: StageObjects, over: Partial<ReleaseCiBundleArgs> = {}): ReleaseCiBundleArgs {
  return {
    format: "json",
    pretty: true,
    ...(objs.gate !== undefined ? { gatePath: "gate" } : {}),
    ...(objs.artifact !== undefined ? { artifactPath: "artifact" } : {}),
    ...(objs.index !== undefined ? { indexPath: "index" } : {}),
    ...(objs.policy !== undefined ? { policyPath: "policy" } : {}),
    ...over,
  };
}
