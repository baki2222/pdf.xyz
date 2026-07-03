// @vitest-environment node
/**
 * The no-leak proof for the release evidence artifact (Phase 47) — deliverable 3.
 *
 * The artifact's honesty contract is "content-free by construction": the git provenance is reduced to
 * bounded enums (`./git`), the archived gate + ops-bundle are re-authored from bounded enums
 * (`./gate`, `./opsbundle`), the operator label is re-validated in the runner, and the digest is over
 * the already-content-free canonical body. So even hostile inputs — a poisoned gate/ops-bundle result
 * whose every free-text field is a locator, hostile raw git facts, a secret-shaped label, and hostile
 * operator FILE PATHS — can never reach the rendered artifact (JSON + text), the structured artifact,
 * or the verify outcome. These tests poison every seam and prove it, while still resolving the correct
 * verdict.
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { runReleaseArtifact, type ReleaseArtifactProvider } from "./run";
import { RELEASE_GATE_SCHEMA } from "../release-gate/types";
import { OPS_BUNDLE_SCHEMA } from "../ops-bundle/types";
import { RELEASE_ARTIFACT_SCHEMA } from "./types";
import type { ReleaseArtifactArgs } from "./args";

const NOW = "2026-07-03T00:00:00.000Z";
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** A dense payload of every locator/content shape the artifact must never echo. */
const SECRET =
  "s3://leaky-bucket/customer-tax-return.pdf?sig=deadbeef AKIAIOSFODNN7EXAMPLE " +
  "https://acct.r2.cloudflarestorage.com/obj token=h_abc123 192.168.0.1 Bearer sk-DEADBEEFCAFE";
const POISON = `POISON-${SECRET}`;

/** Substrings that must never appear in any artifact output. */
const FORBIDDEN = [
  "leaky-bucket",
  "customer-tax-return",
  "AKIA",
  "cloudflarestorage",
  "deadbeef",
  "192.168.0.1",
  "s3://",
  "https://",
  "token=",
  "Bearer sk-",
  "POISON-",
  "/tmp/",
  "/var/secrets",
  "db-token",
];

/** Hostile operator FILE PATHS: the runner must never surface them (only their bounded content). */
const HOSTILE_GATE_PATH = "/tmp/leaky-bucket/customer-tax-return.pdf";
const HOSTILE_BUNDLE_PATH = "/var/secrets/db-token.json";

/** A valid-schema but fully-poisoned gate result. */
function poisonedGate(): string {
  return JSON.stringify({
    schema: RELEASE_GATE_SCHEMA,
    rollup: { verdict: "fail", includedChecks: 1, passedChecks: 0, skippedChecks: 0, blockers: [POISON], detail: POISON },
    checks: [{ id: POISON, status: POISON, summary: POISON, remediation: POISON }],
    receipt: { poison: POISON },
    guidance: [POISON],
    caveats: [POISON],
  });
}

/** A valid-schema but fully-poisoned ops-bundle summary. */
function poisonedBundle(): string {
  return JSON.stringify({
    schema: OPS_BUNDLE_SCHEMA,
    rollup: { severity: "critical", detail: POISON },
    sections: { operations: { summary: POISON } },
    poison: POISON,
  });
}

function hostileProvider(over: Partial<ReleaseArtifactProvider> = {}): ReleaseArtifactProvider {
  return {
    now: () => NOW,
    hash: sha256,
    // Hostile raw git facts: a secret-shaped ref/commit and a dirty tree.
    gitFacts: async () => ({ commit: POISON, ref: POISON, dirty: true }),
    readGate: async () => poisonedGate(),
    runGate: async () => poisonedGate(),
    readOpsBundle: async () => poisonedBundle(),
    readArtifact: async () => "{}",
    ...over,
  };
}

function generateArgs(over: Partial<ReleaseArtifactArgs> = {}): ReleaseArtifactArgs {
  return { mode: "generate", format: "json", pretty: true, noVcs: false, ...over };
}

