/**
 * Orchestrator + trust-boundary tests for the release readiness gate (Phase 46).
 *
 * Exercises {@link reduceCheck} (the exit-code → status mapping) and {@link runReleaseGate} (the
 * full compose + rollup + metric emission + scope filtering) over an injected, deterministic
 * provider — no subprocess is ever spawned here.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { reduceCheck, runReleaseGate, type ProbeResult, type ReleaseGateProvider } from "./run";
import { RELEASE_CHECKS, type ReleaseCheckSpec } from "./checks";
import { resetReleaseGateSink, setReleaseGateSink } from "./metrics";
import type { ReleaseGateArgs } from "./args";
import type { ReleaseCheckId } from "./types";

const NOW = "2026-07-03T00:00:00.000Z";
const ARGS: ReleaseGateArgs = { format: "json", pretty: true, skip: [] };

function probe(over: Partial<ProbeResult> = {}): ProbeResult {
  return { exitCode: 0, stdout: "", stderr: "", timedOut: false, spawnError: false, ...over };
}

/** A provider that returns each check its EXPECTED exit (an all-pass run), overridable per id. */
function provider(byId: Partial<Record<ReleaseCheckId, ProbeResult>> = {}): ReleaseGateProvider {
  return {
    runCheck: async (spec: ReleaseCheckSpec) => byId[spec.id] ?? probe({ exitCode: spec.expectedExit }),
    now: () => NOW,
  };
}

const specOf = (id: ReleaseCheckId): ReleaseCheckSpec => RELEASE_CHECKS.find((c) => c.id === id)!;

afterEach(() => resetReleaseGateSink());

describe("reduceCheck", () => {
  it("passes when the observed exit matches the expected exit", () => {
    const spec = specOf("ops-check-critical"); // expected 4
    expect(reduceCheck(spec, probe({ exitCode: 4 })).status).toBe("pass");
  });

  it("escalates a mismatch to the check's severity (fail vs warn)", () => {
    expect(reduceCheck(specOf("worker-smoke"), probe({ exitCode: 1 })).status).toBe("fail");
    expect(reduceCheck(specOf("worker-engines"), probe({ exitCode: 3 })).status).toBe("warn");
  });

  it("is unknown when the check could not be run to a verdict", () => {
    expect(reduceCheck(specOf("deploy-examples"), probe({ spawnError: true, exitCode: null })).status).toBe("unknown");
    expect(reduceCheck(specOf("deploy-examples"), probe({ timedOut: true, exitCode: null })).status).toBe("unknown");
    expect(reduceCheck(specOf("deploy-examples"), probe({ exitCode: null })).status).toBe("unknown");
  });

  it("clamps a nonsensical observed exit code to null", () => {
    expect(reduceCheck(specOf("deploy-examples"), probe({ exitCode: -7 })).observedExit).toBeNull();
    expect(reduceCheck(specOf("deploy-examples"), probe({ exitCode: 999 })).observedExit).toBeNull();
    expect(reduceCheck(specOf("deploy-examples"), probe({ exitCode: 2 })).observedExit).toBe(2);
  });
});

describe("runReleaseGate", () => {
  it("passes when every check returns its expected exit", async () => {
    const run = await runReleaseGate(ARGS, provider());
    expect(run.outcome.rollup.verdict).toBe("pass");
    expect(run.exitCode).toBe(0);
    expect(run.outcome.rollup.includedChecks).toBe(RELEASE_CHECKS.length);
    expect(run.outcome.rollup.passedChecks).toBe(RELEASE_CHECKS.length);
    expect(run.outcome.rollup.blockers).toEqual([]);
  });

  it("fails (exit 4) and names the blocker when a blocking check mismatches", async () => {
    const run = await runReleaseGate(ARGS, provider({ "worker-smoke": probe({ exitCode: 1 }) }));
    expect(run.outcome.rollup.verdict).toBe("fail");
    expect(run.exitCode).toBe(4);
    expect(run.outcome.rollup.blockers).toContain("worker-smoke");
  });

  it("warns (exit 3) when only the advisory engine check mismatches", async () => {
    const run = await runReleaseGate(ARGS, provider({ "worker-engines": probe({ exitCode: 3 }) }));
    expect(run.outcome.rollup.verdict).toBe("warn");
    expect(run.exitCode).toBe(3);
    expect(run.outcome.rollup.blockers).toEqual(["worker-engines"]);
  });

  it("a fail outranks a warn in the composite verdict", async () => {
    const run = await runReleaseGate(ARGS, provider({
      "worker-engines": probe({ exitCode: 3 }),
      "deploy-examples": probe({ exitCode: 1 }),
    }));
    expect(run.outcome.rollup.verdict).toBe("fail");
  });

  it("is unknown (exit 2) when a check is indeterminate and none failed", async () => {
    const run = await runReleaseGate(ARGS, provider({ "lifecycle-verify": probe({ spawnError: true, exitCode: null }) }));
    expect(run.outcome.rollup.verdict).toBe("unknown");
    expect(run.exitCode).toBe(2);
  });

  it("skips scoped-out checks and still lists them as skip", async () => {
    const run = await runReleaseGate({ ...ARGS, skip: ["worker-smoke"] }, provider({ "worker-smoke": probe({ exitCode: 1 }) }));
    // The skipped failing check must NOT drive the verdict.
    expect(run.outcome.rollup.verdict).toBe("pass");
    expect(run.outcome.rollup.skippedChecks).toBe(1);
    expect(run.outcome.checks.find((c) => c.id === "worker-smoke")!.status).toBe("skip");
  });

  it("--only runs exactly the named checks", async () => {
    const run = await runReleaseGate({ ...ARGS, skip: [], only: ["ops-check-healthy"] }, provider());
    expect(run.outcome.rollup.includedChecks).toBe(1);
    expect(run.outcome.checks.filter((c) => c.status !== "skip")).toHaveLength(1);
  });

  it("is unknown (never a vacuous pass) when every check is skipped", async () => {
    const run = await runReleaseGate({ ...ARGS, only: [] as ReleaseCheckId[], skip: RELEASE_CHECKS.map((c) => c.id) }, provider());
    expect(run.outcome.rollup.includedChecks).toBe(0);
    expect(run.outcome.rollup.verdict).toBe("unknown");
    expect(run.exitCode).toBe(2);
  });

  it("emits exactly one content-free release-gate metric per run", async () => {
    const sink = vi.fn();
    setReleaseGateSink(sink);
    await runReleaseGate(ARGS, provider({ "deploy-examples": probe({ exitCode: 1 }) }));
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]![0]).toMatchObject({ metric: "worker_release_gate_total", labels: { verdict: "fail" } });
  });

  it("a thrown metrics sink never breaks the run", async () => {
    setReleaseGateSink(() => {
      throw new Error("sink blew up");
    });
    const run = await runReleaseGate(ARGS, provider());
    expect(run.outcome.rollup.verdict).toBe("pass");
  });
});
