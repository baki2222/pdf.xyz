import { afterEach, describe, expect, it, vi } from "vitest";
import { runReleaseGovernance } from "./run";
import { resetReleaseGovernanceSink, setReleaseGovernanceSink } from "./metrics";
import {
  failingTrend,
  makeArgs,
  makeProvider,
  promoteReadyReport,
  stableTrend,
  tamperedTrend,
} from "./fixtures";

afterEach(() => resetReleaseGovernanceSink());

describe("runReleaseGovernance — exit codes over the provider seam", () => {
  it("a stable trend → healthy (exit 0)", async () => {
    const objs = { trend: stableTrend() };
    const run = await runReleaseGovernance(makeArgs(objs), makeProvider(objs));
    expect(run.exitCode).toBe(0);
    expect(run.result.governance.verdict).toBe("healthy");
  });

  it("a failing trend → blocked (exit 4)", async () => {
    const objs = { trend: failingTrend() };
    const run = await runReleaseGovernance(makeArgs(objs), makeProvider(objs));
    expect(run.exitCode).toBe(4);
  });

  it("a tampered trend → blocked (exit 4)", async () => {
    const objs = { trend: tamperedTrend() };
    const run = await runReleaseGovernance(makeArgs(objs), makeProvider(objs));
    expect(run.exitCode).toBe(4);
    expect(run.result.governance.reasons).toContain("trend-tampered");
  });

  it("a missing trend (report only) → incomplete (exit 2), never a fabricated healthy", async () => {
    const objs = { report: promoteReadyReport() };
    const run = await runReleaseGovernance(makeArgs(objs), makeProvider(objs));
    expect(run.exitCode).toBe(2);
    expect(run.result.governance.reasons).toContain("trend-missing");
  });
});

describe("runReleaseGovernance — input failure modes never throw", () => {
  it("an unreadable file (provider throws) becomes an unreadable source → incomplete", async () => {
    // args reference a trend, but the provider serves nothing → readFile throws → unreadable.
    const args = makeArgs({ trend: stableTrend() });
    const emptyProvider = makeProvider({});
    const run = await runReleaseGovernance(args, emptyProvider);
    expect(run.exitCode).toBe(2);
    expect(run.result.coverage.trend).toBe("unreadable");
  });

  it("a non-JSON payload becomes unreadable, not a throw", async () => {
    const provider = { now: () => "2026-07-04T00:00:00.000Z", readFile: async () => "{not json", readStdin: async () => "" };
    const run = await runReleaseGovernance(makeArgs({ trend: stableTrend() }), provider);
    expect(run.result.coverage.trend).toBe("unreadable");
  });

  it("reads a document from stdin (`--trend=-`)", async () => {
    const objs = { trend: stableTrend() };
    const provider = makeProvider({}, JSON.stringify(objs.trend));
    const run = await runReleaseGovernance(makeArgs({}, { trendPath: "-" }), provider);
    expect(run.exitCode).toBe(0);
    expect(run.result.coverage.trend).toBe("usable");
  });
});

describe("runReleaseGovernance — output + metrics", () => {
  it("renders the requested format", async () => {
    const objs = { trend: stableTrend() };
    const jsonRun = await runReleaseGovernance(makeArgs(objs, { format: "json" }), makeProvider(objs));
    expect(() => JSON.parse(jsonRun.output)).not.toThrow();
    const textRun = await runReleaseGovernance(makeArgs(objs, { format: "text" }), makeProvider(objs));
    expect(textRun.output).toMatch(/GOVERNANCE: HEALTHY/);
  });

  it("emits exactly one bounded metric per run (the verdict)", async () => {
    const spy = vi.fn();
    setReleaseGovernanceSink(spy);
    const objs = { trend: failingTrend() };
    await runReleaseGovernance(makeArgs(objs), makeProvider(objs));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatchObject({
      metric: "worker_release_governance_total",
      labels: { verdict: "blocked" },
    });
  });

  it("a throwing metric sink never breaks the run", async () => {
    setReleaseGovernanceSink(() => {
      throw new Error("collector down");
    });
    const objs = { trend: stableTrend() };
    const run = await runReleaseGovernance(makeArgs(objs), makeProvider(objs));
    expect(run.exitCode).toBe(0);
  });
});
