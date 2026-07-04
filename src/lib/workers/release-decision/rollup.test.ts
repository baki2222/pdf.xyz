// @vitest-environment node
/**
 * Rollup policy proofs for the release decision record ledger (Phase 59): the fold over a publish pack + an
 * acknowledgement of it (both re-validated, then cross-checked) into the ONE composite decision + exit code a release
 * ledger acts on. Drives the REAL modules over genuinely coherent fixtures, so every branch of the fail-closed
 * precedence (invalid > blocking > insufficient > advisory > ready) and the `--strict` escalation is pinned.
 */

import { describe, expect, it } from "vitest";
import {
  ackFor,
  acknowledgedAck,
  blockedPack,
  incompletePack,
  makeDecision,
  notAPack,
  notAnAck,
  publishablePack,
  reviewPack,
  tamperAck,
  tamperedPack,
} from "./fixtures";
import { RELEASE_DECISION_EXIT } from "./types";

describe("release-decision rollup — proceed", () => {
  it("a publishable pack + a clean accepted acknowledgement of it → proceed (exit 0), cross-check match", () => {
    const r = makeDecision(publishablePack(), acknowledgedAck());
    expect(r.decision.decision).toBe("proceed");
    expect(r.decision.exitCode).toBe(RELEASE_DECISION_EXIT.PROCEED);
    expect(r.decision.proceed).toBe(true);
    expect(r.decision.reasons).toEqual([]);
    expect(r.crossCheck.status).toBe("match");
    expect(r.publishPack.verdict).toBe("publishable");
    expect(r.acknowledgement.decision).toBe("accepted");
  });
});

describe("release-decision rollup — advisory (proceed-with-followup / hold)", () => {
  it("accepted-with-notes over a publishable pack → proceed-with-followup (exit 3)", () => {
    const r = makeDecision(
      publishablePack(),
      ackFor(publishablePack(), { decision: "accepted-with-notes" }),
    );
    expect(r.decision.decision).toBe("proceed-with-followup");
    expect(r.decision.exitCode).toBe(RELEASE_DECISION_EXIT.ADVISORY);
    expect(r.decision.reasons).toContain("ack-accepted-with-notes");
    expect(r.crossCheck.status).toBe("match");
  });

  it("a note class over a publishable pack → proceed-with-followup (exit 3)", () => {
    const r = makeDecision(
      publishablePack(),
      ackFor(publishablePack(), {
        decision: "accepted",
        note: "security-review",
      }),
    );
    expect(r.decision.decision).toBe("proceed-with-followup");
    expect(r.decision.reasons).toContain("ack-note-followup");
  });

  it("a review pack accepted → hold (exit 3), pack-review drives the hold", () => {
    const r = makeDecision(
      reviewPack(),
      ackFor(reviewPack(), { decision: "accepted" }),
    );
    expect(r.decision.decision).toBe("hold");
    expect(r.decision.exitCode).toBe(RELEASE_DECISION_EXIT.ADVISORY);
    expect(r.decision.reasons).toContain("pack-review");
    expect(r.crossCheck.status).toBe("match");
  });

  it("a review pack accepted-with-notes → hold (a needs-review pack dominates a mere follow-up)", () => {
    const r = makeDecision(
      reviewPack(),
      ackFor(reviewPack(), { decision: "accepted-with-notes" }),
    );
    expect(r.decision.decision).toBe("hold");
    expect(r.decision.reasons).toEqual(
      expect.arrayContaining(["pack-review", "ack-accepted-with-notes"]),
    );
  });
});

describe("release-decision rollup — insufficient", () => {
  it("an incomplete pack accepted → insufficient (exit 2)", () => {
    const r = makeDecision(
      incompletePack(),
      ackFor(incompletePack(), { decision: "accepted" }),
    );
    expect(r.decision.decision).toBe("insufficient");
    expect(r.decision.exitCode).toBe(RELEASE_DECISION_EXIT.INSUFFICIENT);
    expect(r.decision.reasons).toContain("pack-incomplete");
  });

  it("a deferred acknowledgement over a publishable pack → insufficient (exit 2)", () => {
    const r = makeDecision(
      publishablePack(),
      ackFor(publishablePack(), { decision: "deferred" }),
    );
    expect(r.decision.decision).toBe("insufficient");
    expect(r.decision.reasons).toContain("ack-deferred");
    expect(r.crossCheck.status).toBe("match");
  });
});

describe("release-decision rollup — reject (blocking)", () => {
  it("a rejected acknowledgement → reject (exit 4)", () => {
    const r = makeDecision(
      publishablePack(),
      ackFor(publishablePack(), { decision: "rejected" }),
    );
    expect(r.decision.decision).toBe("reject");
    expect(r.decision.exitCode).toBe(RELEASE_DECISION_EXIT.REJECT);
    expect(r.decision.reasons).toContain("ack-rejected");
  });

  it("a needs-changes acknowledgement → reject (exit 4)", () => {
    const r = makeDecision(
      publishablePack(),
      ackFor(publishablePack(), { decision: "needs-changes" }),
    );
    expect(r.decision.decision).toBe("reject");
    expect(r.decision.reasons).toContain("ack-needs-changes");
  });

  it("a blocked pack → reject (exit 4), pack-blocked fires", () => {
    const r = makeDecision(
      blockedPack(),
      ackFor(blockedPack(), { decision: "accepted" }),
    );
    expect(r.decision.decision).toBe("reject");
    expect(r.decision.reasons).toContain("pack-blocked");
    expect(r.crossCheck.status).toBe("match");
  });
});

