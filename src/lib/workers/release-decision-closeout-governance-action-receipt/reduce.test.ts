import { describe, expect, it } from "vitest";
import {
  acks,
  blockedPlan,
  clearPlan,
  ingestPlanObj,
  investigatePlan,
  monitorPlan,
  notAPlan,
  policyWith,
  rejectInputPlan,
  tamperedPlan,
} from "./fixtures";
import { computeReceipt, sourceStateOf } from "./reduce";
import { UNRECOGNIZED_PLAN } from "./ingest";
import type { ReleaseDecisionCloseoutGovernanceActionReceiptPolicy } from "./types";

/** Drive the fold over an ingested plan object + policy. */
function receipt(obj: unknown, policy: ReleaseDecisionCloseoutGovernanceActionReceiptPolicy) {
  return computeReceipt(ingestPlanObj(obj), policy);
}

describe("release-decision-closeout-governance-action-receipt reduce — source coverage states", () => {
  it("an unreadable plan is blocked (nothing trustworthy to receipt), never completed", () => {
    const { rollup } = computeReceipt(UNRECOGNIZED_PLAN, policyWith({ plan: true }));
    expect(rollup.verdict).toBe("blocked");
    expect(rollup.exitCode).toBe(4);
    expect(rollup.planClass).toBeNull();
    expect(rollup.reasons).toEqual(["plan-unreadable"]);
  });

  it("a tampered plan is blocked, never completed, even with every acknowledgement", () => {
    const { rollup } = receipt(
      tamperedPlan(),
      policyWith({ plan: true, executed: true, monitor: true, investigation: true, block: true }),
    );
    expect(rollup.verdict).toBe("blocked");
    expect(rollup.exitCode).toBe(4);
    expect(rollup.reasons).toContain("plan-tampered");
  });

  it("sourceStateOf reflects recognized / usable", () => {
    expect(sourceStateOf(UNRECOGNIZED_PLAN)).toBe("unreadable");
    expect(sourceStateOf(ingestPlanObj(tamperedPlan()))).toBe("tampered");
    expect(sourceStateOf(ingestPlanObj(clearPlan()))).toBe("usable");
  });
});

describe("release-decision-closeout-governance-action-receipt reduce — clear class", () => {
  it("requires only --ack-plan: missing is incomplete, present is completed", () => {
    const none = receipt(clearPlan(), policyWith({}));
    expect(none.rollup.verdict).toBe("incomplete");
    expect(none.rollup.reasons).toEqual(["plan-not-exercised"]);
    expect(none.rollup.missingAcks).toEqual(["plan"]);

    const ok = receipt(clearPlan(), policyWith({ plan: true }));
    expect(ok.rollup.verdict).toBe("completed");
    expect(ok.rollup.exitCode).toBe(0);
    expect(ok.rollup.reasons).toEqual(["plan-acknowledged"]);
    expect(ok.rollup.requiredAcks).toEqual(["plan"]);
    expect(ok.rollup.missingAcks).toEqual([]);
  });

  it("a class ack on a clear plan is a contradiction (blocked)", () => {
    for (const bad of ["monitor", "investigation", "block"] as const) {
      const { rollup } = receipt(clearPlan(), policyWith({ plan: true, [bad]: true }));
      expect(rollup.verdict, `--ack-${bad} on clear`).toBe("blocked");
      expect(rollup.mismatchedAcks).toContain(bad);
      expect(rollup.reasons).toContain("acknowledgement-mismatch");
    }
  });

  it("--ack-executed on a clear plan is harmless (not a contradiction)", () => {
    const { rollup } = receipt(clearPlan(), policyWith({ plan: true, executed: true }));
    expect(rollup.verdict).toBe("completed");
    expect(rollup.mismatchedAcks).toEqual([]);
  });
});

describe("release-decision-closeout-governance-action-receipt reduce — investigate class (missing ack ⇒ incomplete)", () => {
  it("reviewed-but-unacked is INCOMPLETE (not followup-open); full acks complete it", () => {
    const inc = receipt(investigatePlan(), policyWith({ plan: true }));
    expect(inc.rollup.verdict).toBe("incomplete");
    expect(inc.rollup.exitCode).toBe(2);
    expect(inc.rollup.reasons).toContain("investigation-incomplete");
    expect(inc.rollup.missingAcks).toEqual(["executed", "investigation"]);

    const done = receipt(investigatePlan(), policyWith({ plan: true, investigation: true, executed: true }));
    expect(done.rollup.verdict).toBe("completed");
    expect(done.rollup.reasons).toEqual(["investigation-acknowledged"]);
  });

  it("no --ack-plan is incomplete (not yet exercised)", () => {
    const { rollup } = receipt(investigatePlan(), policyWith({ investigation: true, executed: true }));
    expect(rollup.verdict).toBe("incomplete");
    expect(rollup.reasons).toContain("plan-not-exercised");
  });

  it("a monitor / block ack on an investigate plan is a contradiction (blocked)", () => {
    const { rollup } = receipt(
      investigatePlan(),
      policyWith({ plan: true, investigation: true, executed: true, block: true }),
    );
    expect(rollup.verdict).toBe("blocked");
    expect(rollup.mismatchedAcks).toContain("block");
  });

  it("--strict-open never escalates an incomplete investigate receipt", () => {
    const { rollup } = receipt(investigatePlan(), policyWith({ plan: true }, true));
    expect(rollup.verdict).toBe("incomplete");
    expect(rollup.strictOpenEscalated).toBe(false);
  });
});

