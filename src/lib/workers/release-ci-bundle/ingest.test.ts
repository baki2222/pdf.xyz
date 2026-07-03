import { describe, expect, it } from "vitest";
import {
  ingestGate,
  ingestArtifactStage,
  ingestIndexStage,
  ingestPolicy,
} from "./ingest";
import { emptyPolicy, makeArtifact, makeChain, makeGate, makeIndex, makePolicyResult, sha256, NOW } from "./fixtures";

describe("release-ci-bundle ingest — gate", () => {
  it("reduces a recognized gate to a bounded verdict + check counts", () => {
    const g = ingestGate(makeGate("warn", { includedChecks: 7, passedChecks: 6, skippedChecks: 1, blockers: ["worker-smoke"] }));
    expect(g.recognized).toBe(true);
    expect(g.verdict).toBe("warn");
    expect(g.facts).toEqual({ includedChecks: 7, passedChecks: 6, skippedChecks: 1, blockers: 1 });
  });

  it("a wrong-schema / non-object input is not recognized", () => {
    expect(ingestGate({ schema: "nope" }).recognized).toBe(false);
    expect(ingestGate(undefined).recognized).toBe(false);
    expect(ingestGate("string").recognized).toBe(false);
  });

  it("a recognized gate with no valid verdict carries a null verdict", () => {
    const g = ingestGate({ schema: "pdfxyz.worker-release-gate/1", rollup: { verdict: "bogus" } });
    expect(g.recognized).toBe(true);
    expect(g.verdict).toBeNull();
  });
});

describe("release-ci-bundle ingest — artifact (delegated digest re-verify)", () => {
  it("a well-formed artifact re-verifies (digestStatus verified)", () => {
    const a = ingestArtifactStage(makeArtifact({ verdict: "pass", gateVerdict: "pass" }), sha256);
    expect(a.digestStatus).toBe("verified");
    expect(a.verdict).toBe("pass");
    expect(a.gateVerdict).toBe("pass");
    expect(a.digestPrefix).toMatch(/^[0-9a-f]{1,12}$/);
  });

  it("a tampered body is a mismatch", () => {
    const artifact = makeArtifact({ verdict: "pass" }) as Record<string, unknown>;
    (artifact.body as Record<string, unknown>).generatedAt = "2099-01-01T00:00:00.000Z";
    expect(ingestArtifactStage(artifact, sha256).digestStatus).toBe("mismatch");
  });

  it("a non-artifact is unreadable", () => {
    expect(ingestArtifactStage({ schema: "nope" }, sha256).digestStatus).toBe("unreadable");
    expect(ingestArtifactStage(undefined, sha256).digestStatus).toBe("unreadable");
  });
});

describe("release-ci-bundle ingest — index (delegated self-consistency recompute)", () => {
  it("a valid index is usable with reduced facts + verified entry prefixes", () => {
    const s = ingestIndexStage(makeIndex([{ generatedAt: NOW, verdict: "pass" }]));
    expect(s.recognized).toBe(true);
    expect(s.usable).toBe(true);
    expect(s.verdict).toBe("ok");
    expect(s.facts?.indexedArtifacts).toBe(1);
    expect(s.verifiedEntries.length).toBe(1);
    expect(s.verifiedEntries[0]!.verdict).toBe("pass");
    expect(s.verifiedEntries[0]!.prefix).toMatch(/^[0-9a-f]{1,12}$/);
  });

  it("a self-contradicting index is recognized but not usable", () => {
    const index = JSON.parse(JSON.stringify(makeIndex([{ generatedAt: NOW, verdict: "pass" }])));
    index.retention.indexedArtifacts += 3;
    const s = ingestIndexStage(index);
    expect(s.recognized).toBe(true);
    expect(s.usable).toBe(false);
    expect(s.facts).toBeNull();
    expect(s.verifiedEntries).toEqual([]);
  });

  it("a wrong-schema input is not recognized", () => {
    expect(ingestIndexStage({ schema: "nope" }).recognized).toBe(false);
    expect(ingestIndexStage(undefined).recognized).toBe(false);
  });
});

describe("release-ci-bundle ingest — policy (delegated verdict re-derive)", () => {
  it("a self-consistent policy result is usable with reduced facts", () => {
    const p = ingestPolicy(makeChain().policy);
    expect(p.recognized).toBe(true);
    expect(p.usable).toBe(true);
    expect(p.verdict).toBe("pass");
    expect(p.facts?.effectiveVerdict).toBe("ok");
    expect(p.facts?.indexUsable).toBe(true);
    expect(p.facts?.indexedArtifacts).toBe(1);
  });

  it("a flipped rollup verdict is recognized but not usable (re-derive disagrees)", () => {
    const policy = JSON.parse(JSON.stringify(makeChain().policy));
    policy.rollup.verdict = "fail";
    const p = ingestPolicy(policy);
    expect(p.recognized).toBe(true);
    expect(p.usable).toBe(false);
    expect(p.verdict).toBe("fail"); // its CLAIM is surfaced...
    expect(p.facts).toBeNull(); // ...but no facts are trusted from an inconsistent result
  });

  it("a malformed facts block (with usable index claim) is recognized but not usable", () => {
    const policy = JSON.parse(JSON.stringify(makeChain().policy));
    policy.facts.indexedArtifacts = "not a number";
    const p = ingestPolicy(policy);
    expect(p.recognized).toBe(true);
    expect(p.usable).toBe(false);
  });

  it("an unknown-index policy (facts null) still re-derives cleanly", () => {
    // A no-assertion policy over an empty archive is `unknown` with facts null; it must recompute to
    // unknown (usable), never a false pass. (With a blocking assertion an empty archive is a real fail.)
    const emptyIndex = makeIndex([]);
    const p = ingestPolicy(makePolicyResult(emptyIndex, emptyPolicy()));
    expect(p.recognized).toBe(true);
    expect(p.usable).toBe(true);
    expect(p.verdict).toBe("unknown");
  });

  it("a wrong-schema input is not recognized", () => {
    expect(ingestPolicy({ schema: "nope" }).recognized).toBe(false);
    expect(ingestPolicy(undefined).recognized).toBe(false);
  });
});
