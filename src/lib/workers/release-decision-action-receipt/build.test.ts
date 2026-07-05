import { describe, expect, it } from "vitest";
import {
  NOW,
  blockedPlan,
  clearPlan,
  investigatePlan,
  makeArgs,
  makeProvider,
  makeReceipt,
  notAPlan,
  policyWith,
  tamperedPlan,
  watchMonitorPlan,
} from "./fixtures";
import { runReleaseDecisionActionReceipt } from "./run";
import { releaseDecisionActionReceiptExitCode } from "./types";

describe("release-decision-action-receipt build — result assembly", () => {
  it("assembles a stable, content-free completed result over a clear plan", () => {
    const result = makeReceipt(clearPlan(), policyWith({ plan: true }));
    expect(result.schema).toBe("pdfxyz.release-decision-action-receipt/1");
    expect(result.generatedAt).toBe(NOW);
    expect(result.metadata.planSchema).toBe("pdfxyz.release-decision-action-plan/1");
    expect(result.verdict).toBe("completed");
    expect(result.exitCode).toBe(0);
    expect(result.planClass).toBe("clear");
    expect(result.source.state).toBe("usable");
    expect(result.source.claimedPlanVerdict).toBe("clear");
    expect(result.actionReceipt.verdict).toBe("completed");
    expect(releaseDecisionActionReceiptExitCode(result)).toBe(0);
    expect(result.guidance.length).toBeGreaterThan(0);
    expect(result.caveats.length).toBeGreaterThan(0);
  });

  it("flattens a content-free receipt with the acknowledgement coverage counts", () => {
    const result = makeReceipt(blockedPlan(), policyWith({ plan: true, block: true }));
    // block plan, ack-plan + ack-block but no ack-followups → incomplete (held but not complete).
    expect(result.verdict).toBe("incomplete");
    const r = result.receipt;
    expect(r.category).toBe("worker-release-decision-action-receipt");
    expect(r.planClass).toBe("block");
    expect(r.sourceState).toBe("usable");
    expect(r.acksRequired).toBe(3); // plan, followups, block
    expect(r.acksSatisfied).toBe(2); // plan + block supplied
    expect(r.acksMissing).toBe(1); // followups
    expect(r.acksMismatched).toBe(0);
    expect(r.disclosure).toMatch(/content-free operational execution receipt/i);
  });

  it("records the source summary for a not-usable plan without inventing facts", () => {
    const unreadable = makeReceipt(notAPlan(), policyWith({ plan: true }));
    expect(unreadable.source).toMatchObject({
      state: "unreadable",
      claimedPlanVerdict: null,
      planClass: null,
      planUrgency: null,
      benignMonitor: false,
      sourceTrendVerdict: null,
      blockingActions: 0,
      advisoryActions: 0,
      planStrict: false,
    });

    const tampered = makeReceipt(tamperedPlan(), policyWith({ plan: true }));
    expect(tampered.source.state).toBe("tampered");
    expect(tampered.source.claimedPlanVerdict).toBe("block-release"); // the untrusted claim
    expect(tampered.verdict).toBe("blocked");
  });

  it("surfaces the plan's own urgency / action class / source trend for a usable plan", () => {
    const result = makeReceipt(investigatePlan(), policyWith({ plan: true, investigation: true, followups: true }));
    expect(result.source.planUrgency).not.toBeNull();
    expect(result.source.planActionClass).not.toBeNull();
    expect(result.source.sourceTrendVerdict).toBe("insufficient");
  });
});

describe("release-decision-action-receipt run — orchestration over the provider seam", () => {
  it("reads the plan file, folds, and returns exit + rendered output", async () => {
    const run = await runReleaseDecisionActionReceipt(
      makeArgs({ ackPlan: true }),
      makeProvider(clearPlan()),
    );
    expect(run.exitCode).toBe(0);
    expect(run.result.verdict).toBe("completed");
    expect(run.output).toContain("pdfxyz.release-decision-action-receipt/1");
  });

  it("reads the plan from stdin", async () => {
    const run = await runReleaseDecisionActionReceipt(
      makeArgs({ stdin: true, planPath: undefined, ackPlan: true, ackMonitor: true, ackFollowups: true }),
      makeProvider(undefined, JSON.stringify(watchMonitorPlan())),
    );
    expect(run.exitCode).toBe(0);
    expect(run.result.verdict).toBe("completed");
  });

  it("maps a missing / unreadable input to incomplete, never a throw or a completed pass", async () => {
    const run = await runReleaseDecisionActionReceipt(
      makeArgs({ planPath: "missing" }),
      makeProvider(clearPlan()), // provider only serves `plan-0`; `missing` throws → unreadable
    );
    expect(run.exitCode).toBe(2);
    expect(run.result.verdict).toBe("incomplete");
    expect(run.result.source.state).toBe("unreadable");
  });

  it("renders --text on request", async () => {
    const run = await runReleaseDecisionActionReceipt(
      makeArgs({ format: "text", ackPlan: true }),
      makeProvider(clearPlan()),
    );
    expect(run.output).toMatch(/release decision action-plan execution receipt/i);
  });
});
