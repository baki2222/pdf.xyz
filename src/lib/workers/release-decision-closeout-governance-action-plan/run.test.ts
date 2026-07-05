import { describe, expect, it } from "vitest";
import { runReleaseDecisionCloseoutGovernanceActionPlan } from "./run";
import {
  blockedTrend,
  incompleteTrend,
  makeArgs,
  makeProvider,
  stableTrend,
  watchTrend,
} from "./fixtures";

describe("runReleaseDecisionCloseoutGovernanceActionPlan — orchestration over injected seams", () => {
  it("a stable trend → clear plan (exit 0)", async () => {
    const run = await runReleaseDecisionCloseoutGovernanceActionPlan(makeArgs(), makeProvider(stableTrend()));
    expect(run.exitCode).toBe(0);
    expect(run.result.verdict).toBe("clear");
  });

  it("an incomplete trend → investigate (exit 2); a watch trend → monitor (exit 3)", async () => {
    const inc = await runReleaseDecisionCloseoutGovernanceActionPlan(makeArgs(), makeProvider(incompleteTrend()));
    expect(inc.exitCode).toBe(2);
    expect(inc.result.verdict).toBe("investigate");

    const watch = await runReleaseDecisionCloseoutGovernanceActionPlan(makeArgs(), makeProvider(watchTrend()));
    expect(watch.exitCode).toBe(3);
    expect(watch.result.verdict).toBe("monitor");
  });

  it("a blocked trend → block-release (exit 4)", async () => {
    const run = await runReleaseDecisionCloseoutGovernanceActionPlan(makeArgs(), makeProvider(blockedTrend()));
    expect(run.exitCode).toBe(4);
    expect(run.result.verdict).toBe("block-release");
  });

  it("a read failure is an unreadable trend → block-release (exit 4), never a throw or a vacuous pass", async () => {
    const provider = {
      now: () => "2026-07-05T00:00:00.000Z",
      readFile: async () => {
        throw new Error("enoent");
      },
      readStdin: async () => "",
    };
    const run = await runReleaseDecisionCloseoutGovernanceActionPlan(makeArgs(), provider);
    expect(run.exitCode).toBe(4);
    expect(run.result.source.state).toBe("unreadable");
  });

  it("a blank / non-JSON payload is an unreadable trend (exit 4)", async () => {
    const blank = await runReleaseDecisionCloseoutGovernanceActionPlan(makeArgs(), makeProvider("   "));
    expect(blank.result.source.state).toBe("unreadable");
    const garbage = await runReleaseDecisionCloseoutGovernanceActionPlan(makeArgs(), makeProvider("{not json"));
    expect(garbage.result.source.state).toBe("unreadable");
  });

  it("reads the trend from stdin when --stdin is set", async () => {
    const run = await runReleaseDecisionCloseoutGovernanceActionPlan(
      makeArgs({ stdin: true, trendPath: undefined }),
      makeProvider(undefined, JSON.stringify(blockedTrend())),
    );
    expect(run.exitCode).toBe(4);
    expect(run.result.verdict).toBe("block-release");
  });

  it("--strict-watch escalates a watch trend to block-release (exit 4)", async () => {
    const run = await runReleaseDecisionCloseoutGovernanceActionPlan(
      makeArgs({ strictWatch: true }),
      makeProvider(watchTrend()),
    );
    expect(run.exitCode).toBe(4);
    expect(run.result.governanceActionPlan.strictWatchEscalated).toBe(true);
  });

  it("renders the requested format", async () => {
    const json = await runReleaseDecisionCloseoutGovernanceActionPlan(makeArgs(), makeProvider(stableTrend()));
    expect(json.output.trimStart().startsWith("{")).toBe(true);
    const text = await runReleaseDecisionCloseoutGovernanceActionPlan(
      makeArgs({ format: "text" }),
      makeProvider(stableTrend()),
    );
    expect(text.output).toContain("pdf.xyz release decision closeout governance index trend action plan");
  });
});
