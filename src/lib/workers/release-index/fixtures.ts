/**
 * Test-support builders for the release evidence index tests (Phase 48).
 *
 * Constructs valid `pdfxyz.release-artifact/1` objects with a CORRECT integrity digest (a real
 * sha256 over the canonical body, via the same `./canonicalize` a real artifact uses), so the index
 * tests can exercise ingest / digest re-verification / build against artifacts that verify — and can
 * deliberately corrupt one field to prove a `mismatch` is caught.
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from
 * `./index`), is never imported by any runtime module, and — unlike the shipped node-free leaves — it
 * intentionally uses `node:crypto` so tests get a real digest without threading a hash seam.
 */

import { createHash } from "node:crypto";
import { canonicalize } from "../release-artifact/canonicalize";
import { RELEASE_ARTIFACT_SCHEMA } from "../release-artifact/types";

/** A real lowercase-hex sha256 of `s`, matching the artifact's own digest scheme. */
export const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

/** The knobs a test varies when building an artifact body. All optional; sensible defaults applied. */
export interface ArtifactOptions {
  generatedAt?: string;
  verdict?: string;
  gateVerdict?: string;
  gateSource?: string;
  cleanliness?: string;
  refClass?: string;
  commit?: string | null;
  label?: string | null;
  opsBundleSource?: string;
  opsBundleSeverity?: string | null;
}

/** Build a representative, well-typed-enough release-artifact BODY from `o`. */
export function makeBody(o: ArtifactOptions = {}): Record<string, unknown> {
  const commit = o.commit === undefined ? "abc123def456" : o.commit;
  const opsSource = o.opsBundleSource ?? "not-configured";
  return {
    generatedAt: o.generatedAt ?? "2026-06-01T00:00:00.000Z",
    metadata: {
      schemaVersion: 1,
      policyId: "pdfxyz-worker-release-evidence-artifact",
      policyVersion: 1,
      label: o.label === undefined ? null : o.label,
      git: {
        cleanliness: o.cleanliness ?? "clean",
        refClass: o.refClass ?? "release",
        commit,
        commitPresent: commit !== null,
      },
    },
    gate: {
      source: o.gateSource ?? "supplied",
      present: true,
      verdict: o.gateVerdict ?? "pass",
      includedChecks: 5,
      passedChecks: 5,
      skippedChecks: 0,
      blockers: [],
      checks: [],
      detail: "authored gate detail",
    },
    opsBundle: {
      source: opsSource,
      present: opsSource === "supplied",
      severity: o.opsBundleSeverity === undefined ? null : o.opsBundleSeverity,
      detail: "authored ops-bundle detail",
    },
    rollup: {
      verdict: o.verdict ?? "pass",
      exitCode: 0,
      ready: (o.verdict ?? "pass") === "pass",
      drivers: [],
      detail: "authored rollup detail",
    },
    guidance: ["authored guidance line"],
    caveats: ["authored caveat line"],
  };
}

/** Build a full artifact object with a CORRECT digest over its canonical body. */
export function makeArtifact(o: ArtifactOptions = {}): Record<string, unknown> {
  const body = makeBody(o);
  return {
    schema: RELEASE_ARTIFACT_SCHEMA,
    body,
    integrity: {
      algorithm: "sha256",
      encoding: "hex",
      canonicalization: "pdfxyz-sorted-keys/1",
      digest: sha256(canonicalize(body)),
    },
    receipt: {
      category: "worker-release-artifact",
      policyId: "pdfxyz-worker-release-evidence-artifact",
      policyVersion: 1,
      at: body.generatedAt,
      verdict: (body.rollup as Record<string, unknown>).verdict,
      exitCode: 0,
      gateVerdict: (body.gate as Record<string, unknown>).verdict,
      cleanliness: ((body.metadata as Record<string, unknown>).git as Record<string, unknown>).cleanliness,
      algorithm: "sha256",
      digest: sha256(canonicalize(body)),
    },
  };
}

/** Serialize an artifact to the JSON text the CLI/file path would carry. */
export function artifactText(o: ArtifactOptions = {}): string {
  return JSON.stringify(makeArtifact(o));
}
