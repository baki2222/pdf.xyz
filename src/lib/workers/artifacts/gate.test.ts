// @vitest-environment node
/**
 * Proof for the artifact-manifest gate wrapper + the environment resolver: an enabled
 * gate validates and reports `active:true`; a disabled gate validates nothing and
 * reports `active:false`; the presence-only capability is content-free.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RETENTION } from "@/lib/jobs";
import {
  createArtifactManifestGate,
  defaultArtifactManifestGate,
  disabledArtifactManifestGate,
} from "./gate";
import { DEFAULT_ARTIFACT_POLICY } from "./policy";
import { resolveWorkerArtifactManifest } from "./index";
import type { ArtifactValidationInput } from "./types";

const enc = (s: string) => new TextEncoder().encode(s);

const validInput: ArtifactValidationInput = {
  tool: "compress-pdf",
  processor: "compress",
  retention: DEFAULT_RETENTION,
  artifacts: [
    { filename: "out.pdf", contentType: "application/pdf", bytes: enc("%PDF-1.7") },
  ],
};

describe("createArtifactManifestGate", () => {
  it("an enabled gate validates and reports active with a stable policy identity", () => {
    const gate = defaultArtifactManifestGate();
    expect(gate.validate(validInput).verdict).toBe("valid");
    const cap = gate.capability();
    expect(cap.active).toBe(true);
    expect(cap.mode).toBe("enabled");
    expect(cap.policyId).toBe("pdfxyz-worker-artifact-manifest");
    expect(cap.policyVersion).toBe(1);
  });

  it("a disabled gate validates nothing and reports disabled", () => {
    const gate = disabledArtifactManifestGate();
    const r = gate.validate({ ...validInput, artifacts: [] }); // would fail if run
    expect(r.verdict).toBe("skipped");
    expect(r.checked).toBe(false);
    const cap = gate.capability();
    expect(cap.active).toBe(false);
    expect(cap.mode).toBe("disabled");
  });

  it("the capability detail is content-free prose (no variable, value, or path)", () => {
    for (const gate of [defaultArtifactManifestGate(), disabledArtifactManifestGate()]) {
      const detail = gate.capability().detail;
      expect(detail).not.toMatch(/PDFXYZ_|\/|=|\\/);
      expect(detail.length).toBeGreaterThan(0);
    }
  });
});

describe("resolveWorkerArtifactManifest", () => {
  it("resolves an ENABLED gate with nothing declared", () => {
    expect(resolveWorkerArtifactManifest({}).capability().active).toBe(true);
  });

  it("honors an operator disable", () => {
    const gate = resolveWorkerArtifactManifest({
      PDFXYZ_WORKER_ARTIFACT_MANIFEST: "off",
    });
    expect(gate.capability().active).toBe(false);
    expect(gate.validate(validInput).verdict).toBe("skipped");
  });

  it("builds a gate over the shipped default policy by default", () => {
    // Sanity: the barrel resolver and the explicit default construct the same behavior.
    const a = resolveWorkerArtifactManifest({}).validate(validInput);
    const b = createArtifactManifestGate(DEFAULT_ARTIFACT_POLICY).validate(validInput);
    expect(a.verdict).toBe(b.verdict);
  });
});
