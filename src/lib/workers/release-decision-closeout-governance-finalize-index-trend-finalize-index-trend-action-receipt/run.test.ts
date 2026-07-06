import { describe, expect, it } from "vitest";
import {
  blockPlan,
  clearPlan,
  invalidPlan,
  investigatePlan,
  makeArgs,
  makeProvider,
  monitorPlan,
  notAPlan,
  tamperedPlan,
} from "./fixtures";
import { runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceipt } from "./run";

/** Run the orchestrator over a served plan object + args overrides. */
async function run(obj: unknown, over: Parameters<typeof makeArgs>[0] = {}, stdinPayload = "") {
  return runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceipt(makeArgs(over), makeProvider(obj, stdinPayload));
}

describe("runFinalizeIndexTrendFinalizeIndexTrendActionReceipt — end-to-end over injected seams", () => {
  it("a clear plan reviewed → completed (exit 0); unacked → incomplete (exit 2)", async () => {
    const done = await run(clearPlan(), { ackPlan: true });
    expect(done.exitCode).toBe(0);
    expect(done.result.verdict).toBe("completed");
    expect(done.output).toContain(
      '"schema": "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-receipt/1"',
    );

    const inc = await run(clearPlan(), {});
    expect(inc.exitCode).toBe(2);
    expect(inc.result.verdict).toBe("incomplete");
  });

  it("a monitor plan reviewed-but-unacked → followup-open (exit 3); fully acked → completed (exit 0)", async () => {
    const r = await run(monitorPlan(), { ackPlan: true });
    expect(r.exitCode).toBe(3);
    expect(r.result.verdict).toBe("followup-open");
    expect(r.result.planClass).toBe("monitor");

    const done = await run(monitorPlan(), { ackPlan: true, ackMonitor: true, ackFollowups: true });
    expect(done.exitCode).toBe(0);
  });

  it("an investigate plan reviewed-but-unacked → followup-open (exit 3)", async () => {
    const r = await run(investigatePlan(), { ackPlan: true });
    expect(r.exitCode).toBe(3);
    expect(r.result.verdict).toBe("followup-open");
    expect(r.result.planClass).toBe("investigate");
  });

  it("a block plan: unacknowledged → blocked (exit 4); fully acked → completed (exit 0, release still held)", async () => {
    const b = await run(blockPlan(), {});
    expect(b.exitCode).toBe(4);
    expect(b.result.actionReceipt.reasons).toContain("block-not-acknowledged");

    const acked = await run(blockPlan(), { ackPlan: true, ackFollowups: true, ackBlock: true });
    expect(acked.exitCode).toBe(0);
    expect(acked.result.verdict).toBe("completed");
    expect(acked.result.actionReceipt.reasons).toEqual(["block-acknowledged"]);
  });

  it("a plan whose own verdict is invalid → block class (held); blocked until acknowledged", async () => {
    const r = await run(invalidPlan(), { ackPlan: true, ackFollowups: true });
    expect(r.exitCode).toBe(4);
    expect(r.result.verdict).toBe("blocked");
    expect(r.result.planClass).toBe("block");
    expect(r.result.source.state).toBe("usable");

    const acked = await run(invalidPlan(), { ackPlan: true, ackFollowups: true, ackBlock: true });
    expect(acked.exitCode).toBe(0);
    expect(acked.result.verdict).toBe("completed");
  });

  it("a tampered plan fails closed → invalid (exit 4), even fully acked", async () => {
    const r = await run(tamperedPlan(), {
      ackPlan: true,
      ackFollowups: true,
      ackBlock: true,
    });
    expect(r.exitCode).toBe(4);
    expect(r.result.verdict).toBe("invalid");
    expect(r.result.source.state).toBe("tampered");
  });

  it("a missing / unreadable plan → invalid (exit 4), never a fabricated pass, path never echoed", async () => {
    // readFile throws for any path != "plan-0" → unreadable.
    const missing = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceipt(
      makeArgs({ planPath: "does-not-exist", ackPlan: true }),
      makeProvider(clearPlan()),
    );
    expect(missing.exitCode).toBe(4);
    expect(missing.result.verdict).toBe("invalid");
    expect(missing.result.source.state).toBe("unreadable");
    expect(missing.output).not.toContain("does-not-exist");

    const decoy = await run(notAPlan(), { ackPlan: true });
    expect(decoy.exitCode).toBe(4);
    expect(decoy.result.source.state).toBe("unreadable");
  });

  it("--strict-open escalates an open follow-up to blocked (exit 4); a clean close-out is untouched", async () => {
    const strict = await run(monitorPlan(), { ackPlan: true, strictOpen: true });
    expect(strict.exitCode).toBe(4);
    expect(strict.result.actionReceipt.strictOpenEscalated).toBe(true);
    expect(strict.result.actionReceipt.strictOpenEscalatedFrom).toBe("followup-open");

    const clean = await run(clearPlan(), { ackPlan: true, strictOpen: true });
    expect(clean.exitCode).toBe(0);
  });

  it("reads the plan from stdin (--stdin)", async () => {
    const r = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceipt(
      makeArgs({ stdin: true, planPath: undefined }),
      makeProvider(undefined, JSON.stringify(blockPlan())),
    );
    expect(r.result.source.state).toBe("usable");
    expect(r.result.verdict).toBe("blocked"); // no ack-block → an unacknowledged block plan is blocked
  });

  it("renders text when requested", async () => {
    const r = await run(clearPlan(), { ackPlan: true, format: "text" });
    expect(r.output).toContain("RECEIPT: COMPLETED (exit 0)");
  });
});
