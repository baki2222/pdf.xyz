import { describe, expect, it } from "vitest";
import { runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseout } from "./run";
import {
  coherentPlan,
  coherentTrend,
  completedReceipt,
  contradictoryPlan,
  makeArgs,
  makeProvider,
} from "./fixtures";

const completed = completedReceipt();

describe("runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseout — orchestrator over injected seams", () => {
  it("reads the primary receipt from a path and closes out a coherent chain (exit 0)", async () => {
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseout(
      makeArgs({ planPath: "plan-0" }),
      makeProvider({ receipt: completed, plan: coherentPlan() }),
    );
    expect(run.exitCode).toBe(0);
    expect(run.result.verdict).toBe("closed");
    expect(run.result.related.find((r) => r.kind === "plan")?.signal).toBe("coherent");
  });

  it("reads the primary receipt from stdin", async () => {
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseout(
      makeArgs({ stdin: true, receiptPath: undefined }),
      makeProvider({}, JSON.stringify(completed)),
    );
    expect(run.exitCode).toBe(0);
    expect(run.result.primaryReceipt.state).toBe("usable");
  });

  it("a missing receipt file is invalid (exit 4), never a throw or an echoed path", async () => {
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseout(
      makeArgs({ receiptPath: "does-not-exist" }),
      makeProvider({}),
    );
    expect(run.exitCode).toBe(4);
    expect(run.result.verdict).toBe("invalid");
    expect(run.result.primaryReceipt.state).toBe("unreadable");
    expect(run.output).not.toContain("does-not-exist");
  });

  it("a contradictory related record fails closed as invalid (exit 4)", async () => {
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseout(
      makeArgs({ planPath: "plan-0" }),
      makeProvider({ receipt: completed, plan: contradictoryPlan() }),
    );
    expect(run.exitCode).toBe(4);
    expect(run.result.verdict).toBe("invalid");
  });

  it("a supplied-but-missing related file fails closed as unreadable (exit 4), not a throw", async () => {
    // planPath points at a file the provider will not serve → unreadable → blocked (related-unreadable).
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseout(
      makeArgs({ planPath: "missing-plan" }),
      makeProvider({ receipt: completed }),
    );
    expect(run.exitCode).toBe(4);
    expect(run.result.related.find((r) => r.kind === "plan")?.state).toBe("unreadable");
  });

  it("folds both related records under the receipt", async () => {
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseout(
      makeArgs({ planPath: "plan-0", trendPath: "trend-0" }),
      makeProvider({ receipt: completed, plan: coherentPlan(), trend: coherentTrend() }),
    );
    expect(run.exitCode).toBe(0);
    expect(run.result.coverage.relatedSupplied).toBe(2);
  });

  it("renders text when requested", async () => {
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseout(
      makeArgs({ format: "text" }),
      makeProvider({ receipt: completed }),
    );
    expect(run.output).toContain("CLOSEOUT:");
    expect(run.output).not.toMatch(/^\{/);
  });
});
