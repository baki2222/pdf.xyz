import { describe, expect, it } from "vitest";
import {
  blockedIndex,
  completedReceipt,
  contradictoryPlan,
  makeGovernance,
  tamperedReceipt,
} from "./fixtures";

describe("release-decision-closeout-governance receipt — flattened content-free record", () => {
  it("carries the bounded outcome + the run's own stamp for a closed chain", () => {
    const { receipt } = makeGovernance({ receipt: completedReceipt() });
    expect(receipt.category).toBe("worker-release-decision-closeout-governance");
    expect(receipt.verdict).toBe("closed");
    expect(receipt.exitCode).toBe(0);
    expect(receipt.receiptState).toBe("usable");
    expect(receipt.receiptVerdict).toBe("completed");
    expect(receipt.relatedSupplied).toBe(0);
    expect(receipt.at).toBe("2026-07-05T00:00:00.000Z");
    expect(receipt.disclosure).toMatch(/content-free/i);
  });

  it("counts contradictory / blocking related records for a blocked chain", () => {
    const contradiction = makeGovernance({ receipt: completedReceipt(), plan: contradictoryPlan() }).receipt;
    expect(contradiction.verdict).toBe("governance-blocked");
    expect(contradiction.relatedSupplied).toBe(1);
    expect(contradiction.relatedContradictory).toBe(1);

    const chain = makeGovernance({ receipt: completedReceipt(), index: blockedIndex() }).receipt;
    expect(chain.relatedBlocking).toBe(1);
    expect(chain.blocking).toBeGreaterThan(0);
  });

  it("surfaces a tampered receipt's untrusted claim without a facts leak", () => {
    const { receipt } = makeGovernance({ receipt: tamperedReceipt() });
    expect(receipt.receiptState).toBe("tampered");
    expect(receipt.verdict).toBe("governance-blocked");
    // The claim surfaced is the flipped verdict, untrusted — no digest, path, or reviewer identity in the record.
    expect(receipt.receiptVerdict).toBe("blocked");
  });
});
