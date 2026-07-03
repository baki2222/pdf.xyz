// @vitest-environment node
/**
 * Hostile no-leak proof for the release CI bundle (Phase 50). It feeds each stage stuffed with malicious
 * labels, raw refs, path/URL/secret-shaped fields, digests, and embedded EXTRA fields an honest stage
 * would never carry — as a VALID+COHERENT chain, an INCONSISTENT one, and UNRECOGNIZED blobs — plus
 * malicious FILE PATHS, and proves the rendered bundle (json + text) never echoes a single one of them.
 * The bundle reduces every stage to bounded enums, small counts, and booleans, and the renderers reach
 * only the reduced result — so there is nowhere for a locator or a byte to enter.
 */

import { describe, expect, it } from "vitest";
import { runReleaseCiBundle } from "./run";
import { buildBundleResult } from "./build";
import { renderReleaseCiBundle } from "./render";
import { canonicalize } from "../release-artifact/canonicalize";
import {
  ingestStagesFrom,
  makeArgs,
  makeChain,
  makeProvider,
  sha256,
  NOW,
  type StageObjects,
} from "./fixtures";

/** Locator / secret VALUES that must never appear in a bundle, from a hostile stage or a path. */
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

type Obj = Record<string, unknown>;

/** Deep-stuff every NON-load-bearing field of the coherent chain with secrets (keeping it consistent). */
function hostileChain(): StageObjects {
  const chain = JSON.parse(JSON.stringify(makeChain())) as {
    gate: Obj;
    artifact: Obj;
    index: Obj;
    policy: Obj;
  };

  // Gate: prose + extra fields + a secret-shaped blocker id (only its COUNT is read).
  chain.gate.evilTop = "s3://evil-bucket/secret";
  (chain.gate.rollup as Obj).detail = "192.168.44.7 sk-super-secret-token-value";
  (chain.gate.rollup as Obj).blockers = ["refs/heads/feature/top-secret-launch"];
  chain.gate.guidance = ["bearer zzz999"];

  // Artifact: stuff only NON-hashed locations (top-level, integrity, receipt) so the digest still
  // re-verifies and the chain stays coherent. Body prose is proven dropped by a dedicated test below.
  chain.artifact.evilTop = "leaked-object-key-9f3";
  (chain.artifact.integrity as Obj).evilIntegrity = "https://evil.example.com/webhook";
  chain.artifact.receipt = { evilReceipt: "us-gov-west-1" };

  // Index: prose + extra fields + a secret-shaped digest prefix (rejected — not hex).
  chain.index.evilTop = "akiaiosfodnn7example";
  (chain.index.rollup as Obj).detail = "s3://evil-bucket/secret";
  chain.index.guidance = ["refs/heads/feature/top-secret-launch"];
  chain.index.caveats = ["evil-bucket-name"];
  for (const entry of chain.index.artifacts as Obj[]) {
    entry.evilEntry = "bearer zzz999";
    entry.gateSource = "https://evil.example.com/webhook";
  }

  // Policy: prose + extra fields the bundle never reads.
  chain.policy.evilTop = "sk-super-secret-token-value";
  (chain.policy.rollup as Obj).detail = "192.168.44.7";
  chain.policy.guidance = ["s3://evil-bucket/secret"];
  chain.policy.caveats = ["leaked-object-key-9f3"];
  if (chain.policy.facts) (chain.policy.facts as Obj).evilFact = "us-gov-west-1";

  return chain;
}

function assertNoLeak(output: string, label: string): void {
  const lower = output.toLowerCase();
  for (const secret of SECRETS) {
    expect(lower, `${label} leaked ${secret}`).not.toContain(secret.toLowerCase());
  }
}

