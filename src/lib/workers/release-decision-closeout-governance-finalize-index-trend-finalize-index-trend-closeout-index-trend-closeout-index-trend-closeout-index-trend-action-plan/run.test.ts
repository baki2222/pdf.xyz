import { describe, expect, it } from "vitest";
import { blockedTrend, makeArgs, makeProvider, stableTrend, watchTrend } from "./fixtures";
import { runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlan } from "./run";

describe("runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlan", () => {
  it("plans a usable stable trend to a clear result (exit 0) and renders the requested format", async () => {
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlan(
      makeArgs(),
      makeProvider(stableTrend()),
    );
    expect(run.exitCode).toBe(0);
    expect(run.result.verdict).toBe("clear");
    expect(run.output).toContain('"verdict": "clear"');
  });

  it("a missing / unreadable trend file is an invalid plan (exit 4), never a throw or a fabricated pass", async () => {
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlan(
      makeArgs({ trendPath: "does-not-exist" }),
      makeProvider(stableTrend()),
    );
    expect(run.exitCode).toBe(4);
    expect(run.result.verdict).toBe("invalid");
    expect(run.result.source.state).toBe("unreadable");
  });

  it("reads the trend from stdin (--stdin) and folds it (blocked → exit 4)", async () => {
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlan(
      makeArgs({ stdin: true, trendPath: undefined }),
      makeProvider(undefined, JSON.stringify(blockedTrend())),
    );
    expect(run.exitCode).toBe(4);
    expect(run.result.verdict).toBe("block-release");
  });

  it("honors --strict (a watch trend escalates to block-release, exit 4)", async () => {
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlan(
      makeArgs({ strict: true }),
      makeProvider(watchTrend()),
    );
    expect(run.exitCode).toBe(4);
    expect(run.result.verdict).toBe("block-release");
  });

  it("renders --text when requested", async () => {
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlan(
      makeArgs({ format: "text" }),
      makeProvider(stableTrend()),
    );
    expect(run.output).toContain("PLAN: CLEAR (exit 0)");
  });
});
