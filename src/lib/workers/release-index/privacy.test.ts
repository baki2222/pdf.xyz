// @vitest-environment node
/**
 * Hostile no-leak proof for the release evidence index (Phase 48). It feeds artifacts stuffed with
 * malicious labels, raw refs, path/URL/secret-shaped commit + detail fields, and embedded EXTRA fields
 * an honest artifact would never carry, plus malicious FILE PATHS, and proves the rendered manifest
 * (json + text) — for a VERIFIED, a TAMPERED, and an UNREADABLE input alike — never echoes a single
 * one of them. The index reduces every artifact to bounded enums, small counts, coarse age buckets,
 * booleans, and short HEX digest prefixes, so there is nowhere for a locator or a byte to enter.
 */

import { describe, expect, it } from "vitest";
import { canonicalize } from "../release-artifact/canonicalize";
import { RELEASE_ARTIFACT_SCHEMA } from "../release-artifact/types";
import { buildIndex } from "./build";
import { ingestArtifact } from "./ingest";
import { renderReleaseIndex } from "./render";
import { runReleaseIndex, type ReleaseIndexProvider } from "./run";
import type { ReleaseIndexArgs } from "./args";
import { sha256 } from "./fixtures";

const NOW = "2026-07-03T00:00:00.000Z";

/** Locator / secret VALUES that must never appear in a manifest, from a hostile input or a path. */
const SECRETS = [
  "akiaiosfodnn7example",
  "s3://evil-bucket/secret",
  "/tmp/leak/customer-data.pdf",
  "https://evil.example.com/webhook",
  "sk-super-secret-token-value",
  "refs/heads/feature/top-secret-launch",
  "bearer zzz999",
  "192.168.44.7",
  "leaked-object-key-9f3",
  "evil-bucket-name",
  "us-gov-west-1",
];

/** Build a hostile artifact BODY stuffed with secrets in every field an attacker controls. */
function hostileBody(): Record<string, unknown> {
  return {
    generatedAt: "2026-07-02T00:00:00.000Z",
    metadata: {
      schemaVersion: 1,
      policyId: "pdfxyz-worker-release-evidence-artifact",
      policyVersion: 1,
      label: "AKIAIOSFODNN7EXAMPLE", // hostile label (never echoed, only classified)
      git: {
        cleanliness: "clean",
        refClass: "topic",
        commit: "/tmp/leak/customer-data.pdf", // hostile commit value (never read)
        commitPresent: true,
        rawRef: "refs/heads/feature/top-secret-launch", // extra field (never read)
      },
      evilMeta: "s3://evil-bucket/secret",
    },
    gate: {
      source: "supplied",
      present: true,
      verdict: "pass",
      includedChecks: 1,
      passedChecks: 1,
      skippedChecks: 0,
      blockers: ["leaked-object-key-9f3"],
      checks: [{ id: "evil-bucket-name", status: "us-gov-west-1" }],
      detail: "https://evil.example.com/webhook bearer zzz999",
    },
    opsBundle: {
      source: "not-configured",
      present: false,
      severity: null,
      detail: "leaked-object-key-9f3 us-gov-west-1",
    },
    rollup: {
      verdict: "pass",
      exitCode: 0,
      ready: true,
      drivers: [],
      detail: "192.168.44.7 sk-super-secret-token-value",
    },
    guidance: ["refs/heads/feature/top-secret-launch"],
    caveats: ["evil-bucket-name"],
    evilBody: "sk-super-secret-token-value",
  };
}

/** Assemble a hostile artifact object with a CORRECT digest + a hostile top-level extra field. */
function hostileArtifact(): Record<string, unknown> {
  const body = hostileBody();
  return {
    schema: RELEASE_ARTIFACT_SCHEMA,
    body,
    integrity: {
      algorithm: "sha256",
      encoding: "hex",
      canonicalization: "pdfxyz-sorted-keys/1",
      digest: sha256(canonicalize(body)),
    },
    receipt: { evilReceipt: "s3://evil-bucket/secret" },
    evilTop: "192.168.44.7",
  };
}

function assertNoLeak(output: string, label: string): void {
  const lower = output.toLowerCase();
  for (const secret of SECRETS) {
    expect(lower, `${label} leaked ${secret}`).not.toContain(secret.toLowerCase());
  }
}

describe("release-index — hostile no-leak", () => {
  it("a VERIFIED hostile artifact renders content-free in json + text", () => {
    const idx = buildIndex(NOW, [ingestArtifact(hostileArtifact(), sha256)], { maxArtifacts: 1, maxAgeDays: 30 });
    // the digest verified (correct), so every field was read + reduced — and still nothing leaks
    expect(idx.artifacts[0]!.digestStatus).toBe("verified");
    expect(idx.artifacts[0]!.labelClass).toBe("named"); // classified, never echoed
    assertNoLeak(renderReleaseIndex(idx, "json"), "verified/json");
    assertNoLeak(renderReleaseIndex(idx, "text"), "verified/text");
  });

  it("a TAMPERED hostile artifact renders content-free in json + text", () => {
    const art = hostileArtifact();
    (art.body as { rollup: Record<string, unknown> }).rollup.detail = "changed to break the digest";
    const idx = buildIndex(NOW, [ingestArtifact(art, sha256)], { maxArtifacts: null, maxAgeDays: null });
    expect(idx.artifacts[0]!.digestStatus).toBe("mismatch");
    expect(idx.rollup.verdict).toBe("invalid");
    assertNoLeak(renderReleaseIndex(idx, "json"), "tampered/json");
    assertNoLeak(renderReleaseIndex(idx, "text"), "tampered/text");
  });

  it("the digest prefix is pure hex (cannot embed any locator token)", () => {
    const idx = buildIndex(NOW, [ingestArtifact(hostileArtifact(), sha256)], { maxArtifacts: null, maxAgeDays: null });
    expect(idx.artifacts[0]!.digestPrefix).toMatch(/^[0-9a-f]{12}$/);
  });

  it("never echoes a malicious FILE PATH — readable or unreadable — into the output or errors", async () => {
    const hostilePathA = "/tmp/leak/customer-data.pdf";
    const hostilePathB = "s3://evil-bucket/secret/missing.json";
    const provider: ReleaseIndexProvider = {
      now: () => NOW,
      hash: sha256,
      readArtifact: async (path: string) =>
        path === hostilePathA ? JSON.stringify(hostileArtifact()) : Promise.reject(new Error("enoent")),
      readStdin: async () => "",
    };
    const args: ReleaseIndexArgs = {
      format: "text",
      pretty: true,
      artifactPaths: [hostilePathA, hostilePathB],
    };
    const run = await runReleaseIndex(args, provider);
    assertNoLeak(run.output, "paths/text");
    expect(run.output).not.toContain(hostilePathA);
    expect(run.output).not.toContain(hostilePathB);
    // one indexed, one skipped — proving the unreadable hostile path was recorded, not echoed
    expect(run.index.retention.indexedArtifacts).toBe(1);
    expect(run.index.retention.skippedInputs).toBe(1);
  });
});
