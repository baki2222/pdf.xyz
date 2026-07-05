import { describe, expect, it } from "vitest";
import {
  blockedIndex,
  completedReceipt,
  contradictoryPlan,
  makeGovernanceFinalize,
  tamperedReceipt,
} from "./fixtures";

describe("release-decision-closeout-governance-finalize receipt — flattened content-free record", () => {
  it("carries the bounded outcome + the run's own stamp for a finalized chain", () => {
    const { receipt } = makeGovernanceFinalize({ receipt: completedReceipt() });
    expect(receipt.category).toBe("worker-release-decision-closeout-governance-finalize");
    expect(receipt.verdict).toBe("finalized");
    expect(receipt.exitCode).toBe(0);
    expect(receipt.receiptState).toBe("usable");
    expect(receipt.receiptVerdict).toBe("completed");
    expect(receipt.relatedSupplied).toBe(0);
    expect(receipt.at).toBe("2026-07-05T00:00:00.000Z");
    expect(receipt.disclosure).toMatch(/content-free/i);
  });

  it("counts contradictory / blocking related records for a blocked chain", () => {
    const contradiction = makeGovernanceFinalize({
      receipt: completedReceipt(),
      plan: contradictoryPlan(),
    }).receipt;
    expect(contradiction.verdict).toBe("finalize-blocked");
    expect(contradiction.relatedSupplied).toBe(1);
    expect(contradiction.relatedContradictory).toBe(1);

    const chain = makeGovernanceFinalize({ receipt: completedReceipt(), index: blockedIndex() }).receipt;
    expect(chain.relatedBlocking).toBe(1);
    expect(chain.blocking).toBeGreaterThan(0);
  });

  it("surfaces a tampered receipt's untrusted claim without a facts leak", () => {
    const { receipt } = makeGovernanceFinalize({ receipt: tamperedReceipt() });
    expect(receipt.receiptState).toBe("tampered");
    expect(receipt.verdict).toBe("finalize-blocked");
    // The claim surfaced is the flipped verdict, untrusted — no digest, path, or reviewer identity in the record.
    expect(receipt.receiptVerdict).toBe("blocked");
  });
});
