import { describe, expect, it } from "vitest";
import { buildAckResult } from "./build";
import {
  blockedPack,
  incompletePack,
  ingestAckFrom,
  makeAck,
  notAPack,
  NOW,
  publishablePack,
  reviewPack,
  tamperedPack,
  type AckInputs,
} from "./fixtures";

/** Acknowledge a pack with the given inputs and return {verdict, exitCode}. */
function ack(pack: unknown, inputs: AckInputs = {}) {
  const r = makeAck(pack, inputs);
  return { verdict: r.ack.verdict, exit: r.ack.exitCode, reasons: r.ack.reasons, rollup: r.ack, source: r.source };
}

describe("computeAckRollup — the clean acknowledged path", () => {
  it("accepted over a publishable pack, no note → acknowledged (exit 0)", () => {
    const r = ack(publishablePack(), { decision: "accepted" });
    expect(r.verdict).toBe("acknowledged");
    expect(r.exit).toBe(0);
    expect(r.reasons).toEqual([]);
    expect(r.rollup.acknowledged).toBe(true);
    expect(r.source.packVerdict).toBe("publishable");
    expect(r.source.disclosure).toBe("share-safe");
  });
});

describe("computeAckRollup — advisory (acknowledged-with-followup, exit 3)", () => {
  it("accepted-with-notes over a publishable pack", () => {
    const r = ack(publishablePack(), { decision: "accepted-with-notes" });
    expect(r.verdict).toBe("acknowledged-with-followup");
    expect(r.exit).toBe(3);
    expect(r.reasons).toContain("decision-accepted-with-notes");
  });

  it("accepted over a REVIEW pack", () => {
    const r = ack(reviewPack(), { decision: "accepted" });
    expect(r.verdict).toBe("acknowledged-with-followup");
    expect(r.exit).toBe(3);
    expect(r.reasons).toContain("pack-review");
  });

  it("accepted over a publishable pack WITH a note class", () => {
    const r = ack(publishablePack(), { decision: "accepted", note: "security-review" });
    expect(r.verdict).toBe("acknowledged-with-followup");
    expect(r.reasons).toContain("note-followup");
  });
});

describe("computeAckRollup — insufficient (deferred, exit 2)", () => {
  it("a deferred decision over a publishable pack", () => {
    const r = ack(publishablePack(), { decision: "deferred" });
    expect(r.verdict).toBe("deferred");
    expect(r.exit).toBe(2);
    expect(r.reasons).toContain("decision-deferred");
  });

  it("accepted over an INCOMPLETE pack", () => {
    const r = ack(incompletePack(), { decision: "accepted" });
    expect(r.verdict).toBe("deferred");
    expect(r.exit).toBe(2);
    expect(r.reasons).toContain("pack-incomplete");
  });
});

describe("computeAckRollup — blocking (rejected, exit 4)", () => {
  it("a rejected decision over a publishable pack", () => {
    const r = ack(publishablePack(), { decision: "rejected" });
    expect(r.verdict).toBe("rejected");
    expect(r.exit).toBe(4);
    expect(r.reasons).toContain("decision-rejected");
  });

  it("a needs-changes decision over a publishable pack", () => {
    const r = ack(publishablePack(), { decision: "needs-changes" });
    expect(r.verdict).toBe("rejected");
    expect(r.reasons).toContain("decision-needs-changes");
  });

  it("accepted over a BLOCKED pack", () => {
    const r = ack(blockedPack(), { decision: "accepted" });
    expect(r.verdict).toBe("rejected");
    expect(r.reasons).toContain("pack-blocked");
  });

  it("blocking dominates insufficient: deferred over a blocked pack → rejected", () => {
    const r = ack(blockedPack(), { decision: "deferred" });
    expect(r.verdict).toBe("rejected");
    expect(r.reasons).toEqual(expect.arrayContaining(["pack-blocked", "decision-deferred"]));
  });
});