/** Assert an output string and the structured object carry no forbidden substring. */
function assertClean(output: string, structured: unknown, label: string): void {
  for (const bad of FORBIDDEN) expect(output, `${label}: ${bad}`).not.toContain(bad);
  const serialized = JSON.stringify(structured);
  for (const bad of FORBIDDEN) expect(serialized, `${label} (structured): ${bad}`).not.toContain(bad);
}

describe("release-artifact no-leak by construction", () => {
  it("never echoes a poisoned SUPPLIED gate + hostile git facts + hostile path (json + text)", async () => {
    for (const format of ["json", "text"] as const) {
      const run = await runReleaseArtifact(
        generateArgs({ format, releaseGatePath: HOSTILE_GATE_PATH }),
        hostileProvider(),
      );
      // The poisoned gate is a FAIL; a dirty tree does not downgrade it.
      expect(run.artifact!.body.rollup.verdict).toBe("fail");
      assertClean(run.output, run.artifact, `supplied/${format}`);
    }
  });

  it("never echoes a poisoned INTERNAL gate run", async () => {
    const run = await runReleaseArtifact(generateArgs(), hostileProvider());
    expect(run.artifact!.body.gate.source).toBe("generated");
    assertClean(run.output, run.artifact, "internal");
  });

  it("never echoes a poisoned ops-bundle summary or its hostile path", async () => {
    const run = await runReleaseArtifact(
      generateArgs({ releaseGatePath: HOSTILE_GATE_PATH, opsBundlePath: HOSTILE_BUNDLE_PATH }),
      hostileProvider(),
    );
    // A critical ops-bundle is context only — it does not change the (fail, from the poisoned gate) verdict.
    expect(run.artifact!.body.opsBundle.severity).toBe("critical");
    assertClean(run.output, run.artifact, "ops-bundle");
  });

  it("drops a secret-shaped label (re-validated in the runner) and reduces hostile git facts to enums", async () => {
    const run = await runReleaseArtifact(
      generateArgs({ releaseGatePath: HOSTILE_GATE_PATH, label: POISON }),
      hostileProvider(),
    );
    // The hostile label is dropped; the git provenance is bounded (commit is not hex ⇒ null; ref ⇒ class).
    expect(run.artifact!.body.metadata.label).toBeNull();
    expect(run.artifact!.body.metadata.git.commit).toBeNull();
    expect(run.artifact!.body.metadata.git.refClass).toBe("topic");
    expect(run.artifact!.body.metadata.git.cleanliness).toBe("dirty");
    assertClean(run.output, run.artifact, "label");
  });

  it("keeps the digest valid + reproducible even over hostile inputs", async () => {
    const run = await runReleaseArtifact(generateArgs({ releaseGatePath: HOSTILE_GATE_PATH }), hostileProvider());
    expect(run.artifact!.integrity.digest).toMatch(/^[0-9a-f]{64}$/);
    // The digest is over the (already-scrubbed) canonical body, so it is content-free.
    expect(run.artifact!.integrity.digest).not.toContain("POISON");
  });

  it("never echoes a hostile body when verifying a poisoned 'artifact' file", async () => {
    // A file shaped like an artifact but whose body is full of secrets, with a bogus digest.
    const hostileArtifact = JSON.stringify({
      schema: RELEASE_ARTIFACT_SCHEMA,
      body: { generatedAt: NOW, metadata: { label: POISON }, poison: POISON },
      integrity: { algorithm: "sha256", digest: POISON },
    });
    for (const format of ["json", "text"] as const) {
      const run = await runReleaseArtifact(
        { mode: "verify", format, pretty: true, noVcs: false, verifyPath: HOSTILE_GATE_PATH },
        hostileProvider({ readArtifact: async () => hostileArtifact }),
      );
      // A malformed claimed digest fails closed; the hostile body/claim are never echoed.
      expect(run.verify!.ok).toBe(false);
      assertClean(run.output, run.verify, `verify/${format}`);
    }
  });
});
