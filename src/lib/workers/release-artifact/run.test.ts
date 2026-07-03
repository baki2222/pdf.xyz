// @vitest-environment node
/**
 * Orchestrator tests over injected seams: the generate flow (supplied vs internal gate, honest
 * degradation of every optional input, --no-vcs, metric emission) and the verify flow
 * (verified/mismatch/unreadable). No real git, subprocess, or filesystem.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { runReleaseArtifact, type ReleaseArtifactProvider } from "./run";
import { resetReleaseArtifactSink, setReleaseArtifactSink } from "./metrics";
import { RELEASE_GATE_SCHEMA } from "../release-gate/types";
import { OPS_BUNDLE_SCHEMA } from "../ops-bundle/types";
import type { ReleaseArtifactArgs } from "./args";

afterEach(() => resetReleaseArtifactSink());

const NOW = "2026-07-03T00:00:00.000Z";
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

function gateJson(verdict = "pass"): string {
  return JSON.stringify({
    schema: RELEASE_GATE_SCHEMA,
    rollup: { verdict, includedChecks: 11, passedChecks: verdict === "pass" ? 11 : 9, skippedChecks: 0, blockers: [] },
    checks: [{ id: "deploy-examples", status: "pass" }],
  });
}
function bundleJson(severity = "ok"): string {
  return JSON.stringify({ schema: OPS_BUNDLE_SCHEMA, rollup: { severity } });
}

interface Calls {
  gitFacts: number;
  readGate: number;
  runGate: number;
  readOpsBundle: number;
  readArtifact: number;
}

function makeProvider(over: Partial<ReleaseArtifactProvider> = {}): { provider: ReleaseArtifactProvider; calls: Calls } {
  const calls: Calls = { gitFacts: 0, readGate: 0, runGate: 0, readOpsBundle: 0, readArtifact: 0 };
  const provider: ReleaseArtifactProvider = {
    now: () => NOW,
    hash: sha256,
    gitFacts: async () => {
      calls.gitFacts++;
      return { commit: "27a5555fd3e3", ref: "main", dirty: false, detached: false };
    },
    readGate: async () => {
      calls.readGate++;
      return gateJson();
    },
    runGate: async () => {
      calls.runGate++;
      return gateJson();
    },
    readOpsBundle: async () => {
      calls.readOpsBundle++;
      return bundleJson();
    },
    readArtifact: async () => {
      calls.readArtifact++;
      return "{}";
    },
    ...over,
  };
  return { provider, calls };
}

function generateArgs(over: Partial<ReleaseArtifactArgs> = {}): ReleaseArtifactArgs {
  return { mode: "generate", format: "json", pretty: true, noVcs: false, ...over };
}

describe("runReleaseArtifact — generate", () => {
  it("archives a supplied gate on a clean tree → pass, valid digest, metric recorded", async () => {
    const sink = vi.fn();
    setReleaseArtifactSink(sink);
    const { provider, calls } = makeProvider();
    const run = await runReleaseArtifact(generateArgs({ releaseGatePath: "gate.json", label: "v1.2.3" }), provider);

    expect(run.exitCode).toBe(0);
    expect(run.artifact!.body.rollup.verdict).toBe("pass");
    expect(run.artifact!.body.gate.source).toBe("supplied");
    expect(run.artifact!.body.metadata.label).toBe("v1.2.3");
    expect(run.artifact!.body.metadata.git.commit).toBe("27a5555fd3e3");
    // The digest is the real sha256 over the canonical body.
    expect(run.artifact!.integrity.digest).toMatch(/^[0-9a-f]{64}$/);
    // Supplied ⇒ read, not run.
    expect(calls.readGate).toBe(1);
    expect(calls.runGate).toBe(0);
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({ metric: "worker_release_artifact_total", labels: { verdict: "pass" } }));
  });

  it("runs the gate internally when no --release-gate is supplied (source generated)", async () => {
    const { provider, calls } = makeProvider();
    const run = await runReleaseArtifact(generateArgs(), provider);
    expect(run.artifact!.body.gate.source).toBe("generated");
    expect(calls.runGate).toBe(1);
    expect(calls.readGate).toBe(0);
  });

  it("escalates a clean pass to warn (exit 3) on a dirty tree", async () => {
    const { provider } = makeProvider({ gitFacts: async () => ({ commit: "27a5555fd3e3", ref: "phase-47", dirty: true }) });
    const run = await runReleaseArtifact(generateArgs({ releaseGatePath: "g.json" }), provider);
    expect(run.artifact!.body.rollup.verdict).toBe("warn");
    expect(run.exitCode).toBe(3);
    expect(run.artifact!.body.rollup.drivers).toEqual(["dirty-tree"]);
    expect(run.artifact!.body.metadata.git.refClass).toBe("topic");
  });

  it("degrades a gate read failure to unreadable → unknown (exit 2), never throws", async () => {
    const { provider } = makeProvider({
      readGate: async () => {
        throw new Error("ENOENT");
      },
    });
    const run = await runReleaseArtifact(generateArgs({ releaseGatePath: "missing.json" }), provider);
    expect(run.artifact!.body.gate.source).toBe("unreadable");
    expect(run.artifact!.body.rollup.verdict).toBe("unknown");
    expect(run.exitCode).toBe(2);
  });

  it("degrades an internal gate spawn failure to unreadable → unknown", async () => {
    const { provider } = makeProvider({
      runGate: async () => {
        throw new Error("spawn failed");
      },
    });
    const run = await runReleaseArtifact(generateArgs(), provider);
    expect(run.artifact!.body.gate.source).toBe("unreadable");
    expect(run.exitCode).toBe(2);
  });

  it("attaches an ops-bundle summary as context (does not change the verdict)", async () => {
    const { provider } = makeProvider({ readOpsBundle: async () => bundleJson("critical") });
    const run = await runReleaseArtifact(generateArgs({ releaseGatePath: "g.json", opsBundlePath: "b.json" }), provider);
    // source "supplied" proves the summary was read + ingested.
    expect(run.artifact!.body.opsBundle.source).toBe("supplied");
    expect(run.artifact!.body.opsBundle.severity).toBe("critical");
    // A critical ops-bundle is context only — the verdict stays pass.
    expect(run.artifact!.body.rollup.verdict).toBe("pass");
    expect(run.exitCode).toBe(0);
  });

  it("degrades an ops-bundle read failure to unreadable without affecting the verdict", async () => {
    const { provider } = makeProvider({
      readOpsBundle: async () => {
        throw new Error("ENOENT");
      },
    });
    const run = await runReleaseArtifact(generateArgs({ releaseGatePath: "g.json", opsBundlePath: "b.json" }), provider);
    expect(run.artifact!.body.opsBundle.source).toBe("unreadable");
    expect(run.artifact!.body.rollup.verdict).toBe("pass");
  });

  it("suppresses all git provenance with --no-vcs (never calls gitFacts)", async () => {
    const { provider, calls } = makeProvider();
    const run = await runReleaseArtifact(generateArgs({ releaseGatePath: "g.json", noVcs: true }), provider);
    expect(calls.gitFacts).toBe(0);
    expect(run.artifact!.body.metadata.git).toEqual({ cleanliness: "unknown", refClass: "unknown", commit: null, commitPresent: false });
  });

  it("records unknown provenance when gitFacts throws (never crashes)", async () => {
    const { provider } = makeProvider({
      gitFacts: async () => {
        throw new Error("not a git repo");
      },
    });
    const run = await runReleaseArtifact(generateArgs({ releaseGatePath: "g.json" }), provider);
    expect(run.artifact!.body.metadata.git.cleanliness).toBe("unknown");
    expect(run.exitCode).toBe(0); // unknown provenance is not a fault; the gate still passed clean
  });
});

describe("runReleaseArtifact — verify", () => {
  async function writtenArtifact(): Promise<string> {
    const { provider } = makeProvider();
    const run = await runReleaseArtifact(generateArgs({ releaseGatePath: "g.json", label: "rc1" }), provider);
    return JSON.stringify(run.artifact);
  }

  it("verifies an untampered artifact (exit 0)", async () => {
    const text = await writtenArtifact();
    const { provider } = makeProvider({ readArtifact: async () => text });
    const run = await runReleaseArtifact({ mode: "verify", format: "json", pretty: true, noVcs: false, verifyPath: "a.json" }, provider);
    expect(run.exitCode).toBe(0);
    expect(run.verify!.reason).toBe("verified");
    expect(run.verify!.verdict).toBe("pass");
  });

  it("detects a tampered body as a digest mismatch (exit 4)", async () => {
    const tampered = (await writtenArtifact()).replace('"schemaVersion":1', '"schemaVersion":2');
    const { provider } = makeProvider({ readArtifact: async () => tampered });
    const run = await runReleaseArtifact({ mode: "verify", format: "json", pretty: true, noVcs: false, verifyPath: "a.json" }, provider);
    expect(run.exitCode).toBe(4);
    expect(run.verify!.reason).toBe("digest-mismatch");
    expect(run.verify!.ok).toBe(false);
  });

  it("treats a non-artifact file as unreadable (exit 1)", async () => {
    const { provider } = makeProvider({ readArtifact: async () => JSON.stringify({ not: "an artifact" }) });
    const run = await runReleaseArtifact({ mode: "verify", format: "json", pretty: true, noVcs: false, verifyPath: "a.json" }, provider);
    expect(run.exitCode).toBe(1);
    expect(run.verify!.reason).toBe("unreadable");
  });

  it("treats a read failure as unreadable (exit 1)", async () => {
    const { provider } = makeProvider({
      readArtifact: async () => {
        throw new Error("ENOENT");
      },
    });
    const run = await runReleaseArtifact({ mode: "verify", format: "json", pretty: true, noVcs: false, verifyPath: "a.json" }, provider);
    expect(run.exitCode).toBe(1);
    expect(run.verify!.reason).toBe("unreadable");
  });
});
