import { afterEach, describe, expect, it } from "vitest";
import type { WorkerMetricSample } from "../observability/metrics";
import {
  blockedIndex,
  coherentPlan,
  completedReceipt,
  contradictoryTrend,
  followupOpenReceipt,
  makeArgs,
  makeProvider,
} from "./fixtures";
import {
  recordReleaseDecisionCloseoutGovernance,
  resetReleaseDecisionCloseoutGovernanceSink,
  setReleaseDecisionCloseoutGovernanceSink,
} from "./metrics";
import { runReleaseDecisionCloseoutGovernance } from "./run";

afterEach(() => resetReleaseDecisionCloseoutGovernanceSink());

describe("release-decision-closeout-governance run — orchestrator over the provider seam", () => {
  it("reads a completed receipt from a file and returns a closed run (exit 0, json)", async () => {
    const objs = { receipt: completedReceipt() };
    const run = await runReleaseDecisionCloseoutGovernance(makeArgs(objs), makeProvider(objs));
    expect(run.exitCode).toBe(0);
    expect(run.result.verdict).toBe("closed");
    expect(JSON.parse(run.output).schema).toBe("pdfxyz.release-decision-closeout-governance/1");
  });

  it("reads the primary receipt from stdin (--stdin)", async () => {
    const objs = { receipt: followupOpenReceipt() };
    const args = makeArgs(objs, { stdin: true, receiptPath: undefined });
    const run = await runReleaseDecisionCloseoutGovernance(args, makeProvider({} as never, JSON.stringify(objs.receipt)));
    expect(run.exitCode).toBe(3);
    expect(run.result.verdict).toBe("governance-open");
  });

  it("composes supplied related records read from files", async () => {
    const objs = { receipt: completedReceipt(), plan: coherentPlan() };
    const run = await runReleaseDecisionCloseoutGovernance(makeArgs(objs), makeProvider(objs));
    expect(run.exitCode).toBe(0);
    expect(run.result.related.find((r) => r.kind === "plan")?.signal).toBe("coherent");

    const bad = { receipt: completedReceipt(), trend: contradictoryTrend() };
    const badRun = await runReleaseDecisionCloseoutGovernance(makeArgs(bad), makeProvider(bad));
    expect(badRun.exitCode).toBe(4);
  });

  it("a provider read failure on the primary receipt is an unreadable receipt ⇒ incomplete (never a throw)", async () => {
    const args = makeArgs({ receipt: completedReceipt() });
    // A provider whose readFile always throws → the receipt is unreadable.
    const run = await runReleaseDecisionCloseoutGovernance(args, {
      now: () => "2026-07-05T00:00:00.000Z",
      readFile: async () => {
        throw new Error("enoent");
      },
      readStdin: async () => "",
    });
    expect(run.exitCode).toBe(2);
    expect(run.result.verdict).toBe("governance-incomplete");
    expect(run.result.source.state).toBe("unreadable");
  });

  it("renders --text when requested", async () => {
    const objs = { receipt: completedReceipt(), index: blockedIndex() };
    const run = await runReleaseDecisionCloseoutGovernance(makeArgs(objs, { format: "text" }), makeProvider(objs));
    expect(run.exitCode).toBe(4);
    expect(run.output).toContain("GOVERNANCE: GOVERNANCE-BLOCKED");
  });

  it("records exactly one bounded metric per run", async () => {
    const seen: WorkerMetricSample[] = [];
    setReleaseDecisionCloseoutGovernanceSink((s) => seen.push(s));
    const objs = { receipt: completedReceipt() };
    await runReleaseDecisionCloseoutGovernance(makeArgs(objs), makeProvider(objs));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.labels).toEqual({ verdict: "closed" });
  });

  it("a metrics sink that throws never breaks the run", async () => {
    setReleaseDecisionCloseoutGovernanceSink(() => {
      throw new Error("sink down");
    });
    const objs = { receipt: completedReceipt() };
    const run = await runReleaseDecisionCloseoutGovernance(makeArgs(objs), makeProvider(objs));
    expect(run.exitCode).toBe(0);
    // Silence the unused-import guard: the record helper is exercised via the run.
    expect(typeof recordReleaseDecisionCloseoutGovernance).toBe("function");
  });
});
