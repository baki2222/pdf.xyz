import { describe, expect, it } from "vitest";
import { runReleaseDecisionCloseout } from "./run";
import {
  coherentPlan,
  completedReceipt,
  contradictoryPlan,
  decisionFor,
  makeArgs,
  makeProvider,
} from "./fixtures";

describe("runReleaseDecisionCloseout — orchestrator over injected seams", () => {
  it("reads the primary receipt from a path and closes out a coherent chain (exit 0)", async () => {
    const run = await runReleaseDecisionCloseout(
      makeArgs({ planPath: "plan-0" }),
      makeProvider({ receipt: completedReceipt(), plan: coherentPlan() }),
    );
    expect(run.exitCode).toBe(0);
    expect(run.result.verdict).toBe("closed");
    expect(run.result.related.find((r) => r.kind === "plan")?.signal).toBe("coherent");
  });

  it("reads the primary receipt from stdin", async () => {
    const run = await runReleaseDecisionCloseout(
      makeArgs({ stdin: true, receiptPath: undefined }),
      makeProvider({}, JSON.stringify(completedReceipt())),
    );
    expect(run.exitCode).toBe(0);
    expect(run.result.source.state).toBe("usable");
  });

  it("a missing receipt file is closeout-incomplete (exit 2), never a throw or an echoed path", async () => {
    const run = await runReleaseDecisionCloseout(
      makeArgs({ receiptPath: "does-not-exist" }),
      makeProvider({}),
    );
    expect(run.exitCode).toBe(2);
    expect(run.result.verdict).toBe("closeout-incomplete");
    expect(run.result.source.state).toBe("unreadable");
    expect(run.output).not.toContain("does-not-exist");
  });

  it("a contradictory related record fails closed (exit 4)", async () => {
    const run = await runReleaseDecisionCloseout(
      makeArgs({ planPath: "plan-0" }),
      makeProvider({ receipt: completedReceipt(), plan: contradictoryPlan() }),
    );
    expect(run.exitCode).toBe(4);
    expect(run.result.verdict).toBe("closeout-blocked");
  });

  it("a supplied-but-missing related file is closeout-incomplete (unreadable), not a throw", async () => {
    // planPath points at a file the provider will not serve → unreadable → incomplete.
    const run = await runReleaseDecisionCloseout(
      makeArgs({ planPath: "missing-plan" }),
      makeProvider({ receipt: completedReceipt() }),
    );
    expect(run.exitCode).toBe(2);
    expect(run.result.related.find((r) => r.kind === "plan")?.state).toBe("unreadable");
  });

  it("folds all four related records under the receipt", async () => {
    const run = await runReleaseDecisionCloseout(
      makeArgs({ planPath: "plan-0", decisionPath: "decision-0" }),
      makeProvider({ receipt: completedReceipt(), plan: coherentPlan(), decision: decisionFor("proceed") }),
    );
    expect(run.exitCode).toBe(0);
    expect(run.result.closeout.relatedSupplied).toBe(2);
  });

  it("renders text when requested", async () => {
    const run = await runReleaseDecisionCloseout(
      makeArgs({ format: "text" }),
      makeProvider({ receipt: completedReceipt() }),
    );
    expect(run.output).toContain("pdf.xyz release decision closeout bundle");
    expect(run.output).not.toMatch(/^\{/);
  });
});
