import { afterEach, describe, expect, it } from "vitest";
import { runReleasePolicy, type ReleasePolicyProvider } from "./run";
import { recordReleasePolicy, resetReleasePolicySink, setReleasePolicySink } from "./metrics";
import { indexText, makeArtifact, NOW, sha256 } from "./fixtures";
import type { ReleasePolicyArgs } from "./args";
import type { WorkerMetricSample } from "../observability/metrics";

/** A provider whose reads come from an in-memory map (path → text); missing paths throw. */
function provider(files: Record<string, string>, stdin = ""): ReleasePolicyProvider {
  return {
    now: () => NOW,
    hash: sha256,
    readIndex: async (path) => {
      const t = files[path];
      if (t === undefined) throw new Error("enoent");
      return t;
    },
    readArtifact: async (path) => {
      const t = files[path];
      if (t === undefined) throw new Error("enoent");
      return t;
    },
    readStdin: async () => stdin,
  };
}

function args(over: Partial<ReleasePolicyArgs> = {}): ReleasePolicyArgs {
  return {
    format: "json",
    pretty: true,
    artifactPaths: [],
    policy: {
      requireClean: false,
      requireLatestOk: false,
      maxInvalid: null,
      maxFail: null,
      minArtifacts: null,
      maxArtifacts: null,
      maxAgeBucket: null,
      maxWarn: null,
      maxSkipped: null,
      forbidOverRetention: false,
    },
    ...over,
  };
}

afterEach(() => resetReleasePolicySink());

describe("runReleasePolicy — index mode", () => {
  it("evaluates a --index file → pass with the full result shape", async () => {
    const files = { "idx.json": indexText([{ generatedAt: NOW, verdict: "pass" }, { generatedAt: NOW, verdict: "pass" }]) };
    const run = await runReleasePolicy(args({ indexPath: "idx.json", policy: { ...args().policy, requireClean: true, minArtifacts: 2 } }), provider(files));
    expect(run.exitCode).toBe(0);
    expect(run.result.source).toBe("index");
    expect(run.result.rollup.verdict).toBe("pass");
    expect(JSON.parse(run.output).schema).toBe("pdfxyz.release-policy/1");
  });

  it("an unreadable --index file is unknown (exit 2), path never echoed", async () => {
    const run = await runReleasePolicy(args({ indexPath: "/secret/missing.json" }), provider({}));
    expect(run.exitCode).toBe(2);
    expect(run.result.indexRecognized).toBe(false);
    expect(run.output).not.toContain("/secret/missing.json");
  });

  it("a non-JSON --index file is unknown (exit 2)", async () => {
    const run = await runReleasePolicy(args({ indexPath: "idx.json" }), provider({ "idx.json": "not json {" }));
    expect(run.exitCode).toBe(2);
    expect(run.result.indexRecognized).toBe(false);
  });

  it("a blocking violation is fail (exit 4)", async () => {
    const files = { "idx.json": indexText([{ generatedAt: NOW, verdict: "fail" }]) };
    const run = await runReleasePolicy(args({ indexPath: "idx.json", policy: { ...args().policy, maxFail: 0 } }), provider(files));
    expect(run.exitCode).toBe(4);
    expect(run.result.violations.map((v) => v.id)).toContain("too-many-fail");
  });
});

describe("runReleasePolicy — stdin mode", () => {
  it("reads a release-index object on stdin when no input flag is given", async () => {
    const stdin = indexText([{ generatedAt: NOW, verdict: "pass" }]);
    const run = await runReleasePolicy(args({ policy: { ...args().policy, requireClean: true } }), provider({}, stdin));
    expect(run.exitCode).toBe(0);
    expect(run.result.source).toBe("index");
  });

  it("empty stdin is unknown (exit 2)", async () => {
    const run = await runReleasePolicy(args(), provider({}, ""));
    expect(run.exitCode).toBe(2);
    expect(run.result.rollup.drivers).toContain("no-index");
  });
});

describe("runReleasePolicy — artifact mode (re-verifies digests in-process)", () => {
  it("indexes raw artifacts and evaluates policy → pass", async () => {
    const files = {
      "a.json": JSON.stringify(makeArtifact({ generatedAt: NOW, verdict: "pass" })),
      "b.json": JSON.stringify(makeArtifact({ generatedAt: NOW, verdict: "pass" })),
    };
    const run = await runReleasePolicy(args({ artifactPaths: ["a.json", "b.json"], policy: { ...args().policy, requireClean: true, minArtifacts: 2 } }), provider(files));
    expect(run.exitCode).toBe(0);
    expect(run.result.source).toBe("artifacts");
    expect(run.result.facts!.indexedArtifacts).toBe(2);
  });

  it("catches a tampered artifact by re-hashing → fail (index-tampered)", async () => {
    const good = makeArtifact({ generatedAt: NOW, verdict: "pass" });
    const tampered = { ...makeArtifact({ generatedAt: NOW, verdict: "pass" }), integrity: { algorithm: "sha256", encoding: "hex", canonicalization: "pdfxyz-sorted-keys/1", digest: sha256("wrong") } };
    const files = { "a.json": JSON.stringify(good), "b.json": JSON.stringify(tampered) };
    const run = await runReleasePolicy(args({ artifactPaths: ["a.json", "b.json"] }), provider(files));
    expect(run.exitCode).toBe(4);
    expect(run.result.violations.map((v) => v.id)).toContain("index-tampered");
    expect(run.result.facts!.integrityFailures).toBe(1);
  });

  it("an unreadable artifact becomes a skipped input, not a crash", async () => {
    const files = { "a.json": JSON.stringify(makeArtifact({ generatedAt: NOW, verdict: "pass" })) };
    const run = await runReleasePolicy(args({ artifactPaths: ["a.json", "missing.json"], policy: { ...args().policy, maxSkipped: 0 } }), provider(files));
    expect(run.result.facts!.skippedInputs).toBe(1);
    expect(run.exitCode).toBe(3); // max-skipped=0 exceeded → warn
  });
});

describe("runReleasePolicy — metrics", () => {
  it("emits exactly one bounded release-policy sample per run", async () => {
    const samples: WorkerMetricSample[] = [];
    setReleasePolicySink((s) => samples.push(s));
    const files = { "idx.json": indexText([{ generatedAt: NOW, verdict: "pass" }]) };
    await runReleasePolicy(args({ indexPath: "idx.json" }), provider(files));
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ metric: "worker_release_policy_total", labels: { verdict: "pass" } });
  });

  it("a throwing sink never breaks the run (the runner guards it)", async () => {
    setReleasePolicySink(() => {
      throw new Error("sink down");
    });
    // recordReleasePolicy itself propagates (it is a thin forward)...
    expect(() => recordReleasePolicy("fail")).toThrow();
    // ...but a full run swallows it and still resolves with the correct exit code.
    const files = { "idx.json": indexText([{ generatedAt: NOW, verdict: "pass" }]) };
    const run = await runReleasePolicy(args({ indexPath: "idx.json" }), provider(files));
    expect(run.exitCode).toBe(0);
  });
});
