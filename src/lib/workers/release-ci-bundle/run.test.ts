import { describe, expect, it } from "vitest";
import { runReleaseCiBundle } from "./run";
import { RELEASE_CI_BUNDLE_SCHEMA } from "./types";
import {
  makeArgs,
  makeChain,
  makeIndex,
  makePolicyResult,
  makeProvider,
  NOW,
  type StageObjects,
} from "./fixtures";

/** Run the bundle over a set of stage objects and return the parsed result + exit code. */
async function bundle(objs: StageObjects) {
  const run = await runReleaseCiBundle(makeArgs(objs), makeProvider(objs));
  return { exitCode: run.exitCode, result: run.result, output: run.output };
}

describe("release-ci-bundle run — verdicts + exit codes", () => {
  it("a fully coherent chain → pass (exit 0)", async () => {
    const { exitCode, result } = await bundle(makeChain());
    expect(result.schema).toBe(RELEASE_CI_BUNDLE_SCHEMA);
    expect(result.rollup.verdict).toBe("pass");
    expect(exitCode).toBe(0);
    expect(result.rollup.chainComplete).toBe(true);
    expect(result.rollup.decisionStage).toBe("policy");
    expect(result.rollup.stagesPresent).toBe(4);
    expect(result.rollup.inconsistencies).toBe(0);
  });

  it("a coherent index+policy (no gate/artifact) → pass, decision stage policy", async () => {
    const chain = makeChain();
    const { exitCode, result } = await bundle({ index: chain.index, policy: chain.policy });
    expect(result.rollup.verdict).toBe("pass");
    expect(exitCode).toBe(0);
    expect(result.rollup.chainComplete).toBe(false);
    expect(result.rollup.decisionStage).toBe("policy");
  });

  it("a failed policy stage → fail (exit 4) via stage-failed", async () => {
    // A policy that fails a blocking assertion the archive cannot meet.
    const chain = makeChain();
    const failPolicy = makePolicyResult(chain.index, {
      requireClean: true,
      requireLatestOk: false,
      maxInvalid: null,
      maxFail: null,
      minArtifacts: 99, // more than the archive holds → blocking violation
      maxArtifacts: null,
      maxAgeBucket: null,
      maxWarn: null,
      maxSkipped: null,
      forbidOverRetention: false,
    });
    const { exitCode, result } = await bundle({ index: chain.index, policy: failPolicy });
    expect(result.rollup.verdict).toBe("fail");
    expect(exitCode).toBe(4);
    expect(result.rollup.drivers).toContain("stage-failed");
  });

  it("a cross-stage inconsistency → fail (exit 4) via chain-inconsistent", async () => {
    const index1 = makeIndex([{ generatedAt: NOW, verdict: "pass" }]);
    const policyOverTwo = makePolicyResult(
      makeIndex([{ generatedAt: NOW, verdict: "pass" }, { generatedAt: NOW, verdict: "pass" }]),
    );
    const { exitCode, result } = await bundle({ index: index1, policy: policyOverTwo });
    expect(result.rollup.verdict).toBe("fail");
    expect(exitCode).toBe(4);
    expect(result.rollup.drivers).toContain("chain-inconsistent");
    expect(result.rollup.inconsistencies).toBeGreaterThan(0);
  });

  it("a warning-only stage → warn (exit 3)", async () => {
    // A policy that warns (a warning-only assertion) over an otherwise clean archive.
    const chain = makeChain({ generatedAt: NOW, verdict: "warn", gateVerdict: "warn" });
    const warnPolicy = makePolicyResult(chain.index, {
      requireClean: false,
      requireLatestOk: false,
      maxInvalid: null,
      maxFail: null,
      minArtifacts: null,
      maxArtifacts: null,
      maxAgeBucket: null,
      maxWarn: 0, // the archive has a warn artifact → warning-only violation
      maxSkipped: null,
      forbidOverRetention: false,
    });
    const { exitCode, result } = await bundle({ index: chain.index, policy: warnPolicy });
    expect(result.rollup.verdict).toBe("warn");
    expect(exitCode).toBe(3);
    expect(result.rollup.drivers).toContain("stage-warned");
  });

  it("gate/artifact only (no decision stage) → unknown (exit 2) via incomplete-chain", async () => {
    const chain = makeChain();
    const { exitCode, result } = await bundle({ gate: chain.gate, artifact: chain.artifact });
    expect(result.rollup.verdict).toBe("unknown");
    expect(exitCode).toBe(2);
    expect(result.rollup.drivers).toContain("incomplete-chain");
  });

  it("a supplied-but-unreadable stage → unknown (exit 2) via stage-unreadable", async () => {
    const { exitCode, result } = await bundle({ index: "this is not json at all" });
    expect(result.rollup.verdict).toBe("unknown");
    expect(exitCode).toBe(2);
    expect(result.rollup.drivers).toContain("stage-unreadable");
    expect(result.stages.find((s) => s.stage === "index")?.source).toBe("unreadable");
  });

  it("a wrong-schema stage file → unreadable, not a fabricated pass", async () => {
    const { result } = await bundle({ policy: { schema: "something.else/1", rollup: { verdict: "pass" } } });
    const policyStage = result.stages.find((s) => s.stage === "policy");
    expect(policyStage?.recognized).toBe(false);
    expect(policyStage?.source).toBe("unreadable");
    expect(result.rollup.verdict).toBe("unknown");
  });

  it("an unreadable file (read throws) becomes an unreadable stage, path never echoed", async () => {
    const provider = makeProvider({}); // serves nothing → every read throws
    const run = await runReleaseCiBundle(
      { format: "text", pretty: true, indexPath: "/tmp/secret/customer.json" },
      provider,
    );
    expect(run.result.rollup.verdict).toBe("unknown");
    expect(run.output).not.toContain("/tmp/secret");
  });

  it("is deterministic — same input + stamp yields byte-identical output", async () => {
    const chain = makeChain();
    const a = await bundle(chain);
    const b = await bundle(chain);
    expect(a.output).toBe(b.output);
  });
});
