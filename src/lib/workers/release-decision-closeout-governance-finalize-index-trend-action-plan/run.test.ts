import { describe, expect, it } from "vitest";
import { blockedTrend, makeArgs, makeProvider, stableTrend, watchTrend } from "./fixtures";
import { runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlan } from "./run";

describe("runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlan", () => {
  it("plans a usable stable trend to a clear result (exit 0) and renders the requested format", async () => {
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlan(
      makeArgs(),
      makeProvider(stableTrend()),
    );
    expect(run.exitCode).toBe(0);
    expect(run.result.verdict).toBe("clear");
    expect(run.output).toContain('"verdict": "clear"');
  });

  it("a missing / unreadable trend file is an invalid plan (exit 4), never a throw or a fabricated pass", async () => {
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlan(
      makeArgs({ trendPath: "does-not-exist" }),
      makeProvider(stableTrend()),
    );
    expect(run.exitCode).toBe(4);
    expect(run.result.verdict).toBe("invalid");
    expect(run.result.source.state).toBe("unreadable");
  });

  it("reads the trend from stdin (--stdin) and folds it (blocked → exit 4)", async () => {
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlan(
      makeArgs({ stdin: true, trendPath: undefined }),
      makeProvider(undefined, JSON.stringify(blockedTrend())),
    );
    expect(run.exitCode).toBe(4);
    expect(run.result.verdict).toBe("block-release");
  });

  it("honors --strict-watch (a watch trend escalates to block-release, exit 4)", async () => {
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlan(
      makeArgs({ strictWatch: true }),
      makeProvider(watchTrend()),
    );
    expect(run.exitCode).toBe(4);
    expect(run.result.verdict).toBe("block-release");
  });

  it("renders --text when requested", async () => {
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlan(
      makeArgs({ format: "text" }),
      makeProvider(stableTrend()),
    );
    expect(run.output).toContain("PLAN: CLEAR (exit 0)");
  });
});
