import { describe, expect, it } from "vitest";
import { runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseout } from "./run";
import {
  coherentIndex,
  coherentPlan,
  coherentTrend,
  completedReceipt,
  contradictoryPlan,
  makeArgs,
  makeProvider,
} from "./fixtures";

const completed = completedReceipt();

describe("runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseout — orchestrator over injected seams", () => {
  it("reads the primary receipt from a path and closes out a coherent chain (exit 0)", async () => {
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseout(
      makeArgs({ planPath: "plan-0" }),
      makeProvider({ receipt: completed, plan: coherentPlan() }),
    );
    expect(run.exitCode).toBe(0);
    expect(run.result.verdict).toBe("closed");
    expect(run.result.related.find((r) => r.kind === "plan")?.signal).toBe("coherent");
  });

  it("reads the primary receipt from stdin", async () => {
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseout(
      makeArgs({ stdin: true, receiptPath: undefined }),
      makeProvider({}, JSON.stringify(completed)),
    );
    expect(run.exitCode).toBe(0);
    expect(run.result.primaryReceipt.state).toBe("usable");
  });

  it("a missing receipt file is invalid (exit 4), never a throw or an echoed path", async () => {
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseout(
      makeArgs({ receiptPath: "does-not-exist" }),
      makeProvider({}),
    );
    expect(run.exitCode).toBe(4);
    expect(run.result.verdict).toBe("invalid");
    expect(run.result.primaryReceipt.state).toBe("unreadable");
    expect(run.output).not.toContain("does-not-exist");
  });

  it("a contradictory related record fails closed (exit 4)", async () => {
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseout(
      makeArgs({ planPath: "plan-0" }),
      makeProvider({ receipt: completed, plan: contradictoryPlan() }),
    );
    expect(run.exitCode).toBe(4);
    expect(run.result.verdict).toBe("blocked");
  });

  it("a supplied-but-missing related file fails closed as unreadable (exit 4), not a throw", async () => {
    // planPath points at a file the provider will not serve → unreadable → blocked (related-unreadable).
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseout(
      makeArgs({ planPath: "missing-plan" }),
      makeProvider({ receipt: completed }),
    );
    expect(run.exitCode).toBe(4);
    expect(run.result.related.find((r) => r.kind === "plan")?.state).toBe("unreadable");
  });

  it("folds all three related records under the receipt", async () => {
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseout(
      makeArgs({ planPath: "plan-0", trendPath: "trend-0", indexPath: "index-0" }),
      makeProvider({ receipt: completed, plan: coherentPlan(), trend: coherentTrend(), index: coherentIndex() }),
    );
    expect(run.exitCode).toBe(0);
    expect(run.result.coverage.relatedSupplied).toBe(3);
  });

  it("renders text when requested", async () => {
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseout(
      makeArgs({ format: "text" }),
      makeProvider({ receipt: completed }),
    );
    expect(run.output).toContain("CLOSEOUT:");
    expect(run.output).not.toMatch(/^\{/);
  });
});
