import { describe, expect, it } from "vitest";
import {
  blockedPlan,
  clearPlan,
  investigatePlan,
  makeArgs,
  makeProvider,
  monitorPlan,
  notAPlan,
  tamperedPlan,
} from "./fixtures";
import { runReleaseDecisionCloseoutGovernanceActionReceipt } from "./run";

/** Run the orchestrator over a served plan object + args overrides. */
async function run(obj: unknown, over: Parameters<typeof makeArgs>[0] = {}, stdinPayload = "") {
  return runReleaseDecisionCloseoutGovernanceActionReceipt(makeArgs(over), makeProvider(obj, stdinPayload));
}

describe("runReleaseDecisionCloseoutGovernanceActionReceipt — end-to-end over injected seams", () => {
  it("a clear plan reviewed → completed (exit 0); unacked → incomplete (exit 2)", async () => {
    const done = await run(clearPlan(), { ackPlan: true });
    expect(done.exitCode).toBe(0);
    expect(done.result.verdict).toBe("completed");
    expect(done.output).toContain('"schema": "pdfxyz.release-decision-closeout-governance-action-receipt/1"');

    const inc = await run(clearPlan(), {});
    expect(inc.exitCode).toBe(2);
    expect(inc.result.verdict).toBe("incomplete");
  });

  it("an investigate plan reviewed-but-unacked → incomplete (exit 2)", async () => {
    const r = await run(investigatePlan(), { ackPlan: true });
    expect(r.exitCode).toBe(2);
    expect(r.result.verdict).toBe("incomplete");
    expect(r.result.planClass).toBe("investigate");
  });

  it("a monitor plan reviewed-but-unacked → followup-open (exit 3)", async () => {
    const r = await run(monitorPlan(), { ackPlan: true });
    expect(r.exitCode).toBe(3);
    expect(r.result.verdict).toBe("followup-open");
  });

  it("a block plan unacknowledged → blocked (exit 4); fully acked → completed", async () => {
    const b = await run(blockedPlan(), {});
    expect(b.exitCode).toBe(4);
    expect(b.result.governanceActionReceipt.reasons).toContain("block-not-acknowledged");

    const done = await run(blockedPlan(), { ackPlan: true, ackExecuted: true, ackBlock: true });
    expect(done.exitCode).toBe(0);
  });

  it("a tampered plan fails closed → blocked (exit 4), even fully acked", async () => {
    const r = await run(tamperedPlan(), {
      ackPlan: true,
      ackExecuted: true,
      ackBlock: true,
    });
    expect(r.exitCode).toBe(4);
    expect(r.result.source.state).toBe("tampered");
  });

  it("a missing / unreadable plan → blocked (exit 4), never a fabricated pass, path never echoed", async () => {
    // readFile throws for any path != "plan-0" → unreadable.
    const missing = await runReleaseDecisionCloseoutGovernanceActionReceipt(
      makeArgs({ planPath: "does-not-exist", ackPlan: true }),
      makeProvider(clearPlan()),
    );
    expect(missing.exitCode).toBe(4);
    expect(missing.result.source.state).toBe("unreadable");
    expect(missing.output).not.toContain("does-not-exist");

    const decoy = await run(notAPlan(), { ackPlan: true });
    expect(decoy.exitCode).toBe(4);
    expect(decoy.result.source.state).toBe("unreadable");
  });

  it("--strict-open escalates an open follow-up to blocked (exit 4); a clean close-out is untouched", async () => {
    const strict = await run(monitorPlan(), { ackPlan: true, strictOpen: true });
    expect(strict.exitCode).toBe(4);
    expect(strict.result.governanceActionReceipt.strictOpenEscalated).toBe(true);

    const clean = await run(clearPlan(), { ackPlan: true, strictOpen: true });
    expect(clean.exitCode).toBe(0);
  });

  it("reads the plan from stdin (--stdin)", async () => {
    const r = await runReleaseDecisionCloseoutGovernanceActionReceipt(
      makeArgs({ stdin: true, planPath: undefined }),
      makeProvider(undefined, JSON.stringify(blockedPlan())),
    );
    expect(r.result.source.state).toBe("usable");
    expect(r.result.verdict).toBe("blocked"); // no ack-block
  });

  it("renders text when requested", async () => {
    const r = await run(clearPlan(), { ackPlan: true, format: "text" });
    expect(r.output).toContain("RECEIPT: COMPLETED (exit 0)");
  });
});
