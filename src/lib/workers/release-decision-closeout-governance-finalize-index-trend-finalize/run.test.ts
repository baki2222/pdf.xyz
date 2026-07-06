import { describe, expect, it } from "vitest";
import {
  advisoryPlan,
  advisoryReceipt,
  advisoryTrend,
  blockedReceipt,
  coherentPlan,
  completedReceipt,
  makeArgs,
  makeProvider,
  notAReceipt,
} from "./fixtures";
import { runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalize } from "./run";

/** Run the orchestrator over a served receipt + inputs + args overrides. */
async function run(
  receipt: unknown,
  inputs: Parameters<typeof makeProvider>[1] = {},
  over: Parameters<typeof makeArgs>[0] = {},
  stdinPayload = "",
) {
  return runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalize(
    makeArgs(over),
    makeProvider(receipt, inputs, stdinPayload),
  );
}

describe("runFinalizeIndexTrendFinalize — end-to-end over injected seams", () => {
  it("a completed receipt alone → finalized (exit 0), pinned to the schema", async () => {
    const r = await run(completedReceipt());
    expect(r.exitCode).toBe(0);
    expect(r.result.verdict).toBe("finalized");
    expect(r.output).toContain('"schema": "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize/1"');
  });

  it("a completed receipt + coherent plan → finalized; a contradictory plan → finalize-blocked (exit 4)", async () => {
    const coherent = await run(completedReceipt(), { plan: coherentPlan() }, { planPath: "plan-0" });
    expect(coherent.exitCode).toBe(0);
    expect(coherent.result.coverage.coherentRecords).toBe(1);

    // A monitor plan (self-consistent, verdict `monitor`) contradicts the completed receipt's recorded `clear`.
    const bad = await run(completedReceipt(), { plan: advisoryPlan() }, { planPath: "plan-0" });
    expect(bad.exitCode).toBe(4);
    expect(bad.result.verdict).toBe("finalize-blocked");
  });

  it("an advisory chain → finalize-open (exit 3)", async () => {
    const r = await run(advisoryReceipt(), { trend: advisoryTrend() }, { trendPath: "trend-0" });
    expect(r.exitCode).toBe(3);
    expect(r.result.verdict).toBe("finalize-open");
  });

  it("a blocked receipt → finalize-blocked; an unreadable receipt → finalize-invalid", async () => {
    expect((await run(blockedReceipt())).exitCode).toBe(4);
    const inv = await run(notAReceipt());
    expect(inv.exitCode).toBe(4);
    expect(inv.result.verdict).toBe("finalize-invalid");
    expect(inv.result.source.state).toBe("unreadable");
  });

  it("a missing / unreadable receipt file → finalize-invalid, path never echoed", async () => {
    const missing = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalize(
      makeArgs({ receiptPath: "does-not-exist" }),
      makeProvider(completedReceipt()),
    );
    expect(missing.exitCode).toBe(4);
    expect(missing.result.verdict).toBe("finalize-invalid");
    expect(missing.output).not.toContain("does-not-exist");
  });

  it("a required-but-missing record → finalize-incomplete (exit 2)", async () => {
    const r = await run(completedReceipt(), {}, { requireIndex: true });
    expect(r.exitCode).toBe(2);
    expect(r.result.verdict).toBe("finalize-incomplete");
  });

  it("reads the primary receipt from stdin (--stdin)", async () => {
    const r = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalize(
      makeArgs({ stdin: true, receiptPath: undefined }),
      makeProvider(undefined, {}, JSON.stringify(blockedReceipt())),
    );
    expect(r.result.source.state).toBe("usable");
    expect(r.result.verdict).toBe("finalize-blocked");
  });

  it("renders text when requested", async () => {
    const r = await run(completedReceipt(), {}, { format: "text" });
    expect(r.output).toContain("FINALIZE: FINALIZED (exit 0)");
  });
});