describe("release-decision rollup — invalid (never a vacuous pass)", () => {
  it("a tampered pack → invalid (exit 4)", () => {
    const r = makeDecision(tamperedPack(), acknowledgedAck());
    expect(r.decision.decision).toBe("invalid");
    expect(r.decision.exitCode).toBe(RELEASE_DECISION_EXIT.INVALID);
    expect(r.decision.reasons).toContain("pack-tampered");
    expect(r.crossCheck.status).toBe("unknown");
  });

  it("a non-pack input → invalid (pack-unreadable)", () => {
    const r = makeDecision(notAPack(), acknowledgedAck());
    expect(r.decision.decision).toBe("invalid");
    expect(r.decision.reasons).toContain("pack-unreadable");
  });

  it("a tampered acknowledgement → invalid (ack-tampered)", () => {
    const r = makeDecision(publishablePack(), tamperAck(acknowledgedAck()));
    expect(r.decision.decision).toBe("invalid");
    expect(r.decision.reasons).toContain("ack-tampered");
    expect(r.crossCheck.status).toBe("unknown");
  });

  it("a non-ack input → invalid (ack-unreadable)", () => {
    const r = makeDecision(publishablePack(), notAnAck());
    expect(r.decision.decision).toBe("invalid");
    expect(r.decision.reasons).toContain("ack-unreadable");
  });

  it("an acknowledgement of a DIFFERENT pack → invalid via cross-check mismatch (exit 4)", () => {
    // Both documents are individually self-consistent, but the acknowledgement acknowledged a REVIEW pack while a
    // PUBLISHABLE pack is supplied — the pair is incoherent.
    const r = makeDecision(
      publishablePack(),
      ackFor(reviewPack(), { decision: "accepted" }),
    );
    expect(r.decision.decision).toBe("invalid");
    expect(r.crossCheck.status).toBe("mismatch");
    expect(r.decision.reasons).toEqual(["cross-check-mismatch"]);
  });

  it("an acknowledgement of an unreadable pack does not match a real supplied pack → mismatch/invalid", () => {
    // The ack acknowledged a non-pack (its recorded source is `unreadable`, ack verdict `invalid`); paired with a real
    // publishable pack, the recorded source state is not `usable` ⇒ mismatch.
    const r = makeDecision(
      publishablePack(),
      ackFor(notAPack(), { decision: "accepted" }),
    );
    expect(r.decision.decision).toBe("invalid");
    expect(r.crossCheck.status).toBe("mismatch");
    expect(r.acknowledgement.recordedPackState).toBe("unreadable");
  });

  it("a not-supplied document is invalid, never a vacuous pass", () => {
    const r = makeDecision(undefined, acknowledgedAck(), {
      packSupplied: false,
    });
    expect(r.decision.decision).toBe("invalid");
    expect(r.decision.reasons).toContain("pack-missing");
    expect(r.publishPack.state).toBe("absent");
  });
});

describe("release-decision rollup — --strict escalation", () => {
  it("a clean proceed is untouched by --strict", () => {
    const r = makeDecision(publishablePack(), acknowledgedAck(), {
      strict: true,
    });
    expect(r.decision.decision).toBe("proceed");
    expect(r.decision.strictEscalated).toBe(false);
  });

  it("--strict escalates proceed-with-followup → reject (exit 4)", () => {
    const r = makeDecision(
      publishablePack(),
      ackFor(publishablePack(), { decision: "accepted-with-notes" }),
      { strict: true },
    );
    expect(r.decision.decision).toBe("reject");
    expect(r.decision.exitCode).toBe(RELEASE_DECISION_EXIT.REJECT);
    expect(r.decision.strictEscalated).toBe(true);
    expect(r.decision.strictEscalatedFrom).toBe("proceed-with-followup");
  });

  it("--strict escalates hold → reject", () => {
    const r = makeDecision(
      reviewPack(),
      ackFor(reviewPack(), { decision: "accepted" }),
      { strict: true },
    );
    expect(r.decision.decision).toBe("reject");
    expect(r.decision.strictEscalatedFrom).toBe("hold");
  });

  it("--strict escalates insufficient → reject", () => {
    const r = makeDecision(
      incompletePack(),
      ackFor(incompletePack(), { decision: "accepted" }),
      { strict: true },
    );
    expect(r.decision.decision).toBe("reject");
    expect(r.decision.strictEscalatedFrom).toBe("insufficient");
  });

  it("--strict does not touch an already-invalid pair", () => {
    const r = makeDecision(
      publishablePack(),
      ackFor(reviewPack(), { decision: "accepted" }),
      { strict: true },
    );
    expect(r.decision.decision).toBe("invalid");
    expect(r.decision.strictEscalated).toBe(false);
  });
});
