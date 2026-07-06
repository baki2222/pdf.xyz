import { describe, expect, it } from "vitest";
import {
  acks,
  blockPlan,
  clearPlan,
  ingestPlanObj,
  invalidPlan,
  invalidPlanFromTampered,
  investigatePlan,
  monitorPlan,
  notAPlan,
  policyWith,
  requireCleanBlockPlan,
  strictWatchBlockPlan,
  tamperedPlan,
} from "./fixtures";
import { computeReceipt, sourceStateOf } from "./reduce";
import { UNRECOGNIZED_PLAN } from "./ingest";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPolicy } from "./types";

/** Drive the fold over an ingested plan object + policy. */
function receipt(obj: unknown, policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPolicy) {
  return computeReceipt(ingestPlanObj(obj), policy);
}

describe("finalize-index-trend-action-receipt reduce — source coverage states ⇒ invalid", () => {
  it("an unreadable plan is invalid (nothing trustworthy to receipt), never completed", () => {
    const { rollup } = computeReceipt(UNRECOGNIZED_PLAN, policyWith({ plan: true }));
    expect(rollup.verdict).toBe("invalid");
    expect(rollup.exitCode).toBe(4);
    expect(rollup.planClass).toBeNull();
    expect(rollup.reasons).toEqual(["plan-unreadable"]);
  });

  it("a tampered plan is invalid, never completed, even with every acknowledgement", () => {
    const { rollup } = receipt(
      tamperedPlan(),
      policyWith({ plan: true, executed: true, monitor: true, investigation: true, block: true, clear: true }),
    );
    expect(rollup.verdict).toBe("invalid");
    expect(rollup.exitCode).toBe(4);
    expect(rollup.reasons).toContain("plan-tampered");
  });

  it("a usable plan whose OWN verdict is `invalid` is invalid, regardless of the flags", () => {
    for (const build of [invalidPlan, invalidPlanFromTampered]) {
      const { rollup } = receipt(
        build(),
        policyWith({ plan: true, executed: true, monitor: true, investigation: true, block: true, clear: true }),
      );
      expect(rollup.verdict, build.name).toBe("invalid");
      expect(rollup.exitCode).toBe(4);
      expect(rollup.planClass).toBeNull();
      expect(rollup.reasons).toEqual(["plan-invalid"]);
    }
  });

  it("sourceStateOf reflects recognized / usable", () => {
    expect(sourceStateOf(UNRECOGNIZED_PLAN)).toBe("unreadable");
    expect(sourceStateOf(ingestPlanObj(tamperedPlan()))).toBe("tampered");
    expect(sourceStateOf(ingestPlanObj(clearPlan()))).toBe("usable");
  });
});

