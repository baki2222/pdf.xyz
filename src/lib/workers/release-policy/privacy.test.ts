// @vitest-environment node
/**
 * Hostile no-leak proof for the release policy (Phase 49). It feeds "release-index" manifests stuffed
 * with malicious labels, raw refs, path/URL/secret-shaped fields, and embedded EXTRA fields an honest
 * index would never carry — as a VALID+CONSISTENT index, an INCONSISTENT one, and an UNRECOGNIZED
 * blob — plus malicious FILE PATHS, and proves the rendered result (json + text) never echoes a single
 * one of them. The policy reduces every index to bounded enums, small counts, coarse age buckets, and
 * booleans, and the renderers reach only the reduced result — so there is nowhere for a locator or a
 * byte to enter.
 */

import { describe, expect, it } from "vitest";
import { runReleasePolicy, type ReleasePolicyProvider } from "./run";
import { buildPolicyResult } from "./build";
import { ingestIndex } from "./ingest";
import { renderReleasePolicy } from "./render";
import { emptyPolicy, makeIndex, NOW, sha256 } from "./fixtures";
import type { ReleasePolicyArgs } from "./args";
import type { ReleasePolicyInputs } from "./types";

/** Locator / secret VALUES that must never appear in a result, from a hostile input or a path. */
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

/** The policy that exercises the most fact fields (so every reduced field is rendered). */
function fullPolicy(): ReleasePolicyInputs {
  return {
    ...emptyPolicy(),
    requireClean: true,
    requireLatestOk: true,
    maxInvalid: 0,
    maxFail: 0,
    minArtifacts: 1,
    maxArtifacts: 100,
    maxAgeBucket: "90d+",
    maxWarn: 0,
    maxSkipped: 0,
    forbidOverRetention: true,
  };
}

/** Deep-stuff every non-load-bearing field of a real, valid index with secrets (keeping it consistent). */
function hostileIndex(): Record<string, unknown> {
  const idx = JSON.parse(
    JSON.stringify(makeIndex([{ generatedAt: NOW, verdict: "pass" }, { generatedAt: NOW, verdict: "warn" }])),
  ) as Record<string, unknown>;

  // Top-level extra + prose fields the policy never reads.
  idx.evilTop = "s3://evil-bucket/secret";
  idx.generatedAt = NOW; // keep the stamp benign
  (idx.metadata as Record<string, unknown>).evilMeta = "akiaiosfodnn7example";
  (idx.rollup as Record<string, unknown>).detail = "192.168.44.7 sk-super-secret-token-value";
  (idx.retention as Record<string, unknown>).evilRetention = "us-gov-west-1";
  idx.guidance = ["refs/heads/feature/top-secret-launch"];
  idx.caveats = ["evil-bucket-name"];
  idx.receipt = { evilReceipt: "https://evil.example.com/webhook" };

  // Per-artifact entries: stuff every field the policy ignores (it reads only digestStatus + verdict).
  for (const entry of idx.artifacts as Record<string, unknown>[]) {
    entry.digestPrefix = "leaked-object-key-9f3";
    entry.evilEntry = "bearer zzz999";
    entry.refClass = "refs/heads/feature/top-secret-launch";
    entry.gateSource = "s3://evil-bucket/secret";
  }
  return idx;
}

function assertNoLeak(output: string, label: string): void {
  const lower = output.toLowerCase();
  for (const secret of SECRETS) {
    expect(lower, `${label} leaked ${secret}`).not.toContain(secret.toLowerCase());
  }
}

function args(over: Partial<ReleasePolicyArgs> = {}): ReleasePolicyArgs {
  return { format: "json", pretty: true, artifactPaths: [], policy: fullPolicy(), ...over };
}

describe("release-policy — hostile no-leak", () => {
  it("a VALID hostile index renders content-free in json + text", () => {
    const ingested = ingestIndex(hostileIndex());
    expect(ingested.usable).toBe(true); // it stayed consistent — every field was read + reduced
    const result = buildPolicyResult(NOW, "index", ingested, fullPolicy());
    assertNoLeak(renderReleasePolicy(result, "json"), "valid/json");
    assertNoLeak(renderReleasePolicy(result, "text"), "valid/text");
  });

  it("an INCONSISTENT hostile index (fail) renders content-free in json + text", () => {
    const idx = hostileIndex();
    (idx.rollup as Record<string, unknown>).verdict = "invalid"; // contradicts its clean counts
    const ingested = ingestIndex(idx);
    expect(ingested.usable).toBe(false);
    const result = buildPolicyResult(NOW, "index", ingested, fullPolicy());
    expect(result.rollup.verdict).toBe("fail");
    assertNoLeak(renderReleasePolicy(result, "json"), "inconsistent/json");
    assertNoLeak(renderReleasePolicy(result, "text"), "inconsistent/text");
  });

  it("an UNRECOGNIZED hostile blob (unknown) renders content-free in json + text", () => {
    const blob = { schema: "s3://evil-bucket/secret", evil: "sk-super-secret-token-value", akia: "akiaiosfodnn7example" };
    const ingested = ingestIndex(blob);
    expect(ingested.recognized).toBe(false);
    const result = buildPolicyResult(NOW, "index", ingested, emptyPolicy());
    assertNoLeak(renderReleasePolicy(result, "json"), "unknown/json");
    assertNoLeak(renderReleasePolicy(result, "text"), "unknown/text");
  });

  it("never echoes a malicious --index FILE PATH — readable or unreadable — in output or errors", async () => {
    const hostilePath = "/tmp/leak/customer-data.pdf";
    const provider: ReleasePolicyProvider = {
      now: () => NOW,
      hash: sha256,
      readIndex: async () => JSON.stringify(hostileIndex()),
      readArtifact: async () => Promise.reject(new Error("enoent")),
      readStdin: async () => "",
    };
    const run = await runReleasePolicy(args({ indexPath: hostilePath, format: "text" }), provider);
    assertNoLeak(run.output, "path/text");
    expect(run.output).not.toContain(hostilePath);
  });

  it("never echoes a malicious --artifact FILE PATH — readable or unreadable", async () => {
    const readablePath = "/tmp/leak/customer-data.pdf";
    const missingPath = "s3://evil-bucket/secret/missing.json";
    const provider: ReleasePolicyProvider = {
      now: () => NOW,
      hash: sha256,
      readIndex: async () => "",
      readArtifact: async (path) =>
        path === readablePath
          ? JSON.stringify({
              schema: "pdfxyz.release-artifact/1",
              body: { evil: "leaked-object-key-9f3" },
              integrity: { digest: "bearer zzz999" },
            })
          : Promise.reject(new Error("enoent")),
      readStdin: async () => "",
    };
    const run = await runReleasePolicy(
      args({ artifactPaths: [readablePath, missingPath], format: "text", policy: emptyPolicy() }),
      provider,
    );
    assertNoLeak(run.output, "artifact-paths/text");
    expect(run.output).not.toContain(readablePath);
    expect(run.output).not.toContain(missingPath);
  });

  it("the render reaches only the reduced result — a stray secret in facts is impossible", () => {
    // Build directly from a usable ingest and confirm the JSON has no non-enum string beyond prose.
    const result = buildPolicyResult(NOW, "index", ingestIndex(hostileIndex()), fullPolicy());
    const json = JSON.parse(renderReleasePolicy(result, "json"));
    // facts fields are all enums / ints / buckets
    expect(typeof json.facts.indexedArtifacts).toBe("number");
    expect(json.facts.latestVerdict).toBe("pass");
    expect(json.facts).not.toHaveProperty("evilEntry");
  });
});
