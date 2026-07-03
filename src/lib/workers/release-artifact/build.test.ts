/**
 * Rollup + assembly tests. The composite verdict folds the archived gate verdict (primary) with the
 * build's cleanliness (a dirty tree escalates a clean pass to warn, and never downgrades a
 * fail/unknown). Body/receipt assembly is content-free and stable.
 */

import { describe, expect, it } from "vitest";
import { assembleArtifact, buildBody, buildMetadata, computeRollup } from "./build";
import type { ReleaseGateVerdict } from "../release-gate/types";
import type {
  GitCleanliness,
  ReleaseArtifactGate,
  ReleaseArtifactIntegrity,
  ReleaseArtifactOpsBundle,
  ReleaseArtifactVerdict,
  ReleaseGitProvenance,
} from "./types";

function gate(verdict: ReleaseGateVerdict): ReleaseArtifactGate {
  return {
    source: "supplied",
    present: verdict !== "unknown",
    verdict,
    includedChecks: 11,
    passedChecks: verdict === "pass" ? 11 : 9,
    skippedChecks: 0,
    blockers: [],
    checks: [],
    detail: "d",
  };
}

const OPS: ReleaseArtifactOpsBundle = { source: "not-configured", present: false, severity: null, detail: "d" };
const INTEGRITY: ReleaseArtifactIntegrity = {
  algorithm: "sha256",
  encoding: "hex",
  canonicalization: "pdfxyz-sorted-keys/1",
  digest: "a".repeat(64),
};

describe("computeRollup — the gate verdict is primary, dirtiness escalates a clean pass", () => {
  const cases: ReadonlyArray<[ReleaseGateVerdict, GitCleanliness, ReleaseArtifactVerdict, number]> = [
    ["pass", "clean", "pass", 0],
    ["pass", "unknown", "pass", 0], // unknown cleanliness is not a fault
    ["pass", "dirty", "warn", 3], // a dirty tree escalates a clean pass
    ["warn", "clean", "warn", 3],
    ["warn", "dirty", "warn", 3],
    ["fail", "clean", "fail", 4],
    ["fail", "dirty", "fail", 4], // fail dominates
    ["unknown", "clean", "unknown", 2],
    ["unknown", "dirty", "unknown", 2], // a dirty tree does NOT mask a missing gate result
  ];

  for (const [gv, clean, verdict, exit] of cases) {
    it(`gate=${gv} + tree=${clean} → ${verdict} (exit ${exit})`, () => {
      const rollup = computeRollup(gate(gv), clean);
      expect(rollup.verdict).toBe(verdict);
      expect(rollup.exitCode).toBe(exit);
      expect(rollup.ready).toBe(verdict === "pass");
    });
  }

  it("lists both drivers when the gate warns AND the tree is dirty", () => {
    expect(computeRollup(gate("warn"), "dirty").drivers).toEqual(["gate-warn", "dirty-tree"]);
  });

  it("lists no drivers on a clean pass", () => {
    expect(computeRollup(gate("pass"), "clean").drivers).toEqual([]);
  });

  it("records the dirty-tree driver even under a dominating gate fail", () => {
    expect(computeRollup(gate("fail"), "dirty").drivers).toEqual(["gate-fail", "dirty-tree"]);
  });
});

describe("buildMetadata / buildBody / assembleArtifact", () => {
  const git: ReleaseGitProvenance = { cleanliness: "clean", refClass: "default", commit: "27a5555fd3e3", commitPresent: true };

  it("stamps schema/policy identity and carries the label + git provenance", () => {
    const md = buildMetadata("v1.2.3", git);
    expect(md).toEqual({
      schemaVersion: 1,
      policyId: "pdfxyz-worker-release-evidence-artifact",
      policyVersion: 1,
      label: "v1.2.3",
      git,
    });
  });

  it("builds a body whose rollup is derived and carries the authored guidance + caveats", () => {
    const body = buildBody("2026-07-03T00:00:00.000Z", buildMetadata(null, git), gate("pass"), OPS);
    expect(body.rollup.verdict).toBe("pass");
    expect(body.guidance.length).toBeGreaterThan(0);
    expect(body.caveats.length).toBeGreaterThan(0);
    expect(body.generatedAt).toBe("2026-07-03T00:00:00.000Z");
  });

  it("assembles a full artifact with schema tag + integrity + a receipt that references the digest", () => {
    const body = buildBody("2026-07-03T00:00:00.000Z", buildMetadata("rc1", git), gate("warn"), OPS);
    const artifact = assembleArtifact(body, INTEGRITY);
    expect(artifact.schema).toBe("pdfxyz.release-artifact/1");
    expect(artifact.integrity).toBe(INTEGRITY);
    expect(artifact.receipt.digest).toBe(INTEGRITY.digest);
    expect(artifact.receipt.verdict).toBe("warn");
    expect(artifact.receipt.gateVerdict).toBe("warn");
    expect(artifact.receipt.cleanliness).toBe("clean");
    expect(artifact.receipt.at).toBe(body.generatedAt);
    // The integrity/receipt are NOT part of the body (so the digest can cover the body).
    expect((body as unknown as Record<string, unknown>).integrity).toBeUndefined();
    expect((body as unknown as Record<string, unknown>).receipt).toBeUndefined();
  });
});
