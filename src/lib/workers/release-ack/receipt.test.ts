import { describe, expect, it } from "vitest";
import { buildAckReceipt } from "./receipt";
import { reduceAckSource } from "./reduce";
import { computeAckRollup } from "./rollup";
import { buildAcknowledgement } from "./reduce";
import { ingestAckFrom, NOW, blockedPack, publishablePack } from "./fixtures";
import { RELEASE_ACK_POLICY_ID, RELEASE_ACK_POLICY_VERSION } from "./types";

/** Build a receipt over a pack + decision. */
function receiptOf(pack: unknown, decision: Parameters<typeof buildAcknowledgement>[0]) {
  const source = reduceAckSource(ingestAckFrom(pack));
  const ack = buildAcknowledgement(decision, "unknown", "none", false);
  const { rollup } = computeAckRollup(source, ack);
  return buildAckReceipt(NOW, source, rollup);
}

describe("buildAckReceipt — ack verdict + source pack verdict/disclosure + source counts only", () => {
  it("flattens the acknowledged outcome over a publishable pack", () => {
    expect(receiptOf(publishablePack(), "accepted")).toEqual({
      category: "worker-release-ack",
      policyId: RELEASE_ACK_POLICY_ID,
      policyVersion: RELEASE_ACK_POLICY_VERSION,
      at: NOW,
      verdict: "acknowledged",
      exitCode: 0,
      packVerdict: "publishable",
      packDisclosure: "share-safe",
      sourcesSupplied: 5,
      sourcesUsable: 5,
    });
  });

  it("records a rejected verdict over a blocked pack", () => {
    const r = receiptOf(blockedPack(), "accepted");
    expect(r.verdict).toBe("rejected");
    expect(r.exitCode).toBe(4);
    expect(r.packVerdict).toBe("blocked");
    expect(r.packDisclosure).toBe("blocked");
  });

  it("carries only bounded keys (no decision, reviewer, prose, or locator field)", () => {
    const keys = Object.keys(receiptOf(publishablePack(), "accepted")).sort();
    expect(keys).toEqual(
      [
        "at",
        "category",
        "exitCode",
        "packDisclosure",
        "packVerdict",
        "policyId",
        "policyVersion",
        "sourcesSupplied",
        "sourcesUsable",
        "verdict",
      ].sort(),
    );
  });
});
