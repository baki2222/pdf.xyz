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
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptPolicy } from "./types";

/** Drive the fold over an ingested plan object + policy. */
function receipt(obj: unknown, policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptPolicy) {
  return computeReceipt(ingestPlanObj(obj), policy);
}

describe("finalize-index-trend-finalize-index-trend-action-receipt reduce — untrustworthy plan DOCUMENT ⇒ invalid", () => {
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
      policyWith({ plan: true, followups: true, monitor: true, investigation: true, block: true }),
    );
    expect(rollup.verdict).toBe("invalid");
    expect(rollup.exitCode).toBe(4);
    expect(rollup.reasons).toContain("plan-tampered");
  });

  it("a non-plan decoy folds through ingest to invalid", () => {
    const { rollup } = receipt(notAPlan(), policyWith({ plan: true }));
    expect(rollup.verdict).toBe("invalid");
    expect(rollup.reasons).toEqual(["plan-unreadable"]);
  });

  it("sourceStateOf reflects recognized / usable", () => {
    expect(sourceStateOf(UNRECOGNIZED_PLAN)).toBe("unreadable");
    expect(sourceStateOf(ingestPlanObj(tamperedPlan()))).toBe("tampered");
    expect(sourceStateOf(ingestPlanObj(clearPlan()))).toBe("usable");
  });
});

describe("finalize-index-trend-finalize-index-trend-action-receipt reduce — a plan whose OWN verdict is `invalid` ⇒ block class (held, not an invalid receipt)", () => {
  for (const build of [invalidPlan, invalidPlanFromTampered]) {
    it(`${build.name}: unacknowledged is blocked, fully-acknowledged-as-held is completed (release still held)`, () => {
      const held = receipt(build(), policyWith({}));
      expect(held.rollup.verdict, build.name).toBe("blocked");
      expect(held.rollup.planClass).toBe("block");
      expect(held.rollup.reasons).toContain("block-not-acknowledged");

      const acked = receipt(build(), policyWith({ plan: true, followups: true, block: true }));
      expect(acked.rollup.verdict, build.name).toBe("completed");
      expect(acked.rollup.exitCode).toBe(0);
      expect(acked.rollup.planClass).toBe("block");
      expect(acked.rollup.reasons).toEqual(["block-acknowledged"]);
    });
  }
});

