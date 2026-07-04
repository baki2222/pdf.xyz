// @vitest-environment node
/**
 * Renderer proofs for the release decision record ledger (Phase 59): both stable formats over the one result, each
 * content-free by construction (the result already carries no ingested free text).
 */

import { describe, expect, it } from "vitest";
import { renderReleaseDecision, renderReleaseDecisionJson } from "./render";
import {
  ackFor,
  acknowledgedAck,
  makeDecision,
  publishablePack,
  reviewPack,
} from "./fixtures";

describe("renderReleaseDecision — json", () => {
  it("round-trips the result and pins the schema", () => {
    const result = makeDecision(publishablePack(), acknowledgedAck());
    const parsed = JSON.parse(renderReleaseDecision(result, "json"));
    expect(parsed.schema).toBe("pdfxyz.release-decision/1");
    expect(parsed.decision.decision).toBe("proceed");
    expect(parsed.crossCheck.status).toBe("match");
    expect(parsed.receipt.category).toBe("worker-release-decision");
  });

  it("compact JSON has no newlines except the trailing one", () => {
    const result = makeDecision(publishablePack(), acknowledgedAck());
    const compact = renderReleaseDecisionJson(result, false);
    expect(compact.endsWith("\n")).toBe(true);
    expect(compact.trimEnd().includes("\n")).toBe(false);
  });
});

describe("renderReleaseDecision — text", () => {
  it("renders the ledger-friendly sections with the decision + cross-check", () => {
    const result = makeDecision(
      reviewPack(),
      ackFor(reviewPack(), { decision: "accepted" }),
    );
    const text = renderReleaseDecision(result, "text");
    expect(text).toMatch(/pdf\.xyz release decision record/);
    expect(text).toContain("DECISION: HOLD (exit 3)");
    expect(text).toContain("PUBLISH PACK");
    expect(text).toContain("ACKNOWLEDGEMENT");
    expect(text).toContain("CROSS-CHECK: MATCH");
    expect(text).toContain("NEXT ACTIONS");
    expect(text).toContain("CAVEATS");
  });

  it("prints the reasons for a non-proceed decision", () => {
    const result = makeDecision(
      publishablePack(),
      ackFor(publishablePack(), { decision: "rejected" }),
    );
    const text = renderReleaseDecision(result, "text");
    expect(text).toContain("DECISION: REJECT (exit 4)");
    expect(text).toContain("ack-rejected");
  });
});