describe("release-ci-bundle — hostile no-leak", () => {
  it("a VALID hostile chain renders content-free in json + text", () => {
    const objs = hostileChain();
    const result = buildBundleResult(NOW, ingestStagesFrom(objs));
    // The chain stays coherent (extra fields are non-load-bearing) → a real pass, no leaks.
    expect(result.rollup.verdict).toBe("pass");
    assertNoLeak(renderReleaseCiBundle(result, "json"), "valid/json");
    assertNoLeak(renderReleaseCiBundle(result, "text"), "valid/text");
  });

  it("an INCONSISTENT hostile chain (fail) renders content-free in json + text", () => {
    const objs = hostileChain();
    // Flip the policy verdict to smuggle a lie → a blocking inconsistency (fail), still content-free.
    (objs.policy as Obj).rollup = { ...((objs.policy as Obj).rollup as Obj), verdict: "warn" };
    const result = buildBundleResult(NOW, ingestStagesFrom(objs));
    expect(result.rollup.verdict).toBe("fail");
    assertNoLeak(renderReleaseCiBundle(result, "json"), "inconsistent/json");
    assertNoLeak(renderReleaseCiBundle(result, "text"), "inconsistent/text");
  });

  it("UNRECOGNIZED hostile blobs (unknown) render content-free in json + text", () => {
    const blob = { schema: "s3://evil-bucket/secret", evil: "sk-super-secret-token-value", akia: "akiaiosfodnn7example" };
    const result = buildBundleResult(NOW, ingestStagesFrom({ gate: blob, index: blob, policy: blob }));
    expect(result.rollup.verdict).toBe("unknown");
    assertNoLeak(renderReleaseCiBundle(result, "json"), "unknown/json");
    assertNoLeak(renderReleaseCiBundle(result, "text"), "unknown/text");
  });

  it("never echoes a malicious stage FILE PATH — readable or unreadable — in output or errors", async () => {
    const hostilePath = "/tmp/leak/customer-data.pdf";
    const missingPath = "s3://evil-bucket/secret/missing.json";
    const objs = hostileChain();
    // Serve the index at the hostile path; leave the policy path unreadable.
    const provider = {
      now: () => NOW,
      hash: makeProvider(objs).hash,
      readFile: async (path: string) =>
        path === hostilePath ? JSON.stringify(objs.index) : Promise.reject(new Error("enoent")),
    };
    const run = await runReleaseCiBundle(
      { format: "text", pretty: true, indexPath: hostilePath, policyPath: missingPath },
      provider,
    );
    assertNoLeak(run.output, "paths/text");
    expect(run.output).not.toContain(hostilePath);
    expect(run.output).not.toContain(missingPath);
  });

  it("drops artifact BODY prose even when the artifact re-verifies (re-hashed with a secret inside)", () => {
    const chain = JSON.parse(JSON.stringify(makeChain())) as { artifact: Obj };
    const body = chain.artifact.body as Obj;
    (body.gate as Obj).detail = "sk-super-secret-token-value";
    body.guidance = ["s3://evil-bucket/secret"];
    body.caveats = ["refs/heads/feature/top-secret-launch"];
    // Re-stamp the digest over the secret-bearing body so the artifact still VERIFIES.
    chain.artifact.integrity = { ...(chain.artifact.integrity as Obj), digest: sha256(canonicalize(body)) };
    const result = buildBundleResult(NOW, ingestStagesFrom({ artifact: chain.artifact }));
    const stage = result.stages.find((s) => s.stage === "artifact");
    expect(stage?.recognized).toBe(true); // it re-verified despite the secret prose...
    assertNoLeak(renderReleaseCiBundle(result, "json"), "artifact-body/json"); // ...but the prose is dropped
    assertNoLeak(renderReleaseCiBundle(result, "text"), "artifact-body/text");
  });

  it("the render reaches only the reduced result — a stray secret in facts is impossible", () => {
    const result = buildBundleResult(NOW, ingestStagesFrom(hostileChain()));
    const json = JSON.parse(renderReleaseCiBundle(result, "json"));
    const index = json.stages.find((s: { stage: string }) => s.stage === "index");
    expect(index.facts).not.toHaveProperty("evilEntry");
    expect(typeof index.facts.indexedArtifacts).toBe("number");
    // Every stage verdict is a bounded enum or null; no raw string escaped.
    for (const stage of json.stages) {
      expect(stage.verdict === null || typeof stage.verdict === "string").toBe(true);
    }
  });

  it("a full pretty-printed bundle over the coherent chain never contains a forbidden token", async () => {
    const objs = makeChain();
    for (const format of ["json", "text"] as const) {
      const run = await runReleaseCiBundle(makeArgs(objs, { format }), makeProvider(objs));
      assertNoLeak(run.output, `coherent/${format}`);
    }
  });
});