describe("computeAckRollup — invalid input dominates everything (exit 4)", () => {
  it("a tampered pack → invalid, even with an accepted decision (never a vacuous pass)", () => {
    const r = ack(tamperedPack(), { decision: "accepted" });
    expect(r.verdict).toBe("invalid");
    expect(r.exit).toBe(4);
    expect(r.reasons).toContain("pack-tampered");
    expect(r.source.state).toBe("tampered");
  });

  it("an unreadable pack → invalid", () => {
    const r = ack(notAPack(), { decision: "accepted" });
    expect(r.verdict).toBe("invalid");
    expect(r.reasons).toContain("pack-unreadable");
    expect(r.source.state).toBe("unreadable");
  });

  it("invalid dominates a blocking decision: rejected decision over a tampered pack → invalid", () => {
    const r = ack(tamperedPack(), { decision: "rejected" });
    expect(r.verdict).toBe("invalid");
  });

  it("a not-supplied pack → pack-missing → invalid (defensive; the CLI requires a pack)", () => {
    // The CLI always supplies a pack, but the fold must fail closed on an absent source too.
    const r = buildAckResult(NOW, ingestAckFrom(undefined, false), "accepted", "unknown", "none", false);
    expect(r.ack.verdict).toBe("invalid");
    expect(r.ack.reasons).toContain("pack-missing");
    expect(r.source.state).toBe("absent");
  });
});

describe("computeAckRollup — --strict (only accepted over publishable passes)", () => {
  it("accepted over a publishable pack still passes under strict (exit 0)", () => {
    const r = ack(publishablePack(), { decision: "accepted", strict: true });
    expect(r.verdict).toBe("acknowledged");
    expect(r.exit).toBe(0);
    expect(r.rollup.strictEscalated).toBe(false);
  });

  it("escalates acknowledged-with-followup → rejected (from advisory)", () => {
    const r = ack(publishablePack(), { decision: "accepted-with-notes", strict: true });
    expect(r.verdict).toBe("rejected");
    expect(r.exit).toBe(4);
    expect(r.rollup.strictEscalated).toBe(true);
    expect(r.rollup.strictEscalatedFrom).toBe("acknowledged-with-followup");
  });

  it("escalates deferred → rejected (from a deferred decision)", () => {
    const r = ack(publishablePack(), { decision: "deferred", strict: true });
    expect(r.verdict).toBe("rejected");
    expect(r.rollup.strictEscalatedFrom).toBe("deferred");
  });

  it("escalates an incomplete pack (deferred posture) → rejected", () => {
    const r = ack(incompletePack(), { decision: "accepted", strict: true });
    expect(r.verdict).toBe("rejected");
    expect(r.rollup.strictEscalatedFrom).toBe("deferred");
  });

  it("does NOT escalate an already-rejected posture (no escalation flag)", () => {
    const r = ack(publishablePack(), { decision: "rejected", strict: true });
    expect(r.verdict).toBe("rejected");
    expect(r.rollup.strictEscalated).toBe(false);
    expect(r.rollup.strictEscalatedFrom).toBeNull();
  });

  it("does NOT touch an invalid input (tampered pack stays invalid, no escalation)", () => {
    const r = ack(tamperedPack(), { decision: "accepted", strict: true });
    expect(r.verdict).toBe("invalid");
    expect(r.rollup.strictEscalated).toBe(false);
  });
});

describe("computeAckRollup — reasons are canonical + counts consistent", () => {
  it("emits reasons in canonical order and counts them by severity", () => {
    const r = makeAck(reviewPack(), { decision: "accepted-with-notes", note: "policy-follow-up" });
    // pack-review + decision-accepted-with-notes + note-followup are all advisory → acknowledged-with-followup.
    expect(r.ack.advisories).toBe(3);
    expect(r.ack.blocking).toBe(0);
    expect(r.ack.invalidInputs).toBe(0);
    expect(r.ack.verdict).toBe("acknowledged-with-followup");
    // Canonical order: pack-review precedes decision-accepted-with-notes precedes note-followup.
    expect(r.ack.reasons).toEqual(["pack-review", "decision-accepted-with-notes", "note-followup"]);
  });

  it("records hasFollowup for accepted-with-notes and for a note class", () => {
    expect(makeAck(publishablePack(), { decision: "accepted-with-notes" }).acknowledgement.hasFollowup).toBe(true);
    expect(makeAck(publishablePack(), { decision: "accepted", note: "evidence-gap" }).acknowledgement.hasFollowup).toBe(true);
    expect(makeAck(publishablePack(), { decision: "accepted" }).acknowledgement.hasFollowup).toBe(false);
  });
});