describe("finalize-index-trend-action-receipt reduce — clear class", () => {
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

  it("the optional --ack-clear is NOT a contradiction on a clear plan (still completed)", () => {
    const { rollup } = receipt(clearPlan(), policyWith({ plan: true, clear: true }));
    expect(rollup.verdict).toBe("completed");
    expect(rollup.mismatchedAcks).toEqual([]);
  });

  it("--ack-clear alone (no --ack-plan) is still incomplete (the plan was not reviewed)", () => {
    const { rollup } = receipt(clearPlan(), policyWith({ clear: true }));
    expect(rollup.verdict).toBe("incomplete");
    expect(rollup.reasons).toContain("plan-not-exercised");
  });

  it("a monitor / investigation / block class ack on a clear plan is a contradiction (blocked)", () => {
    for (const bad of ["monitor", "investigation", "block"] as const) {
      const { rollup } = receipt(clearPlan(), policyWith({ plan: true, [bad]: true }));
      expect(rollup.verdict, `--ack-${bad} on clear`).toBe("blocked");
      expect(rollup.exitCode).toBe(4);
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

describe("finalize-index-trend-action-receipt reduce — monitor class (missing ack ⇒ incomplete, no followup-open)", () => {
  it("reviewed-but-unacked is INCOMPLETE; full acks complete it", () => {
    const inc = receipt(monitorPlan(), policyWith({ plan: true }));
    expect(inc.rollup.verdict).toBe("incomplete");
    expect(inc.rollup.exitCode).toBe(2);
    expect(inc.rollup.reasons).toContain("monitor-incomplete");
    expect(inc.rollup.missingAcks).toEqual(["executed", "monitor"]);

    const done = receipt(monitorPlan(), policyWith({ plan: true, monitor: true, executed: true }));
    expect(done.rollup.verdict).toBe("completed");
    expect(done.rollup.reasons).toEqual(["monitor-acknowledged"]);
  });

  it("no --ack-plan is incomplete (not yet reviewed)", () => {
    const { rollup } = receipt(monitorPlan(), policyWith({ monitor: true, executed: true }));
    expect(rollup.verdict).toBe("incomplete");
    expect(rollup.reasons).toContain("plan-not-exercised");
  });

  it("--ack-monitor without --ack-executed stays incomplete (never claims execution without --ack-executed)", () => {
    const { rollup } = receipt(monitorPlan(), policyWith({ plan: true, monitor: true }));
    expect(rollup.verdict).toBe("incomplete");
    expect(rollup.reasons).toContain("monitor-incomplete");
    expect(rollup.missingAcks).toEqual(["executed"]);
  });

  it("--strict-open escalates a missing-ack monitor receipt to blocked (and records the escalation)", () => {
    const { rollup } = receipt(monitorPlan(), policyWith({ plan: true }, true));
    expect(rollup.verdict).toBe("blocked");
    expect(rollup.exitCode).toBe(4);
    expect(rollup.strictOpenEscalated).toBe(true);
    expect(rollup.strictOpenEscalatedFrom).toBe("incomplete");
    expect(rollup.reasons).toContain("strict-open-escalation");
  });

  it("--strict-open never escalates a completed monitor receipt", () => {
    const done = receipt(monitorPlan(), policyWith({ plan: true, monitor: true, executed: true }, true));
    expect(done.rollup.verdict).toBe("completed");
    expect(done.rollup.strictOpenEscalated).toBe(false);
  });

  it("a block ack on a monitor plan is a contradiction (blocked)", () => {
    const { rollup } = receipt(monitorPlan(), policyWith({ plan: true, monitor: true, executed: true, block: true }));
    expect(rollup.verdict).toBe("blocked");
    expect(rollup.mismatchedAcks).toContain("block");
  });
});

describe("finalize-index-trend-action-receipt reduce — investigate class (missing ack ⇒ incomplete)", () => {
  it("reviewed-but-unacked is INCOMPLETE; full acks complete it", () => {
    const inc = receipt(investigatePlan(), policyWith({ plan: true }));
    expect(inc.rollup.verdict).toBe("incomplete");
    expect(inc.rollup.exitCode).toBe(2);
    expect(inc.rollup.reasons).toContain("investigation-incomplete");
    expect(inc.rollup.missingAcks).toEqual(["executed", "investigation"]);

    const done = receipt(investigatePlan(), policyWith({ plan: true, investigation: true, executed: true }));
    expect(done.rollup.verdict).toBe("completed");
    expect(done.rollup.reasons).toEqual(["investigation-acknowledged"]);
  });

  it("--strict-open escalates a missing-ack investigate receipt to blocked", () => {
    const { rollup } = receipt(investigatePlan(), policyWith({ plan: true }, true));
    expect(rollup.verdict).toBe("blocked");
    expect(rollup.strictOpenEscalated).toBe(true);
  });

  it("a block ack on an investigate plan is a contradiction (blocked)", () => {
    const { rollup } = receipt(
      investigatePlan(),
      policyWith({ plan: true, investigation: true, executed: true, block: true }),
    );
    expect(rollup.verdict).toBe("blocked");
    expect(rollup.mismatchedAcks).toContain("block");
  });
});

describe("finalize-index-trend-action-receipt reduce — block class (always blocked, never a close-out)", () => {
  for (const build of [blockPlan, strictWatchBlockPlan, requireCleanBlockPlan]) {
    it(`${build.name}: unacknowledged, held-incomplete, and fully-acked are ALL blocked (release held)`, () => {
      const notBlocked = receipt(build(), policyWith({ plan: true, executed: true }));
      expect(notBlocked.rollup.verdict).toBe("blocked");
      expect(notBlocked.rollup.exitCode).toBe(4);
      expect(notBlocked.rollup.reasons).toContain("block-not-acknowledged");

      const held = receipt(build(), policyWith({ block: true }));
      expect(held.rollup.verdict).toBe("blocked");
      expect(held.rollup.reasons).toEqual(["block-acknowledgement-incomplete"]);
      expect(held.rollup.missingAcks).toEqual(["plan", "executed"]);

      const acked = receipt(build(), policyWith({ plan: true, executed: true, block: true }));
      expect(acked.rollup.verdict).toBe("blocked");
      expect(acked.rollup.exitCode).toBe(4);
      expect(acked.rollup.reasons).toEqual(["block-acknowledged"]);
    });
  }

  it("a clear / monitor / investigation ack on a block plan is a contradiction (still blocked)", () => {
    for (const bad of ["clear", "monitor", "investigation"] as const) {
      const { rollup } = receipt(blockPlan(), policyWith({ plan: true, executed: true, block: true, [bad]: true }));
      expect(rollup.verdict, `--ack-${bad} on block`).toBe("blocked");
      expect(rollup.mismatchedAcks).toContain(bad);
      expect(rollup.reasons).toContain("acknowledgement-mismatch");
    }
  });
});

describe("finalize-index-trend-action-receipt reduce — acknowledgement checklist", () => {
  it("marks each ack required / supplied / satisfied for the resolved class", () => {
    const { acknowledgements } = receipt(monitorPlan(), policyWith({ plan: true, monitor: true }));
    const byId = Object.fromEntries(acknowledgements.map((a) => [a.id, a]));
    expect(byId.plan).toMatchObject({ required: true, supplied: true, satisfied: true });
    expect(byId.executed).toMatchObject({ required: true, supplied: false, satisfied: false });
    expect(byId.monitor).toMatchObject({ required: true, supplied: true, satisfied: true });
    expect(byId.investigation).toMatchObject({ required: false, supplied: false, satisfied: true });
    expect(byId.block).toMatchObject({ required: false, supplied: false, satisfied: true });
    expect(byId.clear).toMatchObject({ required: false, supplied: false, satisfied: true });
  });

  it("emits all six acknowledgements in canonical order", () => {
    const { acknowledgements } = receipt(clearPlan(), policyWith({ plan: true }));
    expect(acknowledgements.map((a) => a.id)).toEqual([
      "plan",
      "executed",
      "monitor",
      "investigation",
      "block",
      "clear",
    ]);
  });
});

describe("finalize-index-trend-action-receipt reduce — reasons + next-actions bookkeeping", () => {
  it("counts severities and keeps reasons in canonical superset order", () => {
    const { rollup } = receipt(blockPlan(), policyWith({ plan: true, executed: true, block: true, monitor: true }));
    // block-acknowledged (blocking) + acknowledgement-mismatch (blocking) both fire, in canonical order.
    expect(rollup.blocking).toBe(2);
    expect(rollup.reasons).toEqual(["block-acknowledged", "acknowledgement-mismatch"]);
  });

  it("derives bounded next-action ids per verdict", () => {
    expect(receipt(clearPlan(), policyWith({ plan: true })).nextActions).toEqual(["keep-action-receipt"]);
    expect(receipt(clearPlan(), policyWith({})).nextActions).toEqual(["supply-missing-ack", "keep-action-receipt"]);
    expect(receipt(invalidPlan(), policyWith({})).nextActions).toEqual(["recover-valid-plan", "keep-action-receipt"]);
    expect(receipt(blockPlan(), policyWith({ plan: true, executed: true, block: true })).nextActions).toEqual([
      "hold-promotion",
      "keep-action-receipt",
    ]);
    expect(receipt(clearPlan(), policyWith({ plan: true, block: true })).nextActions).toContain("resolve-contradiction");
  });

  it("a non-plan decoy folds through ingest to invalid", () => {
    const { rollup } = receipt(notAPlan(), policyWith({ plan: true }));
    expect(rollup.verdict).toBe("invalid");
    expect(rollup.reasons).toEqual(["plan-unreadable"]);
  });

  it("acks() helper builds an all-false set overridable per-key", () => {
    expect(acks()).toEqual({
      plan: false,
      executed: false,
      monitor: false,
      investigation: false,
      block: false,
      clear: false,
    });
    expect(acks({ plan: true }).plan).toBe(true);
  });
});
