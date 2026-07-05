import { describe, expect, it } from "vitest";
import {
  acks,
  blockedPlan,
  benignMonitorPlan,
  clearPlan,
  degradingMonitorPlan,
  ingestPlanObj,
  investigatePlan,
  notAPlan,
  policyWith,
  tamperedPlan,
  untrustedTrendPlan,
  watchMonitorPlan,
} from "./fixtures";
import { computeReceipt, sourceStateOf } from "./reduce";
import { UNRECOGNIZED_PLAN } from "./ingest";
import type { ReleaseDecisionActionReceiptPolicy } from "./types";

/** Drive the fold over an ingested plan object + policy. */
function receipt(obj: unknown, policy: ReleaseDecisionActionReceiptPolicy) {
  return computeReceipt(ingestPlanObj(obj), policy);
}

describe("release-decision-action-receipt reduce — source coverage states", () => {
  it("an unreadable plan is incomplete (nothing to receipt), never completed", () => {
    const { rollup } = computeReceipt(UNRECOGNIZED_PLAN, policyWith({ plan: true }));
    expect(rollup.verdict).toBe("incomplete");
    expect(rollup.exitCode).toBe(2);
    expect(rollup.planClass).toBeNull();
    expect(rollup.reasons).toEqual(["plan-unreadable"]);
  });

  it("a tampered plan is blocked, never completed, even with every acknowledgement", () => {
    const { rollup } = receipt(
      tamperedPlan(),
      policyWith({ plan: true, followups: true, monitor: true, investigation: true, block: true }),
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

describe("release-decision-action-receipt reduce — clear class", () => {
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

  it("--ack-followups on a clear plan is harmless (not a contradiction)", () => {
    const { rollup } = receipt(clearPlan(), policyWith({ plan: true, followups: true }));
    expect(rollup.verdict).toBe("completed");
    expect(rollup.mismatchedAcks).toEqual([]);
  });
});

describe("release-decision-action-receipt reduce — monitor class", () => {
  for (const build of [benignMonitorPlan, watchMonitorPlan, degradingMonitorPlan]) {
    it(`${build.name}: reviewed-but-unacked is followup-open; full acks complete it`, () => {
      const open = receipt(build(), policyWith({ plan: true }));
      expect(open.rollup.verdict).toBe("followup-open");
      expect(open.rollup.exitCode).toBe(3);
      expect(open.rollup.reasons).toContain("monitor-followup-open");
      expect(open.rollup.missingAcks).toEqual(["followups", "monitor"]);

      const done = receipt(build(), policyWith({ plan: true, monitor: true, followups: true }));
      expect(done.rollup.verdict).toBe("completed");
      expect(done.rollup.reasons).toEqual(["monitor-followups-acknowledged"]);
    });
  }

  it("no --ack-plan is incomplete (not yet exercised), not followup-open", () => {
    const { rollup } = receipt(watchMonitorPlan(), policyWith({ monitor: true, followups: true }));
    expect(rollup.verdict).toBe("incomplete");
    expect(rollup.reasons).toContain("plan-not-exercised");
  });

  it("--strict-open escalates an open monitor follow-up to blocked (and records the escalation)", () => {
    const { rollup } = receipt(watchMonitorPlan(), policyWith({ plan: true }, true));
    expect(rollup.verdict).toBe("blocked");
    expect(rollup.exitCode).toBe(4);
    expect(rollup.strictOpenEscalated).toBe(true);
    expect(rollup.strictOpenEscalatedFrom).toBe("followup-open");
    expect(rollup.reasons).toContain("strict-open-escalation");
  });

  it("--strict-open never escalates a completed or incomplete monitor receipt", () => {
    const done = receipt(watchMonitorPlan(), policyWith({ plan: true, monitor: true, followups: true }, true));
    expect(done.rollup.verdict).toBe("completed");
    expect(done.rollup.strictOpenEscalated).toBe(false);

    const inc = receipt(watchMonitorPlan(), policyWith({ monitor: true, followups: true }, true));
    expect(inc.rollup.verdict).toBe("incomplete");
    expect(inc.rollup.strictOpenEscalated).toBe(false);
  });
});

describe("release-decision-action-receipt reduce — investigate class", () => {
  it("reviewed-but-unacked is followup-open; full acks complete it", () => {
    const open = receipt(investigatePlan(), policyWith({ plan: true }));
    expect(open.rollup.verdict).toBe("followup-open");
    expect(open.rollup.reasons).toContain("investigation-open");

    const done = receipt(investigatePlan(), policyWith({ plan: true, investigation: true, followups: true }));
    expect(done.rollup.verdict).toBe("completed");
    expect(done.rollup.reasons).toEqual(["investigation-acknowledged"]);
  });

  it("a monitor / block ack on an investigate plan is a contradiction (blocked)", () => {
    const { rollup } = receipt(
      investigatePlan(),
      policyWith({ plan: true, investigation: true, followups: true, block: true }),
    );
    expect(rollup.verdict).toBe("blocked");
    expect(rollup.mismatchedAcks).toContain("block");
  });
});

describe("release-decision-action-receipt reduce — block class", () => {
  for (const build of [blockedPlan, untrustedTrendPlan]) {
    it(`${build.name}: no --ack-block is blocked; held-blocked-but-incomplete is incomplete; full acks complete it`, () => {
      const notBlocked = receipt(build(), policyWith({ plan: true, followups: true }));
      expect(notBlocked.rollup.verdict).toBe("blocked");
      expect(notBlocked.rollup.exitCode).toBe(4);
      expect(notBlocked.rollup.reasons).toContain("block-not-acknowledged");

      const held = receipt(build(), policyWith({ block: true }));
      expect(held.rollup.verdict).toBe("incomplete");
      expect(held.rollup.reasons).toEqual(["block-acknowledgement-incomplete"]);
      expect(held.rollup.missingAcks).toEqual(["plan", "followups"]);

      const done = receipt(build(), policyWith({ plan: true, followups: true, block: true }));
      expect(done.rollup.verdict).toBe("completed");
      expect(done.rollup.reasons).toEqual(["block-acknowledged"]);
    });
  }

  it("a monitor / investigation ack on a block plan is a contradiction (blocked), even fully acked", () => {
    const { rollup } = receipt(
      blockedPlan(),
      policyWith({ plan: true, followups: true, block: true, monitor: true }),
    );
    expect(rollup.verdict).toBe("blocked");
    expect(rollup.mismatchedAcks).toContain("monitor");
    expect(rollup.reasons).toContain("acknowledgement-mismatch");
  });
});

describe("release-decision-action-receipt reduce — acknowledgement checklist", () => {
  it("marks each ack required / supplied / satisfied for the resolved class", () => {
    const { acknowledgements } = receipt(watchMonitorPlan(), policyWith({ plan: true, monitor: true }));
    const byId = Object.fromEntries(acknowledgements.map((a) => [a.id, a]));
    expect(byId.plan).toMatchObject({ required: true, supplied: true, satisfied: true });
    expect(byId.followups).toMatchObject({ required: true, supplied: false, satisfied: false });
    expect(byId.monitor).toMatchObject({ required: true, supplied: true, satisfied: true });
    expect(byId.investigation).toMatchObject({ required: false, supplied: false, satisfied: true });
    expect(byId.block).toMatchObject({ required: false, supplied: false, satisfied: true });
  });

  it("emits all five acknowledgements in canonical order", () => {
    const { acknowledgements } = receipt(clearPlan(), policyWith({ plan: true }));
    expect(acknowledgements.map((a) => a.id)).toEqual(["plan", "followups", "monitor", "investigation", "block"]);
  });
});

describe("release-decision-action-receipt reduce — severity bookkeeping", () => {
  it("counts severities and keeps reasons in canonical superset order", () => {
    const { rollup } = receipt(blockedPlan(), policyWith({ plan: true, monitor: true }));
    // block-not-acknowledged (blocking) + acknowledgement-mismatch (blocking) both fire.
    expect(rollup.blocking).toBe(2);
    expect(rollup.reasons).toEqual(["block-not-acknowledged", "acknowledgement-mismatch"]);
  });

  it("a non-plan decoy folds through ingest to incomplete", () => {
    const { rollup } = receipt(notAPlan(), policyWith({ plan: true }));
    expect(rollup.verdict).toBe("incomplete");
    expect(rollup.reasons).toEqual(["plan-unreadable"]);
  });

  it("acks() helper builds an all-false set overridable per-key", () => {
    expect(acks()).toEqual({ plan: false, followups: false, monitor: false, investigation: false, block: false });
    expect(acks({ plan: true }).plan).toBe(true);
  });
});