describe("finalize-index-trend-finalize-index-trend-action-receipt reduce — clear class", () => {
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

  it("--ack-followups on a clear plan is harmless (not required, not a contradiction) — still completed", () => {
    const { rollup } = receipt(clearPlan(), policyWith({ plan: true, followups: true }));
    expect(rollup.verdict).toBe("completed");
    expect(rollup.mismatchedAcks).toEqual([]);
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
});

describe("finalize-index-trend-finalize-index-trend-action-receipt reduce — monitor class (reviewed-but-open ⇒ followup-open)", () => {
  it("reviewed-but-unacked is FOLLOWUP-OPEN (exit 3); full acks complete it", () => {
    const open = receipt(monitorPlan(), policyWith({ plan: true }));
    expect(open.rollup.verdict).toBe("followup-open");
    expect(open.rollup.exitCode).toBe(3);
    expect(open.rollup.reasons).toContain("monitor-followup-open");
    expect(open.rollup.missingAcks).toEqual(["followups", "monitor"]);

    const done = receipt(monitorPlan(), policyWith({ plan: true, monitor: true, followups: true }));
    expect(done.rollup.verdict).toBe("completed");
    expect(done.rollup.reasons).toEqual(["monitor-followups-acknowledged"]);
  });

  it("no --ack-plan is incomplete (not yet reviewed), never followup-open", () => {
    const { rollup } = receipt(monitorPlan(), policyWith({ monitor: true, followups: true }));
    expect(rollup.verdict).toBe("incomplete");
    expect(rollup.exitCode).toBe(2);
    expect(rollup.reasons).toContain("plan-not-exercised");
  });

  it("--ack-monitor without --ack-followups stays followup-open", () => {
    const { rollup } = receipt(monitorPlan(), policyWith({ plan: true, monitor: true }));
    expect(rollup.verdict).toBe("followup-open");
    expect(rollup.reasons).toContain("monitor-followup-open");
    expect(rollup.missingAcks).toEqual(["followups"]);
  });

  it("--strict-open escalates an open monitor follow-up to blocked (and records the escalation)", () => {
    const { rollup } = receipt(monitorPlan(), policyWith({ plan: true }, true));
    expect(rollup.verdict).toBe("blocked");
    expect(rollup.exitCode).toBe(4);
    expect(rollup.strictOpenEscalated).toBe(true);
    expect(rollup.strictOpenEscalatedFrom).toBe("followup-open");
    expect(rollup.reasons).toContain("strict-open-escalation");
  });

  it("--strict-open never escalates a completed monitor receipt, nor a plan-not-reviewed incomplete", () => {
    const done = receipt(monitorPlan(), policyWith({ plan: true, monitor: true, followups: true }, true));
    expect(done.rollup.verdict).toBe("completed");
    expect(done.rollup.strictOpenEscalated).toBe(false);

    const inc = receipt(monitorPlan(), policyWith({ monitor: true, followups: true }, true));
    expect(inc.rollup.verdict).toBe("incomplete");
    expect(inc.rollup.strictOpenEscalated).toBe(false);
  });

  it("a block ack on a monitor plan is a contradiction (blocked)", () => {
    const { rollup } = receipt(monitorPlan(), policyWith({ plan: true, monitor: true, followups: true, block: true }));
    expect(rollup.verdict).toBe("blocked");
    expect(rollup.mismatchedAcks).toContain("block");
  });
});

describe("finalize-index-trend-finalize-index-trend-action-receipt reduce — investigate class (reviewed-but-open ⇒ followup-open)", () => {
  it("reviewed-but-unacked is FOLLOWUP-OPEN (exit 3); full acks complete it", () => {
    const open = receipt(investigatePlan(), policyWith({ plan: true }));
    expect(open.rollup.verdict).toBe("followup-open");
    expect(open.rollup.exitCode).toBe(3);
    expect(open.rollup.reasons).toContain("investigation-open");
    expect(open.rollup.missingAcks).toEqual(["followups", "investigation"]);

    const done = receipt(investigatePlan(), policyWith({ plan: true, investigation: true, followups: true }));
    expect(done.rollup.verdict).toBe("completed");
    expect(done.rollup.reasons).toEqual(["investigation-acknowledged"]);
  });

  it("--strict-open escalates an open investigate follow-up to blocked", () => {
    const { rollup } = receipt(investigatePlan(), policyWith({ plan: true }, true));
    expect(rollup.verdict).toBe("blocked");
    expect(rollup.strictOpenEscalated).toBe(true);
    expect(rollup.strictOpenEscalatedFrom).toBe("followup-open");
  });

  it("a block ack on an investigate plan is a contradiction (blocked)", () => {
    const { rollup } = receipt(
      investigatePlan(),
      policyWith({ plan: true, investigation: true, followups: true, block: true }),
    );
    expect(rollup.verdict).toBe("blocked");
    expect(rollup.mismatchedAcks).toContain("block");
  });
});

describe("finalize-index-trend-finalize-index-trend-action-receipt reduce — block class (held; --ack-block gates the ladder)", () => {
  for (const build of [blockPlan, strictWatchBlockPlan, requireCleanBlockPlan]) {
    it(`${build.name}: missing --ack-block ⇒ blocked; held-incomplete ⇒ incomplete; fully-acked ⇒ completed (release held)`, () => {
      const notBlocked = receipt(build(), policyWith({ plan: true, followups: true }));
      expect(notBlocked.rollup.verdict, build.name).toBe("blocked");
      expect(notBlocked.rollup.exitCode).toBe(4);
      expect(notBlocked.rollup.reasons).toContain("block-not-acknowledged");

      const held = receipt(build(), policyWith({ block: true }));
      expect(held.rollup.verdict, build.name).toBe("incomplete");
      expect(held.rollup.exitCode).toBe(2);
      expect(held.rollup.reasons).toEqual(["block-acknowledgement-incomplete"]);
      expect(held.rollup.missingAcks).toEqual(["plan", "followups"]);

      const acked = receipt(build(), policyWith({ plan: true, followups: true, block: true }));
      expect(acked.rollup.verdict, build.name).toBe("completed");
      expect(acked.rollup.exitCode).toBe(0);
      expect(acked.rollup.reasons).toEqual(["block-acknowledged"]);
    });
  }

  it("a monitor / investigation ack on a block plan is a contradiction (still blocked)", () => {
    for (const bad of ["monitor", "investigation"] as const) {
      const { rollup } = receipt(blockPlan(), policyWith({ plan: true, followups: true, block: true, [bad]: true }));
      expect(rollup.verdict, `--ack-${bad} on block`).toBe("blocked");
      expect(rollup.mismatchedAcks).toContain(bad);
      expect(rollup.reasons).toContain("acknowledgement-mismatch");
    }
  });
});

describe("finalize-index-trend-finalize-index-trend-action-receipt reduce — acknowledgement checklist", () => {
  it("marks each ack required / supplied / satisfied for the resolved class", () => {
    const { acknowledgements } = receipt(monitorPlan(), policyWith({ plan: true, monitor: true }));
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

describe("finalize-index-trend-finalize-index-trend-action-receipt reduce — reasons + next-actions bookkeeping", () => {
  it("counts severities and keeps reasons in canonical superset order", () => {
    const { rollup } = receipt(blockPlan(), policyWith({ plan: true, followups: true, block: true, monitor: true }));
    // block-acknowledged (informational) + acknowledgement-mismatch (blocking) both fire, in canonical order.
    expect(rollup.blocking).toBe(1);
    expect(rollup.informational).toBe(1);
    expect(rollup.verdict).toBe("blocked");
    expect(rollup.reasons).toEqual(["acknowledgement-mismatch", "block-acknowledged"]);
  });

  it("derives bounded next-action ids per verdict", () => {
    expect(receipt(clearPlan(), policyWith({ plan: true })).nextActions).toEqual(["keep-action-receipt"]);
    expect(receipt(clearPlan(), policyWith({})).nextActions).toEqual(["supply-missing-ack", "keep-action-receipt"]);
    expect(receipt(notAPlan(), policyWith({})).nextActions).toEqual(["recover-valid-plan", "keep-action-receipt"]);
    expect(receipt(blockPlan(), policyWith({ plan: true, followups: true, block: true })).nextActions).toEqual([
      "hold-promotion",
      "keep-action-receipt",
    ]);
    expect(receipt(clearPlan(), policyWith({ plan: true, block: true })).nextActions).toContain("resolve-contradiction");
  });

  it("acks() helper builds an all-false set overridable per-key", () => {
    expect(acks()).toEqual({
      plan: false,
      followups: false,
      monitor: false,
      investigation: false,
      block: false,
    });
    expect(acks({ plan: true }).plan).toBe(true);
  });
});
