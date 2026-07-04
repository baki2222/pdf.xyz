import { describe, expect, it } from "vitest";
import { renderReleaseAck } from "./render";
import { makeAck, publishablePack, reviewPack, tamperedPack } from "./fixtures";

describe("renderReleaseAck — json", () => {
  it("round-trips the result and pins the schema", () => {
    const result = makeAck(publishablePack(), { decision: "accepted" });
    const parsed = JSON.parse(renderReleaseAck(result, "json"));
    expect(parsed.schema).toBe("pdfxyz.release-ack/1");
    expect(parsed.ack.verdict).toBe("acknowledged");
    expect(parsed.receipt.packVerdict).toBe("publishable");
  });

  it("honors the pretty flag", () => {
    const result = makeAck(publishablePack());
    expect(renderReleaseAck(result, "json", false)).not.toContain("\n  ");
    expect(renderReleaseAck(result, "json", true)).toContain("\n  ");
  });
});

describe("renderReleaseAck — text", () => {
  it("renders the verdict, decision, and acknowledged pack posture", () => {
    const text = renderReleaseAck(makeAck(reviewPack(), { decision: "accepted-with-notes", reviewer: "external-reviewer", note: "policy-follow-up" }), "text");
    expect(text).toContain("ACKNOWLEDGEMENT: ACKNOWLEDGED-WITH-FOLLOWUP (exit 3)");
    expect(text).toContain("decision=accepted-with-notes");
    expect(text).toContain("reviewer=external-reviewer");
    expect(text).toContain("note=policy-follow-up");
    expect(text).toContain("ACKNOWLEDGED PACK");
    expect(text).toContain("NEXT ACTIONS");
    expect(text).toContain("CAVEATS");
  });

  it("renders an invalid verdict for a tampered pack", () => {
    const text = renderReleaseAck(makeAck(tamperedPack(), { decision: "accepted" }), "text");
    expect(text).toContain("ACKNOWLEDGEMENT: INVALID (exit 4)");
    expect(text).toContain("state=tampered");
  });
});