describe("release-decision-closeout-governance-action-receipt reduce — monitor class (open follow-up ⇒ followup-open)", () => {
  it("reviewed-but-unacked is followup-open; full acks complete it", () => {
    const open = receipt(monitorPlan(), policyWith({ plan: true }));
    expect(open.rollup.verdict).toBe("followup-open");
    expect(open.rollup.exitCode).toBe(3);
    expect(open.rollup.reasons).toContain("monitor-followup-open");
    expect(open.rollup.missingAcks).toEqual(["executed", "monitor"]);

    const done = receipt(monitorPlan(), policyWith({ plan: true, monitor: true, executed: true }));
    expect(done.rollup.verdict).toBe("completed");
    expect(done.rollup.reasons).toEqual(["monitor-acknowledged"]);
  });

  it("no --ack-plan is incomplete (not yet exercised), not followup-open", () => {
    const { rollup } = receipt(monitorPlan(), policyWith({ monitor: true, executed: true }));
    expect(rollup.verdict).toBe("incomplete");
    expect(rollup.reasons).toContain("plan-not-exercised");
  });

  it("--strict-open escalates an open monitor follow-up to blocked (and records the escalation)", () => {
    const { rollup } = receipt(monitorPlan(), policyWith({ plan: true }, true));
    expect(rollup.verdict).toBe("blocked");
    expect(rollup.exitCode).toBe(4);
    expect(rollup.strictOpenEscalated).toBe(true);
    expect(rollup.strictOpenEscalatedFrom).toBe("followup-open");
    expect(rollup.reasons).toContain("strict-open-escalation");
  });

  it("--strict-open never escalates a completed monitor receipt", () => {
    const done = receipt(monitorPlan(), policyWith({ plan: true, monitor: true, executed: true }, true));
    expect(done.rollup.verdict).toBe("completed");
    expect(done.rollup.strictOpenEscalated).toBe(false);
  });
});

describe("release-decision-closeout-governance-action-receipt reduce — block class", () => {
  for (const build of [blockedPlan, rejectInputPlan]) {
    it(`${build.name}: no --ack-block is blocked; held-but-incomplete is incomplete; full acks complete it`, () => {
      const notBlocked = receipt(build(), policyWith({ plan: true, executed: true }));
      expect(notBlocked.rollup.verdict).toBe("blocked");
      expect(notBlocked.rollup.exitCode).toBe(4);
      expect(notBlocked.rollup.reasons).toContain("block-not-acknowledged");

      const held = receipt(build(), policyWith({ block: true }));
      expect(held.rollup.verdict).toBe("incomplete");
      expect(held.rollup.reasons).toEqual(["block-acknowledgement-incomplete"]);
      expect(held.rollup.missingAcks).toEqual(["plan", "executed"]);

      const done = receipt(build(), policyWith({ plan: true, executed: true, block: true }));
      expect(done.rollup.verdict).toBe("completed");
      expect(done.rollup.reasons).toEqual(["block-acknowledged"]);
    });
  }

  it("a monitor / investigation ack on a block plan is a contradiction (blocked), even fully acked", () => {
    const { rollup } = receipt(
      blockedPlan(),
      policyWith({ plan: true, executed: true, block: true, monitor: true }),
    );
    expect(rollup.verdict).toBe("blocked");
    expect(rollup.mismatchedAcks).toContain("monitor");
    expect(rollup.reasons).toContain("acknowledgement-mismatch");
  });
});

describe("release-decision-closeout-governance-action-receipt reduce — acknowledgement checklist", () => {
  it("marks each ack required / supplied / satisfied for the resolved class", () => {
    const { acknowledgements } = receipt(monitorPlan(), policyWith({ plan: true, monitor: true }));
    const byId = Object.fromEntries(acknowledgements.map((a) => [a.id, a]));
    expect(byId.plan).toMatchObject({ required: true, supplied: true, satisfied: true });
    expect(byId.executed).toMatchObject({ required: true, supplied: false, satisfied: false });
    expect(byId.monitor).toMatchObject({ required: true, supplied: true, satisfied: true });
    expect(byId.investigation).toMatchObject({ required: false, supplied: false, satisfied: true });
    expect(byId.block).toMatchObject({ required: false, supplied: false, satisfied: true });
  });

  it("emits all five acknowledgements in canonical order", () => {
    const { acknowledgements } = receipt(clearPlan(), policyWith({ plan: true }));
    expect(acknowledgements.map((a) => a.id)).toEqual(["plan", "executed", "monitor", "investigation", "block"]);
  });
});

describe("release-decision-closeout-governance-action-receipt reduce — severity bookkeeping", () => {
  it("counts severities and keeps reasons in canonical superset order", () => {
    const { rollup } = receipt(blockedPlan(), policyWith({ plan: true, monitor: true }));
    // block-not-acknowledged (blocking) + acknowledgement-mismatch (blocking) both fire.
    expect(rollup.blocking).toBe(2);
    expect(rollup.reasons).toEqual(["block-not-acknowledged", "acknowledgement-mismatch"]);
  });

  it("a non-plan decoy folds through ingest to blocked", () => {
    const { rollup } = receipt(notAPlan(), policyWith({ plan: true }));
    expect(rollup.verdict).toBe("blocked");
    expect(rollup.reasons).toEqual(["plan-unreadable"]);
  });

  it("acks() helper builds an all-false set overridable per-key", () => {
    expect(acks()).toEqual({ plan: false, executed: false, monitor: false, investigation: false, block: false });
    expect(acks({ plan: true }).plan).toBe(true);
  });
});
